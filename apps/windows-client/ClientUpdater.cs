using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodexLoginTools.Win;

public sealed class ClientReleaseStatus
{
    [JsonPropertyName("uploaded")]
    public bool Uploaded { get; set; }

    [JsonPropertyName("version")]
    public string Version { get; set; } = "";

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("downloadUrl")]
    public string DownloadUrl { get; set; } = "";
}

public sealed class ClientUpdateCheck
{
    public bool Available { get; init; }
    public string CurrentVersion { get; init; } = "";
    public string RemoteVersion { get; init; } = "";
    public string DownloadUrl { get; init; } = "";
}

public static class ClientUpdater
{
    private static readonly HttpClient Client = new()
    {
        Timeout = TimeSpan.FromMinutes(10)
    };

    public static async Task<ClientUpdateCheck> CheckAsync(AppSettings settings)
    {
        var current = GetCurrentVersion();
        if (string.IsNullOrWhiteSpace(settings.ClientToken))
        {
            return new ClientUpdateCheck { CurrentVersion = current };
        }

        var request = new HttpRequestMessage(HttpMethod.Get, BuildUrl(settings.ServerUrl, "/api/gateway/client-release"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            return new ClientUpdateCheck { CurrentVersion = current };
        }

        var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        var release = JsonSerializer.Deserialize<ClientReleaseStatus>(body);
        if (release?.Uploaded != true || string.IsNullOrWhiteSpace(release.Version))
        {
            return new ClientUpdateCheck { CurrentVersion = current };
        }

        return new ClientUpdateCheck
        {
            CurrentVersion = current,
            RemoteVersion = release.Version,
            DownloadUrl = release.DownloadUrl,
            Available = CompareVersions(release.Version, current) > 0
        };
    }

    public static async Task DownloadAndApplyAsync(AppSettings settings)
    {
        var status = await CheckAsync(settings).ConfigureAwait(false);
        var candidates = string.IsNullOrWhiteSpace(status.DownloadUrl)
            ? [new Uri(BuildUrl(settings.ServerUrl, "/api/gateway/client-release/download"))]
            : DownloadUrlHelper.BuildDownloadUris(status.DownloadUrl, settings.GitHubProxyUrl);

        var dir = Path.Combine(Path.GetTempPath(), "CodexLoginTools", "Update");
        Directory.CreateDirectory(dir);
        var packagePath = Path.Combine(dir, "Codex 代理.update.exe");
        await DownloadToFileAsync(candidates, packagePath, settings.ClientToken, sendTokenToServerOnly: string.IsNullOrWhiteSpace(status.DownloadUrl))
            .ConfigureAwait(false);

        StartReplacementScript(packagePath);
    }

    private static async Task DownloadToFileAsync(
        IReadOnlyList<Uri> candidates,
        string packagePath,
        string clientToken,
        bool sendTokenToServerOnly)
    {
        Exception? lastError = null;
        foreach (var candidate in candidates)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, candidate);
                if (sendTokenToServerOnly)
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", clientToken);
                }

                using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                await using var source = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
                await using var target = File.Create(packagePath);
                await source.CopyToAsync(target).ConfigureAwait(false);
                return;
            }
            catch (Exception error)
            {
                lastError = error;
            }
        }

        throw new InvalidOperationException($"客户端下载失败：{lastError?.Message}");
    }

    private static void StartReplacementScript(string packagePath)
    {
        var currentPath = Environment.ProcessPath ?? Application.ExecutablePath;
        var scriptPath = Path.Combine(Path.GetTempPath(), "CodexLoginTools", "Update", "apply-update.ps1");
        var script = """
param(
  [int]$ProcessId,
  [string]$Source,
  [string]$Target
)
Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800
Copy-Item -LiteralPath $Source -Destination $Target -Force
Start-Process -FilePath $Target
""";
        File.WriteAllText(scriptPath, script, new UTF8Encoding(false));

        var info = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true
        };
        info.ArgumentList.Add("-NoProfile");
        info.ArgumentList.Add("-ExecutionPolicy");
        info.ArgumentList.Add("Bypass");
        info.ArgumentList.Add("-File");
        info.ArgumentList.Add(scriptPath);
        info.ArgumentList.Add("-ProcessId");
        info.ArgumentList.Add(Environment.ProcessId.ToString());
        info.ArgumentList.Add("-Source");
        info.ArgumentList.Add(packagePath);
        info.ArgumentList.Add("-Target");
        info.ArgumentList.Add(currentPath);
        Process.Start(info);
    }

    private static string GetCurrentVersion()
    {
        var version = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion;
        return (version ?? "0.0.0").Split('+')[0];
    }

    private static int CompareVersions(string left, string right)
    {
        var leftParts = ParseVersion(left);
        var rightParts = ParseVersion(right);
        for (var index = 0; index < Math.Max(leftParts.Length, rightParts.Length); index++)
        {
            var diff = GetPart(leftParts, index) - GetPart(rightParts, index);
            if (diff != 0)
            {
                return diff;
            }
        }

        return 0;
    }

    private static int[] ParseVersion(string value) =>
        value.Split('.', '-', StringSplitOptions.RemoveEmptyEntries)
            .Select(part => int.TryParse(part, out var number) ? number : 0)
            .ToArray();

    private static int GetPart(int[] parts, int index) => index < parts.Length ? parts[index] : 0;

    private static string BuildUrl(string serverUrl, string path) => serverUrl.Trim().TrimEnd('/') + path;
}
