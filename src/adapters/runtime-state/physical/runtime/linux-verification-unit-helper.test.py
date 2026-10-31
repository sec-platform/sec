"""Filesystem cases and separately supervised root/systemd integrations."""
import errno
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_helper', Path(__file__).with_name('linux-verification-unit-helper.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def fixture_request_write(namespace, request):
    # Persist the recovery identity before spawning, and the receipt before ack.
    fd = helper.nofollow_directory(str(namespace))
    try:
        info = os.fstat(fd)
        if (str(info.st_dev), str(info.st_ino)) != (request['recoveryRoot']['device'], request['recoveryRoot']['inode']):
            raise RuntimeError('native fixture namespace replaced before request write')
        helper.write_bytes('/proc/self/fd/' + str(fd) + '/fixture-request.pending', helper.canonical(request), 0o600)
        os.replace('fixture-request.pending', 'fixture-request.json', src_dir_fd=fd, dst_dir_fd=fd)
        helper.fsync_directory(fd)
    finally:
        os.close(fd)


def fixture_readback(request, deadline):
    name = request['unitName']
    early = 'sec-native-' + helper.sha((name + ':early-exit').encode())[7:39] + '.service'
    for unit in [name[:-len('.service')] + '-control.scope', early, name]:
        properties = helper.unit_readback(unit, deadline)
        if (properties['LoadState'] != 'not-found' and properties['ActiveState'] not in ('inactive', 'failed')):
            raise RuntimeError('native fixture unit still active: ' + unit)
        if not helper.cgroup_empty({'cgroupPath': '/system.slice/' + unit}):
            raise RuntimeError('native fixture cgroup still populated: ' + unit)


