---
name: eng-code-review
description: 双轴代码审查：对固定点以来的 diff 同时跑 Standards 轴（仓库规范 + Fowler smell 基线）与 Spec 轴（是否忠实实现来源 issue/spec），两轴并行子代理互不污染，结果并排报告。触发：审查分支/PR/WIP 改动、"review since X"、implement 收尾自检。
whenToUse: 一份改动可以过一轴挂另一轴：规范全对但做错了东西，或做对了东西但破坏约定。分开报告防止一轴掩盖另一轴。
---

# 双轴代码审查（Code Review）

对 `HEAD` 与用户给的固定点之间的 diff 做两轴审查：

- **Standards**：代码符合本仓库成文规范吗？
- **Spec**：代码忠实实现了来源 issue/spec 吗？

两轴作为**并行子代理**跑（DSH 里用 `subagent` 工具同时发两个、prompt 自足），互不污染上下文，本技能聚合结果。

## 过程

### 1. 钉住固定点

用户说的任何东西都是固定点（commit SHA、分支名、tag、`main`、`HEAD~5`）。没给就问。

一次性取好 diff 命令：`git diff <固定点>...HEAD`（三点，比 merge-base）。另记 commit 清单：`git log <固定点>..HEAD --oneline`。继续之前确认固定点可解析（`git rev-parse`）且 diff 非空——坏 ref 或空 diff 应该在这里失败，而不是在两个并行子代理里。

### 2. 找 spec 来源

按序找：commit message 里的 issue 引用（`#123`、`Closes #45`）→ 用户传的路径 → `docs/`、`specs/`、`.scratch/` 下与分支名或功能匹配的 spec 文件 → 都没有就问用户；用户说没有，Spec 子代理跳过并报 "no spec available"。

### 3. 找 standards 来源

仓库里任何成文"代码该怎么写"的文件：`CODING_STANDARDS.md`、`CONTRIBUTING.md` 等。无论仓库有没有成文规范，Standards 轴永远携带**smell 基线**——一组固定的 Fowler 代码坏味（Refactoring ch.3），全文见 [reference/smell-baseline.md](reference/smell-baseline.md)。两条约束：**仓库覆盖基线**（成文规范明确认可的东西，压住 smell）；**永远是判断题**（每条 smell 是标注的启发式——"疑似 Feature Envy"——不是硬违规）。工具已强制的东西跳过。

### 4. 并行发两个子代理

**Standards 子代理 prompt** 必须包含：diff 命令与 commit 清单；step 3 找到的规范文件清单 + 完整 smell 基线（子代理看不到本技能）；brief："按文件/hunk 报告：(a) diff 违反成文规范的每处——引用规范（文件+规则）；(b) 发现的基线 smell——命名并引用 hunk。区分硬违规与判断题：成文规范违规可以是硬的，基线 smell 永远是判断题，成文仓库规范覆盖基线。跳过工具已强制的内容。400 词内。"

**Spec 子代理 prompt** 必须包含：diff 命令与 commit 清单；spec 路径或抓取到的内容；brief："报告：(a) spec 要求了但缺失或不完整的需求；(b) diff 里没人要求的行为（scope creep）；(c) 看似实现但实现可能有误的需求。每个发现引用 spec 原句。400 词内。"

spec 缺失就跳过 Spec 子代理并在终报注明。

### 5. 聚合

两份报告放 `## Standards` 与 `## Spec` 标题下，原样或轻度清理。**不合并、不重排**发现——两轴刻意分离，重排正是分离要防的。

结尾一行总结：每轴发现总数与各自轴内最严重问题。**不跨轴选唯一最差**。然后轮到人裁决：哪些必须修，哪些作为判断题接受。

---
*改编自 Matt Pocock `code-review` 技能（MIT，github.com/mattpocock/skills，smell 基线源 Fowler《Refactoring》ch.3），适配 DSH 的 subagent 工具。*
