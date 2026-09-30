# dsh-sim 原生编排入口

`jerry-dsh-sim-orchestrator@0.1.0` 为固定版本 **DSH 0.2.0-rc.2** 提供 `sim_orchestrate` 工具。一次调用运行一个有时限的原生子 Agent：`planner`、`inputwriter`、`runner` 或 `reviewer`。任务、队列、求解、校核、授权和证据仍在独立的 [dsh-sim](https://github.com/kogamishinyajerry-ops/dsh-sim) 中。

完整接入步骤、四阶段示例、身份限制与验证范围见 [simulation-orchestration.md](../../docs/simulation-orchestration.md)。恢复产物使用 `<target>/runtime/node_modules/.bin/dsh`；在复制到 `<target>/dsh-home/plugins/dsh-sim-orchestrator` 的插件目录执行锁定的 `npm ci`，然后按接入文档生成包含本插件绝对 `file:` URL 的独立 overlay。该流程复用已安装宿主与 web 锁，只执行无密钥配置导出。`cordis.patch.yml` 提供 `simulation` preset 声明，原 profile 不变。

## 本地验证

```bash
cd /absolute/path/to/JerryDSH-Assets
cd self-built/dsh-sim-orchestrator
npm ci --ignore-scripts --legacy-peer-deps=false
npm test
```

`package-lock.json` 锁定本包的测试/运行 peer 闭包；正常 DSH profile 也应保留它自己的包管理锁文件。测试使用安装的 0.2 RC Cordis、工具注册表和 JSON Schema 校验器，不需要 API key。本次 16 项通过：声明式输出、四阶段过滤、授权引用缺失、错误和取消、deadline、资源替换、卸载清理，以及真正的工具隐藏与执行拒绝。

这些是 deterministic 编排验证；没有运行真实 LLM 的自然语言四阶段端到端流程，也不产生求解器结果。

另有真实 stdio 连通检查，需已有固定 DSH 安装和 dsh-sim `[mcp]` 环境：

```bash
cd /absolute/path/to/JerryDSH-Assets
node tests/orchestration/mcp-smoke.mjs /absolute/path/to/recovered/runtime /absolute/path/to/sim-venv/bin/python
```

该命令从仓库根目录运行，核对真实 Python server 的全部 12 个工具，并验证工程 API 不可达时返回 `UNAVAILABLE`。它不运行 LLM、工程 API 或求解器。

## 文件

| 文件 | 职责 |
|---|---|
| `index.js` | Cordis `Config`、原生工具注册和结果展示 |
| `delegation.js` | 阶段白名单、资源参数检查、`ctx.subagents.start`、取消和资源释放 |
| `cordis.patch.yml` | 显式 `@deepseek-ai/dsh-agent-preset` 声明与现有 MCP server 配置 |
| `package-lock.json` | 固定 peer 包版本与下载完整性 |

本插件无独立持久状态，也无领域计算或批准接口，因此不增加另一套任务数据库或 runtime invariant companion。
