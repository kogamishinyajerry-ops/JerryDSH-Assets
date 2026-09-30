/**
 * dsh-comac-benchmark — 民机设计 Benchmark Harness（JerryDSH-COMACBench）DSH 插件。
 *
 * 定位：**薄代理**。评测逻辑（adapter 判分管线 / 沙箱 / provider 层）的 SSOT 永远在
 * 仓库 `runners/`，本插件只做发现 / 起跑 / 读结果——不复制任何判分或生成逻辑，
 * 仓库演进插件自动跟随。
 *
 * 工具面（前缀 comac_）：
 *   comac_registry    列 registry.yaml 全部基准（id/status/adapter/env/license）
 *   comac_bench       单基准详情：任务数 / 解释器 / 环境要求 / 已有结果矩阵
 *   comac_run         脱离起跑一条基线（detached + log 落盘 + 恒为 --resume 幂等）
 *   comac_run_status  运行状态：log 尾部 + 结果计数 + 进程存活
 *   comac_results     读某次运行的 summary + 从 result JSON 重算 gate/失败模式分布
 *   comac_report      读报告文档（九维度基线 / batch 总结 / 里程碑 M1-M4）
 *
 * 环境契约：
 *   COMAC_BENCH_HOME  仓库根（默认 .../JerryDSH-COMACBench）
 *   provider=glm      起跑时从 macOS Keychain 注入 GLM_API_KEY（security …
 *                     glm-api-key，密钥只进子进程 env，绝不落盘/回显）
 *   provider=minimax  同上（minimax-m3-api-key）
 *   pycycle.engine_cycle 用仓库 .venv（om-pycycle 兼容钉子栈，见其 PROVENANCE）
 *
 * 长跑事实（2026-08 实测）：LLM 基线单题 3-44 min、全量 100+ 题 = 小时级——
 * 所以 comac_run 一律脱离返回，配合 --resume 断点续跑；不阻塞会话。
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const name = "dsh-comac-benchmark";
export const inject = ["tools"];

const HOME = process.env.COMAC_BENCH_HOME
  ?? "/Users/Zhuanz/projects/jerry-personal/JerryDSH-COMACBench";
const PY = "python3";
const LOG_DIR = "/tmp";

// adapter → runner 模块（registry.yaml 的 adapter 字段是 SSOT，这里只做映射）
const RUNNER_OF_ADAPTER = {
  qa_grounded: "runners.qa_grounded",
  code_exec: "runners.code_exec",
  simulation_agent: "runners.simulation_agent",
  field_prediction: "runners.field_prediction",
};
// 解释器特例：pycycle 需要 .venv 的 om-pycycle 钉子栈；其余系统 python3 即可
const INTERP_OF_RID = { "pycycle.engine_cycle": path.join(HOME, ".venv/bin/python") };
// 环境要求提示（起跑前检查并如实报告，不静默降级）
const ENV_NEEDS = {
  "cfdllm.foam_basic": { docker: true, note: "判分需 docker OpenFOAM（场 NMSE 比对）" },
  "pycycle.engine_cycle": { venv: true, note: "需仓库 .venv（om-pycycle 钉子栈）" },
};
// provider → keychain service（起跑时注入 env；离线 provider 不需要）
const KEYCHAIN_OF_PROVIDER = {
  glm: { env: "GLM_API_KEY", service: "glm-api-key" },
  minimax: { env: "MINIMAX_M3_API_KEY", service: "minimax-m3-api-key" },
};
const PROVIDERS = ["stub", "oracle", "glm", "minimax", "openai_compat", "ml_superwing", "ml_hilift"];

// ---------- 小工具 ----------

function fail(msg) {
  return { ok: false, error: msg };
}

function repoMustExist() {
  if (!existsSync(HOME)) {
    throw new Error(`仓库不存在: ${HOME}（用 COMAC_BENCH_HOME 覆盖）`);
  }
}

function pyJson(snippet, timeoutMs = 15000) {
  const r = spawnSync(PY, ["-c", snippet], { cwd: HOME, encoding: "utf8", timeout: timeoutMs });
  if (r.status !== 0) throw new Error("python3 失败: " + (r.stderr || "").slice(0, 300));
  return JSON.parse(r.stdout);
}

/** 读 registry.yaml → [{id,status,adapter,env_class,license_status}] */
function loadRegistry() {
  repoMustExist();
  const rows = pyJson(
    `import yaml,json\n` +
    `reg=yaml.safe_load(open('registry/registry.yaml'))\n` +
    `out=[]\n` +
    `for e in (reg.get('benchmarks') or reg.get('entries') or []):\n` +
    `    out.append({'id':e.get('id'),'status':e.get('status'),'adapter':e.get('adapter'),` +
    `'env_class':e.get('env_class'),'license_status':e.get('license_status')})\n` +
    `print(json.dumps(out))\n`);
  if (!rows.length) throw new Error("registry.yaml 解析为空（结构变更？检查 benchmarks/entries 键）");
  return rows;
}

