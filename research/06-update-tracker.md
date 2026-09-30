# 06 · DSH 版本更新追踪（常驻文档）

> 目的：**可续写**的版本追踪文档。每次"有没有新版/该不该升级"的问题从这里查/续写，不另开新篇。
> 体例同 01-05：结论先行、证据附录；结论标注 **[实测]**（本机跑过）/ **[源码]**（读源码或 git log 得出）/ **[推断]**（合理外推，未实证）。
> 上游基线：本机 dsh 0.2.0-rc.2（npm `latest` tag，2026-09-30 升级）；上一份时间线见 01 §二（rc.5→rc.2 主题级）。

## 一、当前状态快照（最近核查：2026-09-30 13:55 +0800）

**[实测] 本机已升级至 0.2.0-rc.2（npm `latest` tag，09-29 发布），5/5 profile 可用（09-26 后用户清掉 32 个测试 profile，现存 comac-demo-h/comac-demo-web/fr-guard/headless/web），隐私上报禁用继续生效，主路由 zai GLM Coding Plan（coding 端点 + 新 key）。**

| 信号源 | 结果（2026-09-30 核查） |
|---|---|
| npm `dist-tags` | `latest` = `next` = **0.2.0-rc.2**（09-29）；`alpha` = 0.1.7-alpha.2（旧） |
| GitHub Releases | dsh-v0.2.0-rc.2（Pre-release，09-29），assets 仍空（官方桌面安装包依旧不随 release 分发） |
| 本机全局 | `~/.npm-global` 已装 **0.2.0-rc.2**，演练 + headless 端到端 + 3080 RPC 全过 |
| 备份链 | pre-0.1.6 / pre-0.1.7 / **pre-0.2.0**（2.9GB，凭证 md5 52f1a6ee… 全程不变） |
| 插件 | 3 个升级适配（skills-manager 1.1.7 / automation 0.1.53 / session-guard 4.0.0），2 个精确豁免（univer-office / browser-skill，无新版） |

**升级执行记录（2026-09-18，全程按 §2.3 红线，详见 §3.8）**：演练先行（APFS clone + 副本 HOME headless boot）→ 持久备份 `~/.dsh-backup-pre-0.1.6/`（2.3GB）→ 全局升级 → 36 profile patch 层统一禁用隐私上报插件 → 全量扫描 36/37 绿。

**rc.2 与 rc.1 差异**：仅 UI 打磨（反馈弹窗、文件卡片排版），无结构变更。**升级目标选 `latest`（rc.1）或 `next`（rc.2）皆可，本机取 rc.2。**

## 二、追踪方法（本档的续写协议）

### 2.1 三步核查（约 30 秒）

```sh
# ① npm 侧：有无新版本/新 dist-tag
export npm_config_cache=/tmp/dsh-npm-cache
npm view @deepseek-ai/dsh dist-tags version time --json | tail -30

# ② git 侧：master 有无 rc.2 之后的 commit（浅克隆已就位 /tmp/dsh-repo）
cd /tmp/dsh-repo && git fetch origin master --shallow-since=2026-08-08 \
  && git log --oneline HEAD..FETCH_HEAD | head -30
#   ↑ 空输出=无动态。注意 fetch 落在 FETCH_HEAD，本地 origin/master 引用不一定更新

# ③ GitHub Releases（佐证 + release notes）
gh release list --repo deepseek-ai/deepseek-harness --limit 5
```

浅克隆失效（/tmp 被清）就重建：`git clone --shallow-since=<90天前日期> https://github.com/deepseek-ai/deepseek-harness /tmp/dsh-repo`。要看更早历史必须重新浅克隆（浅克隆边界不会自动前推）。

### 2.2 新版本落地后的归纳法（feat/fix 过滤法，承接 01 附录）

```sh
cd /tmp/dsh-repo
# tag 命名规则：dsh-v<版本号>。新区间：
git log --no-merges --format='%s' dsh-v0.1.1-rc.2..dsh-v<新tag> | grep -cE '^feat'   # feat 数
git log --no-merges --format='%s' dsh-v0.1.1-rc.2..dsh-v<新tag> | grep -E '^feat'    # feat 明细
git log --no-merges --format='%s' dsh-v0.1.1-rc.2..dsh-v<新tag> | grep -E '^fix' \
  | sed -E 's/^fix(\(([a-z0-9,-]+)\))?:.*/\1/' | sort | uniq -c | sort -rn           # fix 按 scope 聚合
```

commit 规范是 Conventional Commits（`feat(scope):`/`fix(scope):`）+ `Merge pull request` 合并节点，统计一律加 `--no-merges`。feat 逐条读（每版 ≤30 条），fix 只看 scope 聚合 + 高频域抽样，性价比最高。

### 2.3 新版本行为验证（/tmp 隔离 prefix，不碰全局）

