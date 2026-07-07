# Codex Login Tools

一个给非程序员朋友使用 Codex 的本地转发网关、远程管理端和 Windows 桌面小工具。

## 组件

- `apps/admin`：远程 Web 管理端，默认监听 `0.0.0.0:18080`
- `apps/gateway`：本地透明转发网关，默认监听 `127.0.0.1:17861`
- `apps/desktop`：Electron 桌面小工具，用于开启/停止本地网关、写入 Codex 配置、检查更新
- `packages/shared`：远程配置 schema、provider/route 选择逻辑

## 数据流

```text
Codex CLI / Codex Desktop
  -> http://127.0.0.1:17861/v1/responses
  -> local gateway
  -> remote admin config
  -> Responses-compatible upstream provider
  -> response body streamed back to Codex
```

网关会改写请求侧的 `Authorization` 和 `model`，响应体按流返回给 Codex。

## 部署远程管理端

服务器安装 Docker 后，在项目根目录执行：

```bash
export ADMIN_USER="admin"
export ADMIN_PASSWORD="change-me-now"
export CLIENT_TOKEN="friend-client-token"

docker compose up -d --build admin
```

打开：

```text
http://你的服务器IP:18080
```

生产环境建议用 Nginx/Caddy 反代到 HTTPS。

## 远程配置格式

```json
{
  "version": 1,
  "pollIntervalSeconds": 60,
  "providers": [
    {
      "id": "primary",
      "name": "Primary",
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "sk-...",
      "enabled": true
    }
  ],
  "routes": [
    {
      "id": "default",
      "providerId": "primary",
      "matchModel": "*",
      "upstreamModel": "responses-compatible-model",
      "enabled": true,
      "priority": 100
    }
  ],
  "defaultRouteId": "default"
}
```

Codex 本地可以使用 `model = "codex-best"`，实际请求模型由远程配置里的 `upstreamModel` 决定。

## 故障自动切换

同一个 `matchModel` 可以配置多条 route。网关按 `priority` 从高到低尝试。

自动切换触发条件：

- 上游网络请求异常
- HTTP `429`
- HTTP `5xx`

不会自动切换普通 `4xx`，例如 `400`、`401`、`403`、`404`。

## 本地命令行网关

```powershell
$env:CONFIG_URL="http://你的服务器IP:18080/api/gateway/config"
$env:CLIENT_TOKEN="friend-client-token"
$env:GATEWAY_PORT="17861"
$env:AUTO_WRITE_CODEX_CONFIG="1"
$env:CODEX_MODEL="codex-best"

npm run start:gateway
```

## 桌面小工具

开发启动：

```powershell
npm install
npm run dev:desktop
```

打包 Windows 安装包和 portable exe：

```powershell
npm run dist:desktop
```

打包输出目录：

```text
apps/desktop/release
```

桌面端能力：

- 开启/停止本地网关
- 保存远程管理端配置地址和 `CLIENT_TOKEN`
- 写入 `~/.codex/config.toml`
- 查看网关运行状态
- 检查 GitHub Releases 更新
- 打包后支持 `electron-updater` 自动更新框架

当前 `apps/desktop/package.json` 中 GitHub Releases 配置为占位：

```json
{
  "provider": "github",
  "owner": "CHANGE_ME",
  "repo": "codex-login-tools"
}
```

正式发布前需要把 `owner` 改成你的 GitHub 用户或组织名，并把 `repo` 改成实际仓库名。

## 桌面端发版流程

1. 修改 `apps/desktop/package.json` 的 GitHub `owner` / `repo`
2. 设置 GitHub token：

```powershell
$env:GH_TOKEN="你的 GitHub token"
```

3. 构建并发布：

```powershell
npm run dist:desktop -- --publish always
```

4. 朋友安装上一版后，后续可在桌面端点击“检查更新”获取新版本。

## Codex 配置写入块

桌面端或网关会写入：

```toml
# BEGIN CODEX LOGIN TOOLS GATEWAY
model_provider = "friend_gateway"
model = "codex-best"

[model_providers.friend_gateway]
name = "Codex Login Tools Gateway"
base_url = "http://127.0.0.1:17861/v1"
wire_api = "responses"
requires_openai_auth = true
# END CODEX LOGIN TOOLS GATEWAY
```

## 验证

```powershell
npm test
npm run build
npm run dist:desktop
```

## 当前限制

- 上游必须兼容 `/v1/responses`
- 远程 admin 会把上游 API key 下发给本地网关，适合可信朋友小范围使用
- 更高安全级别建议改成云端转发或短期凭证
- 自动更新框架已接入，但真正可更新需要先发布 GitHub Release
