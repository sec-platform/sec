import { deepFreeze, rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import type { OperationDigest } from '../../../../execution/operation/semantic.ts';

/** Physical transport only. The original runtime-content owner admits the manifest. */
export interface LinuxVerificationRuntimeManifest {
  readonly schema: 'sec-linux-verification-native-runtime-manifest-v1';
  readonly platform: 'linux/amd64';
  readonly sources: readonly Readonly<{ id: string; kind: 'archive' | 'deb'; url: string; digest: `sha256:${string}`; version: string }>[];
  readonly files: readonly (
    | Readonly<{ path: string; type: 'directory'; mode: number }>
    | Readonly<{ path: string; type: 'file'; mode: number; size: number; digest: `sha256:${string}`; sourceId: string }>
    | Readonly<{ path: string; type: 'symlink'; mode: number; target: string; sourceId: string }>
  )[];
}

export interface LinuxVerificationUnitInvocation {
  readonly kind: 'source-program' | 'verification-action' | 'main-health' | 'hosted-sut' | 'lifecycle-canary' | 'dependency-canary';
  readonly argv: readonly string[];
  readonly cwd: 'trusted' | 'candidate' | 'scratch';
  readonly environment: Readonly<Record<string, string>>;
  readonly stdin?: Uint8Array;
  readonly outputFiles: readonly Readonly<{ path: string; maxBytes: number }>[];
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface LinuxVerificationUnitGitIdentity {
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly status: '';
}

export interface LinuxVerificationUnitReceipt {
  readonly schema: 'sec-linux-native-verification-unit-receipt-v1';
  readonly profileRevision: 'sec-linux-native-verification-unit-v1';
  readonly profileDigest: OperationDigest;
  readonly operationIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly providerIdentityDigest: OperationDigest;
  readonly inputDigest: OperationDigest;
  readonly invocationDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly unit: Readonly<{ name: string; invocationId: string; managerBootId: string; managerStartTime: string; cgroupPath: string; mainPid: number; mainPidStartTime: string; namespaceIdentities: Readonly<{ mount: string; pid: string; network: string; user: string; ipc: string }>; rootDevice: string; rootInode: string; workingDirectory: string; workingDirectoryDevice: string; workingDirectoryInode: string; trustedPackageReadable: true; outputWritable: true; managerMainPid: number; managerMainPidStartTime: string }>;
  readonly inputs: Readonly<{ runtimeManifestDigest: OperationDigest; bundleDigest: OperationDigest; dependencyContentDigest: OperationDigest | null; sutArchiveDigest: OperationDigest | null }>;
  readonly gitBefore: LinuxVerificationUnitGitIdentity;
  readonly gitAfter: LinuxVerificationUnitGitIdentity;
  readonly execution: Readonly<{ exitCode: number; stdoutDigest: OperationDigest; stderrDigest: OperationDigest; stdoutBytes: number; stderrBytes: number; outputTruncated: false }>;
  readonly outputFiles: readonly Readonly<{ path: string; digest: OperationDigest; bytes: number }>[];
  readonly settlement: Readonly<{ unitInactive: true; cgroupEmpty: true; privateMountsRetired: true; inputsRetired: true }>;
  readonly receiptDigest: OperationDigest;
}

export interface LinuxVerificationUnitResult {
  readonly receipt: LinuxVerificationUnitReceipt;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly outputFiles: Readonly<Record<string, Uint8Array>>;
}

export const LINUX_VERIFICATION_UNIT_PROFILE_REVISION = 'sec-linux-native-verification-unit-v1' as const;
export const LINUX_VERIFICATION_UNIT_REQUIREMENT_ID = 'verification.linux-native-unit' as const;
/** These roots belong to the unit's private mounts, never its runtime payload.
 * The native helper independently enforces the same fixed namespace. */
export const LINUX_VERIFICATION_RUNTIME_RESERVED_ROOTS: readonly string[] = Object.freeze([
  'sec-runtime', 'authenticated-input', 'tmp', 'proc', 'dev', 'sys'
]);
export const LINUX_VERIFICATION_UNIT_PROFILE = deepFreeze({
  revision: LINUX_VERIFICATION_UNIT_PROFILE_REVISION,
  cpuQuotaMicros: 200_000, cpuPeriodMicros: 100_000,
  memoryMaxBytes: 4_294_967_296, tasksMax: 256,
  systemdMinimumVersion: 255, pidNamespace: 'util-linux-unshare-fork-kill-child-mount-proc', privateIpc: true,
  deniedPersistentKernelCalls: ['add_key', 'keyctl', 'request_key'],
  trustedSutCapabilities: ['CHOWN', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_CHROOT'],
  namespaceSetupCapabilities: ['SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN'], isolatedUid: 65532, isolatedGid: 65532,
  maximumSnapshotBytes: 4_294_967_296, maximumSnapshotEntries: 200_000,
  maximumRequestBytes: 8 * 1024 * 1024,
  execution: 'fixed-bun-or-original-hosted-sut-entry',
  descendantSettlement: 'exact-unit-cgroup-empty-before-unit-release',
  dependencyInput: 'original-owner-content-import-before-readonly-seal',
  cleanup: 'private-mount-namespace-and-transient-unit-retired'
});
export const LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST = sha256(LINUX_VERIFICATION_UNIT_PROFILE) as OperationDigest;
export const LINUX_VERIFICATION_UNIT_PROFILE_DIGEST = LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST;
/** Original operation pools may narrow these ceilings, never renew them per unit. */
export const LINUX_VERIFICATION_UNIT_RESOURCE_CEILINGS = Object.freeze([
  Object.freeze({ resource: 'duration-ms' as const, maximum: 14_400_000 }),
  Object.freeze({ resource: 'input-bytes' as const, maximum: 64 * 1024 * 1024 }),
  Object.freeze({ resource: 'output-bytes' as const, maximum: 512 * 1024 * 1024 }),
  Object.freeze({ resource: 'processes' as const, maximum: 512 })
]);
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const MAX_OUTPUT = 64 * 1024 * 1024;

export class LinuxVerificationUnitUnavailableError extends Error {
  readonly code = 'SEC-LINUX-NATIVE-UNIT-UNAVAILABLE';
  constructor(readonly disposition: 'unsupported' | 'invalid' | 'unknown', message: string,
    readonly recovery: Readonly<{ unitName?: string; deadlineAtUnixMs?: number }> = {}, options?: ErrorOptions) {
    super(message, options);
  }
}
function invalid(message: string): never { throw new LinuxVerificationUnitUnavailableError('invalid', message); }
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) invalid(`${label} fields are invalid.`);
  return value as Record<string, unknown>;
}
function digest(value: unknown, label: string): OperationDigest {
  if (typeof value !== 'string' || !DIGEST.test(value)) invalid(`${label} digest is invalid.`);
  return value as OperationDigest;
}
function integer(value: unknown, maximum: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(`${label} is invalid.`);
  return Number(value);
}
function text(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/u.test(value)) invalid(`${label} is invalid.`);
  return value;
}
function outputPath(value: unknown): string {
  const result = text(value, 512, 'output path');
  if (!/^\/sec-runtime\/output\/[A-Za-z0-9._/-]+$/u.test(result)
      || result.slice(1).split('/').some(part => !part || part === '.' || part === '..')) invalid('Output path escapes the fixed output root.');
  return result;
}