```sh
export npm_config_cache=/tmp/dsh-npm-cache
npm install --prefix /tmp/dsh-new @deepseek-ai/dsh@<新版本>   # 隔离安装
/tmp/dsh-new/node_modules/.bin/dsh --version                 # 确认版本
# 冒烟：--dump-config 离线合成（不解析凭证，永远安全）→ 再起隔离 profile（--profile 指向新建目录，凭证/settings 用副本）
```

红线（承 01/05）：不升级全局、不动 `~/.dsh/.credentials.yaml` 与活 settings、不占 3080；**新版格式写出的文件可能让旧核心挂**（凭证换代先例），所以任何新版的落盘产物先在隔离 profile 里看。

## 三、基线：rc.5 → 0.1.1-rc.2 逐版本 commit 级归纳

> 01 §二 已有主题级表格；本节补 commit 级明细，作为后续区间的对照基线。**[源码]**（git log 归纳，区间与计数见附录）。

### 3.1 版本节奏总览

| 版本 | npm 时间 (UTC) | 区间 commit（no-merge） | feat/fix | 主题一句话 |
|---|---|---|---|---|
| 0.1.0-rc.5 | 08-12 22:36 | —（基线，本机曾长期在用） | — | — |
| 0.1.0-rc.6 | 08-13 12:35 | （**npm 有发布、仓库无 tag**，01 时间线同样跳过） | — | 未单列 |
| 0.1.0-rc.7 | 08-17 11:50 | 196 | 17 / — | subagent 提供商化 + 交互打磨 |
| 0.1.0-rc.8 | 08-19 15:41 | 294 | 30 / 123 | **SQLite 会话布局** + Agent Teams + Windows 栈 |
| 0.1.1-rc.1 | 08-21 06:49 | 111 | 12 / 46 | **凭证系统重构** + webserver 注入表 |
| 0.1.1-rc.2 | 08-21 12:42 | 31 | 4 / 7 | **图片/附件统一管线**（当前 latest） |

8 月中旬节奏 ≈ 2-4 天一版、rc 尾号在 0.1.0→0.1.1 间翻位；rc.2 之后进入 ≥29 小时静默（史上最长空窗之一，**[推断]** 大版本或休假窗口，无证据不猜）。

### 3.2 rc.5→rc.7（196 commits，17 feat）

- **subagent 提供商化第一波**：Codex / Claude Code 非交互权限模式 + 两者可直接安装（`feat(subagent)` ×4）
- 交互：ask-user 问题卡折叠、onboarding 对话框统一、workflow run/phase 披露控制
- 模型：`llm-deepseek` low reasoning effort；模型重试默认 5 次
- **`session-query` 全文会话搜索（opt-in，`openAt never`）**——07 的旁证：会话存储已支持 FTS
- composer 图片附件走路由命令、python-sdk 预置运行时依赖、release 管线加固 ×2

### 3.3 rc.7→rc.8（294 commits，30 feat / 123 fix，全区间最大版本）

- **`feat(session): optimize SQLite persistence layout`（93b4b98）**——07 深潜的入口 commit
- **`feat(team): durable Agent Teams runtime`**——多 agent 团队常驻运行时（新域）
- Windows 栈三连：持久 pwsh PTY 工具、pwsh shell 方言、终端巡检/信号（01 已提的 pwsh 工具即此）
- subagent 第二波：命名 Codex/Claude provider 实例
- 模型/管线：`llm-deepseek` multimodal、agent-loop 取消流的 delivered prefix 收尾
- web/client：**默认自动打开 Web UI**、部署品牌 slots、构建产物绑定 profile、模型批量选择、插件加载进度、反馈浮层
- fix 大头：subagent(22) ci(12) web(8) locale(7) client(7) workflow(5) llm-pi-ai(5) pty(4)——subagent 新域在 rc.8 内自 stabilizing

### 3.4 rc.8→0.1.1-rc.1（111 commits，12 feat / 46 fix）

- **凭证系统重构四连**：durable credential records（refs 旁挂记录）/ boot 时升级旧扁平文档（rc.5 崩溃根因的解药）/ authorization 向人索取凭证 / llm-pi-ai provider 登录制
- **`feat(webserver): structured index injection table + client boot seams`**——插件客户端下发（05 §8）的底层契约化
- web：subagent header 切换器、ask_user_question 多行、宽表格 hover 滚动条、markdown 表格按列宽、near-full cache-hit 精度
- `feat(llm-deepseek)`: vision model 发布；`feat(atomic-write)`: 写锁等待上限按调用声明
- fix 域：i18n(9) web(8) cic(8)，另有 **session-projection / sandbox / snapshot 各 1**（session-projection 是 07 的直接对象）

### 3.6 0.1.1-rc.2 → 0.1.5-rc.2 升级兼容性台账（2026-09-14 实测）

