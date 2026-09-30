# DSH 能力型插件深测报告（Round 3）

**日期**：2026-08-22 深夜 · 续 [REPORT.md](01-updates-and-top-plugins.md) / [VISION.md](02-vision-deep-dive.md)
**环境**：dsh 0.1.1-rc.2 · 隔离 profiles：`powertest`（browser/honcho/mcp-sync）、`vfstest`（mirage）、`mcptest`（web 型 mcp-sync）· glm-5.3
**测试资产**：自建 stdio echo MCP server（/tmp/dsh-mcp-echo）、隔离 headless Chrome CDP :9222（**全新空 user-data-dir，未碰你的登录态**）、本地测试页 :8123

---

## 结果总表

| 插件 | 版本 | 安装/加载 | 端到端功能 | 实质性评分 | 建议 |
|---|---|---|---|---|---|
| dsh-mcp-sync | 0.7.0 | ✅（⚠ web-only） | ✅ 完整闭环 | ★★★★ | 装进 **web** profile；headless 别装（拖死 boot） |
| dsh-honcho-memory | 0.5.3 | ✅ | △ 无后端只到"失败透明" | ★★☆ | 无 Honcho 后端先别装 |
| dsh-browser-control | 0.1.0 | ✅ | ✅ 全绿 | ★★★★ | 装；用 launch 前想清楚登录态拷贝问题 |
| @struktoai/mirage-dsh | 0.0.1 | ✅ | ✅ VFS 全绿 | ★★★☆ | 尝鲜可玩，生产等版本成熟 |

## 1. dsh-mcp-sync 0.7.0 —— MCP 集中管理直注 ✅（带三个坑）

**功能闭环实测（web profile，mcptest @ :3189）**
- 自动扫描本机配置源：`~/.claude/claude_desktop_config.json` / `~/.cursor/mcp.json` / `~/.codex/config.toml`（mcp_servers）/ `~/.dsh/mcp.json` —— 本机扫到 **codex 源 4 个 server**（trigger、node_repl、codebase-memory-mcp、computer-use），**3 连接成功、发现 50 个工具**
- 自定义 server 完整闭环：注册 → `POST /api/dsh-mcp-sync/connect {name}` → 工具发现（返回 echo 的 JSON schema）→ `POST /call` → **`echo-mcp says: roundtrip-42`** ✅
- 管理 API 面丰富：health/stats/tools/connections/sync/reconnect/registry 全可用

**⚠ 发现 A（严重）：headless profile 装它会拖死整个 boot**
`export const inject = ["webServer"]` 硬依赖。headless 组合无 webServer 服务 → `dsh-mcp-sync: pending (waiting for service: webServer)` → **整个 profile 启动失败**（1 entry did not activate）。README 未标注 web-only。已实测复现+源码定位。

**⚠ 发现 B：配置文件名双轨，文档没说清**
- 自定义服务器注册表：`~/.dsh/mcp-registry.json`（`REGISTRY_FILE` 常量）
- 而 "dsh" 扫描源读的是：`~/.dsh/mcp.json`（`sources.js`）
两个名字不一致；我按直觉写 mcp.json 结果 sync 的 `dsh:0`。想被扫到写 mcp.json，想直接进注册表写 mcp-registry.json（测试后两者均已删净）。

**⚠ 发现 C：API 字段名不统一**
connect 端点收 `{"name":...}`（不是 server），call 端点收 `{"server","tool","args"}`（不是 arguments）——调用方容易踩。

**其他**：`computer-use` server 连接失败 `unsupported transport type: command`（npx 型定义的兼容缺口）；调用走 HTTP 端点时 `args` 默认 `{}` 不报错（静默空参）。

## 2. dsh-honcho-memory 0.5.3 —— 记忆插件，先有鸡才有蛋 △

- **README 顶部 IMPORTANT（诚实加分）**：本包**不是 Honcho 后端也不替你装**——必须先有 Honcho v3 服务（官方托管或自部署 Plastic Labs 栈），否则记忆不工作。
- 实测：插件加载 ✅、七个 memory_* 工具注册 ✅（memory_store/search/context/reason/profile/dream/status）、无后端时 `memory_status` 返回**透明错误**：`Honcho POST /v3/workspaces failed (404): Not Found`（不吞错、不装死）。
- 未做：部署 Honcho 后端超本轮范围（需 docker/托管账号）。**功能面未 E2E，评分只反映安装面。**
- 设计亮点：方向性视角（`deepseek -> user` 不混淆 peer）、整理工具默认 dry-run。

