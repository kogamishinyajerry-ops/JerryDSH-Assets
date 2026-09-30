# 07 · DSH 会话底座机制：持久化布局 · 投影缓存 · 压缩管线

> thread / undo / 会话类插件依赖的底座机制，也是 plugins 线评测的判据来源。
> 结论分级：**[实测]** = 本机活环境只读取证或源码行为可复核；**[源码]** = 读 0.1.1-rc.2 源码/设计文档得出；**[推断]** = 合理外推。
> 证据：/tmp/dsh-repo 源码 + `.agents/notes/implemented/` 设计决策文档 + `~/.dsh` 活数据只读取样（2026-08-23）。

## 一、结论速览

1. **会话 = 仅追加事件日志（event sourcing），一切会话功能都是它的读模型。** `SessionEvent` 按全局 `seq` 连续编号（`events[i].seq === i`），`turn/start`…`turn/end` 配平；工具审批、todo、goal、token 统计全是日志上的投影。**[源码]**
2. **默认后端是 JSONL+Zstandard，不是 SQLite。** rc.8 的"SQLite 会话持久化布局优化"是**可选后端** `node:sqlite` 的物理布局重做（schema 17 打包行 + zstd，105 会话语料上比旧标量布局小 89.4%），默认组合（base bundle）只接线 `session-persistence-jsonl`，root = `dshHomePath('sessions')` = `~/.dsh/sessions`。**[源码+实测]**
3. **活盘布局**：`~/.dsh/sessions/--<净化cwd>--/<编码id>/session.jsonl.zstd`，逐会话目录；本机 17 个 workspace / 202 个会话目录 / 148 MB，最大单会话 11.8 MB。**[实测]**
4. **外部工具不能裸读会话文件**：默认物理形态是 checksummed zstd frame 拼接 + 逻辑打包行（`text-chunks` 等），且"每会话单活动 writer"。会话类插件的正确入口是 seam 服务（`ctx.sessionPersistence` / `ctx.sessionQuery`），不是文件系统。**[源码]**
5. **投影缓存是加速器不是权威**：`session_projcache` 域按会话存检查点 `(key→{ver,seq,val})`，fail-soft、版本不符即弃、日志永远领先；本机 178 条记录、5 个单元（sessionStats/title/goal/tokenUsage/contextPressure）。**[源码+实测]**
6. **compaction 不删日志**：被压缩内容成为"影子"（shadowed），日志行原样保留，只是 surface（模型可见层）被一条 `surfaceOp: replace` 的 `user/message` 摘要替换；默认 0.8 上下文水位触发。**[源码]**
7. **全文检索默认关闭**：`session-query-sqlite` 默认 `openAt: never` + `:memory:`（连 SQLite 模块都不导入），精确读取/标题/谱系查询仍可用——这是"会话搜索类插件有无价值"的直接判据。**[源码]**

## 二、事件日志：底座中的底座

