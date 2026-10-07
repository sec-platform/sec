import path from 'node:path';
import type { HostedSutCommandPlan, HostedSutExecutionAuthorization } from "../../../../../execution/verification/hosted.ts";
import { compileLinuxRepositoryNamespaceFence } from '../../../../runtime-state/physical/runtime/physical-no-follow-native.ts';

import type { CiVerificationNormalizedOperation, VerificationActionKeyDigest } from '../../../../../execution/verification/action.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, parseCiVerificationHostedExecutionEnvironment, parseCiVerificationNormalizedOperation, resolveCiVerificationHostedExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, ciActionDigest, exactObject } from '../verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA } from './hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from './revision.ts';

/** Correlation for one actual native Action. This data never issues a source,
 * dependency generation, process observation or execution permission. */
export type HostedSutCandidatePreparation = Readonly<{
  schema: 'sec-hosted-candidate-preparation-v1';
  actionKey: VerificationActionKeyDigest;
  resolutionDigest: VerificationActionKeyDigest;
  authorizationDigest: VerificationActionKeyDigest;
  operationSemanticDigest: VerificationActionKeyDigest;
  baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
  archiveDigest: VerificationActionKeyDigest;
  inventoryDigest: VerificationActionKeyDigest;
  dependencyClosureDigest: VerificationActionKeyDigest;
  gitBundleDigest: VerificationActionKeyDigest;
  deadlineAtUnixMs: number;
  inputAccess: 'read-only' | 'writable';
}>;

export type TrustedBootstrapCandidatePreparation = Readonly<{
  schema: 'sec-trusted-bootstrap-candidate-preparation';
  bootstrapDigest: VerificationActionKeyDigest;
  baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
  archiveDigest: VerificationActionKeyDigest; inventoryDigest: VerificationActionKeyDigest;
  dependencyClosureDigest: VerificationActionKeyDigest; gitBundleDigest: VerificationActionKeyDigest;
  deadlineAtUnixMs: number; inputAccess: 'writable';
}>;
export type NativeHostedCandidatePreparation = HostedSutCandidatePreparation | TrustedBootstrapCandidatePreparation;

export function parseNativeHostedCandidatePreparation(value: unknown): NativeHostedCandidatePreparation {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && (value as Record<string, unknown>).schema === 'sec-trusted-bootstrap-candidate-preparation') {
    const record = exactObject(value, ['schema', 'bootstrapDigest', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha',
      'archiveDigest', 'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest', 'deadlineAtUnixMs', 'inputAccess'],
      'Trusted bootstrap physical candidate preparation');
    if (!['bootstrapDigest', 'archiveDigest', 'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest'].every(key =>
      typeof record[key] === 'string' && /^sha256:[0-9a-f]{64}$/u.test(record[key] as string))
        || !['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha'].every(key => typeof record[key] === 'string'
          && /^[0-9a-f]{40}$/u.test(record[key] as string))
        || !Number.isSafeInteger(record.deadlineAtUnixMs) || Number(record.deadlineAtUnixMs) <= 0
        || record.inputAccess !== 'writable') throw new Error('Trusted bootstrap physical preparation is invalid.');
    return Object.freeze({ ...record }) as TrustedBootstrapCandidatePreparation;
  }
  return parseHostedSutCandidatePreparation(value);
}

export function parseHostedSutCandidatePreparation(value: unknown): HostedSutCandidatePreparation {
  const record = exactObject(value, ['schema', 'actionKey', 'resolutionDigest', 'authorizationDigest',
    'operationSemanticDigest', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'archiveDigest',
    'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest', 'deadlineAtUnixMs', 'inputAccess'],
  'Hosted candidate preparation');
  if (record.schema !== 'sec-hosted-candidate-preparation-v1'
      || !['actionKey', 'resolutionDigest', 'authorizationDigest', 'operationSemanticDigest', 'archiveDigest',
        'inventoryDigest', 'dependencyClosureDigest', 'gitBundleDigest'].every(key =>
          typeof record[key] === 'string' && /^sha256:[0-9a-f]{64}$/u.test(record[key] as string))
      || !['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha'].every(key =>
        typeof record[key] === 'string' && /^[0-9a-f]{40}$/u.test(record[key] as string))
      || !Number.isSafeInteger(record.deadlineAtUnixMs) || Number(record.deadlineAtUnixMs) <= 0
      || (record.inputAccess !== 'read-only' && record.inputAccess !== 'writable')) {
    throw new Error('Hosted candidate preparation has invalid closed correlation.');
  }
  return Object.freeze({ ...record }) as HostedSutCandidatePreparation;
}

/** Only the original normalized Action selects this boundary. A phase label,
 * arbitrary argv, caller boolean or environment variable cannot select it. */
export function hostedSutCandidateInputAccess(operation: CiVerificationNormalizedOperation): 'read-only' | 'writable' {
  const target = parseCiVerificationNormalizedOperation(operation).target;
  return target.kind === 'bun-test' || (target.kind === 'bun-package-script'
    && (target.identity === 'test' || target.identity === 'check')) ? 'read-only' : 'writable';
}