**核心结构变更**（对应 05 §11 新机制条目）：

- **Session 格式 V3**：老日志惰性迁移（读到才转、生成新文件、保留原文件），新会话直接写 `session.v3.jsonl.zstd`；不支持降级读取
- **凭证零迁移**：0.1.1 的 version+refs 结构未被再次改动，0.1.5 下 md5 不变照常工作
- **默认工具调整**：SDK/Headless/ACP 默认 read/write/edit；Web minimal 仅持久 shell，`str_replace_editor` 需显式启用
- **公网 WebFetch 默认启用**（SSRF 防护内置，不再逐次审批）
- **插件 API 破坏性变更**：`ctx.agent` 移除、Inbox 转纯类型接口、web 面板 `conversation` slot → `main.conversation`
- **web 一次性 token 认证**：URL 带 `?token=`，缺凭证的 API 请求 401

**30 profile 扫描结果与修复台账**：

| Profile | 结果 | 根因 → 修复 |
|---|---|---|
| cz-duo / sr-rewind | ❌→✅ | `@anionex/dsh-turn-rewind` 0.1.x 调已移除 API（`findLast` of undefined）→ 升 0.3.8 |
| sr-talk | ❌→✅ | profile 缓存 0.1.0-rc.6 旧官方包遮蔽新版内置包（crosstalk 旧版 dependencies 残留）→ 清 node_modules 重装 crosstalk |
| plugtest | ❌→✅ | `dsh-advisor`/`dshmarket`/`dsh-thread`/`subagent-registry` 均引用已删导出（`settingsNamespace`/`installSettingsSection`）→ 全部升 latest；另 better-sqlite3 native binding 需 `pnpm rebuild`（NODE_MODULE_VERSION 137→127） |
| ep-ssh / fr-cron | ❌→✅ | 新版 dsh-base 已内置 storage 服务链，profile 手动补挂的 `- insert: id: storage` 撞 `duplicate loader entry id` → 改 id-targeted 覆盖（只留 /tmp 路径覆盖） |
| teamops-test / teamos-c | ❌→✅ | 自研 `@flai/dsh-teamops` file: link 的 pnpm store 快照缺新编译产物 → `dsh plugin add` 重装 link |
| gr-review-h | ❌（升级前已坏） | `gr-ws-stub` link 指向 /tmp 被系统清理，与本次升级无关 |
| 其余 21 个 | ✅ 直接通过 | — |

**踩坑记录**：

- **隔离 boot 的 stale lock**：超时被杀会留 `profiles/node_modules.lock`，下次 boot 报 `atomic-write: timed out waiting for the writer lock`，rm 掉即恢复
- **`dsh web --help` 会碰活 HOME**（无 DSH_HOME 覆盖时），首启还很慢（~4 min）——对新二进制的任何操作先想清楚 HOME 指向
- **新版遵循 HTTP_PROXY 等环境变量**（rc.1 新特性）；本机 shell 无代理注入，未触发 Clash fake-ip 问题，但挂代理环境时要留意
- **05 §8 的 `/plugins/<pkg>/client.js` 探测法已失效**，见 05 §11

### 3.5 rc.1→rc.2（31 commits，4 feat / 7 fix，小版本收口）

- 图片/附件统一管线四连：master+Files 双请求管线 / 确定性 canonical 编码 / read_image 报告缩放尺寸与坐标比例 / source upload envelope
- fix 全部服务该管线：Files/stream 超时解耦、Files 解析失败回退、WebP alpha、missing ids 解析、canonical budget 前置校验
- 另回滚了一个权限复制 PR（01 已提）

### 3.7 0.1.6-alpha.1 核查（2026-09-15 发布，仅评估未升级）

**版本状态 [实测]**：npm 已发 0.1.6-alpha.1，但 dist-tags `latest` 仍为 0.1.5-rc.1、`next` 为 0.1.5-rc.2——官方未将其推入任何稳定 tag，属 alpha 预览。npmmirror 有完整同步（`registry.npmmirror.com/@deepseek-ai/dsh/-/dsh-0.1.6-alpha.1.tgz`）。

**新功能（release notes 归纳）**：
- **SSH 远程工作区**：本地跑 DSH、工作区在远端机器（内网跳板场景高价值）
- Web 侧边栏终端（多标签/Shell 选择/刷新恢复）；归档会话列表
- MCP 升官方 SDK v2（协议协商/工具分页）+ MCP 资源发现与 URI 模板
- Headless：stdin 输入 / `--session-id` / `--json` 事件流（自动化管线利器）
- 实验性：Browser Use（Playwright/Chrome DevTools/Stagehand）、Computer Use（Cua Driver）、Auto review
- DeepSeek V4.1 图片适配；持久 Bash 性能提升

