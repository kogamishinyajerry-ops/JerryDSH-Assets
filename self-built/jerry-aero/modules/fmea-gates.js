/**
 * jerry-aero/modules/fmea-gates — FMEA/FTA 受控文档库两道门工具封装。
 *
 * 来源：dsh-comac-suite（2026-10 整编时拆出保留；套件中的六张教学工序卡
 * 已随原件归档至 ~/.dsh/plugins.archive/dsh-comac-suite/）。
 *
 * 把 COMAC_FMEA_FTA_Manager_8024 的确定性内核包成带门禁的工具：
 *   fmea_stats / fmea_change_confirm / fmea_notify_dispatch。
 * 治理不变量：notify_dispatch 必须显式传 confirm:true 才执行（fail-closed 人审门禁），
 * 插件只代理 CLI，不放宽任何门。
 *
 * 环境覆盖：FMEA_HOME / FMEA_PYTHON。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

export const name = "fmea-gates";
export const inject = ["tools"];

const FMEA_HOME = process.env.FMEA_HOME ?? "/Users/Zhuanz/projects/aircraft-comac/COMAC_FMEA_FTA_Manager_8024";
const FMEA_PY = process.env.FMEA_PYTHON ?? path.join(FMEA_HOME, ".venv/bin/python");

function fmeaCli(args) {
  const r = spawnSync(FMEA_PY, ["-m", "app.cli", ...args], { encoding: "utf8", cwd: FMEA_HOME });
  const out = (r.stdout || "").trim();
  const err = (r.stderr || "").trim();
  return { ok: r.status === 0, out: out || err || "(无输出)" };
}

function registerTools(ctx, log) {
  ctx.tools.register({
    name: "fmea_stats",
    description: "查看 FMEA/FTA 受控文档库的统计概览（文档数、变更单、通知与回执状态）。",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 2) }] },
    async execute() {
      const r = fmeaCli(["stats"]);
      return { ok: r.ok, output: r.out };
    },
  });

  ctx.tools.register({
    name: "fmea_change_confirm",
    description:
      "第一道门：确认一条文档变更（change-confirm）。只登记确认动作与确认人，不发送任何通知、不修改文档内容。",
    parameters: {
      type: "object",
      properties: {
        change_id: { type: "string", description: "变更单 ID（可先用 fmea_stats 查 change-list 获取）" },
        by: { type: "string", description: "确认人邮箱（人工确认的凭证）" },
      },
      required: ["change_id", "by"],
      additionalProperties: false,
    },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 2) }] },
    async execute(a) {
      const r = fmeaCli(["change-confirm", "--id", String(a.change_id), "--by", String(a.by)]);
      return { ok: r.ok, gate: 1, action: "confirm-only", output: r.out };
    },
  });

  ctx.tools.register({
    name: "fmea_notify_dispatch",
    description:
      "第二道门：按已确认的变更发送影响面通知并登记回执跟踪（notify-dispatch）。fail-closed：必须显式传 confirm:true 才执行；该动作应由人在审阅影响面与通知名单后作出。",
    parameters: {
      type: "object",
      properties: {
        change_id: { type: "string", description: "已通过第一道门的变更单 ID" },
        confirm: { type: "boolean", description: "必须显式为 true 才会真正发送（人工批准凭证）" },
      },
      required: ["change_id", "confirm"],
      additionalProperties: false,
    },
    output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: JSON.stringify(v, null, 2) }] },
    async execute(a) {
      if (a.confirm !== true) {
        return {
          ok: false,
          gate: 2,
          refused: true,
          reason: "fail-closed：通知发送是第二道人工门。请先展示影响面与通知名单，由人确认后再以 confirm:true 重试。",
        };
      }
      const r = fmeaCli(["notify-dispatch", "--change-id", String(a.change_id)]);
      return { ok: r.ok, gate: 2, action: "dispatch", output: r.out };
    },
  });

  log("tools=fmea_stats, fmea_change_confirm, fmea_notify_dispatch");
}

export function apply(ctx) {
  const log = (...a) => ctx.logger.info(`[jerry-aero/fmea-gates] ${a.join(" ")}`);
  registerTools(ctx, log);
}