- **权威真源是内存 `Session` 的仅追加事件日志**；持久化只是它的 durable 复制。事件词汇由 `SessionEventMap` 定义（core/session），`assistant/chunk` 流式分片**绝不丢弃**、逐事件入日志。**[源码]**
- **轮次配平与崩溃恢复**：冷加载发现无 `turn/end` 的 `turn/start` 时**不截断日志**，而是合成 `turn/end { reason: 'interrupted' }` 配平；只有撕裂的物理尾部（写了一半的 frame/行）才丢弃。恢复会用 `TOOL_NOT_STARTED` / `TOOL_OUTCOME_UNKNOWN` 平衡中断的工具调用——后者明确指示模型只重试幂等操作。**[源码]**
- **`SessionHeader` 与日志分离**：首行是 header（`version`(格式版本 v0)、`id`、`createdAt`、`cwd?`、`parentSession?`、`seedLength?`、`origin?: 'subagent'`、`delegationDepth`(盘上必填,顶层=0)、`agentPreset?`）。`agentPreset` 决定恢复后的工具与提示词组合，错了就"回放一段模型无法据以行动的历史"。fork/resume 靠 `parentSession`+`seedLength` 区分继承前缀与自身工作。**[源码]**
- **会话 id 多形态、多产地**（实测分布：115 裸 UUID / 87 `session-<UUID>`）：
  | 产地 | 形态 |
  |---|---|
  | web apiproxy（客户端未带 id）/ fork 子会话 / headless bundle | `session-<uuid>` |
  | web 客户端自带 id、外部调用方指定 id | 裸 UUID（任意 string） |
  | SDK client / subagent 子会话 | `session-<uuid-无连字符>` |
  | agent-loop 配置型 agent | `<agentId>-session-<uuid>` |
  | SessionStore 默认铸币 | `session-N`（计数器） |
  id 只是 branded string、无格式约束，所以**插件不能靠 id 形态判别会话类型**；要判别用 header 的 `origin`/`delegationDepth`/`parentSession`。**[源码+实测]**

## 三、持久化层：JSONL 默认 · SQLite 可选

### 3.1 盘上布局与目录编码（实测）

```
~/.dsh/sessions/
  --Users-Zhuanz-projects-jerry-personal-JerryDSH--/   # 净化 cwd（'/'→'-'，空格→~0020）
    <encodeSegment(sessionId)>/                        # 会话自有目录
      session.jsonl.zstd                               # 默认；compression:'none' 时为 session.jsonl
```

- `encodeSegment`：仅 `[A-Za-z0-9._-]` 直通，其余字符转 `~XXXX`（大写十六进制）；`.`→`~002E`、`..`→`~002E~002E` 防遍历。**[源码]**（实测目录名含 `~0020`＝空格、`Minimax~0020Code` 等，佐证）
- **延迟实体化**：`create(meta)` 不写盘；首次 `append` 才落 header+首批（临时文件 + fsync + POSIX 硬链接无覆盖发布）。创建了但从未追加的会话**不留磁盘痕迹**、不进 `list()`。**[源码]**
- **无删除接口**：日志只增不减，清理靠外部删除（seam 无 delete）。**[源码]**

### 3.2 JSONL 物理编码与写入路径

- 物理产物 = 独立 zstd frame 的标准拼接：1 个 header frame + 每个持久批次 1 个带 checksum 的 frame；Node 内置 zstd、无级别开关。**[源码]**
- **逻辑打包行**（`packChunks` 默认 true）：≥3 个连续同 block 的 `assistant/chunk` delta 打成一行 `text-chunks` / `reasoning-chunks` / `tool-call-chunks`（无斜杠，与事件类型空间隔离），靠 `seq0`/`time0`/逐成员 `dt` 无损重建；真实编程会话实测日志约小 60%。读取端始终解码，打包/非打包/混合文件加载结果一致。**[源码]**
- **写入节流**：事件先入逐会话队列，固定 200ms（`writeBatchMaxDelayMs`）合并窗口、后续事件不重置截止；`session/flush`（每轮领取前）取消等待强制排空。批量只影响"一次 fsync 扛多少记录"，不丢不并逻辑事件。**[源码]**
- **崩溃恢复边界**：最后 frame 撕裂→保留完整解码记录、从 frame 开头截断、重编码 + 合成 closer；已提交前缀内的 checksum/解码失败 = 损坏，拒绝。**[源码]**
- 关键配置（默认组合值）：`root`（必填，部署决定）、`packChunks: true`、`compression: 'zstd'`、`preparedSessionCacheSize: 5`、`writeBatchMaxDelayMs: 200`。**[源码]**

### 3.3 SQLite 后端（rc.8 优化的实质）**[源码]**