function parseGitIdentity(value: unknown): LinuxVerificationUnitGitIdentity {
  const record = exact(value, ['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'status'], 'Git identity');
  if (!['baseSha', 'baseTreeSha', 'headSha', 'headTreeSha'].every(key => typeof record[key] === 'string' && GIT_ID.test(record[key] as string)) || record.status !== '') invalid('Native Git identity is not exact and clean.');
  return Object.freeze({ ...record }) as unknown as LinuxVerificationUnitGitIdentity;
}

/** Strict historical codec. It deliberately cannot restore the live result map. */
export function parseLinuxVerificationUnitReceipt(value: unknown): LinuxVerificationUnitReceipt {
  const record = exact(value, ['schema', 'profileRevision', 'profileDigest', 'operationIdentityDigest', 'boundAttemptDigest', 'providerIdentityDigest', 'inputDigest', 'invocationDigest', 'deadlineAtUnixMs', 'unit', 'inputs', 'gitBefore', 'gitAfter', 'execution', 'outputFiles', 'settlement', 'receiptDigest'], 'native unit receipt');
  if (record.schema !== 'sec-linux-native-verification-unit-receipt-v1' || record.profileRevision !== LINUX_VERIFICATION_UNIT_PROFILE_REVISION || record.profileDigest !== LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST) invalid('Native unit receipt profile differs.');
  for (const key of ['profileDigest', 'operationIdentityDigest', 'boundAttemptDigest', 'providerIdentityDigest', 'inputDigest', 'invocationDigest', 'receiptDigest']) digest(record[key], key);
  integer(record.deadlineAtUnixMs, Number.MAX_SAFE_INTEGER, 'deadline', 1);
  const unit = exact(record.unit, ['name', 'invocationId', 'managerBootId', 'managerStartTime', 'cgroupPath', 'mainPid', 'mainPidStartTime', 'namespaceIdentities', 'rootDevice', 'rootInode', 'workingDirectory', 'workingDirectoryDevice', 'workingDirectoryInode', 'trustedPackageReadable', 'outputWritable', 'managerMainPid', 'managerMainPidStartTime'], 'unit');
  if (typeof unit.name !== 'string' || !/^sec-native-[0-9a-f]{32}\.service$/u.test(unit.name)
      || typeof unit.invocationId !== 'string' || !/^[0-9a-f]{32}$/u.test(unit.invocationId)
      || typeof unit.managerBootId !== 'string' || !/^[0-9a-f-]{36}$/u.test(unit.managerBootId)
      || unit.cgroupPath !== `/system.slice/${unit.name}`) invalid('Native unit physical identity is invalid.');
  integer(unit.mainPid, 2 ** 31 - 1, 'main PID', 2);
  integer(unit.managerMainPid, 2 ** 31 - 1, 'manager main PID', 2);
  if (unit.trustedPackageReadable !== true || unit.outputWritable !== true) invalid('Native unit readiness was not observed.');
  for (const key of ['managerStartTime', 'mainPidStartTime', 'managerMainPidStartTime', 'rootDevice', 'rootInode', 'workingDirectoryDevice', 'workingDirectoryInode']) if (typeof unit[key] !== 'string' || !/^[0-9]+$/u.test(unit[key] as string)) invalid('Native unit physical number is invalid.');
  if (!['/sec-runtime/trusted', '/sec-runtime/workspace', '/tmp'].includes(String(unit.workingDirectory))) invalid('Native unit cwd is outside the fixed roots.');
  const namespaces = exact(unit.namespaceIdentities, ['mount', 'pid', 'network', 'user', 'ipc'], 'namespaces');
  const prefixes: Readonly<Record<string, string>> = { mount: 'mnt', pid: 'pid', network: 'net', user: 'user', ipc: 'ipc' };
  for (const key of Object.keys(namespaces)) if (typeof namespaces[key] !== 'string' || !new RegExp(`^${prefixes[key]}:\\[[0-9]+\\]$`, 'u').test(namespaces[key] as string)) invalid('Native namespace identity is invalid.');
  const inputs = exact(record.inputs, ['runtimeManifestDigest', 'bundleDigest', 'dependencyContentDigest', 'sutArchiveDigest'], 'inputs');
  for (const key of ['runtimeManifestDigest', 'bundleDigest']) digest(inputs[key], key);
  if (inputs.dependencyContentDigest !== null) digest(inputs.dependencyContentDigest, 'dependency content');
  if (inputs.sutArchiveDigest !== null) digest(inputs.sutArchiveDigest, 'SUT archive');
  const before = parseGitIdentity(record.gitBefore), after = parseGitIdentity(record.gitAfter);
  if (sha256(before) !== sha256(after)) invalid('Native unit source changed during execution.');
  const execution = exact(record.execution, ['exitCode', 'stdoutDigest', 'stderrDigest', 'stdoutBytes', 'stderrBytes', 'outputTruncated'], 'execution');
  integer(execution.exitCode, 255, 'exit code');
  for (const key of ['stdoutDigest', 'stderrDigest']) digest(execution[key], key);
  for (const key of ['stdoutBytes', 'stderrBytes']) integer(execution[key], MAX_OUTPUT, key);
  if (execution.outputTruncated !== false) invalid('Native unit output is incomplete.');
  if (!Array.isArray(record.outputFiles) || record.outputFiles.length > 8) invalid('Native output file inventory is invalid.');
  const names = new Set<string>();
  for (const entry of record.outputFiles) {
    const file = exact(entry, ['path', 'digest', 'bytes'], 'output file');
    const name = outputPath(file.path); if (names.has(name)) invalid('Native output file is duplicated.'); names.add(name);
    digest(file.digest, 'output file'); integer(file.bytes, MAX_OUTPUT, 'output file bytes');
  }
  const settlement = exact(record.settlement, ['unitInactive', 'cgroupEmpty', 'privateMountsRetired', 'inputsRetired'], 'settlement');
  if (Object.values(settlement).some(item => item !== true)) invalid('Native unit settlement is incomplete.');
  const { receiptDigest, ...body } = record;
  if (sha256(body) !== receiptDigest) invalid('Native unit receipt digest differs.');
  return deepFreeze({ ...record }) as unknown as LinuxVerificationUnitReceipt;
}

export function canonicalLinuxVerificationUnitInvocation(input: LinuxVerificationUnitInvocation): LinuxVerificationUnitInvocation {
  if (!['source-program', 'verification-action', 'main-health', 'hosted-sut', 'lifecycle-canary', 'dependency-canary'].includes(input.kind) || !['trusted', 'candidate', 'scratch'].includes(input.cwd)) invalid('Native invocation kind/cwd is invalid.');
  if (!Array.isArray(input.argv) || input.argv.length > 256 || input.argv.some(value => typeof value !== 'string' || value.length > 16384 || value.includes('\0'))) invalid('Native invocation argv is invalid.');
  if (input.kind === 'lifecycle-canary' && (input.argv.length !== 0 || input.cwd !== 'candidate')) invalid('Lifecycle canary has one fixed Bun version command.');
  if (input.cwd === 'scratch' && input.kind !== 'dependency-canary') invalid('Only the fixed dependency canary uses scratch cwd.');
  if (input.kind === 'dependency-canary' && (JSON.stringify(input.argv) !== JSON.stringify(['--no-install', '/sec-runtime/trusted/src/adapters/toolchain/typescript/canary.ts', '--resolve-from', '/sec-runtime/trusted']) || !['trusted', 'scratch'].includes(input.cwd))) invalid('Dependency canary differs from its fixed existing provider read.');
  if (input.kind === 'hosted-sut' && (input.argv.length !== 0 || input.cwd !== 'trusted')) invalid('Privileged SUT invocation has one fixed entry and no caller argv.');
  integer(input.maxStdoutBytes, MAX_OUTPUT, 'stdout budget', 1); integer(input.maxStderrBytes, MAX_OUTPUT, 'stderr budget', 1);
  if (input.stdin !== undefined && (!(input.stdin instanceof Uint8Array) || input.stdin.byteLength > 1024 * 1024)) invalid('Native invocation stdin is invalid.');
  if (Object.entries(input.environment).some(([name, value]) => !/^(?:CI|HOME|LANG|LC_ALL|TZ|TMPDIR|SEC_[A-Z0-9_]+)$/u.test(name) || typeof value !== 'string' || value.length > 1024 * 1024 || value.includes('\0'))) invalid('Native invocation environment is outside the explicit data namespace.');
  if (input.environment.SEC_STATE_HOME !== undefined && input.environment.SEC_STATE_HOME !== '/sec-runtime/output/state'
      || input.environment.SEC_CACHE_HOME !== undefined && input.environment.SEC_CACHE_HOME !== '/sec-runtime/output/cache') invalid('Native state/cache roots are fixed.');
  if (!Array.isArray(input.outputFiles) || input.outputFiles.length > 8) invalid('Native output inventory is invalid.');
  const files = input.outputFiles.map(file => Object.freeze({ path: outputPath(file.path), maxBytes: integer(file.maxBytes, MAX_OUTPUT, 'file bound', 1) }));
  if (new Set(files.map(file => file.path)).size !== files.length) invalid('Native output file is duplicated.');
  return Object.freeze({ ...input, argv: Object.freeze([...input.argv]), environment: Object.freeze({ ...input.environment }), ...(input.stdin === undefined ? {} : { stdin: new Uint8Array(input.stdin) }), outputFiles: Object.freeze(files) });
}

function decodedOutput(value: unknown, maximum: number, label: string): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) invalid(`${label} encoding is invalid.`);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength > maximum || bytes.toString('base64') !== value) invalid(`${label} exceeds its exact bound.`);
  return new Uint8Array(bytes);
}

