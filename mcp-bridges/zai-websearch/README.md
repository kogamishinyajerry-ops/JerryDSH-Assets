# zai-mcp — Z.ai / BigModel 联网搜索 MCP 桥

stdio MCP server（`bridge.mjs`），注册为 DSH web profile 的 `mcp__zai__*` 工具。

## 工具

| 工具 | 通道 | 计费 | 状态 |
| --- | --- | --- | --- |
| `web_search` | coding 端点 `chat/completions` 内置 `tools:[{type:"web_search"}]` | GLM Coding Plan 模型额度 | ✅ 可用（2026-08-31 e2e 实测） |
| `webSearchSogou` / `webSearchQuark` | 官方 MCP 网关 `POST {gateway}/web_search/mcp` | MCP 资源包 | ⛔ 默认关——key 无资源包时每次调用 429 |

## 端点探测结论（2026-08-31 实测，防再踩坑）

- 官方 MCP 网关路径是 **`/api/mcp/web_search/mcp`**（`{gateway}/api/mcp` 裸路径 404；
  trailing-slash / `?beta=true` / `/sse` 全部无效）。
- 双网关同形：`open.bigmodel.cn`（国内）与 `api.z.ai`（国际）路径一致，同一把 key
  均能 initialize——但 `tools/call` 都回 `MCP error 429: 余额不足或无可用资源包`。
  即：**coding 套餐 key ≠ MCP 资源包额度**。
- coding 端点内置 web_search（chat completions `tools` 字段）走模型额度，实测可用，
  响应只有 `message.content`（无结构化 tool_calls）——所以桥内让模型在正文末尾附【来源】。

## 配置（环境变量，经 cordis.patch.yml `env` 传入）

| 变量 | 缺省 | 说明 |
| --- | --- | --- |
| `ZAI_KEYCHAIN_SERVICE` | `glm-api-key` | macOS Keychain 服务名（**key 只在启动时读入内存，不落盘**） |
| `ZAI_CHAT_BASE` | `https://open.bigmodel.cn/api/coding/paas/v4` | chat 通道 base |
| `ZAI_MODEL` | `glm-4.6` | chat 通道模型 |
| `ZAI_MCP_GATEWAY_BASE` | `https://open.bigmodel.cn/api/mcp` | 官方网关 base（api.z.ai 国际站同形） |
| `ZAI_ENABLE_GATEWAY` | `0` | 置 `1` 额外暴露官方网关直通工具（先开资源包） |
| `ZAI_CALL_TIMEOUT_MS` | `90000` | 单次调用超时 |

## DSH 注册（~/.dsh/profiles/web/cordis.patch.yml）

```yaml
- insert:
    - id: mcp-zai-websearch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zai
        transport: stdio
        command: node
        args: [/Users/Zhuanz/.dsh/mcp/zai-mcp/bridge.mjs]
        toolCallTimeoutMs: 120000
        failOnStartupError: false
        reconnect: { enabled: true }
```

工具出现在本 profile 的**每个新会话**（改补丁即时热加载拉起 bridge，已在跑的会话不注入）。

## 测试

```bash
cd ~/.dsh/mcp/zai-mcp && node e2e-test.mjs
# 期望：initialize ok / tools: web_search / call isError: false + 正文带【来源】
```
