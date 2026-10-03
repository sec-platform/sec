#!/usr/bin/env bash
# Reviewed fixed setup only. No candidate JavaScript ever executes as root.
# The private PID namespace init owns all descendants and terminal cleanup.
set -euo pipefail
readonly base=145f63743fcf7f4ec181d16ff89f18777187a754
readonly carrier_parent=f2334f1063068fdc6e04f3b109683b23ad0d1b2b
readonly base_tree=588c94ea67c1c67f2ac30aa93b8cc3c630a4c13f
readonly root=/sec-qualification
readonly input=$root/input
readonly test_file=src/adapters/runtime-state/physical/runtime/linux-immutable-input-qualification.test.ts

if [[ ${1:-} != --namespace ]]; then
  [[ $# == 3 && $1 =~ ^[0-9a-f]{40}$ && $2 == 1 && $3 == /* ]]
  [[ $(git rev-parse HEAD) == "$1" && $(git rev-parse HEAD^) == "$carrier_parent" ]]
  [[ $(git rev-parse "$carrier_parent^") == "$base" ]]
  [[ $(git rev-parse "$base^{tree}") == "$base_tree" ]]
  [[ -z $(git status --porcelain --untracked-files=all) ]]
  [[ $("$3" --version) == 1.4.0 ]]
  deadline_ns=$(/usr/bin/python3 -I -S -B -c 'import time; print(time.monotonic_ns() + 1490000000000)')
  # No environment secrets or Actions token cross the setup boundary.
  exec sudo /usr/bin/env -i PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/timeout --signal=TERM --kill-after=10s 1500s \
    /usr/bin/unshare --mount --pid --fork --kill-child=KILL --mount-proc \
    /bin/bash "$PWD/scripts/qualification/linux-immutable-input.sh" --namespace "$PWD" "$1" "$3" "$deadline_ns"
fi

[[ $# == 5 && $EUID == 0 && $$ == 1 ]]
readonly checkout=$2 head=$3 bun_source=$4 deadline_ns=$5
[[ $head =~ ^[0-9a-f]{40}$ && $checkout == /* && $bun_source == /* && $deadline_ns =~ ^[0-9]+$ ]]
[[ ! -e $root && ! -L $root ]]
printf 'QUALIFICATION work deadline monotonic_ns=%s; outer hard stop=1500s plus 10s kill grace\n' "$deadline_ns"
# Nothing may propagate to the runner's mount namespace.
mount --make-rprivate /
mkdir -m 0755 "$root"
scaffold=0 input_mounted=0 alias_mounted=0 negative_mounted=0 bind_mounted=0 temp_mounted=0 temp_mount_id=0
quiesce() {
  # The Python observer excludes itself and namespace PID1, kills only peers
  # in this private PID namespace, and observes actual disappearance twice.
  /usr/bin/python3 -I -S -B - "$deadline_ns" <<'PY_QUIESCE'
import errno, os, pathlib, signal, sys, time
absolute = int(sys.argv[1])
stop = min(absolute, time.monotonic_ns() + 10000000000)
me = str(os.getpid())
assert pathlib.Path('/proc/1/comm').read_text().strip() == 'bash'
expired = time.monotonic_ns() >= absolute
try:
    os.kill(-1, signal.SIGKILL)  # Mandatory cancellation, even after the work deadline.
except OSError as error:
    if error.errno != errno.ESRCH:
        raise
    # No signalable peer is not a census proof; the full checks below still run.
assert not expired, 'Qualification work deadline exhausted; only terminal cancellation remains'
last = None
while time.monotonic_ns() < stop:
    peers = sorted(p.name for p in pathlib.Path('/proc').iterdir()
                   if p.name.isdecimal() and p.name not in ('1', me))
    if not peers:
        # A second complete census, not elapsed time, proves this readback.
        again = sorted(p.name for p in pathlib.Path('/proc').iterdir()
                       if p.name.isdecimal() and p.name not in ('1', me))
        if not again:
            print('QUALIFICATION private PID census quiescent: init and observer only', flush=True)
            break
        raise RuntimeError('Private PID census reappeared after quiescence: ' + repr(again))
    if peers != last:
        print('QUALIFICATION terminating private descendants: ' + repr(peers), flush=True)
        last = peers
    time.sleep(0.02)
else:
    raise RuntimeError('Private descendants did not settle before the bounded original deadline')
assert time.monotonic_ns() < absolute, 'Original qualification deadline exhausted'
PY_QUIESCE
}
cleanup() {
  local primary=$? failed=0
  trap - EXIT TERM INT
  cd /
  if ! quiesce; then failed=1; fi
  wait 2>/dev/null || true
  for item in "$root/input-alias:$alias_mounted" "$root/readonly-bind:$bind_mounted" \
    "$root/writable-superblock:$negative_mounted" "$input:$input_mounted" "/tmp:$temp_mounted" "$root:$scaffold"; do
    if [[ ${item##*:} == 1 ]]; then
      if ! umount "${item%:*}"; then
        printf 'QUALIFICATION cleanup failure: %s\n' "${item%:*}" >&2
        failed=1
      fi
    fi
  done
  if ! /usr/bin/python3 -I -S -B - "$temp_mount_id" <<'PY_MOUNTS'
import pathlib, sys
remaining = [line for line in pathlib.Path('/proc/self/mountinfo').read_text().splitlines()
             if line.split(' ')[4] == '/sec-qualification'
             or line.split(' ')[4].startswith('/sec-qualification/')
             or line.split(' ')[0] == sys.argv[1]]
assert not remaining, 'Owned mounts remain: ' + repr(remaining)
print('QUALIFICATION all owned mounts including private tmp absent after cleanup', flush=True)
PY_MOUNTS
  then failed=1; fi
  if ! rmdir "$root"; then failed=1; fi
  printf 'QUALIFICATION terminal: command=%s cleanup=%s; private VM evidence only\n' "$primary" "$failed"
  if [[ $primary != 0 ]]; then exit "$primary"; fi
  exit "$failed"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
mount -t tmpfs -o mode=0755,nosuid,nodev,size=10G tmpfs "$root"
scaffold=1
mkdir -m 0755 "$input" "$root/input-alias" "$root/writable-superblock" "$root/readonly-bind" "$root/tool"
mount -t tmpfs -o mode=0755,nosuid,nodev,size=8G tmpfs "$input"
input_mounted=1
# Keep executable mappings enabled: the original dependency owner seals copies.
cp -a "$checkout/." "$input/"
chown -R 65532:65532 "$input"
install -m 0755 -o 0 -g 0 "$bun_source" "$root/tool/bun"
mkdir -m 0700 "$root/home" "$root/state" "$root/cache" "$root/output"
chown 65532:65532 "$root/home" "$root/state" "$root/cache" "$root/output"
mount -t tmpfs -o mode=1777,nosuid,nodev,size=2G tmpfs /tmp
temp_mounted=1
temp_mount_id=$(awk '$5 == "/tmp" {print $1}' /proc/self/mountinfo)
[[ $temp_mount_id =~ ^[0-9]+$ ]]

# Every capability set, supplementary group and privilege transition is cleared.
run_candidate() {
  setpriv --reuid=65532 --regid=65532 --clear-groups --inh-caps=-all \
    --ambient-caps=-all --bounding-set=-all --no-new-privs \
    env -i PATH="$root/tool:/usr/bin:/bin" HOME="$root/home" TMPDIR=/tmp \
    SEC_STATE_HOME="$root/state" SEC_CACHE_HOME="$root/cache" \
    CI=true GIT_TERMINAL_PROMPT=0 "$@"
}
cd "$input"
# Verify the entire B145 preimage, not just the qualification's imports.
# This is native Git/Python inspection, not candidate module execution.
run_candidate /usr/bin/python3 -I -S -B - "$head" "$base" "$base_tree" "$carrier_parent" <<'PY_IDENTITY'
import json, pathlib, subprocess, sys
head, base, tree, carrier_parent = sys.argv[1:]
def git(*args):
    return subprocess.check_output(['git', *args], text=True).strip()
assert git('rev-parse', 'HEAD') == head
assert git('rev-parse', 'HEAD^') == carrier_parent
assert git('rev-parse', carrier_parent + '^') == base
assert git('rev-parse', base + '^{tree}') == tree
owned = ['.github/workflows/linux-immutable-input-qualification.yml',
         'scripts/qualification/linux-immutable-input.sh',
         'src/adapters/runtime-state/physical/runtime/linux-immutable-input-qualification.test.ts']
assert git('diff', '--name-only', base, head).splitlines() == sorted(owned)
assert git('diff', '--diff-filter=A', '--name-only', base, head).splitlines() == sorted(owned)
assert not git('status', '--porcelain', '--untracked-files=all')
paths = subprocess.check_output(['git', 'diff-tree', '--no-commit-id', '--name-only', '-z', '-r', base]).decode().split('\0')[:-1]
assert len(paths) == 23
blobs = {p: git('rev-parse', base + ':' + p) for p in paths}
assert all(git('rev-parse', head + ':' + p) == blob for p, blob in blobs.items())
value = dict(base=base, baseTree=tree, carrierParent=carrier_parent, head=head, tree=git('rev-parse', 'HEAD^{tree}'),
             baseBlobs=blobs, qualificationBlobs={p:git('rev-parse', head + ':' + p) for p in owned})
print('QUALIFICATION source identity ' + json.dumps(value, sort_keys=True), flush=True)
pathlib.Path('/sec-qualification/output/source-identity.json').write_text(json.dumps(value))
PY_IDENTITY
# Move the observed expectations into the root-owned scaffold, before loading JS.
mv "$root/output/source-identity.json" "$root/source-identity.json"
chown 0:0 "$root/source-identity.json"
chmod 0444 "$root/source-identity.json"
# Original owner uses frozen-lockfile, ignore-scripts, backend=copyfile.
# Networking exists only in this preparation phase; no credentials are supplied.
run_candidate "$root/tool/bun" run deps:ensure

# A real negative fixture: its bind mount is RO but its superblock stays RW.
mount -t tmpfs -o mode=0755,nosuid,nodev,size=1M tmpfs "$root/writable-superblock"
negative_mounted=1
chown 65532:65532 "$root/writable-superblock"
run_candidate /usr/bin/printf 'writable superblock fixture\n' > "$root/writable-superblock/fixture.txt"
chown 65532:65532 "$root/writable-superblock/fixture.txt"
mount --bind "$root/writable-superblock" "$root/readonly-bind"
bind_mounted=1
mount -o remount,bind,ro,nosuid,nodev "$root/readonly-bind"
# A second alias of the actual source must share its SB_RDONLY refusal.
mount --bind "$input" "$root/input-alias"
alias_mounted=1
# Exact native remount; do not substitute mount(8)'s bind/remount semantics.
# MS_RDONLY | MS_NOSUID | MS_NODEV | MS_REMOUNT, intentionally preserving exec.
/usr/bin/python3 -I -S -B - <<'PY_FREEZE'
import ctypes, os
libc = ctypes.CDLL('libc.so.6', use_errno=True)
libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_void_p]
libc.mount.restype = ctypes.c_int
if libc.mount(None, b'/sec-qualification/input', None, 1 | 2 | 4 | 32, None) != 0:
    code = ctypes.get_errno()
    raise OSError(code, os.strerror(code))
print('QUALIFICATION native superblock remount accepted', flush=True)
PY_FREEZE
# No setup write descriptors survive: each copy/install/fixture writer exited.
# The private network namespace has no configured interfaces or routes.
# The original formal CLI owns selection, isolation, immutable admission and budget.
set +e
unshare --net -- setpriv --reuid=65532 --regid=65532 --clear-groups \
  --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs \
  env -i PATH="$root/tool:/usr/bin:/bin" HOME="$root/home" TMPDIR=/tmp \
  SEC_STATE_HOME="$root/state" SEC_CACHE_HOME="$root/cache" CI=true GIT_TERMINAL_PROMPT=0 \
  "$root/tool/bun" run test -- "$test_file" --reporter=junit --reporter-outfile="$root/output/results.xml"
command_status=$?
set -e
# Quiesce every remaining descendant before the trusted evidence readback.
set +e
quiesce
quiesce_status=$?
wait 2>/dev/null || true
set -e
# Preserve the actual command error even if evidence validation also fails.
set +e
/usr/bin/python3 -I -S -B - "$command_status" "$quiesce_status" <<'PY_JUNIT'
import json, pathlib, sys, xml.etree.ElementTree as ET
expected = [
    'physical identity binds B145 source, dependencies, Bun and kernel prerequisites',
    'physical prepare and arm synchronizes seccomp across the exact thread census',
    'physical immutable input rejects write chmod rename and alias write with EROFS',
    'physical disjoint fixture supports write read and complete cleanup',
    'physical readonly bind over a writable superblock is rejected',
    'physical capabilities reject forgery reuse and post-disposal use',
]
p = pathlib.Path('/sec-qualification/output/results.xml')
assert p.is_file() and not p.is_symlink(), 'Missing real JUnit output'
assert p.stat().st_nlink == 1, 'JUnit must be this run-owned ordinary file'
assert p.stat().st_size <= 1024 * 1024, 'JUnit bound exceeded'
root = ET.fromstring(p.read_bytes())
cases = list(root.iter('testcase'))
assert len(cases) == 6 and sorted(c.get('name') for c in cases) == sorted(expected), 'Exact six unique testcases required'
for element in root.iter():
    assert element.tag not in ('skipped', 'failure', 'error'), 'A case did not pass'
    for field in ('skipped', 'failures', 'errors'):
        assert int(element.get(field, '0')) == 0, 'Nonzero JUnit failures/skips'
assert int(sys.argv[1]) == 0, 'Original formal CLI did not settle successfully'
assert int(sys.argv[2]) == 0, 'Private descendants did not settle before evidence readback'
print('QUALIFICATION JUnit accepted ' + json.dumps(dict(executed=6, skipped=0, failures=0, errors=0, names=expected)), flush=True)
PY_JUNIT
junit_status=$?
set -e
printf 'QUALIFICATION evidence statuses: formal_cli=%s junit=%s\n' "$command_status" "$junit_status"
if [[ $command_status != 0 ]]; then exit "$command_status"; fi
exit "$junit_status"
