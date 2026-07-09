# Codex 驱动 CAD 绘图：代理分发 + MCP/Skills 集成可行性设计书

> 版本：v1.1（2026-07-09）
> 状态：可行性设计（供其他会话直接续作实现）
> v1.1 变更：**默认方案改为「服务端纯分发 / 全本地执行」**——服务端只托管 skills/脚本/本地 MCP 包（纯数据），所有 CAD 生成与控制在客户端本机执行；远程 HTTP MCP 降级为可选的「集中化模式」。
> 关联评测：`docs/Codex+For+CAD+工程应用评测报告.pdf`（建设综合勘察研究设计院 / 北航高研院 / 清华，基坑支护场景）
> 关联工程：本仓库 `codex_login_tools`（已有 admin + gateway + windows-client 代理分发体系）

---

## 0. 一句话结论

**可行，且路径清晰。** 复用本仓库现有的“服务端集中管理 + 本地网关改写 `~/.codex/config.toml` + Windows 客户端分发”三件套，即可把 **Skills、脚本、本地 MCP 包**做成“服务端托管、客户端一键下载/挂载”的能力包，通过 Codex 桌面端/CLI 控制 CAD 绘图。**核心不是从零造 CAD 能力，而是把成熟开源 MCP/Skill 接进现有分发管道**。

**默认架构：服务端纯分发 / 全本地执行。** 服务端只存放「怎么画」的规则与代码（skills / 脚本 / 本地 MCP 包，皆为纯数据），客户端下载后**在本机执行全部 CAD 生成与控制**；图纸产物（DWG/DXF/计算书）**不出本机/内网**，服务端不碰「画了什么」。远程 HTTP MCP 仅作可选的「集中化模式」保留。

关键判断：
- ✅ **分发通道已存在**：现有 gateway 已经会写 `~/.codex/config.toml`，天然可扩展为写入 `[mcp_servers.*]` 块并落地 Skills/脚本。
- ✅ **CAD 产物 100% 本地生成**：CAD 控制（COM）与 DXF/计算（ezdxf/脚本）全部本机 stdio 执行，服务端无运行时进程。
- ⚠️ **CAD 控制类 MCP 必须跑在客户端本机**（依赖本机 AutoCAD 的 Windows COM 接口）——这与「全本地执行」的默认方案天然一致。
- ⚠️ **唯一例外：LLM 推理**仍经 gateway 走上游模型（Codex 出意图理解/代码的必要环节），与「CAD 产物本地生成」是两回事，无法也无需本地化。
- ✅ **Skills/脚本/提示词模板是纯数据**，最适合服务端托管、客户端按需下载，正是评测报告“方法四 Skill 封装”的落地形态。

---

## 1. 需求与目标

### 1.1 用户目标
将 Skills / 脚本 / 本地 MCP 包部署在服务端；客户端通过现有代理工具：
1. 下载 Skills、脚本、本地 MCP 包、提示词模板到本地 Codex；
2. 在**本机**启动本地 MCP（stdio）执行 CAD 生成与控制；
3. 通过 Codex 桌面端控制本机 CAD 完成绘图、改图、计算等工作，**产物不出本机**。
4.（可选）调用服务端远程 HTTP MCP，仅用于需要集中化生成的团队场景。

### 1.2 设计原则
- **不重复造轮子**：优先集成已开源的 CAD MCP / text-to-cad Skill / ezdxf，仅补设计院专用规范层。
- **复用现有代理**：不新建独立系统，作为 `codex_login_tools` 的能力扩展。
- **分层可裁剪**：先落地低风险高价值项（计算整理、标准剖面初稿、Skill 分发），再扩展到 MCP 改图闭环。

---

## 2. 评测报告关键结论（作为设计输入）

报告以基坑支护为样例，验证了四条 Codex 驱动 CAD 路径，结论对本设计有直接约束：

