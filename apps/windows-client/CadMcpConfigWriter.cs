using System.Text;

namespace CodexLoginTools.Win;

// 已解析为本机可执行形态的 MCP server（bundleId 已由 CadSync 解析为 command/args）。
public sealed class ResolvedCadMcpServer
{
    public string Name { get; init; } = "";
    public string Transport { get; init; } = "stdio"; // "stdio" | "http"

    // stdio
    public string? Command { get; init; }
    public IReadOnlyList<string>? Args { get; init; }
    public int? StartupTimeoutSec { get; init; }

    // http
    public string? Url { get; init; }
    public string? BearerTokenEnvVar { get; init; }

    public IReadOnlyList<string> DisabledTools { get; init; } = [];
    public IReadOnlyList<string> EnabledTools { get; init; } = [];
}

// 幂等写入 ~/.codex/config.toml 中受管的 CAD MCP 块，
// 与 CODEX LOGIN TOOLS GATEWAY 块并存，对应 gateway 的 writeCodexCadMcpConfig。
public static class CadMcpConfigWriter
{
    private const string BeginMarker = "# BEGIN CODEX CAD MCP";
    private const string EndMarker = "# END CODEX CAD MCP";

    public static void Apply(IReadOnlyList<ResolvedCadMcpServer> servers)
    {
        var configPath = GetConfigPath();
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);

        var existing = File.Exists(configPath)
            ? File.ReadAllText(configPath, Encoding.UTF8)
            : "";
        var clean = RemoveManagedBlock(existing).TrimEnd();

        if (servers.Count == 0)
        {
            var cleaned = clean.Length > 0 ? clean + "\n" : "";
            File.WriteAllText(configPath, cleaned, new UTF8Encoding(false));
            return;
        }

        var block = BuildBlock(servers);
        var prefix = clean.Length > 0 ? clean + "\n\n" : "";
        File.WriteAllText(configPath, prefix + block + "\n", new UTF8Encoding(false));
    }

    public static void Remove() => Apply([]);

    private static string BuildBlock(IReadOnlyList<ResolvedCadMcpServer> servers)
    {
        var lines = new List<string> { BeginMarker };
        for (var i = 0; i < servers.Count; i++)
        {
            if (i > 0)
            {
                lines.Add("");
            }
            var server = servers[i];
            lines.Add($"[mcp_servers.{server.Name}]");
            if (server.Transport == "http")
            {
                lines.Add($"url = {TomlString(server.Url ?? "")}");
                if (!string.IsNullOrEmpty(server.BearerTokenEnvVar))
                {
                    lines.Add($"bearer_token_env_var = {TomlString(server.BearerTokenEnvVar)}");
                }
            }
            else
            {
                lines.Add($"command = {TomlString(server.Command ?? "")}");
                if (server.Args is { Count: > 0 })
                {
                    lines.Add($"args = {TomlStringArray(server.Args)}");
                }
                if (server.StartupTimeoutSec is int timeout)
                {
                    lines.Add($"startup_timeout_sec = {timeout}");
                }
            }
            if (server.EnabledTools.Count > 0)
            {
                lines.Add($"enabled_tools = {TomlStringArray(server.EnabledTools)}");
            }
            if (server.DisabledTools.Count > 0)
            {
                lines.Add($"disabled_tools = {TomlStringArray(server.DisabledTools)}");
            }
        }
        lines.Add(EndMarker);
        return string.Join("\n", lines);
    }

    // 优先字面量单引号串（免转义，适合 Windows 反斜杠路径）；含单引号或换行时回退双引号串。
    private static string TomlString(string value)
    {
        if (!value.Contains('\'') && !value.Contains('\n'))
        {
            return $"'{value}'";
        }
        var escaped = value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\n", "\\n");
        return $"\"{escaped}\"";
    }

    private static string TomlStringArray(IReadOnlyList<string> values) =>
        "[" + string.Join(", ", values.Select(TomlString)) + "]";

    private static string GetConfigPath() =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".codex",
            "config.toml");

    private static string RemoveManagedBlock(string content)
    {
        var start = content.IndexOf(BeginMarker, StringComparison.Ordinal);
        var end = content.IndexOf(EndMarker, StringComparison.Ordinal);
        if (start < 0)
        {
            return content;
        }
        if (end < start)
        {
            return content[..start];
        }
        return content.Remove(start, end + EndMarker.Length - start);
    }
}
