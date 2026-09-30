# 好测试 / 坏测试 / Mock 边界（eng-tdd 参考）

## 好测试

**集成风格**：通过真实接口测，不 mock 内部部件。

```typescript
// GOOD：测试可观察行为
test("user can checkout with valid cart", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
});
```

特征：

- 测用户/调用方关心的行为
- 只用公共 API
- 内部重构后依然存活
- 描述 WHAT，不描述 HOW
- 每个测试一个逻辑断言

## 坏测试

**实现细节测试**：与内部结构耦合。

```typescript
// BAD：测实现细节
test("checkout calls PaymentService.process exactly once", () => {
  const paymentService = mock(PaymentService); // mock 内部协作者
  checkout(cart, paymentService);
  expect(paymentService.process).toHaveBeenCalledTimes(1); // 旁路验证
});
```

识别标志：重构（行为不变）会挂测试。

## Mock 边界

只在**系统边界**上 mock：

- 外部 API（支付、邮件等）
- 数据库（有时——优先用测试库）
- 时间/随机性
- 文件系统（有时）

不要 mock：

- 你自己的类/模块
- 内部协作方
- 任何你控制的东西

## 为可测性设计

在系统边界上设计容易 mock 的接口：

1. **依赖注入，不自行创建**

```typescript
// 可测
function processOrder(order, paymentGateway) {}
// 难测
function processOrder(order) {
  const gateway = new StripeGateway();
}
```

2. **返回结果，不制造副作用**

```typescript
// 可测
function calculateDiscount(cart): Discount {}
// 难测
function applyDiscount(cart): void {
  cart.total -= discount;
}
```

3. **小表面积。** 方法更少 = 需要的测试更少；参数更少 = 测试准备更简单。

---
*源：mattpocock/skills `tdd/tests.md` + `tdd/mocking.md`（MIT），翻译整合。*
