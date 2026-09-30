import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { delegateStage, resolveConfig, validateRequest, STAGES, STAGE_OUTPUT_SCHEMA, MCP_TOOLS, allowedToolNames } from "../../self-built/dsh-sim-orchestrator/delegation.js";
import { validateJsonSchemaValue, assertObjectJsonSchema } from "./runtime.mjs";

const config = resolveConfig();
const exec = () => ({ agent: { id: "test-parent" }, signal: new AbortController().signal });
const report = overrides => ({
  status: "reported", summary: "Deterministic delegation fixture; no solver or LLM ran.",
  resources: {}, observations: [], open_questions: [], evidence_refs: [], ...overrides,
});
function providerHarness(options = {}) {
  const calls = [];
  let disposals = 0;
  return {
    calls,
    get disposals() { return disposals; },
    getProvider: () => options.provider === null ? undefined : {
      capabilities: { outputSchema: true, toolFilter: true, persona: true, depthLimit: true, ...options.capabilities },
    },
    async start(name, request) {
      calls.push({ name, request });
      if (options.startError) throw options.startError;
      return {
        id: "test-child",
        result: options.resultFactory ? options.resultFactory(request) : Promise.resolve(options.result ?? { stopReason: "completed", structured: report(), output: [] }),
        dispose: async () => { disposals++; if (options.disposeError) throw options.disposeError; },
      };
    },
  };
}

test("DSH 0.2 RC accepts the structured output schema", () => {
  assert.doesNotThrow(() => assertObjectJsonSchema(STAGE_OUTPUT_SCHEMA));
  assert.deepEqual(validateJsonSchemaValue(STAGE_OUTPUT_SCHEMA, report()), []);
});

test("four roles use only their frozen engineering MCP tool subsets", async () => {
  for (const [stage, definition] of Object.entries(STAGES)) {
    const harness = providerHarness();
    const input = { stage, request: "Read the real service response before summarizing" };
    if (stage === "execute") Object.assign(input, { task_id: "task-fixture", authorization_id: "auth-fixture", prepared_digest: "digest-fixture" });
    if (stage === "review") input.bundle_id = "bundle-fixture";
    const caller = exec();
    const result = await delegateStage(harness, input, caller, config, validateJsonSchemaValue);
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.disposals, 1);
    const call = harness.calls[0];
    assert.equal(call.name, "spawn");
    assert.equal(call.request.parent, caller.agent);
    assert.equal(call.request.label, `sim:${definition.role}`);
    assert.equal(call.request.outputSchema, STAGE_OUTPUT_SCHEMA);
    assert.deepEqual(call.request.toolFilter.allow, definition.tools.map(tool => `mcp__dsh_sim__${tool}`));
    assert.ok(definition.tools.every(tool => MCP_TOOLS.includes(tool)));
    assert.equal(result.delegation_status, "completed");
    assert.equal(result.report.status, "reported");
    assert.match(result.engineering_source, /child-authored summary/);
  }
});

test("execution without every existing authorization reference is blocked before a child starts", async () => {
  for (const missing of ["task_id", "authorization_id", "prepared_digest"]) {
    const harness = providerHarness();
    const input = { stage: "execute", request: "Run", task_id: "task-fixture", authorization_id: "auth-fixture", prepared_digest: "digest-fixture" };
    delete input[missing];
    await assert.rejects(delegateStage(harness, input, exec(), config, validateJsonSchemaValue), new RegExp(missing));
    assert.equal(harness.calls.length, 0);
  }
});

test("wrapper configuration and arguments cannot add raw tools or identity headers", () => {
  assert.throws(() => resolveConfig({ toolNames: ["bash"] }), /Unknown/);
  assert.throws(() => resolveConfig({ headers: { "X-Dev-Roles": "EXECUTOR" } }), /Unknown/);
  assert.throws(() => resolveConfig({ serverName: "../exec" }), /serverName/);
  assert.throws(() => resolveConfig({ maxDepth: 0 }), /maxDepth/);
  assert.throws(() => validateRequest({ stage: "plan", request: "x", authorization_id: "auth-fixture" }, config), /only by the execute/);
  assert.throws(() => validateRequest({ stage: "plan", request: "x", headers: {} }, config), /Unknown/);
  assert.throws(() => validateRequest({ stage: "review", request: "x" }, config), /connected database/);
  assert.throws(() => validateRequest({ stage: "plan", request: "汉".repeat(1000) }, resolveConfig({ maxInputBytes: 1024 })), /maxInputBytes/);
});

