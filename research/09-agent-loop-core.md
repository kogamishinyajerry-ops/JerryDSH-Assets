# 09 · DSH Agent 循环核心：轮次 · 步骤 · 工具流水线 · 投递语义

> harness 的心脏：一次提示词如何变成事件流，工具如何被分发，取消/重试/拦截在哪一层生效。
> 承 07（会话日志是底座）向上到驱动层。结论分级 **[实测]/[源码]/[推断]** 同前。
> 证据：`docs/architecture.zh.md`（turn-flow）、`docs/subsystems/{core,session,tools}.zh.md` + `packages/core/{agent,agent-loop,session,tools}` 源码。本会话自身即跑在该循环上，行为可对照。

## 一、结论速览

1. **两级执行单元：轮次（turn）含零或多步（step），一步 = 一次模型请求 + 它调用的工具。** 轮次在领取输入前开、不再欠工作时关；步骤是模型请求的最小闭环。全部边界是**持久会话事件**而非内存状态。**[源码]**
2. **一条主干循环**：认领 inbox 输入 → 组装提示词+工具 schema → `agent/pre-step`（可拒绝/改写）→ `step/start` → 派生历史 → `agent/request` → `llm/stream` → chunk 流 → `assistant/message` → 工具五段流水线 → `step/end` → 有后续再下一步 → `agent/turn-stopping` → `turn/end`。**[源码]**
3. **投递三通道语义精确分工**：`followup`（排队整轮，唤醒）/ `steer`（塞进最近的步骤边界）/ `inject`（只入队不唤醒，模型可见上下文）。inbox 双列表 `next-turn`/`next-step` 是持久投影，全部变更走规范化 splice 事件。**[源码]**（本会话的 todo_write / send_message 等工具面与该词汇同名同域，工具名层面的实测对照）
4. **工具执行是"瀑布+单调 guard"五段流水线**，参数在入口一次性冻结、全程不可改写；pre 只能 allow/deny/**ask**，post 可替换 content 或 value（二选一）、可 block 转错误；guard 只能收窄不能放行——**权限单调性由类型系统保证**。**[源码]**
5. **轮次结束原因 7 值**（completed/aborted/blocked/error/max-tokens/interrupted+legacy），`interrupted` 只由崩溃恢复合成（07 已记）；**max-tokens 穿透优先**：轮内任一步截断，整轮即以 max-tokens 收尾。**[源码]**
6. **"模型可见即已记录"是运行时不变量**：抵达模型请求的一切必须能从日志重建（request/header 全量快照 + deriveMessages 纯函数投影），新增模型可见输入必须新增会话事件。**[源码]**
7. 取消语义分两层：**实时层** `AgentCancelCause`（user/parent/hook/disposed，Typed 区分）只活在内存 signal；**持久层** `turn/end` 只记粗粒度 `{kind:'aborted'}`——想知道"谁取消的"要另发事件，终态不承担额外含义。**[源码]**

## 二、轮次与步骤：事件骨架

官方 turn-flow 图（architecture.zh.md）**[源码]**：

```text
turn/start
  claim next-step 输入 + 一条排队消息
  组装提示词段落 + 工具 schema
  -> agent/pre-step                reject | enter(messages)
     首次领取被拒/改写为空 -> 关闭一个无步骤的轮次（尝试仍入日志）
     step/start
     entered messages 追加为 user/message
     从日志派生模型历史 deriveMessages()
     agent/request -> llm/stream -> assistant/chunk* -> assistant/message
     tool/call* -> tools/pre-execute -> tools/execute -> tools/post-execute -> tool/result*
     step/end
     工具还欠请求 / next-step 输入到达 -> 认领 -> 下一步
  -> agent/turn-stopping（serial，无 next()）
turn/end
```

要点展开：

- **无步骤轮次是合法记录**：pre-step 首拒 → `turn/start`+`turn/end` 中间无 `step/*`。日志完整性优先于"干净"外观。**[源码]**
- **步骤边界即工具并行调度点**：循环向注册表查每个待处理调用的模式——`parallel` 进滚动池、`exclusive` 独占成 ordering barrier。**[源码]**（[实测对照] 本会话并行 bash/read 与独占写文件的调度行为一致）
- **轮内注入有窗口纪律**：循环只在轮内进入 pre-step 批次时记录注入的 `user/message`；轮间可存在插件自有 log-only 事件（占 seq 不占轮次编号）。需要即时持久性屏障的生产方显式等 `ctx.sessions.flush()`；逐请求的持久检查点归 `dsh-session-checkpoint-policy`（turn 边界不等 flush）。**[源码]**
- **请求信封全量快照入日志**：`request/header { header: EpochHeader, reason }`——`EpochHeader` = 调用配置 + 适配器物化默认 + 渲染后系统提示词 + 工具 schema。初始/resume/变更各记一份全量，`foldRequestHeader` 取最新重建；路由容量（`request/context`）单独记、只在路由或容量变化时记，**不参与 header 相等比较**。**[源码]**
- **usage 与消息同乘**：`assistant/message.usage`（无独立 usage 记录）；token 记账优先读逐步 `assistant/chunk {type:'usage'}`，无分片则以消息 usage 为后备——失败尝试无 assistant 消息时其 usage 分片仍是持久记账。**[源码]**
- **截断流的前缀终结**：轮次中途取消时，已交付的 text/reasoning 前缀终结为 `assistant/message {interrupted: true}`，未分发工具调用不出现——"流了什么就留什么，没派发的调用不存在"。空 assistant 消息（max-tokens 截断无内容）记录用量但**不进派生历史**。**[源码]**

## 三、投递语义：inbox 是唯一的队列

- **双列表**：`next-turn`（整轮队列，followup 目标）与 `next-step`（步骤边界队列，steer 目标）；`inject` 的上下文进 inbox 不唤醒——"注入的上下文会留在 inbox，直到另一条消息将其唤醒"。**[源码]**
- **claim 语义**：一步领取"全部 next-step 输入 + 轮次边界上的一条 next-turn"，纯删除 splice 不发 discarded；循环另行逐条发 claimed。UI 整体队列消费方走持久 splice 重建，逐条跟踪方走 inserted/claimed/discarded 精确事件。**[源码]**
- **取消收敛与唤醒闩**：取消后到达的唤醒输入排队等中止活动收敛到 idle 再跑；`disposed` 取消则永久停放；idle 时的唤醒即使消息先被清掉也会开轮次边界（cancel-convergence wake latch）。**[源码]**
- **steer 的落点**：idle 驱动器→开新轮；运行中→下一个步骤边界；被拒步骤把 steering 留在 inbox 到下次唤醒。**[源码]**（[推断] 本会话开头的审批策略切换通知若以 steering 到达即按此落点，无法从会话内部确证）
- **pre-step 拦截**：`agent/pre-step` 是请求推导前唯一串行监听器链，可 reject（不开步骤）或 enter（改写消息批次）；`agent/request-error` 在失败步骤关闭后、轮次关闭前运行，返回 `{kind:'retry'}` 触发重试（配合 10 §重试）。**[源码]**
- **维护任务通道**：`runMaintenance()` 在真 idle 相位跑非轮次任务（compaction 的 `compactNow` 即此，07 §五）；状态保持 `idle`，`whenIdle()` 跟随其后。**[源码]**

## 四、工具流水线：五段瀑布 + 单调 guard

`ctx.tools.execute()` 的完整链条 **[源码]**：

```text
入参物化（参数 deep-freeze、分配 token、拒非 JSON）
  -> tools/pre-execute   允许重排的 allow/deny/ask 瀑布（ask 需审批 allowed-once 才继续）
  -> 已注册 guard        单调终审：返回 reason 只能拒，undefined 保持；无 allow 结果
  -> tools/execute       环绕分发包装层（可换 signal、可短路；Code Mode 子分发带 parent token）
  -> 工具函数体          拿到 ToolRunContext（deferContext / concludeTurn）
  -> tools/post-execute  accept(可换 content 或 value 二选一 + additionalContexts) | block(转错误)
  -> finalizeContent     定义拥有的可选最终内容回调（恰好一次）
  -> tools/result        冻结的权威结果，观察者只能看不能改
```

承重细节：

- **参数不可改写是铁律**：历史、审计、UI、执行必须一致——pre/post 都拿不到改写参数的口子；要"改输入"只能在 pre-step 层改写消息（§三）。**[源码]**
- **调度模式由工具声明**：`parallel`/`exclusive`（§二）；Code Mode 下模型直呼原生工具名（无 parent token）在策略管线前就拒 `UNKNOWN_TOOL`。**[源码]**
- **组合工具的上下文转运**：`deferContext()` 把上下文挂到本执行自己的结果上，外层调用未结束时不会注入——复合工具转发嵌套分发上下文的通道。**[源码]**
- **concludeTurn**：成功结果可标记"本批结果提交后轮次停止"——[推断] ask_user_question 类"问完即停"的工具大概率走此机制（会话内部无法直接观测该标记，机制本身为源码事实）。**[源码+推断]**
- **结果分层**：执行期 `value`（JSON）不持久化；持久化的是 `content`/`error`/`meta`。渲染器/投影器失败或非 JSON 展示→转 JSON 安全 isError——**流水线任何一层都不会把"无法呈现"变成崩溃**。**[源码]**
- **tool/result.meta 是工具私有的展示载荷**（如 tool-fs 的 diff 卡），核心不解释形状但强制 JSON 可序列化（源头 `Session.append` 校验）——插件做结果卡片就走这里。**[源码]**

## 五、Agent 句柄与所有权（插件视角的要点）

- 创建/恢复返回 `AgentHandle{agent, dispose()}`——**dispose 是能力**：只有创建者消费方能拆；工厂提供方（agent-loop）是结构性所有者，其卸载会停掉它造的所有活 handle。配置型 agent 归循环 fiber，永不外发句柄。**[源码]**
- `setup` 回调在两个 id（agent/session）发布前组装作用域世界，失败/commit 抛/所有者 dispose 都整体回滚——**"半组装 agent"在类型上不可到达**。**[源码]**
- Agent preset 体系：`composeFrom`（子 agent 加入父的**同一代**组合实例，而非按 id 重解析——父启动后组合文件被改也不会给子不同代）+ `swapPreset`（仅未产出任何内容的 agent 可换，防"日志里有新组合调不了的调用"）。**[源码]**
- `serviceFor(agent, name)`：从宿主侧读进 agent isolate realm 的服务实例——**每一条浏览器 RPC 的必经之路**（会话内服务的只读寻址）。**[源码]**（web 插件线判据：客户端插件要消费会话内服务，走这条路而非自己缓存）

## 六、对插件线的判据

| 判据 | 内容 | 等级 |
|---|---|---|
| 扩展点选择 | 观察/拦截进行中工作 → `agent/*` waterfall；跨重启的持久事实 → 会话事件；能力策略 → `tools/*`/`fs/*` 等能力事件。三域不混用 | [源码] |
| 改模型输入 | 只有 `agent/pre-step`（改写消息）与 system-prompt 段落（10 §四）；工具参数永远改不了 | [源码] |
| 上下文注入 | 用 `agent.inject()` 语义（不唤醒、next-step 拾取）；想要"每轮必到"的常驻上下文走 PromptContext（10） | [源码] |
| 卡片/展示 | `tool/result.meta` + 工具的 presentResult；Web Conversation Node 需事件族自带稳定业务 id（07 引用过） | [源码] |
| 重试挂钩 | 请求失败恢复的唯一口是 `agent/request-error` 返回 `{kind:'retry'}`；直接 `ctx.llm.stream()` 的调用方没有重试（10 §五） | [源码] |
| 轮次统计 | thread/统计类插件按 `turn/end.reason` 分类时：`max-tokens` 优先于 completed、`interrupted` 非循环产物（崩溃）、blocked/error 独立——与本表 07 §七互补 | [源码] |

## 附：证据清单

- `docs/architecture.zh.md` §轮次流程（turn-flow 图原文）、§事件三域、§新行为归属映射
- `docs/subsystems/core.zh.md`：Agent 句柄/inbox/取消 cause、拦截决策（pre-step/request-error/turn-stopping/session-start）、…Map→derived-union 模式与六大规范 map、branded ids
- `docs/subsystems/session.zh.md`：SessionEventMap 全表（12 变体）、request/header(EpochHeader)与 request/context、deriveMessages 投影规则、TurnEndReasonMap 7 值、执行封闭与独立事件、session/end-seed
- `docs/subsystems/tools.zh.md`：ToolExecutionInput/Execution/DispatchExecution、五段瀑布、PreToolDecision/PostToolDecision、ToolGuard 单调性、ToolExecutionSuccess/Failure、concludesTurn/deferContext、JSON Schema 受限子集
- Cordis 目录：ctx.agentLoop（create/createAgent/resume）、ctx.agentPresets（composeFrom/swapPreset/serviceFor）、ctx.sessions（prepare/enter/announce/flush 事务序）
- 实测对照：本会话工具面（todo_write/ask_user_question/send_message/bash 并行与写独占、ask 后停轮）与文档词汇一一对应
