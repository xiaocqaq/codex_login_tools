# cad-dxf-mcp

基坑支护 CAD 生成/计算 MCP（Phase 3，默认「全本地执行」）。

- **确定性计算**（`geotech/`）：土压力系数 Ka/Kp、分层土压力等纯函数，避免 LLM 直接算数出错。
- **DXF 生成**（`drawing/`）：基于 [ezdxf](https://ezdxf.mozman.at/) 生成可编辑 DXF 与 PNG 预览。
- **MCP server**（`server.py`）：把上述能力暴露为 MCP 工具，供 Codex 桌面端调用。

产物全部在本机生成，图纸不出机。作为客户端 bundle 分发（见 `mcp-entry.json`）。

## 本机开发/验证

```bash
python -m pip install -e ".[dev]"
pytest            # 计算 + DXF 生成核心逻辑单测
```

## 打包为客户端 bundle（真机）

用 PyInstaller 打成自包含 exe，连同 `mcp-entry.json` 一起 zip，经 admin 上传为 `bundles` 工件。
客户端解包后按 `mcp-entry.json` 启动；Codex 依 `~/.codex/config.toml` 的 `[mcp_servers.cad_dxf]` 拉起。

## 现状

- ✅ 计算 + DXF 生成核心逻辑（纯 Python，本机 pytest 通过）
- ⏸ MCP server 薄封装需 `mcp` SDK（真机安装）；真机验收：Codex 调用 → 出图
