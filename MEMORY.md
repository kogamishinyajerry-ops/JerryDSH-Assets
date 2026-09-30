# 项目接续约定

## 2026-10-01 · P0 执行决策

- DSH 恢复基线固定为 `0.2.0-rc.2`，使用新目录和官方 `DSH_HOME`。恢复依据为 manifest、完整依赖锁和精确 doctor 补丁，不使用可变 tag。
- 仿真核心复用现有 [dsh-sim](https://github.com/kogamishinyajerry-ops/dsh-sim)。TaskSpec、队列、授权、求解、独立校核和证据只在核心维护；本仓只放 DSH 原生薄接入。
- `sim_orchestrate` 通过原生 subagent 执行四个有工具范围和时限的阶段，使用既有 12 个工程 MCP 工具。委派完成不等于数值或工程接受。
- 先验证公开 OpenFOAM 通道，再接真实 STAR 与已取得的其他适配合同。公开实验使用显式 local-validation 夹具，不能冒充生产授权。
- 所有 profile 保持 `session-log-deepseek` 与 `session-telemetry-otel` 禁用；npm 操作后复查 doctor。模型凭证不入仓。
- 工程阈值、适用范围与方法发布由既有受信流程确认；DRAFT / TBD 不因软件验证通过而自动改变。
- `sim-live-hub` 尚未取得真实仓库/spec，不能根据名称臆造 `module.json/parser.py` 兼容层。P1 知识库和 P2 产品壳继续后置。

当前实现、已测范围和外部依赖分别见 [恢复](docs/recovery.md)、[仿真接入](docs/simulation-orchestration.md) 和当日工作记录。
