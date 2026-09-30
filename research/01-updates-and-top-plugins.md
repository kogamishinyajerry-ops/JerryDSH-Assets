# DSH 近期更新 + 热门插件 深度调研与实测报告

**日期**：2026-08-22 晚
**执行**：JerryDSH workspace（glm-5.3 经 DSH Web GUI）
**方法**：本地取证（安装副本/源码/npm registry）→ GitHub 仓库 git log（浅克隆 `--shallow-since=2026-08-08`）→ 生态热度（npm 周下载 + GitHub topic star）→ 隔离 profile 实测（不触碰活体 web profile / settings.yaml / .credentials.yaml）

---

## 一、结论速览

1. **"最近几天有更新"属实且幅度大**：npm 上 `@deepseek-ai/dsh` 已从本机的 `0.1.0-rc.5`（08-12）走到 `0.1.1-rc.2`（08-21 中午），近 7 天主仓库 **640 个 commit**。
2. **本机 rc.5 已被凭证格式换代"打断腿"**：`~/.dsh/.credentials.yaml` 已是新版 `version/refs` 结构，rc.5 的解析器要求扁平 ref→string 映射，**rc.5 冷启动（任何 profile 的真实 boot）当前必挂**。正在用的 GUI 是旧进程所以还活着。升级到 0.1.1-rc.2 即解决（已实测：原生解析、boot 成功）。
3. **插件生态爆发**：GitHub `dsh-plugin` topic 已有 **10,529 个仓库**；awesome-dsh-plugin 精选列表 11.3k★；市场类插件宣称收录 1550+ 插件。
4. **5 个热门插件实测全部可装可用**（在 0.1.1-rc.2 上）：find-plugin / advisor / thread / subagent-registry / dshmarket，其中 2 个有真实注意事项（见 §4）。
5. **pnpm 10 构建脚本拦截是 native 依赖插件的最大摩擦点**：`dsh-thread` 装完存储层是坏的，需 `pnpm.onlyBuiltDependencies` + rebuild 才活。

---

## 二、DSH 更新时间线（证据：npm registry time + git tag log）

| 版本 | 发布时间 | 依赖面变化 | 主题（tag 区间 commit 归纳） |
|---|---|---|---|
| 0.1.0-rc.5 | 08-12（**本机在用**） | — | 基线 |
| 0.1.0-rc.7 | 08-17 | 无增删 | ask-user 问题卡折叠、llm replay 修复、PTC Mode 预设改名、low reasoning effort 支持 |
| 0.1.0-rc.8 | 08-19 | **+`dsh-tool-pwsh-persistent`** | 持久化 PowerShell PTY 工具、SQLite 会话持久化布局优化、部署品牌 slots、默认自动打开 Web UI |
| 0.1.1-rc.1 | 08-21 06:49 | 无增删 | **凭证系统重构**（durable credential records + boot 时升级旧扁平文档 + 向人索取凭证）、auth seams 加固、subagent header switcher、前端 404 修复、文档站（llms.txt/raw Markdown） |
| 0.1.1-rc.2 | 08-21 12:42（latest） | 无增删 | **图片/附件统一管线**（master+Files API 双管线、canonical 编码、read_image 报告缩放尺寸）、Files/stream 超时解耦、回滚了一个权限复制 PR |

> 子包 `@deepseek-ai/dsh-headless` 的 `latest` tag 仍停在 0.0.1-rc.1，新版只在 `next`——**显式 pin 子包版本会装错**；但 bundle 解析优先走 dsh 安装自带副本，正常用户不受影响（实测确认）。

### rc.5 冷启动崩溃（本机实证）

```
Error: dsh: plugin tree failed to load: … credentials-local:
the value for "version" in /Users/Zhuanz/.dsh/.credentials.yaml must be a string
（version 实为 int；refs 亦为 mapping——rc.5 期望扁平 ref→string 文档）
```

- 复现：`dsh --profile <任意> <task>` 在 rc.5 上 boot 即挂；`--dump-config` 不挂（离线合成不解析凭证）。
- 0.1.1-rc.2 同一文件**原生 boot 成功**（本报告所有 headless 实测都跑在 0.1.1-rc.2 上）。
- 测试期间未修改原凭证文件：plugtest profile 用的是 `version` 修正副本 + id-targeted patch 指向副本（该 patch 已在最终环境里撤为 `[]`）。

---

## 三、插件生态与热度（2026-08-22 快照）

### 机制（官方文档实证）

- 插件 = 带 `dsh.bundle` manifest 的 npm 包（`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`）；安装 = `dsh plugin --profile <name> add <pkg>`（内部转发 pnpm，自动把包名追加进 `dsh.profile.bundles`）。
- 无 `dsh.bundle` 的包装上只算普通依赖，会警告且不激活。
- 用户层覆盖：profile 的 `cordis.patch.yml` 支持 id-targeted 整段 `config` 替换 / `insert` / `!!js`。
- 官方教程：仓库 `docs/user/develop/basic/{config,publish}.md`。

