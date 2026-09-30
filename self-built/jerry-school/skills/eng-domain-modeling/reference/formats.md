# CONTEXT.md 与 ADR 格式（eng-domain-modeling 参考）

## CONTEXT.md 结构

```md
# {Context 名}

{一两句：这个 context 是什么、为何存在。}

## Language

**Order**:
{一两句术语描述}
_Avoid_: Purchase, transaction

**Invoice**:
发给客户的付款请求。
_Avoid_: Bill, payment request

**Customer**:
下单的个人或组织。
_Avoid_: Client, buyer, account
```

规则：

- **有主见。** 同一概念多个词并存时挑最好的，其余列进 _Avoid_。
- **定义紧凑。** 最多一两句。定义它*是*什么，不是它*做*什么。
- **只收本 context 特有的术语。** 通用编程概念（超时、错误类型、工具模式）不属于这里。加词前问：这是本 context 独有的概念，还是通用概念？只有前者入表。
- 自然聚簇时用子标题分组；单一领域全部术语平铺也可以。

## 单/多 context 仓库

- 仅根 `CONTEXT.md` 存在 → 单 context。
- `CONTEXT-MAP.md` 存在 → 多 context：map 列出各 context 位置与关系（如 Ordering → Fulfillment：Ordering 发 OrderPlaced 事件，Fulfillment 消费）。当前话题属于哪个 context 不清楚时，问。

## ADR 格式

住在 `docs/adr/`，顺序编号 `0001-slug.md`。模板：

```md
# {决策短标题}

{1-3 句：背景是什么、决定了什么、为什么。}
```

就这样。ADR 可以是一段话。价值在于记下*做了*这个决定和*为什么*，不在填满小节。

可选节（只在真增值时加）：Status frontmatter（proposed | accepted | deprecated | superseded by ADR-NNNN）、Considered Options（被拒替代值得记住时）、Consequences（下游影响不明显时）。编号：扫 `docs/adr/` 取最大号 +1。

---
*源：mattpocock/skills `domain-modeling/CONTEXT-FORMAT.md` + `ADR-FORMAT.md`（MIT），翻译整合。*
