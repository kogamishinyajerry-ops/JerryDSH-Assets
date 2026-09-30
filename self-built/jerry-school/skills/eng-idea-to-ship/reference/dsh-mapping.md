# 流程 → DSH 原生能力映射（eng-idea-to-ship 参考）

aihero 技能源自 Claude Code 语境；下表把每个流程动作翻译成 DSH 的原生工具。规则：**用 DSH 已有的能力，不发明替代品**。

| 流程动作 | DSH 里怎么做 |
|---|---|
| 拷问轮次 | `eng-grilling` 已适配：优先 `ask_user_question` 工具提交结构化问题轮 |
| 留痕（CONTEXT.md/ADR） | 第一方 `write`/`edit` 工具直接写仓库文件 |
| 原型支线 | 新起子代理或在临时目录开工；结论用 handoff 文档带回主会话 |
| 研究支线（读文献腿活） | `subagent` 后台代理读一手来源、落带引用的 md；主会话继续干活 |
| spec/工单落盘 | `write` 工具；本地 tracker 用 `.scratch/<feature>/issues/` 约定 |
| 逐票实现、票间清上下文 | 每票一个**新会话**（或 headless 一次性任务）；工单文件自足 |
| 长程多轮自动推进 | `create_goal` 建目标 + goal 轮自动续跑；完成才 `update_goal complete`，同因阻塞 3 轮才允许 `blocked` |
| 动手前要人批准 | plan mode：`exit_plan_mode` 出完整计划等人批 |
| 并行双轴审查 | `subagent` × 2 同时发（Standards/Spec 各一，prompt 自足含 smell 基线全文） |
| 阶段边界-继续/新开/压缩 | Continue＝不动；新开＝新会话；压缩＝DSH compact |
| 阶段边界-交接 | handoff 文档写临时目录；跨 harness/目录/同事才用 |
| 只读探索不污染主上下文 | `subagent`（或 `subagent_fork` 需要本会话上下文时），回摘要不回过程 |
| 一次性人审门禁 | 破坏性操作（publish/rollback/删除）一律 `confirm: true` 显式参数，人拍板 |
| 小时级长跑（构建/评测） | 后台任务 + `job_output` 轮询，不阻塞会话 |

## 两条 DSH 特有纪律

1. **审批策略感知**：会话可能运行在 ask / never 审批策略下。never 不意味着放权——破坏性动作前依然显式停下确认，fail-closed。
2. **smart zone 就是预算**：DSH 会话可压缩可续跑，但质量在窗口上限之前就衰减。按"模型还能敏锐工作的 token 数"排任务，不按"还能塞多少"排。

---
*本文件是 DSH 适配层的原创映射，流程侧源出 mattpocock/skills（MIT）；DSH 侧事实取自 DeepSeek Harness 0.1.1-rc 运行时文档与实测。*