| 路径 | 定位 | 成熟度 | 本设计取用方式 |
|---|---|---|---|
| 方法一：直接生成 DWG | 从参数直接出图 | 基础几何可用，复杂对象/企业标准弱 | **DXF 生成 MCP**（ezdxf）承担，DWG 走转换桥 |
| 方法二：生成 CAD 脚本（AutoLISP/Python/.NET） | 可复现、可调试绘图逻辑 | 剖面/标注/土层水位可用，需本机 CAD 加载 | **脚本模板库**服务端托管，客户端下载后 `APPLOAD` |
| 方法三：MCP 连接 CAD | 读取/定位/改已有图 | 单图元改、局部联动**部分可用**；复合改图/推理修正**不稳定** | **本地 CAD-control MCP**，需人工复核门禁 |
| 方法四：Skill 封装 | 标准化、参数化任务复用 | 适合沉淀设计院经验 | **Skill 分发**是本设计核心载体 |

报告点名的能力边界（必须写进产品门禁）：
- 跨图纸联动（平面/剖面/详图/参数表）易漏改；
- 结构安全判断不能替代注册工程师；
- 施工图表达规范（如锚索 `L=自由段+锚固段`）不能简单文字替换；
- 原图本身有错时 AI 会继承错误。
- 无比例尺时“偏移 500mm”只能按图面测量近似 → **图纸需带明确比例/坐标系**。

报告已给出可复用资产：**大量提示词模板 + 一句话结论**（计算阶段 8 类、画图阶段 7 类、改图阶段 4 类），这些应直接沉淀为 Skills。报告也点名了现成 Skill 生态：`text-to-cad`、`Create Dxf`、`CAD Viewer`、`Dwg To Dxf Converter`、`Dxf Text Extractor`、`Dwg To Excel`、`Bim Qto` 等。

---

## 3. 现有代理架构（复用基座）

来自本仓库 `README.md` 与源码：

```
Codex CLI / Codex 桌面版
  -> http://127.0.0.1:17861/v1/responses        (本地网关，改写 Authorization + model)
  -> 远程管理端配置 (apps/admin, 0.0.0.0:18080)
  -> Responses 兼容上游 provider
```

现有组件与本设计的复用点：

| 组件 | 现有职责 | 本设计新增职责 |
|---|---|---|
| `apps/admin` | 上游路由、令牌、Codex 安装包/客户端更新包托管、用量统计 | **新增：托管 Skills 包 / 脚本包 / 本地 MCP bundle；下发 mcp_servers 配置清单（默认全 stdio）；（可选）集中化模式下托管远程 HTTP MCP 入口** |
| `apps/gateway` | 本地转发、改写请求、写 `~/.codex/config.toml` gateway 块 | **新增：写 `[mcp_servers.*]` 块；拉取并落地 Skills/脚本到 Codex 目录** |
| `apps/windows-client` | 保存 Token、装 Codex、启动代理、检查更新 | **新增：下载/校验 CAD 能力包、启动本地 CAD-control MCP、检测本机 AutoCAD/FreeCAD** |
| `packages/shared` | provider/route schema 与选路 | **新增：CAD 能力包 schema（skills/scripts/mcp 清单 + 版本 + 校验）** |

> 关键复用：`gateway/src/codex-config.ts` 已实现向 `~/.codex/config.toml` 写入受 `# BEGIN/END` 包裹的托管块。同一机制可再写一个 `# BEGIN CODEX CAD MCP ... # END` 块，安全幂等更新 `[mcp_servers.*]`。

---

## 4. 总体架构设计

### 4.1 三层能力模型（默认：服务端纯分发 / 全本地执行）

