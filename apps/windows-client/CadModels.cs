using System.Text.Json.Serialization;

namespace CodexLoginTools.Win;

// 对应 packages/shared 的 CAD 能力清单（默认「服务端纯分发 / 全本地执行」）。
public sealed class CadManifest
{
    [JsonPropertyName("version")]
    public int Version { get; set; } = 1;

    [JsonPropertyName("revision")]
    public int Revision { get; set; }

    [JsonPropertyName("skills")]
    public List<CadArtifact> Skills { get; set; } = [];

    [JsonPropertyName("scripts")]
    public List<CadArtifact> Scripts { get; set; } = [];

    [JsonPropertyName("bundles")]
    public List<CadArtifact> Bundles { get; set; } = [];

    [JsonPropertyName("mcpServers")]
    public List<CadMcpServer> McpServers { get; set; } = [];
}

public sealed class CadArtifact
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("ver")]
    public string Ver { get; set; } = "";

    [JsonPropertyName("sha256")]
    public string Sha256 { get; set; } = "";

    [JsonPropertyName("size")]
    public long Size { get; set; }
}

public sealed class CadMcpServer
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    // "stdio"（默认，全本地）或 "http"（可选集中化模式）
    [JsonPropertyName("transport")]
    public string Transport { get; set; } = "stdio";

    [JsonPropertyName("bundleId")]
    public string? BundleId { get; set; }

    [JsonPropertyName("url")]
    public string? Url { get; set; }

    // "none" 或 "bearer"
    [JsonPropertyName("auth")]
    public string? Auth { get; set; }

    [JsonPropertyName("disabledTools")]
    public List<string> DisabledTools { get; set; } = [];

    [JsonPropertyName("enabledTools")]
    public List<string> EnabledTools { get; set; } = [];
}

// bundle 解包后约定的启动描述文件 mcp-entry.json：
// { "command": "python", "args": ["-m", "cad_mcp.server"], "startupTimeoutSec": 30 }
// command 为相对路径时，按 bundle 解包目录解析为绝对路径。
public sealed class CadBundleEntry
{
    [JsonPropertyName("command")]
    public string Command { get; set; } = "";

    [JsonPropertyName("args")]
    public List<string> Args { get; set; } = [];

    [JsonPropertyName("startupTimeoutSec")]
    public int? StartupTimeoutSec { get; set; }
}

// 本地已安装状态：记录清单 revision 与每个工件的已装 sha256，用于增量下载。
public sealed class CadLocalState
{
    [JsonPropertyName("revision")]
    public int Revision { get; set; } = -1;

    // key = "<kind>/<id>", value = 已装 sha256
    [JsonPropertyName("installed")]
    public Dictionary<string, string> Installed { get; set; } = [];
}
