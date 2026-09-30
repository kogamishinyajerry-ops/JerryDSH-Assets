/**
 * dsh-tool-pdf-fta — PDF → medini-like 故障树(中国商飞 KLW 项目 · 中期评审)
 *
 * 原生 DSH 插件(零依赖,仅 node: 内建):把 COMAC_Medini 后端的
 * PDF → fault_tree 三端点封装成 DSH 一等工具,复用平台 UI 会话,
 * 不自建 webui。
 *
 * 契约(HTTP,跨进程,默认 http://127.0.0.1:8000,env PDF_FTA_BACKEND 覆盖):
 *   POST /api/tasks/{id}/fault-tree/pdf-import-preview
 *   POST /api/tasks/{id}/fault-tree/pdf-import
 *   GET  /api/tasks/{id}/fault-tree/pdf-export/{extraction_id}.json
 *
 * 诚实边界(与后端 schema 字面量一致,README 同步声明):
 *   - medini-like 公开契约(OpenPSA MEF / XMI 公开子集风格),非 Ansys 认证
 *   - mock adapter 不冒充 LLM 理解;扫描件走 ground_truth_fallback 时显式标注
 *   - plugin 只读后端 API + 显式 import;后端落独立 pdf_fault_tree_imported
 *     audit event,不改任务状态机
 *   - 超时/重试/失败诊断:连接拒绝给"启 backend(./scripts/dev.sh)"提示
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const name = "dsh-tool-pdf-fta";
export const inject = ["tools"];

// 后端解析:默认 8000;遵循 dev.sh 约定(8000 被占自动换 8010)——
// 连接被拒,或对端是旧版后端(FastAPI 路由缺失的默认 404 "Not Found")时,
// 在 8000↔8010 间自动解析一次并在进程内记住。演示会话无需手工设
// PDF_FTA_BACKEND(显式设置则完全尊重,仅在这两个端口间自动换)。
const CONFIGURED_BACKEND = (process.env.PDF_FTA_BACKEND ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
// 330s:minimax 大文档抽取实测 170-250s 波动,留余量(后端 adapter 侧 300s)
const TIMEOUT_MS = Number(process.env.PDF_FTA_TIMEOUT_MS ?? 330000);
let BACKEND = CONFIGURED_BACKEND;

function altPortBackend(base) {
  if (base.endsWith(":8000")) return base.slice(0, -5) + ":8010";
  if (base.endsWith(":8010")) return base.slice(0, -5) + ":8000";
  return null;
}

// ---------- 极小 HTTP/JSON 客户端(带超时 + 连接拒绝诊断) ----------
function requestJson(base, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(base + urlPath);
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
          try { json = JSON.parse(text); } catch { json = undefined; }
          resolve({ status: res.statusCode, json, text });
        });
      },
    );
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`后端请求超时(>${TIMEOUT_MS}ms): ${method} ${urlPath}`));
    });
    req.on("error", (e) => reject(e));
    if (data) req.write(data);
    req.end();
  });
}

// 判定"打错后端了":连接被拒;或 404 且 detail 是 FastAPI 路由缺失默认值
// (我们自己的 404 都带中文具名 detail,不会撞这个判据)。
function isBackendMiss(resOrError) {
  if (resOrError && resOrError.code === "ECONNREFUSED") return true;
  return (
    resOrError &&
    typeof resOrError === "object" &&
    resOrError.status === 404 &&
    resOrError.json &&
    resOrError.json.detail === "Not Found"
  );
}

// 探针路由:仅本分支后端存在。新后端对不存在任务返回中文具名 404(非
// "Not Found"),旧后端返回 FastAPI 默认 404 → 一次 GET 即可判别,零副作用。
const _PROBE_PATH = "/api/tasks/_/fault-tree/pdf-export/x.json";
let _resolved = null;

function resolveBackend() {
  if (!_resolved) {
    _resolved = (async () => {
      for (const base of [CONFIGURED_BACKEND, altPortBackend(CONFIGURED_BACKEND)]) {
        if (!base) continue;
        try {
          const r = await requestJson(base, "GET", _PROBE_PATH);
          if (!isBackendMiss(r)) return base;
        } catch {
          /* 该端口不可达,试下一个 */
        }
      }
      return CONFIGURED_BACKEND; // 都不可判别:保持配置值,报错交给后续调用
    })();
  }
  return _resolved.then((base) => {
    BACKEND = base;
    return base;
  });
}

