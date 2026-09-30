# JerryDSH-Assets · DSH 云端资产仓

> 本机 DeepSeek Harness（dsh 0.2.0-rc.2）全部配置、自研插件、MCP 桥与研究台账的云端 SSOT。
> 目的：让任意强模型 / Agent 接手本仓库即可继续开发，不依赖原本地机器。
> 原配置快照：2026-09-30；恢复工具与仿真接入更新：2026-10-01。

## 仓库结构

```
self-built/           自研插件（可直接 npm link 或复制到 ~/.dsh/plugins/）
  jerry-aero/           民机航空域四模块：civair-kb / comac-benchmark / pdf-fta / fmea-gates
  jerry-school/         工程方法论 12 个技能目录（TDD/诊断/领域建模/架构评审…）
  dsh-sim-orchestrator/ 四阶段原生 subagent 薄接入（独立仿真核心在 dsh-sim）
mcp-bridges/          自研 MCP 桥
  zai-websearch/        Z.ai/BigModel 联网搜索桥（密钥走 macOS Keychain，不落盘）
profile-configs/      三个 profile 的 package.json + cordis.patch.yml（含隐私双禁条目）
  web/ headless/ fr-guard/
presets-legacy/       旧目录式 preset 存档（0.1.7+ 已改声明式，仅存档参考）
research/             research/01-13 研究台账 + 能力地图 HTML 报告
tools/recovery/       固定版本恢复 CLI、完整依赖锁与精确 doctor 补丁
tests/                恢复边界、原生 DSH 工具限制与委派生命周期回归
docs/                 恢复流程、仿真接入和本次验证记录
```

## 运行环境（在原机器上的基线）

| 项 | 值 |
|---|---|
| dsh 版本 | 精确固定 `0.2.0-rc.2`；恢复不依赖可变的 npm tag |
| profile | web（主）/ headless（自动化）/ fr-guard |
| 主路由 | zai-coding-cn GLM Coding Plan（`https://open.bigmodel.cn/api/coding/paas/v4`，glm-5.3 主力 + glm-4.7 自动化档） |
| 凭证 | `~/.dsh/.credentials.yaml`（**不在本仓库**，见下） |
| 隐私 | 所有 profile 的 patch 层已禁用 session-log-deepseek + session-telemetry-otel |

## 第三方插件引用表（保留原 manifest 与锁文件）

原机 web profile 装有 12 个第三方依赖。安装依据为原 manifest 与锁文件；其中
`dsh-llm-approve-for-me` 的锁定来源是 GitHub commit，并非纯 npm 镜像恢复链。
仓库保留版本、来源和锁，不重复上传第三方实现。
完整依赖清单见 `profile-configs/web/package.json`（dependencies + dsh.profile.bundles）。

| 插件 | npm 包 | 用途 | 本机版本 |
|---|---|---|---|
| 救援 | `@linxin666/dsh-doctor` | profile 事务式救助 | 0.3.24 ⚠️带手工补丁* |
| 自动化 | `@michengai/dsh-automation` | 计划任务 | 0.1.53 |
| 技能管理 | `@michengai/dsh-skills-manager` | 本机技能加载 | 1.1.7 |
| 记忆 | `@openviking/dsh-memory-plugin` | OpenViking 持久记忆 | 0.5.9（需 OpenViking server） |
| 架构图 | `@tt-a1i/archify-dsh` | 架构图技能 | 0.1.0 |
| IM 桥 | `@xmanrui/dsh-im` | 9 平台消息桥 | 4.32.0 |
| 科研 | `dsh-aris` | 87 科研技能 | 0.1.1 |
| 上下文 | `dsh-context` | 上下文仪表盘 | 0.60.0 |
| 审批 | `dsh-llm-approve-for-me` | LLM 审批代审 | 0.4.10 |
| PDF | `dsh-pdf-reader` | 视觉模型 PDF 精读 | 0.2.0 |
| 高峰门 | `dsh-session-guard` | 会话门控 | 4.0.0（fr-guard 同款） |
| 插件市场 | `dshmarket` | Web 内插件市场 | 1.66.6 |