**破坏性变更（11 条，即未来升级的插件迁移清单）**：
1. DeepSeek 默认 Messages 协议，旧官方根地址须改 `https://api.deepseek.com/anthropic`
2. PTC 统一改名 `ptc-runtime`（无旧别名）；workflow 执行器改 `workflow-ptc`
3. `agent/session-start` → 异步 `agent/created`；同步历史 API（snapshotEvents/eventAt/ownEvents）弃用
4. Team 模式仅 `spawn_teammate`；Ralph 默认关；内置 E2B 移除
5. Node PTC 独立进程且 `process.env` 为空；热更新取消事务回滚
6. 图片缓存迁 `DSH_HOME/cache/attachments/request-images`
7. **官方端点默认开启实验性会话事件上报（可配置关闭）——内网部署隐私红线**

**结论 [推断]**：不升级。本机保持 0.1.5-rc.2 稳态（29/30 profile 全绿），等 0.1.6-rc.1 再走 §2.3 演练协议。内网 win32 离线包如需 0.1.6 功能（SSH 远程工作区）可按 09-14 方案重建，演练阶段先确认无新增 native 依赖。
**（2026-09-18 更新：该"等 rc"结论被用户指令覆盖，已直接升 alpha.2，见 §3.8。）**

### 3.8 0.1.6-alpha.2 升级实录（2026-09-18 执行）

**决策变更**：alpha.2（09-17）发布后用户明确要求"更新到最新版"。npm `latest` 仍停 0.1.5-rc.2，故本次属**主动追 alpha 通道**，非稳定版升级。回退路径完整保留：`~/.dsh-backup-pre-0.1.6/`（2.3GB APFS clone，凭证 md5=82cd9a44…）+ `npm install -g @deepseek-ai/dsh@0.1.5-rc.2`。

**alpha.2 相对 alpha.1 的主要新东西（release notes）**：插件管理页（装/配置/实时启停）、回合结束文件改动卡片（侧边栏逐文件 diff 审阅）、Office 文件侧边栏预览（Word/Excel/PPT）、侧边栏浏览器模式、Subagent 会话侧边栏打开、提交计划预览、`dsh <profile>` 快捷启动、CLI/Web 启动提速。**插件依赖改运行时解析 + Plugin Manager 运行时卸载**（第三方插件作者需自查加载/卸载逻辑）。

**执行台账（全程零事故，凭证 md5 全程 82cd9a44… 不变）**：

1. 隔离安装 `/tmp/dsh-new` + 冒烟通过。发现 **`--profile` 不再接受绝对路径**（profile 名含 `/` 直接抛 invalid）——测试脚本要改用 `DSH_HOME` 指向隔离目录
2. APFS clone 演练 `/tmp/dsh-upgrade-drill`：新二进制 headless boot + LLM 真调用成功（走 zai-coding-cn provider）
3. 持久备份 `~/.dsh-backup-pre-0.1.6/`（2.3GB）
4. 全局升级 `npm install -g @deepseek-ai/dsh@0.1.6-alpha.2` + headless 冒烟通过
5. **隐私红线处置**：alpha.1 标记的"会话事件上报"实锤为两个插件——`@deepseek-ai/dsh-session-log-deepseek`（向官方 API 请求体注入 `dsh_session_log` 增量后缀，README 明示 overlay `enabled: false` 可关）与 `@deepseek-ai/dsh-session-telemetry-otel`（OTLP 上报到 `harness-telemetry.deepseeksvc.com/v1/logs`，`DSH_TELEMETRY_MODE=OFF` 可关，默认 FEEDBACK_ONLY）。**本机全部 36 个 profile 的 cordis.patch.yml 统一追加 `disabled: true` 双禁**，dump-config 验证生效。注：本机主 provider 是 zai-coding-cn 非官方端点，session-log 后缀本就不会触发，禁用属纵深防御；遥测通道与 provider 无关，必须禁
6. 3080 web 重启：带 `DSH_TELEMETRY_DISABLED=1 DSH_TELEMETRY_MODE=OFF` 起 `dsh web --port 3080`，一次性 token 认证正常（401/303 为预期行为）

**profile 扫描结果（37 个）**：

| 结果 | 数 | 明细 |
|---|---|---|
| ✅ 直接绿 | 36 | 其余全部 profile（含 09-14 修复过的 cz-duo/sr-talk/plugtest/ep-ssh/teamops 系全部保持绿） |
| ❌ 升级前已坏 | 1 | gr-review-h：`gr-ws-stub` file: link 指向 /tmp 已被系统清理，与本次升级无关（09-14 台账同款问题） |

**本次踩坑（新）**：

- **空 patch 层的 YAML 双文档陷阱**：22 个 profile 的 cordis.patch.yml 原本是独立 `[]` 文档，直接追加 `- id:` 列表项会形成第二文档导致 `YAMLException: end of the stream or a document separator is expected`。修复：删掉 `[]` 行再追加。**批量改 patch 前先看目标文件是 `[]` 空文档还是已有列表**

