namespace CodexLoginTools.Win;

public static class ClientLog
{
    private static readonly object LockObject = new();

    public static string LogPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "CodexLoginTools", "client.log");

    public static void Write(string message)
    {
        try
        {
            lock (LockObject)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
                File.AppendAllText(LogPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {message}{Environment.NewLine}");
            }
        }
        catch
        {
            // Logging must never break startup.
        }
    }
}
