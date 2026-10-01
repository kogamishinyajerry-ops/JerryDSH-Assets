/** Load the exact DSH peer installation resolved by the local plugin. No network or LLM. */
import { createRequire } from "node:module";

const require = createRequire(new URL("../../self-built/dsh-sim-orchestrator/package.json", import.meta.url));
export const hostImport = specifier => import(require.resolve(specifier));
export const { Context } = await hostImport("@deepseek-ai/cordis");
export const { default: SystemPrompt } = await hostImport("@deepseek-ai/dsh-system-prompt");
export const { default: ToolRuntime, validateJsonSchemaValue, assertObjectJsonSchema } = await hostImport("@deepseek-ai/dsh-tools");
export const { default: SubagentRuntime } = await hostImport("@deepseek-ai/dsh-subagent");
export const { createScope } = await hostImport("@deepseek-ai/dsh-scope");

export async function makeHost() {
  const ctx = new Context();
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  return ctx;
}

export async function scoped(ctx, id, parent) {
  const key = { id };
  let scope;
  await ctx.plugin(Object.assign(inner => {
    scope = createScope(inner, key, parent ? { parent } : undefined);
  }, { inject: ["tools", "systemPrompt"] }));
  return { key, scope };
}

export function dummyTool(name) {
  return {
    name, description: "Deterministic test fixture; does not call engineering software",
    parameters: { type: "object", properties: {} },
    output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    execute: async () => `fixture:${name}`,
  };
}