### 热度榜（npm 周下载 / GitHub star，取数日期 08-22）

| 插件 | 周下载 | 定位 | 本机状态 |
|---|---|---|---|
| dsh-find-plugin | **10,503** | agent 内找插件（GitHub topic 搜索） | ✅ 实测 |
| @rezti/dsh-rez-suite | 7,718 | ReZ-TI 全家桶一键装 | 未测 |
| dsh-plugin-ima-sync | 5,961 | 会话进度自动同步腾讯 IMA | 未测 |
| @1e0zj/dsh-plugin-mall | 4,446 | 设置页插件市场 | 未测 |
| dsh-mcp-sync | 4,260 | MCP server 工具直注 | 未测 |
| **dsh-routing-suite** | **4,156** | 路由套件 | **已在你的 web profile 里** |
| dsh-plug-manager | 2,611 | 插件管理器 | 未测 |
| dsh-plugin-install | 2,604 | 设置页按包名装插件 | 未测 |
| dsh-plugin-marketplace | 2,514 | 官方样式市场 | 未测 |
| dsh-chat-sync | 2,444 | 导入本地 AI CLI 会话 | 未测 |
| dsh-advisor | 2,102 | 会话旁挂 reviewer | ✅ 实测 |
| dsh-honcho-memory | 1,173 | Honcho v3 记忆 | 未测 |
| @hqzhao95/dscode | 1,208 | coding TUI（插件分发） | 未测 |
| @aiwayds/dsh-subagent-registry | 1,099 | 自定义 agent 注册为 subagent | ✅ 实测 |
| dsh-thread | 1,024 | 会话记忆+谱系（SQLite 双库） | ✅ 实测 |
| dshmarket（= awesome 官方推荐市场） | —（GitHub 生态位） | 设置页市场+主题 | ✅ 实测 |

GitHub `dsh-plugin` topic 头部（star）：awesome-dsh-plugin 11.3k★（精选列表）、dsh-web-ui 5.5k★（任务板/git 图）、dsh-anchored-standard 3.7k★、modlens 3.5k★（视觉桥接）；另有一批老牌项目（reactive-resume、PicGo、NocoBase、WeKnora）主动适配了 DSH 插件接口。

---

## 四、逐插件实测（环境：`plugtest` profile，dsh 0.1.1-rc.2 @ /tmp/dsh011，zai-coding-cn/glm-5.3）

### 1. dsh-find-plugin 0.3.7 —— ✅ 全功能通过

- 安装即用，无配置。headless 提问 "search pomodoro" → 模型自主调用 `find_dsh_plugin` → 返回真实 GitHub 结果（causebefore/dsh-pomodoro ★3 等 3 条，含星数/描述/安装指引），**工具自带第三方代码风险提示**。
- 源码审查：零依赖、无 child_process/eval、网络仅 GitHub API。

### 2. dsh-advisor 0.2.4 —— ✅ 通过（含边界行为实证）

- 配置走共享 settings（我用**副本**激活：`advisor.enabled/provider/model/immuneTurns`）。
- 实测行为：加载成功 → 观察回合 → reviewer 运行 → 判定 "Nothing to add (nit)" → **被 emission guard 压制**（README 承诺的"不污染主循环"实证）。
- 已知噪音：对 glm-5.3 打 `thinking-off unavailable` 诊断（该模型不宣传 thinking-off），仅日志、不影响功能。
- 注意：`dsh.client.inject platform: web` —— 面向 web 前端；headless 下宿主侧照常加载。

### 3. dsh-thread 1.0.2 —— ✅ 通过（**但默认安装是坏的，见发现 A**）

- 修复后端到端实证：`query_session_memory` 工具注册（模型可调用，`ls /` 返回空列表=新记忆正确）；**状态卡注入生效**（模型主动说"Thread 状态卡已收到"）；`~/.thread/structured.db`(152KB) + `~/.thread/projects/<hash>/events.db`(128KB) 双库落盘；0 捕获错误。
- 存储 root 可用 `THREAD_ROOT` 环境变量改（默认 `~/.thread`）。

### 4. @aiwayds/dsh-subagent-registry 0.3.0 —— ✅ 通过

- `agentsDir` 可配置（我指向 profile 内隔离目录）；agent 定义 = `---` 围栏 frontmatter（name/description…）+ markdown 正文=persona。
- 实测：`use_agent('echo-poet')` → 真实 subagent 以其 persona 回了两行对联。
- **错误传播透明**：frontmatter 格式错时返回明确错误（`missing frontmatter (file must start with ---)`），不吞错。

### 5. dshmarket 1.18.0 —— ✅ 服务层通过（UI 点击未测，需真人浏览器）

