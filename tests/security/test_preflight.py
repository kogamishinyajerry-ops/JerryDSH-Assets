"""Synthetic credentials only. Real local Git objects; no network or user repositories."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'tools/security/preflight.py'
spec=importlib.util.spec_from_file_location('preflight',SCRIPT)
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

@contextlib.contextmanager
def cwd(p):
    old=Path.cwd();os.chdir(p)
    try: yield
    finally: os.chdir(old)

class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='dsh-guard-')
        self.base=Path(self.tmp.name);self.root=self.base/'repo';self.root.mkdir()
        self.g('init','-q');self.g('config','user.name','Synthetic Test');self.g('config','user.email','test@example.invalid')
        self.g('config','commit.gpgsign','false');self.g('config','core.hooksPath',str(self.base/'no-hooks'))
        self.write('README.md','Synthetic code handoff\n');self.g('add','README.md');self.g('commit','-qm','baseline')
        self.start=self.g('rev-parse','HEAD').strip()
    def tearDown(self): self.tmp.cleanup()
    def g(self,*args):
        p=subprocess.run(['git','-C',str(self.root),*args],capture_output=True,text=True,timeout=10)
        if p.returncode: raise RuntimeError(p.stderr)
        return p.stdout
    def write(self,name,data):
        p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True)
        p.write_bytes(data if isinstance(data,bytes) else data.encode());return p
    def stage(self,name,data): self.write(name,data);self.g('add','--',name)
    def test_expected_root(self):
        with cwd(self.root): self.assertEqual(m.check_root(str(self.root)),self.root)
    def test_wrong_repository(self):
        with cwd(self.root),self.assertRaises(m.Rejected): m.check_root(str(self.base/'wrong'))
    def test_home_refused(self):
        with self.assertRaises(m.Rejected): m.check_root(str(Path.home()))
    def test_relative_root_refused(self):
        with self.assertRaises(m.Rejected): m.check_root('repo')
    def test_clean_staged(self):
        self.stage('module.py','answer = 42\n');self.assertEqual(m.scan(self.root,'staged'),[])
    def test_recovery_tool_source_is_allowed(self):
        self.stage('tools/recovery/recover.py','print("code, not runtime")\n')
        self.assertEqual(m.scan(self.root,'staged'),[])
    def test_forced_credential_file(self):
        self.stage('recovery/dsh-home/.credentials.yaml','synthetic\n');self.assertTrue(m.scan(self.root,'staged'))
    def test_staged_bytes_not_sanitized_worktree(self):
        token='sk-'+'A'*32
        self.stage('module.py',"value = '"+token+"'\n");self.write('module.py','value = None\n')
        f=m.scan(self.root,'staged');self.assertTrue(f);self.assertNotIn(token,json.dumps(f))
    def test_generic_assignment(self):
        token='A'*24+'.'+'B'*24
        self.stage('config.yaml','api_key: "'+token+'"\n');f=m.scan(self.root,'staged')
        self.assertTrue(f);self.assertNotIn(token,json.dumps(f))
    def test_unquoted_assignment(self):
        self.stage('config.yaml','api_key: '+('A'*32)+'.'+('B'*32)+'\n')
        self.assertTrue(m.scan(self.root,'staged'))
    def test_private_key(self):
        header='-----BEGIN '+'PRIVATE KEY-----'
        self.stage('notes.txt',header+'\nFAKE\n');self.assertTrue(m.scan(self.root,'staged'))
    def test_staged_delete_allowed(self):
        self.g('rm','README.md');self.assertEqual(m.scan(self.root,'staged'),[])
    def test_symlink_blocked(self):
        (self.root/'link').symlink_to('README.md');self.g('add','link');self.assertTrue(m.scan(self.root,'staged'))
    def test_binary_blocked(self):
        self.stage('image.bin',b'\0\xff');self.assertTrue(m.scan(self.root,'staged'))
    def test_runtime_database_blocked(self):
        self.stage('state.sqlite','synthetic');self.assertTrue(m.scan(self.root,'staged'))
    def test_tempdir_blocked(self):
        self.stage('.patch.tmpdir/patch.tmp','synthetic');self.assertTrue(m.scan(self.root,'staged'))
    def test_typechange_symlink_to_secret_is_detected(self):
        link=self.root/'config.py';link.symlink_to('README.md');self.g('add','config.py');self.g('commit','-qm','symlink baseline')
        link.unlink();self.stage('config.py',"value = '"+'sk-'+'A'*32+"'\n")
        self.assertEqual(self.g('diff','--cached','--name-status').strip(),'T\tconfig.py')
        self.assertTrue(m.scan(self.root,'staged'))
    def test_typechange_regular_to_symlink_is_detected(self):
        self.stage('config.py','answer = None\n');self.g('commit','-qm','regular baseline')
        p=self.root/'config.py';p.unlink();p.symlink_to('README.md');self.g('add','config.py')
        self.assertEqual(self.g('diff','--cached','--name-status').strip(),'T\tconfig.py')
        self.assertTrue(m.scan(self.root,'staged'))
    def test_intermediate_secret_detected(self):
        self.stage('config.py',"token = '"+'ghp_'+'A'*32+"'\n");self.g('commit','-qm','synthetic-bad')
        self.g('rm','config.py');self.g('commit','-qm','remove')
        self.assertEqual(m.scan(self.root,'head'),[])
        f=m.scan_range(self.root,self.start,self.g('rev-parse','HEAD').strip());self.assertTrue(f)
    def test_new_branch_checks_history(self):
        self.stage('bad.py',"token = '"+'ghp_'+'B'*32+"'\n");self.g('commit','-qm','synthetic-bad')
        self.assertTrue(m.scan_range(self.root,'0'*40,self.g('rev-parse','HEAD').strip()))
    def test_invalid_revision_refused(self):
        with self.assertRaises(m.Rejected):m.scan_range(self.root,'main','HEAD')
    def test_git_failure_does_not_pass(self):
        with patch.object(m,'git',side_effect=m.Rejected('unavailable')),self.assertRaises(m.Rejected):m.scan(self.root,'staged')
    def selection(self,names):
        p=self.base/'selection.json';p.write_text(json.dumps([{'path':n,'classification':'public-code'} for n in names]));return p
    def export(self,names,**kwargs):
        return m.export_code(self.root,self.selection(names),self.base/'code.zip',kwargs.get('reviewed',True))
    def test_export_only_explicit_files(self):
        self.write('not-included.txt','PRIVATE NOT TO COPY')
        r=self.export(['README.md']);self.assertEqual(r['files'],1)
        with zipfile.ZipFile(self.base/'code.zip') as z:
            self.assertEqual(set(z.namelist()),{'README.md','HANDOFF-MANIFEST.json'})
            manifest=json.loads(z.read('HANDOFF-MANIFEST.json'));self.assertEqual(manifest['source_commit'],self.start)
            self.assertEqual(manifest['revocation_status'],'NOT_VERIFIED')
    def test_export_requires_review(self):
        with self.assertRaises(m.Rejected):self.export(['README.md'],reviewed=False)
        self.assertFalse((self.base/'code.zip').exists())
    def test_export_runtime_rejected(self):
        self.write('recovery/private.txt','x')
        with self.assertRaises(m.Rejected):self.export(['recovery/private.txt'])
    def test_export_symlink_rejected(self):
        (self.root/'link.md').symlink_to('README.md')
        with self.assertRaises(m.Rejected):self.export(['link.md'])
    def test_export_parent_symlink_rejected(self):
        (self.root/'linked').symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(m.Rejected):self.export(['linked/README.md'])
    def test_export_secret_leaves_no_archive(self):
        self.write('bad.py',"secret = '"+'sk-'+'C'*32+"'\n")
        with self.assertRaises(m.Rejected):self.export(['README.md','bad.py'])
        self.assertFalse((self.base/'code.zip').exists())
    def test_export_traversal(self):
        with self.assertRaises(m.Rejected):self.export(['../README.md'])
    def test_export_directory_rejected(self):
        (self.root/'src').mkdir()
        with self.assertRaises(m.Rejected):self.export(['src'])
    def test_export_inside_root_refused(self):
        with self.assertRaises(m.Rejected):m.export_code(self.root,self.selection(['README.md']),self.root/'code.zip',True)
    def test_export_no_overwrite(self):
        (self.base/'code.zip').write_bytes(b'sentinel')
        with self.assertRaises(m.Rejected):self.export(['README.md'])
        self.assertEqual((self.base/'code.zip').read_bytes(),b'sentinel')
    def test_export_duplicate_refused(self):
        with self.assertRaises(m.Rejected):self.export(['README.md','README.md'])
    def test_export_large_file_refused(self):
        self.write('huge.txt',b'X'*(m.MAX_BYTES+1))
        with self.assertRaises(m.Rejected):self.export(['huge.txt'])
    def test_cli_failure_nonzero_without_secret_output(self):
        self.stage('config.py',"key = '"+'sk-'+'D'*32+"'\n")
        p=subprocess.run([sys.executable,'-S',str(SCRIPT),'--expected-root',str(self.root)],cwd=self.root,capture_output=True,text=True)
        self.assertEqual(p.returncode,1);self.assertNotIn('D'*32,p.stdout+p.stderr)

if __name__=='__main__': unittest.main(verbosity=2)
