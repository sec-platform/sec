import path from 'node:path';

import { compileLinuxRepositoryNamespaceFence } from '../../../../runtime-state/physical/runtime/physical-no-follow-native.ts';
import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../../action/contract/action.ts';
import { parseCiVerificationHostedExecutionEnvironment, resolveCiVerificationHostedExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { captureHostedSutDependencyPreparationBinding, type HostedSutDependencyPreparationBinding } from '../hosted-sut-dependency-preparation.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, ciActionDigest, exactObject, type CodexDevelopmentHostedSutSandboxCommandPlan } from '../verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, type CodexDevelopmentHostedSutExecutionAuthorization } from './hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from './revision.ts';

const SUT_PYTHON = CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath;
const SUT_UNPRIVILEGED_PREFIX = Object.freeze(['/usr/bin/setpriv', '--reuid=65532', '--regid=65532',
  '--clear-groups', '--no-new-privs', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all']);
const SUT_PROCESS_LIMITS = Object.freeze(['/usr/bin/prlimit',
  `--cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds}`,
  `--as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes}`,
  `--fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes}`,
  `--nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles}`,
  `--nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes}`, '--']);
export const HOSTED_SUT_DEPENDENCY_PREPARATION_ENVIRONMENT = Object.freeze({
  PATH: '/tool/bin:/usr/bin:/bin', HOME: '/home/sut', TMPDIR: '/tmp', LANG: 'C.UTF-8',
  SEC_STATE_HOME: '/home/sut/.local/state/sec', SEC_CACHE_HOME: '/home/sut/.cache/sec',
  GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0'
});
const SUT_DEPENDENCY_PREPARATION_SCRIPT = 'import { runHostedSutDependencyPreparationFromTrustedLauncher } from "/trusted-input-base/src/adapters/verification/platform/ci/hosted-sut-dependency-preparation.ts"; await runHostedSutDependencyPreparationFromTrustedLauncher(process.argv.at(-1));';

/** Data only. The retained supervisor authenticates these bytes at EXEC stop. */
export function hostedSutDependencyPreparationArgv(binding: HostedSutDependencyPreparationBinding): readonly string[] {
  const captured = captureHostedSutDependencyPreparationBinding(JSON.stringify(binding));
  return Object.freeze(['/tool/bin/bun', '--no-env-file', '-e', SUT_DEPENDENCY_PREPARATION_SCRIPT, JSON.stringify(captured)]);
}

const SUT_DEPENDENCY_INIT_SCRIPT = [
  'set -euo pipefail',
  'binding="$1"',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  'cd /trusted-input-base',
  [...SUT_UNPRIVILEGED_PREFIX, ...SUT_PROCESS_LIMITS, '/usr/bin/env', '-i',
    ...Object.entries(HOSTED_SUT_DEPENDENCY_PREPARATION_ENVIRONMENT).map(([key, value]) => `${key}=${value}`),
    '/tool/bin/bun', '--no-env-file', '-e', SUT_DEPENDENCY_PREPARATION_SCRIPT].map(shellSingleQuote).join(' ') + ' "$binding"',
  // Keep the trusted shell as namespace init. Its terminal reap, rather than
  // the unshare parent's exit or a child marker, settles the preparation unit.
  'exit 0'
].join('\n');

const SUT_DEPENDENCY_NAMESPACE_COMMAND = Object.freeze(['/usr/bin/unshare', '--mount', '--pid', '--fork', '--kill-child=KILL',
  '/usr/bin/bash', '-ceu', SUT_DEPENDENCY_INIT_SCRIPT, 'sec-hosted-dependency-init']);
export function hostedSutPreparationNamespaceArgv(binding: HostedSutDependencyPreparationBinding): readonly string[] {
  const captured = captureHostedSutDependencyPreparationBinding(JSON.stringify(binding));
  return Object.freeze([...SUT_DEPENDENCY_NAMESPACE_COMMAND, JSON.stringify(captured)]);
}

export function hostedSutPreparationSettlementArgv(): readonly string[] {
  return Object.freeze([SUT_PYTHON, '-I', '-S', '-c', 'pass']);
}

const SUT_IMMUTABLE_FREEZE_SCRIPT = String.raw`
import ctypes, os, sys, time
if len(sys.argv)!=2 or os.getresuid()!=(0,0,0): raise RuntimeError('sut-freeze-credentials')
deadline=int(sys.argv[1])/1000
libc=ctypes.CDLL(None,use_errno=True)
libc.mount.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_char_p,ctypes.c_ulong,ctypes.c_void_p]
libc.mount.restype=ctypes.c_int
if deadline<=time.time(): raise RuntimeError('sut-freeze-deadline')
# Preserve the original executable workspace mount: RDONLY|NOSUID|NODEV|REMOUNT.
if libc.mount(None,b'/workspace',None,39,None)!=0:
    error=ctypes.get_errno(); raise OSError(error,os.strerror(error))
`;

/** Fixed pre-candidate enforcement; the original physical owner still issues
 * its private capability from retained kernel facts at the actual test fence. */
const SUT_IMMUTABLE_EXEC_SCRIPT = String.raw`
import os, sys, ctypes, platform, time, signal
if platform.machine()!='x86_64' or len(sys.argv)<3: raise RuntimeError('sut-input-arguments')
deadline=int(sys.argv[1])/1000
if deadline<=time.time(): raise RuntimeError('sut-input-deadline')
if os.getresuid()!=(65532,65532,65532) or os.getresgid()!=(65532,65532,65532) or os.getgroups(): raise RuntimeError('sut-input-credentials')
with open('/proc/self/status') as stream: status=dict(line.split(':',1) for line in stream)
if any(int(status[key],16) for key in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb')) or int(status['NoNewPrivs'])!=1: raise RuntimeError('sut-input-capabilities')
for name in ('uid_map','gid_map'):
    with open('/proc/self/'+name) as stream:
        if stream.read().split()!=['0','0','4294967295']: raise RuntimeError('sut-input-userns')
class StatFS(ctypes.Structure):
    _fields_=[('type',ctypes.c_long),('bsize',ctypes.c_long),('blocks',ctypes.c_ulong),('bfree',ctypes.c_ulong),('bavail',ctypes.c_ulong),('files',ctypes.c_ulong),('ffree',ctypes.c_ulong),('fsid',ctypes.c_int*2),('namelen',ctypes.c_long),('frsize',ctypes.c_long),('flags',ctypes.c_long),('spare',ctypes.c_long*4)]
libc=ctypes.CDLL(None,use_errno=True)
libc.fstatfs.argtypes=[ctypes.c_int,ctypes.POINTER(StatFS)]; libc.fstatfs.restype=ctypes.c_int
with open('/proc/self/mountinfo') as stream: rows=[line.rstrip().split(' ') for line in stream]
fd=os.open('/workspace',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:
    native=StatFS()
    if libc.fstatfs(fd,ctypes.byref(native))!=0 or native.type!=0x01021994 or not native.flags&1: raise RuntimeError('sut-input-filesystem')
    source_device=os.fstat(fd).st_dev
    with open('/proc/self/fdinfo/'+str(fd)) as stream: info=dict(line.split(':',1) for line in stream)
    selected=[row for row in rows if row[0]==info['mnt_id'].strip()]
    if len(selected)!=1: raise RuntimeError('sut-input-mount')
    row=selected[0]; separator=row.index('-')
    if row[3]!='/' or row[4]!='/workspace' or separator!=6 or row[separator+1]!='tmpfs' or 'ro' not in row[5].split(',') or 'ro' not in row[separator+3].split(','): raise RuntimeError('sut-input-superblock')
    for other in rows:
        if other[0]!=row[0] and (other[4]=='/workspace' or other[4].startswith('/workspace/')): raise RuntimeError('sut-input-covering-mount')
        if other[2]==row[2] and 'ro' not in other[other.index('-')+3].split(','): raise RuntimeError('sut-input-writable-alias')
    ancestor=os.stat('/',follow_symlinks=False)
    if ancestor.st_dev!=source_device and (ancestor.st_uid!=0 or ancestor.st_mode&0o022): raise RuntimeError('sut-input-ancestor')
finally: os.close(fd)
for name in os.listdir('/proc/self/fd'):
    descriptor=int(name)
    try: observed=os.fstat(descriptor)
    except OSError: continue
    if descriptor>2 or observed.st_dev==source_device: raise RuntimeError('sut-input-inherited-fd')
for writable in ('/tmp','/home/sut'):
    if os.stat(writable).st_dev==source_device or os.statvfs(writable).f_flag&os.ST_RDONLY: raise RuntimeError('sut-input-output-overlap')
if os.getcwd()!='/workspace': raise RuntimeError('sut-input-cwd')
program_bytes=bytes.fromhex('${Buffer.from(compileLinuxRepositoryNamespaceFence()).toString('hex')}')
class Filter(ctypes.Structure): _fields_=[('code',ctypes.c_ushort),('jt',ctypes.c_ubyte),('jf',ctypes.c_ubyte),('k',ctypes.c_uint)]
class Program(ctypes.Structure): _fields_=[('length',ctypes.c_ushort),('filters',ctypes.POINTER(Filter))]
filters=(Filter*(len(program_bytes)//8)).from_buffer_copy(program_bytes); program=Program(len(filters),filters)
libc.syscall.restype=ctypes.c_long
if deadline<=time.time(): raise RuntimeError('sut-input-deadline-before-tsync')
if libc.syscall(ctypes.c_long(317),ctypes.c_long(1),ctypes.c_long(1),ctypes.byref(program))!=0: raise RuntimeError('sut-input-tsync')
remaining=deadline-time.time()
if remaining<=0: raise RuntimeError('sut-input-expired')
signal.setitimer(signal.ITIMER_REAL,remaining)
os.execve('/tool/bin/bun',['/tool/bin/bun']+sys.argv[2:],dict(os.environ))
`;

const HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES = Object.freeze([
  'SEC_ACTION_PLAN_DIGEST',
  'SEC_AFFECTED_TESTS_BASE',
  'SEC_BASE_TREE_SHA',
  'SEC_BOOTSTRAP_BASE',
  'SEC_BOOTSTRAP_HEAD',
  'SEC_BOOTSTRAP_TREE',
  'SEC_CHANGED_BASE',
  'SEC_MAIN_HEALTH_DIGEST',
  'SEC_MAIN_HEALTH_REVISION',
  'SEC_REQUIRED_BLOB_CLOSURE_JSON',
  'SEC_REVIEW_RECEIPT_DIGEST',
  'SEC_REPOSITORY_AUDIT_DEFAULT_REF',
  'SEC_SCOPE_AUTHORIZATION_DIGEST',
  'SEC_SCOPE_AUTHORIZATION_REVISION',
  'SEC_SESSION_PROPOSAL_DIGEST',
  'SEC_SESSION_REVISION',
  'SEC_TEST_WORKSPACE_NAMESPACE',
  'SEC_TRUST_REVISION',
  'SEC_TRUSTED_WORKFLOW_REF',
  'SEC_WORKFLOW_ACTOR_NODE_ID',
  'SEC_WORK_PACKAGE_MANIFEST_PATH'
] as const);

export function CodexDevelopmentCandidateProcessEnvironment(
  source: NodeJS.ProcessEnv,
  semanticBindings: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    PATH: '/tool/bin:/usr/bin:/bin',
    HOME: '/home/sut',
    TMPDIR: '/tmp',
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    SEC_FORMAL_HOSTED_MODE: '1',
    SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_PROVIDER_REVISION
  };
  for (const name of HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES) {
    const value = semanticBindings[name] ?? source[name];
    if (value !== undefined) result[name] = value;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

const HOSTED_SUT_RUNTIME_COPY_FUNCTION = Object.freeze([
  'copy_runtime() {',
  '  source="$1"',
  '  destination="$2"',
  '  [ -f "$source" ]',
  '  /usr/bin/install -D -m 0555 -- "$source" "$root$destination"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  `  done < <(/usr/bin/ldd "$source" 2>/dev/null | /usr/bin/awk '$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }' || true)`,
  '}',
  'copy_required_dynamic_dependencies() {',
  '  dependency_source="$1"',
  '  dependency_output="$(/usr/bin/ldd "$dependency_source")"',
  '  if /usr/bin/grep -F "not found" <<< "$dependency_output" >/dev/null; then return 1; fi',
  '  dependency_inventory="$root/tmp/python-extension-dependencies"',
  '  /usr/bin/awk \u0027$2 == "=>" && $3 ~ /^\\// { print $3 } $1 ~ /^\\// { print $1 }\u0027 <<< "$dependency_output" > "$dependency_inventory"',
  '  while IFS= read -r library; do',
  '    [ -n "$library" ] || continue',
  '    /usr/bin/install -D -m 0555 -- "$library" "$root$library"',
  '  done < "$dependency_inventory"',
  '  /usr/bin/rm -- "$dependency_inventory"',
  '}'
] as const);

const HOSTED_SUT_RUNTIME_TOOL_CLOSURE = Object.freeze([
  '# runtime-binary-closure',
  ...HOSTED_SUT_RUNTIME_COPY_FUNCTION,
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries.map(
    (runtimePath) => `copy_runtime ${runtimePath} ${runtimePath}`
  ),
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeDirectories.flatMap((runtimePath) => [
    `mkdir -p "$root${path.posix.dirname(runtimePath)}"`,
    `/usr/bin/cp -a -- ${JSON.stringify(runtimePath)} "$root${runtimePath}"`
  ]),
  'python_extension_inventory="$root/tmp/python-extension-inventory"',
  'python_extension_inventory_sorted="$root/tmp/python-extension-inventory.sorted"',
  `/usr/bin/find ${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory)} -type f -name '*.so' -print0 > "$python_extension_inventory"`,
  '/usr/bin/sort -z "$python_extension_inventory" > "$python_extension_inventory_sorted"',
  'while IFS= read -r -d \u0027\u0027 extension; do copy_required_dynamic_dependencies "$extension"; done < "$python_extension_inventory_sorted"',
  '/usr/bin/rm -- "$python_extension_inventory" "$python_extension_inventory_sorted"',
  'copy_runtime "$bun_host" "/tool/bin/bun"',
  ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeAliases.map(
    (alias) => `ln -s ${JSON.stringify(alias.target)} "$root${alias.path}"`
  )
]);

const HOSTED_SUT_PYTHON_CAPABILITY_SCRIPT = [
  'import hashlib,html,json,locale,pathlib,platform,re,sys,tempfile,unittest',
  'def normalized_encoding(value):',
  "    return value.lower().replace('_', '-')",
  "if normalized_encoding(sys.getfilesystemencoding()) != 'utf-8':",
  "    raise RuntimeError('filesystem encoding is not UTF-8')",
  "if normalized_encoding(locale.getpreferredencoding(False)) != 'utf-8':",
  "    raise RuntimeError('preferred encoding is not UTF-8')",
  "with tempfile.TemporaryDirectory(dir='/tmp') as temporary_directory:",
  "    probe = pathlib.Path(temporary_directory) / '文档能力.txt'",
  "    expected = 'SEC 中文文档能力'",
  "    probe.write_text(expected, encoding='utf-8')",
  "    if probe.read_text(encoding='utf-8') != expected:",
  "        raise RuntimeError('non-ASCII path/content roundtrip failed')",
  'print(platform.python_version())'
].join('\n');

const HOSTED_SUT_CHROOT_EXECUTION_SCRIPT = [
  'expected_archive_digest="$1"',
  'base_sha="$2"',
  'head_sha="$3"',
  'environment_count="$4"',
  'shift 4',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 1 ]',
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  '[ "sha256:$(/usr/bin/sha256sum /authenticated-input/prepared-candidate.tar | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  '/usr/bin/tar --extract --file=/authenticated-input/prepared-candidate.tar --directory=/workspace --no-same-owner --no-same-permissions --delay-directory-restore',
  'rm -f /authenticated-input/prepared-candidate.tar',
  'rmdir /authenticated-input',
  '[ -f /workspace/.sec-trusted-input/candidate.bundle ]',
  '/usr/bin/git -C /workspace init --quiet',
  '/usr/bin/git -C /workspace -c protocol.file.allow=always fetch --quiet /workspace/.sec-trusted-input/candidate.bundle refs/sec/base:refs/sec/base refs/sec/head:refs/sec/head',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/base)" = "$base_sha" ]',
  '[ "$(/usr/bin/git -C /workspace rev-parse refs/sec/head)" = "$head_sha" ]',
  '/usr/bin/git -C /workspace reset --hard --quiet refs/sec/head',
  // Only the exact bootstrap harness uses -e in the admitted plan grammar.
  'if [ "$1" = "-e" ]; then /usr/bin/git -C /workspace update-ref refs/remotes/origin/main "$base_sha"; fi',
  'rm -rf -- /workspace/.sec-trusted-input',
  '[ -z "$(/usr/bin/git -C /workspace config --local --get-regexp \u0027^(credential\\.|remote\\.|http\\.|core\\.(worktree|sshCommand)|include)\u0027 || true)" ]',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} /workspace`,
  'cd /workspace',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i "\${environment[@]}" /tool/bin/bun "$@"`
].join('\n');

