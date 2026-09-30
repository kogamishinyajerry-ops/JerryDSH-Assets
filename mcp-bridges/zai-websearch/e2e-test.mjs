// e2e 驱动：spawn bridge.mjs，走一遍 initialize → initialized → tools/list → tools/call
import { spawn } from "node:child_process";

const proc = spawn("node", ["bridge.mjs"], { cwd: new URL(".", import.meta.url) });
const send = (o) => proc.stdin.write(JSON.stringify(o) + "\n");
let buf = "";
const waiters = [];
proc.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const k = waiters.findIndex((w) => w.id === msg.id);
    if (k >= 0) { const [w] = waiters.splice(k, 1); w.resolve(msg); }
  }
});
proc.stderr.on("data", (d) => process.stderr.write("[bridge] " + d));
const reply = (id) => new Promise((resolve, reject) => {
  waiters.push({ id, resolve });
  setTimeout(() => reject(new Error("timeout id=" + id)), 100000);
});

// 1) initialize
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } });
const init = await reply(1);
console.log("initialize ok:", init.result.serverInfo, "tools cap:", !!init.result.capabilities.tools);
// 2) initialized
send({ jsonrpc: "2.0", method: "notifications/initialized" });
// 3) tools/list
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const list = await reply(2);
console.log("tools:", list.result.tools.map((t) => t.name).join(", "));
// 4) real call
send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "web_search", arguments: { query: "GLM-5 发布", recency: "oneMonth", count: 5 } } });
const call = await reply(3);
const text = call.result?.content?.[0]?.text || "";
console.log("call isError:", !!call.result?.isError);
console.log("answer head:", text.slice(0, 500).replace(/\n+/g, " | "));
proc.kill();
process.exit(0);
