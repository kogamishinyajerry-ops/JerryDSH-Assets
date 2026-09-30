#!/usr/bin/env node
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync,
  realpathSync, writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { patchDoctorPackage, sha256 } from "./doctor-patch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");
export const BASELINE = JSON.parse(readFileSync(path.join(HERE, "baseline.json"), "utf8"));
const COMPONENTS = ["runtime", "web", "headless", "fr-guard", "zai-websearch"];
const MARKER = "recovery.json";
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);

export function assertNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || !(Number(match[1]) >= 24 || (Number(match[1]) === 22 && Number(match[2]) >= 19))) {
    throw new Error(`Recovery requires Node ${BASELINE.node}; found ${version}`);
  }
}

function noSymlinkAncestors(file) {
  let current = path.resolve(file);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlink recovery paths are not accepted: ${current}`);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function ensureDisposableTarget(target) {
  noSymlinkAncestors(target);
  for (const protectedHome of [path.join(os.homedir(), ".dsh"), process.env.DSH_HOME].filter(Boolean)) {
    if (inside(path.resolve(protectedHome), target)) {
      throw new Error("Refusing to prepare or modify the existing DSH home; choose a new isolated target");
    }
  }
}

export function assertPrivacy(patch, profile) {
  for (const id of BASELINE.privacyDisabledIds) {
    const declarations = patch.split(/\r?\n/).filter((line) =>
      new RegExp(`^\\s*-?\\s*id:\\s*${id}\\s*(?:#.*)?$`).test(line));
    const blocks = [...patch.matchAll(/^\- id:\s*([^\s#]+)[^\n]*\n((?:(?!^- )[\s\S])*?)(?=^- |$(?![\s\S]))/gm)];
    const block = blocks.find((match) => match[1] === id);
    const disableFields = block?.[2].split(/\r?\n/).filter((line) => /^  disabled:/.test(line)) ?? [];
    if (declarations.length !== 1 || disableFields.length !== 1 || !/^  disabled:\s*true\s*(?:#.*)?$/.test(disableFields[0])) {
      throw new Error(`${profile}: required privacy disable is missing, duplicated or not true: ${id}`);
    }
  }
}

/** Rewrite known snapshot path scalars; JSON quoting is valid YAML double quoting. */
export function rewritePatch(patch, dshHome, projectsRoot) {
  const dshPrefix = `${BASELINE.snapshotHome}/.dsh/`;
  const projectPrefix = `${BASELINE.snapshotHome}/projects/`;
  return patch.split("\n").map((line) => {
    const match = line.match(/^(\s*(?:-\s+|[A-Za-z_][\w-]*:\s+))(\/Users\/[^\n]+?)\s*$/);
    if (!match) return line;
    const original = match[2];
    let replacement;
    if (original.startsWith(dshPrefix)) {
      const relative = original.slice(dshPrefix.length).replace(/^mcp\/zai-mcp\//, "mcp/zai-websearch/");
      replacement = path.join(dshHome, relative);
    } else if (original.startsWith(projectPrefix)) {
      replacement = path.join(projectsRoot, original.slice(projectPrefix.length));
    } else {
      throw new Error(`Unmapped machine-specific path in patch: ${original}`);
    }
    return match[1] + JSON.stringify(replacement);
  }).join("\n");
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

function copyTree(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || /credentials|\.(?:pem|key)$/i.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error(`Source symlink is not copied: ${path.join(source, entry.name)}`);
    if (entry.isDirectory()) copyTree(path.join(source, entry.name), path.join(target, entry.name));
    else if (entry.isFile()) copyFileSync(path.join(source, entry.name), path.join(target, entry.name));
  }
}

function listFiles(root, prefix = "") {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${relative}`);
    if (entry.isDirectory()) return listFiles(root, relative);
    return entry.isFile() ? [relative] : [];
  }).sort();
}

/** Copy the already resolved dependency locations; never resolve semver online. */
export function subsetLock(fullLock, manifest) {
  const packages = { "": { name: manifest.name, dependencies: manifest.dependencies ?? {} } };
  const pending = Object.keys(manifest.dependencies ?? {}).map((name) => `node_modules/${name}`);
  const dependencyLocation = (from, name) => {
    let current = from;
    for (;;) {
      const candidate = current ? `${current}/node_modules/${name}` : `node_modules/${name}`;
      if (fullLock.packages[candidate]) return candidate;
      const cut = current.lastIndexOf("/node_modules/");
      current = cut < 0 ? "" : current.slice(0, cut);
      if (!current) {
        const root = `node_modules/${name}`;
        return fullLock.packages[root] ? root : null;
      }
    }
  };
  while (pending.length) {
    const location = pending.pop();
    if (packages[location]) continue;
    const entry = fullLock.packages[location];
    if (!entry || entry.link) throw new Error(`Dependency is not frozen in web lockfile: ${location}`);
    packages[location] = entry;
    for (const name of Object.keys(entry.dependencies ?? {})) {
      const resolved = dependencyLocation(location, name);
      if (!resolved) throw new Error(`Missing locked transitive dependency: ${location} -> ${name}`);
      pending.push(resolved);
    }
    for (const name of Object.keys(entry.optionalDependencies ?? {})) {
      const resolved = dependencyLocation(location, name);
      if (resolved) pending.push(resolved);
    }
  }
  return { name: manifest.name, lockfileVersion: 3, requires: true, packages };
}

function componentDirectory(target, component) {
  if (!COMPONENTS.includes(component)) throw new Error(`component must be one of: ${COMPONENTS.join(", ")}`);
  if (component === "runtime") return path.join(target, "runtime");
  if (component === "zai-websearch") return path.join(target, "dsh-home/mcp/zai-websearch");
  return path.join(target, "dsh-home/profiles", component);
}

function validateLock(directory, component) {
  const manifest = readJson(path.join(directory, "package.json"));
  const lock = readJson(path.join(directory, "package-lock.json"));
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""]) throw new Error(`${component}: expected npm lockfileVersion 3`);
  if (JSON.stringify(manifest.dependencies ?? {}) !== JSON.stringify(lock.packages[""].dependencies ?? {})) {
    throw new Error(`${component}: package manifest and lockfile root dependencies disagree`);
  }
  if (component === "runtime" && (manifest.dependencies?.["@deepseek-ai/dsh"] !== BASELINE.dshVersion ||
      lock.packages["node_modules/@deepseek-ai/dsh"]?.version !== BASELINE.dshVersion)) {
    throw new Error("Runtime must stay pinned to @deepseek-ai/dsh@" + BASELINE.dshVersion);
  }
  if (component === "runtime" && !lock.packages["node_modules/@deepseek-ai/cordis-plugin-group"]) {
    throw new Error("Runtime lock is missing required peer @deepseek-ai/cordis-plugin-group; do not resolve the runtime with --legacy-peer-deps");
  }
  return lock;
}

export function prepare({ sourceRoot = REPO_ROOT, target, projectsRoot } = {}) {
  assertNodeVersion();
  target = path.resolve(target ?? path.join(realpathSync(os.tmpdir()), `jerrydsh-${BASELINE.dshVersion}-${Date.now()}`));
  ensureDisposableTarget(target);
  if (existsSync(target)) throw new Error(`Target already exists; no files were changed: ${target}`);
  projectsRoot = path.resolve(projectsRoot ?? path.join(target, "external-projects"));
  const dshHome = path.join(target, "dsh-home");
  const patches = Object.fromEntries(BASELINE.profiles.map((profile) => {
    const patch = readFileSync(path.join(sourceRoot, "profile-configs", profile, "cordis.patch.yml"), "utf8");
    assertPrivacy(patch, profile);
    return [profile, rewritePatch(patch, dshHome, projectsRoot)];
  }));
  const webLock = readJson(path.join(sourceRoot, "profile-configs/web/package-lock.json"));
  // Check the supplied locks before creating an output directory.
  for (const component of ["runtime", "zai-websearch"]) {
    validateLock(path.join(sourceRoot, "tools/recovery/locks", component), component);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  mkdirSync(target); // Exclusive creation: never merges into an existing directory.
  for (const profile of BASELINE.profiles) {
    const dest = componentDirectory(target, profile);
    mkdirSync(dest, { recursive: true });
    const sourceManifest = path.join(sourceRoot, "profile-configs", profile, "package.json");
    const manifest = readJson(sourceManifest);
    copyFileSync(sourceManifest, path.join(dest, "package.json"));
    writeFileSync(path.join(dest, "cordis.patch.yml"), patches[profile], { flag: "wx", mode: 0o600 });
    if (profile === "web") copyFileSync(path.join(sourceRoot, "profile-configs/web/package-lock.json"), path.join(dest, "package-lock.json"));
    else writeJson(path.join(dest, "package-lock.json"), subsetLock(webLock, manifest));
  }
  copyTree(path.join(sourceRoot, "self-built"), path.join(dshHome, "plugins"));
  copyTree(path.join(sourceRoot, "mcp-bridges/zai-websearch"), componentDirectory(target, "zai-websearch"));
  for (const component of ["runtime", "zai-websearch"]) {
    const dest = componentDirectory(target, component);
    mkdirSync(dest, { recursive: true });
    for (const file of ["package.json", "package-lock.json"]) {
      copyFileSync(path.join(sourceRoot, "tools/recovery/locks", component, file), path.join(dest, file));
    }
  }
  const environment = {
    DSH_HOME: dshHome,
    CIVAIR_KB_HOME: path.join(projectsRoot, "aircraft-comac/civair-kb"),
    CIVAIR_KB_PYTHON: "python3",
    CIVAIR_KB_STORE: path.join(dshHome, "kb/civair"),
    COMAC_BENCH_HOME: path.join(projectsRoot, "jerry-personal/JerryDSH-COMACBench"),
    FMEA_HOME: path.join(projectsRoot, "aircraft-comac/COMAC_FMEA_FTA_Manager_8024"),
    FMEA_PYTHON: path.join(projectsRoot, "aircraft-comac/COMAC_FMEA_FTA_Manager_8024/.venv/bin/python"),
    PDF_FTA_BACKEND: "http://127.0.0.1:8000",
  };
  writeJson(path.join(target, "environment.json"), environment);
  writeFileSync(path.join(target, "npmrc"), "audit=false\nfund=false\n", { flag: "wx", mode: 0o600 });
  const files = Object.fromEntries(listFiles(target).map((file) => [file, sha256(readFileSync(path.join(target, file)))]));
  writeJson(path.join(target, MARKER), {
    schemaVersion: 1, baseline: BASELINE.id, dshVersion: BASELINE.dshVersion,
    snapshotCommit: BASELINE.snapshotCommit, target, createdAt: new Date().toISOString(), files,
    lockGeneration: BASELINE.lockGeneration,
  });
  return checkTarget(target);
}

function preparedManifest(target) {
  target = path.resolve(target);
  ensureDisposableTarget(target);
  const markerFile = path.join(target, MARKER);
  if (!existsSync(markerFile) || lstatSync(markerFile).isSymbolicLink()) throw new Error("Target is not a prepared recovery directory");
  const marker = readJson(markerFile);
  if (marker.schemaVersion !== 1 || marker.baseline !== BASELINE.id || marker.target !== target || marker.dshVersion !== BASELINE.dshVersion) {
    throw new Error("Recovery marker is incompatible or the directory was moved; prepare a new target");
  }
  return marker;
}

export function checkTarget(target) {
  assertNodeVersion();
  target = path.resolve(target);
  const marker = preparedManifest(target);
  for (const [relative, digest] of Object.entries(marker.files)) {
    const file = path.resolve(target, relative);
    if (!inside(target, file)) throw new Error("Invalid path in recovery manifest");
    noSymlinkAncestors(file);
    if (!existsSync(file) || sha256(readFileSync(file)) !== digest) throw new Error(`Prepared asset changed or missing: ${relative}`);
  }
  for (const profile of BASELINE.profiles) {
    assertPrivacy(readFileSync(path.join(componentDirectory(target, profile), "cordis.patch.yml"), "utf8"), profile);
  }
  const locks = Object.fromEntries(COMPONENTS.map((component) => [component, validateLock(componentDirectory(target, component), component)]));
  const runtimePackage = path.join(componentDirectory(target, "runtime"), "node_modules/@deepseek-ai/dsh/package.json");
  const runtimeInstalled = existsSync(runtimePackage) && readJson(runtimePackage).version === BASELINE.dshVersion;
  const env = readJson(path.join(target, "environment.json"));
  const missingBackends = ["CIVAIR_KB_HOME", "COMAC_BENCH_HOME", "FMEA_HOME"].filter((name) => !existsSync(env[name]));
  return {
    ok: true, scope: "static recovery preflight; this check does not boot DSH or backend services",
    target, dshVersion: BASELINE.dshVersion, nodeVersion: process.versions.node, runtimeInstalled,
    privacy: Object.fromEntries(BASELINE.profiles.map((name) => [name, "two explicit disables present"])),
    filesChecked: Object.keys(marker.files).length,
    gitDependencies: Object.entries(locks.web.packages).filter(([, entry]) => /git\+ssh:/.test(entry.resolved ?? "")).map(([name, entry]) => ({ name, resolved: entry.resolved })),
    missingBackendEnvironmentKeys: missingBackends,
    limitations: ["Backend services, data and credentials are not restored", "Resolved DSH composition and network behavior still require runtime verification", "The search bridge currently uses macOS Keychain; it is not a cross-platform credential implementation"],
  };
}

export function installationPlan(target, component, { allowScripts = false } = {}) {
  target = path.resolve(target);
  checkTarget(target);
  const cwd = componentDirectory(target, component);
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args: [
    "ci", ...(component === "runtime" ? ["--legacy-peer-deps=false"] : ["--legacy-peer-deps"]),
    "--no-audit", "--no-fund", ...(allowScripts ? [] : ["--ignore-scripts"]),
  ], cwd, shell: false };
}

export function npmEnvironment(target) {
  const env = {};
  // Do not pass API keys or an SSH agent to dependency installers.
  for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR", "GIT_SSL_CAINFO", "CURL_CA_BUNDLE"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return {
    ...env, DSH_HOME: path.join(target, "dsh-home"),
    NPM_CONFIG_USERCONFIG: path.join(target, "npmrc"), NPM_CONFIG_GLOBALCONFIG: path.join(target, "npm-globalrc"),
    NPM_CONFIG_CACHE: path.join(target, "npm-cache"),
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: "0",
    // Keep the original locked commit; fetch this public Git dependency over HTTPS.
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf", GIT_CONFIG_VALUE_0: "ssh://git@github.com/",
    GIT_CONFIG_KEY_1: "credential.helper", GIT_CONFIG_VALUE_1: "",
  };
}

export function install(target, component, options = {}) {
  const plan = installationPlan(target, component, options);
  target = path.resolve(target);
  if (process.platform === "win32") throw new Error("Installer execution is currently supported on macOS/Linux; static prepare/check are portable");
  const result = spawnSync(plan.command, plan.args, { cwd: plan.cwd, shell: false, stdio: "inherit", env: npmEnvironment(target) });
  if (result.error || result.status !== 0) throw new Error(`npm ci failed for ${component}; no runtime-ready claim is made`);
  const doctor = component === "web" ? patchDoctorPackage(path.join(plan.cwd, "node_modules/@linxin666/dsh-doctor"), BASELINE.doctor) : undefined;
  return { ok: true, component, scriptsAllowed: Boolean(options.allowScripts), doctor, ...checkTarget(target) };
}

/** The fixed-version CLI's config dump composes YAML without booting plugins. */
export function probe(target, component = "headless") {
  target = path.resolve(target);
  const preflight = checkTarget(target);
  if (!BASELINE.profiles.includes(component)) throw new Error("probe component must be web, headless or fr-guard");
  if (!preflight.runtimeInstalled) throw new Error("Install the fixed runtime component before probing");
  const runtimeDir = componentDirectory(target, "runtime");
  const profileDir = componentDirectory(target, component);
  const manifest = readJson(path.join(profileDir, "package.json"));
  for (const bundle of manifest.dsh.profile.bundles) {
    if (typeof bundle !== "string" || bundle.includes("..") || path.isAbsolute(bundle)) throw new Error("Unsupported bundle reference in frozen profile");
    if (![profileDir, runtimeDir].some((directory) => existsSync(path.join(directory, "node_modules", bundle, "package.json")))) {
      throw new Error(`Install the ${component} component before probing: missing bundle ${bundle}`);
    }
  }
  const binary = path.join(runtimeDir, "node_modules/@deepseek-ai/dsh/lib/bin.js");
  const execute = (args) => {
    const result = spawnSync(process.execPath, [binary, ...args], {
      cwd: target, env: npmEnvironment(target), encoding: "utf8", timeout: 20000, shell: false,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`DSH ${args.join(" ")} probe failed: ${result.error?.code ?? result.status}; ${(result.stderr ?? "").slice(0,500)}`);
    }
    return result;
  };
  const version = execute(["--version"]).stdout.trim();
  if (version !== BASELINE.dshVersion) throw new Error(`Unexpected DSH executable version: ${version}`);
  const dump = execute(["--profile", component, "--dump-config"]);
  assertPrivacy(dump.stdout, `${component} composed config`);
  const warnings = dump.stderr.trim().split(/\r?\n/).filter(Boolean);
  const knownWarnings = warnings.filter((line) => line.includes('patch: entry "vision-toolkit" not found'));
  if (warnings.length !== knownWarnings.length) {
    throw new Error(`DSH composition has unresolved diagnostics: ${warnings.join("\n")}`);
  }
  return {
    ok: true, scope: "version and config composition only; no profile boot or LLM request",
    dshVersion: version, profile: component, privacyDoubleDisable: true,
    composedConfigSha256: sha256(dump.stdout), warnings,
  };
}

function parseArgs(args) {
  const [command = "help", ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === "--allow-scripts") { options.allowScripts = true; continue; }
    if (!["--target", "--projects-root", "--component"].includes(key) || !rest[i + 1] || rest[i + 1].startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${key}`);
    }
    options[key.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = rest[++i];
  }
  return { command, options };
}

export function main(args = process.argv.slice(2)) {
  const { command, options } = parseArgs(args);
  if (command === "help" || command === "--help") return {
    usage: ["prepare [--target NEW_DIRECTORY] [--projects-root EXISTING_PROJECTS_ROOT]", "check --target DIRECTORY", "install --target DIRECTORY --component runtime|web|headless|fr-guard|zai-websearch [--allow-scripts]", "probe --target DIRECTORY [--component headless|web|fr-guard]", "patch-doctor --target DIRECTORY", "launch-plan --target DIRECTORY"],
    note: "prepare/check never install, start services, or read credentials; existing targets are never overwritten",
  };
  if (command === "prepare") {
    if (options.allowScripts || options.component) throw new Error("prepare cannot install or enable scripts");
    return prepare(options);
  }
  if (!options.target) throw new Error("--target is required");
  if (command === "check") return checkTarget(options.target);
  if (command === "probe") return probe(options.target, options.component);
  if (command === "install") {
    if (!options.component) throw new Error("install requires an explicit --component; no packages were installed");
    return install(options.target, options.component, options);
  }
  if (command === "patch-doctor") {
    checkTarget(options.target);
    return patchDoctorPackage(path.join(componentDirectory(path.resolve(options.target), "web"), "node_modules/@linxin666/dsh-doctor"), BASELINE.doctor);
  }
  if (command === "launch-plan") {
    checkTarget(options.target);
    return {
      command: path.join(path.resolve(options.target), "runtime/node_modules/.bin/dsh"),
      args: ["--profile", "web", "--port", "3081"], environment: readJson(path.join(path.resolve(options.target), "environment.json")),
      executed: false, note: "Apply this environment only to the new process after reviewing missing backends and runtime checks; credentials are not included",
    };
  }
  throw new Error(`Unknown command: ${command}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(main(), null, 2) + "\n"); }
  catch (error) { process.stderr.write(`recovery: ${error.message}\n`); process.exitCode = 1; }
}