export function createHostedSutCandidatePreparation(input: Readonly<{
  operation: CiVerificationNormalizedOperation;
  authorization: Parameters<typeof buildHostedSutSandboxCommandPlan>[0]['executionAuthorization'];
  deadlineAtUnixMs: number;
}>): HostedSutCandidatePreparation {
  const operation = parseCiVerificationNormalizedOperation(input.operation);
  const authorization = input.authorization;
  const { authorizationDigest, ...body } = authorization;
  if (ciActionDigest(body) !== authorizationDigest || authorization.operationSemanticDigest !== operation.semanticDigest
      || authorization.candidateSha !== operation.candidate.headSha
      || authorization.providerOrigin.workflowSha !== operation.candidate.baseSha
      || encodeVerificationActionData(authorization.normalizedArgv)
        !== encodeVerificationActionData(ciVerificationNormalizedOperationArgv(operation))) {
    throw new Error('Hosted candidate preparation differs from the original normalized Action.');
  }
  return parseHostedSutCandidatePreparation({ schema: 'sec-hosted-candidate-preparation-v1',
    actionKey: authorization.actionKey, resolutionDigest: authorization.resolutionDigest,
    authorizationDigest, operationSemanticDigest: operation.semanticDigest,
    baseSha: operation.candidate.baseSha, baseTreeSha: operation.candidate.baseTreeSha,
    headSha: operation.candidate.headSha, headTreeSha: operation.candidate.headTreeSha,
    archiveDigest: authorization.inventoryClosure.archiveDigest,
    inventoryDigest: authorization.inventoryClosure.inventoryDigest,
    dependencyClosureDigest: authorization.inventoryClosure.dependencyClosureDigest,
    gitBundleDigest: authorization.inventoryClosure.gitBundleDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs, inputAccess: hostedSutCandidateInputAccess(operation) });
}

