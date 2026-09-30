# 10 · DSH LLM 装配与流式管线：适配器 · chunk 流 · KV cache 纪律 · 重试

> 模型请求如何被组装成"完全可重建"的信封、chunk 流的共享词汇、KV cache 友好性的机制来源、失败与重试的分层。
> 承 09（agent 循环在 `agent/request` → `llm/stream` 处进入本层）。结论分级 **[实测]/[源码]/[推断]** 同前。
> 证据：`docs/subsystems/{llm-streaming,system-prompt,token-meter}.zh.md` + `packages/llm/*`、`packages/core/system-prompt` 源码。

## 一、结论速览

1. **请求信封三来源、一次组装**：系统提示词（section 段落拼接）+ 工具 schema（provider 汇聚）+ 派生历史（07/09 的 deriveMessages），组装成 `GenerateOptions`；每次组装同时产出 `request/header` 全量快照入日志——**"每个对话请求都是日志的纯函数"**。**[源码]**
2. **KV cache 友好是机制产物不是运气**：动态运行时上下文（PromptContext）只在"完整快照发生变化"时作为 user-role 快照**追加在保留历史之后**，绝不改写请求头中的系统提示词；header 相等逐字段比较，变了才记 change 快照。改动越少，前缀越稳。**[源码]**
3. **chunk 流是共享词汇，块重组不是每个适配器的事**：适配器只 emit 格式正确的 `StreamChunk`（block-start/delta/end + usage + finish），`BlockAssembler` 是唯一共享 fold 实现；**usage 必须在 finish 前、finish 后零分片**。**[源码]**
4. **一次适配器调用 = 一次提供方尝试**：适配器禁用库重试；agent 层恢复（`agent/request-error`→retry）开新持久轮次；直接 `ctx.llm.stream()` 一次就是一次。重试策略在路由注册时解析冻结，进行中失败的恢复策略随后端路由替换也不变。**[源码]**
5. **Token 记账三桶互斥**：inputTokens 只含未缓存输入；缓存读写单独报；计费输入 = 三者之和（DeepSeek 把缓存折进 prompt_tokens 的，适配器负责扣除）。reasoningTokens 已含在 outputTokens 里，汇总不得重复加。**[源码]**
6. **token-meter 是回放快照而非计数器**：`measure()` 以 `logRevision`（消费到的持久事件数）锚定，usage 锚点只在"最近成功调用的规范信封与当前一致"时复用，否则全信封启发式重定价；表层逐节点定价（surfaceDelta 有符号）。compaction 的 0.8 水位就吃这里。**[源码]**
7. **空响应是可重试错误**（`EMPTY_RESPONSE`）、上下文溢出只有唯一规范 code `CONTEXT_WINDOW_EXCEEDED`（消费方按 code 路由，绝不解析提供方文本）、停顿看门狗默认 5 分钟（`streamIdleTimeoutMs`）——三条适配器硬约定。**[源码]**

## 二、系统提示词组装（`ctx.systemPrompt`）

- **三类贡献者 + 变量**：`PromptSection`（段落，order 排序：约定 -100=harness 身份、0=deployment persona、工具指引 100-199；同名 scoped 遮蔽 global）、`PromptContext`（动态运行时上下文，见 §三）、tool provider（每次组装求值出 schema 集）、`variable`（`{{name}}` 插值，provider 可返回 undefined 但引用即渲染失败）。**[源码]**
- **`complete` 段**：某段声明 `complete: true` 则协作瀑布跑完（工具/上下文/变量照常解析）后**恢复该段为唯一提示词**——"接管整个系统提示词"的合法通道，多段 complete 使组装失败。**[源码]**（[推断] 插件要完全换 persona 的正道就是这个，而不是试图删别人的段）
- **组装瀑布 `system-prompt/assemble`**：scope 过滤分发（scoped listener 只见本 scope 的组装），返回值权威；`system-prompt/change` 无过滤广播（全局变化影响所有 scope）。**[源码]**
- **工具可见性**：`ToolProviderResult.knownNames` 区分"配置名拼错"与"已知工具被有意隐藏"——restriction 前的名字全集留给配置校验。**[源码]**

