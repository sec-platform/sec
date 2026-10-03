#!/usr/bin/python3
"""Trusted Linux observer. Only this parent writes the structured stdout channel.

The input is a fixed plan already admitted by verification-sut.ts, not a shell
API. Run only through its retained ProcessResourceSession owner with -I -S.
Linux v6.8 kernel/pid_namespace.c:202-228 requires continuously reaping traced
children before the namespace init can finish. Its *terminal reap*, not a
TRACEEXIT event or an empty tracer list, proves the namespace has no members,
including CLONE_UNTRACED and nested-namespace descendants.
"""
import contextlib
import ctypes
import errno
import hashlib
import json
import os
import selectors
import signal
import stat
import sys
import time

REQUEST_SCHEMA = 'sec-hosted-sut-supervisor-request-v1'
RESPONSE_SCHEMA = 'sec-hosted-sut-supervisor-response-v1'
MAX_REQUEST = 1024 * 1024
OUTPUT_LIMIT = 8 * 1024 * 1024
TAIL_LIMIT = 64 * 1024
MAX_TRACED = 256
MAX_EVENTS = 1000000
WALL = 0x40000000
TRACEME, CONT, SETOPTIONS, GETEVENTMSG = 0, 7, 0x4200, 0x4201
EVENT_FORK, EVENT_VFORK, EVENT_CLONE, EVENT_EXEC, EVENT_EXIT = 1, 2, 3, 4, 6
OPTIONS = 0x00000002 | 0x00000004 | 0x00000008 | 0x00000010 | 0x00000040 | 0x00100000
NS_NAMES = ('mnt', 'pid', 'net', 'user')
LIBC = ctypes.CDLL(None, use_errno=True)
LIBC.ptrace.restype = ctypes.c_long
LIBC.setfsuid.argtypes = [ctypes.c_uint]
LIBC.setfsuid.restype = ctypes.c_uint
LIBC.setfsgid.argtypes = [ctypes.c_uint]
LIBC.setfsgid.restype = ctypes.c_uint


def ptrace(request, pid, data=0):
    ctypes.set_errno(0)
    result = LIBC.ptrace(ctypes.c_uint(request), ctypes.c_uint(pid),
                         ctypes.c_void_p(0), ctypes.c_void_p(data))
    if result == -1 and ctypes.get_errno():
        raise OSError(ctypes.get_errno(), 'ptrace request failed')
    return result


def event_message(pid):
    value = ctypes.c_ulong()
    ptrace(GETEVENTMSG, pid, ctypes.addressof(value))
    return value.value


def identity(fd):
    value = os.fstat(fd)
    return (value.st_dev, value.st_ino)


def bounded_read(path, limit):
    with open(path, 'rb', buffering=0) as source:
        value = source.read(limit + 1)
    if len(value) > limit:
        raise ValueError('bounded process observation exceeded limit')
    return value


def process_status(pid):
    lines = bounded_read('/proc/%d/status' % pid, 65536).decode('ascii').splitlines()
    return dict(line.split(':', 1) for line in lines if ':' in line)


def numbers(status, key):
    return tuple(int(value) for value in status[key].split())


def parse_process_start_identity(source, expected_pid):
    """Pure /proc stat parser: comm may itself contain spaces and ')' bytes."""
    if type(expected_pid) is not int or expected_pid < 1 or not isinstance(source, str):
        raise ValueError('process start identity input is invalid')
    end = source.rfind(')')
    if not source.startswith(str(expected_pid) + ' (') or end < 0 or source[end + 1:end + 2] != ' ':
        raise ValueError('process start identity PID or comm is invalid')
    fields = source[end + 2:].split()
    # The tail begins at field 3 (state); starttime is Linux stat field 22.
    if (len(fields) < 20 or len(fields[0]) != 1 or not fields[19].isascii()
            or not fields[19].isdecimal() or str(int(fields[19])) != fields[19]):
        raise ValueError('process start identity stat fields are invalid')
    return (expected_pid, fields[19])


def assert_same_process_start_identity(retained, observed):
    if retained != observed:
        raise ValueError('retained namespace init process start identity changed')


def process_start_identity(pid):
    return parse_process_start_identity(
        bounded_read('/proc/%d/stat' % pid, 65536).decode('utf-8', errors='strict'), pid)


@contextlib.contextmanager
def filesystem_credentials(uid, gid):
    """Observe actual /proc FSCREDS gates without granting CAP_SYS_PTRACE.

    The single-threaded parent keeps real/effective/saved IDs root. Plain exec
    restores dumpability (Linux fs/exec.c:1291-1296). ptrace.c:280-300 uses these
    filesystem IDs; commoncap requires the candidate's empty permitted set to
    be a subset. LSM/hidepid/dumpability denial stays a failed observation.
    Restoration is checked even when a read fails; no inferred success path.
    """
    old_uid = LIBC.setfsuid(0xffffffff)
    old_gid = LIBC.setfsgid(0xffffffff)
    try:
        LIBC.setfsgid(gid)
        LIBC.setfsuid(uid)
        if LIBC.setfsuid(0xffffffff) != uid or LIBC.setfsgid(0xffffffff) != gid:
            raise PermissionError('filesystem credential observation unavailable')
        yield
    finally:
        LIBC.setfsuid(old_uid)
        LIBC.setfsgid(old_gid)
        if LIBC.setfsuid(0xffffffff) != old_uid or LIBC.setfsgid(0xffffffff) != old_gid:
            # Do not run cleanup/control I/O with unexpectedly changed creds.
            os._exit(126)


