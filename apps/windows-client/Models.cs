using System.Text.Json.Serialization;

namespace CodexLoginTools.Win;

public sealed class RemoteConfig
{
    [JsonPropertyName("pollIntervalSeconds")]
    public int PollIntervalSeconds { get; set; } = 60;

    [JsonPropertyName("providers")]
    public List<ProviderConfig> Providers { get; set; } = [];

    [JsonPropertyName("routes")]
    public List<RouteConfig> Routes { get; set; } = [];

    [JsonPropertyName("defaultRouteId")]
    public string DefaultRouteId { get; set; } = "";
}

public sealed class ProviderConfig
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("baseUrl")]
    public string BaseUrl { get; set; } = "";

    [JsonPropertyName("apiKey")]
    public string ApiKey { get; set; } = "";

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;
}

public sealed class RouteConfig
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("providerId")]
    public string ProviderId { get; set; } = "";

    [JsonPropertyName("matchModel")]
    public string MatchModel { get; set; } = "*";

    [JsonPropertyName("upstreamModel")]
    public string UpstreamModel { get; set; } = "";

    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    [JsonPropertyName("priority")]
    public int Priority { get; set; } = 100;
}

public sealed class AppSettings
{
    public string ServerUrl { get; set; } = "https://admin.xlingo.fun";
    public string ClientToken { get; set; } = "";
    public string GitHubProxyUrl { get; set; } = "";
    public int GatewayPort { get; set; } = 17861;
    public string DeviceId { get; set; } = "";
    public bool TutorialSeen { get; set; }
}

public sealed class UsageCounters
{
    [JsonPropertyName("inputTokens")]
    public int InputTokens { get; set; }

    [JsonPropertyName("outputTokens")]
    public int OutputTokens { get; set; }

    [JsonPropertyName("cachedInputTokens")]
    public int CachedInputTokens { get; set; }

    [JsonPropertyName("totalTokens")]
    public int TotalTokens { get; set; }

    [JsonPropertyName("requestCount")]
    public int RequestCount { get; set; }

    [JsonPropertyName("successCount")]
    public int SuccessCount { get; set; }

    [JsonPropertyName("failureCount")]
    public int FailureCount { get; set; }

    public bool IsEmpty =>
        InputTokens == 0 &&
        OutputTokens == 0 &&
        CachedInputTokens == 0 &&
        TotalTokens == 0 &&
        RequestCount == 0 &&
        SuccessCount == 0 &&
        FailureCount == 0;

    public void Add(UsageCounters other)
    {
        InputTokens += other.InputTokens;
        OutputTokens += other.OutputTokens;
        CachedInputTokens += other.CachedInputTokens;
        TotalTokens += other.TotalTokens;
        RequestCount += other.RequestCount;
        SuccessCount += other.SuccessCount;
        FailureCount += other.FailureCount;
    }
}