const HOSTED_SUT_NAMESPACE_SCRIPT = [
  'unit_name="$1"',
  'candidate_archive="$2"',
  'expected_archive_digest="$3"',
  'bun_host="$4"',
  'base_sha="$5"',
  'head_sha="$6"',
  'environment_count="$7"',
  'shift 7',
  'environment=()',
  'while [ "$environment_count" -gt 0 ]; do environment+=("$1"); shift; environment_count=$((environment_count-1)); done',
  '[ "$#" -ge 2 ]',
  '[ "$1" = "bun" ]',
  'shift',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root" >/dev/null 2>&1 || true\u0027 EXIT',
  `mount -t tmpfs -o nodev,nosuid,mode=0755,size=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes} tmpfs "$root"`,
  'mkdir -p "$root/tool/bin" "$root/authenticated-input" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/etc"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE,
  '[ "$candidate_archive" = "/proc/self/fd/3" ]',
  '/usr/bin/cat -- "$candidate_archive" > "$root/authenticated-input/prepared-candidate.tar"',
  '[ "sha256:$(/usr/bin/sha256sum "$root/authenticated-input/prepared-candidate.tar" | /usr/bin/cut -d " " -f 1)" = "$expected_archive_digest" ]',
  '/usr/bin/chmod 0400 "$root/authenticated-input/prepared-candidate.tar"',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=' +
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.workspaceBytes + ' tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=268435456 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=268435456 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'for device in null zero random urandom; do touch "$root/dev/$device"; mount --bind "/dev/$device" "$root/dev/$device"; mount -o remount,bind,nosuid,noexec "$root/dev/$device"; done',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'printf \u0027sut:x:65532:65532:SEC hosted SUT:/home/sut:/usr/sbin/nologin\\n\u0027 > "$root/etc/passwd"',
  'printf \u0027sut:x:65532:\\n\u0027 > "$root/etc/group"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} "$root/workspace" "$root/home/sut" "$root/tmp"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuote(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT)} sec-hosted-sut-root "$expected_archive_digest" "$base_sha" "$head_sha" "\${#environment[@]}" "\${environment[@]}" "$@"`
].join('\n');