- 同一 `SessionPersistence` seam 的兄弟提供方（`node:sqlite`，schema 17）。**默认组合不含它**；启用要在 patch 层换绑（且无迁移：旧 schema/异构库直接拒绝）。
- **物理打包行**：`text-chunks`/`reasoning-chunks`/`tool-call-chunks` 行最多 1024 事件 / 1 MiB 未压缩 `data`；≥4 KiB 走 zstd level 3（小于原文本才保留 frame）；`source_event_seqs` 用 varint+ZigZag 差分编码。字段不完全匹配白名单的连续段保持标量行——无损优先于压缩率。
- **事务纪律**：每批 `BEGIN IMMEDIATE`、陈旧写入方（seq 不续）拒绝；`synchronous=FULL` 显式钉死；普通追加**绝不重写既有行**（写放大有界）。
- **官方基准**（105 会话/250 万逻辑事件，三次构建均值）：打包 SQLite 75.01 MB vs 旧标量 SQLite 709.57 MB（-89.4%）vs zstd JSONL 30.65 MB；完整读取 p50 3.95ms（打包 SQLite）vs 9.02ms（旧 SQLite）vs 4.49ms（JSONL）。**JSONL 在本机体量下仍是最小的**——默认不切 SQLite 是有数据支撑的取舍，不是没做完。
- **对插件/外部工具的硬约束**：外部 SQL 工具不能假设 `events.type` 列是逻辑事件类型、payload 列是文本；必须用提供方解码器。同一会话同时只能有一个活动 writer（含修复）。

### 3.4 读面 API（插件该用的入口）

| 方法 | 语义 | 插件用途 |
|---|---|---|
| `inspect(id)` | 不可变逻辑视图（冷会话内存配平、不落盘修复） | 只读分析 |
| `load(id)` | 权威加载（会提交冷修复） | 恢复/重放 |
| `readFrom(id, fromSeq)` | 物理后缀读（水位增量） | **增量索引/投影的正确原语** |
| `list()/listSnapshots()` | 轻量列表+变更 revision（JSONL 用 dev/inode/size/mtime 纳秒） | 变更监听、缓存失效 |
| `locate(meta)` / `readRaw(id)` | 工件路径提示 / 逐字原文（SQLite 无） | 导出、外部消费 |

`prepare(id)`（恢复专用）带 LRU 复用（`preparedSessionCacheSize`）与预留语义——插件不要绕过它自己实现"会话池"。**[源码]**

## 四、session-projection 与投影缓存

### 4.1 投影注册表（`ctx.sessionProjections`）

- **框架驱动、领域计算**：注册表只订阅一次 `session/event`，每个已提交事件流经每个注册单元的 `apply(state, event)`；领域插件零订阅。cell（每会话每单元）惰性构建，晚注册的单元从 `init` 对内存日志全量折叠。**[源码]**
- **同引用即无工作**：`apply` 对无关事件必须返回同一 state 引用，驱动用 `Object.is` 把关——不匹配的事件零下游开销。**[源码]**
- **全量值规则**：携带状态的日志事件必须带完整状态而非增量（消费方 last-wins）。**[源码]**
- 活组合注册的单元（实测读 projcache rows）：`sessionStats`、`title`、`goal`、`tokenUsage`、`contextPressure`；载体是 api-proxy 历史尾页与 `session/projection` 推送帧（web 侧 todo 卡/goal 卡的数据来源）。**[实测]**
- 快照 `snapshot(session)` 给出一致切面 `{asOfSeq, values}`——多单元值反映到同一事件序。**[源码]**

### 4.2 持久投影缓存（`session-projection-cache`）

