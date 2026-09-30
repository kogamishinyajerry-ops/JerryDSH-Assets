# DSH 插件生态纵深评测报告（Round 4）

**日期**：2026-08-22 深夜 · 续 [REPORT.md](01-updates-and-top-plugins.md) / [VISION.md](02-vision-deep-dive.md) / [CAPABILITY.md](03-capability-plugins.md)
**环境**：dsh 0.1.1-rc.2 · 隔离 profiles：`extweb`（chicheng 双插件 @3190）/ `exthead`（dsh-undo headless）
**本轮定位**：awesome 列表 20 分类全景扫描 + 跨分类抽样实测（会话管理/通知推送/定时自动化/开发者体验）

---

## 一、生态全景（awesome-dsh-plugin，2018 行，2026-08-22 快照）

| 分类 | 规模感 | 质量观察 |
|---|---|---|
| UI Enhancements | 最拥挤（280+ 行） | 同质化高：任务板/折叠/侧栏大量撞车 |
| Usage & Billing | 60+ 行 | 绝大多数只接 DeepSeek 官方 API；**对 GLM/Zhipu/第三方计费覆盖弱**——你的多 provider 环境痛点 |
| Themes | 75 行 | 纯外观 |
| Sessions & Messages | 125 行 | **质量高地**：undo/redo、fork 图谱、record&replay、会话恢复 |
| Memory | 100 行 | 与 Round1 thread/honcho 互补；EverOS/MemOS 等独立产品形态 |
| Tools & Capabilities | 230 行 | computer-use/多目录/桥接器，实质性强 |
| Vision & Multimodal | 70 行 | Round2 已深测 |
| Voice & Audio | 30 行 | MiniMax TTS 系居多 |
| Skills | 75 行 | 预置 skill 包 |
| Workflow & Automation | 110 行 | cron/kanban/verification-gate/对抗评审，**工程质量区** |
| Git & Code Review | 48 条 | 密度最高的工程区之一：diff 评审/worktree/CI |
| Notifications | 95 行 | 微信/飞书/ntfy/Server酱桥接 + 本机通知 |
| Dev & Runtime | 165 行 | 脚手架/热更/打包工具链 |
| Security & Permissions | 70 行 | 文本消毒/权限策略 |
| Remote & Mobile | 48 行 | 移动端修复/远程访问 |
| Plugin Markets | 55 行 | 5+ 家市场互相竞争（dshmarket 已实测） |
| Just for Fun | 115 行 | 桌宠/音效/壁纸 |

**生态级判断**：这不是"一堆玩具皮肤"——**会话管理 + Git评审 + 工作流门控 + 通知桥接**四个工程区的密度和质量已经构成真实生产力面。视觉（Round2）和能力插件（Round3）是两个已验证的能力高地。

## 二、本轮实测四件

### 1. chicheng-push 0.1.0 —— 多渠道推送网关 ✅ 公网 E2E 全绿

- **形态**：web profile 插件（`inject=["webServer","webRuntime"]`），零依赖
- **面**：15 通道（Server酱/PushPlus/Bark/钉钉/企业微信/Telegram/飞书/ntfy/PushDeer/Gotify/webhook/邮件…），HTTP API `/push/api/{list,types,save,remove,toggle,test,send}`，同时暴露 `pushNotifier` cordis 服务给**其他插件**复用（cron 就复用它）
- **E2E**：配 ntfy 沙盒通道 → `send` → 订阅流真实收到完整消息（title+content+priority 全对）✅
- **注意**：渠道持久化在 `$DSH_HOME/push/channels.json`，boot 时加载一次，**外部改文件需重启**（API save 是正确路径）；配置走 UI 或 API，不接受 patch 注入
- **价值**：通知是所有自动化插件的"出口"，它是当前生态里最干净的统一出口

### 2. chicheng-cron 0.1.1 —— 会话外定时自动化 ✅ E2E 全绿

- **形态**：同 web profile，零依赖；侧边栏「定时任务」UI（本次未在浏览器点）
- **面**：5 种任务类型（shell/python/node/**skill**/**agent**——后两种直接跑 DSH 自己的 skill 和 headless agent），cron 表达式或 everySeconds 间隔；运行历史独立落盘（`$DSH_HOME/cron/runs/<id>/output.txt`）
- **E2E**：建 `* * * * *` shell 任务 → 手动 `runNow` 触发 → exit 0，产物文件正确写入、运行记录完整 ✅（调度引擎本身由 reschedule() 常驻驱动，等 1 分钟的自然触发未等——手动触发已证明执行链）
- **复用**：`pushEnabled`+`pushChannel` 直接走 chicheng-push 出口（同作者生态内闭环）
- **坑**：cron 表达式是**最小分钟粒度**，没有秒级