function replaceOwnedScriptPart(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('Owned SUT script projection changed unexpectedly.');
  return source.replace(before, after);
}

let preparedNamespaceScript: string | undefined;
function hostedSutPreparedNamespaceScript(): string {
  if (preparedNamespaceScript !== undefined) return preparedNamespaceScript;
  const bootstrap = `[ "$1" = "-e" ] && [ "\${2-}" = ${shellSingleQuote(CodexDevelopmentTrustedBootstrapSutHarness)} ]`;
  let chroot = replaceOwnedScriptPart(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT,
    'environment_count="$4"\nshift 4', 'binding="$4"\nenvironment_count="$5"\nshift 5');
  chroot = replaceOwnedScriptPart(chroot,
    'rm -f /authenticated-input/prepared-candidate.tar\nrmdir /authenticated-input', '');
  chroot = replaceOwnedScriptPart(chroot, 'rm -rf -- /workspace/.sec-trusted-input', [
    'mkdir /trusted-input-base /dependency-content',
    '/usr/bin/git -C /trusted-input-base init --quiet',
    '/usr/bin/git -C /trusted-input-base -c protocol.file.allow=always fetch --quiet /workspace/.sec-trusted-input/candidate.bundle refs/sec/base:refs/sec/base',
    '[ "$(/usr/bin/git -C /trusted-input-base rev-parse refs/sec/base)" = "$base_sha" ]',
    '/usr/bin/git -C /trusted-input-base reset --hard --quiet refs/sec/base',
    '[ -f /trusted-input-base/src/adapters/verification/platform/ci/hosted-sut-dependency-preparation.ts ]',
    'ln -s /dependency-content/node_modules /trusted-input-base/node_modules',
    'find /trusted-input-base -type d -exec chmod 0555 {} +',
    'find /trusted-input-base -type f -exec chmod a-w {} +',
    'chown 65532:65532 /dependency-content'
  ].join('\n'));
  chroot = replaceOwnedScriptPart(chroot, 'cd /workspace', [
    'exec 3</authenticated-input/prepared-candidate.tar',
    SUT_DEPENDENCY_NAMESPACE_COMMAND.map(shellSingleQuote).join(' ') + ' "$binding"',
    // This exact root EXEC stop is held by the original retained supervisor
    // until the nested namespace init has actually reached terminal reap.
    hostedSutPreparationSettlementArgv().map(shellSingleQuote).join(' '),
    'exec 3<&-',
    'rm -rf -- /workspace/.sec-trusted-input /dependency-content /trusted-input-base',
    'rm -f /authenticated-input/prepared-candidate.tar',
    'rmdir /authenticated-input',
    `deadline="$(${shellSingleQuote(SUT_PYTHON)} -I -S -c 'import json,sys; print(json.loads(sys.argv[1])["deadlineAtUnixMs"])' "$binding")"`,
    'immutable_input=0',
    `if [ "$1" = "test" ] || { [ "$1" = "run" ] && { [ "\${2-}" = "test" ] || [ "\${2-}" = "check" ]; }; } || { ${bootstrap}; }; then immutable_input=1; fi`,
    `if [ "$immutable_input" = 1 ]; then ${[SUT_PYTHON, '-I', '-S', '-c', SUT_IMMUTABLE_FREEZE_SCRIPT].map(shellSingleQuote).join(' ')} "$deadline"; fi`,
    'cd /workspace'
  ].join('\n'));
  const oldExec = HOSTED_SUT_CHROOT_EXECUTION_SCRIPT.split('\n').at(-1)!;
  const guardedExec = replaceOwnedScriptPart(oldExec, '/tool/bin/bun "$@"',
    [SUT_PYTHON, '-I', '-S', '-c', SUT_IMMUTABLE_EXEC_SCRIPT].map(shellSingleQuote).join(' ') + ' "$deadline" "$@"');
  chroot = replaceOwnedScriptPart(chroot, oldExec,
    `if [ "$immutable_input" = 1 ]; then ${guardedExec}; fi\n${oldExec}`);
  let namespace = replaceOwnedScriptPart(HOSTED_SUT_NAMESPACE_SCRIPT,
    'environment_count="$7"\nshift 7', 'binding="$7"\nenvironment_count="$8"\nshift 8');
  namespace = replaceOwnedScriptPart(namespace,
    '/usr/bin/chmod 0400 "$root/authenticated-input/prepared-candidate.tar"',
    '/usr/bin/chmod 0444 "$root/authenticated-input/prepared-candidate.tar"');
  namespace = replaceOwnedScriptPart(namespace, shellSingleQuote(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT), shellSingleQuote(chroot));
  namespace = replaceOwnedScriptPart(namespace,
    '"$expected_archive_digest" "$base_sha" "$head_sha" "${#environment[@]}"',
    '"$expected_archive_digest" "$base_sha" "$head_sha" "$binding" "${#environment[@]}"');
  preparedNamespaceScript = namespace;
  return namespace;
}

const TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS = Object.freeze([
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/test-runner.test.ts',
  'tests/contract/ci-contract.test.ts',
  'tests/contract/merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/repository-audit.test.ts',
  // The original locator named a file that never existed. This is the actual
  // active-documentation owner already named by the trusted-bootstrap contract.
  'tests/unit/active-documentation-contract.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/contract/ci-lanes.test.ts'
] as const);

// This program is frozen in the trusted base CLI and is the only command the
// bootstrap candidate may execute. Child output is streamed into bounded
// digest/tail observations; it never reaches GitHub command files or the host
// runner's inherited stdout directly.
export const CodexDevelopmentTrustedBootstrapSutHarness = [
  '(async () => {',
  'const { createHash } = require("node:crypto");',
  'const CAP = 2097152;',
  'const TAIL = 512;',
  'const required = (name) => process.env[name] ?? (() => { throw new Error(`missing:${name}`); })();',
  'const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;',
  'const results = [];',
  'const collect = async (stream, state, child) => {',
  '  const reader = stream.getReader();',
  '  try {',
  '    for (;;) {',
  '      const { done, value } = await reader.read();',
  '      if (done) break;',
  '      const chunk = Buffer.from(value);',
  '      state.bytes += chunk.byteLength;',
  '      const remaining = Math.max(0, CAP - state.hashed);',
  '      if (remaining > 0) { const retained = chunk.subarray(0, remaining); state.hash.update(retained); state.hashed += retained.byteLength; }',
  '      state.tail = Buffer.concat([state.tail, chunk]).subarray(-TAIL);',
  '      if (state.bytes > CAP && !state.truncated) { state.truncated = true; child.kill(9); }',
  '    }',
  '  } catch (error) {',
  '    try { await reader.cancel(error); } catch {}',
  '    throw error;',
  '  } finally {',
  '    try { reader.releaseLock(); } catch {}',
  '  }',
  '};',
  'const run = async (label, argv) => {',
  '  const child = Bun.spawn(argv, { cwd: "/workspace", env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });',
  '  const stdout = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const stderr = { hash: createHash("sha256"), bytes: 0, hashed: 0, tail: Buffer.alloc(0), truncated: false };',
  '  const exitPromise = child.exited;',
  '  const stdoutCollection = collect(child.stdout, stdout, child);',
  '  const stderrCollection = collect(child.stderr, stderr, child);',
  '  let exitCode;',
  '  try {',
  '    await Promise.all([stdoutCollection, stderrCollection]);',
  '    exitCode = await exitPromise;',
  '  } catch (error) {',
  '    try { child.kill(9); } catch {}',
  '    await Promise.allSettled([stdoutCollection, stderrCollection, exitPromise]);',
  '    throw error;',
  '  }',
  '  const result = { label, argvDigest: digest(JSON.stringify(argv)), exitCode, stdoutDigest: `sha256:${stdout.hash.digest("hex")}`, stderrDigest: `sha256:${stderr.hash.digest("hex")}`, stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes, truncated: stdout.truncated || stderr.truncated, stdoutTail: stdout.tail.toString("utf8"), stderrTail: stderr.tail.toString("utf8") };',
  '  results.push(result);',
  '  return result;',
  '};',
  'const execute = async (label, argv) => { const result = await run(label, argv); if (result.exitCode !== 0 || result.truncated) throw new Error(`${label}:${result.exitCode}:${result.truncated}`); return result; };',
  'const baseSha = required("SEC_BOOTSTRAP_BASE");',
  'const expectedHead = required("SEC_BOOTSTRAP_HEAD");',
  'const expectedTree = required("SEC_BOOTSTRAP_TREE");',
  'let status = "passed";',
  'let diagnostic = null;',
  'let parentSha = null;',
  'try {',
  '  const head = (await execute("identity-head", ["git", "rev-parse", "--verify", "HEAD^{commit}"])).stdoutTail.trim();',
  '  const tree = (await execute("identity-tree", ["git", "rev-parse", "--verify", "HEAD^{tree}"])).stdoutTail.trim();',
  '  const parents = (await execute("identity-parents", ["git", "rev-list", "--parents", "-n", "1", "HEAD"])).stdoutTail.trim().split(/\\s+/u);',
  '  if (head !== expectedHead || tree !== expectedTree || parents.length !== 2 || parents[0] !== expectedHead || parents[1] !== baseSha) throw new Error("candidate-identity");',
  '  parentSha = parents[1];',
  '  if ((await execute("identity-origin-main", ["git", "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"])).stdoutTail.trim() !== baseSha) throw new Error("origin-main-identity");',
  '  await execute("imports", ["bun", "run", "imports:check"]);',
  '  await execute("docs-doctor", ["bun", "run", "docs:doctor"]);',
  '  await execute("typecheck", ["bun", "run", "typecheck:verified"]);',
  '  await execute("diff-check", ["git", "diff", "--check", `${baseSha}..${expectedHead}`]);',
  `  const focusedFast = await execute("focused-tests-fast", ${JSON.stringify([
    'bun', 'run', 'test', '--', '--timeout', '180000', ...TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS.filter(file => file !== 'tests/contract/ci-lanes.test.ts')
  ])});`,
  '  const focusedSlow = await execute("focused-tests-ci-lanes", ["bun", "run", "test", "--", "--scope", "slow", "--suite", "contract-ci-lanes"]);',
  '  results.push({ label: "focused-tests", chunks: [focusedFast, focusedSlow], exitCode: Math.max(focusedFast.exitCode, focusedSlow.exitCode), truncated: focusedFast.truncated || focusedSlow.truncated });',
  '  await execute("repository-audit", ["bun", "src/adapters/repository/repository-audit/cli.ts", "--json"]);',
  '  await execute("affected-plan", ["bun", "run", "check", "--", "--affected", "--plan"]);',
  '  await execute("affected-tests", ["bun", "run", "test", "--", "--affected"]);',
  '  const worktree = await execute("worktree-readback", ["git", "status", "--porcelain=v1"]);',
  '  if (worktree.stdoutTail.length !== 0) throw new Error("tracked-worktree-not-clean");',
  '} catch (error) { status = "failed"; diagnostic = error instanceof Error ? error.message : String(error); }',
  'const summary = { schema: "sec-trusted-bootstrap-sandbox-summary-v1", baseSha, headSha: expectedHead, treeSha: expectedTree, parentSha, status, diagnostic, results };',
  'process.stdout.write(`${JSON.stringify(summary)}\\n`);',
  'if (status !== "passed") process.exitCode = 1;',
  '})().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: "sec-trusted-bootstrap-sandbox-summary-v1", status: "failed", diagnostic: error instanceof Error ? error.message : String(error), results: [] })}\\n`); process.exitCode = 1; });'
].join('');

