# dsh-engineering-school · 工程学校

把 [aihero.dev/skills](https://www.aihero.dev/skills)（Matt Pocock《AI Skills for Real Engineers》）的全部免费内容深度分析整合后，做成的一个 DSH 教学插件。双重目标：

1. **让 DSH agent 干得更好**——6 个模型可调用方法论技能（需求拷问 / TDD / bug 诊断 / 深模块设计 / 领域建模 / 双轴审查），agent 在任务匹配时自动加载按真实工程纪律工作；
2. **让 DSH 使用者看得懂**——`eng-idea-to-ship` 主流导航 + `dsh-school` 课程（agent 解剖学 / 工程方法论 / DSH 驾驶术 / 为 agent 写作 / 双语词典），人随时可学"agent 在干什么、工程怎么推进"。

## 内容来源（全部免费获取，2026-08-22 抓取）

| 来源 | 用途 |
|---|---|
| [github.com/mattpocock/skills](https://github.com/mattpocock/skills)（MIT，含 `skills/*/SKILL.md` 执行原文 + `docs/*.md` 编辑教学版） | 9 个方法论技能与主流编排的骨架，忠实改编 |
| [aihero.dev AI Coding Dictionary](https://www.aihero.dev/ai-coding-dictionary)（~70 词条 HTML 正文，全部抓取） | 双语词典的释义底本，~55 词条蒸馏整合 |
| aihero.dev 免费帖子（5 Agent Skills / AI Engineer Mindset / 7 Phases / AGENTS.md Guide / Tracer Bullets / Grill Me Gone Viral / 9 Things People Get Wrong） | 课程叙事与失败模式素材 |
| DSH 0.1.1-rc.2 运行时文档 + 本机实测 | DSH 映射表、词典 DSH 特有节 |

上游仓库为 MIT 许可；本插件为二次创作（翻译、压缩、重组、DSH 适配），各文件脚注保留出处。技能正文以中文重写，术语保留英文。

## 机制

- 零依赖纯本地：`index.js` 扫描 `skills/*/SKILL.md`，frontmatter 解析后经 `ctx.skills.register()` 注册为**运行时技能**（rank 250：项目级可覆盖，覆盖用户级同名技能）。
- **热重载**：`fs.watch` 监听技能目录，`SKILL.md` 增删改 300ms 防抖后按内容哈希 diff 重挂——改完即生效，无需重启 profile；`DSH_ENG_SCHOOL_WATCH=0` 关闭。
- 每个技能束可带 `reference/` 附属文件；`resourceBase` 指向束目录，技能正文里的相对路径由 agent 按需 `read`——正文保持短，深材料放参考（progressive disclosure，这是从源技能学来并用在自己身上的原则）。
- frontmatter 自有约定：`name` / `description`（模型可调用时常驻 context pointer，措辞按 writing-for-agents 规则打磨）/ `whenToUse` / `audience: user`（仅用户可调，零常驻开销）。

## 技能清单

**模型可调用**（agent 自动在任务匹配时加载）：

| 技能 | 一句话 |
|---|---|
| `eng-grilling` | 需求拷问：设计树+前沿轮次，事实自己查、决策问用户 |
| `eng-tdd` | red→green，预约定 seam，三反模式 |
| `eng-diagnosing-bugs` | 六阶段诊断：先造会红的回路 |
| `eng-codebase-design` | 深模块词汇表：module/interface/depth/seam/adapter/leverage/locality |
| `eng-domain-modeling` | CONTEXT.md 词汇表 + ADR 三条件 |
| `eng-code-review` | Standards/Spec 双轴并行子代理审查 |
| `eng-architecture-review` | 架构巡检：加深机会 + 规格驱动可验证 HTML 报告（archify 约定） |
| `eng-writing-for-agents` | 为 agent 写作的杠杆：指针措辞/两种负载/信息层级/引导词/修剪 |
| `eng-wizard` | 只有人能做的步骤 → 分步确认的交互 bash 向导 |
| `eng-resolving-merge-conflicts` | 冲突逐 hunk 按意图解决，永不 --abort |
| `dsh-school` | DSH 学校：用户求理解时开课，四模块课程 + 双语词典 |

**用户可调用**（敲名字进入）：

| 技能 | 一句话 |
|---|---|
| `eng-idea-to-ship` | 主流导航：说出处境，它给路线（含 wayfinder/triage/原型/保养支线） |

## 安装（本机已接线）

profile 的 `cordis.patch.yml` 加：

```yaml
- insert:
    - id: dsh-engineering-school
      name: /Users/Zhuanz/.dsh/plugins/dsh-engineering-school/index.js
```

验证：`dsh --profile <name> --dump-config | grep -A2 engineering-school`；会话里让 agent 列出技能或直接调用 `eng-grilling`。

## 维护

- **热重载**：fs.watch 监听 `skills/`，改任何 `SKILL.md` 后约 0.3s 自动重挂（按内容哈希 diff，正文与 frontmatter 改动都即时生效，不用重启 profile）。关：`DSH_ENG_SCHOOL_WATCH=0`。reference/ 附属文件本来就不参与注册——agent 按需现读，改完即生效。
- 上游更新：`git clone --depth 1 https://github.com/mattpocock/skills` 对比 `skills/` 后按需重整合；词典更新看 [aihero.dev/ai-coding-dictionary](https://www.aihero.dev/ai-coding-dictionary)。

> [2026-10] 整编：本插件由 dsh-engineering-school 改名平移而来，技能内容不变。