def settle_fixture(namespace, identity, *, retire):
    """Cleanup-only entry usable after the test process has been killed/reaped."""
    fd = helper.nofollow_directory(str(namespace))
    original = (helper.CLEANUP_MODE, helper.TOOL_PROCESSES, helper.MAX_TOOL_PROCESSES)
    try:
        info = os.fstat(fd)
        if (str(info.st_dev), str(info.st_ino)) != identity:
            raise RuntimeError('native fixture namespace replaced: ' + str(namespace))
        if 'fixture-request.json' not in os.listdir(fd):
            if os.listdir(fd):
                raise RuntimeError('native fixture request unavailable: ' + str(namespace))
        else:
            request_fd = os.open('fixture-request.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                saved = os.fstat(request_fd)
                if not stat.S_ISREG(saved.st_mode) or saved.st_uid != 0 or saved.st_nlink != 1 or stat.S_IMODE(saved.st_mode) != 0o600:
                    raise RuntimeError('native fixture request identity unavailable')
                data = os.read(request_fd, 65537)
                if len(data) > 65536:
                    raise RuntimeError('native fixture request exceeds bound')
                request = json.loads(data, object_pairs_hook=helper.no_duplicates)
            finally:
                os.close(request_fd)
            if request['recoveryRoot'] != {'path': str(namespace), 'device': identity[0], 'inode': identity[1]}:
                raise RuntimeError('native fixture request root mismatch')
            helper.CLEANUP_MODE, helper.TOOL_PROCESSES, helper.MAX_TOOL_PROCESSES = True, 0, 32
            deadline = helper.Deadline(int(time.time() * 1000) + 30000)
            request = {**request, 'deadlineAtUnixMs': int(deadline.absolute * 1000)}
            if request['terminalReceiptDigest'] is None:
                result = helper.recover({**request, 'mode': 'recover'}, deadline)
                fixture_readback(request, deadline)
                request = {**request, 'mode': 'acknowledge', 'terminalReceiptDigest': helper.sha(helper.canonical(result))}
                fixture_request_write(namespace, request)
            # Original recover validates the durable receipt, identities and lock;
            # it also handles interruption after record retirement idempotently.
            helper.recover({**request, 'mode': 'acknowledge'}, deadline)
            fixture_readback(request, deadline)
            if set(os.listdir(fd)) != {'fixture-request.json'}:
                raise RuntimeError('native fixture unknown residue: ' + str(namespace))
            if retire:
                os.unlink('fixture-request.json', dir_fd=fd)
                helper.fsync_directory(fd)
        if retire:
            observed = namespace.lstat()
            if (observed.st_dev, observed.st_ino) != (info.st_dev, info.st_ino):
                raise RuntimeError('native fixture namespace replaced before retirement')
            namespace.rmdir()
    finally:
        helper.CLEANUP_MODE, helper.TOOL_PROCESSES, helper.MAX_TOOL_PROCESSES = original
        os.close(fd)


class NativeRecoveryIntegration(unittest.TestCase):
    @unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0 and Path('/proc/1/comm').read_text().strip() == 'systemd', 'requires root and the real systemd manager')
    def test_namespace_init_reaps_adopted_children_and_preserves_main_status(self):
        workload = r'''
import os,sys,time
assert os.getppid()==1
deadline=time.monotonic()+15
for iteration in range(300):
    reader,writer=os.pipe()
    child=os.fork()
    if child==0:
        os.close(reader)
        grandchild=os.fork()
        if grandchild==0:
            while os.getppid()!=1:
                if time.monotonic()>=deadline: os._exit(90)
                time.sleep(.001)
            os.write(writer,str(os.getpid()).encode());os.close(writer);os._exit(0)
        os._exit(0)
    os.close(writer)
    _,status=os.waitpid(child,0)
    assert status==0
    adopted=int(os.read(reader,32));os.close(reader)
    while os.path.exists('/proc/'+str(adopted)):
        if time.monotonic()>=deadline: raise RuntimeError('adopted-child-not-reaped:'+str(adopted))
        time.sleep(.001)
print('reaped:300',flush=True)
sys.exit(23)
'''
        for source, expected, stdout in [(workload, 23, b'reaped:300\n'),
                                         ('import os,signal;os.kill(os.getpid(),signal.SIGKILL)', 137, b'')]:
            with self.subTest(exitCode=expected):
                program = helper.NAMESPACE_INIT_PROGRAM + '\nnamespace_init(' + repr([sys.executable, '-I', '-S', '-c', source]) + ')\n'
                process = subprocess.Popen(['/usr/bin/unshare', '--fork', '--pid', '--mount-proc', '--kill-child=KILL', '--',
                                            sys.executable, '-I', '-S', '-u', '-c', program],
                                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=helper.FIXED_ENV)
                try:
                    actual, stderr = process.communicate(timeout=20)
                    self.assertEqual(process.returncode, expected, stderr.decode(errors='replace'))
                    self.assertEqual(actual, stdout, stderr.decode(errors='replace'))
                finally:
                    primary_error = sys.exc_info()[1]
                    try:
                        if process.poll() is None:
                            process.kill()
                        process.communicate(timeout=5)
                    except BaseException as error:
                        if primary_error is not None:
                            raise BaseExceptionGroup('namespace workload and child reap failed', [primary_error, error])
                        raise

    @unittest.skipUnless(sys.platform == 'linux' and os.geteuid() == 0 and Path('/proc/1/comm').read_text().strip() == 'systemd', 'requires root and the real systemd manager')
    def test_original_control_and_unobserved_workload_are_recovered(self):
        supplied = os.environ.get('SEC_NATIVE_RECOVERY_FIXTURE')
        namespace = Path(supplied or tempfile.mkdtemp(prefix='sec-native-recovery-integration-'))
        info = namespace.stat()
        identity = (str(info.st_dev), str(info.st_ino))
        if supplied:
            self.assertEqual(identity, (os.environ['SEC_NATIVE_RECOVERY_FIXTURE_DEVICE'], os.environ['SEC_NATIVE_RECOVERY_FIXTURE_INODE']))
        self.assertEqual(list(namespace.iterdir()), [])
        binding = helper.sha(os.urandom(32))
        name = 'sec-native-' + binding[7:39] + '.service'
        request = {'mode': 'recover', 'unitName': name, 'operationIdentityDigest': binding, 'boundAttemptDigest': binding,
                   'inputDigest': binding, 'invocationDigest': binding, 'deadlineAtUnixMs': int(time.time() * 1000) + 45000,
                   'recoveryRoot': {'path': str(namespace), 'device': str(info.st_dev), 'inode': str(info.st_ino)}, 'terminalReceiptDigest': None}
        fixture_request_write(namespace, request)
        deadline = helper.Deadline(request['deadlineAtUnixMs'])
        scope = name[:-len('.service')] + '-control.scope'
        description = 'sec-native-control:' + ':'.join([binding] * 3)
        worker = r'''
import importlib.util,json,os,subprocess,sys,time
spec=importlib.util.spec_from_file_location('actual_helper',sys.argv[1]); h=importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
r=json.loads(sys.argv[2]); d=h.Deadline(r['deadlineAtUnixMs'])
if h.LIBC.unshare(0x00020000)!=0: raise OSError('private-test-mount-namespace')
h.mount(None,'/',None,0x40000|0x4000,None)
control=h.original_control(r,d); record=h.RecoveryRecord(r,'run',control)
try:
    for leaf in ['rootfs','control','output']:
        path=record.path+'/'+leaf; os.mkdir(path,0o755); h.mount('tmpfs',path,'tmpfs',2|4,'size=1M,mode=0755')
    token='sec-native-recovery-test:'+os.urandom(32).hex()
    record.update({**record.value,'phase':'unit-starting','activeUnitName':r['unitName'],'description':token,'manager':h.manager_identity(),'unit':None})
    args=['/usr/bin/systemd-run','--quiet','--no-ask-password','--unit='+r['unitName'],'--service-type=exec','--remain-after-exit',
          '--property=Description='+token,'--property=BindsTo='+control['name'],'--property=After='+control['name'],
          '--property=CollectMode=inactive-or-failed','--property=SuccessExitStatus='+' '.join(map(str,range(256))),
          '--property=KillMode=control-group','--property=RuntimeMaxSec=45s','--',sys.executable,'-I','-S','-c','import time;time.sleep(45)']
    streams=h.BoundedStreams(record,{'maxStdoutBytes':4096,'maxStderrBytes':4096})
    early_name='sec-native-'+h.sha((r['unitName']+':early-exit').encode())[7:39]+'.service'
    early_request={**r,'unitName':early_name}
    record.update({**record.value,'activeUnitName':early_name})
    gate_fd=h.nofollow_directory(record.path+'/control')
    gate='/proc/'+str(os.getpid())+'/fd/'+str(gate_fd)+'/early-admit'
    early_code=('import sys,time;gate='+repr(gate)+';deadline='+repr(r['deadlineAtUnixMs']/1000)
                +'\nwhile True:\n'
                +'    try:\n'
                +'        with open(gate,"rb") as stream: admitted=stream.read(64)\n'
                +'    except FileNotFoundError:\n'
                +'        if time.time()>=deadline: sys.exit(91)\n'
                +'        time.sleep(.01);continue\n'
                +'    if admitted!=b"allow-native-early-exit": sys.exit(92)\n'
                +'    break\n'
                +'sys.stderr.buffer.write(bytes(range(256))*4+b"fixture early failure\\n");sys.exit(23)')
    early=args[:-1]+[early_code]
    early[early.index('--unit='+r['unitName'])]='--unit='+early_name
    early.insert(early.index('--'),'--property=StandardError=file:'+record.path+'/stderr')
    code,out,err=h.run_tool(early,d)
    if code: raise RuntimeError('native-test-early-exec-failed')
    properties=h.unit_readback(early_name,d)
    if properties['MainPID']=='0': raise RuntimeError('native-test-initial-alive-not-observed')
    unit=h.accepted_unit(early_name,properties,token,h.manager_identity())
    record.update({**record.value,'phase':'unit-accepted','unit':unit})
    h.write_bytes(gate+'.pending',b'allow-native-early-exit',0o400)
    os.rename('early-admit.pending','early-admit',src_dir_fd=gate_fd,dst_dir_fd=gate_fd)
    pidfds=[]
    try: h.wait_preflight_ready(early_request,record,properties,unit,token,streams,d,d,pidfds)
    except h.NativeFailure as error:
        diagnostic=error.projection(); expected=bytes(range(256))*4+b'fixture early failure\n'
        if (diagnostic['message'].split('\n',1)[0]!='native-preflight-exited' or diagnostic['unitName']!=early_name or diagnostic['execMainStatus']!=23
                or diagnostic['exitCode']!=23 or not diagnostic['stderrComplete'] or diagnostic['qualification']!='not-issued'
                or h.base64.b64decode(diagnostic['stderrBase64'],validate=True)!=expected or diagnostic['stderrBytes']!=len(expected)
                or diagnostic['stderrDigest']!=h.sha(expected) or len(h.canonical(diagnostic))<=512): raise
    else: raise RuntimeError('native-test-early-failure-was-accepted')
    finally:
        streams.close()
        for fd in pidfds: os.close(fd)
        os.unlink('early-admit',dir_fd=gate_fd)
        os.close(gate_fd)
    for leaf in ['stdout','stderr']: os.unlink(record.path+'/'+leaf)
    subprocess.Popen([sys.executable,'-I','-S','-c','import time;time.sleep(45)'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,close_fds=True,start_new_session=True,env=h.FIXED_ENV)
    record.update({**record.value,'phase':'unit-starting','activeUnitName':r['unitName'],'unit':None})
    code,out,err=h.run_tool(args,d)
    if code: raise RuntimeError('native-test-workload-start-failed')
    active=h.unit_readback(r['unitName'],d)
    try: h.accepted_unit(r['unitName'],active,token+'-foreign',h.manager_identity())
    except h.Unavailable: pass
    else: raise RuntimeError('native-test-live-identity-conflict-accepted')
    print('original-helper-failed-with-owned-resources',flush=True)
finally: record.close()
sys.exit(1)
'''
        process = None
        original = (helper.CLEANUP_MODE, helper.TOOL_PROCESSES, helper.MAX_TOOL_PROCESSES)
        locator = namespace / name[:-len('.service')]
        try:
            process = subprocess.Popen(['/usr/bin/systemd-run', '--scope', '--quiet', '--unit=' + scope, '--slice=system.slice', '--description=' + description,
                                        '--property=CPUQuota=200%', '--property=CPUQuotaPeriodSec=100ms', '--property=MemoryMax=4294967296', '--property=TasksMax=256',
                                        '--property=KillMode=control-group', '--property=SendSIGKILL=yes', '--property=TimeoutStopSec=5s', '--property=RuntimeMaxSec=45s',
                                        '--', '/usr/bin/python3.12', '-I', '-S', '-u', '-c', worker, str(Path(helper.__file__).resolve()), json.dumps(request)],
                                       stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=helper.FIXED_ENV)
            stdout, stderr = process.communicate(timeout=deadline.remaining())
            self.assertEqual(process.returncode, 1, stderr.decode(errors='replace'))
            self.assertEqual(stdout.strip(), b'original-helper-failed-with-owned-resources', stderr.decode(errors='replace'))
            helper.CLEANUP_MODE, helper.TOOL_PROCESSES, helper.MAX_TOOL_PROCESSES = True, 0, 32
            self.assertFalse(helper.cgroup_empty({'cgroupPath': '/system.slice/' + scope}))
            self.assertEqual(helper.unit_readback(name, deadline)['ActiveState'], 'active')
            result = helper.recover(request, deadline)
            self.assertEqual(result['qualification'], 'not-issued')
            for unit in [scope, name]:
                self.assertTrue(helper.cgroup_empty({'cgroupPath': '/system.slice/' + unit}))
                self.assertIn(helper.unit_readback(unit, deadline)['ActiveState'], ['inactive', 'failed'])
            self.assertEqual(set(p.name for p in locator.iterdir()), {'record.json', 'lock'})
            fixture_readback(request, deadline)
            request = {**request, 'mode': 'acknowledge', 'terminalReceiptDigest': helper.sha(helper.canonical(result))}
            fixture_request_write(namespace, request)
            helper.recover(request, deadline)
            self.assertFalse(locator.exists())
        finally:
            errors = []
            primary_error = sys.exc_info()[1]
            try:
                settle_fixture(namespace, identity, retire=not supplied)
            except BaseException as error:
                errors.append(error)
            try:
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                    process.communicate(timeout=5)
            except BaseException as error:
                errors.append(error)
            helper.CLEANUP_MODE, helper.TOOL_PROCESSES, helper.MAX_TOOL_PROCESSES = original
            if errors:
                if primary_error is not None:
                    errors.insert(0, primary_error)
                raise BaseExceptionGroup('native fixture requires original-owner recovery: ' + str(namespace), errors)


