---
name: eng-domain-modeling
description: 领域建模：主动建立并锐化项目共享语言——挑战模糊术语、用边角场景压力测试、即时更新 CONTEXT.md 词汇表、按三条件 sparingly 记 ADR。触发：讨论代码库术语、写或改 CONTEXT.md、记录或编辑 ADR、术语冲突或一词多义。
whenToUse: 你在*改变*领域模型时（仅读词汇表不算——那是一行习惯，任何技能都能做）。
---

# 领域建模（Domain Modeling）

设计过程中主动建立并锐化项目的领域模型。这是*主动*纪律：挑战术语、发明边角场景、在术语结晶的当下把词汇表和决策写下来。

共享语言的收益不止省 token：变量/函数/文件用统一语言命名 → 代码库对 agent 更好导航 → agent 思考也花更少 token（更简洁的语言）。

## 文件结构

大多数仓库单 context：根 `CONTEXT.md` + `docs/adr/0001-xxx.md`。存在 `CONTEXT-MAP.md` 则是多 context 仓库，map 指向各 context 的位置。**惰性创建**：第一个术语敲定时才建 `CONTEXT.md`，第一个 ADR 需要时才建 `docs/adr/`。格式模板见 [reference/formats.md](reference/formats.md)。

## 会话中的纪律

- **对照词汇表挑战。** 用户用的词与 `CONTEXT.md` 冲突时立刻指出："词汇表把 cancellation 定义为 X，你现在似乎指 Y。是哪个？"
- **锐化模糊语言。** 用户用模糊/过载的词时提出精确的规范术语："你说'account'——指 Customer 还是 User？它们是不同的东西。"
- **讨论具体场景。** 领域关系被讨论时，发明探边角的具体场景，迫使用户精确概念边界。
- **与代码交叉验证。** 用户说某事如何工作时，查代码是否同意。矛盾就摊开："你的代码取消整个 Order，但你刚说可以部分取消。哪个对？"
- **即时更新 CONTEXT.md。** 术语敲定的当场就写进去，不要攒批。
- **CONTEXT.md 绝不含实现细节。** 它是词汇表，仅此而已——不是 spec、不是草稿本、不是实现决策仓库。

## ADR 三条件（缺一不记）

只有三条全真才提议记 ADR：

1. **难逆**：之后改主意的代价可观
2. **没有上下文会令人费解**：未来读者会问"他们为什么这么做？"
3. **真实权衡的结果**：存在真替代项且因具体理由选了这个

好例子：架构形态、context 间集成模式、带锁定的技术选型、边界与所有权决策（明确的"不"和"是"一样有价值）、对显然路径的刻意偏离（"手动 SQL 不用 ORM 因为 X"——防止下个工程师"修"掉故意的决定）、代码里看不见的约束。

---
*改编自 Matt Pocock `domain-modeling` 技能及其 CONTEXT-FORMAT/ADR-FORMAT（MIT，github.com/mattpocock/skills，思想源头 Eric Evans《Domain-Driven Design》），适配 DSH。*
