# 08 · DSH 安全模型深潜：文件策略 · 审批流 · MCP 边界 · 插件权限

> 回答"生产环境该装什么/怎么配"的规矩问题。承 05 §9（插件安全提示）向下挖到 seam 级。
> 结论分级：**[实测]** / **[源码]** / **[推断]** 同 01-07。证据：/tmp/dsh-repo 源码 + `docs/subsystems/{sandbox,approval,permission-presets}` 官方文档 + 本机运行时对照。

## 一、结论速览

1. **安全面是"两条 knob + 两层边界 + 一个产品捆绑"**：沙箱模式（`sandbox/mode`）与审批策略（`approval/policy`）相互独立；进程沙箱是内核级边界（只包裹 bash/pwsh 子进程），fs 围栏是进程内策略检查（非安全边界）；permission-presets 把两 knob 捆成 UI 选择器。**[源码]**
2. **最大的结构性事实：审批与沙箱管的是"模型调用的能力"，不管"插件与 MCP 服务器代码"。** 插件以你的 UID 执行、无任何沙箱或审批（官方 publish.md 原话：装插件 = 授予"在 agent 的任何沙箱之外、于你的机器上执行该包代码的许可"）。**[源码]**
3. **沙箱只定义"文件效果"**：`read-only` / `workspace-write` / `danger-full-access` 三档；**网络与进程可见性明确不在词汇内**——沙箱内的 bash 照常联网。**[源码]**
4. **审批 fail-closed**：结果四值中只有 `allowed-once` 放行且仅授权所问的那一次；`never` 策略在应答者瀑布**之前**于服务内部强制，后注册的应答者也无法绕过；空闲会话（无未闭合轮次）的询问直接拒绝。**[源码]**
5. **默认预设表只有两条**：`workspace-write`（workspace-write + ask）与 `danger-full-access`（danger-full-access + never）。本会话即第二条的活实例（用户刚把审批 ask→never）。**[源码+实测]**
6. 生产建议见 §八矩阵；一句话版：**共享/生产环境禁用 danger-full-access 预设、插件只装 pin 过 commit 的白名单、凭证面默认不可信。**

## 二、进程沙箱（内核级，只管 shell 家族）**[源码]**

- seam：`ctx.sandbox`（`dsh-sandbox`），提供方 `dsh-sandbox-local`：Linux bwrap/Landlock、**macOS Seatbelt**、Windows ACL 受限令牌。消费方只有 `bash-sandbox` / `pwsh-sandbox`（及未来 pwsh 变体）。容器/microVM/远程执行是**同级实现而非提供方**。
- **逐调用策略**（`SandboxExecutionPolicy`）：模式 + `workspaceRoot`（从调用会话不可变 cwd 派生，含 symlink 规范化）+ sessionId；策略**不在 provider 上固定**——同一瞬间 bash 可在 read-only 下、子 agent 在 workspace-write 下。已批准的升级重试 = 一次携带更宽策略的新调用。
- `danger-full-access` **不经过 ctx.sandbox**：消费方直接 spawn 原始 argv。
- **强制完整性是后端报告的事实**：`full`/`partial`。partial 实例：旧 Landlock ABI、Windows ACL 的 Everyone/硬链接缺口。要求绝对边界的消费方必须拒绝或上抛 partial——**排查沙箱问题时先看 enforcement 字段，别假设 full**。
- 拒绝识别：`denialSignatures` 是**本后端方言**（bwrap=EROFS、Landlock=EACCES、Seatbelt=EPERM），消费方只匹配本后端签名，不取跨后端并集；runner 自身失败（`runnerFailureRules`：非零退出 + 致命 stderr 签名，先剔除信息行）与"沙箱正常拦截"是两类不同事件。

## 三、fs 工具围栏（策略级，非内核边界）**[源码]**

