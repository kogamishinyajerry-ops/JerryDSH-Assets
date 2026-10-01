import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BASELINE, REPO_ROOT, assertNodeVersion, assertPrivacy, checkTarget, installationPlan, main, npmEnvironment, prepare, subsetLock } from "../../tools/recovery/recover.mjs";
import { patchDoctorPackage, sha256, verifiedReplacement } from "../../tools/recovery/doctor-patch.mjs";

function sandbox(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "jerrydsh-recovery-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function doctorFixture(t, { version = "0.3.24", sourceSuffix = "" } = {}) {
  const root = sandbox(t);
  const packageDir = path.join(root, "doctor");
  mkdirSync(path.join(packageDir, "lib"), { recursive: true });
  const source = `// fixture\n${BASELINE.doctor.before}\n// footer\n`;
  const after = source.replace(BASELINE.doctor.before, BASELINE.doctor.after);
  const spec = { ...BASELINE.doctor, beforeSha256: sha256(source), afterSha256: sha256(after) };
  writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ name: spec.package, version }));
  const file = path.join(packageDir, "lib/client.js");
  writeFileSync(file, source + sourceSuffix);
  return { packageDir, spec, file, source, after };
}

test("prepare handles a different owner, spaces and YAML punctuation without touching the source", (t) => {
  const root = sandbox(t);
  const target = path.join(root, "New Owner's #1: machine", "isolated DSH");
  const projectsRoot = path.join(root, "External Projects #2");
  const sourcePatch = readFileSync(path.join(REPO_ROOT, "profile-configs/web/cordis.patch.yml"), "utf8");
  const report = prepare({ target, projectsRoot });
  assert.equal(report.ok, true);
  assert.equal(report.runtimeInstalled, false);
  const patch = readFileSync(path.join(target, "dsh-home/profiles/web/cordis.patch.yml"), "utf8");
  const pluginLine = patch.split("\n").find((line) => line.includes("name:") && line.includes("plugins/jerry-aero/index.js"));
  assert.equal(JSON.parse(pluginLine.split("name: ")[1]), path.join(target, "dsh-home/plugins/jerry-aero/index.js"));
  const bridgeLine = patch.split("\n").find((line) => line.includes("zai-websearch/bridge.mjs") && line.trimStart().startsWith("- "));
  assert.equal(JSON.parse(bridgeLine.trim().slice(2)), path.join(target, "dsh-home/mcp/zai-websearch/bridge.mjs"));
  assert.ok(existsSync(path.join(target, "dsh-home/mcp/zai-websearch/bridge.mjs")));
  assert.equal(patch.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n").includes(BASELINE.snapshotHome), false);
  assert.ok(patch.includes("provider: zai-coding-cn"), "user provider selection is preserved");
  assert.equal(readFileSync(path.join(REPO_ROOT, "profile-configs/web/cordis.patch.yml"), "utf8"), sourcePatch);
  const env = JSON.parse(readFileSync(path.join(target, "environment.json"), "utf8"));
  assert.equal(env.DSH_HOME, path.join(target, "dsh-home"));
  assert.equal(env.CIVAIR_KB_HOME, path.join(projectsRoot, "aircraft-comac/civair-kb"));
  assert.equal("HOME" in env, false);
  assert.deepEqual(Object.keys(env).filter((key) => /API_KEY|TOKEN|SECRET/.test(key)), []);
  assert.equal(existsSync(path.join(target, "dsh-home/.credentials.yaml")), false);
  assert.deepEqual(readFileSync(path.join(target, "dsh-home/profiles/web/package-lock.json")), readFileSync(path.join(REPO_ROOT, "profile-configs/web/package-lock.json")));
  for (const profile of BASELINE.profiles) {
    assertPrivacy(readFileSync(path.join(target, "dsh-home/profiles", profile, "cordis.patch.yml"), "utf8"), profile);
  }
  assert.ok(report.gitDependencies.some((entry) => entry.resolved.endsWith("#f8af4295ca4a03f8e94de9f9a42cb10d59460190")));
  assert.deepEqual(checkTarget(target).privacy, report.privacy);
});

test("a second prepare refuses to merge, overwrite or clean an existing target", (t) => {
  const target = path.join(sandbox(t), "existing");
  mkdirSync(target);
  writeFileSync(path.join(target, "keep.txt"), "user content");
  assert.throws(() => prepare({ target }), /already exists/);
  assert.deepEqual(readdirSync(target), ["keep.txt"]);
  assert.equal(readFileSync(path.join(target, "keep.txt"), "utf8"), "user content");
});

test("repeating prepare on its own output fails without changing the prior manifest", (t) => {
  const target = path.join(sandbox(t), "prepared");
  prepare({ target });
  const before = readFileSync(path.join(target, "recovery.json"));
  assert.throws(() => prepare({ target }), /already exists/);
  assert.deepEqual(readFileSync(path.join(target, "recovery.json")), before);
  assert.equal(checkTarget(target).ok, true);
});

test("symlink targets and the active DSH home are refused", (t) => {
  const root = sandbox(t);
  const actual = path.join(root, "actual");
  mkdirSync(actual);
  symlinkSync(actual, path.join(root, "alias"), "dir");
  assert.throws(() => prepare({ target: path.join(root, "alias", "child") }), /Symlink/);
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "tools/recovery/recover.mjs"), "prepare", "--target", path.join(actual, "new")], {
    env: { ...process.env, DSH_HOME: actual }, encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /existing DSH home/);
  assert.deepEqual(readdirSync(actual), []);
});

