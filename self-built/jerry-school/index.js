/**
 * jerry-school — 工程学校 DSH 插件。
 *
 * 机制：扫描本插件 skills/ 下的技能束（<name>/SKILL.md），解析 frontmatter，
 * 以运行时技能注册进 ctx.skills（rank 250：可被项目级覆盖，覆盖用户级技能）。
 * 每个束可携带 reference/ 等附属文件——resourceBase 指向束目录，技能正文里的
 * 相对路径由 agent 按需读取（progressive disclosure，正文保持短）。
 *
 * 热重载：fs.watch 监听 skills/，SKILL.md 增删改经 300ms 防抖后按内容哈希 diff
 * 重挂——改技能文件即时生效，不必重启 profile。设 DSH_ENG_SCHOOL_WATCH=0 关闭。
 *
 * frontmatter 约定（本插件自有，保持极简）：
 *   name:        kebab-case 技能名（必填）
 *   description: 一行描述——模型可调用时它是常驻 context pointer（必填）
 *   whenToUse:   可选补充路由说明
 *   audience:    model（默认，模型+用户都能调） | user（仅用户调用，零常驻 context 开销）
 *
 * 零依赖、零网络：纯本地文件读取 + 文件监听。
 */
import { readdirSync, readFileSync, statSync, watch } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const name = "jerry-school";
export const inject = ["skills"];

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(ROOT, "skills");
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEBOUNCE_MS = 300;

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2].trim() };
}

function audienceToInvocation(audience) {
  if (audience === "user") return { modelInvocable: false, userInvocable: true };
  return { modelInvocable: true, userInvocable: true };
}

/** 读一个技能束；无效返回 { skip: 原因 }。 */
function loadBundle(bundle, entry) {
  let raw;
  try {
    if (!statSync(bundle).isDirectory()) return null; // 非目录：不是技能束，忽略
    raw = readFileSync(path.join(bundle, "SKILL.md"), "utf8");
  } catch {
    return { skip: `${entry} (缺 SKILL.md)` };
  }
  const { meta, body } = parseFrontmatter(raw);
  if (!meta.name || !meta.description) return { skip: `${entry} (frontmatter 缺 name/description)` };
  if (!SKILL_NAME_RE.test(meta.name)) return { skip: `${entry} (name 非 kebab-case: ${meta.name})` };
  const registration = {
    name: meta.name,
    description: meta.description,
    ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
    content: body,
    source: "runtime",
    resourceBase: { kind: "directory", path: bundle },
    invocation: audienceToInvocation(meta.audience),
  };
  const sig = createHash("sha1")
    .update(JSON.stringify([meta.name, meta.description, meta.whenToUse, meta.audience, body]))
    .digest("hex");
  return { registration, sig };
}

async function apply(ctx) {
  const log = (...a) => ctx.logger.info(`[jerry-school] ${a.join(" ")}`);
  /** name -> { dispose, sig } */
  const mounted = new Map();

  function resync() {
    let entries;
    try {
      entries = readdirSync(SKILLS_DIR).sort();
    } catch (err) {
      log("skills 目录不可读: " + err.message);
      return;
    }
    const seen = new Set();
    const skipped = [];
    for (const entry of entries) {
      const loaded = loadBundle(path.join(SKILLS_DIR, entry), entry);
      if (!loaded) continue;
      if (loaded.skip) {
        skipped.push(loaded.skip);
        continue;
      }
      const { registration, sig } = loaded;
      seen.add(registration.name);
      const prev = mounted.get(registration.name);
      if (prev && prev.sig === sig) continue; // 内容未变
      try {
        prev?.dispose();
        mounted.set(registration.name, { dispose: ctx.skills.register(registration), sig });
        log((prev ? "reloaded: " : "mounted: ") + registration.name);
      } catch (err) {
        skipped.push(`${entry} (${err.message})`);
        if (prev) mounted.set(registration.name, prev); // 保留旧的可用注册
      }
    }
    // 目录里消失的：注销
    for (const [skillName, rec] of [...mounted]) {
      if (!seen.has(skillName)) {
        try {
          rec.dispose();
        } catch {
          /* 已注销 */
        }
        mounted.delete(skillName);
        log("unmounted: " + skillName);
      }
    }
    log(`skills=${mounted.size}` + (skipped.length ? `; skipped: ${skipped.join(", ")}` : ""));
  }

  resync();

  // 热重载：默认开，DSH_ENG_SCHOOL_WATCH=0 关闭；监听失败降级为静态注册
  let watcher = null;
  let timer = null;
  if (process.env.DSH_ENG_SCHOOL_WATCH !== "0") {
    try {
      watcher = watch(SKILLS_DIR, { recursive: true }, (_event, filename) => {
        if (filename && !/(^|\/)(SKILL\.md)$/.test(filename) && !filename.endsWith("/")) {
          // reference/ 等附属文件的改动不影响注册（正文按需现读），只响应束结构变化
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            resync();
          } catch (err) {
            log("resync 失败（保留现有注册）: " + err.message);
          }
        }, DEBOUNCE_MS);
      });
      watcher.on("error", (err) => log("watcher 错误（热重载已停用，注册保持）: " + err.message));
      log("hot reload on (skills/)");
    } catch (err) {
      log("watcher 不可用，热重载停用: " + err.message);
    }
  }

  // cordis 拆卸序：关 watcher → 逐个注销
  return () => {
    clearTimeout(timer);
    try {
      watcher?.close();
    } catch {
      /* 已关 */
    }
    for (const [, rec] of mounted) {
      try {
        rec.dispose();
      } catch {
        /* 已注销 */
      }
    }
    mounted.clear();
  };
}

export { apply };
