import test from "node:test";
import assert from "node:assert/strict";
import { makeHost, scoped, dummyTool, SubagentRuntime } from "./runtime.mjs";
import { STAGES, MCP_TOOLS, allowedToolNames } from "../../self-built/dsh-sim-orchestrator/delegation.js";
import * as plugin from "../../self-built/dsh-sim-orchestrator/index.js";

test("the native Cordis registry mounts and unmounts the 0.2 RC plugin without settings or an LLM", async () => {
  const ctx = await makeHost();
  try {
    await ctx.plugin(SubagentRuntime, { maxDepth: 1, maxActiveSubagents: 8 });
    const fiber = ctx.plugin(plugin, {});
    await fiber;
    const definition = ctx.tools.get("sim_orchestrate");
    assert.ok(definition);
    assert.equal(definition.timeoutMs, 180000);
    assert.equal(definition.isConcurrencySafe(), false);
    const result = await ctx.tools.execute({ name: "sim_orchestrate", callId: "test-call", arguments: { stage: "plan", request: "Plan" }, signal: new AbortController().signal });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /requires a calling DSH Agent/);
    await fiber.dispose();
    assert.equal(ctx.tools.get("sim_orchestrate"), undefined);
  } finally { await ctx.fiber.dispose(); }
});

test("native child scope restrictions hide and reject shell, approval and recursive orchestration", async () => {
  const ctx = await makeHost();
  try {
    const preset = await scoped(ctx, "test-simulation-preset");
    for (const tool of MCP_TOOLS) preset.scope.ctx.tools.register(dummyTool(`mcp__dsh_sim__${tool}`));
    const unwanted = ["bash", "run_any_code", "approve", "sim_orchestrate", "mcp__foreign__http_request"];
    for (const tool of unwanted) preset.scope.ctx.tools.register(dummyTool(tool));
    for (const stage of Object.keys(STAGES)) {
      const child = await scoped(ctx, `test-${stage}`, preset.key);
      child.scope.ctx.tools.restrict({ allow: allowedToolNames(stage, "dsh_sim") });
      child.scope.ctx.tools.register(dummyTool("structured_report_fixture"));
      assert.deepEqual(ctx.tools.schemas(child.key).map(tool => tool.name).sort(), [...allowedToolNames(stage, "dsh_sim"), "structured_report_fixture"].sort());
      for (const tool of unwanted) {
        const result = await ctx.tools.execute({ name: tool, callId: `test-${stage}-${tool}`, arguments: {}, agent: child.key, signal: new AbortController().signal });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /unknown tool/);
      }
      const allowed = allowedToolNames(stage, "dsh_sim")[0];
      const result = await ctx.tools.execute({ name: allowed, callId: `test-${stage}-allowed`, arguments: {}, agent: child.key, signal: new AbortController().signal });
      assert.equal(result.isError, false);
      assert.equal(result.value, `fixture:${allowed}`);
    }
    assert.ok(ctx.tools.schemas(preset.key).some(tool => tool.name === "bash"), "child restrictions do not mutate the parent preset");
  } finally { await ctx.fiber.dispose(); }
});
