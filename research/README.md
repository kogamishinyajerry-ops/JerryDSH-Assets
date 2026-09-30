# research/ — DSH 技术研究分析

DSH 的技术面研究沉淀：版本更新、机制剖析、生态评测。全部内容基于本机实测（dsh 0.1.1-rc.2），证据链在各文件附录。

## 阅读顺序

| # | 文件 | 内容 | 何时读 |
|---|---|---|---|
| 01 | [01-updates-and-top-plugins.md](01-updates-and-top-plugins.md) | 更新时间线（rc.5→0.1.1-rc.2 逐版本变更）+ 生态热度榜 + 头部 5 插件实测 + **rc.5 冷启动崩溃根因** | 升级 dsh 前必读 |
| 02 | [02-vision-deep-dive.md](02-vision-deep-dive.md) | 视觉插件双路线深测：全本地 macOS Vision vs 外挂 VLM 引擎 | 想让文本模型看图时 |
| 03 | [03-capability-plugins.md](03-capability-plugins.md) | 能力四件套：MCP 管理 / 记忆 / 浏览器控制 / 统一 VFS | 扩能力面时 |
| 04 | [04-ecosystem-survey.md](04-ecosystem-survey.md) | awesome 列表 20 分类全景 + 生态级三判断 + 推送/定时/撤销/脚手架实测 | 了解生态全貌时 |
| 05 | [05-mechanics-notes.md](05-mechanics-notes.md) | **机制研究**：插件架构、patch 层、凭证格式、dist-tag 陷阱、pnpm 构建坑、web-only 模式 | 写/装/调试插件前必读 |
| 06 | [06-update-tracker.md](06-update-tracker.md) | **常驻版本追踪**：三步核查法 + feat/fix 归纳法 + rc.5→rc.2 基线明细（当前：rc.2 后无新版） | "有没有新版/该不该升级"时 |
| 07 | [07-session-foundation.md](07-session-foundation.md) | **会话底座**：JSONL/SQLite 持久化布局、投影缓存、compaction 管线、session-query；thread/undo/会话类插件判据 | 写会话类插件/查会话机制时 |
| 08 | [08-security-model.md](08-security-model.md) | **安全模型**：进程沙箱/fs 围栏/审批流/预设/MCP 边界/插件权限 + 生产环境配置矩阵 | 决定生产该装什么时 |
| 09 | [09-agent-loop-core.md](09-agent-loop-core.md) | **Agent 循环核心**：轮次/步骤骨架、inbox 投递三通道、工具五段流水线、取消/拦截、所有权 | 理解"一次提示词怎么变成事件流"时 |
| 10 | [10-llm-assembly-streaming.md](10-llm-assembly-streaming.md) | **LLM 装配与流式**：系统提示词组装、KV cache 纪律、chunk 流/BlockAssembler、适配器八约定、重试三层、token 计量 | 接新模型/调提示词/直接调 LLM 时 |
| 11 | [11-subagent-system.md](11-subagent-system.md) | **Subagent 体系**：一次性 run vs 可继续 Activation、提供方族（spawn/fork/acp/codex/claude）、鉴权与枚举、Agent Teams | 写/评多 agent 委派类插件时 |
| 12 | [12-feishu8-intranet-playbook.md](12-feishu8-intranet-playbook.md) | **飞书 8.0 对标**：内网离线复刻可行性矩阵、造轮子 vs 开源决策、内网硬件四档方案、P0-P2 落地路线 | 规划内网团队协作平台时 |
| — | [routing-suite-eval/](routing-suite-eval/) | dsh-routing-suite 对比评测（43 例数据集，plugin-auto 78.4% vs 基线）+ 完整可复跑代码 | 评估/改进路由时 |
| 🌏 | [dsh-explained.html](dsh-explained.html) | **科普版报告**（自包含单文件，浏览器直接打开）：01-11 的人话版，中学生可读 | 给不看技术报告的人介绍 DSH 时 |
| 🗺 | [dsh-map.architecture.html](dsh-map.architecture.html) | **全景机制地图**（archify 校验图，可交互/可导出）：11 节点把 01-11 穿成一张图；规格源 [dsh-map.architecture.json](dsh-map.architecture.json) | 想一眼看全 DSH 身体时 |

## 测试环境索引（~/.dsh/profiles/）

| profile | 装了什么 | 处置建议 |
|---|---|---|
| `plugtest` | find-plugin / advisor / thread / subagent-registry / dshmarket（headless） | 保留，可直接 `dsh --profile plugtest "..."` 体验 |
| `visiontest` | free-vision-skill / modlens（headless） | 保留，视觉体验入口 |
| `vfstest` | mirage-dsh（VFS 接管 fs/bash） | 保留，体验"虚拟文件世界" |
| `extweb` | chicheng-push / chicheng-cron（web 型，3190 起过） | 保留，自动化体验入口 |
| `powertest` | browser-control / honcho（mcp-sync 已禁用） | 可删 |
| `mcptest` / `marktest` / `exthead` | 单插件验证环境 | 可删 |

> 清理：`rm -rf ~/.dsh/profiles/<name>` 即彻底删除（profile 是自包含目录）。