## 三、KV cache 纪律的机制来源

官方在几乎每个包 README 写"KV Cache 影响"，其统一机制是 **[源码]**：

1. **常驻前缀稳定**：系统提示词段落、工具 schema 只在组装结果变化时经 `request/header` 记 change——同信封的连续请求前缀逐字节稳定。
2. **动态上下文追加式快照**：PromptContext 的完整当前快照变化时，作为 user-role 消息**追加**在保留历史之后（新快照取代旧状态、历史不动）——提供方前缀缓存看到的是"旧前缀 + 新尾巴"，而不是重写。
3. **压缩（compaction）另算**：surface replace 会天然打断前缀（这是 compaction 的固有代价，07 §五），此外无重写路径。
4. **回放状态（ReplayEnvelope）按块对齐裁剪**：组装丢弃某块（max-tokens 丢工具调用）时同位置回放条目一并丢——"存储的元数据永远描述存储的内容"。
5. **跨适配器不透传**：`ReplayEnvelope` 仅当历史提供方与目标提供方注册到**同一适配器实例**才传递；读不了已存状态只降级为提供方无关转换 + 诊断，不失败。**[推断]** 这就是 DeepSeek↔GLM 等跨模型 resume 时缓存状态丢弃、费用结构变化的机制解释。

## 四、chunk 流与组装

- **`StreamChunk` 原始协议**：block-start/delta/block-end 以 `index` 关联；工具调用 `arguments` **全程原始 JSON 字符串**（delta 流式；提供方给已解析对象的，适配器在 block-end 重新序列化）。**[源码]**
- **BlockAssembler 纪律**：对已关块的迟到 delta 忽略（坏适配器不能撑爆内存/污染已完成块）；max-tokens 结束丢弃全部工具调用（截断调用不可安全执行）且回放条目同位置裁剪；**中断前缀** `interruptedBlocks()` 只保留有非空白内容的 text/reasoning 块（09 §二 interrupted 标记的来源）。未知块类型未关块即抛。**[源码]**
- **两条错误路径共用 LlmFailure**：`stream()` 直接抛（传输/协议错）或以 `finish {kind:'error'|'aborted'}` 带内结束——无法中途抛的适配器用后者。**[源码]**
- **`GenerateOptions.purpose`**：`'compaction' | 'session-title'` 辅助调用可被适配器映射为隐藏传输元数据或专用策略——普通对话请求不带。**[源码]**（07 的 compaction 摘要调用、会话标题 LLM 都走这个口）

## 五、适配器约定与重试分层（插件接新模型前必读）

**适配器八条硬约定（消费方可依赖）[源码]**：usage 先于 finish；arguments 保持字符串；两错误路径；一调用一尝试（禁库重试）；停顿时限（默认 5 分钟，到期映射 `TIMEOUT`、早到的调用方中止保留 `ABORTED`）；溢出唯一 code；空响应=可重试错误；每请求携带 `attributionHeaders()`（User-Agent 应用归属，公开产品事实、无逐请求信息）。

**重试三层**：
1. **路由层**：`ResolvedRetryPolicy`（normal: maxRetries+retryableCodes+退避参数；always: 无上限退避）注册时冻结；省略=默认重试 5 次。`llmRetryPolicyOf(stream)` 从调用时捕获——之后换路由不改进行中恢复。**[源码]**
2. **agent 层**（dsh-llm-retry + `agent/request-error`）：失败步骤关闭后 listener 可修状态后返回 `{kind:'retry'}` 开新轮次；默认 undefined=失败终态。溢出恢复与 compaction 联动（07 §五：溢出先修剪再压缩再重试）。**[源码]**
3. **直接调用层**：`ctx.llm.stream()` 一次调用就是一次尝试，无恢复——**插件直接调 LLM 要自管重试**。**[源码]**