- 落点：`~/.dsh/storages/session_projcache.json`（域 JSON 后端，`workspace.json` 旁；本机 178 会话/620KB/域格式 version 3）。**[实测]**
- 每会话一整条记录：`{createdAt, cwd}` 身份绑定 + 各单元 `(ver, seq, val)` 行。**[源码+实测]**
- **安全约定**（全部 [源码]）：写失败 fail-soft（缓存可陈旧、绝不错）；`ver` ≠ 当前单元 `stateVersion` 整行丢弃重折叠（无迁移）；行必须过 `stateSchema` 校验；身份不匹配（删了重建的 id）整条丢弃；**日志领先缓存跟随**（先 flush 事件再落检查点，崩溃只会让缓存落后）。
- **写策略**：`turn/end` 与会话 detach 两个必写点 + 条数/间隔节流（`writeEveryEvents`/`writeIntervalMs` 必填，部署定）。
- **冷读阶梯**：缓存行 → `restoreFloor`（最低水位锚）→ `sessionPersistence.readFrom(id, floor)` → `restore` → fail-soft 写回。这就是 `readFrom` 存在的理由：**增量折叠只回放尾部**。

## 五、compaction 管线

- **能力 seam 三件套**：`dsh-compaction`（词汇+服务定义）/ `dsh-compaction-basic`（token 压力后端）/ `command-compact`（用户命令）+ 可选 `compaction-tool-result-pruner`（无模型修剪）。**[源码]**
- **日志记录的三事件锁**：`compaction/start {turn}` → 摘要生成 → `compaction/summary {summary, shadowedRange, shadowedSeqs, shadowedTokenCount, ...}` → `compaction/end {turn}`。锁最后释放：中途崩溃 = 可检测的遗留锁（有 start 无 end），**不会**出现假的完成标记。**[源码]**
- **surface 替换是唯一的模型可见变更**：摘要作为一条 `user/message`（带 `surfaceOp: {op:'replace', start, end}` 位置跨度）落在 surface 上；被替换的旧事件**不删除**，成为影子（shadowed）。**[源码]**
- **触发与阈值**（compaction-basic 默认）：`thresholdRatio 0.8`（floor(路由上下文窗口×0.8) 触发压力压缩，串行 `agent/pre-step` 中先于请求推导）、`retainRatio 0.16`（逐字保留近期表层）、摘要调用默认沿用当前路由（可 `summarizationProvider/Model` 覆盖）、溢出后恢复重试 1 次、`auto: true`。压力触发时先跑可选**工具结果修剪**（无模型、纯替换大结果），再用 `ctx.tokenMeter` 重测，可能不需要摘要就达标。**[源码]**
- **范围语义**：区域边界保持工具调用/结果配对，但不保持整个轮次——超大轮次中较早闭合的步骤可被单独压缩。**[源码]**
- 对"历史回看"类功能的含义：**shadowed 内容永远在日志里**，`session-query` 的三表层过滤（`current`/`shadowed`/`log-only`）默认全可搜。压缩不是删除，是可见性调度。**[源码]**

## 六、session-query：检索面（plugins 线评测判据的核心）