### 3. dsh-undo 0.2.0 —— 会话消息回滚 ✅ 加载+机制实证（E2E 需 GUI）

- **澄清**：README 里宣传的 "shadow-Git 文件快照" 是 `packages/bundle-rollback` 分支形态；**npm 发的 dsh-undo@0.2.0 是 `/undo`+`/redo` 会话消息回滚**——纯 append-only marker 遮蔽，不动文件系统
- **设计质量（源码实证）**：undo 范围计算正确（尾随用户消息只遮蔽自己；助手回复整轮遮蔽，对齐 opencode 语义）；**持久化不确定时有诚实文案**（"已应用到会话，但持久化尚未确认"）；redo 是 LIFO 栈、进程内不持久——browser-undo 语义
- **E2E 限制**：斜杠命令要真实会话交互，headless 一次性任务不便注入 → 标注"加载✓+命令注册✓+domain 源码✓，交互 E2E 未做"
- **相关高价值未测**：同区还有 fork 图谱（chouyong/dsh-fork-graph）、record&replay（azure5100/huahua）、会话恢复（Coprexist/dsh-session-recovery）

### 4. create-dsh-plugin 0.1.1 —— 插件脚手架 △ 模板优秀、CLI 有交互缺陷

- **交互缺陷（实测）**：非 TTY 环境下 clack 提问循环读不到 stdin（管道喂 `\n`、pty 驱动均无效）——CI/自动化场景不可用；人工交互终端里正常
- **模板质量（解包 tarball 实证，比 CLI 更能说明问题）**：tool/events/webui 三模板，`{{PKG_NAME}}` 占位符工程化完整。tool 模板**注释里埋了 5 条实战坑**：
  1. `@deepseek-ai/dsh-tools` 的 npm `latest` tag 是过期 0.0.1-rc.1——**就是我 Round1 实测发现的 dist-tag 错位坑**，模板直接钉死 `next`
  2. `ctx.tools.register()` 是 effect、自动挂 fiber、卸载自动反注册
  3. 加载顺序=服务依赖（inject），永远不是文件顺序
  4. 纯 ESM，cordis 只作类型源
  5. object output schema 必须显式 `additionalProperties`
- **评分**：模板 ★★★★（新手避坑密度极高），CLI 交互 ★★（非 TTY 死）

## 三、生态级三个判断

1. **能力面 > 修饰面**：20 分类里真正"换能力"的（会话/VFS/浏览器/MCP/视觉/工作流门控）约 40%，且质量中位数不低——工程区（Git评审/Workflow/Automation）尤其扎实。
2. **同作者集群效应**：534119219（chicheng 系：push/cron/stats）、JohnXu22786（github-mcp/worktree-mgr/对抗评审）、chouyong（fork 三件套）——**头部贡献者的插件互相兼容、质量可外推**，是选品捷径。
3. **风险面收敛良好**：本轮+前三轮共 15 个第三方插件的源码审查，恶意模式 0 命中；但要记住 awesome 列表的原始警告——**装插件=以你的权限跑第三方代码**，批次量产后不可能逐个审，生产环境只装看过的。

## 四、四轮累计

| 轮 | 主题 | 实测数 | 全绿 | 报告 |
|---|---|---|---|---|
| 1 | 更新时间线+头部 5 插件 | 5 | 5 | REPORT.md |
| 2 | 视觉双路线 | 2 | 2 | VISION.md |
| 3 | 能力四件套 | 4 | 3（honcho 无后端半绿） | CAPABILITY.md |
| 4 | 生态纵深（会话/推送/自动化/脚手架） | 4 | 3 | 本文件 |
| | **合计** | **15** | **13** | |

## 五、遗留环境

- profiles：`extweb`/`exthead`（连同此前 plugtest/marktest/mcptest/powertest/vfstest/visiontest——8 个测试 profile 全在 `~/.dsh/profiles/`，不要就批量删）
- 测试产生的 push/cron 数据已清净（channels.json、cron store、runs 全删）；ntfy 沙盒 topic 是一次性随机名，无需处理
- 3080 活 GUI 全程无恙

## 六、下一步可选

- **横向补全**：Git & Code Review 区（48 条，密度最高未实测分类）——对抗评审（JohnXu22786/adversarial-review）或 git-worktree 系列值得下一轮
- **日用集成**：把 chicheng-push + chicheng-cron 装进 web profile（任务跑完推手机）；dsh-undo 装进 web profile（后悔药）
- **收手**：三轮 15 插件已经构成完整的生态评测样本，再测边际收益递减——你说了算