def namespaces(pid):
    descriptors = {}
    try:
        for name in NS_NAMES:
            descriptors[name] = os.open('/proc/%d/ns/%s' % (pid, name), os.O_RDONLY | os.O_CLOEXEC)
        return descriptors
    except BaseException:
        for fd in descriptors.values():
            os.close(fd)
        raise


def file_digest(fd, maximum_bytes=512 * 1024 * 1024, assert_current=lambda: None):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_size < 0 or before.st_size > maximum_bytes:
        raise ValueError('observed input is not a bounded ordinary file')
    digest = hashlib.sha256()
    offset = 0
    while offset < before.st_size:
        assert_current()
        chunk = os.pread(fd, min(1024 * 1024, before.st_size - offset), offset)
        if not chunk:
            raise ValueError('candidate executable changed during observation')
        digest.update(chunk)
        offset += len(chunk)
    after = os.fstat(fd)
    assert_current()
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('candidate executable changed during observation')
    return digest.hexdigest()


def process_vector(pid, name):
    value = bounded_read('/proc/%d/%s' % (pid, name), MAX_REQUEST)
    if not value or not value.endswith(b'\0'):
        raise ValueError('process argument/environment vector is incomplete')
    return [part.decode('utf-8', errors='strict') for part in value[:-1].split(b'\0')]


def open_owned_member(root_fd, relative, directory=False):
    """No-follow every component; the trusted root retains replacement control."""
    parts = relative.split('/')
    if not parts or any(part in ('', '.', '..') for part in parts):
        raise ValueError('trusted member path is not fixed relative input')
    current = os.dup(root_fd)
    try:
        for index, part in enumerate(parts):
            is_directory = index < len(parts) - 1 or directory
            child = os.open(part, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
                            | (os.O_DIRECTORY if is_directory else 0), dir_fd=current)
            os.close(current)
            current = child
            value = os.fstat(current)
            if value.st_uid != 0 or value.st_gid != 0 or value.st_mode & 0o022:
                raise ValueError('trusted member is replaceable by isolated credentials')
            if not is_directory and (not stat.S_ISREG(value.st_mode) or value.st_nlink != 1 or value.st_mode & 0o222):
                raise ValueError('trusted member is not one root-owned read-only ordinary file')
        result = current
        current = None
        return result
    finally:
        if current is not None:
            os.close(current)


class Capture:
    def __init__(self):
        self.digest = hashlib.sha256()
        self.count = 0
        self.hashed = 0
        self.tail = b''
        self.eof = False

    def add(self, chunk):
        self.count += len(chunk)
        remaining = max(0, OUTPUT_LIMIT - self.hashed)
        retained = chunk[:remaining]
        self.digest.update(retained)
        self.hashed += len(retained)
        self.tail = (self.tail + chunk)[-TAIL_LIMIT:]

    def report(self):
        return {'digest': 'sha256:' + self.digest.hexdigest(), 'bytesObserved': self.count,
                'tailHex': self.tail.hex(), 'eof': self.eof}


def classify_wait_status(status):
    """Pure Linux wait-status classification; ordinary SIGTRAP is not exec."""
    low = status & 0xffff
    if low == 0xffff:
        return 'continued'
    if low & 0x7f == 0 or low & 0x7f != 0x7f:
        return 'terminal'
    if (status >> 8) & 0xff != 5:
        return 'signal-stop'
    event = status >> 16
    if event == 4:
        return 'exec'
    if event == 6:
        return 'exit-stop'
    return 'event-stop' if event else 'signal-stop'


def join_exec_lineage(tracees, pid, former_tid):
    """Pure transition. Only a real kernel EXEC event may call this owner."""
    if former_tid == pid:
        if pid not in tracees:
            raise ValueError('exec PID was not traced')
        return
    if former_tid not in tracees or tracees[former_tid]['initial']:
        raise ValueError('exec former thread identity was not live and stopped')
    if pid in tracees and tracees[pid]['initial']:
        raise ValueError('exec leader still has an unconsumed initial stop')
    # The former thread already belongs to this kernel-attached lineage. A
    # reaped old leader needs no synthetic fork and no guessed PID admission.
    tracees[pid] = tracees.pop(former_tid)


def unit_is_settled(root_closed, tracees_empty, pending_empty, streams_eof,
                    namespace_established, init_reaped, candidate_started, gap):
    """A trace inventory alone cannot account for CLONE_UNTRACED children."""
    return (root_closed and tracees_empty and pending_empty and streams_eof
            and (init_reaped if namespace_established else not candidate_started)
            and gap is None)


