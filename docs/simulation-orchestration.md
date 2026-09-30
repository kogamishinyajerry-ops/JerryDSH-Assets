# 仿真四阶段接入 DSH

P0 入口是 `sim_orchestrate`：把一句任务连同已有资源引用交给一个有时限的原生子 Agent。`stage` 取 `plan`、`prepare`、`execute` 或 `review`，对应 `planner`、`inputwriter`、`runner`、`reviewer`。准备、求解和证据打包由独立 `dsh-sim` worker 执行，DSH 子 Agent 取得作业 ID 后返回，后续通过同一工程 API 查询。新入口不读取旧 `settings` 服务，也不复制 TaskSpec 或求解逻辑。

对应工程核心变更见 [dsh-sim Draft PR #4](https://github.com/kogamishinyajerry-ops/dsh-sim/pull/4)。本接入文档与该 PR 的真实 OpenFOAM 执行、证据和本地验证入口配套。

## 固定基线与职责

| 组件 | 本次基线 / 职责 |
|---|---|
| DeepSeek Harness | `0.2.0-rc.2`，源码 SHA `639ed015397290b3745d163aafe02ffee4aa3f84` |
| 原生子 Agent | `ctx.subagents.start('spawn', request)`；使用 parent、signal、toolFilter、outputSchema、persona、maxDepth |
| 声明式 preset | `@deepseek-ai/dsh-agent-preset` 的 `config.id: simulation`，以 `insert` 覆盖层加载 |
| 工程 API | [dsh-sim](https://github.com/kogamishinyajerry-ops/dsh-sim) 的规范、修订、准备回读、人工授权、队列、Run、校核与冻结证据 |
| DSH 桥 | 现有 `python -m dsh_sim.mcp.server`，仍为 12 个受限工具 |
| 本插件 | `self-built/dsh-sim-orchestrator`，仅负责分工、受限调用与摘要 |

调用 API 的桥接层保持可替换：其他 Harness 可以直接连接同一个 dsh-sim MCP server，使用相同 TaskSpec 和资源 ID。仿真核心不依赖 Cordis、DSH Web UI 或本插件。[子 Agent API](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/subagent/subagent/src/types.ts)、[preset 定义](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/preset/agent-preset/README.md)、[MCP 工具实现](https://github.com/kogamishinyajerry-ops/dsh-sim/blob/main/src/dsh_sim/mcp/server.py) 是接口依据。

## 安装与无密钥配置验证

先完成 [固定版本恢复](recovery.md) 的目录生成与 `runtime`、`web` 组件安装。以下使用该目标中的固定 CLI 和恢复时复制的插件：`runtime/node_modules/.bin/dsh`、`dsh-home/plugins/dsh-sim-orchestrator`。宿主版本与 web 依赖仍使用恢复产物已有的锁；本步骤只用本插件自己的锁安装其依赖，并在 `overlays/` 中生成独立覆盖层。下面是 macOS/Linux 命令，路径占位符需要替换为本机绝对路径。

```bash
JERRY_RECOVERY='/absolute/path/to/jerrydsh-recovery-0.2.0-rc.2'
export DSH_HOME="$JERRY_RECOVERY/dsh-home"
JERRY_DSH_CLI="$JERRY_RECOVERY/runtime/node_modules/.bin/dsh"
JERRY_SIM_PLUGIN="$DSH_HOME/plugins/dsh-sim-orchestrator"
JERRY_SIM_OVERLAY="$JERRY_RECOVERY/overlays/simulation.local.patch.yml"
export DSH_SIM_PYTHON='/absolute/path/to/dsh-sim-mcp-venv/bin/python'
export DSH_SIM_API_URL='http://127.0.0.1:8600/api/v1'
export DSH_SIM_AGENT_PROJECTS='proj_a'

cd "$JERRY_SIM_PLUGIN"
npm ci --ignore-scripts --legacy-peer-deps=false \
  --userconfig "$JERRY_RECOVERY/npmrc" \
  --globalconfig "$JERRY_RECOVERY/npm-globalrc" \
  --cache "$JERRY_RECOVERY/npm-cache"

node --input-type=module - "$JERRY_SIM_PLUGIN" "$JERRY_SIM_OVERLAY" <<'JS'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const pluginDir = resolve(process.argv[2]);
const overlay = resolve(process.argv[3]);
const source = readFileSync(join(pluginDir, 'cordis.patch.yml'), 'utf8');
const marker = /^([ \t]*)name: jerry-dsh-sim-orchestrator[ \t]*$/gm;
if ([...source.matchAll(marker)].length !== 1) throw new Error('Expected one orchestrator entry');
const entry = pathToFileURL(join(pluginDir, 'index.js')).href;
const rendered = source.replace(marker, (_line, indent) => `${indent}name: ${JSON.stringify(entry)}`);
mkdirSync(dirname(overlay), { recursive: true });
if (existsSync(overlay)) {
  if (readFileSync(overlay, 'utf8') !== rendered) throw new Error('Existing overlay differs; choose a new overlay path');
} else {
  writeFileSync(overlay, rendered, { flag: 'wx' });
}
console.log(overlay);
JS

cd "$JERRY_RECOVERY"
"$JERRY_DSH_CLI" --version
"$JERRY_DSH_CLI" --profile web --dump-config --patch "$JERRY_SIM_OVERLAY" \
  > "$JERRY_RECOVERY/overlays/simulation.composed.yml"
```

固定 CLI 的版本输出应为 `0.2.0-rc.2`。生成器只在新的 overlay 副本中把本插件的包名改为其 `index.js` 的绝对 `file:` URL；原插件文件、profile、manifest 和锁文件不变。相同内容可以重复执行，已有 overlay 内容不同则拒绝覆盖。DSH 的 [preset 挂载路径](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/preset/agent-preset-registry/src/mount.ts) 把子条目交给 Loader，[兼容性检查](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/boot/app-boot/src/compatibility-preflight.ts) 和 [Loader 导入](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/vendor/loader/src/config/tree.ts) 均支持该文件 URL；因此无需注册包名或另行安装 pnpm。

上述命令只完成插件依赖安装、覆盖层生成和配置导出，不启动 Web、LLM、MCP、工程 API 或 worker。`DSH_SIM_PYTHON` 在后续运行时必须指向安装了当前 dsh-sim 及其 `[mcp]` extra 的专用环境。MCP client 通过 argv 启动该解释器，不拼接 shell 命令；工程服务的数据库、artifact 根目录和求解器配置遵循 dsh-sim 自身说明。

覆盖层给 MCP 进程设置 `FASTMCP_CHECK_FOR_UPDATES=off` 与 `FASTMCP_SHOW_SERVER_BANNER=false`，避免 FastMCP 在协议握手前为显示 banner 查询 PyPI。这两个受支持的 FastMCP 配置来自本次实际安装版本的 `settings.py`；它们不更改网络代理或工程 API 的校验。

后续进行独立运行验证时，沿恢复流程使用同一固定 CLI，并附加 `--patch "$JERRY_SIM_OVERLAY"`，在 Web 新会话中选择 **Simulation** preset。覆盖层没有修改默认 preset；已有会话继续使用原有组合。`simulation` 本身只注册仿真 MCP 工具和 `sim_orchestrate`，不加入 Bash、任意 HTTP 或文件工具。`session-log-deepseek` 与 `session-telemetry-otel` 在覆盖层中显式禁用。

`--dump-config` 只证明配置成功合成，不会证明 Python MCP、工程服务、求解器或 LLM 可用。MCP 设置了 `failOnStartupError: true`；连接失败时该声明会暴露错误，调用也不会转成在 DSH 本机求解。DSH 的 Web host 仍可能允许其他可选插件继续启动，因此须检查 **Simulation preset** 自身是否可用。

### 当前身份范围

现有 MCP 桥以 `AGENT` 角色发送 `X-Dev-*` 头，API 默认 `prod` 模式会拒绝这些自报身份头。当前接入联调限于显式启用 `DSH_SIM_IDENTITY_MODE=dev` 的本地隔离工程服务；受信 IdP / 生产 Bearer 身份仍是 dsh-sim 的待完成项。不要为使联调通过而降低生产 API 的身份校验。

本插件没有人工授权、工程 ACCEPT、`run_any_code`、任意文件路径或身份头参数。`execute` 所需的 `authorization_id` 必须已存在于所连接工程服务，经其受信人工操作流程产生；服务端仍校验角色、项目、修订和准备摘要。DSH 中一句“开始”或一个子 Agent 的完成结果不会生成这条工程授权。[API 身份实现](https://github.com/kogamishinyajerry-ops/dsh-sim/blob/main/src/dsh_sim/api/deps.py)、[提交接口](https://github.com/kogamishinyajerry-ops/dsh-sim/blob/main/src/dsh_sim/api/services/run_service.py) 保持这一约束。

## 四阶段使用方式

把同一个任务的资源 ID 保存在后续调用中。每次 `request` 要自洽，因为 `spawn` 子 Agent 从空对话开始，不读取父会话历史；它继承父 Agent 的模型选择，插件不自行选模型或寻找凭证。

| stage / 角色 | 允许的 MCP 操作 | 结束条件与后续 |
|---|---|---|
| `plan` / planner | list_capabilities、get_task | 明确适配能力、输入和缺口；未发布能力或缺字段时返回 blocked |
| `prepare` / inputwriter | list_capabilities、get_task、create_task、revise_task、prepare_task、get_preparation | 创建/修订输入并启动准备；回读未结束时返回 pending，差异显式阻塞 |
| `execute` / runner | get_task、get_preparation、submit_runs、get_run、cancel_run | 仅提交给定授权绑定的任务；返回 run_ids，取消请求与已停止状态分别描述 |
| `review` / reviewer | get_task、get_run、build_bundle、get_evidence、draft_review_issue | 获取冻结证据并整理结论或 DRAFT 问题；不做 ACCEPT |

规范仍从工程核心读取与校验，`input` 只是传递调用者确认的 TaskDraft / TaskSpec JSON。字段缺失时，inputwriter 应把问题列为 `open_questions`，不能猜测模型、单位、模板摘要、工程阈值或来源。

以下示例说明参数，不包含可用的真实资源 ID：

```json
{
  "stage": "plan",
  "request": "核对已发布能力能否处理这个已给定几何与边界条件的稳态流动问题；说明还缺哪些确认信息。"
}
```

准备完成、人工工程授权已经形成后，才使用执行入口：

```json
{
  "stage": "execute",
  "request": "核对当前修订与准备摘要，提交这条已存在授权覆盖的工况；返回实际 run_ids 与服务当前状态。",
  "task_id": "<task-id-from-this-api>",
  "revision": 1,
  "preparation_id": "<preparation-id-from-this-api>",
  "authorization_id": "<existing-human-authorization-id>",
  "prepared_digest": "<digest-bound-to-that-authorization>"
}
```

只读复核可以直接从证据包开始：

```json
{
  "stage": "review",
  "request": "读取 Run 与冻结证据，分别报告执行状态、数值校核、适用性及证据缺口；每个发现给出资源或 artifact 引用。",
  "task_id": "<task-id-from-this-api>",
  "run_ids": ["<run-id-from-this-api>"],
  "bundle_id": "<bundle-id-from-this-api>"
}
```

正常返回带有 `schema_version: dsh-sim-delegation/v1`、角色、子会话 ID 和 `delegation_status: completed`。其中 `report.status` 只能为 `reported`、`pending`、`blocked`；这是子 Agent 摘要的状态。执行是否完成、数值是否 PASS、工程是否接受，必须查询工程服务及冻结 artifact。插件不把子 Agent 成功返回升级为工程结论。

## 长作业、取消与失败

一次委派默认最多 180 秒；所有阶段都收到父工具的取消 signal。已发布子 Agent 无论成功或失败都会释放；基础设施失败和释放失败同时出现时，两条错误都会保留。阶段超时只停止这个 DSH 委派。已经持久入队的工程作业继续由 dsh-sim 管理；需要停止求解时，对明确的 `run_id` 提交 `cancel_run` 并读取最终执行状态。

工具名白名单在子 Agent 创建窗口生效，既影响模型可见的工具，也拒绝执行被隐藏的工具。0.2 RC 实现会过滤继承自 preset 的工具，仅保留子 Agent 自身所需的结构化输出设施。provider 不支持结构化输出、过滤、persona 或 depthLimit 时，调用立即报错，不自动换后端。[原生组合实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/subagent/subagent/src/child-agent.ts)、[工具过滤实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/core/tools/src/index.ts) 是这一行为的依据。

`403`、`409`、服务不可达、规则未确认、缺少原始证据或修复无进展都应明确返回阻塞。长期运行的 worker、重试预算和所有失败 attempt 留存归工程核心，本插件不建立第二个 retry loop。

## 与独立验证 CLI 的互操作

P0 的独立真实求解验证入口输出 `schema_version: dsh-sim-validation/v1`，包含 `evidence_mode`、`identity_mode`、`task_id`、`revision`、`spec_sha256`、`preparation_id`、`prepared_digest`、`run_ids`、`bundle_id`、`bundle_digest`、`report_path`、`summary_path` 与 `limitations`。该实验在自身隔离数据库及 artifact 目录中使用 local_validation 身份，不产生可迁移的生产授权。

只有当 DSH 所连接 API 指向**同一验证数据库、项目与 artifact 集合**，并使用合适的只读查看身份时，那些 ID 才能通过 `get_task`、`get_run`、`get_evidence` 查询。不能把另一个数据库的实验 ID 直接粘贴到日常工程 API 并期待查询成功。离线 HTML/JSON 报告和哈希清单可直接作为该次实验的审阅材料；它们本身不会注册生产任务或批准工程结论。

## 配置与验证记录

| 参数 | 默认值 | 范围 / 用途 |
|---|---|---|
| `providerName` | `spawn` | 现有、支持全部所需能力的原生 provider |
| `serverName` | `dsh_sim` | `[A-Za-z0-9_-]{1,32}`；形成 `mcp__dsh_sim__<tool>` 名称 |
| `maxDepth` | `1` | 1–8；默认在顶层 Agent 下创建一个子 Agent |
| `stageTimeoutMs` | `180000` | 1000–1800000；包含启动、输出等待和取消传播 |
| `maxInputBytes` | `65536` | 1024–1048576；UTF-8 JSON 输入上限 |

本次已执行 `npm ci --ignore-scripts`，从新锁文件安装 26 个固定依赖，然后 `npm test`：**16 项通过，0 失败，0 跳过**。包括真实 Cordis 注册和卸载、四角色 allow 列表、已有授权引用缺失阻塞、子 Agent 非正常结束、缺少结构化输出、任务引用替换、父取消、deadline、双重失败留存，以及在实际 0.2 RC 工具注册表中验证 Bash / approve / 递归编排工具的隐藏与执行拒绝。

独立 `DSH_HOME` 中执行固定 CLI 的 `--dump-config` 成功，合成结果含 `preset-simulation`、MCP client 与本插件，两个遥测 / 会话上报插件均为 `disabled: true`。实际 Cordis 插件装卸验证不依赖 LLM；`--dump-config` 不启动 LLM 或求解器。**尚未运行真实 LLM 的自然语言四阶段端到端测试，也未验证生产身份接入。** 实验 CLI 的真实求解结果、失败路径和证据验证记录由 dsh-sim 同批次报告单独给出。

发布前按本页最新安装段落，在恢复目标的插件副本中再次实际执行：固定锁 `npm ci` 安装 26 个包，生成绝对 `file:` 入口 overlay，固定 CLI 输出 `0.2.0-rc.2` 并成功导出配置；两项隐私禁用和 preset 入口再次核验通过。npm 操作后 doctor 复查返回 `already-patched`，SHA-256 与恢复基线一致。该过程仍未启动 LLM、MCP 或求解器。

额外执行了真实 `@deepseek-ai/dsh-mcp-client` ↔ Python `dsh_sim.mcp.server` 的 stdio smoke：发现的工具恰好为约定的 12 个，向不可达工程 API 读取任务时得到结构化 `UNAVAILABLE`，工具桥未伪造任务结果。首次启动暴露 FastMCP banner 的版本查询触发 SOCKS 依赖错误；采用上述受支持设置关闭非必要版本查询后握手通过。该检查的 `llm_calls=0`、`solver_runs=0`，可从仓库根目录重跑：

```bash
cd /absolute/path/to/JerryDSH-Assets
node tests/orchestration/mcp-smoke.mjs /absolute/path/to/recovered/runtime /absolute/path/to/sim-venv/bin/python
```