const HOSTED_CANDIDATE_ENTRY = '/sec-runtime/trusted/src/bootstrap/toolchain/native-verification-dependencies.ts';
const HOSTED_CANDIDATE_PYTHON = CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath;
export const HOSTED_CANDIDATE_PREPARATION_ENVIRONMENT = Object.freeze({
  PATH: '/tool/bin:/usr/bin:/bin', HOME: '/home/sut', TMPDIR: '/tmp', LANG: 'C.UTF-8',
  SEC_STATE_HOME: '/home/sut/.local/state/sec', SEC_CACHE_HOME: '/home/sut/.cache/sec',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0'
});
export function hostedCandidatePreparationArgv(): readonly string[] {
  return Object.freeze(['/tool/bin/bun', '--no-env-file', '--no-install', HOSTED_CANDIDATE_ENTRY]);
}
export function hostedCandidatePreparationEnvironment(phase: 'prepare' | 'observe'): Readonly<Record<string, string>> {
  return Object.freeze({ ...HOSTED_CANDIDATE_PREPARATION_ENVIRONMENT,
    ...(phase === 'prepare' ? { NODE_PATH: '/sec-runtime/dependency-content/node_modules' } : {}) });
}
export function hostedCandidatePreparationNamespaceArgv(phase: 'prepare' | 'observe'): readonly string[] {
  const script = ['set -euo pipefail',
    // The original supervisor creates and retains these two private pipes at
    // the exact namespace-launcher EXEC stop. Only this nested domain writes.
    `exec > /authenticated-input/${phase}-stdout.pipe 2> /authenticated-input/${phase}-stderr.pipe`,
    'mount -t proc -o nosuid,nodev,noexec,hidepid=2 proc /proc',
    'cd /sec-runtime/trusted',
    ['/usr/bin/setpriv', '--reuid=65532', '--regid=65532', '--clear-groups', '--no-new-privs',
      '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '/usr/bin/env', '-i',
      ...Object.entries(hostedCandidatePreparationEnvironment(phase)).map(([key, value]) => `${key}=${value}`),
      ...hostedCandidatePreparationArgv()].map(shellSingleQuote).join(' ')
      + ` < /authenticated-input/${phase}.json`,
    // The shell stays PID1; its actual terminal reap closes even untraced children.
    'exit 0'].join('\n');
  return Object.freeze(['/usr/bin/unshare', '--mount', '--pid', '--fork', '--kill-child=KILL',
    '/usr/bin/bash', '-ceu', script, `sec-hosted-candidate-${phase}`]);
}
export function hostedCandidatePreparationSettlementArgv(phase: 'prepare' | 'observe'): readonly string[] {
  return Object.freeze([HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', 'pass', `sec-hosted-candidate-${phase}`]);
}

/** The archive producer normalizes absolute in-root links. Apply that same
 * normalization to the private transport copy before manifest publication;
 * the borrowed outer generation is read only and is never changed. */
const HOSTED_CANDIDATE_NORMALIZE_LINKS = String.raw`
import json,os,posixpath,stat,sys,time
root=sys.argv[1]; source=os.path.realpath('/sec-runtime/trusted/node_modules'); count=0
deadline=json.loads(sys.argv[2])['deadlineAtUnixMs']/1000
for parent,dirs,files in os.walk(root,topdown=True,followlinks=False):
    for name in dirs+files:
        count+=1
        if count>200000 or time.time()>=deadline:raise RuntimeError('candidate-link-normalization-bound')
        file=os.path.join(parent,name); info=os.lstat(file)
        if not stat.S_ISLNK(info.st_mode):continue
        raw=os.readlink(file); member='node_modules/'+os.path.relpath(file,root)
        if '\x00' in raw or '\\' in raw:raise RuntimeError('candidate-link-non-posix')
        if posixpath.isabs(raw):
            normalized=posixpath.normpath(raw)
            if not normalized.startswith(source+'/'):raise RuntimeError('candidate-link-escape')
            target='node_modules/'+posixpath.relpath(normalized,source)
        else:target=posixpath.normpath(posixpath.join(posixpath.dirname(member),raw))
        if not target.startswith('node_modules/') or target==member or member.startswith(target+'/'):raise RuntimeError('candidate-link-escape-or-cycle')
        if posixpath.isabs(raw):
            os.unlink(file); os.symlink(posixpath.relpath(target,posixpath.dirname(member)),file)
`;

/** This root-side transport adapter copies only the already authenticated,
 * bounded outer trusted generation. The original TS physical issuer verifies
 * the complete manifest again and issues the candidate generation itself. */
const HOSTED_CANDIDATE_CONTENT_MANIFEST = String.raw`
import hashlib,json,os,stat,sys,time
binding=json.loads(sys.argv[1]); deadline=binding['deadlineAtUnixMs']/1000
root='/sec-runtime/dependency-content'; entries=[]; total=0
canonical=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def digest(value):return 'sha256:'+hashlib.sha256(canonical(value)).hexdigest()
def live():
    if time.time()>=deadline:raise RuntimeError('candidate-content-deadline')
for parent,dirs,files in os.walk(root,topdown=True,followlinks=False):
    live(); dirs.sort(); files.sort()
    for name in dirs+files:
        live(); file=os.path.join(parent,name); before=os.lstat(file)
        relative=os.path.relpath(file,root)
        if len(entries)>=200000 or any(part in ('','.','..') for part in relative.split('/')):raise RuntimeError('candidate-content-entry-bound')
        mode=stat.S_IMODE(before.st_mode)
        if mode&0o7000:raise RuntimeError('candidate-content-special-mode')
        if stat.S_ISLNK(before.st_mode):
            target=os.readlink(file)
            normalized=os.path.normpath(os.path.join(os.path.dirname(relative),target))
            if os.path.isabs(target) or normalized=='..' or normalized.startswith('../'):raise RuntimeError('candidate-content-link-escape')
            entry={'path':relative,'mode':mode,'type':'symlink','target':target}
        elif stat.S_ISDIR(before.st_mode):
            entry={'path':relative,'mode':mode,'type':'directory'}
        elif stat.S_ISREG(before.st_mode):
            total+=before.st_size
            if total>4294967296:raise RuntimeError('candidate-content-byte-bound')
            fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
            try:
                if (os.fstat(fd).st_dev,os.fstat(fd).st_ino)!=(before.st_dev,before.st_ino):raise RuntimeError('candidate-content-replaced')
                hashed=hashlib.sha256(); count=0
                while True:
                    live(); chunk=os.read(fd,1048576)
                    if not chunk:break
                    count+=len(chunk)
                    if count>before.st_size:raise RuntimeError('candidate-content-grew')
                    hashed.update(chunk)
                after=os.fstat(fd)
                if count!=before.st_size or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise RuntimeError('candidate-content-drift')
            finally:os.close(fd)
            entry={'path':relative,'mode':mode,'type':'file','size':before.st_size,'digest':'sha256:'+hashed.hexdigest()}
        else:raise RuntimeError('candidate-content-entry-kind')
        entries.append(entry)
entries.sort(key=lambda item:item['path'].encode('utf-16-be'))
content=digest(entries); transport=digest({'candidate':binding,'contentDigest':content})
manifest={'schema':'sec-hosted-candidate-dependency-content-v1','candidate':binding,'entries':entries,'contentDigest':content,'transportDigest':transport}
def write(name,value):
    live(); data=canonical(value)+b'\n'
    if len(data)>33554432:raise RuntimeError('candidate-manifest-bound')
    fd=os.open('/authenticated-input/'+name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
    try:
        while data:
            live(); count=os.write(fd,data)
            if count<=0:raise RuntimeError('candidate-manifest-write')
            data=data[count:]
        os.fsync(fd)
    finally:os.close(fd)
write('dependency-content-manifest.json',manifest)
for phase in ('prepare','observe'):
    write(phase+'.json',{'schema':'sec-native-verification-dependency-setup-v1','phase':phase,'kind':'hosted-candidate','candidate':binding,'deadlineAtUnixMs':binding['deadlineAtUnixMs'],'transportDigest':transport})
`;

const HOSTED_CANDIDATE_RESULT_COMPARISON = String.raw`
import json,os,stat,sys,time
binding=json.loads(sys.argv[1])
if time.time()*1000>=binding['deadlineAtUnixMs']:raise RuntimeError('candidate-observation-deadline')
def read(phase):
    fd=os.open('/authenticated-input/'+phase+'-result.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_gid!=0 or info.st_nlink!=1 or stat.S_IMODE(info.st_mode)!=0o400 or not 0<info.st_size<=4096:raise RuntimeError('candidate-result-shape')
        raw=os.pread(fd,4097,0); after=os.fstat(fd)
        if len(raw)!=info.st_size or (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):raise RuntimeError('candidate-result-changed')
        value=json.loads(raw)
    finally:os.close(fd)
    if value['schema']!='sec-native-verification-dependency-result-v1' or value['kind']!='hosted-candidate' or value['phase']!=phase or value['deadlineAtUnixMs']!=binding['deadlineAtUnixMs'] or value['trusted'] is not None:raise RuntimeError('candidate-result-context')
    return value
prepared=read('prepare'); observed=read('observe')
if prepared['status']!='prepared' or prepared['contentRetirement']!='released' or observed['status']!='observed' or observed['contentRetirement']!='not-retained' or prepared['transportDigest']!=observed['transportDigest'] or prepared['workspace']['generationDigest']!=observed['workspace']['generationDigest'] or observed['workspace']['requiresFreshProcess']:raise RuntimeError('candidate-generation-fresh-observation')
`;

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

export class HostedSutExecutionEnvironmentUnavailableError extends Error {
  readonly code = 'SEC-HOSTED-SUT-EXECUTION-ENVIRONMENT-UNRESOLVED';
  constructor() { super('Hosted SUT requires its explicitly supplied execution environment revision.'); }
}

export function hostedCandidateProcessEnvironment(
  source: NodeJS.ProcessEnv,
  semanticBindings: Readonly<Record<string, string>> = {}
): NodeJS.ProcessEnv {
  const revision = semanticBindings.SEC_EXECUTION_ENVIRONMENT_REVISION ?? source.SEC_EXECUTION_ENVIRONMENT_REVISION;
  if (revision === undefined || revision.length === 0) throw new HostedSutExecutionEnvironmentUnavailableError();
  const environment = resolveCiVerificationHostedExecutionEnvironment(revision);
  const result: NodeJS.ProcessEnv = {
    PATH: '/tool/bin:/usr/bin:/bin',
    HOME: '/home/sut',
    TMPDIR: '/tmp',
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    SEC_FORMAL_HOSTED_MODE: '1',
    SEC_EXECUTION_ENVIRONMENT_REVISION: environment.executionEnvironmentRevision
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

let preparedCandidateNamespace: string | undefined;
function replaceOwnedScript(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('Hosted candidate script anchor is not unique.');
  return source.replace(before, after);
}
function hostedCandidatePreparedNamespaceScript(): string {
  if (preparedCandidateNamespace !== undefined) return preparedCandidateNamespace;
  let chroot = replaceOwnedScript(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT,
    'environment_count="$4"\nshift 4', 'binding="$4"\nenvironment_count="$5"\nshift 5');
  chroot = replaceOwnedScript(chroot,
    'rm -f /authenticated-input/prepared-candidate.tar\nrmdir /authenticated-input', '');
  chroot = replaceOwnedScript(chroot, 'rm -rf -- /workspace/.sec-trusted-input', [
    'mkdir /sec-runtime/trusted',
    '/usr/bin/git -C /sec-runtime/trusted init --quiet',
    '/usr/bin/git -C /sec-runtime/trusted -c protocol.file.allow=always fetch --quiet /workspace/.sec-trusted-input/candidate.bundle refs/sec/base:refs/sec/base',
    '/usr/bin/git -C /sec-runtime/trusted reset --hard --quiet refs/sec/base',
    '[ "$(/usr/bin/git -C /sec-runtime/trusted rev-parse HEAD)" = "$base_sha" ]',
    `base_tree="$(${shellSingleQuote(HOSTED_CANDIDATE_PYTHON)} -I -S -c 'import json,sys; print(json.loads(sys.argv[1])["baseTreeSha"])' "$binding")"`,
    `head_tree="$(${shellSingleQuote(HOSTED_CANDIDATE_PYTHON)} -I -S -c 'import json,sys; print(json.loads(sys.argv[1])["headTreeSha"])' "$binding")"`,
    '[ "$(/usr/bin/git -C /sec-runtime/trusted rev-parse HEAD^{tree})" = "$base_tree" ]',
    '[ "$(/usr/bin/git -C /workspace rev-parse HEAD^{tree})" = "$head_tree" ]',
    '[ ! -e /sec-runtime/trusted/node_modules ] && [ ! -L /sec-runtime/trusted/node_modules ]',
    'ln -s /sec-runtime/dependency-content/node_modules /sec-runtime/trusted/node_modules',
    'find /sec-runtime/trusted -type d -exec chmod 0555 {} +',
    'find /sec-runtime/trusted -type f -exec chmod a-w {} +'
  ].join('\n'));
  chroot = replaceOwnedScript(chroot, 'cd /workspace', [
    [HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', HOSTED_CANDIDATE_CONTENT_MANIFEST].map(shellSingleQuote).join(' ') + ' "$binding"',
    'exec 3</authenticated-input/prepared-candidate.tar',
    ...(['prepare', 'observe'] as const).flatMap(phase => [
      ...(phase === 'observe' ? [
        'chmod 0755 /sec-runtime/trusted',
        'rm -- /sec-runtime/trusted/node_modules',
        'ln -s /workspace/node_modules /sec-runtime/trusted/node_modules',
        'chmod 0555 /sec-runtime/trusted'
      ] : []),
      hostedCandidatePreparationNamespaceArgv(phase).map(shellSingleQuote).join(' '),
      // Held at actual EXEC by the original supervisor until this phase's PID
      // init and all writers have reached genuine terminal reap.
      hostedCandidatePreparationSettlementArgv(phase).map(shellSingleQuote).join(' ')
    ]),
    [HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', HOSTED_CANDIDATE_RESULT_COMPARISON].map(shellSingleQuote).join(' ') + ' "$binding"',
    'exec 3<&-',
    '[ ! -e /workspace/.sec-trusted-input ]',
    'chown -R 0:0 /sec-runtime/dependency-content',
    'find /sec-runtime/dependency-content /sec-runtime/trusted -type d -exec chmod u+w {} +',
    'rm -rf -- /sec-runtime/dependency-content /sec-runtime/trusted /authenticated-input',
    'rm -- /usr/bin/unshare',
    `deadline="$(${shellSingleQuote(HOSTED_CANDIDATE_PYTHON)} -I -S -c 'import json,sys; print(json.loads(sys.argv[1])["deadlineAtUnixMs"])' "$binding")"`,
    `input_access="$(${shellSingleQuote(HOSTED_CANDIDATE_PYTHON)} -I -S -c 'import json,sys; print(json.loads(sys.argv[1])["inputAccess"])' "$binding")"`,
    `if [ "$input_access" = read-only ]; then ${[HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', SUT_IMMUTABLE_FREEZE_SCRIPT].map(shellSingleQuote).join(' ')} "$deadline"; fi`,
    'cd /workspace'
  ].join('\n'));
  const last = HOSTED_SUT_CHROOT_EXECUTION_SCRIPT.split('\n').at(-1)!;
  const guarded = replaceOwnedScript(last, '/tool/bin/bun "$@"',
    [HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', SUT_IMMUTABLE_EXEC_SCRIPT].map(shellSingleQuote).join(' ') + ' "$deadline" "$@"');
  chroot = replaceOwnedScript(chroot, last, `if [ "$input_access" = read-only ]; then ${guarded}; fi\n${last}`);
  let namespace = replaceOwnedScript(HOSTED_SUT_NAMESPACE_SCRIPT,
    'environment_count="$7"\nshift 7', 'binding="$7"\nenvironment_count="$8"\nshift 8');
  namespace = replaceOwnedScript(namespace, '[ "$candidate_archive" = "/proc/self/fd/3" ]', [
    'copy_runtime /usr/bin/unshare /usr/bin/unshare',
    'mkdir -p "$root/sec-runtime/dependency-content/node_modules"',
    // The outer native issuer has already retained, prepared and sealed this
    // exact trusted dependency generation. No candidate source is loaded.
    '/usr/bin/cp -a --no-preserve=ownership -- /sec-runtime/trusted/node_modules/. "$root/sec-runtime/dependency-content/node_modules/"',
    'find "$root/sec-runtime/dependency-content" -type d -exec chmod u+w {} +',
    [HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', HOSTED_CANDIDATE_NORMALIZE_LINKS].map(shellSingleQuote).join(' ')
      + ' "$root/sec-runtime/dependency-content/node_modules" "$binding"',
    'for name in .bun-version bun.lock package.json bunfig.toml; do if [ "$name" = bunfig.toml ] && [ ! -e "/sec-runtime/trusted/$name" ]; then continue; fi; /usr/bin/cp -- "/sec-runtime/trusted/$name" "$root/sec-runtime/dependency-content/$name"; done',
    'find "$root/sec-runtime/dependency-content" -type d -exec chmod 0555 {} +',
    'find "$root/sec-runtime/dependency-content" -type f -exec chmod a-w {} +',
    'chown -R 65532:65532 "$root/sec-runtime/dependency-content"',
    '[ "$candidate_archive" = "/proc/self/fd/3" ]'
  ].join('\n'));
  namespace = replaceOwnedScript(namespace,
    '/usr/bin/chmod 0400 "$root/authenticated-input/prepared-candidate.tar"',
    '/usr/bin/chmod 0444 "$root/authenticated-input/prepared-candidate.tar"');
  // Trusted Git setup precedes the one final candidate ownership transfer.
  // The six-capability root worker has neither DAC_OVERRIDE nor FOWNER.
  namespace = replaceOwnedScript(namespace, '"$root/workspace" "$root/home/sut" "$root/tmp"', '"$root/home/sut" "$root/tmp"');
  namespace = replaceOwnedScript(namespace, shellSingleQuote(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT), shellSingleQuote(chroot));
  namespace = replaceOwnedScript(namespace,
    '"$expected_archive_digest" "$base_sha" "$head_sha" "${#environment[@]}"',
    '"$expected_archive_digest" "$base_sha" "$head_sha" "$binding" "${#environment[@]}"');
  preparedCandidateNamespace = namespace;
  return namespace;
}

export function hostedSutCandidatePreparationFromPlan(plan: HostedSutCommandPlan<string, VerificationActionKeyDigest>): NativeHostedCandidatePreparation | null {
  if (!['execute', 'bootstrap-execute'].includes(plan.phase) || plan.argv[7] !== hostedCandidatePreparedNamespaceScript()) return null;
  const preparation = parseNativeHostedCandidatePreparation(JSON.parse(plan.argv[15]!));
  if ((plan.phase === 'bootstrap-execute') !== (preparation.schema === 'sec-trusted-bootstrap-candidate-preparation')) {
    throw new Error('Native candidate preparation belongs to a different business flow.');
  }
  return preparation;
}
export function hostedSutCandidateArgv(plan: HostedSutCommandPlan<string, VerificationActionKeyDigest>): readonly string[] {
  const countIndex = hostedSutCandidatePreparationFromPlan(plan) === null ? 15 : 16;
  return Object.freeze(['/tool/bin/bun', ...plan.argv.slice(countIndex + 2 + Number(plan.argv[countIndex]))]);
}
export function hostedSutCandidateGuardArgv(plan: HostedSutCommandPlan<string, VerificationActionKeyDigest>): readonly string[] | null {
  const preparation = hostedSutCandidatePreparationFromPlan(plan);
  return preparation?.inputAccess !== 'read-only' ? null : Object.freeze([
    HOSTED_CANDIDATE_PYTHON, '-I', '-S', '-c', SUT_IMMUTABLE_EXEC_SCRIPT,
    String(preparation.deadlineAtUnixMs), ...hostedSutCandidateArgv(plan).slice(1)
  ]);
}

const TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS = Object.freeze([
  'tests/unit/tcb-trust-root-contract.test.ts',
  'tests/unit/test-runner.test.ts',
  'tests/contract/ci-contract.test.ts',
  'tests/contract/merge-gate.test.ts',
  'tests/contract/tcb-closure-lock.test.ts',
  'tests/contract/repository-audit.test.ts',
  'tests/contract/documentation-authority.test.ts',
  'tests/contract/test-impact.test.ts',
  'tests/contract/ci-lanes.test.ts'
] as const);

// This program is frozen in the trusted base CLI and is the only command the
// bootstrap candidate may execute. Child output is streamed into bounded
// digest/tail observations; it never reaches GitHub command files or the host
// runner's inherited stdout directly.
const TRUSTED_BOOTSTRAP_TCB_OBSERVATION_PROGRAM = [
  'const { compileTcbClosureIdentity } = await import("./src/adapters/verification/platform/trust/runtime/closure-lock.ts");',
  'const value = compileTcbClosureIdentity({ candidateRoot: process.cwd() });',
  'process.stdout.write(JSON.stringify({ schema: value.schema, trustRevision: value.trustRevision, moduleCount: value.moduleCount, closureDigest: value.closureDigest }) + "\\n");'
].join('');
export const TRUSTED_BOOTSTRAP_SUT_HARNESS = [
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
  '  await execute("bind-origin-main", ["git", "update-ref", "refs/remotes/origin/main", baseSha]);',
  `  const tcbArgv = ${JSON.stringify(['bun', '--no-env-file', '--no-install', '-e', TRUSTED_BOOTSTRAP_TCB_OBSERVATION_PROGRAM])};`,
  '  const tcbPre = JSON.parse((await execute("tcb-lock-pre", tcbArgv)).stdoutTail.trim());',
  '  await execute("imports", ["bun", "run", "imports:check"]);',
  '  await execute("docs-doctor", ["bun", "run", "docs:doctor"]);',
  '  await execute("typecheck", ["bun", "run", "typecheck:verified"]);',
  '  await execute("diff-check", ["git", "diff", "--check", `${baseSha}..${expectedHead}`]);',
  `  await execute("focused-tests", ${JSON.stringify([
    'bun', 'test', '--timeout', '180000', ...TRUSTED_BOOTSTRAP_SUT_FOCUSED_TESTS
  ])});`,
  '  await execute("repository-audit", ["bun", "src/adapters/repository/repository-audit/cli.ts", "--json"]);',
  '  await execute("affected-plan", ["bun", "run", "check", "--", "--affected", "--plan"]);',
  '  await execute("affected-tests", ["bun", "run", "test", "--", "--affected"]);',
  '  const tcbPost = JSON.parse((await execute("tcb-lock-post", tcbArgv)).stdoutTail.trim());',
  '  if (tcbPre.schema !== "sec-tcb-closure-lock-v2" || tcbPost.schema !== tcbPre.schema || tcbPost.closureDigest !== tcbPre.closureDigest || tcbPost.trustRevision !== tcbPre.trustRevision || tcbPost.moduleCount !== tcbPre.moduleCount) throw new Error("candidate-tcb-closure-changed");',
  '  const worktree = await execute("worktree-readback", ["git", "status", "--porcelain=v1"]);',
  '  if (worktree.stdoutTail.length !== 0) throw new Error("tracked-worktree-not-clean");',
  '} catch (error) { status = "failed"; diagnostic = error instanceof Error ? error.message : String(error); }',
  'const summary = { schema: "sec-trusted-bootstrap-sandbox-summary-v1", baseSha, headSha: expectedHead, treeSha: expectedTree, parentSha, status, diagnostic, results };',
  'process.stdout.write(`${JSON.stringify(summary)}\\n`);',
  'if (status !== "passed") process.exitCode = 1;',
  '})().catch((error) => { process.stdout.write(`${JSON.stringify({ schema: "sec-trusted-bootstrap-sandbox-summary-v1", status: "failed", diagnostic: error instanceof Error ? error.message : String(error), results: [] })}\\n`); process.exitCode = 1; });'
].join('');

export const HOSTED_SUT_CAPABILITY_ASSERTION = [
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
  `exec /usr/bin/setpriv --reuid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid} --regid=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid} --clear-groups --no-new-privs --bounding-set=-all --inh-caps=-all --ambient-caps=-all /usr/bin/prlimit --cpu=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.perProcessCpuSeconds} --as=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.addressSpaceBytes} --fsize=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes} --nofile=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.openFiles} --nproc=${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.processes} -- /usr/bin/env -i PATH=/tool/bin:/usr/bin:/bin HOME=/home/sut TMPDIR=/tmp LANG=C /tool/bin/bun -e ${shellSingleQuote(HOSTED_SUT_CAPABILITY_ASSERTION)}`
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
export function hostedSutSandboxRoot(input: Readonly<{
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
export function trustedBootstrapSutSubjectDigest(input: Readonly<{
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
  phase: HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST>['phase'];
  command: HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST>['command'];
  unitName: string;
  argv: readonly string[];
  candidateEnvironmentNames: readonly string[];
  executionAuthorizationDigest: VerificationActionKeyDigest | null;
  physicalCommandProjectionDigest: VerificationActionKeyDigest | null;
}>): HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST> {
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

function assertExactHostedSutScriptProjection(value: HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST>): void {
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
  const preparation = hostedSutCandidatePreparationFromPlan(value);
  const countIndex = preparation === null ? 15 : 16;
  if ((preparation === null && argv[7] !== HOSTED_SUT_NAMESPACE_SCRIPT) || !validShellName || argv[9] !== value.unitName
    || argv[10] !== HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH || !/^sha256:[0-9a-f]{64}$/u.test(argv[11] ?? '')
    || !path.posix.isAbsolute(argv[12] ?? '') || !/^[0-9a-f]{40}$/u.test(argv[13] ?? '')
    || !/^[0-9a-f]{40}$/u.test(argv[14] ?? '') || !/^(?:0|[1-9][0-9]{0,2})$/u.test(argv[countIndex] ?? '')) {
    throw new Error('Hosted SUT execution is not the exact script, unit and retained input projection.');
  }
  if (preparation !== null && (preparation.archiveDigest !== argv[11] || preparation.baseSha !== argv[13]
      || preparation.headSha !== argv[14]
      || (preparation.schema === 'sec-hosted-candidate-preparation-v1'
        ? preparation.authorizationDigest !== value.executionAuthorizationDigest
        : value.executionAuthorizationDigest !== null))) {
    throw new Error('Hosted candidate preparation differs from exact plan identity.');
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
    && !equal(candidate, ['bun', '-e', TRUSTED_BOOTSTRAP_SUT_HARNESS]))) {
    throw new Error('Hosted SUT candidate command or bootstrap harness differs.');
  }
}

export function assertHostedSutSandboxCommandPlan(
  plan: HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST>
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

export function buildHostedSutSandboxCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  normalizedArgv: readonly string[];
  candidatePreparation?: HostedSutCandidatePreparation;
  candidateEnvironment: NodeJS.ProcessEnv;
  executionAuthorization: HostedSutExecutionAuthorization<typeof import("./hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, import("../../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./hosted-sut-observation.ts").CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, import("../../action/contract/provider.ts").VerificationActionProviderOrigin, typeof import("../../action/contract/environment.ts").CI_VERIFICATION_HOSTED_PROVIDER_REVISION>;
}>): HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST> {
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
  const preparation = input.candidatePreparation === undefined ? null : parseHostedSutCandidatePreparation(input.candidatePreparation);
  if (preparation !== null && (preparation.actionKey !== authorization.actionKey
      || preparation.authorizationDigest !== authorization.authorizationDigest
      || preparation.resolutionDigest !== authorization.resolutionDigest
      || preparation.operationSemanticDigest !== authorization.operationSemanticDigest
      || preparation.baseSha !== input.baseSha || preparation.headSha !== input.headSha
      || preparation.archiveDigest !== input.candidateArchiveDigest
      || preparation.inventoryDigest !== authorization.inventoryClosure.inventoryDigest
      || preparation.dependencyClosureDigest !== authorization.inventoryClosure.dependencyClosureDigest
      || preparation.gitBundleDigest !== authorization.inventoryClosure.gitBundleDigest
      || preparation.inputAccess !== (authorization.normalizedArgv[1] === 'test'
        || (authorization.normalizedArgv[1] === 'run' && ['test', 'check'].includes(authorization.normalizedArgv[2] ?? ''))
        ? 'read-only' : 'writable'))) {
    throw new Error('Hosted candidate preparation lost its Action authorization or retained inventory.');
  }
  const unitName = authorization.physicalCommand.unitName;
  const plan = finalizeHostedSutSandboxCommandPlan({
    phase: 'execute',
    command: '/usr/bin/unshare',
    unitName,
    candidateEnvironmentNames: names,
    executionAuthorizationDigest: authorization.authorizationDigest,
    physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest,
    argv: [
      '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
      '/usr/bin/bash', '-ceu', preparation === null ? HOSTED_SUT_NAMESPACE_SCRIPT : hostedCandidatePreparedNamespaceScript(), 'sec-hosted-sut',
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      ...(preparation === null ? [] : [encodeVerificationActionData(preparation)]),
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`), ...input.normalizedArgv
    ]
  });
  assertHostedSutSandboxCommandPlan(plan);
  return plan;
}

export function buildTrustedBootstrapSutSandboxCommandPlan(input: Readonly<{
  bootstrapDigest: VerificationActionKeyDigest;
  unitSubjectDigest?: VerificationActionKeyDigest;
  candidateArchiveDigest: VerificationActionKeyDigest;
  bunExecutable: string;
  baseSha: string;
  headSha: string;
  candidateEnvironment: NodeJS.ProcessEnv;
  unitNonce: string;
  candidatePreparation?: TrustedBootstrapCandidatePreparation;
}>): HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST> {
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.bootstrapDigest) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.candidateArchiveDigest) ||
      !path.isAbsolute(input.bunExecutable) ||
      !/^[0-9a-f]{40}$/u.test(input.baseSha) || !/^[0-9a-f]{40}$/u.test(input.headSha)) {
    throw new Error('Trusted bootstrap SUT sandbox execution input is invalid.');
  }
  const environment = Object.entries(input.candidateEnvironment)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const preparation = input.candidatePreparation === undefined ? null : parseNativeHostedCandidatePreparation(input.candidatePreparation);
  if (preparation !== null && (preparation.schema !== 'sec-trusted-bootstrap-candidate-preparation'
      || preparation.bootstrapDigest !== input.bootstrapDigest || preparation.archiveDigest !== input.candidateArchiveDigest
      || preparation.baseSha !== input.baseSha || preparation.headSha !== input.headSha)) {
    throw new Error('Bootstrap plan differs from its original physical preparation.');
  }
  const unitName = input.unitSubjectDigest === undefined
    ? hostedSutSandboxUnitName(input.bootstrapDigest, input.unitNonce)
    : path.posix.basename(hostedSutSandboxRoot({
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
      '/usr/bin/bash', '-ceu', preparation === null ? HOSTED_SUT_NAMESPACE_SCRIPT : hostedCandidatePreparedNamespaceScript(),
      // Keep the full operation in the exact shell argv ($0) when its
      // namespace path uses the separate pre-materialization subject.
      input.unitSubjectDigest === undefined ? 'sec-hosted-sut' : `sec-hosted-sut:${input.bootstrapDigest}`,
      unitName, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, input.candidateArchiveDigest,
      input.bunExecutable, input.baseSha, input.headSha,
      ...(preparation === null ? [] : [encodeVerificationActionData(preparation)]),
      String(environment.length),
      ...environment.map(([name, value]) => `${name}=${value}`),
      'bun', '-e', TRUSTED_BOOTSTRAP_SUT_HARNESS
    ]
  });
  assertHostedSutSandboxCommandPlan(plan);
  return plan;
}

export function hostedSutCapabilityCommandPlan(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  bunExecutable: string;
  unitNonce: string;
  executionAuthorization?: HostedSutExecutionAuthorization<typeof import("./hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, import("../../action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("./hosted-sut-observation.ts").CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, import("../../action/contract/provider.ts").VerificationActionProviderOrigin, typeof import("../../action/contract/environment.ts").CI_VERIFICATION_HOSTED_PROVIDER_REVISION>;
}>): HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST> {
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
}>): HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("./revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST> {
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
