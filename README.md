# Codex Login Tools

给朋友使用 Codex 的一套本地代理和远程管理工具。服务端统一管理上游模型、客户端令牌、Codex 桌面版安装包和 Windows 客户端更新包；Windows 客户端在本机启动代理并写入 Codex 配置。

## 组件

- `apps/admin`：远程 Web 管理端，默认监听 `0.0.0.0:18080`
- `apps/gateway`：Node.js 本地透明转发网关，默认监听 `127.0.0.1:17861`
- `apps/windows-client`：当前主用 Windows 桌面客户端，WinForms 单文件 exe
- `apps/desktop`：早期 Electron 桌面端，当前不作为主要发布入口
- `packages/shared`：远程配置 schema、provider/route 选择逻辑

## 当前 Windows 客户端

当前版本：`0.2.1`

打包产物：

```text
apps/windows-client/release-0.2.1/CodexProxy.exe
```

主要能力：

- 保存客户端 Token
- 检测本机是否已安装 Codex 桌面版
- 未检测到 Codex 桌面版时，提示是否一键安装
- 从管理端下载并安装 Codex 桌面版安装包
- 启动本机代理并写入 `~/.codex/config.toml`
- 检查 Windows 客户端更新
- 下载客户端更新时显示进度条
- 令牌被禁用、安装失败、更新失败等提示使用中文界面

## 数据流

```text
Codex CLI / Codex 桌面版
  -> http://127.0.0.1:17861/v1/responses
  -> Windows 客户端内置网关或本地 Node.js 网关
  -> 远程管理端配置
  -> Responses-compatible upstream provider
  -> 响应体流式返回给 Codex
```

网关会改写请求侧的 `Authorization` 和 `model`。用户本地可以固定使用 `codex-best`，实际上游模型由远程管理端的路由配置决定。

## 部署远程管理端

服务器安装 Docker 后，在项目根目录执行：

```bash
export ADMIN_USER="admin"
export ADMIN_PASSWORD="change-me-now"
export CLIENT_TOKEN="friend-client-token"

docker compose up -d --build admin
```

打开管理端：

```text
http://你的服务器IP:18080
```

生产环境建议用 Nginx 或 Caddy 反代到 HTTPS。

## 管理端功能

管理端用于集中维护：

- 总览诊断：展示客户端更新、Token 状态和代理路由健康情况
- 主题切换：支持跟随系统、亮色和暗色，并自动响应系统亮暗主题变化
- 服务商配置：维护 `baseUrl`、`apiKey`、启用状态和该服务商下的模型映射
- 服务商优先级：拖拽调整服务商顺序，排名越靠前越优先使用
- 故障切换：同一个 `matchModel` 可配置多条 route，按服务商优先级自动排序
- 客户端令牌：创建、复制、启用、停用、删除，并可限制指定令牌可用的服务商
- 用量统计：按令牌统计请求数和 token 用量，Token 使用量以“万”为单位保留两位小数
- Codex 桌面版安装包：上传文件或配置下载地址
- Windows 客户端更新包：上传 exe 或配置下载地址和版本号

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

说明：

- `routes[].priority` 仍保留为网关排序字段；管理端不再手动填写优先级数字，保存配置时会根据“服务商优先级”页面的排序自动生成。
- 令牌可用服务商会映射为对应 route 的 `allowedRouteIds` 限制；未限制时默认可使用全部已启用服务商。
- 模型映射详情统一在“服务商配置”页面维护，“服务商优先级”页面只负责启停和排序。

## 故障自动切换

同一个 `matchModel` 可以配置多条 route。网关按 `priority` 从高到低尝试；该优先级由管理端根据服务商排序自动写入，排名靠前的服务商会优先被使用。

自动切换触发条件：

- 上游网络请求异常
- HTTP `429`
- HTTP `5xx`

不会自动切换普通 `4xx`，例如 `400`、`401`、`403`、`404`。

## Windows 客户端开发和打包

构建：

```powershell
dotnet build apps\windows-client\CodexLoginTools.Win.csproj -c Release
```

发布单文件 exe：

```powershell
dotnet publish apps\windows-client\CodexLoginTools.Win.csproj `
  -c Release `
  -r win-x64 `
  --self-contained true `
  -p:PublishSingleFile=true `
  -p:EnableCompressionInSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -o apps\windows-client\release-0.2.0
```

版本号在这里维护：

```xml
<Version>0.2.0</Version>
```

文件位置：

```text
apps/windows-client/CodexLoginTools.Win.csproj
```

## 客户端更新流程

1. 修改 `apps/windows-client/CodexLoginTools.Win.csproj` 的 `<Version>`
2. 使用 `dotnet publish` 打包 `CodexProxy.exe`
3. 在管理端上传客户端更新包，或填写 exe 下载地址
4. 填写对应版本号，例如 `0.2.0`
5. 客户端启动或点击启动代理时会检查更新
6. 发现新版本后弹窗确认，下载时显示进度条
7. 下载完成后由更新脚本替换当前 exe

## Codex 桌面版安装包

如果用户机器未安装 Codex 桌面版，Windows 客户端会在启动代理前提示：

```text
未检测到 Codex 桌面版，是否现在一键安装？
```

安装包来源由管理端配置：

- 上传安装包文件
- 或填写 Codex 桌面版安装包下载地址

下载和安装过程会在客户端显示进度。

## 本地命令行网关

仍可直接运行 Node.js 网关：

```powershell
$env:CONFIG_URL="http://你的服务器IP:18080/api/gateway/config"
$env:CLIENT_TOKEN="friend-client-token"
$env:GATEWAY_PORT="17861"
$env:AUTO_WRITE_CODEX_CONFIG="1"
$env:CODEX_MODEL="codex-best"

npm run start:gateway
```

## Codex 配置写入块

Windows 客户端或 Node.js 网关会写入：

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

常用验证命令：

```powershell
npm test
npm run build
npm run test -w @codex-login-tools/admin
npm run build -w @codex-login-tools/admin
dotnet build apps\windows-client\CodexLoginTools.Win.csproj -c Release
```

如果只修改 Windows 客户端，可优先运行：

```powershell
dotnet build apps\windows-client\CodexLoginTools.Win.csproj -c Release
```

## 当前限制

- 上游必须兼容 `/v1/responses`
- 远程管理端会保存上游 API key，适合可信朋友小范围使用
- 更高安全级别建议改成云端转发或短期凭证
- `apps/desktop` 是早期 Electron 实现，当前发布请优先使用 `apps/windows-client`