test("privacy checks reject false, quoted true, missing and repeated disables", () => {
  const good = "- id: session-log-deepseek\n  disabled: true\n- id: session-telemetry-otel\n  disabled: true\n";
  assert.doesNotThrow(() => assertPrivacy(good, "fixture"));
  for (const bad of [
    good.replace("disabled: true", "disabled: false"),
    good.replace("disabled: true", 'disabled: "true"'),
    good.replace("disabled: true", "disabled: true\n  disabled: false"),
    good.replace("- id: session-log-deepseek\n  disabled: true\n", ""),
    good + "- id: session-log-deepseek\n  disabled: false\n",
    good + "- insert:\n    - id: session-log-deepseek\n      disabled: false\n",
  ]) assert.throws(() => assertPrivacy(bad, "fixture"), /privacy disable/);
});

test("preflight enforces the declared Node engine range", () => {
  for (const version of ["22.19.0", "22.21.1", "24.0.0", "24.19.0"]) assert.doesNotThrow(() => assertNodeVersion(version));
  for (const version of ["20.19.0", "22.18.9", "23.0.0", "garbage"]) assert.throws(() => assertNodeVersion(version), /requires Node/);
});

test("installer retains configured CA trust without forwarding model keys or the SSH agent", () => {
  const env = npmEnvironment("/tmp/isolated-fixture");
  for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "CURL_CA_BUNDLE"]) {
    assert.equal(env[name], process.env[name]);
  }
  assert.equal(Object.hasOwn(env, "SSH_AUTH_SOCK"), false);
  assert.deepEqual(Object.keys(env).filter((name) => /API_KEY|TOKEN|SECRET/.test(name)), []);
  assert.equal(Object.hasOwn(env, "HOME"), false);
  assert.equal(env.GIT_CONFIG_VALUE_0, "ssh://git@github.com/");
});