### 3.9 升级后故障：智能路由 preset 挂导致无法发会话/切模型（2026-09-18 深夜修复）

**现象**：升级后 Web UI 无法切换模型、无法发起会话。服务端日志零报错，routing-suite 状态 API 正常（`/routing-suite/api/status` 返回 ok）。

**根因 [实测]**：`~/.dsh/.agent-presets/routing-suite/`（以及 videoagent）是 0.1.5 时代 standard preset 的拷贝，其中引用 `@deepseek-ai/dsh-workflow-worker-thread`——该包在 0.1.6 改名 `@deepseek-ai/dsh-workflow-ptc`（alpha.1 破坏性变更清单第 2 条）。agent-presets 的健康检查发现 row 无法解析后把整个 preset 标 `broken`，**选择器直接丢弃 broken 行**；而 settings.yaml 里 `agent-presets.default: routing-suite` 是默认 preset——默认 preset 挂了，会话就发不起来、模型选择器也不正常。

**诊断方法（RPC 直查 roster，比看 UI 快）**：

```sh
TOKEN=$(grep -oE "token=[A-Za-z0-9_-]+" /tmp/dsh-web-3080.log | head -1 | cut -d= -f2)
curl -s -c /tmp/c.txt -o /dev/null "http://127.0.0.1:3080/?token=$TOKEN"
curl -s -b /tmp/c.txt -X POST -H "Content-Type: application/json" \
  -d '{"type":"client-request","rpcId":"t","method":"agentPresets/list","payload":{"args":{}}}' \
  "http://127.0.0.1:3080/api/agentPresets/list"
# preset 带 "broken" 字段即中招
```

**修复（改 `~/.dsh/.agent-presets/<id>/agent.cordis.yml`，preset 发现是每次调用重读目录，无需重启）**：

1. `workflow-worker-thread` → `workflow-ptc`（包名 `@deepseek-ai/dsh-workflow-ptc`）——**致命项**
2. `tool-ralph` 行加 `disabled: true`（官方 0.1.6 standard 已默认关，alpha.1 变更 #4）
3. 尾部补 `tool-plugin-manager`（`@deepseek-ai/dsh-plugin-manager/tools`，`disabled: true` 占位，跟随官方）

routing-suite 与 videoagent 都已修复，复验 roster 全绿：`routing-suite [DEFAULT] -> OK`。端到端验证：`session/create`（presetId=routing-suite）返回 sessionId，`session/modelCatalog` 返回 8 个可路由 provider（deepseek-official/zai/kimi/minimax/opencode-go + 3 个 vision-toolkit 系）、零 failures。