/** 一个基准的既有结果矩阵 results/<rid>/<date>/<provider> → 计数 */
function resultMatrix(rid) {
  const root = path.join(HOME, "results", rid);
  if (!existsSync(root)) return [];
  const out = [];
  for (const date of readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory()).sort()) {
    for (const prov of readdirSync(path.join(root, date)).filter((d) => statSync(path.join(root, date, d)).isDirectory()).sort()) {
      const n = readdirSync(path.join(root, date, prov)).filter((f) => /^result_.*\.json$/.test(f)).length;
      out.push({ date, provider: prov, results: n });
    }
  }
  return out;
}

function benchMeta(rid) {
  const entry = loadRegistry().find((e) => e.id === rid);
  if (!entry) throw new Error(`未知 registry_id: ${rid}`);
  const tasksDir = path.join(HOME, "tasks", rid);
  const nTasks = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter((f) => f.endsWith(".yaml")).length : 0;
  const module = RUNNER_OF_ADAPTER[entry.adapter];
  const interp = INTERP_OF_RID[rid] ?? PY;
  return { entry, nTasks, tasksDir, module, interp, env: ENV_NEEDS[rid] ?? null };
}

/** 环境预检（docker / venv / keychain），返回阻塞项列表 */
function envCheck(rid, provider) {
  const problems = [];
  const needs = ENV_NEEDS[rid];
  if (needs?.docker) {
    const r = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", timeout: 10000 });
    if (r.status !== 0) problems.push("docker 不可用（foam 判分需要）");
  }
  if (needs?.venv) {
    const v = INTERP_OF_RID[rid];
    if (!existsSync(v)) problems.push(`缺 ${v}（按 PROVENANCE 钉子栈重建）`);
  }
  const kc = KEYCHAIN_OF_PROVIDER[provider];
  if (kc && !keychainKey(kc.service)) problems.push(`Keychain 无 ${kc.service}（无法注入 ${kc.env}）`);
  return problems;
}