export function assertLinuxVerificationUnitResultBytes(result: LinuxVerificationUnitResult): void {
  if (rawSha256(result.stdout) !== result.receipt.execution.stdoutDigest || result.stdout.byteLength !== result.receipt.execution.stdoutBytes
      || rawSha256(result.stderr) !== result.receipt.execution.stderrDigest || result.stderr.byteLength !== result.receipt.execution.stderrBytes
      || Object.keys(result.outputFiles).sort().join(',') !== result.receipt.outputFiles.map(file => file.path).sort().join(',')) invalid('Native result output bytes changed.');
  for (const file of result.receipt.outputFiles) {
    const bytes = result.outputFiles[file.path];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.bytes || rawSha256(bytes) !== file.digest) invalid('Native result output file changed.');
  }
}


/** Data decoding only; the runtime attaches its private issued-result identity. */
export function parseLinuxVerificationUnitResult(value: unknown, invocation: LinuxVerificationUnitInvocation): LinuxVerificationUnitResult {
  const response = exact(value, ['receipt', 'stdout', 'stderr', 'outputFiles'], 'native response');
  const receipt = parseLinuxVerificationUnitReceipt(response.receipt);
  const stdout = decodedOutput(response.stdout, invocation.maxStdoutBytes, 'stdout');
  const stderr = decodedOutput(response.stderr, invocation.maxStderrBytes, 'stderr');
  const encodedFiles = exact(response.outputFiles, invocation.outputFiles.map(file => file.path), 'output file bytes');
  const outputFiles: Record<string, Uint8Array> = {};
  for (const file of invocation.outputFiles) outputFiles[file.path] = decodedOutput(encodedFiles[file.path], file.maxBytes, file.path);
  const result = Object.freeze({ receipt, stdout, stderr, outputFiles: Object.freeze(outputFiles) });
  assertLinuxVerificationUnitResultBytes(result);
  return result;
}
/** Canonical original command identity, shared by live and historical consumers. */
export function linuxVerificationUnitInvocationDigest(input: LinuxVerificationUnitInvocation): OperationDigest {
  const invocation = canonicalLinuxVerificationUnitInvocation(input);
  return sha256({ ...invocation, stdin: invocation.stdin === undefined ? null : Buffer.from(invocation.stdin).toString('base64') }) as OperationDigest;
}

export const LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID = 'verification.linux-native-unit-recovery' as const;
export const LINUX_VERIFICATION_UNIT_RECOVERY_CONTRACT_DIGEST = sha256({ profile: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST, operation: 'settle-only-original-native-resources-v1', durationMs: 30000, inputBytes: 262144, outputBytes: 131072, processes: 128 }) as OperationDigest;
export const LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS = Object.freeze([
  Object.freeze({ resource: 'duration-ms' as const, maximum: 30000 }),
  Object.freeze({ resource: 'input-bytes' as const, maximum: 262144 }),
  Object.freeze({ resource: 'output-bytes' as const, maximum: 131072 }),
  Object.freeze({ resource: 'processes' as const, maximum: 128 })
]);