export const CodexDevelopmentHostedSutCapabilityAssertion = [
  '(async () => {',
  'const fs = require("node:fs");',
  'const { execFileSync, spawn } = require("node:child_process");',
  'const fail = (message) => { throw new Error(message); };',
  'if (process.getuid() !== 65532 || process.getgid() !== 65532) fail(`uid-gid:${process.getuid()}:${process.getgid()}`);',
  'const status = fs.readFileSync("/proc/self/status", "utf8");',
  'if (!/^CapEff:\\s+0+$/m.test(status) || !/^NoNewPrivs:\\s+1$/m.test(status)) fail("privileges");',
  'try { const parentEnvironment = fs.readFileSync("/proc/1/environ"); if (parentEnvironment.includes(Buffer.from("SEC_HOST_SANDBOX_SENTINEL"))) fail("parent-environment"); } catch (error) { if (error?.code !== "ENOENT" && error?.code !== "EACCES") throw error; }',
  'for (const hidden of ["/.oldroot", "/actions-runner", "/actions-runner/_work/_actions", "/home/runner/work", "/runner/_work", "/run", "/var/run", "/tmp/sec-host-sentinel"]) if (fs.existsSync(hidden)) fail(`host-path:${hidden}`);',
  'const routes = fs.readFileSync("/proc/net/route", "utf8").trim().split(/\\r?\\n/);',
  'if (routes.length > 1) fail("network-route");',
  'const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8");',
  'const mountLines = mounts.trim().split(/\\r?\\n/);',
  'const mountAt = (mountpoint) => mountLines.find((line) => line.split(" ")[4] === mountpoint);',
  'for (const mountpoint of ["/", "/workspace", "/tmp", "/home", "/dev"]) { const line = mountAt(mountpoint); if (!line || !line.includes(" - tmpfs ")) fail(`tmpfs:${mountpoint}`); }',
  'if (mountAt("/usr") || !mountAt("/proc")?.includes(" - proc ")) fail("host-usr-or-proc-mount");',
  `const expectedUsrBin = ${JSON.stringify(Object.freeze([
    ...CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries.map((entry) => path.posix.basename(entry)),
    'sh'
  ].sort()))};`,
  'const actualUsrBin = fs.readdirSync("/usr/bin").sort();',
  'if (JSON.stringify(actualUsrBin) !== JSON.stringify(expectedUsrBin)) fail("runtime-binary-closure");',
  'if (JSON.stringify(fs.readdirSync("/tool/bin").sort()) !== JSON.stringify(["bun", "node"])) fail("runtime-tool-aliases");',
  'if (!fs.statSync("/usr/lib/git-core").isDirectory()) fail("git-runtime-closure");',
  `if (!fs.statSync(${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory)}).isDirectory()) fail("python-stdlib-closure");`,
  `const pythonVersion = execFileSync(${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath)}, ["-B", "-c", ${JSON.stringify(HOSTED_SUT_PYTHON_CAPABILITY_SCRIPT)}], { encoding: "utf8" }).trim();`,
  `if (pythonVersion !== ${JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.version)}) fail("python-runtime-closure");`,
  'for (const descriptor of fs.readdirSync("/proc/self/fd")) {',
  '  let target;',
  '  try { target = fs.readlinkSync(`/proc/self/fd/${descriptor}`); }',
  // The directory scan can include a descriptor closed before readlink. Only
  // that ENOENT race is ignorable; read failures and forbidden targets reject.
  '  catch (error) { if (error?.code === "ENOENT") continue; throw error; }',
  '  if (/\\/(?:actions-runner|home\\/runner|runner\\/_work|run|var\\/run|workspace)|\\.oldroot|prepared-candidate\\.tar/u.test(target)) fail(`inherited-fd:${descriptor}`);',
  '}',
  'const cgroup = JSON.parse(fs.readFileSync("/capability/cgroup.json", "utf8"));',
  'if (cgroup.memoryMax !== "4294967296" || cgroup.pidsMax !== "256" || cgroup.cpuMax !== "200000 100000") fail("cgroup-limits");',
  'const softLimit = (name) => execFileSync("/usr/bin/prlimit", ["--pid", String(process.pid), `--${name}`, "--noheadings", "--output", "SOFT"], { encoding: "utf8" }).trim();',
  `if (softLimit("cpu") !== "${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds}" || softLimit("as") !== "4294967296" || softLimit("fsize") !== "268435456" || softLimit("nofile") !== "1024" || softLimit("nproc") !== "256") fail("prlimit-limits");`,
  'let connected = false;',
  'try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(200) }); connected = true; } catch {}',
  'if (connected) fail("network-egress");',
  'const descendant = spawn("/usr/bin/sleep", ["300"], { detached: true, stdio: "ignore" });',
  'descendant.unref();',
  `process.stdout.write("${CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER}\\n");`,
  '})().catch((error) => { console.error(error); process.exitCode = 1; });'
].join('');

const HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT = [
  'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i PATH=/tool/bin:/usr/bin:/bin HOME=/home/sut TMPDIR=/tmp LANG=C /tool/bin/bun -e ${shellSingleQuote(CodexDevelopmentHostedSutCapabilityAssertion)}`
].join('\n');

