# overlays/ · 本地实机验收轮的 headless 直挂 overlay（脱敏交付，2026-10-01）

## 背景

web profile 的 Simulation preset 走 `agent-preset-registry`，会话内手选；**headless
profile 栈没有 preset registry**，因此一次性 headless 会话需要把仿真三件套
（persona + dsh_sim MCP client + sim_orchestrate 编排器）直接插入 profile 层。
本目录是本轮实际使用并验证过的 overlay 的**脱敏副本**（`file:` 绝对入口替换回
占位符 `jerry-dsh-sim-orchestrator`，其余逐字保留）。

| 文件 | 用途 |
| --- | --- |
| `simulation.headless.patch.yml` | 标准版（stageTimeoutMs 180000，与 web preset 一致） |
| `simulation.headless.600s.patch.yml` | 600 秒版（唯一差异 `stageTimeoutMs: 600000`；glm-4.7 的 prepare 委派多步 MCP 链在 180s 下可能被截断——文档允许范围内的配置调优，非代码改动） |

## 使用前必做

1. 按 [docs/simulation-orchestration.md](../docs/simulation-orchestration.md)
   「安装与无密钥配置验证」的生成器，把两个文件中的
   `name: jerry-dsh-sim-orchestrator` 替换为本机插件副本 `index.js` 的绝对
   `file:` URL。
2. 运行时环境变量：`DSH_SIM_PYTHON`（隔离 [mcp] venv 解释器）、`DSH_SIM_API_URL`、
   `DSH_SIM_AGENT_PROJECTS`（默认 `proj_a`，显式设置可覆盖）。
3. 启动示例：
   `dsh --profile headless --patch overlays/simulation.headless.600s.patch.yml "<任务>"`；
   配置合成验证：同命令加 `--dump-config`（应包含 simulation 三件套且双禁
   `disabled: true`）。
4. web 会话不需要本目录（web 仍用恢复流程生成的 `simulation.local.patch.yml`
   preset overlay，在 Web 新会话手选 **Simulation** preset）。

## 两仓配套提交

本目录与 dsh-sim 仓 `deployment/local-acceptance/` 同属一个返修轮：
dsh-sim 分支 `codex/p0-local-acceptance-fixes`（提交 `7260236`，基于 `42029ff`）、
本仓同名词分支（本目录提交，基于 `469d7e6`）。两 PR 均保持 Draft。

## 旧云端记录 vs 新本地记录

- 旧云端记录（PR #1/#4 head 时代）：接入文档的 preset 安装路径与 16 项 npm 测试、
  dsh-sim 的 378 passed——保留在各自文档，不因本轮改写。
- 新本地记录（本轮本机容器）：headless 直挂 overlay 实际驱动了自然语言四阶段
  全链（plan/prepare/execute/review 各子会话真实模型调用），验收细节见随交接包
  交付的 `local-acceptance.md/json` 与会话转录索引。
