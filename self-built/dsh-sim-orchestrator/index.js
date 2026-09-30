/** Native DSH 0.2.0-rc.2 tool wrapper; no settings service, HTTP client or solver. */
import z from "@deepseek-ai/schemastery";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import { delegateStage, resolveConfig, STAGE_OUTPUT_SCHEMA } from "./delegation.js";

export const name = "dsh-sim-orchestrator";
export const inject = ["tools", "subagents"];

export const Config = z.object({
  providerName: z.string().default("spawn"),
  serverName: z.string().default("dsh_sim"),
  maxDepth: z.number().step(1).min(1).max(8).default(1),
  stageTimeoutMs: z.number().step(1).min(1000).max(1800000).default(180000),
  maxInputBytes: z.number().step(1).min(1024).max(1048576).default(65536),
});

/** Mount a single effect-owned native tool. Child results are logged by the host registry. */
export function apply(ctx, userConfig = {}) {
  const config = resolveConfig(userConfig);
  ctx.tools.register({
    name: "sim_orchestrate",
    description: "Delegate one simulation stage to a native planner, inputwriter, runner or reviewer. Use plan → prepare → execute → review and pass returned resource ids between calls. Long engineering jobs continue in dsh-sim after this bounded delegation returns. execute requires an existing human authorization_id and its prepared_digest; this tool cannot grant approval. Child-authored summaries must be grounded in the connected engineering API.",
    parameters: {
      type: "object", additionalProperties: false, required: ["stage", "request"],
      properties: {
        stage: { type: "string", enum: ["plan", "prepare", "execute", "review"] },
        request: { type: "string", description: "Self-contained user task and confirmed facts; never fabricate missing inputs." },
        task_id: { type: "string" }, revision: { type: "integer" },
        preparation_id: { type: "string" },
        authorization_id: { type: "string", description: "Existing human authorization for execute only; never mint or infer one." },
        prepared_digest: { type: "string", description: "The exact preparation digest bound to that authorization." },
        run_ids: { type: "array", items: { type: "string" } },
        bundle_id: { type: "string" },
        input: { type: "object", additionalProperties: true, description: "Grounded draft/spec data already following dsh-sim's canonical schemas; the API validates it." },
      },
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        required: ["schema_version", "stage", "role", "child_session_id", "delegation_status", "engineering_source", "report"],
        properties: {
          schema_version: { type: "string", const: "dsh-sim-delegation/v1" },
          stage: { type: "string", enum: ["plan", "prepare", "execute", "review"] },
          role: { type: "string", enum: ["planner", "inputwriter", "runner", "reviewer"] },
          child_session_id: { type: "string" },
          delegation_status: { type: "string", const: "completed" },
          engineering_source: { type: "string" },
          report: STAGE_OUTPUT_SCHEMA,
        },
      },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }],
    },
    // Task mutations are ordered in the parent; dsh-sim separately owns idempotency and concurrency.
    isConcurrencySafe: () => false,
    timeoutMs: config.stageTimeoutMs,
    execute: (args, exec) => delegateStage(ctx.subagents, args, exec, config, validateJsonSchemaValue),
  });
}
