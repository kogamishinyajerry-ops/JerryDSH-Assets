/** Optional wire smoke: real DSH MCP client + dsh-sim Python server, no LLM/API/solver. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { MCP_TOOLS } from "../../self-built/dsh-sim-orchestrator/delegation.js";

const [runtimeDir, python] = process.argv.slice(2);
if (!runtimeDir || !python) throw new Error("Usage: node tests/orchestration/mcp-smoke.mjs <pinned-dsh-install-dir> <isolated-sim-python>");
const require = createRequire(join(resolve(runtimeDir), "package.json"));
const load = specifier => import(require.resolve(specifier));
const { Context } = await load("@deepseek-ai/cordis");
const { default: SystemPrompt } = await load("@deepseek-ai/dsh-system-prompt");
const { default: ToolRuntime } = await load("@deepseek-ai/dsh-tools");
const McpClient = await load("@deepseek-ai/dsh-mcp-client");
assert.equal(require("@deepseek-ai/dsh/package.json").version, "0.2.0-rc.2");

const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(McpClient, {
    serverName: "dsh_sim", transport: "stdio", command: resolve(python),
    args: ["-m", "dsh_sim.mcp.server"],
    env: {
      DSH_SIM_API_URL: "http://127.0.0.1:9/api/v1", DSH_SIM_AGENT_PROJECTS: "proj_a",
      FASTMCP_CHECK_FOR_UPDATES: "off", FASTMCP_SHOW_SERVER_BANNER: "false",
    },
    toolCallTimeoutMs: 10000, failOnStartupError: true,
    reconnect: { enabled: false },
  });
  const names = ctx.tools.schemas().map(tool => tool.name).sort();
  assert.deepEqual(names, MCP_TOOLS.map(tool => `mcp__dsh_sim__${tool}`).sort());
  const result = await ctx.tools.execute({
    name: "mcp__dsh_sim__get_task", callId: "mcp-smoke-unavailable",
    arguments: { task_id: "nonexistent-smoke-task" }, signal: AbortSignal.timeout(15000),
  });
  assert.equal(result.isError, false, "MCP bridge returns the API's structured error model as data");
  const value = result.value;
  const body = value.structuredContent ?? JSON.parse(value.content.find(block => block.type === "text").text);
  assert.equal(body.code, "UNAVAILABLE");
  assert.equal(body.details.source, "mcp-bridge");
  console.log(JSON.stringify({
    schema_version: "dsh-sim-mcp-smoke/v1", dsh_version: "0.2.0-rc.2",
    discovered_tools: names, unreachable_api: body.code,
    llm_calls: 0, solver_runs: 0,
  }, null, 2));
} finally {
  await ctx.fiber.dispose();
}