- 家族：`session-query`（定义）/ `session-query-sqlite`（FTS5 后端）/ `tool-session-query`（面向模型的工具）/ `session-log-export`（web 导出 ZIP）。**[源码]**
- **默认组合 `openAt: never` + `path: ':memory:'`**（base bundle 注释明说全文搜索是 opt-in）：`searchSessions/searchEvents` 直接抛 `SESSION_QUERY_SEARCH_DISABLED`，`node:sqlite` 根本不导入；**精确读取、标题、谱系 trace（会话导出、subagent fork 继承）保持可用**；web 侧边栏只能搜标题/workspace 名。**[源码]**
- 开启方式：patch 层覆盖 `openAt: first-search|startup`（`first-search` 把 SQLite 加载推迟到首次搜索）+ 持久 `path`。**[源码]**
- FTS 语义：FTS5 `unicode61` 分词（token 召回，非子串；子串用 `filterEvents()` 字面扫描）；查询语法（引号/OR/NEAR/*）视为数据；TEMP 实时行遮蔽持久基行，活跃所有者脱离后基行重现；派生索引**单进程单所有者**、不能指向 persistence 库；源变更靠 `listSnapshots` revision 驱动对账，绝不调会修复日志的 `load()`。**[源码]**
- **判据含义（[推断]，供 plugins 线用）**：
  1. 任何"会话搜索/回忆"类插件先问：部署有没有把 `openAt` 打开？没开 + 插件自带独立索引 = 有真实价值；开着 = 插件大概率重复建设，判据是能否比官方 FTS 多给（跨库、语义、时间线）。
  2. 增量索引的正确姿势 = `listSnapshots` revision 对账 + `readFrom(fromSeq)` 水位，而不是全量重读或文件监听。
  3. 不能占用官方索引路径（单所有者约束），自带库必须另开路径。

## 七、对 thread / undo / 会话类插件线的判据汇总

| 判据 | 内容 | 等级 |
|---|---|---|
| 入口 | 读会话走 `ctx.sessionPersistence`/`ctx.sessionQuery`；写永远不要（append-only + 单 writer） | [源码] |
| 增量 | `readFrom(id, fromSeq)` + revision 是官方增量原语；dsh-thread 类插件自建 SQLite 库是合理路线（官方索引默认关且单所有者），但事件获取应走 seam 而非文件 | [源码+推断] |
| undo 语义 | 官方**无 undo 服务**；surface 的权威是 `surfaceOp`（`replace` 等），compaction 的 `shadowedSeqs` 是官方"已遮蔽"清单。undo 类插件若自算遮蔽集，必须与 `compaction/summary` 事件对账，否则与官方摘要视图打架 | [源码+推断] |
| 谱系 | fork/subagent 判别用 header（`parentSession`/`seedLength`/`origin`/`delegationDepth`），别猜 id 形态 | [源码] |
| 恢复 | 会话中途崩溃的日志有合成 `interrupted` closer + `TOOL_OUTCOME_UNKNOWN` 语义，thread 类统计"工具成功率"时必须识别这两个标记，否则偏差 | [源码+推断] |
| 兼容 | 格式版本 v0 无迁移承诺：读旧日志的插件要准备 `SessionFormatUnsupportedError`；外部直接读文件 = 脆弱（zstd frame + 打包行 + 未来 SQLite），一次版本升级全断 | [源码] |
| 体量参考 | 本机 148MB/202 会话/最大 11.8MB——索引类插件的存储预算按此量级估 | [实测] |

## 附：证据清单

- 源码：`packages/session/session-persistence{,-jsonl,-sqlite}/`、`packages/session/session-projection{,-cache}/`、`packages/compaction/*`、`packages/session-query/*`、`packages/core/session/src/{types,index}.ts`、`packages/bundle/base/cordis.patch.yml`（98-137 行：jsonl 接线 + session-query 默认 never）
- 设计文档（.agents/notes/implemented/architecture/）：`2026-08-18-sqlite-physical-chunk-row-compression.zh.md`（含官方基准数据）、`2026-06-14-session-persistence`、`2026-08-08-bounded-session-persistence-write-batching`、`2026-06-20-branded-ids`
- 子系统文档：`docs/subsystems/persistence.zh.md`、`docs/subsystems/compaction.zh.md`
- 实测（只读，2026-08-23）：`~/.dsh/sessions` 树（17 workspace / 202 会话目录 / 148MB；`~0020` 转义可见；id 形态 115 UUID vs 87 session-UUID）；`~/.dsh/storages/session_projcache.json`（域 version 3、178 会话、单元 sessionStats/title/goal/tokenUsage/contextPressure）；`~/.dsh/storages/workspace.json`
- id 产地：`apiproxy/src/api-proxy.ts:2080,2315`、`bundle/headless/src/index.ts:112`、`sdk/client/src/api.ts:89`、`subagent/subagent-dsh-sdk/src/run.ts:165`、`core/session/src/index.ts:866`、`core/agent-loop/src/index.ts:358`
