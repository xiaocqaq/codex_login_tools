using System.IO.Compression;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text.Json;

namespace CodexLoginTools.Win;

// CAD 能力包同步（Phase 0 客户端契约，默认「全本地执行」）：
// 1. 拉 manifest，与本地 revision 比对
// 2. 逐工件校验 sha256，不符则下载并校验后落地（skills/scripts 解压，bundles 解包）
// 3. 把 mcpServers.bundleId 解析为本机 command/args，写 ~/.codex/config.toml
// 注意：stdio MCP 进程由 Codex 依据 config.toml 自行拉起，客户端不负责 spawn。
public static class CadSync
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromMinutes(10) };
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static string BaseDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "CodexLoginTools", "cad");

    private static string StatePath => Path.Combine(BaseDir, "state.json");
    private static string SkillsDir =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".codex", "skills");
    private static string ScriptsDir => Path.Combine(BaseDir, "scripts");
    private static string BundlesDir => Path.Combine(BaseDir, "bundles");

    // 同步入口。失败时抛出，由调用方决定是否阻断（CAD 能力同步失败不应阻断代理启动）。
    public static async Task<CadSyncResult> SyncAsync(
        AppSettings settings,
        IProgress<CodexInstallProgress>? progress = null)
    {
        progress?.Report(new CodexInstallProgress { Message = "正在检查 CAD 能力包。", Percent = 0 });

        var manifest = await FetchManifestAsync(settings).ConfigureAwait(false);
        var state = LoadState();

        if (manifest.Revision == state.Revision && AllInstalled(manifest, state))
        {
            // 清单未变且工件齐全，只需确保 config 一致
            WriteMcpConfig(manifest, settings);
            return new CadSyncResult { Changed = false, Manifest = manifest };
        }

        var artifacts = Enumerable.Empty<(string Kind, CadArtifact Artifact)>()
            .Concat(manifest.Skills.Select(a => ("skills", a)))
            .Concat(manifest.Scripts.Select(a => ("scripts", a)))
            .Concat(manifest.Bundles.Select(a => ("bundles", a)))
            .ToList();

        var index = 0;
        foreach (var (kind, artifact) in artifacts)
        {
            index++;
            var key = $"{kind}/{artifact.Id}";
            if (state.Installed.TryGetValue(key, out var installedSha) &&
                installedSha == artifact.Sha256 &&
                LandingExists(kind, artifact.Id))
            {
                continue;
            }

            var percent = (int)(100.0 * index / Math.Max(artifacts.Count, 1));
            progress?.Report(new CodexInstallProgress
            {
                Message = $"正在下载 CAD {kind}：{artifact.Name}",
                Percent = percent
            });

            await DownloadAndLandAsync(settings, kind, artifact).ConfigureAwait(false);
            state.Installed[key] = artifact.Sha256;
            SaveState(state);
        }

        // 清理清单中已删除的工件落地（可选：保持本地干净）
        PruneRemoved(manifest, state);

        state.Revision = manifest.Revision;
        SaveState(state);

        WriteMcpConfig(manifest, settings);
        progress?.Report(new CodexInstallProgress { Message = "CAD 能力包已更新。", Percent = 100 });
        return new CadSyncResult { Changed = true, Manifest = manifest };
    }

    // 停用/退出时移除受管 config 块（工件文件保留，便于下次快速恢复）
    public static void RemoveMcpConfig() => CadMcpConfigWriter.Remove();

    private static async Task<CadManifest> FetchManifestAsync(AppSettings settings)
    {
        var url = $"{settings.ServerUrl.Trim().TrimEnd('/')}/api/gateway/cad/manifest";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
        using var response = await Client.SendAsync(request).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        return JsonSerializer.Deserialize<CadManifest>(body) ?? new CadManifest();
    }

    private static async Task DownloadAndLandAsync(AppSettings settings, string kind, CadArtifact artifact)
    {
        var url = $"{settings.ServerUrl.Trim().TrimEnd('/')}/api/gateway/cad/artifacts/{kind}/{Uri.EscapeDataString(artifact.Id)}/download";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ClientToken);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();

        Directory.CreateDirectory(BaseDir);
        var tempPath = Path.Combine(BaseDir, $"{Guid.NewGuid():N}.download");
        try
        {
            string actualSha;
            await using (var target = File.Create(tempPath))
            {
                actualSha = await CopyAndHashAsync(response.Content, target).ConfigureAwait(false);
            }

            // 双重校验：清单 sha256 与响应头 sha256（若提供）都必须一致，防篡改
            if (!string.Equals(actualSha, artifact.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"CAD 工件 {artifact.Id} 校验失败：内容 sha256 与清单不一致。");
            }
            var headerSha = response.Headers.TryGetValues("x-artifact-sha256", out var values)
                ? values.FirstOrDefault()
                : null;
            if (!string.IsNullOrEmpty(headerSha) &&
                !string.Equals(headerSha, artifact.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"CAD 工件 {artifact.Id} 校验失败：响应头 sha256 与清单不一致。");
            }

            Land(kind, artifact.Id, tempPath);
        }
        finally
        {
            if (File.Exists(tempPath))
            {
                File.Delete(tempPath);
            }
        }
    }

    // 工件统一为 zip 包；skills → ~/.codex/skills/<id>/，scripts/bundles → 本地目录/<id>/
    private static void Land(string kind, string id, string zipPath)
    {
        var targetDir = Path.Combine(LandingRoot(kind), SanitizeId(id));
        if (Directory.Exists(targetDir))
        {
            Directory.Delete(targetDir, recursive: true);
        }
        Directory.CreateDirectory(targetDir);
        ZipFile.ExtractToDirectory(zipPath, targetDir, overwriteFiles: true);
    }

    private static void WriteMcpConfig(CadManifest manifest, AppSettings settings)
    {
        var resolved = new List<ResolvedCadMcpServer>();
        foreach (var server in manifest.McpServers)
        {
            if (server.Transport == "http")
            {
                resolved.Add(new ResolvedCadMcpServer
                {
                    Name = server.Name,
                    Transport = "http",
                    Url = server.Url,
                    BearerTokenEnvVar = server.Auth == "bearer" ? "CAD_MCP_TOKEN" : null,
                    DisabledTools = server.DisabledTools,
                    EnabledTools = server.EnabledTools
                });
                continue;
            }

            // stdio：把 bundleId 解析为本机 command/args
            var entry = ResolveBundleEntry(server.BundleId);
            if (entry is null)
            {
                // bundle 缺失或无启动描述，跳过该 server（不写半截配置）
                ClientLog.Write($"CAD MCP {server.Name} 跳过：bundle {server.BundleId} 未就绪。");
                continue;
            }
            resolved.Add(new ResolvedCadMcpServer
            {
                Name = server.Name,
                Transport = "stdio",
                Command = entry.Value.Command,
                Args = entry.Value.Args,
                StartupTimeoutSec = entry.Value.StartupTimeoutSec,
                DisabledTools = server.DisabledTools,
                EnabledTools = server.EnabledTools
            });
        }

        CadMcpConfigWriter.Apply(resolved);
    }

    // 读取 bundle 解包目录下的 mcp-entry.json；command 为相对路径时解析为绝对路径。
    private static (string Command, IReadOnlyList<string> Args, int? StartupTimeoutSec)? ResolveBundleEntry(string? bundleId)
    {
        if (string.IsNullOrWhiteSpace(bundleId))
        {
            return null;
        }
        var dir = Path.Combine(BundlesDir, SanitizeId(bundleId));
        var entryPath = Path.Combine(dir, "mcp-entry.json");
        if (!File.Exists(entryPath))
        {
            return null;
        }
        try
        {
            var entry = JsonSerializer.Deserialize<CadBundleEntry>(File.ReadAllText(entryPath));
            if (entry is null || string.IsNullOrWhiteSpace(entry.Command))
            {
                return null;
            }
            var command = entry.Command;
            var candidate = Path.Combine(dir, command);
            if (File.Exists(candidate))
            {
                command = Path.GetFullPath(candidate);
            }
            return (command, entry.Args, entry.StartupTimeoutSec);
        }
        catch
        {
            return null;
        }
    }

    private static string LandingRoot(string kind) => kind switch
    {
        "skills" => SkillsDir,
        "scripts" => ScriptsDir,
        "bundles" => BundlesDir,
        _ => throw new InvalidOperationException($"未知 CAD 工件类型：{kind}")
    };

    private static bool LandingExists(string kind, string id) =>
        Directory.Exists(Path.Combine(LandingRoot(kind), SanitizeId(id)));

    private static bool AllInstalled(CadManifest manifest, CadLocalState state)
    {
        bool Ok(string kind, CadArtifact a) =>
            state.Installed.TryGetValue($"{kind}/{a.Id}", out var sha) &&
            sha == a.Sha256 && LandingExists(kind, a.Id);

        return manifest.Skills.All(a => Ok("skills", a)) &&
               manifest.Scripts.All(a => Ok("scripts", a)) &&
               manifest.Bundles.All(a => Ok("bundles", a));
    }

    private static void PruneRemoved(CadManifest manifest, CadLocalState state)
    {
        var current = new HashSet<string>(
            manifest.Skills.Select(a => $"skills/{a.Id}")
                .Concat(manifest.Scripts.Select(a => $"scripts/{a.Id}"))
                .Concat(manifest.Bundles.Select(a => $"bundles/{a.Id}")));

        foreach (var key in state.Installed.Keys.ToList())
        {
            if (current.Contains(key))
            {
                continue;
            }
            var parts = key.Split('/', 2);
            if (parts.Length == 2)
            {
                var dir = Path.Combine(LandingRoot(parts[0]), SanitizeId(parts[1]));
                if (Directory.Exists(dir))
                {
                    try { Directory.Delete(dir, recursive: true); } catch { /* 忽略清理失败 */ }
                }
            }
            state.Installed.Remove(key);
        }
    }

    private static async Task<string> CopyAndHashAsync(HttpContent content, Stream target)
    {
        using var sha = SHA256.Create();
        await using var source = await content.ReadAsStreamAsync().ConfigureAwait(false);
        var buffer = new byte[128 * 1024];
        int read;
        while ((read = await source.ReadAsync(buffer).ConfigureAwait(false)) > 0)
        {
            sha.TransformBlock(buffer, 0, read, null, 0);
            await target.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
        }
        sha.TransformFinalBlock([], 0, 0);
        return Convert.ToHexString(sha.Hash!).ToLowerInvariant();
    }

    private static CadLocalState LoadState()
    {
        try
        {
            if (File.Exists(StatePath))
            {
                return JsonSerializer.Deserialize<CadLocalState>(File.ReadAllText(StatePath))
                    ?? new CadLocalState();
            }
        }
        catch { /* 状态损坏则重新同步 */ }
        return new CadLocalState();
    }

    private static void SaveState(CadLocalState state)
    {
        Directory.CreateDirectory(BaseDir);
        File.WriteAllText(StatePath, JsonSerializer.Serialize(state, Json));
    }

    private static string SanitizeId(string id)
    {
        var cleaned = new string(id.Select(c =>
            char.IsLetterOrDigit(c) || c is '.' or '_' or '-' ? c : '_').ToArray())
            .TrimStart('.').Trim();
        if (string.IsNullOrEmpty(cleaned))
        {
            throw new InvalidOperationException("无效的 CAD 工件 id。");
        }
        return cleaned;
    }
}

public sealed class CadSyncResult
{
    public bool Changed { get; init; }
    public CadManifest Manifest { get; init; } = new();
}