const HOSTED_SUT_CAPABILITY_SCRIPT = [
  'unit_name="$1"',
  'bun_host="$2"',
  'export SEC_HOST_SANDBOX_SENTINEL=must-not-cross-boundary',
  'touch /tmp/sec-host-sentinel',
  'mount --make-rprivate /',
  'root="/tmp/$unit_name"',
  '[ ! -e "$root" ]',
  'mkdir -- "$root"',
  'trap \u0027umount -R "$root" >/dev/null 2>&1 || true; rm -rf -- "$root" >/dev/null 2>&1 || true; rm -f -- /tmp/sec-host-sentinel\u0027 EXIT',
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=268435456 tmpfs "$root"',
  'mkdir -p "$root/tool/bin" "$root/workspace" "$root/tmp" "$root/home/sut" "$root/dev" "$root/proc" "$root/capability"',
  ...HOSTED_SUT_RUNTIME_TOOL_CLOSURE,
  'mount -t tmpfs -o nodev,nosuid,mode=0755,size=67108864 tmpfs "$root/workspace"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=1777,size=16777216 tmpfs "$root/tmp"',
  'mount -t tmpfs -o nodev,nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/home"',
  'mkdir -p "$root/home/sut"',
  'mount -t tmpfs -o nosuid,noexec,mode=0755,size=16777216 tmpfs "$root/dev"',
  'for device in null zero random urandom; do touch "$root/dev/$device"; mount --bind "/dev/$device" "$root/dev/$device"; mount -o remount,bind,nosuid,noexec "$root/dev/$device"; done',
  'ln -s /proc/self/fd "$root/dev/fd"',
  'ln -s /proc/self/fd/0 "$root/dev/stdin"',
  'ln -s /proc/self/fd/1 "$root/dev/stdout"',
  'ln -s /proc/self/fd/2 "$root/dev/stderr"',
  'cgroup_path="$(/usr/bin/awk -F: \u0027$1 == "0" { print $3 }\u0027 /proc/self/cgroup)"',
  'memory_max="$(cat "/sys/fs/cgroup${cgroup_path}/memory.max")"',
  'pids_max="$(cat "/sys/fs/cgroup${cgroup_path}/pids.max")"',
  'cpu_max="$(cat "/sys/fs/cgroup${cgroup_path}/cpu.max")"',
  'printf \u0027{"cpuMax":"%s","memoryMax":"%s","pidsMax":"%s"}\\n\u0027 "$cpu_max" "$memory_max" "$pids_max" > "$root/capability/cgroup.json"',
  `chown -R ${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid}:${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} "$root/home/sut" "$root/tmp" "$root/workspace"`,
  'for fd_path in /proc/self/fd/*; do fd="${fd_path##*/}"; if [ "$fd" -gt 2 ] 2>/dev/null; then eval "exec ${fd}>&-"; fi; done',
  `/usr/sbin/chroot "$root" /usr/bin/bash -ceu ${shellSingleQuote(HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT)} sec-hosted-capability-root`
].join('\n');

const HOSTED_SUT_TEARDOWN_SCRIPT = [
  'unit_name="$1"',
  'root="/tmp/$unit_name"',
  'if [ -e "$root" ]; then [ -d "$root" ] && [ ! -L "$root" ]; rmdir -- "$root"; fi',
  '[ ! -e "$root" ]',
  'rm -f -- /tmp/sec-host-sentinel'
].join('\n');

function hostedSutSandboxUnitName(actionKey: VerificationActionKeyDigest, nonce: string): string {
  if (!/^[A-Za-z0-9_.-]{1,32}$/u.test(nonce)) {
    throw new Error('Hosted SUT sandbox unit nonce is invalid.');
  }
  return `sec-sut-${actionKey.slice('sha256:'.length, 'sha256:'.length + 16)}-${nonce}`;
}

/** Pure path projection for the outer profile owner, never sandbox authority. */
export function CodexDevelopmentHostedSutSandboxRoot(input: Readonly<{
  subjectDigest: VerificationActionKeyDigest;
  unitNonce: string;
}>): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.subjectDigest) || !/^[0-9a-f]{32}$/u.test(input.unitNonce)) {
    throw new Error('Hosted SUT exact root subject or nonce is invalid.');
  }
  return `/tmp/${hostedSutSandboxUnitName(input.subjectDigest, input.unitNonce)}`;
}

/** The pre-materialization subject is a path identity, not the full operation.
 * The later bootstrapDigest still binds the retained archive and dependencies. */
export function CodexDevelopmentTrustedBootstrapSutSubjectDigest(input: Readonly<{
  baseSha: string; headSha: string; treeSha: string; manifestPath: string;
}>): VerificationActionKeyDigest {
  if (![input.baseSha, input.headSha, input.treeSha].every(value => /^[0-9a-f]{40}$/u.test(value))
    || !/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,1024}$/u.test(input.manifestPath)) {
    throw new Error('Trusted bootstrap SUT subject is invalid.');
  }
  return ciActionDigest({ baseSha: input.baseSha, headSha: input.headSha, treeSha: input.treeSha,
    manifestPath: input.manifestPath, sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST });
}

function finalizeHostedSutSandboxCommandPlan(input: Readonly<{
  phase: CodexDevelopmentHostedSutSandboxCommandPlan['phase'];
  command: CodexDevelopmentHostedSutSandboxCommandPlan['command'];
  unitName: string;
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(input.unitName) ||
      input.argv.length === 0 || input.argv.some((entry) => typeof entry !== 'string' || entry.includes('\0'))) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const candidateEnvironmentNames = Object.freeze([...input.candidateEnvironmentNames].sort());
  if (new Set(candidateEnvironmentNames).size !== candidateEnvironmentNames.length ||
      candidateEnvironmentNames.some((name) => !/^[A-Z][A-Z0-9_]*$/u.test(name))) {
    throw new Error('Hosted SUT sandbox candidate environment allowlist is invalid.');
  }
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    phase: input.phase,
    unitName: input.unitName,
    command: input.command,
    argv: Object.freeze([...input.argv]),
    candidateEnvironmentNames,
    executionAuthorizationDigest: input.executionAuthorizationDigest,
    physicalCommandProjectionDigest: input.physicalCommandProjectionDigest
  });
  return Object.freeze({ ...withoutDigest, planDigest: ciActionDigest(withoutDigest) });
}

