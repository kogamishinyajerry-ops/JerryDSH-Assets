#!/usr/bin/env node
// zai-mcp bridge — Z.ai / BigModel 联网搜索 MCP 桥（stdio server）
// ---------------------------------------------------------------------------
// 通道（2026-08-31 实测定案）：
//   A. chat 通道（默认，立即可用）：coding 端点 chat/completions 内置
//      tools:[{type:"web_search"}]，走 GLM Coding Plan 模型额度——不消耗
//      MCP 资源包。输出 = 模型综合答案 + 末尾来源链接。
//   B. 官方 MCP 网关直通（ZAI_ENABLE_GATEWAY=1 时启用）：
//      POST {base}/web_search/mcp，工具 webSearchSogou / webSearchQuark，
//      按 MCP 资源包计费——开通资源包后再打开，否则每次调用 429。
//
// 密钥纪律（照 dsh-comac-benchmark 先例）：API key 只在进程启动时从
// macOS Keychain 读取（security find-generic-password -s <service> -w），
// 绝不写入 argv / 环境文件 / 磁盘。
// ---------------------------------------------------------------------------
import { execSync } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  PingRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const CONF = {
  keychainService: process.env.ZAI_KEYCHAIN_SERVICE || "glm-api-key",
  chatBase: process.env.ZAI_CHAT_BASE || "https://open.bigmodel.cn/api/coding/paas/v4",
  model: process.env.ZAI_MODEL || "glm-4.6",
  gatewayBase: process.env.ZAI_MCP_GATEWAY_BASE || "https://open.bigmodel.cn/api/mcp",
  enableGateway: process.env.ZAI_ENABLE_GATEWAY === "1",
  callTimeoutMs: Number(process.env.ZAI_CALL_TIMEOUT_MS || 90000),
};

let cachedKey = null;
function apiKey() {
  if (cachedKey) return cachedKey;
  try {
    cachedKey = execSync(
      `security find-generic-password -s ${CONF.keychainService} -w`,
      { encoding: "utf8", timeout: 8000 },
    ).trim();
    if (!cachedKey) throw new Error("empty key");
    return cachedKey;
  } catch (e) {
    throw new Error(
      `[zai-mcp] 无法从 macOS Keychain 读取 ${CONF.keychainService}: ${e.message}。` +
        `（macOS: 密钥串中添加服务名 ${CONF.keychainService} 的通用密码；` +
        `或用 ZAI_KEYCHAIN_SERVICE 指向已有服务名）`,
    );
  }
}

const RECENCY = new Set(["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"]);

// ---------- 通道 A：coding 端点内置 web_search ----------
async function chatWebSearch({ query, count = 8, recency = "noLimit" }) {
  if (typeof query !== "string" || !query.trim()) throw new Error("query 必填");
  count = Math.max(1, Math.min(50, Number(count) || 8));
  if (!RECENCY.has(recency)) recency = "noLimit";

  const body = {
    model: CONF.model,
    thinking: { type: "disabled" },
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content:
          `请联网搜索以下问题并回答（中文，直接给结论，信息密度高，不要寒暄）：\n${query}\n` +
          `要求：末尾必须有【来源】小节，逐行列出实际参考的网页标题与 URL。`,
      },
    ],
    tools: [
      {
        type: "web_search",
        web_search: { enable: true, search_result: true, count, search_recency_filter: recency },
      },
    ],
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CONF.callTimeoutMs);
  let resp;
  try {
    resp = await fetch(`${CONF.chatBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`[zai-mcp] chat 通道 HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`[zai-mcp] 响应非 JSON: ${text.slice(0, 200)}`);
  }
  const msg = data?.choices?.[0]?.message;
  const out = (msg?.content || "").trim();
  if (!out) {
    throw new Error(
      `[zai-mcp] 模型返回空 content（finish_reason=${data?.choices?.[0]?.finish_reason}，` +
        `usage=${JSON.stringify(data?.usage ?? {})}）`,
    );
  }
  return out;
}

