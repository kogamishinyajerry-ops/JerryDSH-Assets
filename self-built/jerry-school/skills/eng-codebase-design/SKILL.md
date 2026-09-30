---
name: eng-codebase-design
description: 深模块设计词汇表（module/interface/depth/seam/adapter/leverage/locality）与设计原则：大量行为藏在小接口后、放在干净 seam 上、通过该接口可测。触发：设计或改进模块接口、决定 seam 位置、让代码可测或便于 agent 导航，或其他技能需要深模块词汇时。
whenToUse: 词语（模块的形状）而非流程是问题时；eng-tdd 与架构巡检都讲这套语言。
---

# 代码库设计（Codebase Design）

设计**深模块**：大量行为藏在小接口后，放在干净的 seam 上，通过该接口可测。凡是设计或重构代码的地方就用这套语言和原则。目标：给调用方 leverage，给维护者 locality，给所有人可测性。

## 词汇表

这些词要精确使用：不要用"组件/service/API/边界"替换。语言一致是全部意义所在。

**Module（模块）**：有接口和实现的任何东西。刻意与规模无关：函数、类、包、跨层切片。*避免*：unit、component、service。

**Interface（接口）**：调用方要正确使用模块必须知道的一切：类型签名，加上不变量、顺序约束、错误模式、必需配置、性能特征。*避免*：API、signature（太窄，只指类型层表面）。

**Implementation（实现）**：模块内部的东西，它的代码体。区别于 **Adapter**：一个东西可以是小 adapter 大 implementation（Postgres 仓库），也可以是大 adapter 小 implementation（内存 fake）。seam 是话题时用 "adapter"，否则用 "implementation"。

**Depth（深度）**：接口处的杠杆。调用方（或测试）每学一单位接口能驱动的行为量。大量行为藏在小接口后是**深**；接口几乎和实现一样复杂是**浅**。

**Seam（缝）**（Michael Feathers）：不改那个位置的代码就能改变行为的地方；模块接口所在的*位置*。seam 放哪是独立的设计决策，区别于它后面放什么。*避免*：boundary（与 DDD 的 bounded context 撞义）。

**Adapter（适配器）**：在 seam 上满足一个接口的具体物。描述*角色*（填什么槽），不是内容（里面是什么）。

**Leverage（杠杆）**：调用方从深度得到的。每学一单位接口得到更多能力。一份实现回馈 N 个调用点与 M 个测试。

**Locality（局部性）**：维护者从深度得到的。变更、bug、知识、验证集中在一处而不是摊到所有调用方。修一次，处处修好。

## 深 vs 浅

```
深模块 = 小接口 + 大量实现          浅模块 = 大接口 + 薄实现（避免）
┌───────────────────┐             ┌─────────────────────────┐
│   Small Interface │ ← 少方法     │      Large Interface    │ ← 多方法复杂参数
├───────────────────┤             ├─────────────────────────┤
│                   │             │   Thin Implementation   │ ← 只是透传
│ Deep Implementation│ ← 复杂逻辑  │                         │
│                   │   藏起来    │                         │
└───────────────────┘             └─────────────────────────┘
```

设计接口时问：方法数能减吗？参数能简化吗？还能往里藏更多复杂度吗？

## 原则

（完整原则、可测性设计、关系图与被否决的框架见 [reference/principles.md](reference/principles.md)。）

- **深度是接口的属性，不是实现的。** 深模块内部可以由小的、可 mock、可替换的部件组成——它们只是不属接口。模块可以有**内部 seam**（实现私有、给自己的测试用）和接口处的**外部 seam**。
- **删除测试（deletion test）。** 想象删掉这个模块：复杂度消失 → 它是透传；复杂度在 N 个调用方那里重新冒出来 → 它在挣自己的饭钱。
- **接口就是测试面。** 调用方和测试穿过同一个 seam。想测到接口*里面*去，模块形状多半不对。
- **一个 adapter 是假想 seam，两个 adapter 才是真 seam。** 没有东西真的在那个缝上变化，就不要引入它。

---
*改编自 Matt Pocock `codebase-design` 技能（MIT，github.com/mattpocock/skills，其源头是 Ousterhout《A Philosophy of Software Design》与 Feathers《Working Effectively with Legacy Code》），适配 DSH。*
