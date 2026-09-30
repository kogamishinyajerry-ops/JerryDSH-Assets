---
name: eng-idea-to-ship
description: 工程主流编排器：idea→ship 全流程导航——先拷问对齐（eng-grilling），必要时走原型支线，然后 spec → 曳光弹工单 → 逐票 TDD 实现 → 双轴审查收尾；含迷雾大工程 wayfinder、triage 入口、架构保养回路与上下文卫生。说出你的处境，它会告诉你走哪条路。
audience: user
---

# Idea → Ship：工程主流

你不需要记住每个技能——说出处境，这里给你路线。一条**主流**承载大部分工作，两个**入口匝道**汇入它，其余是独立的或底层词汇。

## 主流：想法 → 交付

### 1. 先拷问对齐

加载并运行 `eng-grilling`。在有工作目录时同时跑 `eng-domain-modeling`：把拷问中结晶的术语即时写进 `CONTEXT.md`、把难逆决策记成 ADR——留下纸痕，下个会话直接继承。两大失败模式（做出来的不是要的 / 一词多义导致又臭又错）在这里一起治。

### 2. 分支：有纸面上定不了的问题吗？

问题需要*可运行的答案*（状态机手感、业务逻辑、要看一眼的 UI）→ 走**原型支线**：造一次性原型回答那一个问题（两分支配方与共享规则见 [reference/prototype-recipes.md](reference/prototype-recipes.md)：逻辑问题→单文件 HTML 自由操作台；UI 问题→同路由 `?variant=` 多变体）。原型是**一次性代码**：不测试、不抽象、内存态、跑起来就行；结论折回真代码，原型本身提交到 `prototype/<name>` 分支留作一手来源。回到主流时引用它的结论。

### 3. 分支：这是多会话工程吗？

- **是** → 先落 **spec**（见 [reference/spec-and-tickets.md](reference/spec-and-tickets.md) 的 spec 模板：Problem/Solution/用户故事/实现决策/测试决策/Out of Scope；写之前先和用户确认测试 seam）。再拆 **工单**：曳光弹垂直切片 + 阻塞边，每片一个新鲜上下文窗口能吃下；然后**逐票实现**，每票之间清空上下文。
- **否** → 直接实现，就在当前上下文里。

### 4. 实现（每票）

驱动 `eng-tdd`（约定 seam、red→green、一次一片）；类型检查常跑、单测常跑、全量测试收尾跑一次。完成后跑 `eng-code-review` 双轴审查，修完裁定项再 commit。

## 上下文卫生

步骤 1–3 保持**一个不断开的上下文窗口**——拷问、spec、工单建立在同一段思考上。每票实现则从新鲜上下文开始，工单自足。预算按 **smart zone**（模型仍敏锐的窗口，~150k token）规划而不是窗口上限：接近了就在最近的阶段边界压缩/换新会话，不要在劣化区硬推。阶段边界上的五选项决策树（Continue / 新会话 / handoff / 子代理 / 压缩）见 [reference/phase-boundaries.md](reference/phase-boundaries.md)。

## 入口匝道

- **bug 和请求堆积** → **triage**：外来 issue（不是你自己拆的工单）过状态机（needs-triage → needs-info / ready-for-agent / ready-for-human / wontfix + bug/enhancement 分类），产出 agent 拿了就能干的简报，之后由第 4 步捡起。
- **有东西坏了** → `eng-diagnosing-bugs`：硬 bug 专用。它拒绝在没有变红回路时建理论，收尾时把"没有好 seam 锁住这个 bug"移交给架构保养。
- **巨大而迷雾的工程**（绿地项目/巨特性，一个会话装不下、路还看不见）→ **wayfinder**：把工程画成 issue tracker 上的**共享地图**（一个 `wayfinder:map` 父 issue）+ **决策工单**（子 issue，每个一个问题，解决产物是*决策*不是交付物），一次解决一张直到路清晰。它是**规划不是执行**；雾散后并回主流的 spec 步骤——把地图上链着的决策收敛成可建计划。比拷问慢而重，只用在真装不下的工程上。地图模板、四种票型、战争迷雾规则、两种调用模式见 [reference/wayfinder.md](reference/wayfinder.md)。

## 架构保养（非功能工作）

有空档就巡检：按 `eng-codebase-design` 的词汇扫代码库找**加深机会**（优先最近常改的热点区域），产出候选清单；挑一个就生成了一个新想法——带回主流第 1 步拷问。agent 极速放大代码熵，这是每天投资设计的机制。

## 底层词汇

两个模型可调用参考跑在其他技能*下面*：`eng-domain-modeling`（领域语言）与 `eng-codebase-design`（模块形状）。词是问题时直接取，流程技能也会自己拉它们。

## DSH 里怎么做

每个阶段用什么 DSH 原生能力（goal/plan mode/子代理/后台任务/新会话）见 [reference/dsh-mapping.md](reference/dsh-mapping.md)。

---
*改编自 Matt Pocock `ask-matt`（flow router）+ to-spec/to-tickets/implement/prototype/wayfinder/triage/improve-codebase-architecture/handoff（MIT，github.com/mattpocock/skills），深度整合适配 DSH。*