**适配 SOP（0.1.7+ 再遇 preset broken）**：diff 本机 preset 与 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml`（当前版本的官方基线），把包改名/新增行同步过来，插件本体逻辑（如 routing-suite 的 system-prompt hook）不用动。preset 是拷贝不是引用，**每次大版本升级后要过一遍这个 diff**。

**顺带排掉的嫌疑**：routing-suite 插件本体（服务端 status API + system-prompt hook + settings.section 客户端面板）在 0.1.6 下全部正常工作，不需要适配——挂的只是它的 preset 壳。npm 上 routing-suite 0.1.2 仍是最新版，无官方 0.1.6 适配版可升。

### 3.10 升级后"只剩 Minimax 可用"排查（2026-09-18 深夜，与升级无关）

**现象**：模型选择器里 GLM/OpenCode Go 不可用，疑似只剩 Minimax。

**排查结论（curl 直测三家 API，一锤定音）**：

| Provider | curl 实测 | 结论 |
|---|---|---|
| zai-coding-cn (GLM) | HTTP 401 `令牌已过期或验证不正确`（chat + models 双端点） | **API key 过期**，与升级无关 |
| opencode-go | HTTP 401 `CreditsError: Insufficient balance` | **余额耗尽**，需充值，与升级无关 |
| minimax-cn | HTTP 200 正常回复 | 唯一健康 |

**另发现 settings.yaml 已被改写（23:59 mtime，比 3.9 修复更晚）**：对比 `~/.dsh-backup-pre-0.1.6/settings.yaml`，当前版本少了 glm-5.3/glm-4.7/glm-5-turbo/glm-5.1/glm-5.2/glm-5v-turbo、**kimi-coding provider 整段被删**、opencode-go 少了 qwen3.8-flash，默认模型从 zai glm-5.3-flash(max) 改为 minimax MiniMax-M3(high)。推测为 0.1.6 设置页（模型批量选择/设置写回）或用户在 UI 侧操作所致——0.1.5 时代的 settings 是这么被 Web UI 编辑的：设置页保存会整体重写该文件。**kimi-coding 被删但 KIMI_CODING_API_KEY 仍在 credentials**（实测也 401 Invalid Authentication，moonshot key 同样失效）。web.log 里 zai-mcp bridge（glm-4.6）是 ComfyUI MCP 桥，与此无关。

**处置**：
1. GLM：去 open.bigmodel.cn 重新生成 API key，替换 `~/.dsh/.credentials.yaml` 的 `ZAI_CODING_CN_API_KEY` 值
2. OpenCode Go：opencode.ai/zen 充值（key 本身有效，只是 CreditsError）
3. kimi：moonshot key 也失效，若还要用同样需换 key，并把 `kimi-coding:` provider 段落补回 settings.yaml（可从 `~/.dsh-backup-pre-0.1.6/settings.yaml` 拷贝）
4. 模型清单收窄：如需恢复完整 GLM 家族（glm-5.3/glm-4.7/glm-5-turbo 等），同样从备份 settings.yaml 把 models 列表拷回

**教训**：dsh 的 settings.yaml 会被 Web UI 整体重写（保存设置/切默认模型都会动它），**自定义 provider 段落建议在 `~/.dsh/settings.user.yaml` 或 profile patch 层维护**（如果版本支持），否则每次 UI 操作都可能丢字段；`.dsh-backup-pre-*` 目录是恢复基线。

### 3.11 0.1.7-rc.2 升级实录（2026-09-26 执行）

**版本通道变化**：npm `latest` 已推进到 0.1.5-rc.3（09-22），`next` 指向 **0.1.7-rc.2**（09-24）。0.1.7 走 alpha.1→alpha.2→rc.1→rc.2 四连发（09-22 至 09-24，两天四版）。回退路径：`~/.dsh-backup-pre-0.1.7/`（2.3GB APFS clone）+ `npm install -g @deepseek-ai/dsh@0.1.6-alpha.2`。

**0.1.7 相对 0.1.6-alpha.2 的核心新东西（git log 归纳，区间 154 feat）**：

- **settings 换代**：boot 时把 `settings.yaml` 改名 `settings.yaml.imported`（一次性迁移，旧文件保留），设置转入内部存储；`agent-default-model`/自定义 provider 列表迁移后照常生效
- **Session V4 corpus migration**（一次性命令 + 并行迁移 + 结构化迁移摘要）
- 桌面端大补：首次使用引导、关窗后台运行、定时任务/提醒管理（最短每分钟）、快捷键自定义、crash report
- Web：归档三态筛选、会话分组引用、Excel/csv/tsv 浏览器预览、动态工具更新投影
- **插件 peer 兼容强制检查**：`feat(plugins): enforce DSH peer compatibility with exact exemptions`——旧插件按 peerDependencies 精确拦截，可 `dsh plugin allow-version` 豁免
- telemetry：新增显式 product event OTLP exporter（默认仍 FEEDBACK_ONLY，patch 层双禁继续有效）

**执行台账（凭证 md5 全程 c70216fd… 不变）**：

1. 隔离安装 `/tmp/dsh-new` + dump-config 冒烟通过
2. APFS clone 演练 `/tmp/dsh-upgrade-drill`：settings 自动迁移（`.imported` 落盘）后 LLM 真调用成功
3. 持久备份 `~/.dsh-backup-pre-0.1.7/`（2.3GB）
4. 全局升级 + 3080 web 重启（DSH_TELEMETRY 双 OFF）
5. profile 扫描：**37/37 全绿**（09-18 坏的 gr-review-h 这次也过了）
6. RPC 验证：`agentPresets/list` 只列内置 4 个（standard/ptc/minimal/cordis）——**0.1.7 preset 发现机制变化，`~/.dsh/.agent-presets/` 下的自定义 preset（routing-suite/videoagent/eng-bricks）不再出现在列表**；`session/create` 成功、`session/modelCatalog` 返回 4 provider（deepseek-official/zai/minimax/opencode-go）全可路由

**升级后适配（当天完成）**：

- **dsh-session-guard 0.1.2 被 peer 检查拦截**（`web`/`fr-guard` profile boot 报 incompatible）→ 升 3.0.0（web profile 需 `--legacy-peer-deps`），dump-config 复验干净
- **`--profile` 行为再变**：0.1.6-alpha.2 不接受绝对路径，0.1.7 连 `dsh --profile web "任务文本"` 的位置参数也报 `too many arguments`——headless 单问句式任务现在只对 headless profile 有效，web profile 必须走 RPC/Web UI

**遗留问题（升级前已存在，非本次引入）**：

- **opencode-go 路由 400 MissingSessionID**：pi-ai 0.85.1 对 opencode zen/go 端点未按其新要求发 `x-opencode-session` 头（curl 直测带该头 200 OK，不带 400）。新旧二进制同报错（0.1.6 对照复现），**服务端 09-25 左右新增强制要求，dsh/pi-ai 尚未适配**。处置：默认模型切走 opencode-go 或等 pi-ai 修复；测试路由用 minimax-cn（本次冒烟即走 minimax MiniMax-M3，需 reasoningEffort ≤ high）
- zai GLM key 仍过期（§3.10 遗留）、opencode-go key 在 zen/go 新端点有效但被上述协议变更挡住

**桌面版（Kun / DeepSeek GUI）0.2.6→0.3.10 独立升级线**：

- 更新源自 `app-update.yml`（electron-updater generic feed：`deepseek-gui.com/api/r2/deepseek-gui/channels/stable/latest/`），0.3.10 于 09-10 发布，release notes 见 feed
- 流程：curl 下载 arm64 dmg（279MB）→ sha512 与 latest-mac.yml 逐一比对通过 → `spctl` 公证验证（Developer ID: xingyu zhong YBR76S5LNP）→ 挂载 ditto 干净替换 → 签名复验 → 启动正常（zh-CN renderer + schedule MCP 子进程正常拉起）
- **坑 1**：`ditto` 到已有目录会合并旧内容破坏封签（`a sealed resource is missing or invalid` + 拒绝启动）——**升级 Electron app 必须 `rm -rf` 旧 .app 再 ditto，不要原地合并**
- **坑 2**：从 WorkBuddy/终端 shell `open` 新装的 Electron app 可能继承 `ELECTRON_RUN_AS_NODE=1` 等环境变量直接闪退（本机 shell 环境即中招）——`env -i HOME=$HOME` 直跑二进制可验证；用户从 Finder/Dock 正常启动不受影响

### 3.12 0.1.7 隐性插件断裂：dsh-doctor pending settingsScope（2026-09-30 修复）

**症状**：`web boot: 1 entry did not activate — @linxin666/dsh-doctor: pending (waiting for service: settingsScope)`

**根因 [实测]**：`settingsScope` 服务在 0.1.7 settings 换代（`feat(settings): project volatile Config through profile-backed forms` #4587）中**彻底删除**（npm 全树 + repo 源码双 grep 0 命中）。dsh-doctor 0.3.24 的 client 侧 inject 列表 `[slots, locale, settingsScope]` 永久等待。**peer 检查未拦截**：其 engines 声明 `>=0.1.5-rc.1` 无上界——与 §3.11 session-guard（精确 peer 被拦、启动即报）不同，这是**engines 宽声明 + 已删服务名硬引用**的隐性断裂，boot 后才暴露且无报错只有 pending。

**修复**：备份 `lib/client.js` → `.orig-0.3.24` 后，从 inject 列表删 `"settingsScope"`（代码自带 `ctx.get("webUiSettings") ?? ctx.settingsScope` 降级链且 safe() 包裹，设置卡片静默缺失，其余功能无损）。重启 3080 boot 干净，浏览器侧 bundle（rev 2f84751688f1）确认 serving patched 版。

**SOP（0.1.7+ 再遇 "waiting for service: X"）**：
1. `grep -rl '"X"' ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/` → 0 命中即服务已删（对照 repo 同步确认）
2. 找插件里引用 X 的位置（inject 列表/ctx.get/ctx.X 属性）
3. inject 列表项可直接删；ctx.X 属性引用需看有无降级链；改完 `node --check` 或 vm.Script 验语法
4. 备份 .orig 后再改；插件升级会覆盖 patch，作者发适配版后直接升级

**排查时可直接对照的 0.1.7 已删/更名服务**：settingsScope（settings 换代）、webUiSettings（同上）。第三方插件若 peer 卡 `<0.1.7` 会被拦（显式），若 engines 无上界则要靠 boot pending 症状发现（隐性）——**web profile 装的第三方插件越多，升级后越要扫一遍 boot 日志**。

### 3.13 0.2.0-rc.2 升级实录（2026-09-30 执行）

**版本通道**：0.2.0-rc.1（09-28）→ rc.2（09-29），npm `latest` 与 `next` 双 tag 已推平——**0.2.0 系列进入官方稳定候选**。回退路径：`~/.dsh-backup-pre-0.2.0/`（2.9GB）+ `npm install -g @deepseek-ai/dsh@0.1.7-rc.2`。

**0.2.0 相对 0.1.7-rc.2 的变更主体（release notes 归纳，rc.1 + rc.2 合并）**：

- **桌面端内置 dsh 命令**（rc.2 头条）：macOS/Windows 桌面端菜单栏可直接安装管理 `dsh` 命令行与插件，**无需另装 Node/pnpm**——官方桌面版分发仍不随 release（assets 空），但功能上桌面端已自带完整运行时
- **pi-ai 0.85.1 → 0.87.1**：第三方模型目录更新，**部分旧模型 ID 被移除，已保存的模型选择可能要重选**（本机 zai 自定义 provider 不受影响）
- 自动化任务改为**可选插件包**提供（0.2.0 拆分，automation 插件需显式安装）
- 实验性异步问答模式（等待超时后 Agent 可继续独立工作，需手动配置开启）
- 大量桌面端修复：macOS 图形启动缺登录 shell 环境（工具路径/代理可用性）、Intel 版 Node 签名、麦克风权限、标题栏避让；Windows 沙箱权限诊断技能 + 一次式修复（带备份可恢复）
- Web：工具调度异常后对话可继续（副作用先核实再重试）、Safari 流式刷新恢复、模型选择器搜索

**执行台账（凭证 md5 全程 52f1a6ee… 不变）**：

1. 隔离安装 `/tmp/dsh-new` + APFS clone 演练（dump-config + LLM 真调 DRILL_OK）
2. 备份 `~/.dsh-backup-pre-0.2.0/`（2.9GB）→ 全局升级 → 3080 重启
3. **profile 基线变化**：现存 5 个（comac-demo-h/comac-demo-web/fr-guard/headless/web）——09-26 后用户自行清理了 32 个测试 profile（备份链 pre-0.1.7 里仍有全部 37 个快照）；5/5 dump-config 通过
4. **插件适配（全保留策略）**：升级 skills-manager 1.1.7 / automation 0.1.53 / session-guard **4.0.0**（0.2.0 适配版，web+fr-guard 双 profile）；无新版的两个走**精确豁免**：`dsh plugin --profile web allow-version dsh-univer-office@0.3.5 --dsh-version 0.2.0-rc.2 --accept-risk`（browser-skill 同款）
5. 验证：boot 全绿（仅 bsk CLI 未装非致命提示）、session/create 成功、headless 端到端 UPGRADE_OK
6. doctor 手工补丁（§3.12）复查在位——本次 npm 操作未触发 reify 冲刷，但**惯例复查保留**

**踩坑**：

- `allow-version` 语法与报错提示不一致：报错文案写 `dsh plugin allow-version ...`，实际必须 `dsh plugin --profile <name> allow-version <pkg>@<ver> --dsh-version <exact> --accept-risk`（--profile 插在 plugin 之后、allow-version 之前）
- 豁免是 **精确版本对**（package 版本 × dsh 版本），0.2.0-rc.3 出来后要重新授予

## 四、待观察信号（下次核查重点）

1. **0.2.0 正式版 / rc.3**：latest 已是 rc.2，正式 0.2.0 出现后按 §2.3 演练升级；注意豁免对（univer-office/browser-skill）要按新版本号重新授予
2. **桌面端官方分发**：0.2.0 桌面端已内置 dsh 命令管理，但安装包仍不随 GitHub release 分发——关注官方是否开下载渠道（桌面端代码在 repo `apps/desktop`，必要时可自建：electron-builder + `pnpm run start:desktop`）
3. **pi-ai 0.87.1 模型目录换代**：部分旧模型 ID 移除——用官方 provider 目录（非自定义）的模型选择可能失效，切换模型时留意
4. **automation 插件化**：0.2.0 自动化任务拆为可选插件包，新 profile 想用要显式装
5. **opencode-go 会话头**：上游 pi-ai 已到 0.87.1，复测 `https://opencode.ai/zen/go/v1` 是否仍强制 x-opencode-session（本机已清退该 provider，仅作生态观察）
6. **凭证/会话格式**：0.2.0 未见 credentials/session scope 的 feat，格式稳定

