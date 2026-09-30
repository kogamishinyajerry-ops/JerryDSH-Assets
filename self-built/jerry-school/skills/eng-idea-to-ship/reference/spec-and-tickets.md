# Spec 与工单（eng-idea-to-ship 参考）

## Spec：把对话固化

**不访谈，只合成**——spec 阶段消费的是拷问已经问出来的东西。先探索仓库理解现状，用领域词汇表（CONTEXT.md）的语言写，尊重所在区域 ADR。先勾出要测试的 **seam**（优先已有 seam，尽量高，越少越好——理想是一）并向用户确认，然后按模板写：

```md
## Problem Statement
用户视角的问题。

## Solution
用户视角的解法。

## User Stories
编号长列表："As a <actor>, I want <feature>, so that <benefit>"。
覆盖要极尽全面。

## Implementation Decisions
已做的实现决策：将建/改的模块及其接口、技术澄清、架构决策、schema 变更、API 契约、具体交互。
不写文件路径和代码片段（很快过期）。例外：原型产出的片段若比散文更精确地编码了决策
（状态机、reducer、schema、类型形状），内联进相关决策并注明来自原型，裁到决策密集部分。

## Testing Decisions
测试决策：什么是好测试（只测外部行为）、哪些模块会测、codebase 里的先例测试。

## Out of Scope
明确不做的东西。

## Further Notes
其余。
```

## 工单：曳光弹切片 + 阻塞边

把 spec/计划/对话拆成一组**工单**：曳光弹垂直切片，每张声明阻塞它的工单。

**垂直切片规则**：每片窄但**完整**地穿透每层（schema、API、UI、测试）——垂直，不是横切一层；完成的片独立可演示/可验证；每片一个新鲜上下文窗口吃得下；预重构（prefactor）先行——"先把变改变容易，再做容易的变更"。

每张工单给**阻塞边**（blockers）：它开工前必须完成的工单。无边者可立即开工。

**宽改造是垂直切片的例外。** 一个机械变更（改列名、改共享符号类型）**波及面**扇出到全库、单点编辑破坏数千调用点、没有垂直片能绿着落地时，排 **expand–contract**：先 expand（新形态加在旧形态旁，不破坏）；再按波及面分批迁移调用点（按包/按目录），每批一张工单、被 expand 阻塞，旧形态还在所以 CI 批批绿；最后 contract（无调用者后删旧形态），被所有迁移批阻塞。批次单独都绿不了时保留时序、共享集成分支，全部阻塞一张最终的 integrate-and-verify——绿只在最后承诺。

**向用户过数**：编号列表呈现拆分（每张：标题 / 被谁阻塞 / 交付什么端到端行为），问：粒度对吗？阻塞边对吗（每张只真依赖真挡它的）？要合并或再拆吗？迭代到用户批准。

**发布**：有真 tracker（GitHub Issues/Linear）就一票一 issue 按依赖序发、用原生阻塞关系，打 ready-for-agent 类标签；没有就本地约定：`.scratch/<feature-slug>/issues/NN-<slug>.md`，一票一文件，依赖序编号，"Blocked by" 列编号。本地票模板：

```md
# <NN>: <标题>

**What to build:** 这张票让它跑通的端到端行为（用户视角，不是分层实现清单）。
**Blocked by:** <编号/标题>，或 "None (can start immediately)"。
**Status:** ready-for-agent

- [ ] 验收标准 1
- [ ] 验收标准 2
```

两种形态都不写具体文件路径/代码片段（同 spec 的例外规则）。干**前沿**：阻塞者全完成的票。不关闭/修改父 issue。

---
*源：mattpocock/skills `to-spec` + `to-tickets`（MIT），翻译整合。*