test("missing provider or capability fails without falling back to weaker delegation", async () => {
  for (const options of [{ provider: null }, { capabilities: { toolFilter: false } }, { capabilities: { outputSchema: false } }]) {
    const harness = providerHarness(options);
    await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, exec(), config, validateJsonSchemaValue), /unavailable|lacks/);
    assert.equal(harness.calls.length, 0);
  }
});

test("abnormal child endings preserve failure and dispose published work", async () => {
  for (const stopReason of ["error", "aborted", "max-tokens", "refusal", "unknown-provider-state"]) {
    const harness = providerHarness({ result: { stopReason, structured: report(), output: [], diagnostic: "test diagnostic" } });
    await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, exec(), config, validateJsonSchemaValue), new RegExp(stopReason));
    assert.equal(harness.disposals, 1);
  }
});

test("missing or invalid structured output never becomes successful completion", async () => {
  for (const structured of [undefined, { status: "PASS" }, report({ unauthorized_field: true })]) {
    const harness = providerHarness({ result: { stopReason: "completed", structured, output: [] } });
    await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, exec(), config, validateJsonSchemaValue), /Invalid simulation child output/);
    assert.equal(harness.disposals, 1);
  }
});

test("a child cannot silently replace the requested task reference", async () => {
  const harness = providerHarness({ result: { stopReason: "completed", structured: report({ resources: { task_id: "different-task" } }), output: [] } });
  await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan", task_id: "requested-task" }, exec(), config, validateJsonSchemaValue), /different task_id/);
  assert.equal(harness.disposals, 1);
});

test("independent execution and cleanup failures are both retained", async () => {
  const executionError = new Error("test infrastructure failure");
  const disposalError = new Error("test cleanup failure");
  const harness = providerHarness({ resultFactory: () => Promise.reject(executionError), disposeError: disposalError });
  await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, exec(), config, validateJsonSchemaValue), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [executionError, disposalError]);
    return true;
  });
  assert.equal(harness.disposals, 1);
});

test("startup failure owns no published child and never manufactures a report", async () => {
  const harness = providerHarness({ startError: new Error("startup rejected") });
  await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, exec(), config, validateJsonSchemaValue), /startup rejected/);
  assert.equal(harness.disposals, 0);
});

test("cancellation reaches a running child and waits for disposal", async () => {
  const controller = new AbortController();
  const harness = providerHarness({ resultFactory: ({ signal }) => new Promise(resolve => signal.addEventListener("abort", () => resolve({ stopReason: "aborted", output: [] }), { once: true })) });
  const pending = delegateStage(harness, { stage: "plan", request: "Plan" }, { agent: {}, signal: controller.signal }, config, validateJsonSchemaValue);
  controller.abort(new Error("user cancelled test"));
  await assert.rejects(pending, /user cancelled test/);
  assert.equal(harness.disposals, 1);
  assert.equal(harness.calls[0].request.signal.aborted, true);
});

test("an already cancelled caller does not start a child", async () => {
  const harness = providerHarness();
  await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, { agent: {}, signal: AbortSignal.abort(new Error("already cancelled")) }, config, validateJsonSchemaValue), /already cancelled/);
  assert.equal(harness.calls.length, 0);
});

test("the configured stage deadline cancels cooperative child work", async () => {
  const harness = providerHarness({ resultFactory: async ({ signal }) => {
    try { await delay(5000, undefined, { signal }); } catch (error) { if (error.name !== "AbortError") throw error; }
    return { stopReason: "aborted", output: [] };
  } });
  await assert.rejects(delegateStage(harness, { stage: "plan", request: "Plan" }, exec(), resolveConfig({ stageTimeoutMs: 1000 }), validateJsonSchemaValue), /stageTimeoutMs/);
  assert.equal(harness.disposals, 1);
});

test("server namespace changes retain the exact twelve raw tool names", () => {
  assert.deepEqual(allowedToolNames("plan", "separate_api"), ["mcp__separate_api__list_capabilities", "mcp__separate_api__get_task"]);
  assert.equal(new Set(MCP_TOOLS).size, 12);
});