## 3. dsh-browser-control 0.1.0 —— CDP 浏览器控制 ✅ 全绿

**E2E（隔离 headless Chrome 151 @ CDP :9222，空 user-data-dir）**
1. `browser_status` → running:true, Chrome/151.0.7922.173 (Headless), Protocol 1.3 ✅
2. `browser_open http://127.0.0.1:8123/` → title "Mirage CDP Test Page"、body 预览正确、0 console/page/network 错误 ✅
3. `browser_eval document.getElementById('hdr').textContent` → 精确返回 `hello-from-local-page` ✅

**⚠ 隐私权衡（必须知道）**：`browser_launch` / `scripts/launch.sh` 会把你**日常 Chrome 的登录态文件（Cookies/Login Data/Local Storage/IndexedDB）只读拷贝到 `/tmp/chrome-e2e-profile`** 再起 CDP 实例——"复用登录态"的代价是登录态副本落在 /tmp。单向不回写、但任何本机进程可读。本次测试我**没有**用它。
Roadmap 尚无点击/填表；Playwright 后端在计划中。0.1.0 早期但核心链路扎实。

## 4. @struktoai/mirage-dsh 0.0.1 —— 统一虚拟文件系统 ✅

- **修正 Round 1 存疑**：mirage 有官方 dsh 适配（`typescript/packages/dsh/`，npm `@struktoai/mirage-dsh`）。
- 机制：接管 dsh 的 **fs/shell 两条能力缝**（patch 禁用 host 的 fs-sandbox/bash-sandbox/pwsh/tool-fs-search 行），S3/Slack/Redis/Gmail/Notion/Postgres 挂载点变成 agent 的文件世界；RAM 挂载零凭证。
- **E2E（vfstest，RAM mount @ /tmp, mode:exec）**：bash 工具 `echo mirage-ok > /tmp/m.txt && cat /tmp/m.txt` → `mirage-ok`；文件读取工具读 `/tmp/m.txt` → 内容一致 ✅。**dsh 的 bash/fs 工具确实跑在 VFS 上而非宿主磁盘**。
- 细节好评：read-only 权限模式下挂载 grant 自动收窄为只读；宿主 cwd 在 VFS 世界里不存在时正确忽略。
- 保留：0.0.1 早期；peer 依赖 pin 的是旧版 dsh-fs/dsh-shell（0.0.1-rc.x），当前组合实测无碍；真实资源挂载（Slack/Redis）需各自凭证，未测。

---

## 遗留环境

- profiles：`powertest` / `vfstest` / `mcptest`（都在 ~/.dsh/profiles/，不要就删）
- /tmp：dsh-mcp-echo（echo server）、dsh-browser-page、dsh-browser-test-profile（重启自清）
- 测试进程全部已关（3189/8123/9222 均 0 监听）；临时 mcp.json/mcp-registry.json 已删；**3080 活 GUI 全程无恙**

## 日常启用建议（GUI 空闲时）

```sh
dsh plugin --profile web add dsh-mcp-sync dsh-browser-control   # 管理面板+浏览器控制
dsh web
```

- mcp-sync 首启会自动扫你的 codex/claude 配置——它自己的自定义注册表在 `~/.dsh/mcp-registry.json`
- browser-control 默认 9222：要么先自己起隔离 Chrome（像本报告），要么用 `browser_launch`（想清楚 /tmp 登录态副本）
- mirage-dsh 想 play：`dsh plugin --profile vfstest add @struktoai/mirage-dsh`（vfstest 已配好 RAM 挂载可直接 `dsh --profile vfstest "..."` 体验 VFS 世界）
- honcho-memory：等你有 Honcho 后端再装

## 三轮总览

| 轮次 | 主题 | 报告 |
|---|---|---|
| 1 | DSH 更新时间线 + 生态热度 + 5 个头部插件 | [REPORT.md](01-updates-and-top-plugins.md) |
| 2 | 视觉赛道深测（本地 Vision / 外挂 VLM 双路线） | [VISION.md](02-vision-deep-dive.md) |
| 3 | 能力型四件套（MCP 管理/记忆/浏览器/VFS） | 本文件 |

**累计实测 11 个第三方插件 + `dsh plugin` 生命周期，全部零事故、活环境零污染。**
