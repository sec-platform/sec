#!/usr/bin/python3
"""Fixed native manager bridge. It never observes or replaces SUT ptrace logic.

Only the retained TypeScript owner executes these exact bytes with -I -S.
Inputs are bounded transport, never Python/shell source or arbitrary root argv.
The existing hosted SUT entry and Python supervisor own inner execution.
"""
import base64
import ctypes
import contextlib
import errno
import fcntl
import hashlib
import json
import os
import re
import select
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import time
import traceback

LIBC = ctypes.CDLL(None, use_errno=True)
LIBC.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_char_p]
LIBC.umount2.argtypes = [ctypes.c_char_p, ctypes.c_int]
LIBC.setfsuid.argtypes = [ctypes.c_uint]
LIBC.setfsuid.restype = ctypes.c_uint
LIBC.setfsgid.argtypes = [ctypes.c_uint]
LIBC.setfsgid.restype = ctypes.c_uint
MAX_REQUEST = 8 * 1024 * 1024
MAX_SNAPSHOT = 4 * 1024 * 1024 * 1024
MAX_ENTRIES = 200000
DIGEST = re.compile(r'^sha256:[0-9a-f]{64}$')
FIXED_ENV = {'PATH': '', 'HOME': '/', 'LANG': 'C', 'LC_ALL': 'C', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
TOOL_PROCESSES = 0
MAX_TOOL_PROCESSES = 64
CLEANUP_MODE = False
PRIVATE_ROOT_ANCHOR = None
PRIVATE_ROOT_FD = None
MOUNT_HANDLES = {}

ROOT_CAPABILITIES = 'CAP_CHOWN CAP_SETGID CAP_SETPCAP CAP_SETUID CAP_SYS_ADMIN CAP_SYS_CHROOT'
NAMESPACE_CAPABILITIES = 'CAP_SETGID CAP_SETPCAP CAP_SETUID CAP_SYS_ADMIN'

def reserve_processes(count=1):
    global TOOL_PROCESSES
    TOOL_PROCESSES += count
    if TOOL_PROCESSES > MAX_TOOL_PROCESSES:
        raise Unavailable('control-process-budget')


class Unavailable(RuntimeError):
    pass


class NativeFailure(Unavailable):
    """Failure transport for this fixed native boundary; never a qualification."""
    def __init__(self, message, *, phase, unit_name=None, exit_code=None, exec_main_code=None, exec_main_status=None, stderr=b'', stderr_complete=False, error_type=None):
        super().__init__(message)
        self.phase, self.unit_name = phase, unit_name
        self.exit_code, self.exec_main_code, self.exec_main_status = exit_code, exec_main_code, exec_main_status
        self.stderr, self.stderr_complete = stderr, stderr_complete
        self.error_type = error_type or type(self).__name__
        self.cleanup_failures = []

    def add_cleanup(self, error):
        self.cleanup_failures.append({'errorType': getattr(error, 'error_type', type(error).__name__), 'message': str(error),
                                      'stderrBase64': base64.b64encode(getattr(error, 'stderr', b'')).decode()})
        self.cleanup_failures.extend(getattr(error, 'cleanup_failures', []))

    def projection(self):
        return {'schema': 'sec-linux-native-unit-failure-v1', 'qualification': 'not-issued', 'phase': self.phase,
                'unitName': self.unit_name, 'errorType': self.error_type, 'message': str(self), 'exitCode': self.exit_code,
                'execMainCode': self.exec_main_code, 'execMainStatus': self.exec_main_status,
                'stderrBase64': base64.b64encode(self.stderr).decode(), 'stderrBytes': len(self.stderr),
                'stderrDigest': sha(self.stderr), 'stderrComplete': self.stderr_complete, 'cleanupFailures': self.cleanup_failures}


def native_failure(error, *, phase, unit_name=None):
    if isinstance(error, NativeFailure):
        if error.unit_name is None:
            error.unit_name = unit_name
        return error
    failure = NativeFailure(str(error), phase=phase, unit_name=unit_name, error_type=type(error).__name__)
    failure.__cause__ = error
    return failure


def sha(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()


def exact(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise Unavailable(label + '-shape')
    return value


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Unavailable('duplicate-json-key')
        result[key] = value
    return result


def bounded_read(file, maximum):
    with open(file, 'rb', buffering=0) as stream:
        value = stream.read(maximum + 1)
    if len(value) > maximum:
        raise Unavailable('read-bound')
    return value


def nofollow_directory(file):
    if not isinstance(file, str) or not file.startswith('/') or os.path.normpath(file) != file:
        raise Unavailable('directory-path')
    if PRIVATE_ROOT_ANCHOR is not None and (file == PRIVATE_ROOT_ANCHOR or file.startswith(PRIVATE_ROOT_ANCHOR + '/')):
        fd = os.dup(PRIVATE_ROOT_FD)
        parts = file[len(PRIVATE_ROOT_ANCHOR):].split('/')
    else:
        fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        parts = file.split('/')[1:]
    try:
        for name in parts:
            if not name:
                continue
            nxt = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd
    except BaseException:
        os.close(fd)
        raise


def ordinary(file, maximum, expected=None):
    parent = nofollow_directory(os.path.dirname(file))
    try:
        fd = os.open(os.path.basename(file), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum or info.st_nlink != 1:
            raise Unavailable('ordinary-input')
        if expected is not None and (str(info.st_dev), str(info.st_ino)) != (expected['device'], expected['inode']):
            raise Unavailable('input-identity')
        return fd, info
    except BaseException:
        os.close(fd)
        raise


def process_start(pid):
    return bounded_read('/proc/' + str(pid) + '/stat', 65536).decode().rsplit(') ', 1)[1].split()[19]


def fsync_directory(fd):
    os.fsync(fd)


class Deadline:
    def __init__(self, absolute):
        self.absolute = absolute / 1000
        self.monotonic = time.monotonic() + self.absolute - time.time()
        if self.remaining() <= 0:
            raise Unavailable('expired')

    def remaining(self):
        remaining = min(self.absolute - time.time(), self.monotonic - time.monotonic())
        if remaining <= 0:
            raise Unavailable('expired')
        return remaining


def run_tool(argv, deadline, maximum=262144, *, creation_umask=-1):
    """Only callers in this fixed program choose executables and argument shapes."""
    if CLEANUP_MODE:
        # Recovery has no source, dependency or workload execution authority.
        fixed = len(argv) >= 5 and argv[:2] == ['/usr/bin/systemctl', '--no-ask-password']
        if not fixed or argv[2] not in ('show', 'stop', 'reset-failed') or argv[-2] != '--' or not re.fullmatch(r'sec-native-[0-9a-f]{32}(?:\.service|-control\.scope)', argv[-1]):
            raise Unavailable('cleanup-control-command-denied')
        expected = (['/usr/bin/systemctl', '--no-ask-password', 'show', '--no-pager', '--property=' + ','.join(UNIT_PROPERTIES if argv[-1].endswith('.service') else CONTROL_PROPERTIES), '--', argv[-1]]
                    if argv[2] == 'show' else ['/usr/bin/systemctl', '--no-ask-password', argv[2], '--', argv[-1]])
        if argv != expected:
            raise Unavailable('cleanup-control-command-denied')
    deadline.remaining()
    reserve_processes()
    deadline.remaining()
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, env=FIXED_ENV, close_fds=True, umask=creation_umask)
    captured = {'stdout': bytearray(), 'stderr': bytearray()}
    failure, result = None, None
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(child.stdout, selectors.EVENT_READ, 'stdout')
            ready.register(child.stderr, selectors.EVENT_READ, 'stderr')
            while ready.get_map():
                for key, _events in ready.select(min(.1, deadline.remaining())):
                    part = os.read(key.fileobj.fileno(), 65536)
                    if not part:
                        ready.unregister(key.fileobj)
                        continue
                    remaining = maximum - sum(map(len, captured.values()))
                    captured[key.data].extend(part[:remaining])
                    if len(part) > remaining:
                        raise Unavailable('platform-output-bound')
        child.wait(timeout=deadline.remaining())
        result = child.returncode, bytes(captured['stdout']), bytes(captured['stderr'])
    except BaseException as error:
        failure = native_failure(error, phase='control-command')
        failure.exit_code = child.returncode
        failure.stderr = bytes(captured['stderr'])
    finally:
        actions = ([child.kill, lambda: child.wait(timeout=1)] if child.returncode is None else []) + [child.stdout.close, child.stderr.close]
        for action in actions:
            try:
                action()
            except BaseException as cleanup:
                if failure is None:
                    failure = native_failure(cleanup, phase='control-cleanup')
                    failure.exit_code = child.returncode
                    failure.stderr = bytes(captured['stderr'])
                    failure.stderr_complete = result is not None
                else:
                    failure.add_cleanup(cleanup)
    if failure is not None:
        raise failure
    return result


def mount(source, target, filesystem, flags, data):
    def encoded(value):
        return None if value is None else os.fsencode(value)
    if LIBC.mount(encoded(source), encoded(target), encoded(filesystem), flags, encoded(data)) != 0:
        raise OSError(ctypes.get_errno(), 'fixed-native-mount-failed')


def unmount(target):
    if LIBC.umount2(os.fsencode(target), 0) != 0:
        raise OSError(ctypes.get_errno(), 'fixed-native-unmount-failed')


class RecoveryRecord:
    """One exact effect locator in the original transient runtime namespace.

    It cannot issue a runtime, dependency, source, SUT or MainHealth qualification.
    Unknown/replaced records are preserved; a new attempt never overwrites them.
    """
    def __init__(self, request, mode, control=None, deadline=None):
        global PRIVATE_ROOT_ANCHOR, PRIVATE_ROOT_FD
        self.name = request['unitName'][:-len('.service')]
        if not re.fullmatch(r'sec-native-[0-9a-f]{32}', self.name):
            raise Unavailable('unit-name')
        namespace = request['recoveryRoot']
        self.path = namespace['path'] + '/' + self.name
        self.parent = nofollow_directory(namespace['path'])
        info = os.fstat(self.parent)
        invoking_uid = int(os.environ.get('SUDO_UID', '0'))
        if (str(info.st_dev), str(info.st_ino)) != (namespace['device'], namespace['inode']) or info.st_uid not in (0, invoking_uid) or stat.S_IMODE(info.st_mode) & 0o022:
            raise Unavailable('original-runtime-namespace-replaced')
        if mode == 'run':
            os.mkdir(self.name, 0o700, dir_fd=self.parent)
            fsync_directory(self.parent)
        self.fd = os.open(self.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=self.parent)
        info = os.fstat(self.fd)
        if info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            raise Unavailable('recovery-root-identity')
        self.physical = {'device': str(info.st_dev), 'inode': str(info.st_ino)}
        # Kernel-retained directory anchor, independent of caller-writable
        # namespace/name substitution for every later privileged path effect.
        self.path = '/proc/' + str(os.getpid()) + '/fd/' + str(self.fd)
        PRIVATE_ROOT_ANCHOR, PRIVATE_ROOT_FD = self.path, self.fd
        self.lock = os.open('lock', os.O_RDWR | (os.O_CREAT if mode == 'run' else 0) | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        lock = os.fstat(self.lock)
        if lock.st_uid != 0 or lock.st_nlink != 1 or not stat.S_ISREG(lock.st_mode):
            raise Unavailable('recovery-lock-identity')
        original_control_identity = None
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if mode == 'run' or deadline is None:
                raise
            # Read only immutable control ownership before lock acquisition.
            # Stopping that exact domain settles its original writer; mutable
            # workload state is consumed only after reacquiring and rereading.
            observed = self.read_original_record(request)
            original_control_identity = recorded_control(request, observed)
            settle_unit({**request, 'unitName': original_control_identity['name']}, original_control_identity, original_control_identity['description'], deadline)
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.value = None
        if mode == 'run':
            self.update({'schema': 'sec-native-unit-recovery-v1', 'phase': 'intent',
                         'operationIdentityDigest': request['operationIdentityDigest'],
                         'boundAttemptDigest': request['boundAttemptDigest'], 'inputDigest': request['inputDigest'],
                         'invocationDigest': request['invocationDigest'], 'deadlineAtUnixMs': request['deadlineAtUnixMs'],
                         'unitName': request['unitName'], 'runtimeRoot': self.physical,
                         'helperPid': os.getpid(), 'helperStartTime': process_start(os.getpid()),
                         'control': control, 'unit': None})
        else:
            self.value = self.read_original_record(request)
            if original_control_identity is not None and recorded_control(request, self.value) != original_control_identity:
                raise Unavailable('original-control-identity-changed')

    def read_original_record(self, request):
        fd = os.open('record.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
        try:
            current = os.fstat(fd)
            if current.st_uid != 0 or current.st_nlink != 1 or not stat.S_ISREG(current.st_mode) or current.st_size > 65536:
                raise Unavailable('recovery-record-identity')
            raw = os.read(fd, 65537)
        finally:
            os.close(fd)
        value = json.loads(raw, object_pairs_hook=no_duplicates)
        if canonical(value) + b'\n' != raw or value['schema'] != 'sec-native-unit-recovery-v1' or value['runtimeRoot'] != self.physical:
            raise Unavailable('recovery-record-bytes')
        for key in ['operationIdentityDigest', 'boundAttemptDigest', 'inputDigest', 'invocationDigest', 'unitName']:
            if value[key] != request[key]:
                raise Unavailable('recovery-transplant')
        return value

    def update(self, value):
        raw = canonical(value) + b'\n'
        if len(raw) > 65536:
            raise Unavailable('recovery-bound')
        if self.value is not None:
            old = os.open('record.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.fd)
            try:
                if os.read(old, 65537) != canonical(self.value) + b'\n':
                    raise Unavailable('recovery-drift')
            finally:
                os.close(old)
        # A pre-rename crash leaves an uncommitted next file. Never infer its
        # effect or overwrite it: retain the exact cut for operator recovery.
        fd = os.open('record.next', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        try:
            os.write(fd, raw)
            os.fsync(fd)
        finally:
            os.close(fd)
        os.rename('record.next', 'record.json', src_dir_fd=self.fd, dst_dir_fd=self.fd)
        fsync_directory(self.fd)
        self.value = value

    def retire(self):
        if self.value['phase'] != 'terminal':
            raise Unavailable('nonterminal-recovery-retirement')
        # All directory names are fixed owner-created objects, never request paths.
        if set(os.listdir(self.fd)) != {'record.json', 'lock'}:
            raise Unavailable('recovery-root-residue')
        os.unlink('record.json', dir_fd=self.fd)
        os.unlink('lock', dir_fd=self.fd)
        fsync_directory(self.fd)
        original = os.fstat(self.fd)
        named = os.stat(self.name, dir_fd=self.parent, follow_symlinks=False)
        if (original.st_dev, original.st_ino) != (named.st_dev, named.st_ino):
            raise Unavailable('recovery-root-replaced')
        os.rmdir(self.name, dir_fd=self.parent)
        fsync_directory(self.parent)

    def close(self):
        os.close(self.lock)
        os.close(self.fd)
        os.close(self.parent)


def canonical_relative(value):
    if not isinstance(value, str) or not value or value.startswith('/') or '\\' in value or '\0' in value:
        raise Unavailable('relative-path')
    if any(part in ('', '.', '..') for part in value.split('/')):
        raise Unavailable('relative-path')
    return value


def relative_parent(root_fd, relative):
    parts = canonical_relative(relative).split('/')
    fd = os.dup(root_fd)
    try:
        for name in parts[:-1]:
            nxt = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = nxt
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def write_all(fd, data):
    view = memoryview(data)
    while view:
        count = os.write(fd, view)
        if count <= 0:
            raise Unavailable('short-write')
        view = view[count:]


def create_runtime_directory(parent, leaf, mode):
    # Only new entries in the private, unpublished runtime are adjusted. A host
    # umask must not silently change the accepted content's permission modes.
    os.mkdir(leaf, 0o700, dir_fd=parent)
    fd = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
    try:
        os.fchmod(fd, mode)
        if stat.S_IMODE(os.fstat(fd).st_mode) != mode:
            raise Unavailable('runtime-directory-mode')
    finally:
        os.close(fd)


@contextlib.contextmanager
def final_output_directory(invocation, output):
    if invocation['kind'] != 'hosted-sut':
        yield output
        return
    # Dependency setup owns its existing state as UID 65532. The final root
    # worker has no DAC override and gets new private output, not that state.
    leaf = 'hosted-' + os.urandom(16).hex()
    create_runtime_directory(MOUNT_HANDLES[output], leaf, 0o700)
    final = output + '/' + leaf
    fd = nofollow_directory(final)
    try:
        info = os.fstat(fd)
        if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (os.geteuid(), os.getegid(), 0o700):
            raise Unavailable('final-output-owner-or-mode')
        MOUNT_HANDLES[final] = fd
        try:
            yield final
        finally:
            del MOUNT_HANDLES[final]
    finally:
        os.close(fd)


def copy_runtime(request, target, deadline):
    manifest = request['runtime']['manifest']
    if sha(canonical(manifest)) != request['runtime']['manifestDigest']:
        raise Unavailable('runtime-manifest-digest')
    source = nofollow_directory(request['runtime']['root']['path'])
    destination_root = nofollow_directory(target)
    try:
        identity = os.fstat(source)
        if (str(identity.st_dev), str(identity.st_ino)) != (request['runtime']['root']['device'], request['runtime']['root']['inode']):
            raise Unavailable('runtime-root-replaced')
        files = manifest['files']
        if not isinstance(files, list) or len(files) > MAX_ENTRIES:
            raise Unavailable('runtime-entry-bound')
        total, seen = 0, set()
        reserved = {'sec-runtime', 'authenticated-input', 'tmp', 'proc', 'dev', 'sys'}
        for entry in sorted(files, key=lambda value: (value['path'].count('/'), value['path'].encode('utf-16-be'))):
            deadline.remaining()
            relative = canonical_relative(entry['path'])
            if relative in seen or relative.split('/')[0] in reserved:
                raise Unavailable('runtime-duplicate-or-reserved')
            seen.add(relative)
            if type(entry['mode']) is not int or entry['mode'] < 0 or (entry['type'] == 'symlink' and entry['mode'] != 0o777) or (entry['type'] != 'symlink' and (entry['mode'] & ~0o755 or entry['mode'] & 0o022)):
                raise Unavailable('runtime-permission')
            parent, leaf = relative_parent(destination_root, relative)
            try:
                if entry['type'] == 'directory':
                    create_runtime_directory(parent, leaf, entry['mode'])
                elif entry['type'] == 'symlink':
                    link = entry['target']
                    if not isinstance(link, str) or not link or link.startswith('/') or '\\' in link or '\0' in link:
                        raise Unavailable('runtime-symlink-target')
                    resolved = os.path.normpath(os.path.join(os.path.dirname(relative), link))
                    if resolved == '..' or resolved.startswith('../'):
                        raise Unavailable('runtime-symlink-escape')
                    os.symlink(link, leaf, dir_fd=parent)
                elif entry['type'] == 'file':
                    source_parent, source_leaf = relative_parent(source, relative)
                    try:
                        fd = os.open(source_leaf, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source_parent)
                    finally:
                        os.close(source_parent)
                    try:
                        info = os.fstat(fd)
                        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != entry['size']:
                            raise Unavailable('runtime-file-identity')
                        total += info.st_size
                        if total > MAX_SNAPSHOT:
                            raise Unavailable('runtime-byte-bound')
                        out = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, entry['mode'], dir_fd=parent)
                        hasher = hashlib.sha256()
                        try:
                            while True:
                                deadline.remaining()
                                chunk = os.read(fd, 1024 * 1024)
                                if not chunk:
                                    break
                                hasher.update(chunk)
                                write_all(out, chunk)
                            after = os.fstat(fd)
                            if 'sha256:' + hasher.hexdigest() != entry['digest'] or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                                raise Unavailable('runtime-file-drift')
                            os.fchmod(out, entry['mode'])
                            copied = os.fstat(out)
                            if not stat.S_ISREG(copied.st_mode) or copied.st_nlink != 1 or copied.st_size != entry['size'] or stat.S_IMODE(copied.st_mode) != entry['mode']:
                                raise Unavailable('runtime-copy-identity-or-mode')
                        finally:
                            os.close(out)
                    finally:
                        os.close(fd)
                else:
                    raise Unavailable('runtime-entry-kind')
            finally:
                os.close(parent)
    finally:
        os.close(destination_root)
        os.close(source)


def copy_transport(value, destination, deadline):
    fd, before = ordinary(value['path'], MAX_SNAPSHOT, value['physical'])
    out = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        digest = hashlib.sha256()
        size = 0
        while True:
            deadline.remaining()
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > value['size']:
                raise Unavailable('transport-size')
            digest.update(chunk)
            write_all(out, chunk)
        after = os.fstat(fd)
        if size != value['size'] or 'sha256:' + digest.hexdigest() != value['byteDigest'] or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise Unavailable('transport-drift')
        os.fsync(out)
    finally:
        os.close(out)
        os.close(fd)


def safe_extract_dependency_content(archive, target, deadline):
    """Copies authenticated transport only; no compiler binding is adopted here."""
    with tarfile.open(archive, mode='r:') as source:
        total = 0
        entries = 0
        for member in source:
            deadline.remaining()
            entries += 1
            if entries > MAX_ENTRIES:
                raise Unavailable('dependency-entry-bound')
            relative = member.name
            while relative.startswith('./'):
                relative = relative[2:]
            if relative in ('', '.') and member.isdir():
                continue
            canonical_relative(relative)
            if member.mode & 0o7000 or not (member.isdir() or member.isfile() or member.issym()):
                raise Unavailable('dependency-entry-kind')
            if member.issym():
                if member.linkname.startswith('/') or os.path.normpath(os.path.join(os.path.dirname(relative), member.linkname)).startswith('../'):
                    raise Unavailable('dependency-link-escape')
            total += member.size
            if total > MAX_SNAPSHOT:
                raise Unavailable('dependency-byte-bound')
            member.name = relative
            source.extract(member, path=target, filter='data')


def git(root, arguments, deadline):
    # Git creates the private checkout consumed by both root and UID 65532.
    # Set only this child's mask; never alter the controller's host process.
    code, stdout, stderr = run_tool(['/usr/bin/git', '-c', 'safe.directory=' + root, '-C', root] + arguments, deadline,
                                   creation_umask=0o022)
    if code:
        raise NativeFailure('fixed-git-command-failed', phase='git-preparation', exit_code=code, stderr=stderr, stderr_complete=True)
    return stdout.decode('ascii').strip()


def materialize_git(request, target, bundle, deadline):
    parent = nofollow_directory(os.path.dirname(target))
    try:
        create_runtime_directory(parent, os.path.basename(target), 0o755)
    finally:
        os.close(parent)
    git(target, ['init', '--quiet', '--object-format=' + ('sha1' if len(request['bundle']['baseSha']) == 40 else 'sha256')], deadline)
    git(target, ['-c', 'protocol.file.allow=always', 'fetch', '--quiet', bundle, 'refs/sec/base:refs/sec/base', 'refs/sec/head:refs/sec/head'], deadline)
    git(target, ['config', 'core.hooksPath', '/dev/null'], deadline)
    git(target, ['config', 'core.autocrlf', 'false'], deadline)
    git(target, ['update-ref', 'refs/remotes/origin/main', request['bundle']['baseSha']], deadline)


def git_identity(request, trusted, candidate, deadline):
    value = {'baseSha': git(trusted, ['rev-parse', 'HEAD'], deadline),
             'baseTreeSha': git(trusted, ['rev-parse', 'HEAD^{tree}'], deadline),
             'headSha': git(candidate, ['rev-parse', 'HEAD'], deadline),
             'headTreeSha': git(candidate, ['rev-parse', 'HEAD^{tree}'], deadline),
             'status': git(candidate, ['status', '--porcelain=v1', '--untracked-files=all'], deadline)}
    if any(value[key] != request['bundle'][key] for key in ('baseSha', 'baseTreeSha', 'headSha', 'headTreeSha')) or value['status']:
        raise Unavailable('git-subject-drift')
    return value

# This program runs in the final unit namespace/UID before the workload is admitted.
# It has no caller-supplied source or command interpreter. The root SUT path is fixed.
LAUNCH_SHIM = r'''
import ctypes, errno, json, os, sys, time
with open('/proc/self/status', 'r') as stream:
    observed_masks=[line.split(':',1)[1].strip() for line in stream if line.startswith('Umask:')]
if observed_masks != ['0022']: raise RuntimeError('unit-creation-mask-not-observed')
# Invalid arguments cannot create/request a key if the filter is absent.
libc=ctypes.CDLL(None,use_errno=True)
for number,args in [(248,(0,0,0,0,0)),(249,(0,0,0,0)),(250,(-1,0,0,0,0))]:
    ctypes.set_errno(0)
    if libc.syscall(number,*args)!=-1 or ctypes.get_errno()!=errno.EPERM: raise RuntimeError('persistent-keyring-call-not-denied')
with open('/sec-runtime/control/launch.json', 'rb') as stream: request=json.load(stream)
expected_generation=request['expectedGenerationRoot']
if expected_generation is not None:
    root_device=os.stat('/').st_dev
    if os.stat('/sec-runtime/output').st_dev==root_device or os.statvfs('/sec-runtime/output').f_flag & os.ST_RDONLY: raise RuntimeError('coordination-mount-not-private-writable')
    targets=['/sec-runtime/trusted']+(['/sec-runtime/workspace'] if request['workspaceDependencyRequired'] else [])
    for target in targets:
        resolved=os.path.realpath(target+'/node_modules',strict=True)
        if resolved!=expected_generation: raise RuntimeError('dependency-generation-locator-drift')
        fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            for component in resolved.split('/')[1:]:
                child=os.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=child
            if os.fstat(fd).st_dev!=root_device or not os.fstatvfs(fd).f_flag & os.ST_RDONLY: raise RuntimeError('dependency-generation-not-sealed-in-rootfs')
        finally: os.close(fd)
with open('/sec-runtime/trusted/package.json', 'rb') as stream: stream.read(1)
probe='/sec-runtime/output/.native-unit-probe'
fd=os.open(probe, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
try:
    os.write(fd, request['nonce'].encode()); os.fsync(fd)
finally: os.close(fd)
with open(probe,'rb') as stream:
    if stream.read(33)!=request['nonce'].encode(): raise RuntimeError('probe-bytes')
os.unlink(probe)
print(json.dumps({'kind':'ready','nonce':request['nonce'],'cwd':os.getcwd(),'uid':os.getuid(),'gid':os.getgid(),'trustedPackageReadable':True,'outputWritable':True,'persistentKernelCallsDenied':True,'dependencyGenerationReadOnly':expected_generation is not None},sort_keys=True,separators=(',',':')),flush=True)
while True:
    if time.time()*1000 >= request['stopAtUnixMs']: raise RuntimeError('gate-deadline')
    try:
        with open('/sec-runtime/control/admit','r') as stream: admitted=stream.read(33)
    except FileNotFoundError:
        time.sleep(.005); continue
    if admitted != request['nonce']: raise RuntimeError('gate-identity')
    break
invocation=request['invocation']
env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/tmp/home','TMPDIR':'/tmp','LANG':'C','LC_ALL':'C','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0','SEC_STATE_HOME':'/sec-runtime/output/state','SEC_CACHE_HOME':'/sec-runtime/output/cache'}
env.update(invocation['environment'])
os.environ.clear(); os.environ.update(env)
if invocation['kind']=='hosted-sut':
    if invocation['argv'] or os.getuid()!=0: raise RuntimeError('sut-fixed-entry')
    argv=['/usr/local/bin/bun','--no-env-file','--no-install','/sec-runtime/trusted/src/bootstrap/development/hosted-sut.ts','--native-unit']
elif invocation['kind']=='lifecycle-canary':
    if invocation['argv'] or os.getuid()!=65532: raise RuntimeError('canary-fixed-entry')
    argv=['/usr/local/bin/bun','--version']
else:
    if os.getuid()!=65532: raise RuntimeError('nonroot-workload')
    argv=['/usr/local/bin/bun']+invocation['argv']
os.execv(argv[0],argv)
'''

# Only this fixed root program crosses the original mount namespace boundary.
# Foreign proc FDs are identity/input capabilities, never manager mount targets.
BOOTSTRAP_SHIM = r'''
import ctypes,json,os,re,stat,sys
p=json.loads(sys.argv[1])
libc=ctypes.CDLL(None,use_errno=True)
libc.setns.argtypes=[ctypes.c_int,ctypes.c_int]
libc.unshare.argtypes=[ctypes.c_int]
libc.setfsuid.argtypes=[ctypes.c_uint]
libc.setfsuid.restype=ctypes.c_uint
libc.mount.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_ulong,ctypes.c_char_p]
def checked(result,label):
    if result<0: raise OSError(ctypes.get_errno(),label)
    return result
def identity(fd):
    s=os.fstat(fd)
    if not stat.S_ISDIR(s.st_mode): raise RuntimeError('bootstrap-directory-type')
    return {'device':str(s.st_dev),'inode':str(s.st_ino)}
def start(pid):
    with open('/proc/'+str(pid)+'/stat','rb') as stream: return stream.read(65536).decode().rsplit(') ',1)[1].split()[19]
def exact(fd,expected):
    if identity(fd)!=expected: raise RuntimeError('bootstrap-directory-replaced')
def mount(source,target,filesystem,flags,data=None):
    enc=lambda v: None if v is None else os.fsencode(v)
    checked(libc.mount(enc(source),enc(target),enc(filesystem),flags,enc(data)),'bootstrap-mount')
# Clone systemd's already isolated /dev before leaving its mount namespace.
dev=checked(libc.syscall(428,ctypes.c_int(-100),ctypes.c_char_p(b'/dev'),ctypes.c_uint(1|os.O_CLOEXEC|0x8000)),'bootstrap-open-tree-private-dev')
pid=p['helperPid']; prefix='/proc/'+str(pid)
if start(pid)!=p['helperStartTime']: raise RuntimeError('bootstrap-helper-replaced')
ns=os.open(prefix+'/ns/mnt',os.O_RDONLY|os.O_CLOEXEC)
foreign={k:os.open(prefix+'/fd/'+str(p[k+'Fd']),os.O_PATH|os.O_DIRECTORY|os.O_CLOEXEC) for k in ['record','root','control','output']}
for k in foreign: exact(foreign[k],p[k+'Identity'])
info=os.fstat(foreign['record'])
if info.st_uid!=0 or stat.S_IMODE(info.st_mode)!=0o700: raise RuntimeError('bootstrap-private-record-root')
record_fd=os.open('record.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=foreign['record'])
try:
    info=os.fstat(record_fd)
    if info.st_uid!=0 or info.st_nlink!=1 or not stat.S_ISREG(info.st_mode) or info.st_size>65536: raise RuntimeError('bootstrap-record-identity')
    raw=os.read(record_fd,65537); record=json.loads(raw)
finally: os.close(record_fd)
if json.dumps(record,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()+b'\n'!=raw: raise RuntimeError('bootstrap-record-canonical')
for k in ['operationIdentityDigest','boundAttemptDigest','inputDigest']:
    if record[k]!=p[k]: raise RuntimeError('bootstrap-operation-replaced')
if (record['runtimeRoot']!=p['recordIdentity'] or record['activeUnitName']!=p['unitName'] or record['description']!=p['description']
        or record['helperPid']!=pid or record['helperStartTime']!=p['helperStartTime']): raise RuntimeError('bootstrap-record-binding')
with open(prefix+'/cgroup') as stream: membership=stream.read(65536).splitlines()
with open('/proc/sys/kernel/random/boot_id') as stream: boot=stream.read(128).strip()
if membership!=['0::'+record['control']['cgroupPath']] or boot!=record['control']['managerBootId'] or start(1)!=record['control']['managerStartTime']:
    raise RuntimeError('bootstrap-original-control-replaced')
if start(pid)!=p['helperStartTime']: raise RuntimeError('bootstrap-helper-replaced')
checked(libc.setns(ns,0x00020000),'bootstrap-enter-original-mount-namespace')
os.fchdir(foreign['record'])
checked(libc.unshare(0x00020000),'bootstrap-copy-original-mount-namespace')
# unshare maps cwd to the copied tree. Reopen locally rather than mounting
# through any of the original helper's foreign file descriptors.
local_record=os.open('.',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
exact(local_record,p['recordIdentity'])
local={'record':local_record}
for k,relative in [('root','rootfs'),('control','control'),('output',p['outputRelative'])]:
    if not re.fullmatch(r'(?:rootfs|control|output(?:/hosted-[0-9a-f]{32})?)',relative): raise RuntimeError('bootstrap-local-path')
    current=os.dup(local_record)
    try:
        for component in relative.split('/'):
            if k=='output' and component.startswith('hosted-'):
                ancestor=os.fstat(current)
                if (ancestor.st_uid,ancestor.st_gid,stat.S_IMODE(ancestor.st_mode))!=(65532,65532,0o700): raise RuntimeError('bootstrap-output-ancestor-owner')
                previous=libc.setfsuid(65532)
                try:
                    if previous!=0 or libc.setfsuid(0xffffffff)!=65532: raise RuntimeError('bootstrap-output-fsuid')
                    nxt=os.open(component,os.O_PATH|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=current)
                finally:
                    libc.setfsuid(previous)
                    if libc.setfsuid(0xffffffff)!=previous: raise RuntimeError('bootstrap-output-fsuid-restore')
            else:
                nxt=os.open(component,os.O_PATH|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=current)
            os.close(current);current=nxt
        exact(current,p[k+'Identity']);local[k]=current;current=None
    finally:
        if current is not None: os.close(current)
mount(None,'/',None,0x40000|0x4000)
root='/proc/self/fd/'+str(local['root'])
control=root+'/sec-runtime/control'; output=root+'/sec-runtime/output'
mount('/proc/self/fd/'+str(local['control']),control,None,4096)
mount(None,control,None,4096|32|1|2|4)
mount('/proc/self/fd/'+str(local['output']),output,None,4096)
checked(libc.syscall(429,ctypes.c_int(dev),ctypes.c_char_p(b''),ctypes.c_int(local['root']),ctypes.c_char_p(b'dev'),ctypes.c_uint(4)),'bootstrap-install-private-dev')
mount('tmpfs',root+'/tmp','tmpfs',2|4,'size=512M,mode=1777')
cwd={'trusted':'sec-runtime/trusted','candidate':'sec-runtime/workspace','scratch':'tmp'}[p['cwd']]
cwd_fd=os.open(cwd,os.O_PATH|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=local['root'])
os.chroot(root);os.fchdir(cwd_fd)
for fd in [dev,ns,cwd_fd]+list(foreign.values())+list(local.values()): os.close(fd)
argv=['/usr/bin/setpriv','--bounding-set='+('-sys_ptrace' if p['rootWorker'] else '-sys_ptrace,-sys_chroot'),'--inh-caps=-all','--ambient-caps=-all','--',
      '/usr/bin/unshare','--mount','--pid','--fork','--kill-child=KILL','--mount-proc','--']
if not p['rootWorker']:
    argv.extend(['/usr/bin/setpriv','--reuid=65532','--regid=65532','--clear-groups','--no-new-privs','--bounding-set=-all','--inh-caps=-all','--ambient-caps=-all','--'])
''' + '\nargv.extend(["/usr/bin/python3","-I","-S","-u","-c",' + repr(LAUNCH_SHIM) + '])\nos.execv(argv[0],argv)\n'

UNIT_PROPERTIES = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'ControlGroup', 'Description',
                   'MainPID', 'ExecMainPID', 'ExecMainCode', 'ExecMainStatus', 'ExecMainExitTimestampMonotonic', 'SystemCallFilter', 'UMask', 'BindsTo', 'After']
CONTROL_PROPERTIES = ['Id', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'ControlGroup', 'Description']


def unit_readback(name, deadline):
    wanted = CONTROL_PROPERTIES if name.endswith('.scope') else UNIT_PROPERTIES
    code, output, error = run_tool(['/usr/bin/systemctl', '--no-ask-password', 'show', '--no-pager',
                                   '--property=' + ','.join(wanted), '--', name], deadline)
    if code:
        raise NativeFailure('manager-readback-unavailable', phase='manager-readback', unit_name=name, exit_code=code, stderr=error, stderr_complete=True)
    properties = {}
    for line in output.decode('utf8').splitlines():
        if '=' not in line:
            raise Unavailable('manager-property-shape')
        key, value = line.split('=', 1)
        if key in properties or key not in wanted:
            raise Unavailable('manager-property-identity')
        properties[key] = value
    if set(properties) != set(wanted):
        raise Unavailable('manager-property-incomplete')
    return properties


def manager_identity():
    if bounded_read('/proc/1/comm', 64).strip() != b'systemd':
        raise Unavailable('system-manager-required')
    return {'boot': bounded_read('/proc/sys/kernel/random/boot_id', 128).decode().strip(), 'start': process_start(1)}


def accepted_unit(name, properties, description, manager):
    """Persist manager acceptance before waiting for a SUT readiness message."""
    if (properties['Id'] != name or properties['Description'] != description
            or not re.fullmatch('[0-9a-f]{32}', properties['InvocationID'])
            or manager != manager_identity()):
        raise Unavailable('manager-accepted-unit-identity')
    group = '/system.slice/' + name
    if properties['ControlGroup'] != group:
        # systemd prunes an empty cgroup in SERVICE_EXITED even when
        # RemainAfterExit keeps the exact invocation active. This minimum
        # acceptance observation never qualifies a workload that was not ready.
        if properties['ControlGroup'] != '' or not exited_before_ready(properties) or not cgroup_empty({'cgroupPath': group}):
            raise Unavailable('manager-accepted-unit-identity')
    return {'name': name, 'invocationId': properties['InvocationID'],
            'managerBootId': manager['boot'], 'managerStartTime': manager['start'],
            'cgroupPath': group}


def exited_before_ready(properties):
    return int(properties.get('ExecMainExitTimestampMonotonic', '0')) > 0 and properties.get('MainPID') == '0'


def fail_exited_preflight(request, recovery, properties, unit, description, streams, deadline):
    if not exited_before_ready(properties):
        return
    code, status = int(properties['ExecMainCode']), int(properties['ExecMainStatus'])
    failure = NativeFailure('native-preflight-exited', phase='preflight', unit_name=request['unitName'],
                            exit_code=status if code == 1 else min(255, 128 + status), exec_main_code=code, exec_main_status=status)
    # Manager setup errors can precede StandardError redirection. Read only
    # this original unit's boot-scoped journal; it cannot qualify an effect.
    try:
        journal_code, journal, journal_error = run_tool(['/usr/bin/journalctl', '--no-pager', '--quiet', '--all',
            '--output=json', '--boot=' + unit['managerBootId'].replace('-', ''), '--unit=' + request['unitName']], deadline)
        failure.args = (str(failure) + '\nOriginal unit manager journal (exit=' + str(journal_code) + '):\n'
                        + journal.decode('utf8') + '\nJournal stderr:\n' + journal_error.decode('utf8', errors='replace'),)
    except BaseException as journal_failure:
        failure.args = (str(failure) + '\nOriginal unit manager journal unavailable: ' + str(journal_failure),)
    try:
        settle_unit(request, unit, description, deadline)
        recovery.update({**recovery.value, 'phase': 'unit-settled'})
        streams.drain(0)
        failure.stderr_complete = True
    except BaseException as cleanup:
        failure.add_cleanup(cleanup)
    failure.stderr = bytes(streams.buffers['stderr'])
    raise failure


def wait_preflight_ready(request, recovery, properties, unit, description, streams, deadline, control_deadline, pidfds):
    """The original manager process and bounded FIFOs share one readiness wait."""
    fail_exited_preflight(request, recovery, properties, unit, description, streams, control_deadline)
    pid = int(properties['MainPID'])
    if pid <= 1:
        raise Unavailable('preflight-manager-process-unavailable')

    def observe_exit():
        current = unit_readback(request['unitName'], control_deadline)
        observed = accepted_unit(request['unitName'], current, description, manager_identity())
        if observed != unit:
            raise Unavailable('preflight-manager-invocation-replaced')
        fail_exited_preflight(request, recovery, current, unit, description, streams, control_deadline)
        raise Unavailable('preflight-process-ended-without-manager-terminal')

    try:
        fd = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        observe_exit()
    pidfds.append(fd)
    try:
        membership = bounded_read('/proc/' + str(pid) + '/cgroup', 65536).decode().splitlines()
    except FileNotFoundError:
        observe_exit()
    if membership != ['0::' + unit['cgroupPath']]:
        raise Unavailable('preflight-manager-process-domain-replaced')
    current = unit_readback(request['unitName'], deadline)
    observed = accepted_unit(request['unitName'], current, description, manager_identity())
    if observed != unit:
        raise Unavailable('preflight-manager-invocation-replaced')
    fail_exited_preflight(request, recovery, current, unit, description, streams, control_deadline)
    if current['MainPID'] != str(pid):
        raise Unavailable('preflight-manager-process-replaced')
    registered = False
    try:
        streams.selector.register(fd, selectors.EVENT_READ, 'process')
        registered = True
        while b'\n' not in streams.buffers['stdout']:
            if streams.drain(min(.01, deadline.remaining())):
                streams.selector.unregister(fd)
                registered = False
                observe_exit()
        # A ready line and process exit can become readable together. Death
        # wins; an already-exited preflight must never issue admission.
        if select.select([fd], [], [], 0)[0]:
            streams.selector.unregister(fd)
            registered = False
            observe_exit()
    finally:
        if registered:
            streams.selector.unregister(fd)


def original_control(request, deadline):
    name = request['unitName'][:-len('.service')] + '-control.scope'
    description = 'sec-native-control:' + request['operationIdentityDigest'] + ':' + request['boundAttemptDigest'] + ':' + request['inputDigest']
    manager = manager_identity()
    properties = unit_readback(name, deadline)
    identity = accepted_unit(name, properties, description, manager)
    if properties['ActiveState'] != 'active' or bounded_read('/proc/self/cgroup', 65536).decode().splitlines() != ['0::' + identity['cgroupPath']]:
        raise Unavailable('original-control-scope-membership')
    observe_control_resources(identity)
    return {**identity, 'description': description}


def observe_control_resources(control):
    group = '/sys/fs/cgroup' + control['cgroupPath']
    for file, expected in [('cpu.max', b'200000 100000'), ('memory.max', b'4294967296'), ('pids.max', b'256')]:
        if bounded_read(group + '/' + file, 4096).strip() != expected:
            raise Unavailable('control-resource-readback')


def observe_control_dependency(properties, control):
    if any(control['name'] not in properties[key].split() for key in ('BindsTo', 'After')):
        raise Unavailable('original-control-dependency-readback')


@contextlib.contextmanager
def observation_filesystem_credentials(uid, gid):
    """Reuse the original supervisor's checked FSCREDS observation technique.

    The manager bridge is single-threaded. Real/effective/saved root identities
    remain unchanged; no CAP_SYS_PTRACE is added to either fixed unit profile.
    Failed LSM/hidepid/dumpability checks remain unsupported, never inferred.
    """
    old_uid, old_gid = LIBC.setfsuid(0xffffffff), LIBC.setfsgid(0xffffffff)
    try:
        LIBC.setfsgid(gid)
        LIBC.setfsuid(uid)
        if LIBC.setfsuid(0xffffffff) != uid or LIBC.setfsgid(0xffffffff) != gid:
            raise Unavailable('proc-observation-filesystem-credentials')
        yield
    finally:
        LIBC.setfsuid(old_uid)
        LIBC.setfsgid(old_gid)
        if LIBC.setfsuid(0xffffffff) != old_uid or LIBC.setfsgid(0xffffffff) != old_gid:
            os._exit(126)


def observe_start(request, properties, root, cwd, manager, control=None):
    name = request['unitName']
    if properties['UMask'] != '0022':
        raise Unavailable('unit-creation-mask')
    if control is None:
        raise Unavailable('original-control-domain-not-observed')
    observe_control_resources(control)
    if properties['Id'] != name or properties['ControlGroup'] != '/system.slice/' + name:
        raise Unavailable('unit-domain-identity')
    manager_pid = int(properties['MainPID'])
    if manager_pid <= 1 or not re.fullmatch('[0-9a-f]{32}', properties['InvocationID']):
        raise Unavailable('unit-start-identity')
    group = '/sys/fs/cgroup' + properties['ControlGroup']
    pids = [int(value) for value in bounded_read(group + '/cgroup.procs', 4096).split()]
    if len(pids) != 2 or manager_pid not in pids:
        raise Unavailable('namespace-wrapper-domain')
    pid = next(value for value in pids if value != manager_pid)
    status = dict(line.split(':', 1) for line in bounded_read('/proc/' + str(pid) + '/status', 65536).decode().splitlines() if ':' in line)
    if int(status['PPid'].strip()) != manager_pid:
        raise Unavailable('namespace-wrapper-parent')
    parent_status = dict(line.split(':', 1) for line in bounded_read('/proc/' + str(manager_pid) + '/status', 65536).decode().splitlines() if ':' in line)
    root_worker = request['invocation']['kind'] == 'hosted-sut'
    uid = 0 if root_worker else 65532
    if tuple(map(int, status['Uid'].split())) != (uid, uid, uid, uid) or tuple(map(int, status['Gid'].split())) != (uid, uid, uid, uid):
        raise Unavailable('unit-uid-gid')
    if status['Seccomp'].strip() != '2' or set(properties['SystemCallFilter'].removeprefix('~').split()) != {'keyctl', 'add_key', 'request_key'} or not properties['SystemCallFilter'].startswith('~'):
        raise Unavailable('persistent-kernel-state-filter')
    if status['NoNewPrivs'].strip() != '1':
        raise Unavailable('unit-no-new-privileges')
    mask = sum(1 << bit for bit in ((0, 6, 7, 8, 18, 21) if root_worker else (6, 7, 8, 21)))
    if any(int(parent_status[key], 16) != mask for key in ('CapPrm', 'CapEff', 'CapBnd')) or any(int(parent_status[key], 16) for key in ('CapInh', 'CapAmb')):
        raise Unavailable('namespace-setup-capabilities')
    expected_caps = mask if root_worker else 0
    if any(int(status[key], 16) != expected_caps for key in ('CapPrm', 'CapEff', 'CapBnd')) or any(int(status[key], 16) for key in ('CapInh', 'CapAmb')):
        raise Unavailable('unit-capabilities')
    expected_root, expected_cwd = os.stat(root), os.stat(root + cwd)
    with observation_filesystem_credentials(uid, uid):
        actual_root = os.stat('/proc/' + str(pid) + '/root')
        actual_cwd = os.stat('/proc/' + str(pid) + '/cwd')
        namespaces = {key: os.readlink('/proc/' + str(pid) + '/ns/' + name) for key, name in [('mount', 'mnt'), ('pid', 'pid'), ('network', 'net'), ('user', 'user'), ('ipc', 'ipc')]}
        private_dev = os.stat('/proc/' + str(pid) + '/root/dev')
        null = os.stat('/proc/' + str(pid) + '/root/dev/null')
        sys_entries = os.listdir('/proc/' + str(pid) + '/root/sys')
    if (expected_root.st_dev, expected_root.st_ino) != (actual_root.st_dev, actual_root.st_ino) or (expected_cwd.st_dev, expected_cwd.st_ino) != (actual_cwd.st_dev, actual_cwd.st_ino):
        raise Unavailable('unit-root-cwd')
    if private_dev.st_dev in (actual_root.st_dev, os.stat('/dev').st_dev) or not stat.S_ISCHR(null.st_mode) or null.st_rdev != os.makedev(1, 3) or sys_entries:
        raise Unavailable('unit-private-dev-or-empty-sys')
    for key, ns in [('mount', 'mnt'), ('pid', 'pid'), ('network', 'net'), ('ipc', 'ipc')]:
        if namespaces[key] == os.readlink('/proc/self/ns/' + ns):
            raise Unavailable('unit-namespace-not-private')
    if namespaces['user'] != os.readlink('/proc/self/ns/user'):
        raise Unavailable('unit-user-map-differs')
    group = '/sys/fs/cgroup' + properties['ControlGroup']
    for file, expected in [('cpu.max', b'200000 100000'), ('memory.max', b'4294967296'), ('pids.max', b'256')]:
        if bounded_read(group + '/' + file, 4096).strip() != expected:
            raise Unavailable('unit-resource-readback')
    if manager != manager_identity():
        raise Unavailable('manager-replaced')
    return {'name': name, 'invocationId': properties['InvocationID'], 'managerBootId': manager['boot'],
            'managerStartTime': manager['start'], 'cgroupPath': properties['ControlGroup'],
            'mainPid': pid, 'mainPidStartTime': process_start(pid), 'managerMainPid': manager_pid,
            'managerMainPidStartTime': process_start(manager_pid), 'namespaceIdentities': namespaces,
            'rootDevice': str(actual_root.st_dev), 'rootInode': str(actual_root.st_ino),
            'workingDirectory': cwd, 'workingDirectoryDevice': str(actual_cwd.st_dev), 'workingDirectoryInode': str(actual_cwd.st_ino),
            'trustedPackageReadable': True, 'outputWritable': True}


def cgroup_empty(unit):
    path = '/sys/fs/cgroup' + unit['cgroupPath']
    try:
        fd = nofollow_directory(path)
    except FileNotFoundError:
        return True
    try:
        events_fd = os.open('cgroup.events', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fd)
        try:
            events = dict(line.split() for line in os.read(events_fd, 4096).decode().splitlines())
        finally:
            os.close(events_fd)
        return events.get('populated') == '0'
    finally:
        os.close(fd)


def settle_unit(request, unit, description, deadline):
    if unit is None or manager_identity() != {'boot': unit['managerBootId'], 'start': unit['managerStartTime']}:
        raise Unavailable('manager-changed-before-stop')
    current = unit_readback(request['unitName'], deadline)
    if current['LoadState'] == 'not-found':
        if unit is None or not cgroup_empty(unit):
            raise Unavailable('unit-disappeared-without-settlement')
        return
    inactive = current['ActiveState'] in ('inactive', 'failed') and current['InvocationID'] == ''
    if current['Description'] != description or (current['InvocationID'] != unit['invocationId'] and not inactive):
        raise Unavailable('unit-replaced-before-stop')
    if unit is None:
        raise Unavailable('unit-start-observation-lost')
    code, _out, error = run_tool(['/usr/bin/systemctl', '--no-ask-password', 'stop', '--', request['unitName']], deadline)
    if code:
        raise NativeFailure('unit-stop-unconfirmed', phase='cleanup-stop', unit_name=request['unitName'], exit_code=code, stderr=error, stderr_complete=True)
    while not cgroup_empty(unit):
        time.sleep(min(.01, deadline.remaining()))
    terminal = unit_readback(request['unitName'], deadline)
    if terminal['LoadState'] != 'not-found' and (terminal['ActiveState'] not in ('inactive', 'failed') or terminal['InvocationID'] not in ('', unit['invocationId'])):
        raise Unavailable('unit-terminal-identity')
    if terminal['ActiveState'] == 'failed':
        code, _out, error = run_tool(['/usr/bin/systemctl', '--no-ask-password', 'reset-failed', '--', request['unitName']], deadline)
        if code:
            raise NativeFailure('unit-retirement-unconfirmed', phase='cleanup-retirement', unit_name=request['unitName'], exit_code=code, stderr=error, stderr_complete=True)
        retired = unit_readback(request['unitName'], deadline)
        if retired['LoadState'] != 'not-found' and (retired['ActiveState'] != 'inactive' or retired['Description'] != description or retired['InvocationID'] not in ('', unit['invocationId'])):
            raise Unavailable('unit-retirement-readback')


def write_bytes(file, data, mode=0o600):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise Unavailable('short-write')
            view = view[count:]
        os.fchmod(fd, mode)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != len(data) or stat.S_IMODE(info.st_mode) != mode:
            raise Unavailable('private-file-identity-or-mode')
        os.fsync(fd)
    finally:
        os.close(fd)


class BoundedStreams:
    """Nonseekable FIFOs, drained while the workload runs. No disk output spool."""
    def __init__(self, recovery, invocation):
        self.fds, self.buffers = {}, {'stdout': bytearray(), 'stderr': bytearray()}
        self.limits = {'stdout': invocation['maxStdoutBytes'] + 4096, 'stderr': invocation['maxStderrBytes']}
        self.selector = selectors.DefaultSelector()
        for name in ('stdout', 'stderr'):
            file = recovery.path + '/' + name
            os.mkfifo(file, 0o600)
            # Retained dummy writer prevents pre-launch EOF. Service receives
            # only the independent write end; lseek/ftruncate cannot alter history.
            fd = os.open(file, os.O_RDWR | os.O_NONBLOCK | os.O_NOFOLLOW)
            if not stat.S_ISFIFO(os.fstat(fd).st_mode):
                raise Unavailable('stream-identity')
            self.fds[name] = fd
            self.selector.register(fd, selectors.EVENT_READ, name)

    def drain(self, timeout):
        for key, _events in self.selector.select(timeout):
            if key.data == 'process':
                return True
            while True:
                try:
                    part = os.read(key.fd, 65536)
                except BlockingIOError:
                    break
                if not part:
                    break
                if len(self.buffers[key.data]) + len(part) > self.limits[key.data]:
                    raise Unavailable('workload-output-bound')
                self.buffers[key.data].extend(part)
        return False

    def close(self):
        failure = None
        for action in [self.selector.close] + [lambda fd=fd: os.close(fd) for fd in self.fds.values()]:
            try:
                action()
            except BaseException as cleanup:
                if failure is None:
                    failure = native_failure(cleanup, phase='stream-cleanup')
                else:
                    failure.add_cleanup(cleanup)
        if failure is not None:
            raise failure


def launch_unit(request, recovery, root, control, output, deadline, control_deadline, setup=False):
    invocation = request['invocation']
    manager = manager_identity()
    code, version, error = run_tool(['/usr/bin/systemd-run', '--version'], deadline, 65536)
    if code:
        raise NativeFailure('systemd-native-profile-unavailable', phase='manager-profile', unit_name=request['unitName'], exit_code=code, stderr=error, stderr_complete=True)
    matched = re.match(rb'systemd ([0-9]+)', version)
    if matched is None or int(matched.group(1)) < 255 or b'+SECCOMP' not in version:
        raise Unavailable('systemd-native-profile-unavailable')
    cwd = {'trusted': '/sec-runtime/trusted', 'candidate': '/sec-runtime/workspace', 'scratch': '/tmp'}[invocation['cwd']]
    nonce = os.urandom(16).hex()
    dependency = request.get('dependencyObservation') if not setup else None
    expected_generation = None if dependency is None else '/sec-runtime/trusted/.tmp/dependency-installs/compiler-backups/generation-' + dependency[1]['trusted']['generationDigest'][7:31]
    workspace_required = invocation['kind'] in ('verification-action', 'main-health', 'hosted-sut')
    launch = {'nonce': nonce, 'stopAtUnixMs': request['stopAtUnixMs'], 'invocation': invocation,
              'expectedGenerationRoot': expected_generation, 'workspaceDependencyRequired': workspace_required}

    write_bytes(control + '/launch.json', canonical(launch), 0o444)
    stdin = b'' if invocation['stdin'] is None else base64.b64decode(invocation['stdin'], validate=True)
    write_bytes(recovery.path + '/stdin', stdin, 0o400)
    streams = BoundedStreams(recovery, invocation)
    host_root = ''  # All paths already use the explicit retained helper PID/fd anchor.
    description = 'sec-native:' + request['operationIdentityDigest'] + ':' + request['boundAttemptDigest'] + ':' + request['inputDigest'] + ':' + os.urandom(32).hex()
    root_worker = invocation['kind'] == 'hosted-sut'
    uid = 0 if root_worker else 65532
    properties = ['Description=' + description, 'Restart=no', 'CollectMode=inactive-or-failed',
                  # Numeric failures remain observable in ExecMainStatus under
                  # RemainAfterExit. Failed late starts have no workload and GC.
                  'SuccessExitStatus=' + ' '.join(str(code) for code in range(256)),
                  'BindsTo=' + recovery.value['control']['name'], 'After=' + recovery.value['control']['name'], 'KillMode=control-group',
                  'SendSIGKILL=yes', 'TimeoutStopSec=5s', 'RuntimeMaxSec=' + str(max(.001, deadline.remaining())) + 's',
                  'CPUQuota=200%', 'CPUQuotaPeriodSec=100ms', 'MemoryMax=4294967296', 'TasksMax=256',
                  'User=0', 'Group=0', 'UMask=0022', 'NoNewPrivileges=yes',
                  'PrivateNetwork=yes', 'PrivateMounts=yes', 'PrivateDevices=yes', 'ProtectControlGroups=yes', 'PrivateIPC=yes',
                  'KeyringMode=private', 'SystemCallArchitectures=x86-64', 'SystemCallFilter=~keyctl add_key request_key', 'SystemCallErrorNumber=EPERM',
                  'WorkingDirectory=/',
                  'StandardInput=file:' + host_root + recovery.path + '/stdin',
                  'StandardOutput=file:' + host_root + recovery.path + '/stdout',
                  'StandardError=file:' + host_root + recovery.path + '/stderr',
                  'CapabilityBoundingSet=' + ((ROOT_CAPABILITIES + ' CAP_SYS_PTRACE') if root_worker else (NAMESPACE_CAPABILITIES + ' CAP_SYS_CHROOT CAP_SYS_PTRACE')),
                  # systemd's seccomp setup drops SETUID unless explicitly
                  # retained as ambient. The first setpriv clears inh/ambient;
                  # the final observer still requires the original exact mask.
                  'AmbientCapabilities=CAP_SETUID']
    args = ['/usr/bin/systemd-run', '--quiet', '--no-ask-password', '--expand-environment=no', '--unit=' + request['unitName'],
            '--service-type=exec', '--remain-after-exit']
    args.extend('--property=' + value for value in properties)
    bootstrap = {'helperPid': os.getpid(), 'helperStartTime': process_start(os.getpid()), 'recordFd': recovery.fd,
                 'rootFd': MOUNT_HANDLES[root], 'controlFd': MOUNT_HANDLES[control], 'outputFd': MOUNT_HANDLES[output],
                 'recordIdentity': recovery.physical, 'outputRelative': os.path.relpath(output, recovery.path),
                 'unitName': request['unitName'], 'description': description, 'cwd': invocation['cwd'], 'rootWorker': root_worker,
                 **{key: request[key] for key in ['operationIdentityDigest', 'boundAttemptDigest', 'inputDigest']}}
    for key, fd in [('root', MOUNT_HANDLES[root]), ('control', MOUNT_HANDLES[control]), ('output', MOUNT_HANDLES[output])]:
        info = os.fstat(fd)
        bootstrap[key + 'Identity'] = {'device': str(info.st_dev), 'inode': str(info.st_ino)}
    args.extend(['--', '/usr/bin/python3.12', '-I', '-S', '-u', '-c', BOOTSTRAP_SHIM, canonical(bootstrap).decode()])
    unit, pidfds = None, []
    failure, result = None, None
    try:
        # Fixed systemd-created unshare parent + one forked namespace child.
        reserve_processes(2)
        recovery.update({**recovery.value, 'phase': 'unit-starting', 'activeUnitName': request['unitName'], 'description': description, 'manager': manager, 'unit': None})
        code, _out, error = run_tool(args, deadline)
        if code:
            raise NativeFailure('unit-start-unconfirmed', phase='manager-start', unit_name=request['unitName'], exit_code=code, stderr=error, stderr_complete=True)
        accepted = unit_readback(request['unitName'], deadline)
        observe_control_dependency(accepted, recovery.value['control'])
        unit = accepted_unit(request['unitName'], accepted, description, manager)
        recovery.update({**recovery.value, 'phase': 'unit-accepted', 'unit': unit})
        wait_preflight_ready(request, recovery, accepted, unit, description, streams, deadline, control_deadline, pidfds)
        ready_line = bytes(streams.buffers['stdout']).split(b'\n', 1)[0]
        ready = json.loads(ready_line, object_pairs_hook=no_duplicates)
        expected = {'kind': 'ready', 'nonce': nonce, 'cwd': cwd, 'uid': uid, 'gid': uid,
                    'trustedPackageReadable': True, 'outputWritable': True, 'persistentKernelCallsDenied': True, 'dependencyGenerationReadOnly': expected_generation is not None}
        if ready != expected or len(ready_line) > 4095:
            raise Unavailable('unit-preflight-observation')
        del streams.buffers['stdout'][:len(ready_line) + 1]
        streams.limits['stdout'] = invocation['maxStdoutBytes']
        properties = unit_readback(request['unitName'], deadline)
        observe_control_dependency(properties, recovery.value['control'])
        if properties['Description'] != description:
            raise Unavailable('unit-description-drift')
        unit = observe_start(request, properties, root, cwd, manager, recovery.value['control'])
        for pid_key, time_key in [('mainPid', 'mainPidStartTime'), ('managerMainPid', 'managerMainPidStartTime')]:
            fd = os.pidfd_open(unit[pid_key], 0)
            pidfds.append(fd)
            if process_start(unit[pid_key]) != unit[time_key]:
                raise Unavailable('unit-process-replaced')
        recovery.update({**recovery.value, 'phase': 'started', 'unit': unit})
        streams.selector.register(pidfds[-1], selectors.EVENT_READ, 'process')
        write_bytes(control + '/admit', nonce.encode(), 0o444)
        while not streams.drain(min(.1, deadline.remaining())):
            pass
        streams.selector.unregister(pidfds[-1])
        properties = unit_readback(request['unitName'], control_deadline)
        if properties['InvocationID'] != unit['invocationId'] or int(properties['ExecMainExitTimestampMonotonic']) == 0 or int(properties['MainPID']) != 0:
            raise Unavailable('unit-terminal-process-readback')
        code, status = int(properties['ExecMainCode']), int(properties['ExecMainStatus'])
        exit_code = status if code == 1 else min(255, 128 + status)
        settle_unit(request, unit, description, control_deadline)
        recovery.update({**recovery.value, 'phase': 'unit-settled'})
        # No producer remains after real cgroup settlement, so all remaining
        # stream bytes are already in bounded kernel pipes and are drained now.
        streams.drain(0)
        stdout, stderr = bytes(streams.buffers['stdout']), bytes(streams.buffers['stderr'])
        captured = {}
        for item in invocation['outputFiles']:
            relative = item['path'].removeprefix('/sec-runtime/output/')
            if '/sec-runtime/output/' + relative != item['path']:
                raise Unavailable('output-path')
            canonical_relative(relative)
            fd, info = ordinary(output + '/' + relative, item['maxBytes'])
            try:
                captured[item['path']] = os.read(fd, item['maxBytes'] + 1)
                if len(captured[item['path']]) != info.st_size:
                    raise Unavailable('output-file-incomplete')
            finally:
                os.close(fd)
        result = unit, exit_code, stdout, stderr, captured
    except BaseException as error:
        failure = native_failure(error, phase='preflight' if recovery.value['phase'] in ('unit-starting', 'unit-accepted') else 'execution', unit_name=request['unitName'])
        if unit is not None and recovery.value['phase'] != 'unit-settled' and not failure.cleanup_failures:
            try:
                settle_unit(request, unit, description, control_deadline)
                recovery.update({**recovery.value, 'phase': 'unit-settled'})
                streams.drain(0)
                if not failure.stderr:
                    failure.stderr = bytes(streams.buffers['stderr'])
                    failure.stderr_complete = True
            except BaseException as cleanup:
                failure.add_cleanup(cleanup)
        if not failure.stderr_complete:
            try:
                streams.drain(0)
            except BaseException as cleanup:
                failure.add_cleanup(cleanup)
            if not failure.stderr:
                failure.stderr = bytes(streams.buffers['stderr'])
    finally:
        for action in [streams.close] + [lambda fd=fd: os.close(fd) for fd in pidfds]:
            try:
                action()
            except BaseException as cleanup:
                if failure is None:
                    failure = native_failure(cleanup, phase='execution-cleanup', unit_name=request['unitName'])
                    failure.stderr = bytes(streams.buffers['stderr'])
                    failure.stderr_complete = result is not None
                else:
                    failure.add_cleanup(cleanup)
    if failure is not None:
        raise failure
    return result


def tree_content_entries(root, deadline):
    entries = []
    total = 0
    for parent, dirs, files in os.walk(root, topdown=True, followlinks=False):
        deadline.remaining()
        for name in sorted(dirs + files):
            file = os.path.join(parent, name)
            relative = canonical_relative(os.path.relpath(file, root))
            info = os.lstat(file)
            mode = stat.S_IMODE(info.st_mode)
            if len(entries) >= MAX_ENTRIES or mode & 0o7000:
                raise Unavailable('content-inventory-bound')
            if stat.S_ISDIR(info.st_mode):
                item = {'path': relative, 'type': 'directory', 'mode': mode}
            elif stat.S_ISLNK(info.st_mode):
                target = os.readlink(file)
                if target.startswith('/') or os.path.normpath(os.path.join(os.path.dirname(relative), target)).startswith('../'):
                    raise Unavailable('content-link-escape')
                item = {'path': relative, 'type': 'symlink', 'mode': mode, 'target': target}
            elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                total += info.st_size
                if total > MAX_SNAPSHOT:
                    raise Unavailable('content-byte-bound')
                fd, _identity = ordinary(file, MAX_SNAPSHOT)
                try:
                    digest = hashlib.sha256()
                    while True:
                        part = os.read(fd, 1024 * 1024)
                        if not part:
                            break
                        deadline.remaining()
                        digest.update(part)
                finally:
                    os.close(fd)
                item = {'path': relative, 'type': 'file', 'mode': mode, 'size': info.st_size, 'digest': 'sha256:' + digest.hexdigest()}
            else:
                raise Unavailable('content-entry-kind')
            entries.append(item)
    return sorted(entries, key=lambda item: item['path'].encode('utf-16-be', 'surrogatepass'))


def change_tree_owner(root):
    for parent, dirs, files in os.walk(root, topdown=True, followlinks=False):
        os.chown(parent, 65532, 65532, follow_symlinks=False)
        for name in dirs + files:
            os.chown(os.path.join(parent, name), 65532, 65532, follow_symlinks=False)


def prepare_dependency_namespace(project):
    # These are new private staging ancestors, before the original publisher
    # creates any generation or proof. Existing owner state is never chmodded.
    fd = nofollow_directory(project)
    try:
        for leaf in ['.tmp', 'dependency-installs', 'compiler-backups']:
            try:
                create_runtime_directory(fd, leaf, 0o755)
            except FileExistsError:
                pass
            child = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
            info = os.fstat(fd)
            if (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) != (os.geteuid(), os.getegid(), 0o755):
                raise Unavailable('dependency-staging-ancestor')
    finally:
        os.close(fd)


def dependency_setup(request, recovery, root, control, output, deadline, control_deadline):
    """The approved fixed nonroot entry invokes only the original importer."""
    prepare_dependency_namespace(root + '/sec-runtime/trusted')
    if request['invocation']['kind'] in ('verification-action', 'main-health', 'hosted-sut'):
        prepare_dependency_namespace(root + '/sec-runtime/workspace')
    content = root + '/sec-runtime/dependency-content'
    parent = nofollow_directory(root + '/sec-runtime')
    try:
        create_runtime_directory(parent, 'dependency-content', 0o755)
    finally:
        os.close(parent)
    parent = nofollow_directory(content)
    try:
        create_runtime_directory(parent, 'node_modules', 0o755)
    finally:
        os.close(parent)
    archive = root + '/authenticated-input/dependency-content.tar'
    copy_transport(request['dependencies'], archive, deadline)
    os.chmod(archive, 0o444)
    safe_extract_dependency_content(archive, content + '/node_modules', deadline)
    trusted = root + '/sec-runtime/trusted'
    for name in ['.bun-version', 'bun.lock', 'package.json', 'bunfig.toml']:
        file = trusted + '/' + name
        if name == 'bunfig.toml' and not os.path.exists(file):
            continue
        fd, info = ordinary(file, 16 * 1024 * 1024)
        try:
            data = os.read(fd, info.st_size + 1)
        finally:
            os.close(fd)
        if len(data) != info.st_size:
            raise Unavailable('base-manifest-input')
        write_bytes(content + '/' + name, data, 0o644)
    # Ownership is final before any local publisher issues its physical proof.
    change_tree_owner(content)
    change_tree_owner(trusted)
    change_tree_owner(root + '/sec-runtime/workspace')
    # Seal modes before the original issuer observes its local generation.
    for parent, dirs, files in os.walk(content, topdown=True, followlinks=False):
        os.chmod(parent, 0o555)
        for name in files:
            file = os.path.join(parent, name)
            info = os.lstat(file)
            if stat.S_ISREG(info.st_mode):
                os.chmod(file, 0o444 | (stat.S_IMODE(info.st_mode) & 0o111))
    entries = tree_content_entries(content, deadline)
    identity = {'bundleDigest': request['bundle']['byteDigest'], 'nodeModulesArchiveDigest': request['dependencies']['byteDigest'], 'contentDigest': sha(canonical(entries))}
    transport_digest = sha(canonical(identity))
    manifest = {'schema': 'sec-native-dependency-content-transport-v1', **identity, 'entries': entries, 'transportDigest': transport_digest}
    write_bytes(root + '/authenticated-input/dependency-content-manifest.json', canonical(manifest) + b'\n', 0o444)
    outputs = []
    for phase in ['prepare', 'observe']:
        packet = {'schema': 'sec-native-verification-dependency-setup-v1', 'phase': phase,
                  'kind': request['invocation']['kind'], 'deadlineAtUnixMs': request['deadlineAtUnixMs'], 'transportDigest': transport_digest}
        internal = dict(request)
        internal['unitName'] = 'sec-native-' + hashlib.sha256((request['unitName'] + ':' + phase).encode()).hexdigest()[:32] + '.service'
        internal['invocation'] = {'kind': 'source-program', 'argv': ['--no-env-file', '--no-install', '/sec-runtime/trusted/src/bootstrap/toolchain/native-verification-dependencies.ts'],
                                  'cwd': 'trusted', 'environment': ({'NODE_PATH': '/sec-runtime/dependency-content/node_modules'} if phase == 'prepare' else {}), 'stdin': base64.b64encode(canonical(packet)).decode(),
                                  'outputFiles': [], 'maxStdoutBytes': 4096, 'maxStderrBytes': 65536}
        # Each phase has its own fixed manager invocation and complete settlement;
        # the rootfs and private coordination state remain the SAME objects.
        for name in ['launch.json', 'admit']:
            try:
                os.unlink(control + '/' + name)
            except FileNotFoundError:
                pass
        for name in ['stdin', 'stdout', 'stderr']:
            try:
                os.unlink(recovery.path + '/' + name)
            except FileNotFoundError:
                pass
        try:
            _unit, code, stdout, stderr, _files = launch_unit(internal, recovery, root, control, output, deadline, control_deadline, setup=True)
        except BaseException as error:
            failure = native_failure(error, phase='dependency-' + phase, unit_name=internal['unitName'])
            failure.phase = 'dependency-' + phase + '/' + failure.phase
            raise failure
        if code:
            raise NativeFailure('original-dependency-owner-rejected', phase='dependency-' + phase, unit_name=internal['unitName'], exit_code=code, stderr=stderr, stderr_complete=True)
        observed = json.loads(stdout, object_pairs_hook=no_duplicates)
        exact(observed, ['schema', 'authority', 'phase', 'kind', 'deadlineAtUnixMs', 'transportDigest', 'status', 'contentRetirement', 'trusted', 'workspace'], 'dependency-result')
        if stdout != canonical(observed) + b'\n' or observed['schema'] != 'sec-native-verification-dependency-result-v1' or observed['authority'] != 'projection-only':
            raise Unavailable('dependency-result-projection')
        for key in ['phase', 'kind', 'deadlineAtUnixMs', 'transportDigest']:
            if observed[key] != packet[key]:
                raise Unavailable('dependency-result-binding')
        if observed['status'] != ('prepared' if phase == 'prepare' else 'observed'):
            raise Unavailable('dependency-result-status')
        if phase == 'observe' and (observed['trusted']['requiresFreshProcess'] or (observed['workspace'] is not None and observed['workspace']['requiresFreshProcess'])):
            raise Unavailable('dependency-fresh-process-unsettled')
        if observed['contentRetirement'] != ('released' if phase == 'prepare' else 'not-retained'):
            raise Unavailable('dependency-input-retirement')
        required_workspace = request['invocation']['kind'] in ('verification-action', 'main-health', 'hosted-sut')
        if (observed['workspace'] is not None) != required_workspace:
            raise Unavailable('dependency-target-closure')
        for name in ['trusted'] + (['workspace'] if required_workspace else []):
            ready = exact(observed[name], ['generationDigest', 'manifestHash', 'transitionDigest', 'requiresFreshProcess'], 'dependency-ready')
            if not DIGEST.fullmatch(ready['generationDigest']) or not DIGEST.fullmatch(ready['transitionDigest']) or not re.fullmatch('[0-9a-f]{64}', ready['manifestHash']):
                raise Unavailable('dependency-ready-identity')
            if phase == 'observe' and any(ready[key] != outputs[0][name][key] for key in ['generationDigest', 'manifestHash']):
                raise Unavailable('dependency-publication-readback-drift')
            # transitionDigest includes original kind (published vs none), so
            # a real fresh-process observation need not repeat the publish hash.
        outputs.append(observed)
    return outputs


def read_request():
    global MAX_TOOL_PROCESSES, CLEANUP_MODE
    if len(sys.argv) != 5 or os.getresuid() != (0, 0, 0) or os.getresgid() != (0, 0, 0):
        raise Unavailable('fixed-root-arguments')
    deadline = int(sys.argv[1])
    control_deadline = Deadline(deadline)
    def expired(_signum, _frame):
        raise Unavailable('root-helper-deadline')
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, control_deadline.remaining())
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        raise Unavailable('request-bound')
    request = json.loads(raw, object_pairs_hook=no_duplicates)
    common = ['schema', 'mode', 'ordinal', 'operationIdentityDigest', 'boundAttemptDigest', 'inputDigest', 'invocationDigest', 'deadlineAtUnixMs', 'unitName', 'recoveryRoot', 'maximumControlProcesses']
    if request.get('mode') in ('recover', 'acknowledge'):
        exact(request, common + ['terminalReceiptDigest'], 'recovery-request')
        if request['schema'] != 'sec-linux-native-unit-recovery-request-v1':
            raise Unavailable('recovery-schema')
        if request['terminalReceiptDigest'] is not None and not DIGEST.fullmatch(request['terminalReceiptDigest']):
            raise Unavailable('terminal-digest')
    else:
        exact(request, common + ['profile', 'profileDigest', 'providerIdentityDigest', 'stopAtUnixMs', 'runtime', 'bundle', 'dependencies', 'sutArchive', 'invocation'], 'request')
        if request['schema'] != 'sec-linux-native-unit-request-v1' or request['mode'] != 'run':
            raise Unavailable('request-schema')
    if request['deadlineAtUnixMs'] != deadline or request['operationIdentityDigest'] != sys.argv[2] or request['boundAttemptDigest'] != sys.argv[3] or request['ordinal'] != int(sys.argv[4]):
        raise Unavailable('request-arguments')
    if not all(isinstance(request[key], str) and DIGEST.fullmatch(request[key]) for key in ['operationIdentityDigest', 'boundAttemptDigest', 'inputDigest', 'invocationDigest']):
        raise Unavailable('request-digest')
    name = 'sec-native-' + hashlib.sha256((sys.argv[2] + '\0' + sys.argv[3] + '\0' + sys.argv[4]).encode()).hexdigest()[:32] + '.service'
    if request['unitName'] != name or type(request['ordinal']) is not int or not 1 <= request['ordinal'] <= 512:
        raise Unavailable('request-unit-identity')
    if type(request['maximumControlProcesses']) is not int or not 1 <= request['maximumControlProcesses'] <= 64:
        raise Unavailable('control-process-allowance')
    MAX_TOOL_PROCESSES = request['maximumControlProcesses']
    CLEANUP_MODE = request['mode'] != 'run'
    if request['mode'] != 'run':
        return request, control_deadline, None
    if sha(canonical(request['profile'])) != request['profileDigest'] or request['profile']['revision'] != 'sec-linux-native-verification-unit-v1':
        raise Unavailable('request-profile')
    if request['profile']['cpuQuotaMicros'] != 200000 or request['profile']['cpuPeriodMicros'] != 100000 or request['profile']['memoryMaxBytes'] != 4294967296 or request['profile']['tasksMax'] != 256:
        raise Unavailable('request-resource-profile')
    if type(request['stopAtUnixMs']) is not int or request['stopAtUnixMs'] >= deadline:
        raise Unavailable('request-settlement-reserve')
    for key in ['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha']:
        if not re.fullmatch(r'[0-9a-f]{40}(?:[0-9a-f]{24})?', request['bundle'][key]):
            raise Unavailable('git-subject-shape')
    invocation = exact(request['invocation'], ['kind', 'argv', 'cwd', 'environment', 'stdin', 'outputFiles', 'maxStdoutBytes', 'maxStderrBytes'], 'invocation')
    if sha(canonical(invocation)) != request['invocationDigest'] or invocation['kind'] not in ('source-program', 'verification-action', 'main-health', 'hosted-sut', 'dependency-canary', 'lifecycle-canary'):
        raise Unavailable('invocation-identity')
    if not isinstance(invocation['argv'], list) or len(invocation['argv']) > 256 or any(not isinstance(value, str) or '\0' in value or len(value) > 16384 for value in invocation['argv']):
        raise Unavailable('argv-shape')
    if request['runtime']['manifest']['schema'] == 'sec-main-health-host-runtime-manifest-v1':
        if (invocation['kind'] != 'main-health' or invocation['cwd'] != 'candidate'
                or invocation['argv'] != ['run', 'test', '--', '--scope', 'fast']
                or invocation['stdin'] is not None or invocation['outputFiles']
                or request['bundle']['baseSha'] != request['bundle']['headSha']
                or request['bundle']['baseTreeSha'] != request['bundle']['headTreeSha']
                or request['sutArchive'] is not None):
            raise Unavailable('main-health-fixed-host-input')
    elif request['runtime']['manifest']['schema'] != 'sec-linux-verification-native-runtime-manifest-v1':
        raise Unavailable('runtime-input-kind')
    if not isinstance(invocation['environment'], dict) or any(not re.fullmatch(r'(?:CI|HOME|LANG|LC_ALL|TZ|TMPDIR|SEC_[A-Z0-9_]+)', key) or not isinstance(value, str) or '\0' in value for key, value in invocation['environment'].items()):
        raise Unavailable('environment-shape')
    if invocation['cwd'] not in ('trusted', 'candidate', 'scratch'):
        raise Unavailable('cwd-shape')
    if (invocation['kind'] == 'lifecycle-canary') != (request['dependencies'] is None):
        raise Unavailable('dependency-input-presence')
    if invocation['kind'] in ('hosted-sut', 'lifecycle-canary') and invocation['argv']:
        raise Unavailable('fixed-entry-arguments')
    for key in ['maxStdoutBytes', 'maxStderrBytes']:
        if type(invocation[key]) is not int or not 0 <= invocation[key] <= 64 * 1024 * 1024:
            raise Unavailable('output-byte-bound')
    if not isinstance(invocation['outputFiles'], list) or len(invocation['outputFiles']) > 8:
        raise Unavailable('output-file-count')
    for item in invocation['outputFiles']:
        exact(item, ['path', 'maxBytes'], 'output-file')
        if not isinstance(item['path'], str) or not item['path'].startswith('/sec-runtime/output/') or type(item['maxBytes']) is not int or not 0 <= item['maxBytes'] <= 64 * 1024 * 1024:
            raise Unavailable('output-file-bound')
        canonical_relative(item['path'][len('/sec-runtime/output/'):])
    return request, control_deadline, Deadline(request['stopAtUnixMs'])


def recovery_result(request):
    return {'schema': 'sec-linux-native-unit-recovery-result-v1', 'status': 'settled',
            'operationIdentityDigest': request['operationIdentityDigest'], 'boundAttemptDigest': request['boundAttemptDigest'],
            'inputDigest': request['inputDigest'], 'invocationDigest': request['invocationDigest'],
            'unitName': request['unitName'], 'qualification': 'not-issued'}


def cleanup_original_files(recovery):
    """Only fixed private objects, after both original native domains settle.

    Their tmpfs contents vanished with the original mount namespace. Never
    recursively delete a visible mount, foreign object or uncommitted record.
    """
    directories = {'rootfs', 'control', 'output'}
    streams = {'stdin', 'stdout', 'stderr'}
    names = set(os.listdir(recovery.fd))
    if not names <= directories | streams | {'record.json', 'lock'}:
        raise Unavailable('unknown-original-recovery-residue')
    root = os.fstat(recovery.fd)
    # Check the whole set before the first destructive action.
    for name in sorted(names & (directories | streams)):
        info = os.stat(name, dir_fd=recovery.fd, follow_symlinks=False)
        if info.st_uid != 0 or info.st_dev != root.st_dev:
            raise Unavailable('original-recovery-object-owner-or-mount')
        if name in directories:
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=recovery.fd)
            try:
                observed = os.fstat(fd)
                if (observed.st_dev, observed.st_ino) != (info.st_dev, info.st_ino) or os.listdir(fd):
                    raise Unavailable('original-recovery-directory-not-empty')
            finally:
                os.close(fd)
        elif info.st_nlink != 1 or (name == 'stdin' and (not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o400)) or (name != 'stdin' and (not stat.S_ISFIFO(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600)):
            raise Unavailable('original-recovery-stream-identity')
    for name in sorted(names & streams):
        os.unlink(name, dir_fd=recovery.fd)
    for name in sorted(names & directories):
        os.rmdir(name, dir_fd=recovery.fd)
    fsync_directory(recovery.fd)


def recorded_control(request, value):
    control = value.get('control')
    if not isinstance(control, dict) or control.get('name') != request['unitName'][:-len('.service')] + '-control.scope':
        raise Unavailable('original-control-domain-not-recorded')
    exact(control, ['name', 'invocationId', 'managerBootId', 'managerStartTime', 'cgroupPath', 'description'], 'original-control-domain')
    if (not re.fullmatch('[0-9a-f]{32}', control['invocationId']) or control['cgroupPath'] != '/system.slice/' + control['name']
            or control['description'] != 'sec-native-control:' + request['operationIdentityDigest'] + ':' + request['boundAttemptDigest'] + ':' + request['inputDigest']):
        raise Unavailable('original-control-domain-identity')
    return control


def settle_original_domains(request, value, deadline):
    control = recorded_control(request, value)
    settle_unit({**request, 'unitName': control['name']}, control, control['description'], deadline)
    name = value.get('activeUnitName')
    if name is None:
        if value['phase'] not in ('intent', 'terminal') or value.get('unit') is not None:
            raise Unavailable('native-recovery-state-unknown')
        return
    if not re.fullmatch(r'sec-native-[0-9a-f]{32}\.service', name):
        raise Unavailable('original-active-unit-name')
    unit = value.get('unit')
    if unit is None:
        # A random root-generated token was durable before StartTransientUnit.
        # Once its BindsTo control scope is gone, a delayed accepted start
        # cannot execute. CollectMode retires failed dependency starts.
        properties = unit_readback(name, deadline)
        manager = {'boot': control['managerBootId'], 'start': control['managerStartTime']}
        if manager != manager_identity():
            raise Unavailable('manager-changed-before-recovery')
        if properties['LoadState'] == 'not-found':
            if not cgroup_empty({'cgroupPath': '/system.slice/' + name}):
                raise Unavailable('unobserved-unit-domain-not-empty')
            return
        observe_control_dependency(properties, control)
        if properties['InvocationID'] == '' and properties['ActiveState'] in ('inactive', 'failed'):
            if properties['Id'] != name or properties['Description'] != value['description'] or properties['ControlGroup'] not in ('', '/system.slice/' + name):
                raise Unavailable('unobserved-terminal-unit-identity')
            unit = {'name': name, 'invocationId': '', 'managerBootId': manager['boot'], 'managerStartTime': manager['start'], 'cgroupPath': '/system.slice/' + name}
        else:
            unit = accepted_unit(name, properties, value['description'], manager)
    settle_unit({**request, 'unitName': name}, unit, value['description'], deadline)


def recover(request, deadline):
    try:
        recovery = RecoveryRecord(request, 'recover', deadline=deadline)
    except FileNotFoundError:
        # Distinguish absent exact directory from record-unlink/lock/rmdir cuts.
        # A missing record inside a surviving root is retained unknown residue.
        namespace = request['recoveryRoot']
        parent = nofollow_directory(namespace['path'])
        try:
            info = os.fstat(parent)
            if (str(info.st_dev), str(info.st_ino)) != (namespace['device'], namespace['inode']):
                raise Unavailable('original-recovery-namespace-replaced')
            try:
                os.stat(request['unitName'][:-len('.service')], dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                if request['terminalReceiptDigest'] is not None:
                    return recovery_result(request)
            raise Unavailable('original-recovery-record-unavailable-or-partially-retired')
        finally:
            os.close(parent)
    try:
        value = recovery.value
        settle_original_domains(request, value, deadline)
        if value['phase'] == 'terminal':
            if request['mode'] == 'acknowledge':
                if request['terminalReceiptDigest'] is None or request['terminalReceiptDigest'] not in (value.get('terminalReceiptDigest'), value.get('terminalCleanupDigest')):
                    raise Unavailable('terminal-receipt-transplant')
                recovery.retire()
            else:
                cleanup_digest = sha(canonical(recovery_result(request)))
                if value.get('terminalCleanupDigest') != cleanup_digest:
                    recovery.update({**value, 'terminalCleanupDigest': cleanup_digest})
            return recovery_result(request)
        if request['mode'] == 'acknowledge':
            raise Unavailable('acknowledgment-before-terminal')
        cleanup_original_files(recovery)
        cleanup_digest = sha(canonical(recovery_result(request)))
        recovery.update({**value, 'phase': 'terminal', 'terminalCleanupDigest': cleanup_digest})
        return recovery_result(request)
    finally:
        recovery.close()


def run(request, control_deadline, execution_deadline):
    # Include the outer fixed systemd-run scope wrapper in the original pool.
    reserve_processes()
    # Retain the directory in the SAME private mount namespace that creates
    # the subsequent mountpoints and is exported by the exact /proc/PID/fd.
    if LIBC.unshare(0x00020000) != 0:
        raise OSError(ctypes.get_errno(), 'private-manager-mount-namespace')
    mount(None, '/', None, 0x40000 | 0x4000, None)
    control_identity = original_control(request, control_deadline)
    recovery = RecoveryRecord(request, 'run', control_identity)
    root = recovery.path + '/rootfs'
    control, output = recovery.path + '/control', recovery.path + '/output'
    mounted = []
    terminal = False
    try:
        for directory, size in [(root, '4G'), (control, '1M'), (output, '512M')]:
            os.mkdir(directory, 0o755)
            mount('tmpfs', directory, 'tmpfs', 2 | 4, 'size=' + size + ',mode=0755')
            mounted.append(directory)
            # Retain the mounted tmpfs view, never a pre-mount directory inode.
            MOUNT_HANDLES[directory] = nofollow_directory(directory)
            if os.fstat(MOUNT_HANDLES[directory]).st_dev == os.fstat(recovery.fd).st_dev:
                raise Unavailable('private-tmpfs-not-observed')
        copy_runtime(request, root, execution_deadline)
        for relative in ['sec-runtime', 'authenticated-input', 'tmp', 'proc', 'dev', 'sys']:
            create_runtime_directory(MOUNT_HANDLES[root], relative, 0o755)
        for relative in ['control', 'output']:
            parent, leaf = relative_parent(MOUNT_HANDLES[root], 'sec-runtime/' + relative)
            try:
                create_runtime_directory(parent, leaf, 0o755)
            finally:
                os.close(parent)
        os.chown(output, 65532, 65532)
        os.chmod(output, 0o700)
        bundle = root + '/authenticated-input/candidate.bundle'
        copy_transport(request['bundle'], bundle, execution_deadline)
        os.chmod(bundle, 0o444)
        trusted, candidate = root + '/sec-runtime/trusted', root + '/sec-runtime/workspace'
        materialize_git(request, trusted, bundle, execution_deadline)
        materialize_git(request, candidate, bundle, execution_deadline)
        git(trusted, ['checkout', '--quiet', '--detach', request['bundle']['baseSha']], execution_deadline)
        git(candidate, ['checkout', '--quiet', '--detach', request['bundle']['headSha']], execution_deadline)
        if request['sutArchive'] is not None:
            archive = root + '/authenticated-input/prepared-candidate.tar'
            copy_transport(request['sutArchive'], archive, execution_deadline)
            os.chmod(archive, 0o444)
        dependency_observation = None
        if request['dependencies'] is not None:
            dependency_observation = dependency_setup(request, recovery, root, control, output, execution_deadline, control_deadline)
        request['dependencyObservation'] = dependency_observation
        before = git_identity(request, trusted, candidate, execution_deadline)
        # Only the same mounted superblock is sealed. Never copy/chown/chmod an
        # already-published dependency generation or transplant its old markers.
        mount(None, root, None, 32 | 1 | 2 | 4, None)
        for name in ['launch.json', 'admit']:
            try:
                os.unlink(control + '/' + name)
            except FileNotFoundError:
                pass
        for name in ['stdin', 'stdout', 'stderr']:
            try:
                os.unlink(recovery.path + '/' + name)
            except FileNotFoundError:
                pass
        with final_output_directory(request['invocation'], output) as final_output:
            unit, code, stdout, stderr, output_files = launch_unit(request, recovery, root, control, final_output, execution_deadline, control_deadline)
        after = git_identity(request, trusted, candidate, control_deadline)
        if before != after:
            raise Unavailable('source-changed')
        for directory in reversed(mounted):
            os.close(MOUNT_HANDLES.pop(directory))
            unmount(directory)
        mounted.clear()
        for relative in ['rootfs', 'control', 'output']:
            os.rmdir(recovery.path + '/' + relative)
        for relative in ['stdin', 'stdout', 'stderr']:
            os.unlink(recovery.path + '/' + relative)
        body = {'schema': 'sec-linux-native-verification-unit-receipt-v1', 'profileRevision': request['profile']['revision'],
                'profileDigest': request['profileDigest'], 'operationIdentityDigest': request['operationIdentityDigest'],
                'boundAttemptDigest': request['boundAttemptDigest'], 'providerIdentityDigest': request['providerIdentityDigest'],
                'inputDigest': request['inputDigest'], 'invocationDigest': request['invocationDigest'], 'deadlineAtUnixMs': request['deadlineAtUnixMs'],
                'unit': unit, 'inputs': {'runtimeManifestDigest': request['runtime']['manifestDigest'], 'bundleDigest': request['bundle']['byteDigest'],
                                       'dependencyContentDigest': None if request['dependencies'] is None else request['dependencies']['generationDigest'],
                                       'sutArchiveDigest': None if request['sutArchive'] is None else request['sutArchive']['byteDigest']},
                'gitBefore': before, 'gitAfter': after,
                'execution': {'exitCode': code, 'stdoutDigest': sha(stdout), 'stderrDigest': sha(stderr), 'stdoutBytes': len(stdout), 'stderrBytes': len(stderr), 'outputTruncated': False},
                'outputFiles': [{'path': name, 'digest': sha(data), 'bytes': len(data)} for name, data in sorted(output_files.items())],
                'settlement': {'unitInactive': True, 'cgroupEmpty': True, 'privateMountsRetired': True, 'inputsRetired': True}}
        receipt = {**body, 'receiptDigest': sha(canonical(body))}
        recovery.update({**recovery.value, 'phase': 'terminal', 'unit': unit, 'terminalReceiptDigest': receipt['receiptDigest'], 'dependencyObservation': dependency_observation})
        # Parent acknowledges this exact tombstone in a later retained helper
        # call. A stdout-loss crash must still have real cleanup evidence.
        terminal = True
        return {'receipt': receipt, 'stdout': base64.b64encode(stdout).decode(), 'stderr': base64.b64encode(stderr).decode(),
                'outputFiles': {name: base64.b64encode(data).decode() for name, data in output_files.items()}}
    finally:
        # Never erase an uncertain native effect's recovery record. Private
        # namespace mounts vanish on helper exit, but this is not a receipt.
        recovery.close()
        if not terminal:
            sys.stderr.write('native unit recovery retained: ' + request['unitName'] + '\n')


if __name__ == '__main__':
    try:
        request, control_deadline, execution_deadline = read_request()
        result = run(request, control_deadline, execution_deadline) if request['mode'] == 'run' else recover(request, control_deadline)
        sys.stdout.buffer.write(canonical(result) + b'\n')
        sys.stdout.buffer.flush()
    except BaseException as error:
        # The existing bounded transport retains diagnostics. Stderr is only
        # a presentation summary, never the sole copy of a native failure.
        context = locals().get('request', {})
        failure = native_failure(error, phase='native-' + context.get('mode', 'request'), unit_name=context.get('unitName'))
        if context.get('mode') == 'run':
            diagnostic = failure.projection()
            diagnostic['message'] = ''.join(traceback.format_exception(error))
            sys.stdout.buffer.write(canonical(diagnostic) + b'\n')
            sys.stdout.buffer.flush()
        sys.stderr.write('fixed native unit failed: ' + failure.error_type + ': ' + str(failure)[:512] + '\n')
        sys.exit(1)
