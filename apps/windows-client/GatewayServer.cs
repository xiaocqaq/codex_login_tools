using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodexLoginTools.Win;

public sealed class GatewayServer
{
    private readonly HttpClient _client = new();
    private readonly object _usageLock = new();
    private HttpListener? _listener;
    private CancellationTokenSource? _cts;
    private System.Threading.Timer? _usageTimer;
    private RemoteConfig? _config;
    private AppSettings _settings;
    private UsageCounters _pendingUsage = new();
    private int _flushingUsage;

    public bool IsRunning => _listener?.IsListening == true;
    public string Status { get; private set; } = "未启动";

    public GatewayServer(AppSettings settings)
    {
        _settings = settings;
    }

    public async Task RefreshConfigAsync(AppSettings settings)
    {
        _settings = settings;
        var request = new HttpRequestMessage(HttpMethod.Get, BuildConfigUrl(settings.ServerUrl));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
        using var response = await _client.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException(body);
        _config = JsonSerializer.Deserialize<RemoteConfig>(body) ?? throw new InvalidOperationException("配置为空");
        Status = $"配置已加载：{_config.Providers.Count} 个服务商，{_config.Routes.Count} 条模型映射";
    }

    public async Task StartAsync(AppSettings settings)
    {
        if (IsRunning) return;
        await RefreshConfigAsync(settings);
        _cts = new CancellationTokenSource();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{settings.GatewayPort}/");
        _listener.Start();
        _usageTimer = new System.Threading.Timer(_ => _ = FlushUsageAsync(), null, TimeSpan.FromSeconds(60), TimeSpan.FromSeconds(60));
        Status = $"运行中：http://127.0.0.1:{settings.GatewayPort}/v1";
        _ = Task.Run(() => AcceptLoopAsync(_cts.Token));
    }

    public string GetCodexModel()
    {
        if (_config == null)
        {
            throw new InvalidOperationException("配置尚未加载");
        }

        var enabledProviderIds = _config.Providers
            .Where(provider => provider.Enabled)
            .Select(provider => provider.Id)
            .ToHashSet(StringComparer.Ordinal);
        var route = _config.Routes.FirstOrDefault(candidate =>
            candidate.Id == _config.DefaultRouteId &&
            candidate.Enabled &&
            enabledProviderIds.Contains(candidate.ProviderId));
        route ??= SelectRoutes(null).FirstOrDefault();
        if (route == null)
        {
            throw new InvalidOperationException("没有可用模型映射");
        }

        return route.MatchModel == "*" ? route.UpstreamModel : route.MatchModel;
    }

    public void Stop()
    {
        StopAsync().GetAwaiter().GetResult();
    }

    public async Task StopAsync()
    {
        _cts?.Cancel();
        _listener?.Close();
        _usageTimer?.Dispose();
        _usageTimer = null;
        _listener = null;
        await FlushUsageAsync().ConfigureAwait(false);
        Status = "已停止";
    }

