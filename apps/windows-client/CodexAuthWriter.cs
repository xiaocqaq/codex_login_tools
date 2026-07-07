using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodexLoginTools.Win;

public static class CodexAuthWriter
{
    private const string ProxyApiKey = "proxy-key";
    private static readonly string[] ManagedValues = ["proxy-key", "PROXY_MANAGED"];

    public static void Apply()
    {
        var authPath = GetAuthPath();
        var backupPath = GetBackupPath();
        var missingPath = GetMissingPath();
        Directory.CreateDirectory(Path.GetDirectoryName(authPath)!);

        if (!File.Exists(backupPath) && !File.Exists(missingPath))
        {
            if (File.Exists(authPath))
            {
                File.Copy(authPath, backupPath);
            }
            else
            {
                File.WriteAllText(missingPath, "", new UTF8Encoding(false));
            }
        }

        var json = ReadAuthJson(authPath);
        json["OPENAI_API_KEY"] = ProxyApiKey;
        File.WriteAllText(authPath, json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n", new UTF8Encoding(false));
    }

    public static void Restore()
    {
        var authPath = GetAuthPath();
        var backupPath = GetBackupPath();
        var missingPath = GetMissingPath();

        if (File.Exists(backupPath))
        {
            Directory.CreateDirectory(Path.GetDirectoryName(authPath)!);
            File.Copy(backupPath, authPath, overwrite: true);
            File.Delete(backupPath);
            DeleteIfExists(missingPath);
            return;
        }

        if (File.Exists(missingPath))
        {
            DeleteIfCurrentKeyIsManaged(authPath);
            File.Delete(missingPath);
            return;
        }

        DeleteManagedKeyWithoutBackup(authPath);
    }

    private static JsonObject ReadAuthJson(string authPath)
    {
        if (!File.Exists(authPath))
        {
            return [];
        }

        try
        {
            return JsonNode.Parse(File.ReadAllText(authPath, Encoding.UTF8)) as JsonObject ?? [];
        }
        catch
        {
            return [];
        }
    }

    private static void DeleteIfCurrentKeyIsManaged(string authPath)
    {
        if (!File.Exists(authPath))
        {
            return;
        }

        var json = ReadAuthJson(authPath);
        if (!IsManagedValue(json["OPENAI_API_KEY"]?.GetValue<string>()))
        {
            return;
        }

        json.Remove("OPENAI_API_KEY");
        if (json.Count == 0)
        {
            File.Delete(authPath);
            return;
        }

        File.WriteAllText(authPath, json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n", new UTF8Encoding(false));
    }

    private static void DeleteManagedKeyWithoutBackup(string authPath)
    {
        if (!File.Exists(authPath))
        {
            return;
        }

        var json = ReadAuthJson(authPath);
        var current = json["OPENAI_API_KEY"]?.GetValue<string>();
        if (!IsManagedValue(current))
        {
            return;
        }

        json.Remove("OPENAI_API_KEY");
        if (json.Count == 0)
        {
            File.Delete(authPath);
            return;
        }

        File.WriteAllText(authPath, json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n", new UTF8Encoding(false));
    }

    private static bool IsManagedValue(string? value) =>
        value != null && ManagedValues.Contains(value, StringComparer.Ordinal);

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    private static string GetAuthPath() =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".codex",
            "auth.json");

    private static string GetBackupPath() => GetAuthPath() + ".codex-login-tools.bak";

    private static string GetMissingPath() => GetAuthPath() + ".codex-login-tools.missing";
}