- `SandboxedFileSystem` 替换 `ctx.fs`：**读取全模式直通**；`writeText`/`editText` 加逐调用围栏（`read-only` 全拒 → `FS_SANDBOX_DENIED`；`workspace-write` 只放行规范化后位于 workspace root + 平台临时区 `/tmp`、`os.tmpdir()` 之下者；`danger-full-access` 直通）。
- **可写集单一所有方**：`writableRoots()` 与 Seatbelt profile 同源派生，fs 围栏与 bash runner 不会漂移；委托前立即重新规范化目标（覆盖工具解析后被替换的祖先 symlink）。
- **官方威胁模型原文立场**："策略围栏，而非内核边界"——检查发生在可信代码里，对抗的目标只是"模型控制的路径"；残余 TOCTOU（包含检查与系统调用之间替换祖先链接）被写前重规范化缩小但**不消除**，为该威胁模型所接受。不可信代码要内核级隔离 → 归 `ctx.shell`。
- 模型可见面：拒绝渲染为 `[sandbox: file access denied under <mode> mode]` 标记 + 同轮次一次性升级提示（升级需过审批）——本会话工具结果里的沙箱标记即此机制的产物。**[实测对照]**

## 四、审批流（fail-closed）**[源码]**

- `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`；调用方（dsh-tools、tool-bash、tool-fs）对后三值一律拒绝。应答者缺失/抛错/不负责 → `unavailable` → **拒绝**，绝不放行。
- 策略按会话：`ask`（委托应答者链，链空 → unavailable）| `never`（确定性 rejected，**在分发之前、服务内部强制**）。生效值 = 会话日志最后一条 `approval/policy` 事件，回放可重建；`never` 是官方明说的"严格 headless 立场"（CI/无人值守）。
- 审计：每问一对 `approval/asked`/`approval/decided` 事件（配对 branded id），**只入日志不进模型 transcript**；模型看到的是调用方派生的工具结果 + 运行时上下文快照（策略变化追加新快照，不改写历史）。
- 请求需在未闭合轮次内（审计对要落在 durable log 的 commit/replay 边界内）；abort → `cancelled`，迟到应答丢弃。
- ACP 自动化桥可为它拥有的 agent 提供一次性机器决策——外接编排器时的审批代理路径。

## 五、permission-presets：产品化捆绑 **[源码+实测]**

- `ctx.permissionPresets` 把两 knob 捆成具名预设；**不拥有任何强制执行**，只记录意图（`permission/preset` 事件，log-only）再走各自 setter。
- 默认表：`workspace-write` = workspace-write + ask；`danger-full-access` = danger-full-access + never。`custom` 是派生值（当前 knob 组合不在表内），可显示、不可切换、不入事件。
- 组合前提：必须配施加隔离的 `ctx.shell` 执行器（无 `sandboxMode` 能力事实的裸 bash-local 之上组合会**加载即失败**）；表项抢占 `custom` 名也抛。
- **实测对照**：本会话当前 = danger-full-access + approval never（用户从 ask 切来），即第二条预设的 knob 组合——运行时上下文里"approval prompts are disabled / policy never"的表述与 §四语义一致。

## 六、MCP 边界 **[源码]**

- `dsh-mcp-client`：外部 MCP 服务器的工具注册进 `ctx.tools`，公开名 `mcp__<serverName>__<rawName>`（64 字符规范化 + 冲突时确定性 hash 后缀；名称是 `(serverName, rawName)` 纯函数，重连不改名）。同 raw 名跨服务器共存于各自 namespace；存活实例中重复 serverName 后载者失败。
- **stdio 传输 = 在本机 spawn 你配置的命令**（env 注入走 `!!js` 表达式）——MCP 服务器与插件同级：全权限本机代码。http 传输 = 远端服务 + 自定义 header。
- **注册即原生工具**：MCP 工具没有额外的调用门；是否受审批/沙箱约束取决于能力消费方（工具本身若走 bash/fs seam 则同受围栏，纯 MCP 工具调用 `client.callTool` 直达服务器，超时默认 60s）。
- 输出准入：文本块连接、资源链接保真；**图片要成为持久核心块需同时满足** `ctx.attachments` 挂载 + 该次调用的模型路由声明支持图片输入；音频/嵌入资源/不支持块 → 明确诊断文本而非静默丢弃。
- 稳定性：断线指数退避重连（预算 `maxAttempts` 10 次，存活超 `maxDelayMs` 30s 重置）；崩溃循环服务器会耗尽预算注销而非无限重启。世代替换原子（注册冲突整代回滚，不留部分集合）。
- 对生产的意义：**MCP 的攻击面=你愿意在本机跑什么 + 远端 URL 的可信度**，harness 不提供中间隔离层。**[推断]**