    private async Task AcceptLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested && _listener?.IsListening == true)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => ProxyAsync(context), token);
            }
            catch when (token.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                return;
            }
        }
    }

    private async Task ProxyAsync(HttpListenerContext context)
    {
        try
        {
            if (_config == null) await RefreshConfigAsync(_settings);
            var bodyBytes = await ReadBodyAsync(context.Request);
            var requestedModel = TryGetModel(bodyBytes);
            var routes = SelectRoutes(requestedModel).ToList();
            if (routes.Count == 0) throw new InvalidOperationException("没有可用模型映射");

            foreach (var route in routes)
            {
                var provider = _config!.Providers.FirstOrDefault(item => item.Id == route.ProviderId && item.Enabled);
                if (provider == null) continue;
                using var response = await SendUpstreamAsync(context.Request, provider, bodyBytes, route);
                if ((int)response.StatusCode is 429 or >= 500) continue;
                var responseBytes = await CopyResponseAsync(context.Response, response);
                RecordUsage(success: true, responseBytes);
                return;
            }

            throw new InvalidOperationException("所有上游服务商都不可用");
        }
        catch (Exception error)
        {
            RecordUsage(success: false);
            await WriteJsonAsync(context.Response, 500, new { error = error.Message });
        }
    }

    private async Task<HttpResponseMessage> SendUpstreamAsync(
        HttpListenerRequest incoming,
        ProviderConfig provider,
        byte[] body,
        RouteConfig route)
    {
        var path = incoming.Url?.AbsolutePath ?? "/";
        if (path.StartsWith("/v1", StringComparison.OrdinalIgnoreCase)) path = path[3..];
        var target = provider.BaseUrl.TrimEnd('/') + path + (incoming.Url?.Query ?? "");
        var request = new HttpRequestMessage(new HttpMethod(incoming.HttpMethod), target);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", provider.ApiKey);
        request.Content = new ByteArrayContent(RewriteModel(body, route.UpstreamModel));
        request.Content.Headers.ContentType = new MediaTypeHeaderValue(incoming.ContentType ?? "application/json");
        return await _client.SendAsync(request);
    }

    private IEnumerable<RouteConfig> SelectRoutes(string? model)
    {
        var enabledProviderIds = _config!.Providers
            .Where(provider => provider.Enabled)
            .Select(provider => provider.Id)
            .ToHashSet(StringComparer.Ordinal);
        var enabled = _config!.Routes.Where(route => route.Enabled && enabledProviderIds.Contains(route.ProviderId));
        var matching = enabled.Where(route => route.MatchModel == "*" || route.MatchModel == model).ToList();
        return (matching.Count > 0 ? matching : enabled).OrderByDescending(route => route.Priority);
    }

    private static string BuildConfigUrl(string serverUrl)
    {
        var trimmed = serverUrl.Trim().TrimEnd('/');
        return trimmed.EndsWith("/api/gateway/config", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : $"{trimmed}/api/gateway/config";
    }

    private static string BuildUsageUrl(string serverUrl)
    {
        var trimmed = serverUrl.Trim().TrimEnd('/');
        return trimmed.EndsWith("/api/gateway/usage", StringComparison.OrdinalIgnoreCase)
            ? trimmed
            : $"{trimmed}/api/gateway/usage";
    }

    private static async Task<byte[]> ReadBodyAsync(HttpListenerRequest request)
    {
        using var memory = new MemoryStream();
        await request.InputStream.CopyToAsync(memory);
        return memory.ToArray();
    }

    private static string? TryGetModel(byte[] body)
    {
        try
        {
            return JsonNode.Parse(body)?["model"]?.GetValue<string>();
        }
        catch
        {
            return null;
        }
    }

    private static byte[] RewriteModel(byte[] body, string upstreamModel)
    {
        try
        {
            var node = JsonNode.Parse(body);
            if (node is JsonObject obj) obj["model"] = upstreamModel;
            return Encoding.UTF8.GetBytes(node?.ToJsonString() ?? Encoding.UTF8.GetString(body));
        }
        catch
        {
            return body;
        }
    }

    private async Task FlushUsageAsync()
    {
        if (Interlocked.Exchange(ref _flushingUsage, 1) == 1)
        {
            return;
        }

        UsageCounters snapshot;
        lock (_usageLock)
        {
            if (_pendingUsage.IsEmpty)
            {
                Interlocked.Exchange(ref _flushingUsage, 0);
                return;
            }

            snapshot = _pendingUsage;
            _pendingUsage = new UsageCounters();
        }

        try
        {
            var request = new HttpRequestMessage(HttpMethod.Post, BuildUsageUrl(_settings.ServerUrl));
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _settings.ClientToken);
            request.Content = new StringContent(JsonSerializer.Serialize(snapshot), Encoding.UTF8, "application/json");
            using var response = await _client.SendAsync(request).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                RequeueUsage(snapshot);
            }
        }
        catch
        {
            RequeueUsage(snapshot);
        }
        finally
        {
            Interlocked.Exchange(ref _flushingUsage, 0);
        }
    }

    private void RequeueUsage(UsageCounters counters)
    {
        lock (_usageLock)
        {
            counters.Add(_pendingUsage);
            _pendingUsage = counters;
        }
    }

    private void RecordUsage(bool success, byte[]? responseBytes = null)
    {
        var counters = responseBytes == null ? new UsageCounters() : ExtractUsage(responseBytes);
        counters.RequestCount = 1;
        if (success)
        {
            counters.SuccessCount = 1;
        }
        else
        {
            counters.FailureCount = 1;
        }

        lock (_usageLock)
        {
            _pendingUsage.Add(counters);
        }
    }

    private static UsageCounters ExtractUsage(byte[] responseBytes)
    {
        try
        {
            var usage = JsonNode.Parse(responseBytes)?["usage"];
            if (usage == null)
            {
                return new UsageCounters();
            }

            var input = GetInt(usage, "input_tokens") ?? GetInt(usage, "prompt_tokens") ?? 0;
            var output = GetInt(usage, "output_tokens") ?? GetInt(usage, "completion_tokens") ?? 0;
            var cached = GetInt(usage, "cached_input_tokens") ??
                GetInt(usage?["input_tokens_details"], "cached_tokens") ??
                GetInt(usage?["prompt_tokens_details"], "cached_tokens") ??
                0;
            var total = GetInt(usage, "total_tokens") ?? input + output;

            return new UsageCounters
            {
                InputTokens = input,
                OutputTokens = output,
                CachedInputTokens = cached,
                TotalTokens = total
            };
        }
        catch
        {
            return new UsageCounters();
        }
    }

    private static int? GetInt(JsonNode? node, string propertyName)
    {
        try
        {
            return node?[propertyName]?.GetValue<int>();
        }
        catch
        {
            return null;
        }
    }

    private static async Task<byte[]> CopyResponseAsync(HttpListenerResponse target, HttpResponseMessage source)
    {
        target.StatusCode = (int)source.StatusCode;
        target.ContentType = source.Content.Headers.ContentType?.ToString() ?? "application/json";
        var bytes = await source.Content.ReadAsByteArrayAsync();
        target.ContentLength64 = bytes.Length;
        await target.OutputStream.WriteAsync(bytes);
        target.Close();
        return bytes;
    }

    private static async Task WriteJsonAsync(HttpListenerResponse response, int statusCode, object value)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value));
        response.StatusCode = statusCode;
        response.ContentType = "application/json";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
        response.Close();
    }
}
