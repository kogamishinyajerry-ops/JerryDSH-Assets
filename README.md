# JerryDSH-Assets · DSH 云端资产仓

> 本机 DeepSeek Harness（dsh 0.2.0-rc.2）全部配置、自研插件、MCP 桥与研究台账的云端 SSOT。
> 目的：让任意强模型 / Agent 接手本仓库即可继续开发，不依赖原本地机器。
> 快照日期：2026-09-30

## 仓库结构

```
self-built/           自研插件（可直接 npm link 或复制到 ~/.dsh/plugins/）
  jerry-aero/           民机航空域四模块：civair-kb / comac-benchmark / pdf-fta / fmea-gates
  jerry-school/         工程方法论 10 技能（TDD/诊断/领域建模/架构评审…）
mcp-bridges/          自研 MCP 桥
  zai-websearch/        Z.ai/BigModel 联网搜索桥（密钥走 macOS Keychain，不落盘）
profile-configs/      三个 profile 的 package.json + cordis.patch.yml（含隐私双禁条目）
  web/ headless/ fr-guard/
presets-legacy/       旧目录式 preset 存档（0.1.7+ 已改声明式，仅存档参考）
research/             research/01-13 研究台账 + 能力地图 HTML 报告
```

## 运行环境（在原机器上的基线）

| 项 | 值 |
|---|---|
| dsh 版本 | 0.2.0-rc.2（npm `latest` tag） |
| profile | web（主）/ headless（自动化）/ fr-guard |
| 主路由 | zai-coding-cn GLM Coding Plan（`https://open.bigmodel.cn/api/coding/paas/v4`，glm-5.3 主力 + glm-4.7 自动化档） |
| 凭证 | `~/.dsh/.credentials.yaml`（**不在本仓库**，见下） |
| 隐私 | 所有 profile 的 patch 层已禁用 session-log-deepseek + session-telemetry-otel |

## 第三方插件引用表（npm 可直接获取，不重复上传）

本机 web profile 装有 12 个第三方插件，全部可从 npm 恢复，**无需存储在本仓库**。
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

*doctor 0.3.24 手工补丁：0.1.7+ 删除了 `settingsScope` 服务，需从其 client.js 的 inject 列表移除该项（备份 .orig 同目录）。npm 装完要重打，详见 research/06 §3.12。

**已清退归档**（历史决策，勿重装）：memsearch / weknora / routing-suite / univer-office / browser-skill——理由见 research/06 与项目记忆。

**官方平台**（deepseek-ai/deepseek-harness）：dsh 本体、内置 preset（standard/ptc/minimal/cordis）、全部官方包——永远从 npm / GitHub 获取。

## 在新机器上恢复

```sh
# 1. 装 dsh
npm install -g @deepseek-ai/dsh@latest
# 2. 恢复自研插件
cp -R self-built/* ~/.dsh/plugins/
# 3. 恢复 profile 配置
cp profile-configs/web/{package.json,cordis.patch.yml} ~/.dsh/profiles/web/
cd ~/.dsh/profiles/web && npm install --legacy-peer-deps
# 4. 恢复 MCP 桥（zai-websearch）
cp -R mcp-bridges/zai-websearch ~/.dsh/mcp/ && cd ~/.dsh/mcp/zai-websearch && npm install
# 5. 凭证（人工）：从密码管理器恢复 ~/.dsh/.credentials.yaml（ZAI_CODING_CN_API_KEY / MINIMAX_CN_API_KEY）
# 6. 起服务
dsh web --port 3080
```

## 密钥纪律

- 本仓库**零密钥**：所有 API key 只存在于原机 `~/.dsh/.credentials.yaml` 与 macOS Keychain
- zai-websearch 桥运行时从 Keychain 读（`security find-generic-password -s glm-api-key -w`），代码无密钥
- GLM Coding Plan 端点：`https://open.bigmodel.cn/api/coding/paas/v4`（OpenAI 兼容）/ `https://open.bigmodel.cn/api/anthropic`（Anthropic 协议备用）

## 上游与关联仓库

- **dsh 官方**：https://github.com/deepseek-ai/deepseek-harness（平台本体，勿在此重造）
- **Foam-Agent**（P0 编排层候选）：https://github.com/csml-rpi/Foam-Agent
- 原研究主仓：JerryDSH（本仓 research/ 即其台账副本）
