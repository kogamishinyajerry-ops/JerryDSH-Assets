# 11 · DSH Subagent 体系：委派 · 提供方 · 可继续子代理 · Agent Teams

> 多 agent 委派的完整机制：一次性 run 与可继续 Activation 两类能力、四种进程内/外部提供方、继续执行管理器的所有权图、持久化枚举，以及实验性 Agent Teams。
> 承 09（子 agent 是普通 agent + 专用组合）与 07（谱系/深度持久化）。结论分级 **[实测]/[源码]/[推断]** 同前。
> 证据：`docs/subsystems/{subagent,agent-team}.zh.md` + `packages/subagent/*` + rc.7/rc.8 feat 记录（06）。本会话的 subagent 工具面（list_agents/send_message/interrupt_agent 的文档化语义）与官方词汇逐条对照。

## 一、结论速览

1. **两类能力、两种发现**：**一次性 run**（`SubagentProvider.start()`，能力 = 静态 `SubagentCapabilities` flags，服务在 start 前校验、缺能力即 `UNSUPPORTED_CAPABILITY` 拒绝——fail loud 无静默降级）；**可继续子 agent**（能力 = `prepareContinuable` 方法**存在即能力**，由继续执行管理器而非提供方组合子代理）。**[源码]**
2. **可继续子 agent = 持久 Session + 至多一个进程内 Activation**。Activation 不是请求/Task：可跑多个 FIFO 轮次，后代运行期间保持驻留。**Agent inbox 是唯一的队列**——继续执行层不发明第二条投递路由。**[源码]**
3. **提供方只是传输层**：spawn（新开，无种子）/ fork（注入父日志**平衡已完成轮次前缀**）/ acp / codex / claude-code / dsh-sdk 多提供方共存；`inheritsParentContext` 只描述对话种子注入（fork=true），**不暗示继承工具、服务或权限**。**[源码]**
4. **深度与谱系持久化**：`delegationDepth` 存 header（冷恢复不可降深）+ 运行时 `AgentOptions.subagentDepth`（大者权威）；start 拒绝超安全域或超 `maxDepth` 的派生深度。**[源码]**（07 §二 header 字表的执行端）
5. **鉴权走"确切在线直接父级"**：followup/interrupt 的权限来自 `parentSession` 记录的直系谱系 + 在线 Agent 对象；`MessageSource`/senderSessionId 只是归因**不授予任何权限**。**[源码]**
6. **枚举是投影加速的三级阶梯**：活 child 走注册表水位缓存（零日志读）→ 冷 child 走 projcache checkpoint（07 §四）→ 权威重折（一次 persistence.inspect）；`subagent/descriptor` last-wins 折叠、坏载荷折叠为 null 哨兵。**[源码]**（07 投影缓存实测名单里的 `identity` 单元就是为它服务的）
7. **Agent Teams（实验性）= Root Session 上的可回放协作状态机**：roster/mailbox/任务 DAG 全部是 Root 会话日志里的全量快照事件，`foldTeam()` 回放；`writeScopes` 是**提示性路径前缀不是锁**。**[源码]**

## 二、一次性 run：start 路径

- **请求四级可选能力**（都要 flag 匹配，否则启动即拒）：`outputSchema`（object-rooted 受限 JSON Schema 子集，子成功返回 `structured`）、`maxDepth`（绝对深度帽）、`toolFilter`（子创建窗口内 scoped `tools.restrict()`——**可见性即权限**：从子提示词消失且拒执行，未知名大声校验）、`persona`（scoped `deployment:persona` 段遮蔽部署 persona，仅对该子生效）。**[源码]**
- **取消通道唯一**：调用方 signal 就绪前后都是它——发布前拒（清资源）、发布后取消剩余轮次工作。**[源码]**
- **run 生命周期**：服务铸 `runId`、快照 localAgent、emit `subagent/start`；rejection=未发布资源已清且无事件对；发布后失败经已 emit 的事件对收尾。**[源码]**

## 三、可继续子 agent 与继续执行管理器

