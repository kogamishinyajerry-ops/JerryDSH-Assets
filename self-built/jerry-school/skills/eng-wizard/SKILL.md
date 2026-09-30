---
name: eng-wizard
description: 向导脚本：把只有人能做的步骤变成分步确认的交互 bash 向导——开基础设施、配凭证/CI secrets、走陌生第三方控制台、一次性迁移/割接。触发：agent 撞上只有人能通过的墙（创建账号、点控制台、拿密钥）。agent 自己能做的步骤绝不走这里。
whenToUse: 一个流程手工做繁琐、每次重新解释给 agent 也繁琐——落成脚本一次跑对。
---

# Wizard（向导脚本）

**wizard** 是一个 bash 脚本，带人一步一步走完一个手工流程：它打开每个 URL、准确说点什么复制什么、捕获值、写到该去的地方（`.env`、GitHub secrets）、每步确认、显示还剩几步。可能配第三方服务、跑一次性迁移、或把项目从一个态迁到另一个态。

**默认一次性**：为一次跑而建，存临时目录或 `scripts/`，活干完删。只在用户要可重复的设置路径时才 commit（并在 README 链接它——让下一个人跑脚本而不是再问 AI）。

## 流程

### 1. 划定流程（scope）

先读 repo，别冷问：

- **setup 类**：读 `.env`、`.env.example`、`.env.*`、`README`、`docker-compose*`、框架配置、`.github/workflows/*`——每个 `secrets.*` / `vars.*` 引用都是一个向导必须产出的值。
- **迁移/过渡类**：读当前态、目标态、两者之间不可逆的动作。

然后给用户看有序 stage 清单和每步产出的值，确认：用户可以增、删、换序。

**完成判据**：每个 stage 按序命名；每个捕获值都知道 (a) 人从哪拿、(b) 写到哪（`.env`/GitHub secret/都写/纯动作不写）、(c) 是否 secret（隐藏输入）。

### 2. 映射每个 stage 的旅程

写清一个人走的精确路径：开哪个 URL、到那做什么、值在哪显示、填进哪个变量。例："Dashboard → Developers → API keys → Reveal test key → copy"。**不知道当前 UI 或确切命令时明说**，问用户或查文档——绝不编造可能不存在的步骤。

**完成判据**：每个 stage 都能追到陌生人照着就能走的具体指令。

### 3. 写脚本

每步一个 `stage`，依赖序排列。脚本库约定：

- `stage`/`say`/`step`：分步与叙述；`open_url`：跨平台开浏览器（macOS `open` / Linux `xdg-open` / WSL `wslview`）；`ask`/`ask_secret`（`read -s` 隐藏输入）；`write_env`（幂等 upsert）；`set_secret`/`set_var`（`gh` CLI 写 GitHub）；`pause`/`confirm`；`TOTAL_STAGES` 设成实际步数。
- 守住标准：**先开 URL 再要它的值**；秘密走 `ask_secret`；每个持久值走 `write_env`；`set_secret` 只写 CI 真正需要的；不可逆动作前 `confirm`。
- 每个 stage 清屏只留当前步：一个 stage 一件聚焦的事，人需要的信息不滚出屏幕。

### 4. 验证与移交

- `bash -n <script>`；有 `shellcheck` 就跑。
- `chmod +x`。
- **不自己端到端跑**：它开浏览器且阻塞等人输入。静态走查：第 1 步列的每个值都被捕获且落在第 1 步说的地方；每个 `set_secret` 名与 CI 里 `secrets.*` 引用逐字一致。
- 告诉用户怎么跑。

---
*改编自 Matt Pocock `wizard` 技能（MIT，github.com/mattpocock/skills；上游含完整 template.sh 库），适配 DSH。*