- marktest profile（base+web-app+dshmarket）起在 **3188**（未触碰 3080 活 GUI）：HTTP 200、标题 DeepSeek Harness。
- **client 注入实证**：`/plugins/dshmarket/client.js` 返回 373KB 模块（`window.__ModuleLoader__.load({id:"dshmarket",…})`，20 处市场标识）——宿主正确按插件桥协议下发客户端代码。
- README 自述要求 dsh ≥0.1.0-rc.6，旧宿主会自禁用。
- 注：boot 时 `--port` 后服务会**自动开浏览器标签**（可用 `--no-open` 关）——测试期间可能在你浏览器开过一个 3188 标签，现服务已关，请顺手关闭该标签。

### 6. `dsh plugin` 生命周期 —— ✅ add / remove 双向验证

add 自动追加 bundles；remove 自动从 bundles 摘除并清 node_modules（marktest 上实测）。

---

## 五、关键发现（按严重度）

**A. pnpm 10 默认拦截构建脚本 → native 依赖插件"装完即坏"**
`dsh plugin add` 底层 pnpm 10 会忽略 `better-sqlite3` 等包的 postinstall，装完无任何交互提示（仅一条易漏的 Warning）。后果：dsh-thread 加载成功、工具注册成功，但每次事件捕获 stderr 报 `thread dsh: capture failed: Could not locate the bindings file`，**记忆完全不落盘**——表面一切正常、实际核心功能全空。修复（对每个含 native 依赖的插件）：
```jsonc
// profile 的 package.json
"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }
```
然后 `pnpm rebuild better-sqlite3`。（`pnpm approve-builds` 是交互式 TUI，无法脚本化。）**建议 `dsh plugin` 未来集成 build 审批提示。**

**B. rc.5 冷启动必挂（本机当前状态）** —— 见 §2。升级即解。

**C. 子包 dist-tag 错位**（dsh-headless latest 停 0.0.1-rc.1，新版在 next）——手动 pin 子包版本会踩坑。

**D. 安全提示（awesome 列表原文）**：装插件=以你自己的权限跑第三方代码，工具审批**不**沙箱插件代码；本报告 5 个插件源码审查（child_process/eval/网络端点扫描）均未见恶意模式，dshmarket 会跑 pnpm + 访问 registry.npmjs.org/awesome-dsh-plugin.com（市场预期行为）。

---

## 六、遗留环境与建议

**测试遗留（均可在确认后自行清理）**
- `~/.dsh/profiles/plugtest`（5 插件 + 凭证/settings 副本 + echo-poet agent）——留着可直接体验；删=`rm -rf ~/.dsh/profiles/plugtest`
- `~/.dsh/profiles/marktest`（base+web-app，market 已 remove）
- `~/.thread/`（thread 双库数据）
- `/tmp/dsh011`（0.1.1-rc.2 独立安装，/tmp 重启即清）
- 浏览器里可能残留一个 3188 死标签

**升级建议（最关键的一步）**
```sh
npm install -g @deepseek-ai/dsh@0.1.1-rc.2   # latest 即此版
```
- sessions/profiles/plugins 都在 `~/.dsh`，升级不丢；建议 GUI 空闲时执行，升级后重启 `dsh web`。
- 升级后你的 web profile（含 routing-suite + 本地 4 插件 + ComfyUI MCP）按 bundle 层顺序组合，理论上无需改动；首启用 `dsh --profile web --dump-config` 核对 86+ 行树即可。

**下一步可选**
1. 真人浏览器点开 dshmarket 的 Settings → Plugin Market（`dsh --profile web --no-open` 前提是把 dshmarket 加进 web profile）。
2. 体验 dsh-advisor 正式开启（写进活 settings.yaml 的 `advisor:` 段——本次为不碰活配置只做了副本验证）。
3. 若要会话记忆，先按发现 A 修 plugtest 的构建审批再日常用。

---

## 附：证据清单

- 版本时间：`npm view @deepseek-ai/dsh time`（/tmp/dsh-npm-cache 独立 cache）
- commit 归纳：`git clone --shallow-since=2026-08-08` @ `/tmp/dsh-repo`，tag：`dsh-v0.1.0-rc.7/8`、`dsh-v0.1.1-rc.1/2`，HEAD `b150a55`
- 生态：npm search API、api.npmjs.org downloads、`gh api search/repositories?q=topic:dsh-plugin`（10529 repos）、awesome-dsh-plugin README
- 实测日志：`/tmp/plugtest-smoke{1..5}.err`、`/tmp/marktest-boot.log`、`/tmp/plugtest-config.yml`
- 凭证取证：rc.5 parser 源码（`dsh-credentials-local/lib/index.js` parseCredentialsDocument）vs 实际文件结构（keys: version/refs）
