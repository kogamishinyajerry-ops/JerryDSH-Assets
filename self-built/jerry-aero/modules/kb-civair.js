/**
 * dsh-kb-civair — 民用飞机设计知识底座 (civair-kb) 的 DSH 原生插件。
 *
 * 契约(HTTP sidecar, 127.0.0.1:8791, env CIVAIR_KB_URL / CIVAIR_KB_PYTHON 覆盖):
 *   GET  /health /status /manifest /gaps /proposals
 *   POST /query /get /cross /update /propose
 *
 * 治理不变量(与 sidecar 同源,插件侧只代理不放宽):
 *   - 源知识库永远只读;发布走 stage → validate → publish(confirm) → rollback
 *   - publish/rollback/proposal decide 需要显式 confirm:true(fail-closed 人审门禁)
 *   - 弱命中自动记缺口;扩充经提案 → 人审 → 源库自身 ingest → 新快照
 *
 * sidecar 不可达时自动拉起(detached python3 -m civair_kb.service),
 * 拉起失败给出修复提示,绝不假冒数据。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const name = "dsh-kb-civair";
export const inject = ["tools"];

const KB_HOME = process.env.CIVAIR_KB_HOME ?? "/Users/Zhuanz/projects/aircraft-comac/civair-kb";
const STORE_ROOT = process.env.CIVAIR_KB_STORE ?? path.join(os.homedir(), ".dsh/kb/civair");
const PYTHON = process.env.CIVAIR_KB_PYTHON ?? "/Users/Zhuanz/.local/bin/python3";
const BASE = (process.env.CIVAIR_KB_URL ?? "http://127.0.0.1:8791").replace(/\/+$/, "");
const HEALTH_TIMEOUT_MS = 2500;
const SPAWN_WAIT_MS = 30000;

// ---------- 极小 HTTP/JSON 客户端 ----------

function httpJson(method, urlPath, body, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers: data
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = { ok: false, error: "bad JSON from sidecar: " + text.slice(0, 200) };
          }
          resolve(json);
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("sidecar timeout (" + timeoutMs + "ms)")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function healthProbe() {
  try {
    return await httpJson("GET", "/health", undefined, HEALTH_TIMEOUT_MS);
  } catch {
    return null;
  }
}

// ---------- sidecar 自动拉起 ----------

let spawning = null;

function spawnSidecar() {
  mkdirSync(path.join(STORE_ROOT, "logs"), { recursive: true });
  const logFd = openSync(path.join(STORE_ROOT, "logs", "sidecar.log"), "a");
  const child = spawn(PYTHON, ["-m", "civair_kb.service"], {
    cwd: KB_HOME,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  return child.pid;
}

async function ensureSidecar() {
  let h = await healthProbe();
  if (h && h.ok) return h;
  if (spawning) await spawning;
  else {
    spawning = (async () => {
      let pid = "unknown";
      try {
        pid = spawnSidecar();
      } catch (err) {
        throw new Error("sidecar 拉起失败: " + err.message + " (检查 " + KB_HOME + " 与 python: " + PYTHON + ")");
      }
      const deadline = Date.now() + SPAWN_WAIT_MS;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const probe = await healthProbe();
        if (probe && probe.ok) return probe;
      }
      throw new Error("sidecar 拉起后 " + SPAWN_WAIT_MS + "ms 内未就绪 (pid " + pid + ", 日志: " + path.join(STORE_ROOT, "logs", "sidecar.log") + ")");
    })().finally(() => {
      spawning = null;
    });
    h = await spawning;
  }
  return h;
}

// ---------- 工具公共件 ----------

const OBJ = { type: "object" };

function line(text) {
  return { type: "text", text };
}

function resultRender(tag) {
  return (_args, value) => {
    const v = value || {};
    const head = v.ok === false
      ? tag + " FAILED: " + (v.error || "unknown error")
      : tag + " ok";
    return [line(head)];
  };
}

async function call(method, urlPath, body, timeoutMs) {
  const h = await ensureSidecar();
  const payload = await httpJson(method, urlPath, body, timeoutMs);
  return { _health: { version: h.version, uptime_s: h.uptime_s }, ...payload };
}

async function safeCall(method, urlPath, body, timeoutMs) {
  try {
    return await call(method, urlPath, body, timeoutMs);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------- 插件 ----------

async function apply(ctx) {
  const log = (...a) => ctx.logger.info(`[dsh-kb-civair] ${a.join(" ")}`);

  ctx.tools.register({
    name: "civair_kb_query",
    description:
      "民机知识底座检索（BM25，中英混检，域隔离）。研究民用飞机设计/发动机/适航条款/事件案例时先用本工具查证据，再谈结论。域: airworthiness(适航条款 FAR/CCAR/EASA+AC+TCDS) / engine_cases(P-ACE 2万+发动机事件案例) / engine_vault(发动机族与非包容知识)。filters 支持 engine_family/aircraft_family/severity_level/ata_chapter 等。弱命中自动记缺口（驱动知识扩充）。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "检索词（中英皆可，自动同义扩展）" },
        domains: { type: "array", items: { type: "string" }, description: "限定域，默认全域" },
        n: { type: "number", description: "返回条数（默认 8）" },
        filters: { type: "object", description: "结构化过滤，如 {\"engine_family\":\"CFM56\",\"severity_level\":\"high\"}" },
        record_gap: { type: "boolean", description: "弱命中是否记缺口（默认 true）" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    output: { schema: OBJ, render: resultRender("[kb query]") },
    async execute(args) {
      return safeCall("POST", "/query", {
        query: args.query,
        domains: args.domains,
        n: args.n,
        filters: args.filters,
        record_gap: args.record_gap !== false,
        actor: "dsh-agent",
      });
    },
  });

  ctx.tools.register({
    name: "civair_kb_get",
    description: "取知识底座单篇全文：条款原文(md 正文)、案例全字段(CSV 行)、发动机族笔记。用 civair_kb_query 拿到 domain+doc_id 后取细节。",
    parameters: {
      type: "object",
      properties: {
        domain: { type: "string", description: "airworthiness | engine_cases | engine_vault" },
        doc_id: { type: "string", description: "如 'CCAR-33 33.76' 或 'CASE-FAA_AD-7256e60c1515'" },
        body_chars: { type: "number", description: "正文截取长度（默认 4000）" },
      },
      required: ["domain", "doc_id"],
      additionalProperties: false,
    },
    output: { schema: OBJ, render: resultRender("[kb get]") },
    async execute(args) {
      return safeCall("POST", "/get", args);
    },
  });

  ctx.tools.register({
    name: "civair_kb_cross",
    description:
      "跨库本体关系查询（engine-kb-bridge Link Type SSOT）：engine_family → TCDS+高频触发条款+非包容条款；clause_id → 触发案例+专利；case_id → 涉及条款。例: {\"engine_family\":\"CFM56\"}。",
    parameters: {
      type: "object",
      properties: {
        engine_family: { type: "string", description: "发动机族，如 CFM56 / LEAP / CF6" },
        clause_id: { type: "string", description: "条款，如 'CCAR-25 25.471'" },
        case_id: { type: "string", description: "案例 id，如 CASE-NTSB-783a440a5056" },
      },
      additionalProperties: false,
    },
    output: { schema: OBJ, render: resultRender("[kb cross]") },
    async execute(args) {
      return safeCall("POST", "/cross", args);
    },
  });

  ctx.tools.register({
    name: "civair_kb_status",
    description: "知识底座状态：当前快照 id/文档量/各源 git 状态、快照列表、缺口阈值。健康巡检与引用快照号时使用。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: OBJ, render: resultRender("[kb status]") },
    async execute() {
      return safeCall("GET", "/status", undefined);
    },
  });

  ctx.tools.register({
    name: "civair_kb_update",
    description:
      "知识底座标准化更新管线（fail-closed）：stage(克隆只读源→建索引) → validate(阈值门禁) → publish(需 confirm:true，原子切换，源不变自动 no-op) → rollback(需 confirm:true)。源库内容变更后走此流程出新快照；绝不直接写源仓库。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "stage | validate | publish | rollback" },
        snapshot_id: { type: "string", description: "validate/publish 目标快照 id（stage 返回）" },
        to: { type: "string", description: "rollback 目标快照 id（缺省回上一个）" },
        confirm: { type: "boolean", description: "publish/rollback 必须显式 true（人审门禁）" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: { schema: OBJ, render: resultRender("[kb update]") },
    async execute(args) {
      const timeouts = { stage: 300000, validate: 120000, publish: 120000, rollback: 60000 };
      return safeCall("POST", "/update", { ...args, actor: "dsh-agent" }, timeouts[args.action] || 120000);
    },
  });

  ctx.tools.register({
    name: "civair_kb_gaps",
    description: "知识缺口日志：list 查看近期缺口与按域统计（知识扩充的需求信号）；record 手动补记一条缺口。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "list | record（默认 list）" },
        query: { type: "string", description: "record 时的缺口检索词" },
        limit: { type: "number", description: "list 条数（默认 50）" },
      },
      additionalProperties: false,
    },
    output: { schema: OBJ, render: resultRender("[kb gaps]") },
    async execute(args) {
      if ((args.action || "list") === "record") {
        if (!args.query) return { ok: false, error: "record 需要 query" };
        return safeCall("POST", "/gaps", { query: args.query, actor: "dsh-agent" });
      }
      return safeCall("GET", "/gaps?limit=" + (args.limit || 50), undefined);
    },
  });

  ctx.tools.register({
    name: "civair_kb_propose",
    description:
      "知识扩充提案（人审门禁）：draft 起草（引用缺口证据）→ list 查看 → decide 人审批准/拒绝（需 confirm:true）→ mark_ingested 标记已进入快照（需 confirm:true）。批准后由人/agent 去对应源库走其自身 ingest 流程取数，再 civair_kb_update 出新快照。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "draft | list | decide | mark_ingested" },
        title: { type: "string", description: "draft: 提案标题" },
        rationale: { type: "string", description: "draft: 理由（引用缺口证据）" },
        target_domain: { type: "string", description: "draft: 目标域（通常是一个源库 id）" },
        suggested_action: { type: "string", description: "draft: 建议动作（如引入某规章源）" },
        evidence_gap_ids: { type: "array", items: { type: "string" }, description: "draft: 关联缺口 id" },
        proposal_id: { type: "string", description: "decide/mark_ingested: 提案 id" },
        approve: { type: "boolean", description: "decide: true 批准 / false 拒绝" },
        note: { type: "string", description: "decide: 决策备注" },
        snapshot_id: { type: "string", description: "mark_ingested: 内容进入的快照 id" },
        confirm: { type: "boolean", description: "decide/mark_ingested 必须显式 true" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: { schema: OBJ, render: resultRender("[kb propose]") },
    async execute(args) {
      return safeCall("POST", "/propose", { ...args, actor: "dsh-agent" });
    },
  });

  log("mounted: civair_kb_query/get/cross/status/update/gaps/propose → " + BASE);
}

export { apply };
