#!/usr/bin/env python3
"""Offline submission guard and explicit-list code handoff. Python standard library only.
No upload, credential validation, Git mutation or history rewrite. Pattern checks are
not a secret-scanner replacement, human sensitivity review or proof of key revocation.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import stat as stat_module
import sys
import zipfile

MAX_BYTES = 2 * 1024 * 1024
MAX_FILES = 2000
MAX_COMMITS = 500
DENIED_DIRS = {'.git', '.dsh', 'dsh-home', 'node_modules', '__pycache__',
               '.venv', 'venv', 'secrets', '.ssh', '.aws'}
DENIED_SUFFIXES = {'.zip', '.gz', '.tgz', '.tar', '.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx'}
PATTERNS = [
 ('private-key', re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')),
 ('provider-token', re.compile(rb'\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})')),
 ('credential-assignment', re.compile(rb'''(?i)["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']([A-Za-z0-9_./+=:-]{20,})["']''')),
 ('unquoted-assignment', re.compile(rb'(?im)(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*([A-Za-z0-9_./+=:-]{24,})[ \t]*(?:$|#)')),
 ('bearer-value', re.compile(rb'(?i)\bbearer\s+[A-Za-z0-9_./+=-]{24,}')),
]

class Rejected(ValueError):
    pass

def git(root: Path, *args: str) -> bytes:
    p = subprocess.run(['git', '-C', str(root), *args], capture_output=True, timeout=30)
    if p.returncode:
        raise Rejected('Git inspection failed; output intentionally withheld')
    return p.stdout

def check_root(expected: str) -> Path:
    root = Path(expected)
    if not root.is_absolute():
        raise Rejected('expected root must be absolute')
    root = root.resolve()
    if root in (Path('/'), Path.home().resolve()):
        raise Rejected('HOME and filesystem root are not allowed')
    actual = Path(git(Path.cwd(), 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    if actual != root:
        raise Rejected('repository root mismatch; run from the intended repository')
    return root

def path_reason(name: str) -> str | None:
    p = PurePosixPath(name)
    parts = name.split('/')
    if not name or p.is_absolute() or any(x in ('', '.', '..') for x in parts) or '\\' in name or any(ord(c) < 32 for c in name):
        return 'unsafe-path'
    low = [x.lower() for x in parts]
    if low[0] == 'recovery' or any(x in DENIED_DIRS or '.tmpdir' in x for x in low):
        return 'runtime-or-private-directory'
    leaf = low[-1]
    if 'credential' in leaf or leaf == '.env' or leaf.startswith('.env.') or leaf in ('id_rsa', 'id_ed25519'):
        return 'credential-file'
    if Path(leaf).suffix in DENIED_SUFFIXES:
        return 'archive-database-or-key'
    return None

def inspect(name: str, data: bytes) -> list[dict[str, str]]:
    reason = path_reason(name)
    if reason:
        return [{'path': name, 'rule': reason}]
    if len(data) > MAX_BYTES:
        return [{'path': name, 'rule': 'file-too-large-to-inspect'}]
    try:
        data.decode('utf-8')
    except UnicodeError:
        return [{'path': name, 'rule': 'non-utf8-requires-separate-review'}]
    if b'\0' in data:
        return [{'path': name, 'rule': 'binary-requires-separate-review'}]
    return [{'path': name, 'rule': rule} for rule, pattern in PATTERNS if pattern.search(data)]

def entries(root: Path, mode: str, ref: str = 'HEAD') -> list[tuple[str, str, str]]:
    result = []
    if mode == 'staged':
        changed = set(git(root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split(b'\0'))
        rows = git(root, 'ls-files', '--stage', '-z').split(b'\0')
        for row in filter(None, rows):
            meta, name = row.split(b'\t', 1)
            permissions, sha, stage = meta.split()
            if stage != b'0': raise Rejected('unmerged index is not eligible')
            if name in changed:
                result.append((permissions.decode(), sha.decode(), name.decode('utf-8')))
    else:
        sha = git(root, 'rev-parse', '--verify', ref + '^{commit}').decode().strip()
        rows = git(root, 'ls-tree', '-r', '-z', sha).split(b'\0')
        for row in filter(None, rows):
            meta, name = row.split(b'\t', 1)
            permissions, _, blob = meta.split()
            result.append((permissions.decode(), blob.decode(), name.decode('utf-8')))
    if len(result) > MAX_FILES:
        raise Rejected('too many files; split and review explicitly')
    return result

def scan(root: Path, mode: str, ref: str = 'HEAD') -> list[dict[str, str]]:
    findings = []
    for permissions, blob, name in entries(root, mode, ref):
        if permissions not in ('100644', '100755'):
            findings.append({'path': name, 'rule': 'symlink-or-submodule'})
        elif reason := path_reason(name):
            findings.append({'path': name, 'rule': reason})
        elif int(git(root, 'cat-file', '-s', blob)) > MAX_BYTES:
            findings.append({'path': name, 'rule': 'file-too-large-to-inspect'})
        else:
            findings.extend(inspect(name, git(root, 'cat-file', 'blob', blob)))
    return findings

def scan_range(root: Path, base: str, tip: str) -> list[dict[str, str]]:
    for rev in (base, tip):
        if not re.fullmatch(r'[0-9a-f]{40}', rev):
            raise Rejected('range endpoints must be full 40-character Git SHAs')
    end = git(root, 'rev-parse', '--verify', tip + '^{commit}').decode().strip()
    revision = end if base == '0' * 40 else base + '..' + end
    commits = git(root, 'rev-list', '--max-count=' + str(MAX_COMMITS + 1), revision).decode().splitlines()
    if len(commits) > MAX_COMMITS: raise Rejected('commit range too large for this lightweight guard')
    findings = []
    # Every intermediate snapshot is inspected, not only the final diff.
    for commit in commits:
        findings.extend({**x, 'commit': commit} for x in scan(root, 'head', commit))
    return findings

def fingerprint(st: os.stat_result) -> tuple:
    return (st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, st.st_ctime_ns)

def safe_open(root: Path, name: str):
    """Open each component without following symlinks (POSIX Mac/Linux)."""
    if not hasattr(os, 'O_NOFOLLOW'): raise Rejected('secure export requires O_NOFOLLOW support')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        parts = PurePosixPath(name).parts
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        child = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        if not stat_module.S_ISREG(os.fstat(child).st_mode):
            os.close(child); raise Rejected('export input is not a regular file')
        return os.fdopen(child, 'rb')
    finally:
        os.close(fd)

def export_code(root: Path, listing: Path, target: Path, reviewed: bool) -> dict:
    if not reviewed: raise Rejected('explicit --reviewed-public acknowledgement is required')
    target = target.absolute()
    if target.resolve().is_relative_to(root): raise Rejected('handoff output must be outside the source repository')
    if target.exists(): raise Rejected('handoff output already exists')
    selection = json.loads(listing.read_text(encoding='utf-8'))
    if not isinstance(selection, list) or not selection or len(selection) > 128:
        raise Rejected('selection must contain 1..128 explicit file records')
    records, payloads, names = [], [], set()
    for item in selection:
        if not isinstance(item, dict) or set(item) != {'path', 'classification'}:
            raise Rejected('each record needs only path and classification')
        name, kind = item['path'], item['classification']
        if not isinstance(name, str) or kind not in ('public-code', 'synthetic-fixture', 'redacted-evidence'):
            raise Rejected('invalid path or classification')
        if path_reason(name): raise Rejected('forbidden handoff path: ' + name)
        if name in names or name == 'HANDOFF-MANIFEST.json': raise Rejected('duplicate or reserved path')
        names.add(name)
        file = root / name
        cursor = root
        for component in PurePosixPath(name).parts:
            cursor /= component
            if cursor.is_symlink(): raise Rejected('symlinks are not exported')
        if not file.resolve().is_relative_to(root) or not file.is_file():
            raise Rejected('selection must reference existing regular files')
        stat = file.stat()
        if stat.st_size > MAX_BYTES: raise Rejected('selected file exceeds inspection limit')
        with safe_open(root, name) as stream:
            if fingerprint(os.fstat(stream.fileno())) != fingerprint(stat): raise Rejected('source changed before read')
            data = stream.read(MAX_BYTES + 1)
            if fingerprint(os.fstat(stream.fileno())) != fingerprint(stat): raise Rejected('source changed during read')
        after = file.stat()
        if (stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise Rejected('source changed after read')
        if inspect(name, data): raise Rejected('content scan rejected ' + name + '; values withheld')
        payloads.append((name, data))
        records.append({'path': name, 'classification': kind, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    head = git(root, 'rev-parse', '--verify', 'HEAD').decode().strip()
    dirty = bool(git(root, 'status', '--porcelain', '--untracked-files=normal'))
    manifest = {'schema': 'explicit-code-handoff/1', 'source_commit': head,
                'working_tree_dirty': dirty, 'scope': 'explicit UTF-8 files; not a Git history bundle',
                'sensitivity_review': 'operator attested; not independently verified',
                'revocation_status': 'NOT_VERIFIED', 'files': records}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in payloads + [('HANDOFF-MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())]:
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0)); info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    data = buf.getvalue()
    # Exclusive creation: never overwrite an existing artifact, even on a race.
    with target.open('xb') as out: out.write(data)
    return {'result': 'HANDOFF_WRITTEN', 'files': len(records), 'bytes': len(data),
            'sha256': hashlib.sha256(data).hexdigest(), 'revocation_status': 'NOT_VERIFIED'}

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--expected-root', required=True)
    ap.add_argument('--mode', choices=('staged', 'head', 'range', 'export'), default='staged')
    ap.add_argument('--base'); ap.add_argument('--tip'); ap.add_argument('--selection'); ap.add_argument('--output')
    ap.add_argument('--reviewed-public', action='store_true')
    args = ap.parse_args()
    try:
        root = check_root(args.expected_root)
        if args.mode == 'export':
            if not args.selection or not args.output: raise Rejected('export requires selection and output')
            report = export_code(root, Path(args.selection), Path(args.output), args.reviewed_public)
        else:
            if args.mode == 'range':
                if not args.base or not args.tip: raise Rejected('range requires base and tip')
                findings = scan_range(root, args.base, args.tip)
            else: findings = scan(root, args.mode)
            report = {'result': 'BLOCKED' if findings else 'CHECKS_PASS', 'mode': args.mode,
                      'findings': findings, 'limitations': 'patterns only; no provider revocation or sensitivity attestation'}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1 if report['result'] == 'BLOCKED' else 0
    except (Rejected, OSError, ValueError, UnicodeError, subprocess.TimeoutExpired) as exc:
        print(json.dumps({'result': 'INSPECTION_FAILED', 'reason': str(exc)}, ensure_ascii=False))
        return 2

if __name__ == '__main__': raise SystemExit(main())