```
┌──────────────── 服务端 (apps/admin 扩展) — 纯静态分发，无运行时进程 ──────────┐
│  A. 能力包仓库                              B. 配置下发                        │
│  - skills/*.zip                             - manifest（skills/scripts/mcp    │
│  - scripts/*.lsp/.py                          版本 + sha256 + mcp_servers 建议）│
│  - 本地 MCP 包 (cad-control / cad-dxf)      - 校验 hash/签名                   │
│  - prompt templates                                                          │
│  （服务端只发「怎么画」的规则与代码，不碰「画了什么」的图纸）                  │
└───────────────────────────────────┬──────────────────────────────────────────┘
                                     │  HTTPS 下载 (令牌复用现有鉴权 + sha256 校验)
┌────────────────────────────────────▼─────────────────────────────────────┐
│                 客户端 (windows-client + gateway 扩展) — 全部本地执行      │
│  1. 拉取能力包 → 校验 → 落地到 ~/.codex/skills 与本地脚本/MCP 目录         │
│  2. 写 ~/.codex/config.toml（全部 stdio，无 url）：                        │
│       [mcp_servers.cad_local]  (stdio, 驱动本机 AutoCAD COM)               │
│       [mcp_servers.cad_dxf]    (stdio, 本机 ezdxf 生成 DXF/预览)           │
│  3. 启动本地 MCP，Codex 桌面端调用 → 本机生成/改图                         │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ MCP (stdio) / COM
┌────────────────────────────────────▼─────────────────────────────────────┐
│              本机 CAD (AutoCAD 2025 / GstarCAD / ZWCAD / FreeCAD)          │
│              绘图 / 改图 / 另存 DWG —— 产物不出本机/内网                   │
└───────────────────────────────────────────────────────────────────────────┘

（例外）LLM 推理链路不变：Codex 桌面端仍经 gateway → 上游模型出「意图理解/代码」，
       与 CAD 产物本地生成解耦；服务端仅路由 token，不经手图纸数据。

（可选）集中化模式：把 cad_dxf/计算 MCP 部署为服务端远程 HTTP MCP，
       config.toml 用 url= 接入。仅适合愿意让生成数据过服务端的团队，默认不启用。
```
```

### 4.2 执行位置约束：为什么全本地是自然默认

调研确认：主流 CAD-control MCP（`daobataotie/CAD-MCP`、`ahmetcemkaraca/AutoCAD_MCP`、`vigneshpbmenon/autocad-mcp-server`）都通过 **pywin32 COM** 驱动**正在运行的本机 AutoCAD 实例**；FreeCAD 方案（`neka-nat/freecad-mcp`）通过本机 RPC 插件。因此：
- **CAD 控制 MCP = 本地 stdio MCP**，只能在本机跑；服务端只负责分发二进制/脚本与配置。
- **生成能力（DXF/计算/转换，ezdxf）本身无状态**，既可本地 stdio、也可远程 HTTP——**默认选本地 stdio**，让图纸数据不出本机、服务端零运行时。
- **结论**：既然控制类必须本地、生成类本地也毫无损失，**「全本地执行」是天然、更安全的默认**；远程 HTTP 仅为需要集中生成的团队保留。

> 唯一不本地化的是 **LLM 推理**：Codex 需要模型出意图理解/代码，token 仍经现有 gateway 走上游。这与「CAD 产物本地生成」是两条线——图纸数据始终留在本机，只有自然语言/代码文本经过模型。

### 4.3 Codex 侧对接方式（已验证支持）

Codex CLI/桌面端共享 `~/.codex/config.toml`。**默认方案下所有 CAD MCP 均为本地 stdio（无 `url=`）**：

```toml
# 本地 CAD 控制 MCP（客户端启动，驱动本机 AutoCAD COM）
[mcp_servers.cad_local]
command = "cad-mcp.exe"                    # 或 python -m cad_mcp.server（自包含打包见 §5.3）
startup_timeout_sec = 30
# 安全：只放开必要工具，禁用危险工具
disabled_tools = ["run_arbitrary_python"]

# 本地 DXF 生成 MCP（ezdxf，本机执行，产物不出机）
[mcp_servers.cad_dxf]
command = "python"
args = ["-m", "cad_dxf.server"]           # 或分发的自包含 exe

