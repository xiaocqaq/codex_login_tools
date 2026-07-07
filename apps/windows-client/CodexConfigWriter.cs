using System.Text;

namespace CodexLoginTools.Win;

public static class CodexConfigWriter
{
    private const string BeginMarker = "# BEGIN CODEX LOGIN TOOLS GATEWAY";
    private const string EndMarker = "# END CODEX LOGIN TOOLS GATEWAY";

    private const string ProviderId = "codex_login_tools";

    public static void Apply(AppSettings settings, string model)
    {
        var configPath = GetConfigPath();
        var backupPath = GetBackupPath();
        Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);

        var existing = File.Exists(configPath)
            ? File.ReadAllText(configPath, Encoding.UTF8)
            : "";
        var clean = RemoveManagedBlock(existing).TrimStart();

        if (!File.Exists(backupPath))
        {
            File.WriteAllText(backupPath, clean, new UTF8Encoding(false));
        }

        var next = BuildBlock(settings, model) + "\n\n" + clean;
        File.WriteAllText(configPath, next.TrimEnd() + "\n", new UTF8Encoding(false));
    }

    public static void Restore()
    {
        var configPath = GetConfigPath();
        var backupPath = GetBackupPath();

        if (File.Exists(backupPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
            File.Copy(backupPath, configPath, overwrite: true);
            File.Delete(backupPath);
            return;
        }

        if (!File.Exists(configPath))
        {
            return;
        }

        var existing = File.ReadAllText(configPath, Encoding.UTF8);
        var clean = RemoveManagedBlock(existing).TrimStart();
        if (clean != existing)
        {
            File.WriteAllText(configPath, clean.TrimEnd() + "\n", new UTF8Encoding(false));
        }
    }

    private static string GetConfigPath() =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".codex",
            "config.toml");

    private static string GetBackupPath() => GetConfigPath() + ".codex-login-tools.bak";

    private static string BuildBlock(AppSettings settings, string model) =>
        string.Join("\n", [
            BeginMarker,
            $"model_provider = \"{ProviderId}\"",
            $"model = \"{model}\"",
            "",
            $"[model_providers.{ProviderId}]",
            "name = \"Codex Login Tools Gateway\"",
            $"base_url = \"http://127.0.0.1:{settings.GatewayPort}/v1\"",
            "wire_api = \"responses\"",
            "requires_openai_auth = true",
            EndMarker
        ]);

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