def preparation_is_settled(started, leader_succeeded, namespace_init_reaped,
                           namespace_init_succeeded, launcher_succeeded,
                           tracees, pending_empty, gap):
    """Only nested PID-init terminal reap closes untraced/io-worker members.

    Empty traced inventory, adapter output and TRACEEXIT cannot substitute for
    that kernel boundary. The additional inventory still accounts for every
    observer-owned stop before trusted setup may retire the archive/base.
    """
    return (started and leader_succeeded and namespace_init_reaped
            and namespace_init_succeeded and launcher_succeeded
            and not any(record.get('preparation', False) for record in tracees.values())
            and pending_empty and gap is None)


def read_request():
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        raise ValueError('supervisor input exceeds limit')
    request = json.loads(raw)
    if set(request) != {'schema', 'operationIdentityDigest', 'boundAttemptDigest',
                        'deadlineAtUnixMs', 'stopAtUnixMs', 'plan', 'archiveDescriptor', 'bunExecutableDigest',
                        'preparation'}:
        raise ValueError('supervisor request fields invalid')
    if request['schema'] != REQUEST_SCHEMA:
        raise ValueError('supervisor request schema invalid')
    for key in ('deadlineAtUnixMs', 'stopAtUnixMs'):
        if type(request[key]) is not int or request[key] < 1:
            raise ValueError('supervisor deadline invalid')
    if request['stopAtUnixMs'] > request['deadlineAtUnixMs']:
        raise ValueError('supervisor deadline widening')
    plan = request['plan']
    consumes_archive = plan['phase'] in ('execute', 'bootstrap-execute')
    if request['archiveDescriptor'] != (6 if consumes_archive else None):
        raise ValueError('supervisor archive mapping invalid')
    if plan['command'] != ('/usr/bin/bash' if plan['phase'] == 'teardown' else '/usr/bin/unshare'):
        raise ValueError('supervisor command differs from phase')
    if not isinstance(plan['argv'], list) or any(not isinstance(x, str) or '\0' in x for x in plan['argv']):
        raise ValueError('supervisor argv invalid')
    preparation = request['preparation']
    if consumes_archive != (preparation is not None):
        raise ValueError('production execution requires its authenticated preparation binding')
    if preparation is not None:
        if set(preparation) != {'binding', 'argv', 'namespaceArgv', 'settlementArgv', 'moduleDigest',
                                'archiveBytes', 'candidateArgv', 'candidateGuardArgv', 'environment'}:
            raise ValueError('preparation observation fields invalid')
        for name in ('argv', 'namespaceArgv', 'settlementArgv', 'candidateArgv', 'environment'):
            vector = preparation[name]
            if not isinstance(vector, list) or not vector or any(not isinstance(value, str) or '\0' in value for value in vector):
                raise ValueError('preparation observation vector invalid')
        guard = preparation['candidateGuardArgv']
        if guard is not None and (not isinstance(guard, list) or not guard
                                  or any(not isinstance(value, str) or '\0' in value for value in guard)):
            raise ValueError('candidate guard observation vector invalid')
        if (type(preparation['archiveBytes']) is not int or preparation['archiveBytes'] < 0
                or preparation['binding']['deadlineAtUnixMs'] != request['deadlineAtUnixMs']
                or preparation['binding']['archiveDigest'] != plan['argv'][11]
                or preparation['argv'][-1] != plan['argv'][15]):
            raise ValueError('preparation binding differs from original session or archive')
    return request