*doctor 0.3.24 补丁：0.1.7+ 删除了 `settingsScope` 服务，需从其 client.js 的 inject 列表移除该项。恢复 CLI 只在包版本、全文件前像 SHA-256、修改片段和后像 SHA-256 均匹配时修补，保留 `.orig` 和回执；npm 操作后必须复验。见 [恢复说明](docs/recovery.md)。

**已清退归档**（历史决策，勿重装）：memsearch / weknora / routing-suite / univer-office / browser-skill——理由见 research/06 与项目记忆。

**官方平台**（deepseek-ai/deepseek-harness）：dsh 本体、内置 preset（standard/ptc/minimal/cordis）、全部官方包——永远从 npm / GitHub 获取。

## 在新机器上恢复

从仓库根生成一个新目录，再按组件安装。使用 Node `22.19+` 或 `24+`；目标必须
不存在。准备与检查不会读取原机凭证，安装不会改动原 profile。

```sh
JERRY_RECOVERY="$PWD/../jerrydsh-recovery-0.2.0-rc.2"
node tools/recovery/recover.mjs prepare --target "$JERRY_RECOVERY"
node tools/recovery/recover.mjs check --target "$JERRY_RECOVERY"
node tools/recovery/recover.mjs install --target "$JERRY_RECOVERY" --component runtime
node tools/recovery/recover.mjs install --target "$JERRY_RECOVERY" --component web
node tools/recovery/recover.mjs launch-plan --target "$JERRY_RECOVERY"
```

`launch-plan` 输出准确的 `--profile web` 命令及进程专用的 `DSH_HOME` 环境。
先按 [完整恢复流程](docs/recovery.md) 检查结果，再按既有凭证纪律配置模型并启动。
原业务后端和 macOS Keychain 的可用性分别验证；配置生成通过不代表整套业务已恢复。

## P0 仿真编排

仿真 TaskSpec、队列、租约、真实求解、独立校核和证据冻结复用
[dsh-sim](https://github.com/kogamishinyajerry-ops/dsh-sim)。本仓新增的
`jerry-dsh-sim-orchestrator` 使用 DSH `0.2.0-rc.2` 原生 subagent，将任务分成
planner、inputwriter、runner、reviewer 四个有明确工具范围的阶段。每次委派快速返回
资源引用，长时间计算由仿真 Worker 继续执行。

新接入是显式启用的声明式 `simulation` preset。它调用现有 12 个工程 MCP 工具，
沿用工程服务的人工授权与接受门。详细安装、工具映射、离线可核验证据和实际验证范围见
[仿真接入说明](docs/simulation-orchestration.md)。自然语言在线端到端验证需要可用模型连接；
无密钥装载、MCP 握手和确定性测试分别记录，不能据此声称在线闭环已验收。

## 密钥纪律

- 本仓库**零密钥**：所有 API key 只存在于原机 `~/.dsh/.credentials.yaml` 与 macOS Keychain
- zai-websearch 桥运行时从 Keychain 读（`security find-generic-password -s glm-api-key -w`），代码无密钥
- GLM Coding Plan 端点：`https://open.bigmodel.cn/api/coding/paas/v4`（OpenAI 兼容）/ `https://open.bigmodel.cn/api/anthropic`（Anthropic 协议备用）

## 上游与关联仓库

- [dsh 官方](https://github.com/deepseek-ai/deepseek-harness)：固定基线的原生平台。
- [dsh-sim](https://github.com/kogamishinyajerry-ops/dsh-sim)：可跨 Harness 使用的仿真核心。
- [Foam-Agent](https://github.com/csml-rpi/Foam-Agent)：多角色求解与复核范式参考。
- [JerryDSH](https://github.com/kogamishinyajerry-ops/JerryDSH)：原研究主仓，本仓保留台账副本。
