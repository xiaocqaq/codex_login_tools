using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodexLoginTools.Win;

public static class ClientUpdateFailureStore
{
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static string StatePath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "CodexLoginTools", "update-failure.json");

    public static bool ShouldSkip(string version)
    {
        var state = Load();
        return !string.IsNullOrWhiteSpace(version) &&
            state?.Version.Equals(version, StringComparison.OrdinalIgnoreCase) == true;
    }

    public static void Record(string version, Exception error)
    {
        if (string.IsNullOrWhiteSpace(version))
        {
            return;
        }

        Save(new UpdateFailureState
        {
            Version = version.Trim(),
            FailedAt = DateTimeOffset.Now,
            Message = error.Message
        });
    }

    public static void Clear(string version)
    {
        try
        {
            if (!ShouldSkip(version) || !File.Exists(StatePath))
            {
                return;
            }

            File.Delete(StatePath);
        }
        catch (Exception error)
        {
            ClientLog.Write("clear update failure state failed: " + error.Message);
        }
    }

    private static UpdateFailureState? Load()
    {
        try
        {
            if (!File.Exists(StatePath))
            {
                return null;
            }

            return JsonSerializer.Deserialize<UpdateFailureState>(File.ReadAllText(StatePath), Options);
        }
        catch
        {
            return null;
        }
    }

    private static void Save(UpdateFailureState state)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
            File.WriteAllText(StatePath, JsonSerializer.Serialize(state, Options));
        }
        catch (Exception error)
        {
            ClientLog.Write("save update failure state failed: " + error.Message);
        }
    }

    private sealed class UpdateFailureState
    {
        [JsonPropertyName("version")]
        public string Version { get; set; } = "";

        [JsonPropertyName("failedAt")]
        public DateTimeOffset FailedAt { get; set; }

        [JsonPropertyName("message")]
        public string Message { get; set; } = "";
    }
}