def observe(request):
    plan = request['plan']
    preparation = request['preparation']
    teardown = plan['phase'] == 'teardown'
    start_wall = time.time() * 1000
    start_mono = time.monotonic() * 1000
    hard_mono = start_mono + max(0, request['deadlineAtUnixMs'] - start_wall)
    stop_mono = start_mono + max(0, request['stopAtUnixMs'] - start_wall)
    if start_wall >= request['stopAtUnixMs']:
        raise ValueError('supervisor deadline exhausted before fork')
    if sys.platform != 'linux' or os.getresuid() != (0, 0, 0) or os.getresgid() != (0, 0, 0):
        raise ValueError('supervisor requires trusted Linux root parent')
    stopped = {'cancelled': False}
    def cancel(_signal, _frame):
        stopped['cancelled'] = True
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)

    def assert_execution_budget():
        if stopped['cancelled'] or time.monotonic() * 1000 >= stop_mono or time.time() * 1000 >= request['stopAtUnixMs']:
            raise TimeoutError('original operation cancelled or deadline exhausted')

    parent_namespaces = namespaces(os.getpid())
    expected_bun_digest = None
    if not teardown:
        # Positions are owned by the original exact command-plan grammar.
        bun_path = plan['argv'][10] if plan['phase'] == 'capability-self-test' else plan['argv'][12]
        fd = os.open(bun_path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        try:
            expected_bun_digest = file_digest(fd, assert_current=assert_execution_budget)
            if 'sha256:' + expected_bun_digest != request['bunExecutableDigest']:
                raise ValueError('plan Bun differs from original trusted runtime authority')
        finally:
            os.close(fd)
    captures = {'stdout': Capture(), 'stderr': Capture()}
    selector = selectors.DefaultSelector()
    pipes = [os.pipe2(os.O_CLOEXEC) for _ in captures]
    # Namespace/file observations consume the original budget as well. Never
    # fork after a slow hash crossed it, and never refresh the deadline here.
    assert_execution_budget()
    root_pid = os.fork()
    if root_pid == 0:
        try:
            # Close the parent's control stdout/stderr before the trace handshake.
            # Candidate bytes can only reach these two private capture pipes.
            os.dup2(pipes[0][1], 1)
            os.dup2(pipes[1][1], 2)
            null_fd = os.open('/dev/null', os.O_RDONLY)
            os.dup2(null_fd, 0)
            if request['archiveDescriptor'] is not None:
                os.dup2(6, 3, inheritable=True)
            for descriptor in os.listdir('/proc/self/fd'):
                fd = int(descriptor)
                if fd > 2 and not (fd == 3 and request['archiveDescriptor'] is not None):
                    try:
                        os.close(fd)
                    except OSError as error:
                        if error.errno != errno.EBADF:
                            raise
            ptrace(TRACEME, 0)
            os.kill(os.getpid(), signal.SIGSTOP)
            os.execve(plan['command'], [plan['command']] + plan['argv'],
                      {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        except BaseException as error:
            # Trusted setup diagnostics use the private stderr pipe as data;
            # this child never writes the structured stdout control channel.
            try:
                os.write(2, ('trusted trace handshake failed: ' + type(error).__name__ + ': ' + str(error)[:512] + '\n').encode('utf-8'))
            finally:
                os._exit(126)
    for (kind, capture), (read_fd, write_fd) in zip(captures.items(), pipes):
        os.close(write_fd)
        os.set_blocking(read_fd, False)
        selector.register(read_fd, selectors.EVENT_READ, capture)
    # The parent retains its original source handles until its own exit. All
    # children closed inherited control/source handles before TRACEME; no later
    # fork is made by this parent. Never close guessed FD numbers here: an
    # absent archive slot could have been reused for a namespace handle.
    tracees = {root_pid: {'parent': None, 'initial': True}}
    retained_init_records = {}
    pending = {}
    init_pid = None
    init_namespaces = {}
    init_reaped = False
    candidate_started = False
    namespace_established = False
    sandbox_root_fd = None
    sandbox_executables = {}
    preparation_launcher_pid = None
    preparation_launcher_succeeded = False
    preparation_init_pid = None
    preparation_namespaces = {}
    preparation_init_reaped = False
    preparation_init_succeeded = False
    preparation_pid = None
    preparation_started = False
    preparation_leader_succeeded = False
    preparation_root_fd = None
    settlement_pid = None
    settlement_held = False
    settlement_released = False
    settlement_succeeded = False
    root_closed = False
    root_code = None
    root_signal = None
    observation_gap = None
    diagnostic = ''
    killing = False
    events = 0

    def kill_unit():
        nonlocal killing
        killing = True
        # The init kill closes even untraced/nested descendants in the kernel.
        for pid in dict.fromkeys([preparation_init_pid, init_pid, root_pid] + list(tracees)):
            if pid is not None and pid in tracees:
                try:
                    os.kill(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    # CAP_KILL is deliberately absent. Killing the root-owned
                    # namespace init is sufficient; a cross-UID signal denial
                    # does not confer new authority or prove settlement.
                    pass

    def inspect_initial(pid):
        nonlocal init_pid, init_namespaces, namespace_established
        nonlocal preparation_init_pid, preparation_namespaces
        if teardown or pid == root_pid:
            return
        nested = (preparation_launcher_pid is not None
                  and tracees[pid]['parent'] == preparation_launcher_pid)
        if init_pid is not None and not nested:
            return
        status = process_status(pid)
        observed = namespaces(pid)
        try:
            ids = {name: identity(fd) for name, fd in observed.items()}
            if nested:
                if preparation_init_pid is not None or init_pid is None or init_reaped:
                    raise ValueError('preparation PID namespace init is repeated or orphaned')
                outer_ids = {name: identity(fd) for name, fd in init_namespaces.items()}
                if (any(ids[name] == outer_ids[name] for name in ('mnt', 'pid'))
                        or any(ids[name] != outer_ids[name] for name in ('net', 'user'))
                        or numbers(status, 'NSpid')[-1] != 1
                        or numbers(status, 'Uid') != (0, 0, 0, 0)
                        or numbers(status, 'Gid') != (0, 0, 0, 0)):
                    raise ValueError('preparation namespace differs from exact nested unshare lineage')
                preparation_init_pid = pid
                tracees[pid]['initStartIdentity'] = process_start_identity(pid)
                retained_init_records[pid] = tracees[pid]
                preparation_namespaces = observed
                observed = {}
                tracees[pid]['preparation'] = True
                return
            parent_ids = {name: identity(fd) for name, fd in parent_namespaces.items()}
            if ids['pid'] == parent_ids['pid']:
                return
            if tracees[pid]['parent'] != root_pid or numbers(status, 'NSpid')[-1] != 1:
                raise ValueError('new PID namespace init lacks direct traced unshare lineage')
            if any(ids[name] == parent_ids[name] for name in ('mnt', 'pid', 'net')) or ids['user'] != parent_ids['user']:
                raise ValueError('namespace establishment differs from exact unshare plan')
            init_pid = pid
            tracees[pid]['initStartIdentity'] = process_start_identity(pid)
            retained_init_records[pid] = tracees[pid]
            init_namespaces = observed
            observed = {}
            namespace_established = True
        finally:
            for fd in observed.values():
                os.close(fd)

    def preparation_settled():
        return preparation_is_settled(preparation_started, preparation_leader_succeeded,
                                      preparation_init_reaped, preparation_init_succeeded,
                                      preparation_launcher_succeeded, tracees, not pending,
                                      observation_gap)

    def assert_namespace_member(pid, retained_namespaces):
        observed = namespaces(pid)
        try:
            if any(identity(observed[name]) != identity(retained_namespaces[name]) for name in NS_NAMES):
                raise ValueError('isolated namespace differs from retained init')
        finally:
            for fd in observed.values():
                os.close(fd)

    def retained_init_record(pid):
        retained = retained_init_records.get(pid)
        if retained is None or tracees.get(pid) is not retained or retained.get('initStartIdentity') is None:
            raise ValueError('namespace init lost its original unreaped ptrace identity')
        return retained

    def assert_live_init_identity(pid):
        retained = retained_init_record(pid)
        # Missing/denied procfs or start-time drift is an observation failure.
        # Never search another PID or reconstruct an identity from its spelling.
        assert_same_process_start_identity(retained['initStartIdentity'], process_start_identity(pid))

    def assert_live_init(pid, retained_namespaces):
        assert_live_init_identity(pid)
        status = process_status(pid)
        if (numbers(status, 'Uid') != (0, 0, 0, 0) or numbers(status, 'Gid') != (0, 0, 0, 0)
                or numbers(status, 'NSpid')[-1] != 1):
            raise ValueError('namespace init lost its root-owned settlement identity')
        assert_namespace_member(pid, retained_namespaces)

    def inspect_exec(pid):
        nonlocal candidate_started, sandbox_root_fd, preparation_root_fd
        nonlocal preparation_launcher_pid, preparation_pid, preparation_started
        nonlocal settlement_pid, settlement_held
        if teardown or candidate_started:
            return True
        # Root-owned setup is observed before any isolated program executes.
        if init_pid is not None and sandbox_root_fd is None:
            try:
                candidate_root_path = '/proc/%d/root/tmp/%s' % (init_pid, plan['unitName'])
                root_fd = os.open(candidate_root_path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
                try:
                    names = ['tool/bin/bun', 'usr/bin/prlimit', 'usr/bin/env']
                    if preparation is not None:
                        names += ['usr/bin/bash', preparation['namespaceArgv'][0].lstrip('/'),
                                  preparation['settlementArgv'][0].lstrip('/')]
                    for name in dict.fromkeys(names):
                        sandbox_executables[name] = os.open(name, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=root_fd)
                    sandbox_root_fd = root_fd
                except BaseException:
                    os.close(root_fd)
                    for fd in sandbox_executables.values():
                        os.close(fd)
                    sandbox_executables.clear()
                    raise
            except FileNotFoundError:
                pass  # The admitted setup has not finished copying its closure.
        status = process_status(pid)
        uid = numbers(status, 'Uid')
        gid = numbers(status, 'Gid')
        record = tracees[pid]
        if uid == (0, 0, 0, 0) and gid == (0, 0, 0, 0):
            if sandbox_root_fd is None:
                return True
            executed = os.stat('/proc/%d/exe' % pid)
            executable_identity = (executed.st_dev, executed.st_ino)
            if executable_identity == identity(sandbox_executables['tool/bin/bun']):
                raise ValueError('Bun reached exec with root credentials')
            if preparation is not None:
                argv = process_vector(pid, 'cmdline')
                root = os.stat('/proc/%d/root' % pid)
                is_sandbox_root = (root.st_dev, root.st_ino) == identity(sandbox_root_fd)
                if executable_identity == identity(sandbox_executables[preparation['namespaceArgv'][0].lstrip('/')]):
                    if argv != preparation['namespaceArgv'] or not is_sandbox_root or preparation_launcher_pid is not None:
                        raise ValueError('preparation launcher differs from exact trusted namespace command')
                    assert_live_init(init_pid, init_namespaces)
                    assert_namespace_member(pid, init_namespaces)
                    preparation_launcher_pid = pid
                    record['preparation'] = True
                    return True
                if pid == preparation_init_pid:
                    if (executable_identity != identity(sandbox_executables['usr/bin/bash'])
                            or argv != preparation['namespaceArgv'][5:] or not is_sandbox_root
                            or record.get('preparationInitExec', False)):
                        raise ValueError('preparation namespace init differs from its fixed root shell')
                    assert_live_init(preparation_init_pid, preparation_namespaces)
                    record['preparationInitExec'] = True
                    return True
                if (executable_identity == identity(sandbox_executables[preparation['settlementArgv'][0].lstrip('/')])
                        and argv == preparation['settlementArgv']):
                    if (not preparation_started or settlement_pid is not None
                            or record.get('preparation', False) or not is_sandbox_root):
                        raise ValueError('preparation settlement rendezvous has invalid lineage')
                    assert_live_init(init_pid, init_namespaces)
                    assert_namespace_member(pid, init_namespaces)
                    settlement_pid = pid
                    settlement_held = True
                    return False  # Hold at EXEC until actual nested-init terminal reap.
                if preparation_started and not settlement_released and not record.get('preparation', False):
                    raise ValueError('trusted setup advanced before preparation settlement rendezvous')
            return True
        if uid != (65532, 65532, 65532, 65532) or gid != (65532, 65532, 65532, 65532):
            raise ValueError('unexpected credentials before candidate exec')
        is_preparation = record.get('preparation', False)
        with filesystem_credentials(65532, 65532):
            if sandbox_root_fd is None:
                raise ValueError('isolated exec lacks retained trusted root')
            executed = os.stat('/proc/%d/exe' % pid)
            executable_identity = (executed.st_dev, executed.st_ino)
            expected_namespaces = preparation_namespaces if is_preparation else init_namespaces
            if not expected_namespaces:
                raise ValueError('isolated exec lacks its observed namespace init')
            assert_namespace_member(pid, expected_namespaces)
            for name in ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'):
                if int(status[name].strip(), 16) != 0:
                    raise ValueError('isolated process retained capabilities')
            if numbers(status, 'NoNewPrivs') != (1,) or numbers(status, 'Groups'):
                raise ValueError('isolated no-new-privileges/groups mismatch')
            root = os.stat('/proc/%d/root' % pid)
            if (root.st_dev, root.st_ino) != identity(sandbox_root_fd):
                raise ValueError('isolated chroot differs from retained namespace root')
            if executable_identity in (identity(sandbox_executables['usr/bin/prlimit']),
                                       identity(sandbox_executables['usr/bin/env'])):
                return True
            # These are descendants of authenticated trusted-base code, never
            # a candidate start. Even untraced children are settled by the
            # nested PID init's eventual terminal reap, not this inventory.
            if is_preparation and preparation_started:
                if pid == preparation_pid:
                    raise ValueError('trusted preparation leader unexpectedly replaced itself')
                return True
            if preparation is not None and not is_preparation:
                if not settlement_succeeded or not preparation_settled():
                    raise ValueError('candidate launcher preceded preparation terminal settlement')
                guard = preparation['candidateGuardArgv']
                if guard is not None and executable_identity == identity(sandbox_executables[guard[0].lstrip('/')]):
                    if process_vector(pid, 'cmdline') != guard or record.get('candidateGuard') is not None:
                        raise ValueError('candidate guard differs from the fixed trusted program')
                    if {int(value) for value in os.listdir('/proc/%d/fd' % pid)} != {0, 1, 2}:
                        raise ValueError('candidate guard inherited non-stream descriptors')
                    filters = numbers(status, 'Seccomp_filters')
                    if len(filters) != 1 or filters[0] < 0:
                        raise ValueError('candidate guard lacks kernel filter observation')
                    record['candidateGuard'] = filters[0]
                    return True
            if executable_identity != identity(sandbox_executables['tool/bin/bun']):
                raise ValueError('unexpected isolated executable before Bun')
            executable_fd = os.open('/proc/%d/exe' % pid, os.O_RDONLY | os.O_CLOEXEC)
            try:
                if file_digest(executable_fd, assert_current=assert_execution_budget) != expected_bun_digest:
                    raise ValueError('isolated executable differs from trusted Bun bytes')
            finally:
                os.close(executable_fd)
            inherited = {int(value) for value in os.listdir('/proc/%d/fd' % pid)}
            if is_preparation:
                if preparation is None or preparation_started or pid == preparation_init_pid:
                    raise ValueError('preparation Bun must be a unique child of its trusted namespace init')
                if (process_vector(pid, 'cmdline') != preparation['argv']
                        or sorted(process_vector(pid, 'environ')) != sorted(preparation['environment'])
                        or inherited != {0, 1, 2, 3}):
                    raise ValueError('preparation argv/environment/archive descriptor projection differs')
                preparation_root_fd = open_owned_member(sandbox_root_fd, 'trusted-input-base', directory=True)
                cwd = os.stat('/proc/%d/cwd' % pid)
                if (cwd.st_dev, cwd.st_ino) != identity(preparation_root_fd):
                    raise ValueError('preparation cwd differs from authenticated base')
                module = open_owned_member(preparation_root_fd, 'src/adapters/verification/platform/ci/hosted-sut-dependency-preparation.ts')
                try:
                    if 'sha256:' + file_digest(module, assert_current=assert_execution_budget) != preparation['moduleDigest']:
                        raise ValueError('preparation module differs from actually loaded trusted base source')
                finally:
                    os.close(module)
                archive = os.open('/proc/%d/fd/3' % pid, os.O_RDONLY | os.O_CLOEXEC)
                named_archive = None
                try:
                    named_archive = open_owned_member(sandbox_root_fd, 'authenticated-input/prepared-candidate.tar')
                    metadata = os.fstat(archive)
                    info = dict(line.split(':', 1) for line in bounded_read('/proc/%d/fdinfo/3' % pid, 65536).decode('ascii').splitlines() if ':' in line)
                    if (identity(archive) != identity(named_archive) or metadata.st_uid != 0 or metadata.st_gid != 0
                            or stat.S_IMODE(metadata.st_mode) != 0o444 or metadata.st_nlink != 1
                            or metadata.st_size != preparation['archiveBytes'] or int(info['flags'].strip(), 8) & 3):
                        raise ValueError('preparation archive is not the exact read-only retained ordinary file')
                    if 'sha256:' + file_digest(archive, preparation['archiveBytes'], assert_execution_budget) != preparation['binding']['archiveDigest']:
                        raise ValueError('preparation archive bytes differ from original retained input')
                finally:
                    os.close(archive)
                    if named_archive is not None:
                        os.close(named_archive)
            else:
                if inherited != {0, 1, 2}:
                    raise ValueError('candidate inherited non-stream descriptors')
                if preparation is not None:
                    if process_vector(pid, 'cmdline') != preparation['candidateArgv']:
                        raise ValueError('candidate argv differs from exact admitted plan')
                    workspace = os.open('workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=sandbox_root_fd)
                    try:
                        cwd = os.stat('/proc/%d/cwd' % pid)
                        if (cwd.st_dev, cwd.st_ino) != identity(workspace):
                            raise ValueError('candidate cwd differs from retained workspace')
                    finally:
                        os.close(workspace)
                    if preparation['candidateGuardArgv'] is not None:
                        before = record.get('candidateGuard')
                        if before is None or numbers(status, 'Seccomp') != (2,) or numbers(status, 'Seccomp_filters') != (before + 1,):
                            raise ValueError('candidate lacks same-process fixed guard filter installation')
        # Namespace init is root; restore the observer's filesystem credentials
        # before inspecting its identity. Neither Bun may replace PID 1.
        required_init = preparation_init_pid if is_preparation else init_pid
        required_namespaces = preparation_namespaces if is_preparation else init_namespaces
        if pid == required_init:
            raise ValueError('Bun must not replace the trusted namespace init')
        assert_live_init(required_init, required_namespaces)
        assert_execution_budget()
        if is_preparation:
            preparation_pid = pid
            preparation_started = True
        else:
            candidate_started = True
        return True

    def resume(pid, forwarded_signal):
        # Cleanup must continue reaping after cancellation. Normal execution,
        # including the first instruction after Bun's EXEC stop, has one last
        # fence against the same original absolute cooperative deadline.
        if not killing:
            assert_execution_budget()
        ptrace(CONT, pid, forwarded_signal)

    def handle(pid, status):
        nonlocal root_closed, root_code, root_signal, init_reaped, events
        nonlocal preparation_init_reaped, preparation_init_succeeded, preparation_leader_succeeded
        nonlocal preparation_launcher_succeeded, settlement_succeeded, settlement_held
        events += 1
        if events > MAX_EVENTS:
            raise ValueError('supervisor ptrace event budget exhausted')
        wait_kind = classify_wait_status(status)
        if wait_kind in ('exec', 'exit-stop') and pid in retained_init_records:
            # Both stops still expose the live kernel task. PTRACE_EVENT_EXIT
            # is a last identity observation, never terminal settlement.
            assert_live_init_identity(pid)
        if wait_kind == 'exec':
            # GETEVENTMSG supplies the former TID even when this EXEC takes a
            # previously reaped leader PID. Join before membership/pending.
            join_exec_lineage(tracees, pid, event_message(pid))
        if pid not in tracees:
            if len(pending) >= MAX_TRACED or pid in pending:
                raise ValueError('supervisor pending trace event budget exhausted')
            pending[pid] = status
            return
        if wait_kind == 'terminal':
            if pid in retained_init_records:
                # waitpid has already reaped the task. /proc may now be absent
                # (or eventually name a new task), so bind this terminal event
                # to the original still-unreaped trace record instead of reading
                # a replacement task by PID after the kernel's terminal cut.
                retained_init_record(pid)
            succeeded = os.WIFEXITED(status) and os.WEXITSTATUS(status) == 0
            if pid == init_pid:
                init_reaped = True  # A genuine terminal waitpid result only.
            if pid == preparation_init_pid:
                preparation_init_reaped = True
                preparation_init_succeeded = succeeded
            if pid == preparation_pid:
                preparation_leader_succeeded = succeeded
            if pid == preparation_launcher_pid:
                preparation_launcher_succeeded = succeeded
            if pid == settlement_pid:
                settlement_succeeded = settlement_released and succeeded
                settlement_held = False
            if pid == root_pid:
                root_closed = True
                root_code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else None
                root_signal = signal.Signals(os.WTERMSIG(status)).name if os.WIFSIGNALED(status) else None
            del tracees[pid]
            return
        if not os.WIFSTOPPED(status):
            raise ValueError('unexpected nonterminal wait status')
        sig = os.WSTOPSIG(status)
        event = status >> 16
        record = tracees[pid]
        if record['initial']:
            if sig != signal.SIGSTOP or event != 0:
                raise ValueError('missing initial traced child stop')
            ptrace(SETOPTIONS, pid, OPTIONS)
            record['initial'] = False
            inspect_initial(pid)
            resume(pid, 0)
            return
        if event in (EVENT_FORK, EVENT_VFORK, EVENT_CLONE) and sig == signal.SIGTRAP:
            child_pid = event_message(pid)
            if child_pid in tracees or len(tracees) >= MAX_TRACED:
                raise ValueError('supervisor tracee budget/identity conflict')
            tracees[child_pid] = {'parent': pid, 'initial': True,
                                  'preparation': record.get('preparation', False)}
            if child_pid in pending:
                handle(child_pid, pending.pop(child_pid))
        elif event == EVENT_EXEC and sig == signal.SIGTRAP:
            if not inspect_exec(pid):
                return
        elif event == EVENT_EXIT and sig == signal.SIGTRAP:
            pass  # PRE-exit only. Never a settlement or a candidate-start fact.
        elif event != 0:
            raise ValueError('unexpected ptrace event')
        # Ordinary SIGTRAP is a signal, never an exec witness. Forward it.
        resume(pid, 0 if event != 0 else sig)

    try:
        while tracees or pending or selector.get_map():
            now = time.monotonic() * 1000
            if stopped['cancelled'] or now >= stop_mono or time.time() * 1000 >= request['stopAtUnixMs']:
                observation_gap = 'observation-lost'
                diagnostic = 'original operation cancelled or deadline exhausted'
                if not killing:
                    kill_unit()
            if now >= hard_mono or time.time() * 1000 >= request['deadlineAtUnixMs']:
                break
            for key, _mask in selector.select(0.005):
                try:
                    chunk = os.read(key.fd, 65536)
                except BlockingIOError:
                    continue
                if chunk:
                    key.data.add(chunk)
                    if key.data.count > OUTPUT_LIMIT and not killing:
                        diagnostic = 'candidate output exceeded fixed capture bound'
                        kill_unit()
                else:
                    key.data.eof = True
                    selector.unregister(key.fd)
                    os.close(key.fd)
            # Never wait only for init: kernel namespace shutdown can wait for
            # this tracer to reap a descendant first (pid_namespace.c:202-209).
            for _ in range(MAX_TRACED * 4):
                try:
                    pid, status = os.waitpid(-1, os.WNOHANG | WALL)
                except ChildProcessError:
                    if tracees or pending:
                        raise ValueError('tracee disappeared without terminal wait observation')
                    break
                if pid == 0:
                    break
                handle(pid, status)
            if settlement_held and not killing and preparation_settled():
                # The root rendezvous is still before its first instruction.
                # Only this kernel-derived cut releases archive/base cleanup.
                resume(settlement_pid, 0)
                settlement_held = False
                settlement_released = True
    except BaseException as error:
        observation_gap = 'observation-lost'
        diagnostic = type(error).__name__ + ': ' + str(error)[:1024]
        kill_unit()
        # Losing the observation state is irrevocable; drain/reap for cleanup
        # inside the original deadline but never manufacture a positive proof.
        while time.monotonic() * 1000 < hard_mono:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG | WALL)
            except ChildProcessError:
                break
            if pid == 0:
                time.sleep(0.005)
            elif os.WIFSTOPPED(status):
                try:
                    ptrace(CONT, pid, signal.SIGKILL)
                except OSError:
                    pass
    finally:
        for key in list(selector.get_map().values()):
            selector.unregister(key.fd)
            os.close(key.fd)
        selector.close()
        for fd in (list(parent_namespaces.values()) + list(init_namespaces.values())
                   + list(preparation_namespaces.values()) + list(sandbox_executables.values())
                   + ([] if sandbox_root_fd is None else [sandbox_root_fd])
                   + ([] if preparation_root_fd is None else [preparation_root_fd])):
            os.close(fd)
    complete_streams = all(capture.eof for capture in captures.values())
    terminal = root_closed and not tracees and not pending and complete_streams
    settled = unit_is_settled(root_closed, not tracees, not pending, complete_streams,
                              namespace_established, init_reaped, candidate_started, observation_gap)
    if not terminal:
        observation_gap = 'observation-lost'
    return {
        'schema': RESPONSE_SCHEMA,
        'operationIdentityDigest': request['operationIdentityDigest'],
        'boundAttemptDigest': request['boundAttemptDigest'],
        'deadlineAtUnixMs': request['deadlineAtUnixMs'],
        'stopAtUnixMs': request['stopAtUnixMs'],
        'planDigest': plan['planDigest'], 'phase': plan['phase'],
        'lifecycle': {
            'supervisorSpawned': True, 'supervisorClosed': root_closed,
            'supervisorCloseCode': root_code, 'supervisorSignal': root_signal,
            'namespaceEstablished': namespace_established if observation_gap is None else (True if namespace_established else None),
            'candidateStarted': candidate_started if observation_gap is None else (True if candidate_started else None),
            'candidateUnitSettled': True if settled else None,
            'observationGap': observation_gap},
        'namespaceInitReaped': init_reaped,
        'traceesReaped': not tracees and not pending,
        'stdout': captures['stdout'].report(), 'stderr': captures['stderr'].report(),
        'outputTruncated': any(capture.count > OUTPUT_LIMIT for capture in captures.values()),
        'diagnostic': diagnostic,
    }


def main():
    request = read_request()
    result = observe(request)
    # A single JSON object is the complete control protocol. Raw candidate
    # bytes never enter this channel (even if they resemble JSON or markers).
    sys.stdout.write(json.dumps(result, separators=(',', ':'), ensure_ascii=True) + '\n')
    sys.stdout.flush()


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        sys.stderr.write('trusted supervisor failed: ' + type(error).__name__ + ': ' + str(error)[:1024] + '\n')
        sys.exit(126)
