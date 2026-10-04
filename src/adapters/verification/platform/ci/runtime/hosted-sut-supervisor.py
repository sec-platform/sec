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


def file_digest(fd):
    before = os.fstat(fd)
    if not stat.S_ISREG(before.st_mode) or before.st_size > 512 * 1024 * 1024:
        raise ValueError('candidate executable is not a bounded ordinary file')
    digest = hashlib.sha256()
    offset = 0
    while offset < before.st_size:
        chunk = os.pread(fd, min(1024 * 1024, before.st_size - offset), offset)
        if not chunk:
            raise ValueError('candidate executable changed during observation')
        digest.update(chunk)
        offset += len(chunk)
    after = os.fstat(fd)
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('candidate executable changed during observation')
    return digest.hexdigest()


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


def read_request():
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    if len(raw) > MAX_REQUEST:
        raise ValueError('supervisor input exceeds limit')
    request = json.loads(raw)
    if set(request) != {'schema', 'operationIdentityDigest', 'boundAttemptDigest',
                        'deadlineAtUnixMs', 'stopAtUnixMs', 'plan', 'archiveDescriptor', 'bunExecutableDigest'}:
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
    return request


def observe(request):
    plan = request['plan']
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
            expected_bun_digest = file_digest(fd)
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
    pending = {}
    init_pid = None
    init_namespaces = {}
    init_reaped = False
    candidate_started = False
    namespace_established = False
    sandbox_root_fd = None
    sandbox_executables = {}
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
        for pid in dict.fromkeys([init_pid, root_pid] + list(tracees)):
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
        if teardown or init_pid is not None or pid == root_pid:
            return
        status = process_status(pid)
        observed = namespaces(pid)
        try:
            ids = {name: identity(fd) for name, fd in observed.items()}
            parent_ids = {name: identity(fd) for name, fd in parent_namespaces.items()}
            if ids['pid'] == parent_ids['pid']:
                return
            if tracees[pid]['parent'] != root_pid or numbers(status, 'NSpid')[-1] != 1:
                raise ValueError('new PID namespace init lacks direct traced unshare lineage')
            if any(ids[name] == parent_ids[name] for name in ('mnt', 'pid', 'net')) or ids['user'] != parent_ids['user']:
                raise ValueError('namespace establishment differs from exact unshare plan')
            init_pid = pid
            init_namespaces = observed
            observed = {}
            namespace_established = True
        finally:
            for fd in observed.values():
                os.close(fd)

    def inspect_exec(pid):
        nonlocal candidate_started, sandbox_root_fd
        if teardown or candidate_started:
            return
        # Retain the root before any isolated program runs. The trusted init
        # still has its pre-chroot root; pathname spelling of /proc/PID/exe
        # across mount namespaces is deliberately not treated as identity.
        if init_pid is not None and sandbox_root_fd is None:
            try:
                candidate_root_path = '/proc/%d/root/tmp/%s' % (init_pid, plan['unitName'])
                root_fd = os.open(candidate_root_path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
                try:
                    for name in ('tool/bin/bun', 'usr/bin/prlimit', 'usr/bin/env'):
                        fd = os.open(name, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW, dir_fd=root_fd)
                        sandbox_executables[name] = fd
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
        if uid == (0, 0, 0, 0) and gid == (0, 0, 0, 0):
            if sandbox_root_fd is not None:
                executed = os.stat('/proc/%d/exe' % pid)
                if (executed.st_dev, executed.st_ino) == identity(sandbox_executables['tool/bin/bun']):
                    raise ValueError('candidate Bun reached exec with root credentials')
            return  # Only the admitted trusted setup has executed so far.
        if uid != (65532, 65532, 65532, 65532) or gid != (65532, 65532, 65532, 65532):
            raise ValueError('unexpected credentials before candidate exec')
        with filesystem_credentials(65532, 65532):
            if sandbox_root_fd is None:
                raise ValueError('isolated exec lacks retained trusted root')
            executed = os.stat('/proc/%d/exe' % pid)
            executable_identity = (executed.st_dev, executed.st_ino)
            # setpriv's fixed prlimit and env execs precede the Bun exec.
            if executable_identity in (identity(sandbox_executables['usr/bin/prlimit']),
                                       identity(sandbox_executables['usr/bin/env'])):
                return
            if executable_identity != identity(sandbox_executables['tool/bin/bun']):
                raise ValueError('unexpected isolated executable before Bun')
            if init_pid is None or init_reaped or not namespace_established:
                raise ValueError('candidate exec has no live observed namespace init')
            observed = namespaces(pid)
            try:
                if any(identity(observed[name]) != identity(init_namespaces[name]) for name in NS_NAMES):
                    raise ValueError('candidate namespace differs from retained init')
            finally:
                for fd in observed.values():
                    os.close(fd)
            for name in ('CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'):
                if int(status[name].strip(), 16) != 0:
                    raise ValueError('candidate retained capabilities')
            if numbers(status, 'NoNewPrivs') != (1,) or numbers(status, 'Groups'):
                raise ValueError('candidate no-new-privileges/groups mismatch')
            candidate_root = os.stat('/proc/%d/root' % pid)
            executable_fd = os.open('/proc/%d/exe' % pid, os.O_RDONLY | os.O_CLOEXEC)
            try:
                if file_digest(executable_fd) != expected_bun_digest:
                    raise ValueError('candidate executable differs from trusted Bun bytes')
            finally:
                os.close(executable_fd)
            # Check every inherited descriptor while Bun remains at the kernel
            # exec-stop; user code cannot race this inspection.
            inherited = {int(value) for value in os.listdir('/proc/%d/fd' % pid)}
            if inherited != {0, 1, 2}:
                raise ValueError('candidate inherited non-stream descriptors')
        # Namespace init is still root, so inspect its trusted pre-chroot root
        # only after restoring the parent's filesystem credentials.
        if (candidate_root.st_dev, candidate_root.st_ino) != identity(sandbox_root_fd):
            raise ValueError('candidate chroot differs from trusted namespace root')
        if pid == init_pid or init_pid not in tracees:
            raise ValueError('candidate must not replace the trusted namespace init')
        init_status = process_status(init_pid)
        if numbers(init_status, 'Uid') != (0, 0, 0, 0) or numbers(init_status, 'Gid') != (0, 0, 0, 0) or numbers(init_status, 'NSpid')[-1] != 1:
            raise ValueError('namespace init lost its root-owned settlement identity')
        observed_init = namespaces(init_pid)
        try:
            if any(identity(observed_init[name]) != identity(init_namespaces[name]) for name in NS_NAMES):
                raise ValueError('namespace init identity changed before candidate start')
        finally:
            for fd in observed_init.values():
                os.close(fd)
        assert_execution_budget()
        candidate_started = True

    def resume(pid, forwarded_signal):
        # Cleanup must continue reaping after cancellation. Normal execution,
        # including the first instruction after Bun's EXEC stop, has one last
        # fence against the same original absolute cooperative deadline.
        if not killing:
            assert_execution_budget()
        ptrace(CONT, pid, forwarded_signal)

    def handle(pid, status):
        nonlocal root_closed, root_code, root_signal, init_reaped, events
        events += 1
        if events > MAX_EVENTS:
            raise ValueError('supervisor ptrace event budget exhausted')
        wait_kind = classify_wait_status(status)
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
            if pid == init_pid:
                init_reaped = True  # A genuine terminal waitpid result only.
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
            tracees[child_pid] = {'parent': pid, 'initial': True}
            if child_pid in pending:
                handle(child_pid, pending.pop(child_pid))
        elif event == EVENT_EXEC and sig == signal.SIGTRAP:
            inspect_exec(pid)
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
        for fd in list(parent_namespaces.values()) + list(init_namespaces.values()) + list(sandbox_executables.values()) + ([] if sandbox_root_fd is None else [sandbox_root_fd]):
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

