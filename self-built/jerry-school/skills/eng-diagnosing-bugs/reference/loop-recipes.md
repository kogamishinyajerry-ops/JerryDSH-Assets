# 反馈回路构造法（eng-diagnosing-bugs 参考）

阶段 1 造回路时，按大致优先顺序尝试：

1. **失败测试**：任何够得着这个 bug 的 seam——单元、集成、e2e。
2. **Curl / HTTP 脚本**：打运行中的 dev server。
3. **CLI 调用**：fixture 输入，stdout 与已知好快照 diff。
4. **无头浏览器脚本**（Playwright/Puppeteer）：驱动 UI 并对 DOM/console/network 断言。
5. **回放捕获的 trace**：把真实网络请求/payload/事件日志存盘；在隔离中回放进代码路径。
6. **一次性 harness**：起系统最小子集（单服务、mock 依赖），单函数调用打穿 bug 路径。
7. **性质/fuzz 循环**：bug 是"有时输出错"时，跑 1000 个随机输入找失败模式。
8. **二分 harness**：bug 出现在两个已知状态（commit、数据集、版本）之间时，自动化"在状态 X 启动、检查、重复"以便 `git bisect run`。
9. **差分回路**：同一输入过旧版 vs 新版（或两份配置），diff 输出。
10. **HITL bash 脚本**：最后的手段。必须由人点击时，用结构化脚本驱动*人*（每步开 URL、捕获值、输出给回路），让循环仍然有结构；捕获的输出回流给你。

造对了回路，bug 就修好了 90%。

## 收紧检查单

- 更快？缓存 setup、跳过无关 init、缩窄测试范围
- 信号更锐？断言具体症状，不是"没崩"
- 更确定？钉时间、seed RNG、隔离文件系统、冻结网络

---
*源：mattpocock/skills `diagnosing-bugs/SKILL.md` Phase 1（MIT），翻译整合。*