// ---------- 通道 B：官方 MCP 网关直通（需资源包） ----------
let gwSession = null; // { id, expiresAt }
async function gatewayCall(tool, args) {
  const url = `${CONF.gatewayBase}/web_search/mcp`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${apiKey()}`,
  };
  if (gwSession) headers["Mcp-Session-Id"] = gwSession.id;

  const post = async (payload) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONF.callTimeoutMs);
    try {
      const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: ctrl.signal });
      const sid = r.headers.get("mcp-session-id");
      if (sid) gwSession = { id: sid };
      const t = await r.text();
      // SSE 帧：取最后一个 data: 行
      const lines = t.split("\n").filter((l) => l.startsWith("data:"));
      const raw = lines.length ? lines[lines.length - 1].slice(5).trim() : t;
      return { ok: r.ok, status: r.status, raw };
    } finally {
      clearTimeout(timer);
    }
  };

  let r = await post({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } });
  let parsed;
  try {
    parsed = JSON.parse(r.raw);
  } catch {
    parsed = null;
  }
  if (parsed?.error?.code === -32600 || /session/i.test(String(parsed?.error?.message))) {
    // 会话失效 → 重新 initialize 一次再试
    const init = await post({
      jsonrpc: "2.0", id: Date.now(), method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "zai-mcp-bridge", version: "0.1.0" } },
    });
    if (init.ok) {
      await post({ jsonrpc: "2.0", method: "notifications/initialized" });
      r = await post({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool, arguments: args } });
      try { parsed = JSON.parse(r.raw); } catch { parsed = null; }
    }
  }
  if (!parsed) throw new Error(`[zai-mcp] 网关响应不可解析: ${r.raw.slice(0, 200)}`);
  if (parsed.error) throw new Error(`[zai-mcp] 网关错误: ${JSON.stringify(parsed.error).slice(0, 300)}`);
  const c = parsed.result?.content;
  const txt = Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : JSON.stringify(parsed.result);
  if (parsed.result?.isError) throw new Error(`[zai-mcp] 远端工具错误: ${txt.slice(0, 300)}`);
  return txt;
}

// ---------- MCP server ----------
const CHAT_TOOL = {
  name: "web_search",
  description:
    "联网搜索（Z.ai/BigModel GLM coding 端点内置 web_search 通道）。输入查询词，返回综合答案与来源链接列表。" +
    "适合查最新技术信息、文档、新闻、第三方工具等。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索查询（建议 ≤70 字符；可中文可英文）" },
      count: { type: "integer", description: "参考结果条数 1-50，默认 8" },
      recency: {
        type: "string",
        enum: ["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"],
        description: "时间范围过滤，默认 noLimit",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

const GATEWAY_TOOLS = [
  {
    name: "webSearchSogou",
    description: "官方 MCP 网关搜狗通道（按 MCP 资源包计费；返回标题/URL/摘要）。",
    inputSchema: {
      type: "object",
      properties: {
        search_query: { type: "string", description: "搜索内容" },
        count: { type: "integer", description: "10/20/30/40/50，默认 10" },
      },
      required: ["search_query"],
      additionalProperties: false,
    },
  },
  {
    name: "webSearchQuark",
    description: "官方 MCP 网关夸克通道（按 MCP 资源包计费；返回标题/URL/摘要）。",
    inputSchema: {
      type: "object",
      properties: {
        search_query: { type: "string", description: "搜索内容" },
        count: { type: "integer", description: "10/20/30/40/50，默认 10" },
      },
      required: ["search_query"],
      additionalProperties: false,
    },
  },
];

const server = new Server(
  { name: "zai-mcp-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: CONF.enableGateway ? [CHAT_TOOL, ...GATEWAY_TOOLS] : [CHAT_TOOL],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === "web_search") {
      return { content: [{ type: "text", text: await chatWebSearch(args) }] };
    }
    if (name === "webSearchSogou" || name === "webSearchQuark") {
      if (!CONF.enableGateway) {
        throw new Error("[zai-mcp] 网关直通未启用（启动环境变量 ZAI_ENABLE_GATEWAY=1；需 MCP 资源包额度）");
      }
      const text = await gatewayCall(name, {
        search_query: String(args.search_query ?? ""),
        ...(args.count ? { count: args.count } : {}),
      });
      return { content: [{ type: "text", text }] };
    }
    throw new Error(`未知工具: ${name}`);
  } catch (e) {
    return { content: [{ type: "text", text: `ERROR: ${e.message}` }], isError: true };
  }
});

server.setRequestHandler(PingRequestSchema, async () => ({}));

// stdio：日志走 stderr（stdout 是协议通道）
process.stderr.write(`[zai-mcp] bridge up (chat=${CONF.chatBase} model=${CONF.model} gateway=${CONF.enableGateway})\n`);
await server.connect(new StdioServerTransport());
