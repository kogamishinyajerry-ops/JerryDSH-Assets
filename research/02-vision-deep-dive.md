# DSH 视觉插件深测报告（Round 2）

**日期**：2026-08-22 晚 · 续 [REPORT.md](01-updates-and-top-plugins.md)
**环境**：dsh **0.1.1-rc.2**（已升级确认）· `visiontest` 隔离 profile · glm-5.3（zai-coding-cn，文本模型）
**测试图**：本机 swift+CoreGraphics 渲染的 800×300 文字卡（3 行已知文本，不涉隐私）——`/tmp/dsh-vision-test/card.png`

---

## 一、为什么视觉插件是"实质性升级"

glm-5.3 / DeepSeek-V4 系旗舰对话模型是**文本-only**：聊天里粘贴图片、让模型看截图/UI/报错照片，原生都做不到。视觉插件给文本模型外挂一条"识图旁路"，是能力面扩张而非 UI 修饰。awesome 列表 Vision & Multimodal 段已有 **30+ 个**这类插件——这是当前 DSH 生态最拥挤的赛道。

## 二、两条技术路线（都实测通过 ✅）

### 路线 A：全本地（macOS Vision Framework）—— `@niyongsheng/free-vision-skill` 0.3.1

| 项 | 结果 |
|---|---|
| 安装 | ✅ `dsh plugin --profile visiontest add @niyongsheng/free-vision-skill`，零依赖零密钥 |
| 工具 | `view_image`（场景/人脸/二维码/构图）+ `ocr_image`（中英 OCR，`layout=true` 出表格+坐标）+ WebUI 粘贴转路径路由 `/fvs/images` |
| **OCR 实测** | ✅ headless 会话内 glm-5.3 调 `ocr_image` → **3 行文字逐字全对** |
| 隐私 | 图片不出本机（真·全本地，走 Apple Vision） |
| 前提 | macOS 11+ & Xcode CLT（本机 Swift 6.3.3 ✅）；首跑编译 swift ~5-10s |
| 未测 | `view_image` 场景描述（同一 swift 管线，OCR 已证明通路） |

### 路线 B：外挂视觉引擎（VLM 旁路）—— `@liustack/modlens` 3.24.0（3.5k★）

| 项 | 结果 |
|---|---|
| 安装 | ✅ 同上，带独立 `modlens` CLI（analyze/doctor/config/state/guard） |
| 引擎发现 | ✅ `modlens doctor`（纯离线诊断）：自动发现本机 **claude-cli** 与 **kimi-cli** 两个可骑乘登录；Gemini/OpenAI/Anthropic API key 均未配 |
| **CLI 直读实测** | ✅ `-p kimi-cli`：结构化 JSON——OCR 全对 + 阅读顺序布局区域 + 摘要（甚至注意到"底行贴近图像边缘被裁切"）+ 每行语种 |
| **会话内实测** | ✅ headless 会话 glm-5.3 调 `modlens_read_image` → 转写 3 行全对，带不确定性标注 |
| WebUI 集成 | 自动把文本-only 路由包装成 `(modlens vision)` 模型选择器入口（粘贴图直读）；运行时特性，dump-config 不可见，未在浏览器实测 |
| ⚠ 发现 | **claude-cli 引擎路径挂起**（180s 无输出被杀；claude CLI 已登录、creds 在）。kimi-cli 正常。已把默认引擎 pin 到 kimi-cli（`~/.modlens/config.json`，新文件：`{"provider":"kimi-cli"}`） |

### 引擎面板（modlens，10 路 failover 链）

已可用：**kimi-cli**（骑 Kimi Code 登录，实测 20-45s/读）。可加：Gemini API key（免费，5-10s/读，最快）/ 任意 OpenAI 兼容端点（含智谱 glm-4v-flash 免费档）/ Anthropic / antigravity-cli / claude-cli（本机挂起待修）。

## 三、其余 30+ 视觉插件速览（未实测，按机制归类）

- **免费 API 旁路**：`314857493/dsh-vision`（智谱 GLM 视觉免费 API 转写）、`GOU-GEE/deepseek-vision`（默认 GLM-4.6V-Flash 免费）、`FuzzySoul/dsh-free-vision`（Qwen3-VL-Flash 等免费档）
- **浏览器骑乘**：`54xkeee/dsh-vision`（豆包 Web via CDP，零密钥）、`ConsoleSun/Gemini-Eyes`（gemini.google.com 登录会话）
- **本地方案**：`gloryxpnv/dsh-tool-vision`（本地 VLM，JSON 证据）、`Isanti2016/dsh-quicksight`（RapidOCR 本地快速层 + modlens 兜底——本报告 A+B 混合思路）
- **本地 OCR 特化**：`hawkhai/wechat-ocr`（微信 OCR）、`hawkhai/win11-oneocr`（Win11 OneOCR，Windows）
- 全名单：awesome-dsh-plugin → Vision & Multimodal

## 四、建议：装进你的日常 web profile

visiontest 是隔离沙盒；要日常用，在 GUI 空闲时执行并重启：

```sh
dsh plugin --profile web add @niyongsheng/free-vision-skill @liustack/modlens
dsh web            # 重启后：粘贴图片 → /fvs/images 转路径；模型选择器多 (modlens vision) 入口
```

- **默认引擎已是 kimi-cli**（`~/.modlens/config.json`），开箱即用；想要 5-10s/读：去 aistudio.google.com 拿免费 Gemini key → `modlens config set gemini-api.apiKey`（隐藏输入）。
- 隐私敏感图（截图含密钥/私人信息）→ 用 free-vision-skill 的 `ocr_image`（不出本机）；通用理解/复杂图 → modlens。
- 遗留：`~/.dsh/profiles/visiontest`（可留作体验，或 `rm -rf` 清理）。

## 五、下一批"实质性升级"候选（按证据强度排，未实测）

| 插件 | 热度证据 | 能力 | 优先级理由 |
|---|---|---|---|
| dsh-mcp-sync | 4,260 周下载 | MCP server 工具直注（免 mcp-client 包装） | 你已跑 4 个 MCP/本地插件，痛点命中 |
| dsh-honcho-memory | 1,173 周下载 | Honcho v3 用户记忆 + 共享知识层 | 记忆赛道头部（EverOS 12.3k★ / OpenViking 31.8k★ 是独立产品形态，dsh 适配待查证） |
| dsh-browser-control | 255 周下载 | CDP/Playwright 浏览器控制 | agent 亲手操作网页的能力底座 |
| mirage（strukto-ai） | 3.5k★ | Agent 统一虚拟文件系统 | 跨目录大工作面；dsh.bundle 适配待查证 |

说一声测哪个，我按同样流程（隔离 profile → 源码审查 → headless E2E）继续。

---

## 附：本轮证据

- OCR 真值：swift 渲染脚本 `/tmp/dsh-vision-test/make_card.swift` → `card.png`（file 验证 PNG 800×300）
- 会话日志：`/tmp/visiontest-fvs.err`（free-vision-skill）、`/tmp/visiontest-modlens.err`（modlens 会话内）
- modlens CLI 输出：kimi-cli JSON 全文（本报告 §二 摘录）、doctor 全文（§二 引用）
- 挂起复现：`modlens analyze -i card.png`（默认 antigravity→failover claude-cli）180s 超时；`-p kimi-cli` 正常