function assertExactHostedSutScriptProjection(value: CodexDevelopmentHostedSutSandboxCommandPlan): void {
  const argv = value.argv;
  const equal = (left: unknown, right: unknown) => encodeVerificationActionData(left) === encodeVerificationActionData(right);
  if (argv.some(argument => argument.includes('\0'))) throw new Error('Hosted SUT argv contains NUL.');
  if (value.phase === 'teardown') {
    if (!equal(argv, ['-ceu', HOSTED_SUT_TEARDOWN_SCRIPT, 'sec-hosted-teardown', value.unitName])
      || value.candidateEnvironmentNames.length !== 0) {
      throw new Error('Hosted SUT teardown is not the exact owned script and unit.');
    }
    return;
  }
  const prefix = ['--mount', '--pid', '--fork', '--kill-child=KILL', '--net', '/usr/bin/bash', '-ceu'];
  if (!equal(argv.slice(0, prefix.length), prefix)) throw new Error('Hosted SUT namespace argv differs.');
  if (value.phase === 'capability-self-test') {
    if (argv.length !== 11 || argv[7] !== HOSTED_SUT_CAPABILITY_SCRIPT
      || argv[8] !== 'sec-hosted-capability' || argv[9] !== value.unitName
      || !path.posix.isAbsolute(argv[10]!) || value.candidateEnvironmentNames.length !== 0) {
      throw new Error('Hosted SUT capability probe is not the exact trusted script and unit.');
    }
    return;
  }
  const shellName = argv[8];
  const validShellName = shellName === 'sec-hosted-sut' || (value.phase === 'bootstrap-execute'
    && typeof shellName === 'string' && /^sec-hosted-sut:sha256:[0-9a-f]{64}$/u.test(shellName));
  const prepared = argv[7] === hostedSutPreparedNamespaceScript();
  const countIndex = prepared ? 16 : 15;
  if ((!prepared && argv[7] !== HOSTED_SUT_NAMESPACE_SCRIPT) || !validShellName || argv[9] !== value.unitName
    || argv[10] !== HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH || !/^sha256:[0-9a-f]{64}$/u.test(argv[11] ?? '')
    || !path.posix.isAbsolute(argv[12] ?? '') || !/^[0-9a-f]{40}$/u.test(argv[13] ?? '')
    || !/^[0-9a-f]{40}$/u.test(argv[14] ?? '') || !/^(?:0|[1-9][0-9]{0,2})$/u.test(argv[countIndex] ?? '')) {
    throw new Error('Hosted SUT execution is not the exact script, unit and retained input projection.');
  }
  if (prepared) {
    const binding = captureHostedSutDependencyPreparationBinding(argv[15]!);
    if (binding.archiveDigest !== argv[11] || binding.baseSha !== argv[13] || binding.headSha !== argv[14]) {
      throw new Error('Hosted SUT preparation differs from its retained archive and Git subject.');
    }
  }
  const count = Number(argv[countIndex]);
  const environment = argv.slice(countIndex + 1, countIndex + 1 + count);
  const names = environment.map(entry => /^([A-Z][A-Z0-9_]*)=/u.exec(entry)?.[1]);
  const fixed = { PATH: '/tool/bin:/usr/bin:/bin', HOME: '/home/sut', TMPDIR: '/tmp', LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', SEC_FORMAL_HOSTED_MODE: '1' };
  const allowed = new Set<string>([...Object.keys(fixed), 'SEC_EXECUTION_ENVIRONMENT_REVISION',
    ...HOSTED_SUT_SEMANTIC_ENVIRONMENT_NAMES]);
  if (environment.length !== count || names.some(name => name === undefined || !allowed.has(name))
    || new Set(names).size !== count || !equal(names, [...names].sort())
    || !equal(names, value.candidateEnvironmentNames)) {
    throw new Error('Hosted SUT execution environment projection is not exact.');
  }
  for (const [name, expected] of Object.entries(fixed)) {
    if (!environment.includes(`${name}=${expected}`)) throw new Error(`Hosted SUT fixed ${name} differs.`);
  }
  const provider = environment.find(entry => entry.startsWith('SEC_EXECUTION_ENVIRONMENT_REVISION='));
  resolveCiVerificationHostedExecutionEnvironment(provider?.slice('SEC_EXECUTION_ENVIRONMENT_REVISION='.length) ?? '');
  const candidate = argv.slice(countIndex + 1 + count);
  if (candidate[0] !== 'bun' || candidate.length < 2 || (value.phase === 'bootstrap-execute'
    && !equal(candidate, ['bun', '-e', CodexDevelopmentTrustedBootstrapSutHarness]))) {
    throw new Error('Hosted SUT candidate command or bootstrap harness differs.');
  }
}

export function hostedSutDependencyPreparationFromPlan(plan: CodexDevelopmentHostedSutSandboxCommandPlan): HostedSutDependencyPreparationBinding | null {
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan.phase === 'execute' || plan.phase === 'bootstrap-execute'
    ? plan.argv[7] === hostedSutPreparedNamespaceScript() ? captureHostedSutDependencyPreparationBinding(plan.argv[15]!) : null
    : null;
}

export function hostedSutCandidateArgv(plan: CodexDevelopmentHostedSutSandboxCommandPlan): readonly string[] {
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  if (plan.phase !== 'execute' && plan.phase !== 'bootstrap-execute') throw new Error('SUT plan has no candidate command.');
  const countIndex = plan.argv[7] === hostedSutPreparedNamespaceScript() ? 16 : 15;
  return Object.freeze(['/tool/bin/bun', ...plan.argv.slice(countIndex + 2 + Number(plan.argv[countIndex]))]);
}

/** Only the operation's exact authorized command chooses the stricter input
 * boundary. Legitimate workspace-producing Actions retain their RW sandbox. */
export function hostedSutPlanRequiresImmutableInput(plan: CodexDevelopmentHostedSutSandboxCommandPlan): boolean {
  if (plan.phase !== 'execute' && plan.phase !== 'bootstrap-execute') {
    CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
    return false;
  }
  const argv = hostedSutCandidateArgv(plan);
  return plan.phase === 'bootstrap-execute' || argv[1] === 'test'
    || (argv[1] === 'run' && (argv[2] === 'test' || argv[2] === 'check'));
}

export function hostedSutCandidateGuardArgv(plan: CodexDevelopmentHostedSutSandboxCommandPlan): readonly string[] | null {
  const binding = hostedSutDependencyPreparationFromPlan(plan);
  if (binding === null || !hostedSutPlanRequiresImmutableInput(plan)) return null;
  return Object.freeze([SUT_PYTHON, '-I', '-S', '-c', SUT_IMMUTABLE_EXEC_SCRIPT,
    String(binding.deadlineAtUnixMs), ...hostedSutCandidateArgv(plan).slice(1)]);
}

export function CodexDevelopmentAssertHostedSutSandboxCommandPlan(
  plan: CodexDevelopmentHostedSutSandboxCommandPlan
): void {
  const value = exactObject(plan, [
    'schema', 'policyDigest', 'phase', 'unitName', 'command', 'argv',
    'candidateEnvironmentNames', 'executionAuthorizationDigest',
    'physicalCommandProjectionDigest', 'planDigest'
  ], 'Hosted SUT sandbox command plan V1');
  const phase = String(value.phase);
  const commandMatchesPhase = phase === 'teardown'
    ? value.command === '/usr/bin/bash'
    : value.command === '/usr/bin/unshare';
  if (value.schema !== CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA ||
      value.policyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      !commandMatchesPhase ||
      !['capability-self-test', 'execute', 'bootstrap-execute', 'teardown'].includes(phase) ||
      typeof value.unitName !== 'string' ||
      !/^sec-sut-[0-9a-f]{16}-[A-Za-z0-9_.-]{1,32}$/u.test(value.unitName) ||
      !Array.isArray(value.argv) || value.argv.some((entry) => typeof entry !== 'string') ||
      !Array.isArray(value.candidateEnvironmentNames) ||
      value.candidateEnvironmentNames.some((entry) => typeof entry !== 'string') ||
      (value.executionAuthorizationDigest !== null &&
        (typeof value.executionAuthorizationDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.executionAuthorizationDigest))) ||
      (value.physicalCommandProjectionDigest !== null &&
        (typeof value.physicalCommandProjectionDigest !== 'string' ||
          !/^sha256:[0-9a-f]{64}$/u.test(value.physicalCommandProjectionDigest))) ||
      typeof value.planDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.planDigest)) {
    throw new Error('Hosted SUT sandbox command plan identity is invalid.');
  }
  const { planDigest, ...withoutDigest } = value;
  if (planDigest !== ciActionDigest(withoutDigest)) {
    throw new Error('Hosted SUT sandbox command plan digest mismatch.');
  }
  // A re-hashed arbitrary shell program containing invariant words is still
  // untrusted. Only these exact source-owned scripts may reach the supervisor.
  assertExactHostedSutScriptProjection(plan);
  if (value.phase === 'execute' || value.phase === 'bootstrap-execute') {
    if (value.phase === 'execute' &&
        (value.executionAuthorizationDigest === null || value.physicalCommandProjectionDigest === null)) {
      throw new Error('Hosted SUT execution command plan is not bound to its authorization.');
    }
    if (value.phase === 'bootstrap-execute' &&
        (value.executionAuthorizationDigest !== null || value.physicalCommandProjectionDigest !== null)) {
      throw new Error('Trusted bootstrap SUT command plan cannot claim Action authorization.');
    }
    const encoded = encodeVerificationActionData(value.argv);
    for (const invariant of [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/sbin/chroot', 'mount -t proc', '--no-new-privs', '--bounding-set=-all',
      '/usr/bin/env -i', '/authenticated-input/prepared-candidate.tar',
      HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, '/usr/bin/sha256sum',
      '/usr/bin/cat --', '$candidate_archive',
      'copy_runtime /usr/bin/bash /usr/bin/bash',
      'copy_runtime /usr/bin/tar /usr/bin/tar',
      'runtime-binary-closure'
    ]) {
      if (!encoded.includes(invariant)) throw new Error(`Hosted SUT sandbox command plan omits ${invariant}.`);
    }
    for (const forbidden of [
      'GITHUB_OUTPUT', 'GITHUB_ENV', 'GITHUB_STEP_SUMMARY', 'ACTIONS_RUNTIME_TOKEN',
      '/var/run/docker.sock', '/run/docker.sock', '${RUNNER_TEMP}', 'mount --bind /usr',
      '/usr/bin/sudo', '/usr/bin/systemd-run'
    ]) {
      if (encoded.includes(forbidden)) throw new Error(`Hosted SUT sandbox command plan exposes ${forbidden}.`);
    }
  } else if (value.phase === 'capability-self-test') {
    if ((value.executionAuthorizationDigest === null) !==
        (value.physicalCommandProjectionDigest === null)) {
      throw new Error('Hosted SUT capability command plan has a partial authorization binding.');
    }
  } else if (value.executionAuthorizationDigest !== null || value.physicalCommandProjectionDigest !== null) {
    throw new Error('Hosted SUT auxiliary command plan cannot claim candidate authorization.');
  }
}