# —— 可选：集中化模式（默认不启用）——
# 若团队愿意让生成数据过服务端，可把 cad_dxf 换成远程 HTTP：
# [mcp_servers.cad_dxf]
# url = "https://cad.example.com/mcp"
# bearer_token_env_var = "CAD_MCP_TOKEN"   # 复用现有客户端令牌体系
```

Skills 落地：把能力包解压到 Codex 的 skills 目录（随 Codex 版本，通常 `~/.codex/skills/<name>/SKILL.md`），Codex 会在匹配任务时自动遵循流程。

---

## 5. 组件详细设计

### 5.1 服务端：能力包仓库（apps/admin 扩展）

参照现有“Codex 安装包 / 客户端更新包”上传机制，新增三类工件：

| 工件类型 | 内容 | 存储 | 下发 |
|---|---|---|---|
| Skill 包 | `SKILL.md` + 提示词模板 + 引用脚本 + 样例 | `admin/data/skills/<name>-<ver>.zip` | 清单 API + 直链 |
| 脚本包 | AutoLISP `.lsp` / Python / .NET，含运行说明 | `admin/data/scripts/` | 同上 |
| 本地 MCP bundle | 打包好的本地 MCP（`cad-control` 驱动 COM / `cad-dxf` 基于 ezdxf），含依赖或自包含 exe | `admin/data/mcp/` | 同上 |

新增 API（挂在现有 admin，复用令牌鉴权）：
- `GET /api/cad/manifest` → 返回当前 CAD 能力清单（skills/scripts/mcp 版本 + hash + mcp_servers 建议配置）。
- `GET /api/cad/skills/:id` / `scripts/:id` / `mcp/:id` → 下载工件。

清单 schema（放入 `packages/shared`，与现有 `RemoteConfig` 并列）：

```jsonc
{
  "version": 1,
  "skills":  [{ "id": "jikeng-support", "name": "基坑支护CAD", "ver": "1.2.0", "sha256": "...", "url": "..." }],
  "scripts": [{ "id": "zhph-lsp", "name": "支护剖面绘图", "ver": "1.0.0", "sha256": "...", "url": "..." }],
  "mcpServers": [
    { "name": "cad_local", "transport": "stdio", "bundleId": "cad-mcp-win",  "disabledTools": ["run_arbitrary_python"] },
    { "name": "cad_dxf",   "transport": "stdio", "bundleId": "cad-dxf-win" }
    // 可选集中化模式：{ "name": "cad_dxf", "transport": "http", "url": "https://cad.example.com/mcp", "auth": "bearer" }
  ]
}
```

> 默认 `transport` 全为 `stdio` + `bundleId`（本机启动的本地 MCP 包）；`http`+`url` 仅在集中化模式下出现。

### 5.2 生成/计算类 MCP（默认本地 stdio，产物不出机）

- **DXF 生成 MCP（`cad-dxf`）**：基于 `ezdxf` 封装工具（`draw_line/arc/circle/text/dim`、图层管理、`save_dxf`、`dxf_to_png` 预览）。无状态、纯参数进→文件出，**默认作为本地 stdio MCP 由客户端启动**，DXF/PNG 直接落在本机工作目录。
- **DWG 限制**：`ezdxf` 不能直接出 DWG；需 **ODA File Converter 桥**（`ezdxf` 自带 add-on，本机执行）或由本地 CAD-control MCP 另存。DWG 出图优先交给本地 CAD-control MCP。
- **计算类 MCP**（可选）：把评测报告“计算阶段”能力（土压力系数 Ka/Kp、分层土压力、水土压力、超载附加、支锚轴力、桩身配筋复核）做成确定性工具，避免 LLM 直接算数出错——同样本地 stdio。
- **打包分发**：为免客户端预装 Python，`cad-dxf` 建议用 PyInstaller 打成自包含 exe（与现有 windows-client 单文件 exe 风格一致），作为 MCP bundle 走同一分发通道。详见 §5.3、§10 风险表。
- **集中化模式（可选，默认不启用）**：若团队愿意让生成数据经服务端，可把 `cad-dxf`/计算 MCP 部署为**远程 HTTP MCP**（无状态、可横向扩展），`config.toml` 改用 `url=` 接入。**代价：图纸/参数数据会离开本机**，需评估保密要求，不作默认。

### 5.3 客户端：能力包管理 + 本地 MCP 启动（windows-client + gateway 扩展）

流程（复用现有更新/进度条 UI）：
1. 启动代理时拉 `/api/cad/manifest`，与本地已装版本比对；
2. 有更新 → 弹窗确认（沿用现有中文交互）→ 下载 → 校验 `sha256` → 解压落地：
   - Skills → Codex skills 目录；
   - 脚本 → 本地脚本目录（桌面/工作目录，按报告 `APPLOAD` 习惯）；
   - MCP bundle → 客户端私有目录；
3. 检测本机 CAD（AutoCAD/GstarCAD/ZWCAD/FreeCAD 是否安装、是否运行）与本地运行时（若用自包含 exe 则免检）；
4. 写 `~/.codex/config.toml` 的 `# BEGIN CODEX CAD MCP` 块（默认全为 stdio 本地 MCP）；
5. 启动本地 MCP（`cad_local` 控制 CAD + `cad_dxf` 生成 DXF，均 stdio），Codex 桌面端即可调用，全程本机执行。