- **Activation 三态推导而非维护**：`running`（有活跃准入/轮次/唤醒中）→ `waiting`（完全停稳但仍有未 dispose 的子 Activation）→ `settled`（自己停稳且全部子级 dispose → 释放 AgentHandle、移除 Activation）。管理器从"Agent 完全停稳 + ownedChildren 集合"推导，不建第二套状态机。**[源码]**
- **followup 路由三行表**：running→同 Activation 入队；waiting→唤醒同 Activation；无 Activation→**冷恢复**（折叠通用描述符 → activation-owner 作用域 `ctx.agents.resume()` → 补投等待轮次）。冷恢复不经提供方。**[源码]**
- **调用方 signal 只管到 inbox 接受为止**：此后管理器独立掌管——之后的调用方取消既不取消已接受轮次也不 dispose 子代理；该 seam 不暴露 steering。**[源码+实测对照]**（本会话 send_message 语义原文："message waits until its current turn finishes, so it cannot redirect work already underway"——逐字吻合）
- **interrupt 语义**：唯一公开停止操作；同步鉴权 → 对在线目标 `Agent.cancel(cause, {keepInbox:true})` → 不等停稳即返回；未领取 inbox 工作与已发布后代不受影响；driver idle 后一次唤醒恢复 FIFO。目标不存在/一次性/已结算 = 合法 no-op。**[源码+实测对照]**（interrupt_agent 语义原文："queued messages stay parked until a later send_message"——吻合）
- **两种上报 + 一种记账**（来源 kind 刻意区分，transcript 绝不把记账算成 child 写的话）：
  - `reportFrom()`：child 主动向持久化直系 parent 报告（接收方由管理器推导、调用方不能指定）；`quiet`（inject 不唤醒）/`next-step`（steer 唤醒或入最近步边界）两投递模式；不结束 child 轮次。
  - **结算通知无条件**：每个拿到过 id 的 child 结算时，管理器向 parent 投递带最终 assistant 内容的 `subagent-settled` 通知（发生在所有权释放前）；谱系在拆则不唤醒送达。
- **描述符（`subagent/descriptor`）**：会话支撑 subagent 的持久身份（版本化、模式判别）；continuable 快照 provider/model/persona/toolFilter 供冷恢复，**不快照可合并扩展的 AgentOptions 整体**（无关扩展值不破坏继续执行）；log-only、跨压缩保留；省略 depth（header 是单调下界）与 outputSchema（结果约定非身份）。**[源码]**

## 四、持久化枚举（listChildren/listDescendants）

- 语料 = `ctx.sessions.list()` 实时优先合并 `ctx.sessionPersistence.list()`；候选 = header 带 `origin:'subagent'` 的直接子——**origin 只管枚举分类，不证明可恢复/已授权**。**[源码]**
- 身份三级阶梯（§一.6）；产出 `child`（mode+activity）与 diagnostic（`corrupt`/`unavailable`，坏 sibling 不隐藏健康 child）；`ready` 是模型面向工具（tool-subagent-control 的 `/list-agents`）把仅存存储的 child 命名为"可恢复"的状态词。**[源码+实测对照]**（本会话 list_agents 语义原文："ready means it exists only in storage — resumable, not terminal"——逐字吻合）
- 前置依赖：缺 `ctx.sessionProjections` → `SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE`（读取前就抛，零 child 也确定性失败）；缺持久化→退化为仅存活枚举不报错。**[源码]**

## 五、提供方族与 rc.7/rc.8 演进

| 提供方 | 语境 | 要点 |
|---|---|---|
| spawn | 进程内 | 新子，无种子；`inheritsParentContext:false` |
| fork | 进程内 | 父日志平衡前缀种子（seq 0 连续、无损、已配平——invariants 回放可接受） |
| acp | 外部 | Agent Client Protocol；一次性机器审批决策（08 §四 ACP 桥） |
| codex / claude-code | 外部产品 | rc.7 起非交互权限模式 + 可直接安装；rc.8 命名 provider 实例（同一产品多个具名实例）**[源码+06]** |
| dsh-sdk | 进程内嵌 | 子会话 id `session-<无连字符uuid>`（07 §二 id 形态表） |