## 附：证据清单（2026-09-30 13:55 +0800 核查）

- npm：latest=next=0.2.0-rc.2（09-29 09:56 UTC）；alpha 停 0.1.7-alpha.2
- GitHub：`gh release view dsh-v0.2.0-rc.2`（notes 全文已读，rc.1+rc.2 双读）；assets 空
- 本机全局：`~/.npm-global/bin/dsh --version` = 0.2.0-rc.2；演练（APFS clone）dump-config + LLM 真调 DRILL_OK
- 备份：`~/.dsh-backup-pre-0.1.6/`、`~/.dsh-backup-pre-0.1.7/`（含 37 profile 时代快照）、`~/.dsh-backup-pre-0.2.0/`（2.9GB，凭证 md5=52f1a6ee… 与活 HOME 一致）
- profile 扫描：5/5 dump-config 通过（profile 总数 37→5 为用户自行清理，非升级动作）
- 3080 web：boot 全绿，session/create 成功；headless 端到端 UPGRADE_OK
- 插件台账：skills-manager 1.1.7 / automation 0.1.53 / session-guard 4.0.0 已装；univer-office@0.3.5、browser-skill@0.2.3 精确豁免在册
- 隐私：5 profile 的双禁条目随 patch 层继承，dump-config 生效
- 本文档不重复 01 的实测细节；09-18 / 09-26 证据清单见 git 历史