test("preflight detects changed prepared files, and install has an explicit component and no scripts by default", (t) => {
  const target = path.join(sandbox(t), "new");
  prepare({ target });
  const plan = installationPlan(target, "web");
  assert.equal(plan.cwd, path.join(target, "dsh-home/profiles/web"));
  assert.equal(plan.shell, false);
  assert.deepEqual(plan.args, ["ci", "--legacy-peer-deps", "--no-audit", "--no-fund", "--ignore-scripts"]);
  assert.ok(installationPlan(target, "runtime").args.includes("--legacy-peer-deps=false"));
  assert.throws(() => main(["install", "--target", target]), /explicit --component/);
  assert.throws(() => main(["prepare", "--target", path.join(target, "unused"), "--allow-scripts"]), /cannot install/);
  const original = readFileSync(path.join(target, "runtime/package.json"), "utf8");
  writeFileSync(path.join(target, "runtime/package.json"), original.replace("0.2.0-rc.2", "latest"));
  assert.throws(() => checkTarget(target), /changed or missing/);
  assert.throws(() => installationPlan(target, "runtime"), /changed or missing/);
});

test("fr-guard lock keeps its resolved transitive closure and fails on a missing dependency", () => {
  const full = { packages: {
    "": {},
    "node_modules/guard": { version: "1.0.0", dependencies: { shared: "^2.0.0" } },
    "node_modules/shared": { version: "2.4.0", dependencies: { leaf: "1.0.0" } },
    "node_modules/leaf": { version: "1.0.0" },
    "node_modules/unrelated": { version: "9.0.0" },
  } };
  const minimal = subsetLock(full, { name: "fixture", dependencies: { guard: "^1.0.0" } });
  assert.deepEqual(Object.keys(minimal.packages).sort(), ["", "node_modules/guard", "node_modules/leaf", "node_modules/shared"]);
  delete full.packages["node_modules/leaf"];
  assert.throws(() => subsetLock(full, { name: "fixture", dependencies: { guard: "^1.0.0" } }), /Missing locked transitive/);
});

test("doctor patch is exact, records an original backup, and is idempotent", (t) => {
  const { packageDir, file, source, after, spec } = doctorFixture(t);
  assert.equal(patchDoctorPackage(packageDir, spec).status, "patched");
  assert.equal(readFileSync(file, "utf8"), after);
  assert.equal(readFileSync(`${file}.jerrydsh-${spec.version}.orig`, "utf8"), source);
  assert.equal(patchDoctorPackage(packageDir, spec).status, "already-patched");
});

test("doctor refuses version drift and changed bytes without writing anything", (t) => {
  const wrongVersion = doctorFixture(t, { version: "0.3.25" });
  assert.throws(() => patchDoctorPackage(wrongVersion.packageDir, wrongVersion.spec), /only supports/);
  const drift = doctorFixture(t, { sourceSuffix: "// another user's change\n" });
  const before = readFileSync(drift.file);
  assert.throws(() => patchDoctorPackage(drift.packageDir, drift.spec), /preimage SHA-256 mismatch/);
  assert.deepEqual(readFileSync(drift.file), before);
  assert.deepEqual(readdirSync(path.dirname(drift.file)), ["client.js"]);
});

test("doctor rejects a wrong postimage, duplicate match, missing audit receipt and parent symlinks", (t) => {
  const fixture = doctorFixture(t);
  assert.throws(() => verifiedReplacement(fixture.source, { ...fixture.spec, afterSha256: "0".repeat(64) }), /postimage/);
  const twice = fixture.source + fixture.spec.before;
  assert.throws(() => verifiedReplacement(twice, { ...fixture.spec, beforeSha256: sha256(twice) }), /exactly once/);
  patchDoctorPackage(fixture.packageDir, fixture.spec);
  rmSync(`${fixture.file}.jerrydsh-patch.json`);
  assert.throws(() => patchDoctorPackage(fixture.packageDir, fixture.spec), /receipt missing/);
  const aliased = doctorFixture(t);
  const lib = path.dirname(aliased.file);
  const outside = path.join(path.dirname(aliased.packageDir), "outside");
  mkdirSync(outside);
  writeFileSync(path.join(outside, "client.js"), aliased.source);
  rmSync(lib, { recursive: true });
  symlinkSync(outside, lib, "dir");
  assert.throws(() => patchDoctorPackage(aliased.packageDir, aliased.spec), /Symlink patch paths/);
  assert.equal(readFileSync(path.join(outside, "client.js"), "utf8"), aliased.source);
});