export function CodexDevelopmentBuildHostedSutSandboxCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  normalizedArgv: readonly string[];
  candidateEnvironment: NodeJS.ProcessEnv;
  executionAuthorization: CodexDevelopmentHostedSutExecutionAuthorization;
  dependencyPreparation?: HostedSutDependencyPreparationBinding;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.actionKey) || input.normalizedArgv[0] !== 'bun' ||
      input.normalizedArgv.length < 2 || !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) || !/^[0-9a-f]{40}$/u.test(input.baseSha) ||
      !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Hosted SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const names = environment.map(([name]) => name);
  const environmentProjection = environment.map(([name, value]) => Object.freeze({
    name,
    valueDigest: ciActionDigest(value)
  }));
  const authorization = input.executionAuthorization;
  const executionEnvironment = parseCiVerificationHostedExecutionEnvironment(authorization.executionEnvironment);
  const { authorizationDigest, ...authorizationWithoutDigest } = authorization;
  const { projectionDigest, ...physicalCommandWithoutDigest } = authorization.physicalCommand;
  const expectedUnitName = `sec-sut-${authorization.actionKey.slice(7, 23)}-${authorization.ticketDigest.slice(7, 23)}`;
  if (authorization.schema !== CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA ||
      authorizationDigest !== ciActionDigest(authorizationWithoutDigest) ||
      authorization.actionKey !== input.actionKey ||
      authorization.physicalCommand.actionKey !== input.actionKey ||
      authorization.physicalCommand.schema !== CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA ||
      projectionDigest !== ciActionDigest(physicalCommandWithoutDigest) ||
      authorization.physicalCommand.operationSemanticDigest !== authorization.operationSemanticDigest ||
      authorization.physicalCommand.unitName !== expectedUnitName ||
      input.baseSha !== authorization.providerOrigin.workflowSha ||
      input.headSha !== authorization.candidateSha ||
      authorization.physicalCommand.canonicalArgvDigest !== ciActionDigest(input.normalizedArgv) ||
      authorization.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      authorization.physicalCommand.sandboxPolicyDigest !== CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST ||
      authorization.physicalCommand.providerRevision !== executionEnvironment.executionEnvironmentRevision ||
      encodeVerificationActionData(authorization.normalizedArgv) !==
        encodeVerificationActionData(input.normalizedArgv) ||
      encodeVerificationActionData(authorization.physicalCommand.fixedSandboxEnvironment) !==
        encodeVerificationActionData(environmentProjection)) {
    throw new Error('Hosted SUT physical command differs from its Action-bound execution authorization.');
  }
  const unitName = authorization.physicalCommand.unitName;
  const preparation = input.dependencyPreparation === undefined ? null
    : captureHostedSutDependencyPreparationBinding(JSON.stringify(input.dependencyPreparation));
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: names,
    executionAuthorizationDigest: authorization.authorizationDigest,
    physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', preparation === null ? HOSTED_SUT_NAMESPACE_SCRIPT : hostedSutPreparedNamespaceScript(), 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      ...(preparation === null ? [] : [JSON.stringify(preparation)]),
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`), ...input.normalizedArgv
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan;
}

export function CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan(input: Readonly<{
  bootstrapDigest: VerificationActionKeyDigest;
  unitSubjectDigest?: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  candidateEnvironment: NodeJS.ProcessEnv;
  unitNonce: string;
  dependencyPreparation?: HostedSutDependencyPreparationBinding;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.bootstrapDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) ||
      !/^[0-9a-f]{40}$/u.test(input.baseSha) || !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Trusted bootstrap SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const preparation = input.dependencyPreparation === undefined ? null
    : captureHostedSutDependencyPreparationBinding(JSON.stringify(input.dependencyPreparation));
  const unitName = input.unitSubjectDigest === undefined
    ? hostedSutSandboxUnitName(input.bootstrapDigest, input.unitNonce)
    : path.posix.basename(CodexDevelopmentHostedSutSandboxRoot({
        subjectDigest: input.unitSubjectDigest, unitNonce: input.unitNonce
      }));
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'bootstrap-execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: environment.map(([name]) => name),
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', preparation === null ? HOSTED_SUT_NAMESPACE_SCRIPT : hostedSutPreparedNamespaceScript(),
      // Keep the full operation in the exact shell argv ($0) when its
      // namespace path uses the separate pre-materialization subject.
      input.unitSubjectDigest === undefined ? 'sec-hosted-sut' : `sec-hosted-sut:${input.bootstrapDigest}`,
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      ...(preparation === null ? [] : [JSON.stringify(preparation)]),
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`),
      'bun', '-e', CodexDevelopmentTrustedBootstrapSutHarness
    ]
  });
  CodexDevelopmentAssertHostedSutSandboxCommandPlan(plan);
  return plan;
}

export function hostedSutCapabilityCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  bunExecutable: string;
  unitNonce: string;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorization;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  if (input.executionAuthorization !== undefined &&
      input.executionAuthorization.actionKey !== input.actionKey) {
    throw new Error('Hosted SUT capability plan authorization differs from its ActionKey.');
  }
  const unitName = input.executionAuthorization?.physicalCommand.unitName ??
    hostedSutSandboxUnitName(input.actionKey, input.unitNonce);
  return finalizeHostedSutSandboxCommandPlan({
    phase: 'capability-self-test',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: input.executionAuthorization?.authorizationDigest ?? null,
    physicalCommandProjectionDigest: input.executionAuthorization?.physicalCommand.projectionDigest ?? null,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', HOSTED_SUT_CAPABILITY_SCRIPT, 'sec-hosted-capability',
      unitName, input.bunExecutable
    ]
  });
}

export function hostedSutTeardownCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  unitName: string;
}>): CodexDevelopmentHostedSutSandboxCommandPlan {
  return finalizeHostedSutSandboxCommandPlan({
    phase: 'teardown',
    command: '/usr/bin/bash',
    unitName: input.unitName,
    candidateEnvironmentNames: [],
    executionAuthorizationDigest: null,
    physicalCommandProjectionDigest: null,
    argv: [
      '-ceu', HOSTED_SUT_TEARDOWN_SCRIPT, 'sec-hosted-teardown', input.unitName
    ]
  });
}