## 七、插件权限：官方明示的"无模型" **[源码+实测]**

- publish.md 原话（docs/user/develop/basic/publish.md:173）：安装许可的本质是"**在安装时于你的机器上执行该包代码的许可，位于 agent 运行所处的任何沙箱之外**"；官方建议只装信得过的源并 **pin commit**（`github:you/hello-plugin#<sha>`）。
- 无插件权限声明的 runtime 检查（加载路径不查 permission/sandbox/approval）；pnpm `onlyBuiltDependencies` 只是构建脚本白名单（npm 生态惯例），不是隔离。
- 凭证面：`~/.dsh/.credentials.yaml` 0600/0700 防其他 OS 用户，**不防同 UID 的插件/MCP/模型进程**（05 §9 结论，本仓 15 插件源码审查 0 恶意命中——不外推）。
- rc.1 凭证加固（durable records + boot 升级 + auth seams）解决的是**格式与边界清晰度**，不改变"同 UID 全可读"的现实。**[源码]**

## 八、生产环境该装什么（规矩矩阵）

| 环境 | 预设/knob | 插件 | MCP | 凭证/其他 |
|---|---|---|---|---|
| 个人开发机（现状） | danger-full-access 可接受（知情） | 源码审查后装 | stdio/http 均可 | 现状 |
| 共享主机/生产代理 | **禁 danger-full-access**（裁掉预设表项）；workspace-write + ask | 白名单 + pin commit；native 依赖过 onlyBuiltDependencies 审 | 优先 http 远端；stdio 逐个审 spawn 命令 | 凭证副本隔离（`config.path` 指副本，05 §6） |
| CI / 无人值守 | workspace-write + **approval=never**（官方严格 headless 立场：确定性拒绝而非静默放行） | 最小集 | 不装或只读服务 | 断言 `enforcement=full`；partial 直接失败 |
| 不可信任务/对抗样本 | workspace-write + ask；**不接受 fs 围栏当安全边界**（官方明示非内核级），不可信代码走 bash 沙箱 | 不装新插件 | 不接新 stdio | 独立 profile + 独立 DSH_HOME |

**红线清单（[推断]，据上列源码事实推导）**
1. 沙箱内 bash 仍可联网——需要网络隔离的场合在沙箱词汇之外自行加（防火墙/代理），别指望 `workspace-write` 挡网。
2. approval=never + danger-full-access = 无任何交互刹车，只用于完全可信的自动化。
3. "沙箱 partial"必须当失败处理（官方语义：partial ≠ full，承诺未完全兑现）。
4. MCP stdio 与插件是同级别的本机执行面，安全评审时合并计入。
5. 插件更新=重新执行任意代码（未 pin 的 git ref 可被后续 push 静默改变）——生产 pin sha。

## 附：证据清单

- 官方文档：`docs/subsystems/sandbox.zh.md`（模式/逐调用策略/enforcement/拒绝方言）、`approval.zh.md`（结果集/瀑布/审计/never 语义）、`permission-presets.zh.md`（预设表/custom 派生/组合前提）
- 源码 README：`packages/fs/fs-sandbox/README.zh.md`（围栏规则/威胁模型原文/writableRoots）、`packages/mcp/mcp-client/README.zh.md`（命名/注册世代/输出准入/重连预算）、`docs/user/develop/basic/publish.md:173`（插件执行许原文）
- 实测对照：本会话运行时上下文（danger-full-access + approval never + `[sandbox: ...]` 拒绝标记机制）；05 §9 的 15 插件源码审查结论
- 关联：05 §6（凭证副本隔离）、05 §5（pnpm 构建拦截）、01 §五（rc.1 凭证重构）