### 5.4 Skills 内容设计（把报告资产直接沉淀）

按报告三层自定义模型落地：

1. **无代码 Skill**：把报告提供的提示词模板 + 设计院图层/标注/计算书格式/审图要求写进 `SKILL.md`。
2. **低代码 Skill**：把已验证的 AutoLISP（`ZHPH` 支护剖面、`TCSW` 土层水位）、Python、Word/Excel 模板放进 Skill 目录。
3. **企业专用 Skill**：组合成「基坑支护 CAD Skill」「配筋图生成 Skill」「审图意见处理 Skill」。

**强制门禁写进每个 Skill**（对应报告能力边界）：缺参数→标 `【需人工复核】`、不得编造；跨图联动/结构安全/施工图表达规范→提示人工把关；图纸须带比例/坐标系。

---

## 6. 开源集成清单（不要重复造轮子）

> 策略：**控制类 MCP 选一款主力 + 生成类用 ezdxf + Skill 用 text-to-cad 生态**，其余作为参考/降级。

### 6.1 CAD 控制 MCP（本机，Windows COM）
| 项目 | 特点 | 取舍 |
|---|---|---|
| **daobataotie/CAD-MCP** | 多 CAD（AutoCAD/GstarCAD/ZWCAD），pywin32 COM，含 Claude/Cursor 配置样例 | **首选**：国产 CAD 覆盖广，贴合设计院环境 |
| ahmetcemkaraca/AutoCAD_MCP | 面向 AutoCAD 2025，7 个生产可用工具 + 25+ 开发中组件，MIT | 备选：AutoCAD 2025 深度集成 |
| vigneshpbmenon/autocad-mcp-server | 轻量基础绘图（线/多段线/圆/弧），MIT | 参考：结构清晰，适合二开起步 |
| zh19980811/Easy-MCP-AutoCad | 学习向，含 SQLite 图元存储 | 参考 |

### 6.2 生成/文件处理
| 项目 | 用途 | 取舍 |
|---|---|---|
| **mozman/ezdxf** (MIT) | DXF 读写/生成、图层/标注、r12writer 高速写、drawing 出 PNG/PDF/SVG、CLI 审计 | **首选**：DXF 生成 MCP 基座 |
| ODA File Converter 桥（ezdxf add-on） | DXF↔DWG 转换 | DWG 输出时用 |

### 6.3 Skill 生态
| 项目 | 用途 | 取舍 |
|---|---|---|
| **earthtojake/text-to-cad** | CAD/机器人/硬件 agent skills 集合，**同时提供 Codex 与 Claude Code 插件安装**，导出 STEP/STL/GLB/DXF/URDF | **首选**：报告点名的 text-to-cad 即此生态，直接接入 |
| Zoo `text-to-cad` API / KittyCAD UI | 文本→3D 参数化模型 | 三维示意/方案展示时集成 |
| 报告点名 Skills：Create Dxf / CAD Viewer / Dwg To Dxf / Dxf Text Extractor / Dwg To Excel / Bim Qto | 转换/预览/提取/工程量 | 按需纳入能力清单 |

### 6.4 FreeCAD 路线（可选，开源无版权成本）
- **neka-nat/freecad-mcp**：de-facto 标准，本机 RPC 插件，含 FEM。
- 适合无 AutoCAD 授权的分发场景 / 三维建模，但 2D 施工图习惯与设计院流程差异较大，作为**次要路线**。

---

## 7. 数据流（端到端）

