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

    [JsonPropertyName("hasFile")]
    public bool HasFile { get; set; }
}

public sealed class ClientUpdateCheck
{
    public bool Available { get; init; }
    public string CurrentVersion { get; init; } = "";
    public string RemoteVersion { get; init; } = "";
    public string DownloadUrl { get; init; } = "";
    public bool HasFile { get; init; }
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
            HasFile = release.HasFile,
            Available = CompareVersions(release.Version, current) > 0
        };
    }

    public static async Task DownloadAndApplyAsync(
        AppSettings settings,
        IProgress<CodexInstallProgress>? progress = null)
    {
        var status = await CheckAsync(settings).ConfigureAwait(false);
        await DownloadAndApplyAsync(settings, status, progress).ConfigureAwait(false);
    }

    public static async Task DownloadAndApplyAsync(
        AppSettings settings,
        ClientUpdateCheck status,
        IProgress<CodexInstallProgress>? progress = null)
    {
        if (!status.Available)
        {
            throw new InvalidOperationException("当前没有可用客户端更新。");
        }

        var candidates = BuildDownloadCandidates(status, settings);
        if (candidates.Count == 0)
        {
            throw new InvalidOperationException("客户端更新包未配置下载源。");
        }

        var dir = Path.Combine(Path.GetTempPath(), "CodexLoginTools", "Update");
        Directory.CreateDirectory(dir);
        var packagePath = Path.Combine(dir, "Codex 代理.update.exe");
        await DownloadToFileAsync(candidates, packagePath, settings.ClientToken, progress).ConfigureAwait(false);

        StartReplacementScript(packagePath, new FileInfo(packagePath).Length);
    }

    public static void CleanupVisibleBackup()
    {
        try
        {
            var currentPath = Environment.ProcessPath ?? Application.ExecutablePath;
            var visibleBackup = currentPath + ".bak";
            if (File.Exists(visibleBackup))
            {
                File.Delete(visibleBackup);
                ClientLog.Write("removed legacy visible update backup: " + visibleBackup);
            }
        }
        catch (Exception error)
        {
            ClientLog.Write("remove legacy visible update backup failed: " + error.Message);
        }
    }

    private static async Task DownloadToFileAsync(
        IReadOnlyList<DownloadCandidate> candidates,
        string packagePath,
        string clientToken,
        IProgress<CodexInstallProgress>? progress)
    {
        Exception? lastError = null;
        foreach (var candidate in candidates)
        {
            try
            {
                progress?.Report(new CodexInstallProgress
                {
                    Message = $"正在连接下载源：{candidate.Uri.Host}",
                    Percent = 0
                });
                using var request = new HttpRequestMessage(HttpMethod.Get, candidate.Uri);
                if (candidate.SendToken)
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", clientToken);
                }

                using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                await using var target = File.Create(packagePath);
                await BinaryDownloadGuard.CopyVerifiedAsync(response.Content, target, progress).ConfigureAwait(false);
                return;
            }
            catch (Exception error)
            {
                lastError = error;
            }
        }

        throw new InvalidOperationException($"客户端下载失败：{lastError?.Message}");
    }

    private static IReadOnlyList<DownloadCandidate> BuildDownloadCandidates(
        ClientUpdateCheck status,
        AppSettings settings)
    {
        var candidates = new List<DownloadCandidate>();
        if (!string.IsNullOrWhiteSpace(status.DownloadUrl))
        {
            candidates.AddRange(DownloadUrlHelper.BuildDownloadUris(status.DownloadUrl)
                .Select(uri => new DownloadCandidate(uri, SendToken: false)));
        }

        if (string.IsNullOrWhiteSpace(status.DownloadUrl) || status.HasFile)
        {
            candidates.Add(new DownloadCandidate(
                new Uri(BuildUrl(settings.ServerUrl, "/api/gateway/client-release/download?source=file")),
                SendToken: true));
        }

        return candidates;
    }

    private static void StartReplacementScript(string packagePath, long expectedSize)
    {
        var currentPath = Environment.ProcessPath ?? Application.ExecutablePath;
        var scriptPath = Path.Combine(Path.GetTempPath(), "CodexLoginTools", "Update", "apply-update.ps1");
        var logPath = ClientLog.LogPath;
        var script = """
param(
  [int]$ProcessId,
  [string]$Source,
  [string]$Target,
  [string]$LogPath,
  [long]$ExpectedSize
)
function Write-UpdateLog([string]$Message) {
  $dir = Split-Path -Parent $LogPath
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Add-Content -LiteralPath $LogPath -Value ("[{0:yyyy-MM-dd HH:mm:ss}] update: {1}" -f (Get-Date), $Message)
}
function Remove-Quiet([string]$Path) {
  try {
    if ($Path -and (Test-Path -LiteralPath $Path)) {
      Remove-Item -LiteralPath $Path -Force
    }
  } catch {
    Write-UpdateLog "cleanup failed: $Path - $($_.Exception.Message)"
  }
}
function Restore-Backup([string]$Backup, [string]$Target) {
  if (!(Test-Path -LiteralPath $Backup)) {
    return $false
  }

  try {
    Copy-Item -LiteralPath $Backup -Destination $Target -Force
    Write-UpdateLog "rollback complete: $Target"
    return $true
  } catch {
    Write-UpdateLog "rollback failed: $($_.Exception.Message)"
    return $false
  }
}

$ErrorActionPreference = 'Stop'
$updateDir = Split-Path -Parent $Source
$backup = Join-Path $updateDir ((Split-Path -Leaf $Target) + ".rollback.bak")
$legacyBackup = "$Target.bak"
try {
  Write-UpdateLog "waiting for process $ProcessId"
  Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 1200

  $sourceItem = Get-Item -LiteralPath $Source
  if ($ExpectedSize -gt 0 -and $sourceItem.Length -ne $ExpectedSize) {
    throw "Downloaded update size mismatch. Expected $ExpectedSize, got $($sourceItem.Length)."
  }

  Remove-Quiet $legacyBackup
  if (Test-Path -LiteralPath $Target) {
    Copy-Item -LiteralPath $Target -Destination $backup -Force
    try {
      [System.IO.File]::SetAttributes($backup, [System.IO.FileAttributes]::Hidden)
    } catch {
      Write-UpdateLog "hide rollback backup failed: $($_.Exception.Message)"
    }
  }

  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      Copy-Item -LiteralPath $Source -Destination $Target -Force
      $targetItem = Get-Item -LiteralPath $Target
      if ($targetItem.Length -ne $sourceItem.Length) {
        throw "Target size mismatch. Expected $($sourceItem.Length), got $($targetItem.Length)."
      }

      Write-UpdateLog "replacement complete: $Target"
      Remove-Quiet $backup
      Remove-Quiet $Source
      Remove-Quiet $legacyBackup
      Start-Process -FilePath $Target
      exit 0
    } catch {
      Write-UpdateLog "replacement attempt $attempt failed: $($_.Exception.Message)"
      Restore-Backup $backup $Target | Out-Null
      Start-Sleep -Milliseconds 500
    }
  }

  throw "Replacement failed after retries."
} catch {
  Write-UpdateLog "update failed: $($_.Exception.Message)"
  $restored = Restore-Backup $backup $Target
  if ($restored) {
    Remove-Quiet $backup
    Remove-Quiet $Source
  }
  Remove-Quiet $legacyBackup
  if (Test-Path -LiteralPath $Target) {
    Start-Process -FilePath $Target
  }
  exit 1
}
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
        info.ArgumentList.Add("-LogPath");
        info.ArgumentList.Add(logPath);
        info.ArgumentList.Add("-ExpectedSize");
        info.ArgumentList.Add(expectedSize.ToString());
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

    private sealed record DownloadCandidate(Uri Uri, bool SendToken);
}
