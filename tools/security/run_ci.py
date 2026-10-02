#!/usr/bin/env python3
"""Run synthetic security regressions under real and symlinked temporary roots.
Standard library only. No Docker, model, provider, live workspace or Git history scan.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXPECTED_TESTS = 47
SOURCES = ['tools/security/preflight.py', '.githooks/pre-commit', '.githooks/pre-push',
           'tests/security/test_preflight.py', 'tests/security/test_real_git.py',
           'tools/security/run_ci.py']


def git(*args: str) -> str | None:
    p = subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True,
                       text=True, encoding='utf-8', timeout=30)
    return p.stdout.strip() if p.returncode == 0 else None


def child(out: Path) -> int:
    suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests/security'))
    discovered = suite.countTestCases()
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    passed = (discovered == EXPECTED_TESTS and result.testsRun == EXPECTED_TESTS
              and result.wasSuccessful() and not result.skipped)
    report = {
        'schema': 'security-ci/1', 'status': 'PASS' if passed else 'FAIL',
        'scope': 'synthetic-security-regressions-only',
        'discovered': discovered, 'tests_run': result.testsRun,
        'failures': len(result.failures), 'errors': len(result.errors),
        'skipped': len(result.skipped), 'expected': EXPECTED_TESTS,
        'system': platform.system(), 'machine': platform.machine(),
        'release': platform.release(), 'python': platform.python_version(),
        'git': git('--version'), 'checkout_commit': git('rev-parse', 'HEAD'),
        'tmpdir': tempfile.gettempdir(),
        'tmpdir_resolved': str(Path(tempfile.gettempdir()).resolve()),
        'source_sha256': {p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in SOURCES},
        'p0_runtime': 'NOT_RUN', 'credential_revocation': 'NOT_VERIFIED',
    }
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 0 if passed else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--child', action='store_true', help=argparse.SUPPRESS)
    args = ap.parse_args()
    out = args.out.resolve()
    if out.is_relative_to(ROOT):
        ap.error('evidence output must be outside the source repository')
    if args.child:
        return child(out)
    out.mkdir(parents=True, exist_ok=False)
    env = {k: v for k, v in os.environ.items() if not k.startswith(('GIT_', 'DSH_', 'PREFLIGHT_'))}
    env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
    reports = {}
    with tempfile.TemporaryDirectory(prefix='dsh-ci-roots-') as tmp:
        base = Path(tmp).resolve()
        real = base / 'real'; real.mkdir()
        alias = base / 'alias'; alias.symlink_to(real, target_is_directory=True)
        for name, path in [('real', real), ('symlink', alias)]:
            p = subprocess.run(
                [sys.executable, '-S', str(Path(__file__).resolve()), '--child', '--out', str(out / (name + '.json'))],
                cwd=ROOT, env={**env, 'TMPDIR': str(path), 'TMP': str(path), 'TEMP': str(path)},
                capture_output=True, text=True, encoding='utf-8', timeout=180)
            log = p.stdout + p.stderr
            (out / (name + '.log')).write_text(log, encoding='utf-8')
            print(f'=== {name}: exit={p.returncode} ===\n{log}', flush=True)
            report_path = out / (name + '.json')
            record = json.loads(report_path.read_text(encoding='utf-8')) if report_path.exists() else {}
            reports[name] = {'exit_code': p.returncode, **record}
            if name == 'symlink' and record.get('tmpdir') != str(alias):
                reports[name]['alias_not_exercised'] = True
    ok = all(x.get('status') == 'PASS' and x['exit_code'] == 0
             and not x.get('alias_not_exercised') for x in reports.values())
    summary = {'schema': 'security-ci-matrix/1', 'status': 'PASS' if ok else 'FAIL',
               'runs': reports, 'p0_runtime': 'NOT_RUN'}
    (out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
