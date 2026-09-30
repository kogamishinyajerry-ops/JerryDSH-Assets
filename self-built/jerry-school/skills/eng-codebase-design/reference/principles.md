# 设计原则详解（eng-codebase-design 参考）

## 为可测性设计

好接口让测试变得自然：

1. **接受依赖，不创建依赖。**

```typescript
// 可测
function processOrder(order, paymentGateway) {}
// 难测
function processOrder(order) {
  const gateway = new StripeGateway();
}
```

2. **返回结果，不制造副作用。**

```typescript
// 可测
function calculateDiscount(cart): Discount {}
// 难测
function applyDiscount(cart): void {
  cart.total -= discount;
}
```

3. **小表面积。** 方法更少 = 需要的测试更少；参数更少 = 测试准备更简单。

## 关系

- 一个 **Module** 恰好一个 **Interface**（呈现给调用方与测试的面）
- **Depth** 是 **Module** 的属性，相对其 **Interface** 度量
- **Seam** 是 **Module** 的 **Interface** 所在处
- **Adapter** 坐在 **Seam** 上满足 **Interface**
- **Depth** 给调用方产出 **Leverage**，给维护者产出 **Locality**

## 被否决的框架（rejected framings）

- **深度 = 实现行数/接口行数之比**（Ousterhout 原始表述）：奖励给实现注水。这里用"深度即杠杆"。
- **Interface = TypeScript `interface` 关键字或类的公有方法**：太窄。这里的 interface 包括调用方必须知道的每一个事实。
- **"Boundary"**：与 DDD 的 bounded context 撞义。说 **seam** 或 **interface**。

## 巡检提示（配合架构改进）

扫描代码库找"加深机会"时，带着这些问题走：

- 理解一个概念要在很多小模块之间跳来跳去的地方在哪？
- 哪里模块**浅**——接口几乎和实现一样复杂？
- 哪里为了可测性抽了纯函数，但真 bug 藏在怎么调它（没有 **locality**）？
- 哪里紧耦合模块的内容漏过它们的 seam？
- 哪些部分没测试，或通过当前接口很难测？

对任何疑似浅的东西过**删除测试**：删掉它复杂度会集中，还是只是搬家？"会集中"才是要的信号。

范围先于扫描（YAGNI）：加深一个模块的回报是让它*未来的变更*更容易，所以优先看最近常改的区域——`git log --oneline` 回溯一段找热点路径。

---
*源：mattpocock/skills `codebase-design/SKILL.md` Principles/Relationships/Rejected framings + `improve-codebase-architecture`（MIT），翻译整合。*