```
工程师在 Codex 桌面端输入自然语言（含报告式提示词）
  → Codex 命中服务端下发、已落地本机的 Skill（如「基坑支护CAD」）
  → Codex 经 gateway → 上游模型出「意图理解/绘图代码」（唯一经过服务端的是文本，非图纸）
  → Skill 指示调用本地 MCP 工具（全在本机）：
      · 参数/计算 → cad_dxf(本地) 或 计算 MCP(本地)
      · 生成 DXF 初稿 → cad_dxf(本地 ezdxf)
      · 改已有图/另存 DWG → cad_local(本机 AutoCAD COM)
  → 产出 .dwg/.dxf/.docx/.csv + 差异说明 + 【需人工复核】清单，全部落在本机工作目录
  → 工程师人工把关
```

**数据边界**：图纸/计算产物**全程不出本机**；服务端只在①分发能力包（下载时）②承载 LLM token 路由（推理时经过文本）两处出现，均不经手 DWG/DXF 数据。
鉴权复用现有客户端令牌：能力包下载复用 admin 令牌 + sha256 校验；令牌禁用/限权沿用 admin 现有能力。（仅集中化模式下的远程 MCP 才用 `bearer_token_env_var`。）

---

## 8. 分阶段落地计划

### Phase 0 — 分发管道打通（最低风险，最高复用）
- admin 增加 skills/scripts 上传与 `/api/cad/manifest`；
- gateway 增加写 `[mcp_servers.*]` 块 + 落地 skills；
- client 增加拉取/校验/进度 UI。
- **验收**：客户端一键从服务端拿到一个示例 Skill + 一段 `.lsp`，Codex 能识别 Skill 并在 CAD 中 `APPLOAD` 运行脚本出图。

### Phase 1 — Skill 沉淀（把报告变产品）
- 将报告计算/画图/改图提示词模板转成 3~5 个 Skill（含门禁）；
- 集成 `text-to-cad`（Codex 插件）。
- **验收**：复现报告“带标注支护剖面”“土层水位”“桩配筋示意”三类任务。

### Phase 2 — 本地 CAD 控制 MCP
- 集成 `daobataotie/CAD-MCP`（或 AutoCAD 2025 用 ahmetcemkaraca），客户端打包分发 + 启动；
- 写入 `disabled_tools` 门禁（禁任意代码执行/禁批量删除）。
- **验收**：复现“单图元修改”“局部联动”（已知报告部分可用），漏改项自动标注。

### Phase 3 — 本地生成 MCP + 计算 MCP
- ezdxf DXF 生成 MCP（**本地 stdio**，PyInstaller 自包含 exe）+ 确定性计算工具；
- DWG 走本机 ODA 桥或本机 CAD 另存；
- （可选）如团队需要，再把生成/计算 MCP 额外部署一套远程 HTTP 版供集中化模式。
- **验收**：本地 MCP 出 DXF + PNG 预览、产物落本机，计算结果与报告样例一致。

### Phase 4 — 企业级
- 图层/标注/构件库标准化、版本灰度、用量统计（复用 admin）、审图闭环。

---

## 9. 安全与权限（硬门禁）

- **数据本地化（默认方案的核心收益）**：图纸/计算产物全程留在本机；服务端不接收、不存储任何 DWG/DXF。审图保密与合规风险显著低于集中生成。
- **令牌复用**：能力包下载复用现有客户端令牌 + admin 限权，禁用即失效。（远程 MCP 仅集中化模式下存在，用 `bearer_token_env_var`。）
- **工件校验**：所有下载包 `sha256`（建议后续加签名），防篡改；本地 MCP 包为可执行代码，尤其需校验来源。
- **MCP 工具白/黑名单**：`enabled_tools` 只放必要工具；`disabled_tools` 禁「任意 Python 执行」「无差别删除/覆盖」——尤其 `bonninr/freecad_mcp`、`blwfish/freecad-mcp` 明确授予 AI 全量文件系统/OS 访问，**不得默认启用**。
- **文件操作范围**：CAD 改图/另存限定在指定工作目录，先备份原 DWG（`_bak`）再改。
- **不替代工程师**：结构安全、规范适用性、跨图联动结果一律标 `【需人工复核】`，出图前强制人工确认。
- **不硬编码密钥**：apiKey/令牌走 admin 配置与环境变量，遵循仓库现有约定。

---

## 10. 风险与限制

