# 05 · DSH 插件机制研究笔记

> 从 15 个第三方插件实测 + 官方源码/文档中提炼的机制级结论。写插件、装插件、调插件前过一遍。
> 证据：dsh 0.1.1-rc.2 源码（/tmp/dsh-repo 克隆）+ `dsh-app-boot`/`cordis-plugin-loader` README + 本机实测。

## 1. 插件 = bundle，profile = 有序 bundle 栈

- **bundle**：带 `dsh: { bundle: { patch: "./cordis.patch.yml" } }` manifest 的 npm 包。patch 文件是 cordis patch 条目数组（`insert` 列表 / id-targeted 覆盖 / `disabled`）。
- **profile**：`$DSH_HOME/profiles/<name>/` 目录，`package.json` 里 `dsh.profile.bundles` 是有序 bundle 名列表；组合顺序 = bundles 各层 → profile 的 `cordis.patch.yml` → home 级 `~/.dsh/cordis.patch.yml` → `--patch` overlay。
- `dsh plugin --profile <name> add <pkg>` = 转发 pnpm + 自动把包名追加进 bundles。**没有 `dsh.bundle` 的包也能装，但只当普通依赖、打警告、不激活。**

## 2. 模块解析：安装优先

bundles 里的包名**先查 dsh 安装自带的 node_modules**（`@deepseek-ai/dsh-base` / `dsh-web-app` / `dsh-headless` 由此解析），再查 profile 自己的 node_modules。所以：
- 官方 bundle 不需要显式依赖，写进 bundles 即可
- 第三方 bundle 的 cordis patch 里 `name: <包名>`（不是相对路径），走 Node 模块解析

## 3. patch 语法（实测确认）

```yaml
- insert:                      # 新增行
    - id: my-plugin
      name: my-pkg
      config: { ... }
- id: credentials              # id-targeted：整体替换该行的 config（未写字段回 schema 默认）
  config: { path: /x/y.yaml }
- id: fs-sandbox               # 禁用行
  disabled: true
```
- patch 指向不存在的 id → stderr 警告，不失败
- 空文件/纯注释会抛错——禁用整层要写 `[]`
- `!!js` 表达式在 mount 时求值（如 `!!js process.env.X`、`!!js dshHomePath('sessions')`）

## 4. dist-tag 陷阱（实测踩中）

官方子包（如 `@deepseek-ai/dsh-headless`）的 npm `latest` tag 停在 **0.0.1-rc.1**，新版只发 `next`。`pnpm add @deepseek-ai/dsh-headless@latest` 会装到石器版本。社区脚手架 `create-dsh-plugin` 的 tool 模板把这个坑直接写进了注释（"Never run a bare `npm i @deepseek-ai/dsh-tools`"）。
**对策**：装官方子包显式写版本号或 `@next`；日常 bundle 不装（靠安装内解析）。

## 5. pnpm 10 构建脚本拦截 → native 依赖插件"装完即坏"

pnpm 10 默认忽略依赖的 postinstall 构建脚本（只打一条易漏 Warning）。后果实例：dsh-thread 的 better-sqlite3 无 native binding——JS 层 require 成功、工具注册成功，但每次事件捕获炸 `Could not locate the bindings file`，**记忆完全不落盘而表面正常**。
**对策**（对每个含 native 依赖的插件，在 profile 的 package.json）：
```json
"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }
```
然后 `pnpm rebuild <pkg>`。`pnpm approve-builds` 是交互 TUI，无法脚本化。

## 6. 凭证文档格式换代（rc.5 冷启动崩溃根因）

- rc.5 的 `dsh-credentials-local` parser：`~/.dsh/.credentials.yaml` 必须是**扁平 ref→string 映射**
- 0.1.1 重构后：`version` + `refs` 结构化文档（boot 时自动升级旧扁平文档）
- **不可逆方向**：新格式文件 + 旧 rc.5 核心 = 任何 profile 的真实 boot 必挂（`--dump-config` 不挂，它离线合成不解析凭证）
- 插件可用 `config.path` 把 credentials/settings 指到副本——隔离测试的活凭证/活配置就靠这个

## 7. web-only 插件模式（headless 杀手）

插件声明 `export const inject = ["webServer"]`（硬依赖）时，**headless 组合里没有 webServer 服务 → 该 entry 永远 pending → 整个 profile boot 失败**（`1 entry did not activate`）。
实测命中：dsh-mcp-sync。chicheng-push/cron 同为 `["webServer","webRuntime"]`。
**对策**：这类插件只装进含 `@deepseek-ai/dsh-web-app` bundle 的 profile；headless 测试前先看 inject 声明。`dsh.client` manifest 的 `platform: web` 只说明**客户端**注入目标，不等于宿主侧依赖——宿主依赖看 `inject`。

## 8. 客户端插件下发机制

web 宿主按 `/plugins/<pkg>/client.js` 路径下发插件的客户端模块（`window.__ModuleLoader__.load({id, factory})` 桥），不进 index.js 静态 bundle。所以"装没装上"的探测方法：
```sh
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/plugins/<pkg>/client.js
```
（dshmarket 实测：373KB 模块 200 返回。）

## 9. 安全模型（必须知道）

- 插件代码以**你的用户权限**运行，工具审批不沙箱插件；可读你的文件、凭证、网络
- `$DSH_HOME/.credentials.yaml` 是 0600/0700，但那防的是其他 OS 用户，**不防模型进程**（bash/fs 工具同 UID 都能读）
- 生态警告原文：上榜 ≠ 安全审查。本工作区 15 插件全部做过源码审查（child_process/eval/外联端点扫描），0 恶意命中——但这个结论**不外推到没看过的插件**

