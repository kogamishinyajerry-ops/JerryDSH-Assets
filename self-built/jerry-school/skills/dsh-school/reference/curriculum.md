# DSH 学校课程表（dsh-school 参考）

四个模块，每个 1–3 个概念一课。讲课时按用户目标裁剪，不必按序。术语定义见 [dictionary.md](dictionary.md)。

## 模块 1 · agent 解剖学：DSH 在做什么

**第 1 课 · 一次 turn 的解剖**（零基础起点）
类比：你雇了一个天才顾问，他每次说话前都会失忆，唯一的记忆是桌上摊着的所有纸。
机制：你说一句话 → DSH 把〔system prompt + 对话史 + 工具结果〕整个窗口发给模型 → 模型可能回文本（turn 结束）或回一个工具调用 → DSH 执行、把结果追加进窗口 → 再发一次……直到模型回给你文字。用户消息一条，中间可能几十次模型请求。
现场演示：让用户看你刚才的 turn 里调了什么工具。
巩固问题："我读了你 3 个文件，下一轮你还会记得它们吗？为什么？"

**第 2 课 · context window 与 token 预算**
类比：桌面大小固定，每张纸（token）都占地方；桌面不是无限大，而且**噪音越大越听不清你说话**。
机制：窗口是模型唯一感知面；token 计费与计数；attention budget 按 token 封顶——指令音量不变，房间越来越吵。
关键纠偏：窗口还有 60% 空间 ≠ 还能好好干活。smart zone（~125–150k token 起衰减）才是真预算。
巩固问题："为什么'再解释一遍'常常让它更笨？"

**第 3 课 · 会话的生命周期：clear / compact / handoff / subagent**
四招各买什么：clear＝最便宜，上下文无关时用；compact＝有损摘要续命，给一句保留指引；handoff＝写文件跨 harness/目录/同事；subagent＝噪音隔离，只回报告。决策顺序：先 continue（零成本），在阶段边界上选，不在阶段中间劈。
巩固问题："拷问完要开始写 spec，该 continue 还是 compact？为什么？"

## 模块 2 · 工程主流：为什么直接叫它写会翻车

**第 1 课 · 三大失败模式**（方法论起点）
1. **做出来的不是要的**（misalignment）——agent 默默填空，猜与选不可分辨 → 解药 grilling（拷问）；
2. **又臭又错**——没有共享语言，20 个词说 1 个词的事 → 解药 CONTEXT.md 词汇表 + ADR；
3. **大泥球**——agent 加速代码熵增 → 解药深模块设计 + 每日架构保养。
每条配一个用户经历过的真实场景。

**第 2 课 · 主流全图：idea → ship**
拷问对齐 →（纸面定不了？原型支线）→ spec（固化决策）→ 曳光弹工单（垂直切片+阻塞边，一票一 smart zone）→ 逐票 TDD 实现（red→green、预约定 seam）→ 双轴审查（Standards/Spec 并行子代理）→ commit。
核心洞见：**spec 和 ticket 不是官僚手续，是无状态模型的记忆假肢**——会话可弃，交接物长存。
巩固问题："为什么每张票要装进一个新鲜上下文？"

**第 3 课 · 硬 bug 的纪律**
诊断循环：造会红的回路（90% 的活）→ 复现+最小化 → 3–5 个可证伪假设 → 单变量插桩 → 回归测试 → 清理。
反直觉点：直接读代码建理论正是要防的失败——没有能红的命令就没有假设阶段。

## 模块 3 · DSH 驾驶术：把机器开起来

**第 1 课 · 长程推进**：goal（建目标+自动续轮，完成才 complete）vs 单轮对话；plan mode（动手前出完整计划等人批）；审批策略（ask/never）与文件沙箱模式——never 不是放权，破坏性动作仍要人拍板。
**第 2 课 · 并行与委托**：subagent（后台只读研究/写隔离）vs workflow（大规模扇出）vs Ralph（用户明确要的新鲜代理循环）；后台任务 + 轮询，小时级长跑不堵会话。
**第 3 课 · 扩展面**：skills（`~/.agents/skills`、项目 `.dsh/skills`、插件运行时注册三层来源；description 是常驻指针，正文按需加载）；MCP 工具（`mcp__服务器__工具` 命名）；profile/插件（bundle 栈 + cordis.patch.yml patch 层，`--dump-config` 看组合树）。
演示：让用户问"你现在有哪些技能"，对照三层来源讲一遍。

## 模块 4 · 为 agent 写作：喂它正确的纸

**第 1 课 · context pointer 与渐进披露**：AGENTS.md 里内联 2000 token runbook = 每轮付费；一行指针 = 用时才付。塞满的说明书让 agent 每件事都变差（attention budget）。
**第 2 课 · 指针措辞**：指针的**措辞**（不是目标）决定 agent 何时以及多可靠地到达它——触发词前置、一个分支一个触发、身份信息留给正文。
**第 3 课 · 步骤与完成判据**：每步以可判"做没做完"的条件收尾；模糊边界招来提前收工。demand 驱动腿活。

---
*课程叙事整合自：aihero.dev/skills 体系（grilling/tdd/diagnosing-bugs/ask-matt 主流图）、AI Coding Dictionary（smart zone/attention budget/handoff artifact）、"5 Agent Skills I Use Every Day"、"The AI Engineer Mindset"（免费内容）+ DSH 0.1.1-rc 实测。*
