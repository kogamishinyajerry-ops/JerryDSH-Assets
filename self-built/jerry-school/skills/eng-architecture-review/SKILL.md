---
name: eng-architecture-review
description: 架构巡检：扫描代码库找"加深机会"（shallow → deep 的重构候选），产出规格驱动、可验证的可视化 HTML 报告（archify 风格：spec JSON 为唯一真源 + 几何校验），选中一个就带回主流拷问。触发："巡检架构 / architecture review / 找技术债 / 这代码库还能怎么改 / 空档保养"。
whenToUse: 有空档时的日常保养，不是拯救行动——老代码库里它会找到真候选，但不会替你解结。选中候选后用 eng-grilling 走主流。
---

# 架构巡检（Improve Codebase Architecture）

浮出架构摩擦点，提出**加深机会**：把浅模块变深的重构候选。目标是可测性与 AI 可导航性。本命令由领域模型（`CONTEXT.md`）提供名字，由深模块词汇（加载 `eng-codebase-design` 取 **module/interface/depth/seam/adapter/leverage/locality**，建议语中精确使用这些词，不漂移成"组件/service/API/边界"）提供理论；ADR 记录的决策不重新翻案。

词汇与原则速查：[eng-codebase-design reference/principles.md]（同插件）。

## 过程

### 1. 探索

**先定范围再扫描：YAGNI。** 加深的回报是让该模块*未来的变更*更容易，所以优先看最近常改的区域。用户点名了方向（模块/子系统/痛点）就直接用；否则 `git log --oneline` 回溯一段找**热点**，让热点路径牵引注意力；改动零散无热点就撒大网。

先读 `CONTEXT.md` 与所在区域 ADR。然后派一个**子代理**走查代码库，不套刚性启发式，有机探索并记录摩擦感：

- 理解一个概念要在很多小模块间跳来跳去的地方在哪？
- 哪里模块**浅**——接口几乎和实现一样复杂？
- 哪里为可测性抽了纯函数，但真 bug 藏在调用方式里（无 **locality**）？
- 哪里紧耦合模块的内容漏过 seam？
- 哪些部分未测试，或经当前接口很难测？

对疑似浅的东西过**删除测试**：删掉它，复杂度是集中（好信号）还是只是搬家？

### 2. 产出可验证的可视化报告

写一个**自包含 HTML**（零 CDN、双击即开）到 OS 临时目录（`$TMPDIR` 兜底 `/tmp`），文件名带时间戳，`open` 给用户并报告绝对路径。可视化采用**规格驱动 + 可验证**的 archify 风格：

1. **先写规格 JSON**（唯一真源）：`components[]`（id/type/label/sublabel/pos/size，type ∈ frontend/backend/external/database/risk/skill）、`connections[]`（id/from/to/label/fromSide/toSide）、`meta.views[]`（每个视角一个 focus 子集 + 一句 note）。
2. **HTML 内嵌该规格**，用 SVG 渲染：类型配色、连线箭头、视图切换工具栏（聚焦 view 时非焦点组件降透明度）、明暗主题切换。
3. **跑几何校验再交付**：组件都在 viewBox 内、两两不重叠（留 8px 间距）、connection 两端 id 存在、每个 view 的 focus id 存在。校验脚本输出 JSON（ok/diagnostics），全绿才交付——图不是画完就算，是验完才算。
4. 每个候选一张卡：**Files / Problem / Solution / Benefits**（用 locality 与 leverage 解释，测试如何变好）/ **Before/After 图**（并排、手绘 SVG 或 Mermaid——图状关系用 Mermaid，编辑性视觉用手绘 div/SVG：质量剖面图、断面图）/ **推荐强度徽章**：`Strong` / `Worth exploring` / `Speculative`。

### 3. 收口

报告是**盘点不是施工**：交给用户挑。挑中的候选＝一个新想法，带回主流（`eng-grilling`）立项。若诊断阶段的发现是"没有好 seam 锁住某个 bug"，这里就是它的移交终点。

---
*改编自 Matt Pocock `improve-codebase-architecture` 技能（MIT，github.com/mattpocock/skills）；可视化规格与校验协议对齐 tt-a1i/archify 的 spec-driven + verifiable 约定。*
