"""Independent acceptance tests: actual Git hooks and local bare-remote pushes.
Uses synthetic sentinel strings only; no internet, user clone or model credentials.
Promoted from the independently executed R5 acceptance pack; repository-local source.
"""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[2]

class RealGitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-r5-review-')
        self.base = Path(self.tmp.name).resolve()
        self.root = self.base / 'repo'
        self.root.mkdir()
        self.env = os.environ.copy()
        # No inherited repository selection or global Git hooks/configuration.
        for key in list(self.env):
            if key.startswith('GIT_'):
                self.env.pop(key)
        self.env.update(GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        self.g('init', '-q', '-b', 'main')
        self.g('config', 'user.name', 'Independent synthetic review')
        self.g('config', 'user.email', 'review@example.invalid')
        self.g('config', 'commit.gpgsign', 'false')
        self.g('config', 'core.autocrlf', 'false')
        self.write('README.md', 'Public synthetic test\n')
        self.g('add', 'README.md')
        self.g('commit', '-qm', 'baseline')
        self.initial = self.g('rev-parse', 'HEAD').stdout.strip()
        for rel in ['tools/security/preflight.py', '.githooks/pre-commit', '.githooks/pre-push']:
            dest = self.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(SOURCE / rel, dest)
            if rel.startswith('.githooks/'):
                dest.chmod(0o755)
        self.g('config', 'dsh.expectedRoot', str(self.root))
        self.g('config', 'core.hooksPath', '.githooks')

    def tearDown(self):
        self.tmp.cleanup()

    def g(self, *args, check=True, cwd=None):
        result = subprocess.run(['git', '-C', str(cwd or self.root), *args],
                                capture_output=True, text=True, encoding='utf-8',
                                env=self.env, timeout=20)
        if check and result.returncode:
            raise AssertionError(f'Git operation {args[0]} failed with exit {result.returncode}')
        return result

    def write(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode('utf-8'))
        return path

    def stage(self, name, data):
        path = self.write(name, data)
        self.g('add', '--', name)
        return path

    def baseline_file(self, symlink=False):
        path = self.root / 'config.py'
        if symlink:
            path.symlink_to('README.md')
            self.g('add', 'config.py')
        else:
            self.stage('config.py', 'value = None\n')
        # Synthetic baseline fixtures may contain a link, so deliberately bypass this hook here.
        self.g('-c', 'core.hooksPath=' + str(self.base / 'no-hooks'), 'commit', '-qm', 'fixture')
        return path

    def blocked_commit(self, expected_rule):
        before = self.g('rev-parse', 'HEAD').stdout
        result = self.g('commit', '-qm', 'must block', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(expected_rule, result.stdout + result.stderr)
        self.assertEqual(self.g('rev-parse', 'HEAD').stdout, before)
        self.assertNotIn('Z' * 32, result.stdout + result.stderr)

    def cli(self, root=None, *args):
        return subprocess.run([sys.executable, '-S', str(self.root / 'tools/security/preflight.py'),
                               '--expected-root', str(root or self.root), *args],
                              cwd=self.root, env=self.env, capture_output=True,
                              text=True, encoding='utf-8', timeout=20)

    def make_remote(self):
        remote = self.base / 'remote.git'
        self.g('init', '--bare', '-q', str(remote))
        self.g('remote', 'add', 'origin', str(remote))
        self.g('push', '-u', 'origin', 'main')
        return remote

    def test_clean_commit_allowed(self):
        self.stage('clean.py', 'answer = 42\n')
        self.g('commit', '-qm', 'clean')
        self.assertNotEqual(self.g('rev-parse', 'HEAD').stdout.strip(), self.initial)

    def test_symlink_to_secret_typechange_blocks_real_commit(self):
        path = self.baseline_file(symlink=True)
        path.unlink()
        self.stage('config.py', "value = '" + 'sk-' + 'Z' * 32 + "'\n")
        self.assertEqual(self.g('diff', '--cached', '--name-status').stdout.strip(), 'T\tconfig.py')
        self.blocked_commit('provider-token')

    def test_regular_to_symlink_typechange_blocks_real_commit(self):
        path = self.baseline_file()
        path.unlink()
        path.symlink_to('README.md')
        self.g('add', 'config.py')
        self.assertEqual(self.g('diff', '--cached', '--name-status').stdout.strip(), 'T\tconfig.py')
        self.blocked_commit('symlink-or-submodule')

    def test_staged_secret_clean_worktree_still_blocks(self):
        self.stage('config.py', "value = '" + 'sk-' + 'Z' * 32 + "'\n")
        self.write('config.py', 'value = None\n')
        self.blocked_commit('provider-token')

    def test_symlink_to_clean_file_typechange_allowed(self):
        path = self.baseline_file(symlink=True)
        path.unlink()
        self.stage('config.py', 'value = None\n')
        self.g('commit', '-qm', 'clean conversion')

    def test_symlink_to_binary_typechange_blocks(self):
        path = self.baseline_file(symlink=True)
        path.unlink()
        self.stage('config.py', b'\x00binary-synthetic')
        self.blocked_commit('binary-requires-separate-review')

    def test_regular_to_gitlink_typechange_blocks(self):
        self.baseline_file()
        head = self.g('rev-parse', 'HEAD').stdout.strip()
        self.g('update-index', '--add', '--cacheinfo', '160000,' + head + ',config.py')
        self.assertEqual(self.g('diff', '--cached', '--name-status').stdout.strip(), 'T\tconfig.py')
        self.blocked_commit('symlink-or-submodule')

    def test_intermediate_secret_deleted_before_push_still_blocks(self):
        remote = self.make_remote()
        before = self.g('rev-parse', 'refs/heads/main', cwd=remote).stdout
        self.stage('config.py', "value = '" + 'sk-' + 'Z' * 32 + "'\n")
        self.g('-c', 'core.hooksPath=' + str(self.base / 'no-hooks'), 'commit', '-qm', 'synthetic secret')
        self.g('rm', 'config.py')
        self.g('-c', 'core.hooksPath=' + str(self.base / 'no-hooks'), 'commit', '-qm', 'removed')
        self.assertEqual(self.cli(None, '--mode', 'head').returncode, 0)
        result = self.g('push', 'origin', 'main', check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('provider-token', result.stdout + result.stderr)
        self.assertNotIn('Z' * 32, result.stdout + result.stderr)
        self.assertEqual(self.g('rev-parse', 'refs/heads/main', cwd=remote).stdout, before)

    def test_clean_push_allowed(self):
        remote = self.make_remote()
        self.stage('clean.py', 'answer = 42\n')
        self.g('commit', '-qm', 'clean')
        self.g('push', 'origin', 'main')
        self.assertEqual(self.g('rev-parse', 'HEAD').stdout,
                         self.g('rev-parse', 'refs/heads/main', cwd=remote).stdout)

    def test_wrong_expected_root_rejected(self):
        self.g('config', 'dsh.expectedRoot', str(self.base / 'wrong'))
        self.stage('clean.py', 'answer = 42\n')
        before = self.g('rev-parse', 'HEAD').stdout
        self.assertNotEqual(self.g('commit', '-qm', 'must block', check=False).returncode, 0)
        self.assertEqual(self.g('rev-parse', 'HEAD').stdout, before)

    def test_cli_with_symlinked_expected_root_exports_outside(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        selection = self.base / 'selection.json'
        selection.write_text(json.dumps([{'path': 'README.md', 'classification': 'public-code'}]), encoding='utf-8')
        target = self.base / 'code.zip'
        result = self.cli(alias, '--mode', 'export', '--selection', str(selection),
                          '--output', str(target), '--reviewed-public')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with zipfile.ZipFile(target) as archive:
            self.assertEqual(set(archive.namelist()), {'README.md', 'HANDOFF-MANIFEST.json'})
            manifest = json.loads(archive.read('HANDOFF-MANIFEST.json'))
            self.assertEqual(manifest['files'][0]['sha256'], hashlib.sha256((self.root / 'README.md').read_bytes()).hexdigest())
            self.assertEqual(manifest['revocation_status'], 'NOT_VERIFIED')

    def test_cli_with_symlinked_expected_root_blocks_inside_output(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        selection = self.base / 'selection.json'
        selection.write_text(json.dumps([{'path': 'README.md', 'classification': 'public-code'}]), encoding='utf-8')
        target = alias / 'inside.zip'
        result = self.cli(alias, '--mode', 'export', '--selection', str(selection),
                          '--output', str(target), '--reviewed-public')
        self.assertEqual(result.returncode, 2)
        self.assertFalse(target.exists())

if __name__ == '__main__':
    unittest.main(verbosity=2)