## 10. 配置面速查

| 面 | 位置 | 说明 |
|---|---|---|
| profile bundles | `~/.dsh/profiles/<name>/package.json` | dsh plugin 自动维护 |
| profile 用户层 | `~/.dsh/profiles/<name>/cordis.patch.yml` | 手写覆盖 |
| home 用户层 | `~/.dsh/cordis.patch.yml` | 所有 profile 共享，优先级最高 |
| 全局设置 | `~/.dsh/settings.yaml` | 模型/providers/advisor 等；web Settings 页写这里 |
| 凭证 | `~/.dsh/.credentials.yaml` | 别手改格式 |
| 插件自带数据 | `$DSH_HOME/<插件名>/` | 如 push/channels.json、cron/store.json；多数 boot 时加载一次，改文件要重启 |

## 11. 0.1.5 机制变更（2026-09-14 升级实测，0.1.1-rc.2 → 0.1.5-rc.2）

> 本节是 2026-09-14 大版本升级的机制增量，§1-10 基于 0.1.1-rc.2 仍基本有效，冲突处以本节为准。

### 11.1 插件客户端下发：单文件路由 → 内容寻址 combo 聚合

- 旧探测法 `curl /plugins/<pkg>/client.js`（§8）**全部 404**，该单文件路由已移除
- 新机制：boot 时构建模块依赖图，页面 payload 以 `window.__DSH_BOOT__` entry graph 下发，实际加载走聚合端点：
  `/plugins/??<id1>/client.js,<id2>/client.js,…&rev=<12位sha1内容哈希>`（URL 上限 3KB，超限自动分段；多个包可共享同一 12 位哈希前缀，靠 `-<序号>` 后缀区分）
- `rev` 不匹配即拒绝（防缓存投毒），**手搓 URL 探测行不通**——要验证插件装载，抓 `/?token=` 页面 payload 里的 `"url":"/plugins/??…"` 清单
- 插件 package.json 现要求 `exports["./client"]` + `dsh.client` 声明（`platform`/`inject`/`external`/`immediately`）；没有的包（如 dsh-pdf-reader）本来就不下发客户端模块，非回归

### 11.2 插件 API 破坏性变更（升级实测命中）

- `ctx.agent` 移除，调用方显式传 Agent；`Inbox` 转纯类型接口（`agent.inbox` 读写，`hasPending`/`claim` 不再公共）
- web 面板：`sidebar.panellist` + `main` 注册全局面板，`conversation` slot 迁为 `main.conversation` key
- 官方包导出收紧：`dsh-settings` 的 `settingsNamespace`/`installSettingsSection` 已删——**第三方插件 import 即 boot 崩**（dsh-advisor 0.2.x / dshmarket 旧版实测命中）
- `ctx.systemPrompt.getSectionOrder` 移除；`session.events` 改按需读取（`seq`/`eventAt()`/`snapshotEvents()`）
- profile **node_modules 里缓存旧版官方包会遮蔽内置包**（§2 安装优先规则的阴暗面），升级后报 `does not provide an export named …` / `X is not a function` 先查这个
- 社区迁移工具：oh-my-dsh/dsh-plugin-upgrade-skill（官方 release notes 推荐，未实测）

### 11.3 内置服务吞并手动补挂

- storage 服务链（`storage`/`storage-json`/`storage-domain`）已进 dsh-base 共享层（headless 也生效）。老 profile 里「headless 补挂 storage」的 `- insert:` patch 会撞 `duplicate loader entry id: storage` **直接 boot 失败**——改成 id-targeted 覆盖（`- id: storage-json` + `config:`）只覆盖 root 路径即可

### 11.4 web 认证与会话格式

- web 启用一次性 token 认证：URL `?token=<...>`（含 `-_` 的长 token，grep 截取别截断），首次访问种 trust cookie，之后 API/静态资源靠 cookie，**裸 curl 抓 API 会 401**
- Session 格式 V3：新会话文件名 `session.v3.jsonl.zstd`；老会话惰性迁移（读到才转、保留原文件）、不支持降级读取。自定义日志读取器需适配 V3
- 自定义 persona 拆分 prefix/suffix（旧配置需迁移）
- SDK/Headless/ACP 默认工具集改为 read/write/edit；Web minimal 仅持久 shell（`str_replace_editor` 需显式启用）
- 出站请求遵循 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY/NO_PROXY（本机 Clash 场景注意）

### 11.5 升级 SOP 增量（承接 06 §2.3）

- 演练副本 `cp -Rc`（APFS clone）秒级完成，2.1GB HOME 无压力
- 超时杀进程会留 stale `profiles/node_modules.lock`（报 `atomic-write: timed out`），rm 掉即恢复
- 对新二进制跑 `--help` 也会解析活 HOME（无 DSH_HOME 覆盖时）——隔离演练全程显式 `DSH_HOME=/tmp/...`
- better-sqlite3 类 native 插件跨 Node 大版本需 `pnpm rebuild`（NODE_MODULE_VERSION 不匹配：Node 24 编译产物 vs 22 运行时报 137 vs 127）
- pnpm 10 对 git-hosted 依赖的 postinstall 拦截从「静默跳过」（§5）升级为**直接报错**（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`），需在 profile `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 显式允许