| 风险 | 说明 | 缓解 |
|---|---|---|
| 客户端本地运行环境 | ezdxf 需 Python + 依赖、CAD 控制需 pywin32 | 本地 MCP 用 PyInstaller 打自包含 exe（首选，无需本机 Python）；或客户端沿用「一键装 Codex」机制装运行时 |
| 客户端算力/体积 | 生成全在本机，自包含包体积较大 | 按需下载、增量更新（复用现有更新机制）；轻任务用脚本免 MCP |
| 无法本地化的推理 | LLM token 仍经 gateway 走上游 | 属既有链路；仅文本经过，图纸不经过，符合数据边界 |
| CAD 授权与版本兼容 | COM 接口随 AutoCAD 版本/国产 CAD 差异 | 主力选多 CAD 的 CAD-MCP；客户端检测版本 |
| 改图不稳定 | 报告证实复合改图/推理修正易漏改 | 仅作「改图助手」，强制人工复核 + 差异说明 |
| DWG 直出弱 | ezdxf 不出 DWG；直生成 DWG 复杂对象受限 | DWG 交本机 CAD；生成侧用 DXF；本机跑 ODA 桥转换 |
| 无比例/坐标 | 偏移类改图只能按图面近似 | Skill 要求图纸带比例/坐标系，否则拒绝精确偏移 |
| 集中化模式数据出机 | 远程 HTTP MCP 会让图纸/参数离开本机 | 默认不启用；启用前评估保密要求 |
| 开源项目成熟度参差 | 部分为学习/foundational 版本 | 选 MIT + 活跃项目，能力清单锁定版本 |
| Codex 版本差异 | skills 目录/config 键位可能随版本变 | manifest 带兼容版本；client 检测 Codex 版本 |

---

## 11. 验收标准（供后续会话自检）

1. 客户端可从服务端**一键获取并校验** Skill/脚本/本地 MCP，Codex 桌面端**自动识别 Skill**。
2. `~/.codex/config.toml` 被**幂等写入** `[mcp_servers.*]`（受 `# BEGIN/END` 包裹，不破坏用户既有配置）。
3. 至少复现报告 **3 类画图任务** + **1 类改图任务**，且漏改/缺参数项**自动标注**。
4. 所有下载工件通过 **hash 校验**；令牌禁用后**能力立即失效**。
5. 危险 MCP 工具**默认禁用**；改图**先备份原图**。

---

## 12. 给后续会话的落地提示

- 起点文件：`apps/admin/src/*`（新增 CAD 工件与 manifest API）、`apps/gateway/src/codex-config.ts`（扩展写 mcp_servers）、`packages/shared/src/index.ts`（新增 CAD manifest schema）、`apps/windows-client/*`（拉取/校验/启动本地 MCP）。
- 先做 **Phase 0 分发管道**（复用现有上传/更新/进度机制，改动局部、边界清晰），再逐层加 Skill/MCP。
- **不要**在服务端尝试直接控制客户端 CAD——控制类 MCP 必须本机 stdio 启动。
- Skill 内容直接搬运 `docs/Codex+For+CAD+工程应用评测报告.pdf` 中的提示词模板 + 一句话结论 + 能力边界门禁。

---

## 参考来源

CAD 控制 MCP：
- https://github.com/daobataotie/CAD-MCP
- https://github.com/ahmetcemkaraca/AutoCAD_MCP
- https://github.com/vigneshpbmenon/autocad-mcp-server
- https://github.com/zh19980811/Easy-MCP-AutoCad

生成/文件处理：
- https://github.com/mozman/ezdxf ・ https://ezdxf.readthedocs.io/

Skill 生态：
- https://github.com/earthtojake/text-to-cad
- https://zoo.dev/text-to-cad ・ https://github.com/KittyCAD/text-to-cad-ui
- https://github.com/Adam-CAD/CADAM

FreeCAD MCP：
- https://github.com/neka-nat/freecad-mcp

Codex MCP 配置：
- https://developers.openai.com/codex/mcp ・ https://developers.openai.com/codex/config-reference

综述：
- https://snyk.io/articles/9-mcp-servers-for-computer-aided-drafting-cad-with-ai/