class RuntimeCopyPermissions(unittest.TestCase):
    def test_temporary_snapshot_uses_retained_filesystem_after_path_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            temporary = root / 'tmp'
            temporary.mkdir()
            original = temporary.stat()
            fd = helper.nofollow_directory(str(temporary))
            try:
                temporary.rename(root / 'retained')
                temporary.mkdir()
                snapshot = helper.temporary_filesystem_snapshot(fd)
                self.assertEqual((snapshot['device'], snapshot['inode']), (str(original.st_dev), str(original.st_ino)))
                self.assertNotEqual(snapshot['inode'], str(temporary.stat().st_ino))
                self.assertGreater(snapshot['bytesTotal'], 0)
                self.assertGreaterEqual(snapshot['bytesTotal'], snapshot['bytesFree'])
                self.assertGreaterEqual(snapshot['bytesFree'], snapshot['bytesAvailable'])
                self.assertGreaterEqual(snapshot['inodesTotal'], snapshot['inodesFree'])
                self.assertGreaterEqual(snapshot['inodesFree'], snapshot['inodesAvailable'])
                (root / 'retained' / 'pids.current').write_bytes(b'7\n')
                (root / 'retained' / 'pids.events').write_bytes(b'max 3\n')
                (root / 'retained' / 'memory.current').write_bytes(b'1' * 4097)
                (temporary / 'pids.current').write_bytes(b'999\n')
                resources = helper.cgroup_resource_snapshot(fd, '/original-unit')
                self.assertEqual(resources['inode'], str(original.st_ino))
                self.assertEqual(resources['pids.current'], '7\n')
                self.assertEqual(resources['pids.events'], 'max 3\n')
                self.assertIn('cgroup-diagnostic-read-bound', resources['memory.current']['unavailable'])
                self.assertIn('unavailable', resources['memory.events'])
            finally:
                os.close(fd)
            with self.assertRaises(OSError) as closed:
                helper.temporary_filesystem_snapshot(fd)
            self.assertEqual(closed.exception.errno, errno.EBADF)
            unavailable = helper.cgroup_resource_snapshot(fd, '/original-unit')
            self.assertIn('identityUnavailable', unavailable)
            self.assertTrue(all('unavailable' in unavailable[name] for name in ['pids.current', 'pids.events', 'memory.current', 'memory.events']))

    def test_recovery_removes_only_original_fixed_empty_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ['rootfs', 'control', 'output']:
                (root / name).mkdir(mode=0o755)
            for name in ['stdout', 'stderr']:
                os.mkfifo(root / name, 0o600)
            helper.write_bytes(str(root / 'stdin'), b'private input', 0o400)
            (root / 'record.json').write_bytes(b'original record')
            (root / 'lock').write_bytes(b'')
            fd = helper.nofollow_directory(directory)
            try:
                recovery = SimpleNamespace(fd=fd)
                # Root is the real producer/retirement owner. Nonroot runs
                # cannot turn this filesystem test into privilege evidence.
                if os.getuid() != 0:
                    with self.assertRaisesRegex(helper.Unavailable, 'owner-or-mount'):
                        helper.cleanup_original_files(recovery)
                    self.assertTrue((root / 'stdin').exists())
                    return
                (root / 'unexpected').write_bytes(b'must survive')
                before = set(root.iterdir())
                with self.assertRaisesRegex(helper.Unavailable, 'unknown-original'):
                    helper.cleanup_original_files(recovery)
                self.assertEqual(set(root.iterdir()), before)
                (root / 'unexpected').unlink()
                (root / 'rootfs' / 'foreign').write_bytes(b'must survive')
                with self.assertRaisesRegex(helper.Unavailable, 'not-empty'):
                    helper.cleanup_original_files(recovery)
                self.assertTrue((root / 'stdin').exists())
                self.assertEqual((root / 'rootfs' / 'foreign').read_bytes(), b'must survive')
                (root / 'rootfs' / 'foreign').unlink()
                helper.cleanup_original_files(recovery)
                self.assertEqual(set(os.listdir(fd)), {'record.json', 'lock'})
                helper.cleanup_original_files(recovery)
                self.assertEqual((root / 'record.json').read_bytes(), b'original record')
            finally:
                os.close(fd)

    def test_cleanup_denies_non_control_processes_before_spawn(self):
        with patch.object(helper, 'CLEANUP_MODE', True), patch.object(helper.subprocess, 'Popen') as spawn:
            for argv in [['/usr/bin/git', '--version'], ['/usr/bin/systemctl', '--no-ask-password', 'start', '--', 'sec-native-' + '0' * 32 + '.service'],
                         ['/usr/bin/systemctl', '--no-ask-password', 'stop', '--', 'unrelated.service']]:
                with self.assertRaisesRegex(helper.Unavailable, 'cleanup-control-command-denied'):
                    helper.run_tool(argv, helper.Deadline((time.time() + 5) * 1000))
            spawn.assert_not_called()

    def fixture(self, root):
        source, target = root / 'source', root / 'target'
        source.mkdir()
        target.mkdir()
        (source / 'usr').mkdir()
        (source / 'usr' / 'tool').write_bytes(b'accepted bytes\n')
        (source / 'usr' / 'data').write_bytes(b'readable data\n')
        os.chmod(source / 'usr', 0o755)
        os.chmod(source / 'usr' / 'tool', 0o755)
        os.chmod(source / 'usr' / 'data', 0o644)
        entries = [{'path': 'usr', 'type': 'directory', 'mode': 0o755}]
        for name in ['data', 'tool']:
            file = source / 'usr' / name
            entries.append({'path': 'usr/' + name, 'type': 'file', 'mode': stat.S_IMODE(file.stat().st_mode),
                            'size': file.stat().st_size, 'digest': helper.sha(file.read_bytes())})
        manifest = {'files': entries}
        info = source.stat()
        request = {'runtime': {'manifest': manifest, 'manifestDigest': helper.sha(helper.canonical(manifest)),
                              'root': {'path': str(source), 'device': str(info.st_dev), 'inode': str(info.st_ino)}}}
        return source, target, request

    def copy(self, request, target):
        helper.copy_runtime(request, str(target), helper.Deadline((time.time() + 5) * 1000))

    def test_copy_preserves_declared_modes_and_source_for_each_umask(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                source, target, request = self.fixture(Path(directory))
                before = {p: (p.stat(), p.read_bytes() if p.is_file() else None) for p in source.rglob('*')}
                previous = os.umask(mask)
                try:
                    self.copy(request, target)
                    parent = helper.nofollow_directory(str(target))
                    try:
                        helper.create_runtime_directory(parent, 'sec-runtime', 0o755)
                    finally:
                        os.close(parent)
                finally:
                    os.umask(previous)
                for entry in request['runtime']['manifest']['files']:
                    copied = target / entry['path']
                    self.assertEqual(stat.S_IMODE(copied.stat().st_mode), entry['mode'])
                    if entry['type'] == 'file':
                        self.assertEqual(copied.read_bytes(), (source / entry['path']).read_bytes())
                        self.assertEqual(copied.stat().st_nlink, 1)
                self.assertEqual(stat.S_IMODE((target / 'sec-runtime').stat().st_mode), 0o755)
                for file, (info, contents) in before.items():
                    after = file.stat()
                    self.assertEqual((after.st_dev, after.st_ino, after.st_mode, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                                     (info.st_dev, info.st_ino, info.st_mode, info.st_size, info.st_mtime_ns, info.st_ctime_ns))
                    if contents is not None:
                        self.assertEqual(file.read_bytes(), contents)

    def test_source_symlink_hardlink_and_wrong_digest_still_fail(self):
        for fault in ['symlink', 'hardlink', 'digest']:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                source, target, request = self.fixture(Path(directory))
                file = source / 'usr' / 'tool'
                if fault == 'symlink':
                    file.unlink()
                    file.symlink_to('data')
                elif fault == 'hardlink':
                    os.link(file, source / 'duplicate')
                else:
                    request['runtime']['manifest']['files'][-1]['digest'] = 'sha256:' + '0' * 64
                    request['runtime']['manifestDigest'] = helper.sha(helper.canonical(request['runtime']['manifest']))
                with self.assertRaises((OSError, helper.Unavailable)):
                    self.copy(request, target)

    def test_control_bytes_have_exact_modes_without_changing_caller_umask(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                previous = os.umask(mask)
                try:
                    for name, mode in [('launch.json', 0o444), ('admit', 0o444), ('stdin', 0o400), ('manifest', 0o644)]:
                        file = Path(directory) / name
                        helper.write_bytes(str(file), b'exact payload', mode)
                        self.assertEqual(stat.S_IMODE(file.stat().st_mode), mode)
                        self.assertEqual(file.read_bytes(), b'exact payload')
                    self.assertEqual(os.umask(mask), mask)
                finally:
                    os.umask(previous)

    def test_private_git_checkout_modes_are_independent_of_caller_umask(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'repository'
            source.mkdir()
            def git(*args):
                return subprocess.run(['/usr/bin/git', '-C', str(source), *args], check=True, capture_output=True, env=helper.FIXED_ENV).stdout.decode().strip()
            git('init', '--quiet')
            (source / 'nested').mkdir()
            (source / 'nested' / 'package.json').write_bytes(b'{}\n')
            (source / 'tool').write_bytes(b'#!/bin/sh\nexit 0\n')
            os.chmod(source / 'tool', 0o755)
            git('add', '.')
            git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture')
            commit = git('rev-parse', 'HEAD')
            git('update-ref', 'refs/sec/base', commit)
            git('update-ref', 'refs/sec/head', commit)
            bundle = str(root / 'input.bundle')
            git('bundle', 'create', bundle, 'refs/sec/base', 'refs/sec/head')
            for mask in [0o077, 0o027, 0o022]:
                with self.subTest(umask=oct(mask)):
                    target = root / ('checkout-' + str(mask))
                    previous = os.umask(mask)
                    try:
                        helper.materialize_git({'bundle': {'baseSha': commit}}, str(target), bundle, helper.Deadline((time.time() + 5) * 1000))
                        helper.git(str(target), ['checkout', '--quiet', '--detach', commit], helper.Deadline((time.time() + 5) * 1000))
                        self.assertEqual(os.umask(mask), mask)
                    finally:
                        os.umask(previous)
                    for relative, mode in [('.', 0o755), ('nested', 0o755), ('nested/package.json', 0o644), ('tool', 0o755), ('.git', 0o755)]:
                        self.assertEqual(stat.S_IMODE((target / relative).stat().st_mode), mode)
                    self.assertEqual((target / 'nested' / 'package.json').read_bytes(), b'{}\n')

    def test_hosted_output_is_separate_and_retained_only_for_the_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            output = str(Path(directory))
            state = Path(directory) / 'state'
            state.mkdir(mode=0o700)
            (state / 'record').write_bytes(b'setup state')
            identity = state.stat()
            parent = helper.nofollow_directory(output)
            helper.MOUNT_HANDLES[output] = parent
            try:
                with helper.final_output_directory({'kind': 'source-program'}, output) as regular:
                    self.assertEqual(regular, output)
                with helper.final_output_directory({'kind': 'hosted-sut'}, output) as final:
                    self.assertNotEqual(final, output)
                    retained = helper.MOUNT_HANDLES[final]
                    info = os.fstat(retained)
                    self.assertEqual((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)), (os.geteuid(), os.getegid(), 0o700))
                    self.assertEqual(list(Path(final).iterdir()), [])
                    helper.write_bytes(final + '/result', b'final bytes')
                    self.assertEqual((Path(final) / 'result').read_bytes(), b'final bytes')
                self.assertNotIn(final, helper.MOUNT_HANDLES)
                with self.assertRaises(OSError):
                    os.fstat(retained)
                self.assertEqual(state.stat().st_ino, identity.st_ino)
                self.assertEqual(stat.S_IMODE(state.stat().st_mode), 0o700)
                self.assertEqual((state / 'record').read_bytes(), b'setup state')
                with self.assertRaisesRegex(RuntimeError, 'launch failed'):
                    with helper.final_output_directory({'kind': 'hosted-sut'}, output) as interrupted:
                        interrupted_fd = helper.MOUNT_HANDLES[interrupted]
                        raise RuntimeError('launch failed')
                self.assertNotIn(interrupted, helper.MOUNT_HANDLES)
                with self.assertRaises(OSError):
                    os.fstat(interrupted_fd)
            finally:
                del helper.MOUNT_HANDLES[output]
                os.close(parent)

    def test_fixed_child_mask_is_observed_before_workload_admission(self):
        # Execute the actual preflight prefix in a fresh child, without its
        # later privileged unit operations. It reads the kernel's own status.
        prefix = helper.LAUNCH_SHIM.split('# Invalid arguments', 1)[0]
        for mask, accepted in [(0o022, True), (0o077, False), (0o027, False)]:
            child = subprocess.run([sys.executable, '-B', '-I', '-S', '-c', prefix], capture_output=True, umask=mask)
            self.assertEqual(child.returncode == 0, accepted)
        for mask in ['0077', '0027']:
            with self.assertRaisesRegex(helper.Unavailable, 'unit-creation-mask'):
                helper.observe_start({'unitName': 'fixture.service'}, {'UMask': mask}, '/unused', '/unused', {})

    def test_dependency_staging_ancestors_are_traversable_without_changing_existing_state(self):
        for mask in [0o077, 0o027, 0o022]:
            with self.subTest(umask=oct(mask)), tempfile.TemporaryDirectory() as directory:
                previous = os.umask(mask)
                try:
                    helper.prepare_dependency_namespace(directory)
                finally:
                    os.umask(previous)
                paths = [Path(directory) / p for p in ['.tmp', '.tmp/dependency-installs', '.tmp/dependency-installs/compiler-backups']]
                before = [(p.stat().st_ino, p.stat().st_ctime_ns) for p in paths]
                helper.prepare_dependency_namespace(directory)
                self.assertEqual([(p.stat().st_ino, p.stat().st_ctime_ns) for p in paths], before)
                self.assertEqual([stat.S_IMODE(p.stat().st_mode) for p in paths], [0o755] * 3)
                os.chmod(paths[-1], 0o700)
                with self.assertRaisesRegex(helper.Unavailable, 'dependency-staging-ancestor'):
                    helper.prepare_dependency_namespace(directory)
                self.assertEqual(stat.S_IMODE(paths[-1].stat().st_mode), 0o700)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / 'external'
            external.mkdir(mode=0o700)
            (root / '.tmp').symlink_to(external, target_is_directory=True)
            with self.assertRaises(OSError):
                helper.prepare_dependency_namespace(directory)
            self.assertEqual(list(external.iterdir()), [])

    def test_new_directory_replacement_link_fails_without_changing_external_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            external = root / 'external'
            external.mkdir(mode=0o700)
            parent = helper.nofollow_directory(str(root))
            original = os.mkdir
            def replace_after_create(name, mode, *, dir_fd):
                original(name, mode, dir_fd=dir_fd)
                os.rmdir(name, dir_fd=dir_fd)
                os.symlink(str(external), name, dir_fd=dir_fd)
            try:
                with patch.object(helper.os, 'mkdir', replace_after_create):
                    with self.assertRaises(OSError):
                        helper.create_runtime_directory(parent, 'new', 0o755)
                self.assertEqual(stat.S_IMODE(external.stat().st_mode), 0o700)
            finally:
                os.close(parent)


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--recover-fixture':
        settle_fixture(Path(sys.argv[2]), (sys.argv[3], sys.argv[4]), retire=True)
    else:
        unittest.main()