function keychainKey(service) {
  const r = spawnSync("security",
    ["find-generic-password", "-a", os.userInfo().username, "-s", service, "-w"],
    { encoding: "utf8", timeout: 8000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** 从 result JSON 重算 gate / 失败模式分布 + 均分 */
function aggregate(runDir) {
  const dist = { n: 0, gate_passed: 0, scores: [], failure_modes: {} };
  for (const f of readdirSync(runDir).filter((f) => /^result_.*\.json$/.test(f)).sort()) {
    let r;
    try { r = JSON.parse(readFileSync(path.join(runDir, f), "utf8")); }
    catch { continue; }
    dist.n += 1;
    if (r.validity_gate === 1) dist.gate_passed += 1;
    dist.scores.push(r.score ?? 0);
    const fm = r.failure_mode ?? (r.validity_gate === 1 ? "PASS" : "unknown");
    dist.failure_modes[fm] = (dist.failure_modes[fm] ?? 0) + 1;
  }
  dist.mean_score = dist.scores.length
    ? Math.round((dist.scores.reduce((a, b) => a + b, 0) / dist.scores.length) * 10000) / 10000 : null;
  delete dist.scores;
  return dist;
}

function head(text, lines = 40) {
  return text.split("\n").slice(0, lines).join("\n");
}

// ---------- 工具注册 ----------

export function apply(ctx) {
  const T = ctx.tools;

  T.register({
    name: "comac_registry",
    description: "列出民机 benchmark registry 全部基准: id / status / adapter / env_class / " +
      "license_status。status 流转: proposed→staged→integrated→active, paused-env=内网环境缺失。" +
      "先看这里再选基准跑基线。",
    parameters: { type: "object", properties: {
      status: { type: "string", description: "可选: 只看某状态(integrated/staged/proposed/paused-env)" },
    }, additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 1) }] },
    async execute(args) {
      try {
        repoMustExist();
        let rows = loadRegistry();
        if (args?.status) rows = rows.filter((e) => e.status === args.status);
        return { ok: true, repo: HOME, n: rows.length, benchmarks: rows };
      } catch (e) { return fail(String(e.message ?? e)); }
    },
  });

  T.register({
    name: "comac_bench",
    description: "单个基准详情: 任务数 / runner 模块 / 解释器 / 环境要求 / 既有结果矩阵" +
      "(date×provider×计数)。跑 comac_run 前用它确认 registry_id 与环境。",
    parameters: { type: "object", properties: {
      registry_id: { type: "string", description: "如 cfdllm.foam_basic / hilift_aeroml.lite" },
    }, required: ["registry_id"], additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 1) }] },
    async execute(args) {
      try {
        const m = benchMeta(args.registry_id);
        return { ok: true, ...m.entry, n_tasks: m.nTasks, runner_module: m.module,
          interpreter: m.interp, env_requirements: m.env,
          runs: resultMatrix(args.registry_id) };
      } catch (e) { return fail(String(e.message ?? e)); }
    },
  });

  T.register({
    name: "comac_run",
    description: "脱离起跑一条基线(不阻塞会话): spawn detached + 日志落盘 + 恒为 --resume" +
      "(幂等, 已有 result_*.json 直接跳过)。provider=oracle 可作判分管线自检(必须满分);" +
      "stub 离线冒烟。glm/minimax 的 API key 起跑时从 macOS Keychain 注入, 不落盘。" +
      "LLM 全量基线是小时级长跑——起跑后用 comac_run_status 轮询。",
    parameters: { type: "object", properties: {
      registry_id: { type: "string", description: "目标基准" },
      provider: { type: "string", description: "stub | oracle | glm | minimax | openai_compat | ml_superwing | ml_hilift" },
      model: { type: "string", description: "可选: 模型名(缺省用 provider 预设)" },
      date: { type: "string", description: "可选: 结果日期目录(缺省当天, 如 2026-08-19)" },
      seed: { type: "integer", description: "缺省 0" },
    }, required: ["registry_id", "provider"], additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 1) }] },
    async execute(args) {
      try {
        const m = benchMeta(args.registry_id);
        if (!m.module) return fail(`adapter 无 runner 映射: ${m.entry.adapter}`);
        if (!PROVIDERS.includes(args.provider)) return fail(`未知 provider: ${args.provider}`);
        const problems = envCheck(args.registry_id, args.provider);
        if (problems.length) return fail("环境预检未过: " + problems.join("; "));
        const date = args.date ?? new Date().toISOString().slice(0, 10);
        const outDir = path.join(HOME, "results", args.registry_id, date, args.provider);
        const argv = ["-m", m.module, "--tasks", path.join("tasks", args.registry_id),
          "--out", path.join("results", args.registry_id, date, args.provider),
          "--provider", args.provider, "--seed", String(args.seed ?? 0), "--resume"];
        if (args.model) argv.push("--model", args.model);
        const env = { ...process.env, MPLCONFIGDIR: "/tmp" };
        const kc = KEYCHAIN_OF_PROVIDER[args.provider];
        if (kc) {
          const key = keychainKey(kc.service);
          if (key) env[kc.env] = key; // envCheck 已确保存在；双保险不抛密钥内容
        }
        const logPath = path.join(LOG_DIR,
          `comac_run_${args.registry_id.replace(/[^A-Za-z0-9._-]/g, "_")}_${args.provider}.log`);
        const fd = openSync(logPath, "a");
        const stamp = new Date().toISOString();
        writeSync(fd, `\n[comac-run] ${stamp} ${m.interp} ${argv.join(" ")}\n`);
        const child = spawn(m.interp, argv, { cwd: HOME, detached: true, stdio: ["ignore", fd, fd], env });
        child.unref();
        return { ok: true, pid: child.pid, log: logPath, out_dir: outDir,
          command: `cd ${HOME} && ${m.interp} ${argv.join(" ")}`,
          note: "脱离运行中; resume 幂等; 完成判据 = summary.md 出现且进程退出" };
      } catch (e) { return fail(String(e.message ?? e)); }
    },
  });

  T.register({
    name: "comac_run_status",
    description: "运行状态: 结果计数 / 最新落盘时间 / 进程存活 / 日志尾。传 log 看指定运行," +
      "或传 registry_id 扫该基准全部日期目录找最新一次。",
    parameters: { type: "object", properties: {
      registry_id: { type: "string", description: "基准 id（与 log 二选一）" },
      log: { type: "string", description: "comac_run 返回的日志路径（与 registry_id 二选一）" },
    }, additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 1) }] },
    async execute(args) {
      try {
        repoMustExist();
        const out = { ok: true };
        if (args.log) {
          out.log_tail = existsSync(args.log) ? tail(args.log, 15) : "(日志不存在)";
          out.alive = pgrepAlive(path.basename(args.log).replace(/^comac_run_|\.log$/g, ""));
        } else if (args.registry_id) {
          const matrix = resultMatrix(args.registry_id);
          out.runs = matrix;
          const tasksDir = path.join(HOME, "tasks", args.registry_id);
          const nTasks = existsSync(tasksDir)
            ? readdirSync(tasksDir).filter((f) => f.endsWith(".yaml")).length : null;
          out.n_tasks = nTasks;
          out.alive = pgrepAlive(args.registry_id.replace(/[^A-Za-z0-9._-]/g, " "));
        } else return fail("需要 registry_id 或 log 之一");
        return out;
      } catch (e) { return fail(String(e.message ?? e)); }
    },
  });

  T.register({
    name: "comac_results",
    description: "读某次运行结果: summary.md 头部 + 从 result JSON 重算的 gate 通过数/" +
      "失败模式分布/均分(独立于 runner 汇总, 防跑一半的 summary 误导)。",
    parameters: { type: "object", properties: {
      registry_id: { type: "string" },
      date: { type: "string", description: "可选, 缺省取最新日期目录" },
      provider: { type: "string", description: "可选, 缺省取最新 provider 目录" },
      summary_lines: { type: "integer", description: "summary.md 取前 N 行, 缺省 40" },
    }, required: ["registry_id"], additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 1) }] },
    async execute(args) {
      try {
        const root = path.join(HOME, "results", args.registry_id);
        if (!existsSync(root)) return fail(`无结果目录: ${root}`);
        const date = args.date ?? readdirSync(root).filter((d) => statSync(path.join(root, d)).isDirectory()).sort().pop();
        if (!date) return fail("无日期目录");
        const pRoot = path.join(root, date);
        const provider = args.provider ?? readdirSync(pRoot).filter((d) => statSync(path.join(pRoot, d)).isDirectory()).sort().pop();
        const runDir = path.join(pRoot, provider ?? "");
        if (!existsSync(runDir)) return fail(`无运行目录: ${runDir}`);
        const out = { ok: true, registry_id: args.registry_id, date, provider, stats: aggregate(runDir) };
        const sm = path.join(runDir, "summary.md");
        if (existsSync(sm)) out.summary_head = head(readFileSync(sm, "utf8"), args.summary_lines ?? 40);
        return out;
      } catch (e) { return fail(String(e.message ?? e)); }
    },
  });

  T.register({
    name: "comac_report",
    description: "读仓库报告文档: 九维度基线 / batch 总结 / 里程碑 M1-M4 / benchmark 调研。" +
      "不传 name 列出可读报告; 传 name 模糊匹配返回正文。",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "可选: 文件名片段(如 nine-dim / batch2 / M3)" },
      lines: { type: "integer", description: "正文前 N 行, 缺省 120(全文档通常 <200 行)" },
    }, additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 1) }] },
    async execute(args) {
      try {
        repoMustExist();
        const dirs = ["results", "report"];
        const docs = [];
        for (const d of dirs) {
          const p = path.join(HOME, d);
          if (existsSync(p)) for (const f of readdirSync(p)) if (f.endsWith(".md")) docs.push(`${d}/${f}`);
        }
        if (!args.name) return { ok: true, docs: docs.sort() };
        const hit = docs.filter((d) => d.includes(args.name));
        if (!hit.length) return fail(`无匹配: ${args.name}（可读: ${docs.slice(0, 12).join(", ")}…）`);
        if (hit.length > 1) return { ok: true, ambiguous: hit };
        return { ok: true, doc: hit[0], content: head(readFileSync(path.join(HOME, hit[0]), "utf8"), args.lines ?? 120) };
      } catch (e) { return fail(String(e.message ?? e)); }
    },
  });
}

// ---------- 杂项 ----------

function tail(file, lines = 15) {
  const rows = readFileSync(file, "utf8").split("\n").filter((l) => l.length);
  return rows.slice(-lines).join("\n");
}

function pgrepAlive(pattern) {
  if (!pattern || pattern.trim().length < 3) return false;
  const r = spawnSync("pgrep", ["-f", `runners\\..*${pattern.replace(/\s+/g, " ")}`], { encoding: "utf8", timeout: 8000 });
  return r.status === 0;
}