async function callApi(method, urlPath, body) {
  await resolveBackend(); // 进程内一次性解析(防首个 POST /api/tasks 建到旧实例)
  let res;
  try {
    res = await requestJson(BACKEND, method, urlPath, body);
  } catch (e) {
    if (isBackendMiss(e)) {
      const alt = altPortBackend(BACKEND);
      if (alt) {
        try {
          const altRes = await requestJson(alt, method, urlPath, body);
          if (!isBackendMiss(altRes)) {
            BACKEND = alt; // 解析成功,进程内记住
            res = altRes;
          }
        } catch {
          /* 备端口也不可达,走原错误提示 */
        }
      }
    }
    if (!res) {
      if (e.code === "ECONNREFUSED") {
        throw new Error(
          `无法连接 COMAC_Medini 后端(试过 ${CONFIGURED_BACKEND}${altPortBackend(CONFIGURED_BACKEND) ? " 与 " + altPortBackend(CONFIGURED_BACKEND) : ""})。` +
            `请先启动:cd ~/projects/aircraft-comac/COMAC_Medini && ./scripts/dev.sh`,
        );
      }
      throw e;
    }
  }
  if (isBackendMiss(res)) {
    // 首次命中旧版后端(路由缺失):试备端口,成功则记住并改用其响应
    const alt = altPortBackend(BACKEND);
    if (alt) {
      try {
        const altRes = await requestJson(alt, method, urlPath, body);
        if (!isBackendMiss(altRes)) {
          BACKEND = alt;
          res = altRes;
        }
      } catch {
        /* 备端口不可达,按原 404 报错 */
      }
    }
    if (isBackendMiss(res)) {
      const err = new Error(
        `后端 ${BACKEND} 无 pdf_fta 路由(疑似旧版实例)。请用本分支启动:` +
          `cd ~/projects/aircraft-comac/COMAC_Medini && ./scripts/dev.sh`,
      );
      err.status = res.status;
      throw err;
    }
  }
  if (res.status >= 400) {
    const detail = typeof res.json?.detail === "string" ? res.json.detail : JSON.stringify(res.json ?? res.text).slice(0, 400);
    const err = new Error(`后端 ${res.status}: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return res.json;
}

async function ensureTask(taskId) {
  if (taskId) {
    await callApi("GET", `/api/tasks/${encodeURIComponent(taskId)}`);
    return taskId;
  }
  const created = await callApi("POST", "/api/tasks", {
    mail_name: "pdf-fta-demo.md",
    mail_text: "PDF → medini-like 故障树演示任务(dsh-tool-pdf-fta 自动创建;仅承载 fault-tree 导入,不触发完整分析)。",
  });
  return created.task_id;
}

// ---------- 报告渲染(诚实边界常驻) ----------
function renderPreview(preview, { backend, task_id, adapter, imported }) {
  const lines = [];
  lines.push(`# PDF → medini-like 故障树 · 抽取预览`);
  lines.push(``);
  lines.push(`- 后端: ${backend}  任务: ${task_id}`);
  lines.push(`- extraction_id: ${preview.extraction_id}`);
  lines.push(`- import_ok: ${preview.import_ok}  节点数: ${preview.nodes.length}`);
  const sourceNote =
    preview.extraction_source === "ground_truth_fallback"
      ? "扫描件无文本层,已切人工真值转写——非 LLM 抽取结果"
      : adapter === "mock"
        ? "mock 规则占位,不冒充 LLM 理解;真实语义抽取须 minimax adapter"
        : "";
  lines.push(`- 抽取来源: ${preview.extraction_source}${sourceNote ? `(${sourceNote})` : ""}`);
  lines.push(`- adapter: ${preview.model_adapter || adapter}${preview.model_adapter === "minimax" ? "(真实 LLM 语义抽取,MiniMax-M3)" : ""}`);
  lines.push(`- 边界: medini-like 公开契约(OpenPSA/XMI 公开子集)· 非 Ansys medini 认证`);
  if (imported) {
    lines.push(`- 已导入: ${imported.status} doc=${imported.doc_id} tree=${imported.tree_id} audit_event=${imported.audit_event_id}`);
  }
  if (preview.nodes.length) {
    lines.push(``);
    lines.push(`## 节点(前 12 个,共 ${preview.nodes.length})`);
    for (const n of preview.nodes.slice(0, 12)) {
      const gate = n.gate_type ? ` [${n.gate_type}]` : "";
      const prob = n.probability === null ? "P=∅" : `P=${n.probability}`;
      const kids = n.child_nodes.length ? ` → {${n.child_nodes.slice(0, 4).join(", ")}${n.child_nodes.length > 4 ? ", …" : ""}}` : "";
      lines.push(`- ${n.node_id}${gate} ${n.node_name} (${n.node_type}, ${prob})${kids}`);
    }
  }
  if (preview.diagnostics.length) {
    lines.push(``);
    lines.push(`## 诊断`);
    for (const d of preview.diagnostics) {
      lines.push(`- [${d.severity}] ${d.code}: ${d.message}`);
    }
  }
  lines.push(``);
  lines.push(`概率缺失处显式 None(不臆造);确认导入: pdf_fta_import(task_id=${task_id}, extraction_id=${preview.extraction_id}, accept=true)`);
  return lines.join("\n");
}

// ---------- 插件注册 ----------
export function apply(ctx) {

  ctx.tools.register({
    name: "pdf_fta_evaluate",
    description:
      "自有定量内核评估已导入的 PDF 故障树(medini 替代核心):最小割集 + 顶事件概率(AND/OR 内核),可选 ROBDD 精确值。" +
      "自动对照 F2244 报告的 Q_wc(从导入树顶事件描述解析)给出相对偏差。注意:task_id 必须是导入树所在的独占任务(pdf_fta 不传 task_id 时自动新建的就是)。",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "导入树所在任务 ID" },
        root_node_id: { type: "string", description: "可选:评估指定子树根(默认顶事件)" },
        bdd: { type: "boolean", description: "同时算 ROBDD 精确顶概率(默认 true)" },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: v.report }],
    },
    async execute(args) {
      try {
        const q = args.root_node_id ? `?root_node_id=${encodeURIComponent(args.root_node_id)}` : "";
        const ev = await callApi("GET", `/api/tasks/${encodeURIComponent(args.task_id)}/fault-tree/evaluation${q}`);
        let bdd = null;
        if (args.bdd !== false) {
          try {
            bdd = await callApi("GET", `/api/tasks/${encodeURIComponent(args.task_id)}/fault-tree/bdd-exact-probability${q}`);
          } catch { bdd = null; }
        }
        // 报告参照值:树顶事件描述里的 Q_wc(转写惯例,与内核 parse_q_wc 同源)
        let reportQwc = null;
        const topNode = (ev.probability_inputs && ev.probability_inputs.length, null);
        const treeResp = await callApi("GET", `/api/tasks/${encodeURIComponent(args.task_id)}/fault-tree`).catch(() => null);
        const nodes = (treeResp && treeResp.tree && treeResp.tree.nodes) || [];
        const root = ev.root_node_id || "C01-TOP";
        const rootNode = nodes.find((n) => n.node_id === root);
        if (rootNode) {
          const m = String(rootNode.description || "").match(/Q_wc=([0-9]+(?:\.[0-9]+)?[Ee][+-]?[0-9]+)/);
          if (m) reportQwc = parseFloat(m[1]);
        }
        const top = ev.top_probability;
        const relDev = top != null && reportQwc != null ? (top - reportQwc) / reportQwc : null;
        const cuts = ev.minimal_cut_sets || [];
        const topCuts = cuts.slice(0, 3).map((s) => `  - {${s.event_ids.join(", ")}} P=${s.probability ?? "∅"}`);
        const lines = [];
        lines.push(`# 自有内核定量评估(medini 替代对数)`);
        lines.push(``);
        lines.push(`- 任务 ${args.task_id} · 根 ${root} · 方法 ${ev.method}`);
        lines.push(`- 顶事件概率(内核自算): **${top != null ? top.toExponential(6) : "不可算(缺概率输入,fail-closed)"}**`);
        if (reportQwc != null) lines.push(`- F2244 报告 Q_wc 参照: ${reportQwc.toExponential(6)}`);
        if (relDev != null) lines.push(`- 相对偏差: **${(relDev * 100).toFixed(2)}%**(转写有效数字舍入量级)`);
        if (bdd && bdd.exact_top_probability != null) {
          lines.push(`- ROBDD 精确值(独立底事件假设): ${bdd.exact_top_probability.toExponential(6)}(BDD 节点 ${bdd.bdd_node_count})`);
        }
        lines.push(`- 最小割集: ${cuts.length} 个(全部列表见 evaluation 响应)`);
        lines.push(`- 概率输入: ${ev.probability_inputs ? ev.probability_inputs.length : 0} 个底事件`);
        if (topCuts.length) lines.push(``, `## 概率最高的割集`, ...topCuts);
        lines.push(``);
        lines.push(`边界:内核为一阶 AND/OR + 独立底事件假设(Q_wc 语义);非 Ansys medini 认证。`);
        return {
          ok: top != null,
          task_id: args.task_id,
          root_node_id: root,
          method: ev.method,
          top_probability: top,
          report_qwc: reportQwc,
          relative_deviation: relDev,
          cut_set_count: cuts.length,
          top_cut_sets: cuts.slice(0, 3),
          bdd_exact: bdd ? bdd.exact_top_probability : null,
          evaluation: ev,
          report: lines.join("\n"),
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e), report: `# 评估失败\n\n${String(e && e.message || e)}\n\n排查:① 该 task_id 是否导入过树(pdf_fta import_tree=true)?② 后端 8010 活着?` };
      }
    },
  });

  ctx.tools.register({
    name: "pdf_fta",
    description:
      "解析本地 PDF(F2244 类航空 FTA 报告)→ medini-like 故障树抽取预览。" +
      "扫描件(无文本层)在 fallback=true 时显式切换人工真值转写并标注。可选 import=true 直接确认为任务草稿树(独立 audit event,不改任务状态机)。" +
      "输出为 medini-like 公开契约,非 Ansys medini 认证。",
    parameters: {
      type: "object",
      properties: {
        pdf_path: { type: "string", description: "PDF 文件绝对路径" },
        task_id: { type: "string", description: "后端任务 ID(省略则自动建演示任务)" },
        model_adapter: { type: "string", enum: ["mock", "minimax", "openai_compat"], description: "默认 mock(规则占位,不冒充 LLM;真实语义理解须 minimax)" },
        fallback: { type: "boolean", description: "抽取失败时显式切 thrust_reverser 真值转写(默认 true,响应中 extraction_source 标注)" },
        import_tree: { type: "boolean", description: "预览成功后直接导入为任务草稿故障树(默认 false,仅预览)" },
      },
      required: ["pdf_path"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: v.report }],
    },
    async execute(args) {
      const adapter = args.model_adapter ?? "mock";
      const fallback = args.fallback ?? true;
      try {
        const taskId = await ensureTask(args.task_id);
        const pdf = await readFile(args.pdf_path);
        // node 无内建 b64 流式,2.3MB PDF → ~3MB 字符串,一次性可接受
        const preview = await callApi(
          "POST",
          `/api/tasks/${encodeURIComponent(taskId)}/fault-tree/pdf-import-preview`,
          {
            pdf_base64: pdf.toString("base64"),
            source_pdf_name: path.basename(args.pdf_path),
            model_adapter: adapter,
            allow_ground_truth_fallback: fallback,
          },
        );
        let imported;
        if (args.import_tree && preview.import_ok) {
          imported = await callApi(
            "POST",
            `/api/tasks/${encodeURIComponent(taskId)}/fault-tree/pdf-import`,
            { extraction_id: preview.extraction_id, accept: true },
          );
        }
        return {
          backend: BACKEND,
          task_id: taskId,
          extraction_id: preview.extraction_id,
          import_ok: preview.import_ok,
          extraction_source: preview.extraction_source,
          node_count: preview.nodes.length,
          nodes_sample: preview.nodes.slice(0, 12),
          diagnostics: preview.diagnostics,
          imported: imported ?? null,
          report: renderPreview(preview, { backend: BACKEND, task_id: taskId, adapter, imported }),
        };
      } catch (e) {
        return {
          backend: BACKEND,
          import_ok: false,
          node_count: 0,
          error: String(e && e.message || e),
          report: `# PDF → 故障树失败\n\n${String(e && e.message || e)}\n\n排查:① 后端已启(./scripts/dev.sh)?② pdf_path 存在?③ 后端 diagnostics 见 error 字段。`,
        };
      }
    },
  });

  ctx.tools.register({
    name: "pdf_fta_import",
    description:
      "把 pdf_fta 的抽取预览确认为任务草稿故障树(人工确认语义,accept 必须显式 true)。产生独立 pdf_fault_tree_imported audit event;不改任务状态机。",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        extraction_id: { type: "string" },
        accept: { type: "boolean", description: "必须显式 true(签发权在人)" },
      },
      required: ["task_id", "extraction_id", "accept"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: v.report }],
    },
    async execute(args) {
      try {
        if (args.accept !== true) {
          return { ok: false, report: "拒绝导入:accept≠true。PDF 抽取结果是候选,签发权在人。" };
        }
        const result = await callApi(
          "POST",
          `/api/tasks/${encodeURIComponent(args.task_id)}/fault-tree/pdf-import`,
          { extraction_id: args.extraction_id, accept: true },
        );
        return {
          ok: true,
          ...result,
          report:
            `# PDF 故障树已导入\n\n- 任务 ${args.task_id} 草稿树:${result.tree_id}(doc=${result.doc_id},${result.node_count} 节点)\n` +
            `- 独立 audit event:${result.audit_event_id}(seq=${result.audit_event_seq}),任务状态机零改动\n` +
            `- 导出:pdf_fta_export(task_id=${args.task_id}, extraction_id=${args.extraction_id})`,
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e), report: `# 导入失败\n\n${String(e && e.message || e)}` };
      }
    },
  });

  ctx.tools.register({
    name: "pdf_fta_export",
    description: "按 extraction_id 导出 medini-like 故障树 JSON(公开契约:OpenPSA MEF / XMI 公开子集风格;非 Ansys medini 认证)。",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        extraction_id: { type: "string" },
        save_to: { type: "string", description: "可选:导出 JSON 落盘路径(省略仅返回)" },
      },
      required: ["task_id", "extraction_id"],
      additionalProperties: false,
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_a, v) => [{ type: "text", text: v.report }],
    },
    async execute(args) {
      try {
        const pkg = await callApi(
          "GET",
          `/api/tasks/${encodeURIComponent(args.task_id)}/fault-tree/pdf-export/${encodeURIComponent(args.extraction_id)}.json`,
        );
        let savedTo = null;
        if (args.save_to) {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(args.save_to, JSON.stringify(pkg, null, 2), "utf8");
          savedTo = args.save_to;
        }
        return {
          ok: true,
          schema_version: pkg.schema_version,
          certification_boundary: pkg.certification_boundary,
          node_count: pkg.nodes.length,
          saved_to: savedTo,
          package: pkg,
          report:
            `# medini-like 故障树导出\n\n- ${pkg.nodes.length} 节点 · schema ${pkg.schema_version}\n` +
            `- 边界:${pkg.certification_boundary}(非 Ansys 认证,不逆向 medini 私有格式)\n` +
            (savedTo ? `- 已落盘:${savedTo}\n` : ""),
        };
      } catch (e) {
        return { ok: false, error: String(e && e.message || e), report: `# 导出失败\n\n${String(e && e.message || e)}` };
      }
    },
  });
}
