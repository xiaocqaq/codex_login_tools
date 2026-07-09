# Phase 0 交付说明：CAD 能力包分发管道

> 关联设计书：`Codex-CAD-代理集成-可行性设计书.md`（v1.1，服务端纯分发 / 全本地执行）
> 状态：**服务端 + 网关侧已实现并通过单测**；客户端（windows-client, C#）侧为待接契约。

## 一、本次已落地（TS 全链路，`npm test` 48 项通过）

### 1. `packages/shared` — CAD 能力清单 schema
- 新增 `src/cad-manifest.ts`：`CadManifest` / `CadArtifact` / `CadMcpServer` 类型 + `parseCadManifest()` + `emptyCadManifest()`。
- 校验：sha256 为 64 位 hex、ver 为 semver、工件 id 唯一、mcpServers.name 唯一、stdio MCP 的 `bundleId` 必须存在于 `bundles`。
- 默认 `transport: "stdio"`（全本地）；`http` 仅用于可选集中化模式。
- 测试：`test/cad-manifest.test.ts`（8 项）。

### 2. `apps/gateway` — 幂等写 `~/.codex/config.toml` 的 MCP 块
- 新增 `src/codex-cad-config.ts`：`writeCodexCadMcpConfig({ configPath, servers })`。
- 写入受 `# BEGIN CODEX CAD MCP` / `# END CODEX CAD MCP` 包裹的块，与既有 gateway 块并存、可重复覆盖、无 server 时移除。
- Windows 路径用 TOML **字面量单引号串**（免反斜杠转义）。
- `servers` 为**已解析**形态（客户端把 `bundleId` → 本机 `command/args`），支持 stdio 与 http。
- 导出入口已加到 `package.json` 的 `./codex-cad-config`。
- 测试：`test/codex-cad-config.test.ts`（6 项）。

### 3. `apps/admin` — CAD manifest 存储 + API
- 新增 `src/cad-store.ts`：manifest 持久化到 `data/cad/manifest.json`；工件二进制存 `data/cad/artifacts/<kind>/<id>.bin`；上传边落盘边算 sha256；删 bundle 时若被 stdio MCP 引用则拒绝。
- 新增 `src/cad-routes.ts`，已在 `buildAdminServer` 注册。
- 测试：`test/cad-api.test.ts`（6 项）。

## 二、新增 API 一览

管理端（`Authorization: Bearer <adminToken>`）：
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/cad/manifest` | 读当前清单 |
| PUT | `/api/admin/cad/mcp-servers` | 设 mcpServers（body `{ servers: [...] }`，校验 bundle 引用） |
| PUT | `/api/admin/cad/artifacts/:kind/:id` | 上传工件（`kind`=skills/scripts/bundles；header `x-artifact-name`、`x-artifact-version`；body 二进制） |
| DELETE | `/api/admin/cad/artifacts/:kind/:id` | 删工件（被引用的 bundle 返回 409） |

客户端（`Authorization: Bearer <客户端令牌>`，复用现有令牌体系）：
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/gateway/cad/manifest` | 拉清单（含 revision，据此判断是否需刷新） |
| GET | `/api/gateway/cad/artifacts/:kind/:id/download` | 下载工件；响应头 `x-artifact-sha256`、`x-artifact-version` 供校验 |

## 三、客户端（windows-client）待接契约

Phase 0 未改 C# 客户端（需你的 Windows + .NET 环境验收）。落地步骤：
1. 启动代理时 GET `/api/gateway/cad/manifest`，比对本地已装 `revision`。
2. 对每个 skills/scripts/bundles 工件：若本地 sha256 不符则 GET `.../download`，**校验 `x-artifact-sha256` 与实际内容一致**后落地：
   - skills → Codex skills 目录（`~/.codex/skills/<id>/`，解压）
   - scripts → 本地脚本目录
   - bundles → 客户端私有 MCP 目录（解包）
3. 把 `manifest.mcpServers` 的 `bundleId` 解析为本机 `command/args`，调用 gateway 的 `writeCodexCadMcpConfig` 写 `~/.codex/config.toml`。
4. 启动本地 MCP（stdio），Codex 桌面端即可调用。

> 复用现有下载/进度条/中文提示 UI 与令牌鉴权；沿用现有 `# BEGIN/END` 幂等写块思路。

## 四、验证记录
- `npm test`：admin 17 / desktop 8 / gateway 12 / shared 11 = **48 passed**。
- `npm run build`（shared + gateway + admin）：通过（admin 含 vite web 构建）。
- 未在此环境验证：C# 客户端、真机 CAD 出图、本地 MCP 打包（需 Windows + AutoCAD）。

## 五、下一步建议
- **Phase 1**：把评测报告提示词模板做成 3~5 个 Skill 包（含门禁），接入 `earthtojake/text-to-cad`，上传验证下载→落地→Codex 识别。
- **Phase 2/3**：本地 CAD 控制 MCP（`daobataotie/CAD-MCP`）与 ezdxf 生成 MCP，打自包含 exe 作为 bundle 分发——此二者的真机验收在你的机器上进行。