**[推断]** 外部产品提供方（codex/claude-code）把"权限模式"参数化成非交互预设——意味着委派链上的审批语义可以逐提供方固定（如子 Codex 永远 `never`），这与其官方 CLI 的权限旗标对齐；评测 subagent 类插件时应验证它们不会绕过该固定。

## 六、Agent Teams（实验性）

- **TeamId = 品牌化的 Root SessionId**；teammate 身份永远是 Session id，name 是不可变展示标签。**[源码]**
- **持久 mailbox = queued − delivered**：先存完整 queued 消息，target 的 inbox 条目或用户消息持久化后才写独立 ack 事件——恢复语义由差集构成；target 侧以 `TeamMessageSource`（含 messageId+sender）跨 inbox/历史折叠做去重键。**[源码]**
- **任务 DAG**：全量快照事件 + `revision` CAS；`blockedBy` 必须指向未删除任务且无环；`writeScopes` 规范化路径前缀**提示不锁**（view 层给重叠警告）。**[源码]**
- **`foldTeam()` 按 TeamId 选记录**：fork 继承的祖先 Team 事件保留原 id，绝不进新 Root 状态——谱系隔离免费获得。**[源码]**
- **[推断]** Teams = "把 subagent 的成对委派升级成共享板"，底层复用可继续 Activation + inject/steer 投递 + projection；rc.8 的 durable runtime feat 即其落地。生产采用前注意"实验性"标签与显式启用门槛。

## 七、对插件线的判据

| 判据 | 内容 | 等级 |
|---|---|---|
| 委派入口 | 一次性 → `start()`（能力 flag 先行）；要"事后追加指令/报告/中断" → 必须 continuable 提供方（方法存在即能力） | [源码] |
| 队列真相 | 只有一个 inbox；任何"子代理消息队列"插件都在复刻 Agent inbox——判价值看它是否补了 inbox 之外的编排（如 Teams 的共享板） | [源码+推断] |
| 谱系判别 | 用 header（origin/parentSession/delegationDepth）+ descriptor 折叠，不猜 id 形态（07） | [源码] |
| 权限边界 | senderSessionId/source 无授权；直接父级在线对象才是凭据——"假冒上报"在类型层就不可达 | [源码] |
| 枚举性能 | 大量子代理列表场景依赖 projection 注册表 + projcache（07 §四）；无注册表的组合 listChildren 直接抛——插件依赖检查要在加载时做 | [源码] |
| 隔离语义 | toolFilter 是可见性非沙箱（09 §四）；真隔离走 08 的进程边界 | [源码] |
| 与 01 实测的衔接 | @aiwayds/dsh-subagent-registry 的 use_agent 走的是注册面（agentsDir+persona 文件），不在本 seam 的提供方表内——它是"人肉提供方目录"而非传输层 | [实测+推断] |

## 附：证据清单

- `docs/subsystems/subagent.zh.md`：SubagentCapabilities（11-33）、SubagentStartRequest（35-99）、可继续与 Activation（114-231：状态表/interrupt 权威/两种上报+结算记账）、ContinuableCreateSpec（243-281）、descriptor（283-285）、listChildren 三级阶梯（287-300）、SubagentProvider 契约（417-472）、进程内深度与种子（474-479）
- `docs/subsystems/agent-team.zh.md`：身份/roster/mailbox/任务 DAG/foldTeam（全文 183 行）
- `docs/architecture.zh.md` §能力 seam（"subagent 提供方在同一个接口后千差万别"）
- 06 §三：rc.7 subagent 四连 feat、rc.8 命名实例/durable Teams
- 实测对照：本会话工具文档（send_message/interrupt_agent/list_agents 的 parked/resumable/ready 语义）与官方文档逐字吻合
- 关联：07 §二（header 谱系字段）、07 §四（identity 投影单元）、08 §四（ACP 机器审批）、09 §五（composeFrom 同代组合）
