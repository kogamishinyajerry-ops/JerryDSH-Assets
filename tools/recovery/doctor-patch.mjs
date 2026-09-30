import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Exact bytes and full-file digests are mandatory; this is not a fuzzy patch. */
export function verifiedReplacement(source, spec) {
  if (sha256(source) !== spec.beforeSha256) {
    throw new Error("doctor preimage SHA-256 mismatch; refusing to guess a patch");
  }
  const pieces = source.split(spec.before);
  if (pieces.length !== 2) throw new Error("doctor expected inject block must occur exactly once");
  const result = pieces.join(spec.after);
  if (sha256(result) !== spec.afterSha256) {
    throw new Error("doctor postimage SHA-256 mismatch; nothing was written");
  }
  return result;
}

function regularFile(file) {
  let ancestor = path.resolve(file);
  for (;;) {
    if (lstatSync(ancestor).isSymbolicLink()) throw new Error(`Symlink patch paths are not accepted: ${ancestor}`);
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular file: ${file}`);
  return readFileSync(file, "utf8");
}

/** Called only inside a prepared recovery target by the public recovery CLI. */
export function patchDoctorPackage(packageDir, spec) {
  const dir = lstatSync(packageDir);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error("doctor package cannot be a symlink");
  const manifest = JSON.parse(regularFile(path.join(packageDir, "package.json")));
  if (manifest.name !== spec.package || manifest.version !== spec.version) {
    throw new Error(`doctor patch only supports ${spec.package}@${spec.version}`);
  }
  const file = path.join(packageDir, spec.relativeFile);
  const backup = `${file}.jerrydsh-${spec.version}.orig`;
  const receiptFile = `${file}.jerrydsh-patch.json`;
  const source = regularFile(file);
  if (sha256(source) === spec.afterSha256) {
    if (!existsSync(backup) || sha256(regularFile(backup)) !== spec.beforeSha256) {
      throw new Error("doctor already has patched bytes but no verified original backup");
    }
    if (!existsSync(receiptFile)) throw new Error("doctor patch receipt missing");
    const receipt = JSON.parse(regularFile(receiptFile));
    if (receipt.beforeSha256 !== spec.beforeSha256 || receipt.afterSha256 !== spec.afterSha256) {
      throw new Error("doctor patch receipt does not match the frozen baseline");
    }
    return { status: "already-patched", version: manifest.version, sha256: spec.afterSha256 };
  }
  const patched = verifiedReplacement(source, spec);
  if (existsSync(backup)) {
    if (sha256(regularFile(backup)) !== spec.beforeSha256) throw new Error("doctor original backup mismatch");
  } else {
    writeFileSync(backup, source, { flag: "wx", mode: 0o600 });
  }
  const temporary = `${file}.jerrydsh-patch-${process.pid}.tmp`;
  writeFileSync(temporary, patched, { flag: "wx", mode: 0o644 });
  if (sha256(regularFile(temporary)) !== spec.afterSha256) throw new Error("doctor temporary file verification failed");
  renameSync(temporary, file);
  writeFileSync(receiptFile, JSON.stringify({
    package: manifest.name, version: manifest.version,
    beforeSha256: spec.beforeSha256, afterSha256: spec.afterSha256,
    tarballIntegrity: spec.tarballIntegrity, patchedAt: new Date().toISOString(),
  }, null, 2) + "\n", { mode: 0o600 });
  if (sha256(regularFile(file)) !== spec.afterSha256) throw new Error("doctor final file verification failed");
  return { status: "patched", version: manifest.version, sha256: spec.afterSha256 };
}