**prepareCall 一代性**：`prepareCall()` 把模型解析、默认物化、分发绑定到同一适配器注册代（generation），防止 settings 在解析与分发之间变化导致"一代的能力配另一代的端点"；`PreparedLlmCall.stream()` 校验请求配置与准备一致否则 `INVALID_PREPARED_CALL`。**[源码]**

**路由注册面**：`registerAdapter(providers, adapter)` 返回带原子 `replace(providers)` 的句柄——settings 变化时同实例换路由集、无观察间隙；空数组合法（settings 段清空=注册着但零路由）；`registerConfigurableProviders()` 声明可配置路由（settingsNs+path）让配置界面在路由注册前就显示休眠提供方。**[源码]**（[实测对照] 本机 settings.yaml 里 providers 段与 Models 页的联动即此机制）

## 六、模型元数据与 token 计量

- **目录仅供参考**：`listModels()` 是建议性目录不是请求白名单（适配器可接受未列出 id）；对正确性敏感的元数据（contextWindow/defaultMaxTokens/reasoning efforts）走 `resolveModel()` 单查、归确切路由的适配器所有。**[源码]**
- **ReasoningEffortId branded**：核心不枚举值，有序集合与部署默认归适配器——`AgentOptions` 里不写 effort 时用适配器默认。**[源码]**
- **TokenMeter 语义**（§一.6 展开）：`measure(session, header?)` 每次克隆 positional nodes（O(surface)）；`estimateMessage()` 纯启发式定价单消息。compaction 压力判定、web 的 contextPressure 投影单元（07 §四实测名单）都消费这里。**[源码]**

## 七、对插件线的判据

| 判据 | 内容 | 等级 |
|---|---|---|
| 接新模型 | 实现 LlmAdapter 八约定 + attribution + `registerAdapter`；动态路由用 replace 句柄；休眠路由声明 registerConfigurableProviders | [源码] |
| 加提示词 | PromptSection（order 遵约定段位）；完全接管用 complete 段；动态上下文用 PromptContext（缓存安全自动获得） | [源码] |
| 直接调 LLM | 一次 stream 就一次尝试——advisor/标题类插件必须自管重试与超时；辅助调用带 purpose | [源码] |
| 估 token | 用 ctx.tokenMeter.measure 而非自数；注意 usage 锚点只在信封一致时复用（换模型即失锚） | [源码] |
| 缓存友好 | 不要在 PromptSection 里放时变内容（每次组装都变=每请求都记 change=前缀全断）；时变内容放 PromptContext | [源码+推断] |
| KV 观测 | TokenUsage 三桶互斥是日志层事实，费用统计插件直接读 usage 分片即可，别自己扣缓存 | [源码] |

## 附：证据清单

- `docs/subsystems/llm-streaming.zh.md`：适配器约定八条（229-249）、ResolvedRetryPolicy（243-245）、AppIdentity（247-267）、TokenUsage 三桶（271-291）、BlockAssembler（295-352）、GenerateOptions/purpose/FinishReason（356-555）、LlmAdapter/PreparedLlmCall/prepareCall（671-758）
- `docs/subsystems/system-prompt.zh.md`：AssembleContext/PromptSection（order 约定/complete）/PromptContext/TOOL_ORDER_REST/assemble 瀑布（全文 207 行）
- `docs/subsystems/token-meter.zh.md`：TokenMeasurement/TokenSurfaceNode/baseline usage-vs-estimated/measure 语义（全文 90 行）
- `packages/llm/`：llm（词汇/assembler/attribution）、llm-retry、llm-deepseek（CONTEXT_WINDOW_EXCEEDED 分类）、token-meter（projection 单元见 07 §四实测）
- 关联：09 §二（agent/request→llm/stream 位置）、07 §五（compaction 消费 tokenMeter + purpose）
