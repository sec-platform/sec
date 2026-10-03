import { randomUUID } from 'node:crypto';
import { fstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../contracts/exact-json.ts';
import { throwIfNativeAborted } from '../../../../contracts/native-abort.ts';
import { issueSecOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { assertSecSemanticOperationProjection, bindSecSemanticOperation, issueSecProviderSettlementReceipt, type SecBoundSemanticOperation, type SecProviderSettlementReceipt } from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import { issueRetainedNoFollowCapability } from '../../../runtime-state/physical/runtime/physical-no-follow-authority.ts';
import {
  createExclusiveNoFollowDirectory, inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile, retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory,
  type PhysicalDirectoryIdentity, type RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { openProcessResourceSession, type ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { issueRetainedCommandBoundary } from '../../../runtime-state/physical/runtime/process.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal, type AuthenticatedGitHubJobOrigin } from '../../github-api/hosted-job-origin.ts';
import { canonicalHostedSandboxRoots, compileHostedSutAppArmorProfile, LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST } from '../contract/linux-hosted-bootstrap-profile.ts';
import { LINUX_HOSTED_BOOTSTRAP_HELPER } from './linux-hosted-bootstrap-helper.ts';

declare const processBrand: unique symbol;
export type HostedBootstrapProcess = Readonly<{ [processBrand]: true }>;
export type HostedBootstrapPhysicalObservation = Readonly<{
  config: Readonly<{ device: string; inode: string; mode: number; gid: number; digest: `sha256:${string}` }>;
  restarted: boolean;
  profile: string | null;
  profileInputDigest: `sha256:${string}` | null;
  profileState: 'enforce' | 'absent';
  daemonId: string;
  daemonVersion: '28.0.4';
  daemonPeer: Readonly<{ pid: number; start: string; uid: 0; device: string; inode: string }>;
}>;
type Record = {
  origin: AuthenticatedGitHubJobOrigin;
  originIdentityDigest: `sha256:${string}`;
  deadline: number;
  roots: readonly string[];
  profile: ReturnType<typeof compileHostedSutAppArmorProfile> | null;
  identityDigest: `sha256:${string}`;
  files: readonly RetainedNoFollowOrdinaryFile[];
  boundary: ReturnType<typeof issueRetainedCommandBoundary>;
  process?: ProcessResourceSession;
  operation?: SecBoundSemanticOperation;
  settlement?: SecProviderSettlementReceipt;
  failure?: HostedBootstrapUnavailableError;
  localCloseAttempted: boolean;
  localCloseFailure?: Readonly<{ error: unknown }>;
  localProcessReceipt?: ReturnType<ProcessResourceSession['close']>;
  state: 'prepared' | 'applying' | 'active' | 'observing' | 'retiring' | 'unknown' | 'closed';
  observation?: HostedBootstrapPhysicalObservation;
  busy: boolean;
};
const issued = new WeakMap<object, Record>();

export class HostedBootstrapUnavailableError extends Error {
  readonly code = 'SEC-HOSTED-BOOTSTRAP-UNAVAILABLE';
  constructor(readonly disposition: 'unsupported' | 'unknown', message: string,
    readonly recovery: Readonly<{ privateRoot?: PhysicalDirectoryIdentity; profileName?: string | null; configuration: '/etc/docker/daemon.json'; observations?: readonly unknown[] }>, options?: ErrorOptions) {
    super(message, options);
  }
}
function unsupported(message: string): never {
  throw new HostedBootstrapUnavailableError('unsupported', message, { configuration: '/etc/docker/daemon.json' });
}
function record(handle: HostedBootstrapProcess): Record {
  const value = issued.get(handle);
  if (value === undefined) unsupported('Hosted bootstrap process is not owner-issued.');
  return value;
}
function live(value: Record): void {
  const origin = assertAuthenticatedGitHubJobOriginCurrent(value.origin);
  if (origin.identityDigest !== value.originIdentityDigest || value.state === 'closed' || value.state === 'unknown'
      || Date.now() >= value.deadline) unsupported('Hosted bootstrap original scope is no longer live.');
  throwIfNativeAborted(getAuthenticatedGitHubJobOriginSignal(value.origin));
  for (const file of value.files) file.assertCurrent();
  value.boundary.workingDirectory.assertCurrent();
}

/** Pure admission helper; it does not prove the later setuid transition succeeds. */
export function assertHostedSudoMetadata(input: Readonly<{ uid: bigint; mode: bigint; nlink: bigint; noNewPrivileges: string; mountOptions: readonly string[] }>): void {
  if (input.uid !== 0n || (input.mode & 0o7777n) !== 0o4755n || input.nlink !== 1n
      || input.noNewPrivileges !== '0' || input.mountOptions.includes('nosuid') || input.mountOptions.includes('noexec')) {
    unsupported('Hosted sudo physical privilege prerequisites are unavailable.');
  }
}
function decodeMountPath(value: string): string { return value.replace(/\\([0-7]{3})/gu, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8))); }
function sudoMountOptions(): readonly string[] {
  const rows = readFileSync('/proc/self/mountinfo', 'utf8');
  if (rows.length > 1024 * 1024) unsupported('Mount observation is oversized.');
  const entries = rows.trim().split('\n').map(line => {
    const fields = line.split(' ');
    if (fields.length < 10) unsupported('Mount observation is malformed.');
    return { mount: decodeMountPath(fields[4]!), options: fields[5]!.split(',') };
  }).filter(entry => entry.mount === '/' || '/usr/bin/sudo'.startsWith(entry.mount + '/'))
    .sort((a, b) => b.mount.length - a.mount.length);
  if (entries[0] === undefined) unsupported('Sudo mount is not observed.');
  return entries[0].options;
}
function retainPlatformFile(location: string): RetainedNoFollowOrdinaryFile {
  const chain = inspectNoFollowDirectoryChain(path.dirname(location));
  for (const item of chain.ancestors) {
    const info = statSync(item.path, { bigint: true });
    if (info.uid !== 0n || (info.mode & 0o022n) !== 0n) unsupported('Platform executable ancestor is not administrator-owned.');
  }
  const file = retainNoFollowOrdinaryFile(chain, path.basename(location));
  try {
    const info = fstatSync(file.stdioSourceDescriptor!, { bigint: true });
    if (info.uid !== 0n || (info.mode & 0o022n) !== 0n || (info.mode & 0o111n) === 0n || info.nlink !== 1n) unsupported('Platform executable is not administrator-owned.');
    if (location === '/usr/bin/sudo') {
      const status = readFileSync('/proc/self/status', 'utf8');
      assertHostedSudoMetadata({ uid: info.uid, mode: info.mode, nlink: info.nlink,
        noNewPrivileges: /^NoNewPrivs:\s+(\d+)$/mu.exec(status)?.[1] ?? '', mountOptions: sudoMountOptions() });
    }
    return file;
  } catch (error) { settleResources({ primary: { label: 'platform-executable', error }, cleanup: [{ label: 'platform-file-close', settle: () => file.dispose() }] }); throw error; }
}

/** No process is started. The privileged retained boundary never leaves this owner. */
export function prepareHostedBootstrapProcess(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; deadlineAtUnixMs: number; sandboxRoots: readonly string[];
}>): HostedBootstrapProcess {
  const originHandle = input.origin;
  const origin = assertAuthenticatedGitHubJobOriginCurrent(originHandle);
  const deadline = input.deadlineAtUnixMs;
  const roots = canonicalHostedSandboxRoots(input.sandboxRoots);
  if ((origin.role === 'sut') !== (roots.length > 0)) unsupported('Bootstrap sandbox roots must match the authenticated job role.');
  if (process.platform !== 'linux' || process.arch !== 'x64' || (process.getuid?.() ?? 0) <= 0
      || !Number.isSafeInteger(deadline) || deadline <= Date.now() || deadline > origin.originalDeadlineAtUnixMs) unsupported('Authenticated hosted bootstrap platform or deadline is unavailable.');
  const profile = roots.length === 0 ? null : compileHostedSutAppArmorProfile({ profileName: `sec-sut-${randomUUID().replaceAll('-', '')}`, sandboxRoots: roots });
  const files: RetainedNoFollowOrdinaryFile[] = [];
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  try {
    for (const name of ['/usr/bin/sudo', '/usr/bin/python3.12', '/usr/bin/systemctl', ...(profile === null ? [] : ['/usr/sbin/apparmor_parser'])]) files.push(retainPlatformFile(name));
    const source = files[0]!;
    // This exception retains the real administrator-owned setuid inode. The
    // generic sealed executable producer remains unchanged. Only the fixed
    // helper below may use the private result; arbitrary argv is never exposed.
    const executable = issueRetainedNoFollowCapability(Object.freeze({
      ...source, childPath: '/proc/self/fd/3',
      assertCurrent(): void {
        source.assertCurrent();
        const metadata = fstatSync(source.stdioSourceDescriptor!, { bigint: true });
        assertHostedSudoMetadata({ uid: metadata.uid, mode: metadata.mode, nlink: metadata.nlink,
          noNewPrivileges: /^NoNewPrivs:\s+(\d+)$/mu.exec(readFileSync('/proc/self/status', 'utf8'))?.[1] ?? '', mountOptions: sudoMountOptions() });
      }
    }), 'executable');
    cwd = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain('/'), 4);
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory: cwd });
    const identityDigest = sha256({ domain: 'sec.hosted-vm.bootstrap.physical', origin: origin.identityDigest,
      profile: LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST, deadline, roots, appArmor: profile?.digest ?? null,
      helper: rawSha256(Buffer.from(LINUX_HOSTED_BOOTSTRAP_HELPER)),
      platformFiles: files.map(file => ({ path: file.path, physical: file.physical, ...file.digest() })) }) as `sha256:${string}`;
    const handle = Object.freeze({}) as HostedBootstrapProcess;
    issued.set(handle, { origin: originHandle, originIdentityDigest: origin.identityDigest, deadline,
      roots, profile, files: Object.freeze(files), boundary, identityDigest, state: 'prepared', busy: false, localCloseAttempted: false });
    return handle;
  } catch (error) { settleResources({ primary: { label: 'bootstrap-prepare', error }, cleanup: [
    { label: 'bootstrap-cwd-close', settle: () => cwd?.dispose() },
    ...files.map(file => ({ label: 'bootstrap-platform-file-close', settle: () => file.dispose() }))
  ] }); throw error; }
}

export function observeHostedBootstrapProcess(handle: HostedBootstrapProcess) {
  const value = record(handle);
  return Object.freeze({ providerIdentityDigest: value.identityDigest, originIdentityDigest: value.originIdentityDigest,
    deadlineAtUnixMs: value.deadline, roots: value.roots, profileName: value.profile?.name ?? null,
    inputProfileDigest: value.profile?.digest ?? null, state: value.state, physical: value.observation ?? null,
    settlement: value.settlement ?? null });
}
type RootProcess = Readonly<{ pid: number; group: number; start: string }>;
function rootProcessObserved(value: RootProcess): void {
  if (!Number.isSafeInteger(value.pid) || value.pid <= 1 || value.group !== value.pid || !/^\d+$/u.test(value.start)) unsupported('Root helper process identity is malformed.');
  const status = readFileSync(`/proc/${value.pid}/status`, 'utf8');
  const info = readFileSync(`/proc/${value.pid}/stat`, 'utf8').split(') ').at(-1)!.split(' ');
  if (!/^Uid:\s+0\s+0\s+0\s+0$/mu.test(status) || info[19] !== value.start || Number(info[2]) !== value.group) unsupported('Root helper uid/start/group readback failed.');
}
function rootGroupAbsent(value: RootProcess): boolean {
  try { process.kill(-value.group, 0); return false; }
  catch (error) { return error instanceof Error && 'code' in error && error.code === 'ESRCH'; }
}
function object(value: unknown): { [key: string]: unknown } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) unsupported('Root helper readback is malformed.');
  return value as { [key: string]: unknown };
}
/** Protocol data validation only. Returned DTOs are not bootstrap capabilities. */
export function parseHostedBootstrapPhysicalReadback(raw: unknown, expected: Readonly<{
  profileName: string | null;
  profileInputDigest: `sha256:${string}` | null;
  profileState: 'enforce' | 'absent';
}>): HostedBootstrapPhysicalObservation {
  const result = object(raw); const config = object(result.config); const peer = object(result.daemonPeer);
  const numericText = (value: unknown): boolean => typeof value === 'string' && /^[0-9]{1,24}$/u.test(value);
  if ((expected.profileName === null ? expected.profileInputDigest !== null
      : !/^sec-sut-[0-9a-f]{32}$/u.test(expected.profileName) || expected.profileInputDigest === null || !/^sha256:[0-9a-f]{64}$/u.test(expected.profileInputDigest))
      || !['enforce', 'absent'].includes(expected.profileState)
      || result.kind !== 'result' || result.profile !== expected.profileName
      || result.profileInputDigest !== expected.profileInputDigest
      || result.profileState !== expected.profileState || typeof result.restarted !== 'boolean'
      || typeof result.daemonId !== 'string' || result.daemonId.length < 1 || result.daemonId.length > 128 || /[\u0000-\u001f]/u.test(result.daemonId) || result.daemonVersion !== '28.0.4'
      || typeof config.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(config.digest)
      || !numericText(config.device) || !numericText(config.inode) || typeof config.mode !== 'number' || ![0o400, 0o444, 0o600, 0o644].includes(config.mode) || !Number.isSafeInteger(config.gid) || Number(config.gid) < 0
      || !Number.isSafeInteger(peer.pid) || Number(peer.pid) <= 1 || peer.uid !== 0 || !numericText(peer.start)
      || !numericText(peer.device) || !numericText(peer.inode)) unsupported('Root helper domain readback is invalid.');
  return Object.freeze({ config: Object.freeze({ ...config }), daemonPeer: Object.freeze({ ...peer }),
    restarted: result.restarted, profile: result.profile, profileInputDigest: result.profileInputDigest,
    profileState: result.profileState, daemonId: result.daemonId, daemonVersion: result.daemonVersion }) as HostedBootstrapPhysicalObservation;
}

async function run(value: Record, mode: 'apply' | 'observe' | 'retire'): Promise<HostedBootstrapPhysicalObservation> {
  if (value.busy || value.process === undefined) unsupported('Hosted bootstrap process is not bound or is busy.');
  value.busy = true;
  let parent: PhysicalDirectoryIdentity | undefined;
  let root: PhysicalDirectoryIdentity | undefined;
  let helper: RootProcess | undefined;
  let pending = '';
  const observations: unknown[] = [];
  let failure: Readonly<{ error: unknown }> | undefined;
  let observed: HostedBootstrapPhysicalObservation | undefined;
  try {
    live(value);
    parent = inspectNoFollowDirectoryChain('/tmp').target;
    const id = randomUUID().replaceAll('-', '');
    root = createExclusiveNoFollowDirectory(parent, `sec-host-bootstrap-${id}`);
    const request = Buffer.from(JSON.stringify({ mode, id, root: { path: root.path, device: root.device, inode: root.inode, uid: process.getuid!() },
      deadline: value.deadline, profileName: value.profile?.name ?? null, profileBytes: value.profile?.bytes ?? null,
      profileDigest: value.profile?.digest ?? null, expectedConfig: value.observation?.config ?? null }));
    const { result } = await value.process.run(value.boundary,
      ['-n', '-k', '--', '/usr/bin/python3.12', '-I', '-S', '-u', '-c', LINUX_HOSTED_BOOTSTRAP_HELPER, String(value.deadline)], {
        envMode: 'replace', env: { PATH: '', HOME: '/', LANG: 'C', LC_ALL: 'C' },
        input: request, maxStdinBytes: 131072, maxStdoutBytes: 131072, maxStderrBytes: 65536,
        beforeSpawn: async () => live(value), admitProgress(chunk, stream) {
          live(value);
          if (stream !== 'stdout') return false;
          pending += chunk.toString('utf8');
          while (pending.includes('\n')) {
            const end = pending.indexOf('\n');
            const entry = object(parseExactJsonBytes(Buffer.from(pending.slice(0, end)), 'root bootstrap observation', { maximumInputBytes: 32768, maximumDepth: 8 }));
            pending = pending.slice(end + 1);
            if (entry.id !== id || observations.length >= 8) unsupported('Root helper observation binding failed.');
            observations.push(Object.freeze(entry));
            if (entry.kind === 'root-start') {
              if (helper !== undefined) unsupported('Root helper repeated its identity.');
              helper = Object.freeze({ pid: Number(entry.pid), group: Number(entry.group), start: String(entry.start) });
              rootProcessObserved(helper);
              publishExclusiveDurableCanonicalFile({ parent: root!, name: 'admit', bytes: Buffer.from(id), permissionMode: 0o400, validate: bytes => { if (Buffer.from(bytes).toString() !== id) unsupported('Bootstrap handshake bytes changed.'); } });
            } else if (entry.kind === 'result') {
              if (helper === undefined || observed !== undefined) unsupported('Root helper result is out of order or repeated.');
              observed = parseHostedBootstrapPhysicalReadback(entry, {
                profileName: value.profile?.name ?? null, profileInputDigest: value.profile?.digest ?? null,
                profileState: mode === 'retire' || value.profile === null ? 'absent' : 'enforce'
              });
            }
            else if (entry.kind !== 'config-intent' && entry.kind !== 'config-published') unsupported('Unexpected bootstrap observation.');
          }
          return true;
        }
      });
    if (result.code !== 0 || pending !== '' || helper === undefined || !rootGroupAbsent(helper) || observed === undefined) unsupported('Root bootstrap result or independent worker-group settlement is unavailable.');
    live(value);
  } catch (error) { failure = { error }; }
  value.busy = false;
  if (failure !== undefined) {
    value.state = 'unknown';
    value.failure = new HostedBootstrapUnavailableError('unknown', 'Bootstrap attempt needs exact resource recovery; no success is issued.',
      { configuration: '/etc/docker/daemon.json', privateRoot: root, profileName: value.profile?.name ?? null, observations: Object.freeze(observations) }, { cause: failure.error });
    throw value.failure;
  }
  try {
    const deadlineAtMonotonicMs = performance.now() + Math.max(0, value.deadline - Date.now());
    const inventory = scanNoFollowDirectoryTreeInventory(root!, { deadlineAtMs: deadlineAtMonotonicMs, maximumEntries: 4, maximumBytes: 4096 });
    retireNoFollowDirectoryTree({ parent: parent!, root: root!, inventory, deadlineAtMonotonicMs });
    live(value);
  } catch (cause) {
    value.state = 'unknown';
    value.failure = new HostedBootstrapUnavailableError('unknown', 'Bootstrap private output cleanup is unconfirmed.',
      { configuration: '/etc/docker/daemon.json', privateRoot: root, profileName: value.profile?.name ?? null }, { cause });
    throw value.failure;
  }
  return observed!;
}

export async function applyHostedBootstrapProcess(handle: HostedBootstrapProcess, input: Readonly<{ operation: SecBoundSemanticOperation; requirementId: string }>): Promise<void> {
  const value = record(handle); live(value);
  if (value.state !== 'prepared' || value.process !== undefined || value.busy) unsupported('Bootstrap apply is one-shot.');
  assertSecSemanticOperationProjection(input.operation);
  const operation = bindSecSemanticOperation(input.operation.plan, input.operation.bindings);
  const binding = operation.bindings.find(item => item.requirementId === input.requirementId);
  const requirement = operation.plan.execution.requirements.find(item => item.id === input.requirementId);
  if (input.requirementId !== 'hosted-job.linux-bootstrap' || binding?.providerIdentityDigest !== value.identityDigest
      || operation.plan.identity.operation !== 'hosted-job-linux-bootstrap'
      || !(['process', 'provider', 'filesystem', 'persistent-state'] as const).every(kind => requirement?.effectKinds.includes(kind) === true)
      || binding.contractDigest !== LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST
      || operation.plan.attempt.deadlineAtUnixMs !== value.deadline) unsupported('Bootstrap original operation/provider binding is invalid.');
  value.process = openProcessResourceSession({ operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({ operation, requirementId: input.requirementId,
      resourceCeilings: operation.plan.execution.aggregateBudgets.filter(item => ['duration-ms', 'processes', 'input-bytes', 'output-bytes'].includes(item.resource)) }),
    signal: getAuthenticatedGitHubJobOriginSignal(value.origin) });
  value.operation = operation;
  if (value.process.deadlineAtUnixMs !== value.deadline) {
    settleResources({ primary: { label: 'bootstrap-budget', error: new Error('Bootstrap process deadline differs from its original owner deadline.') },
      cleanup: [{ label: 'bootstrap-process-close', settle: () => { value.process!.close(); } }] });
  }
  value.state = 'applying';
  value.observation = await run(value, 'apply');
  value.state = 'active';
}

export async function assertHostedBootstrapProcessCurrent(handle: HostedBootstrapProcess): Promise<void> {
  const value = record(handle); live(value);
  if (value.state !== 'active') unsupported('Bootstrap is not active.');
  value.state = 'observing';
  const current = await run(value, 'observe');
  if (JSON.stringify(current.daemonPeer) !== JSON.stringify(value.observation!.daemonPeer)
      || current.daemonId !== value.observation!.daemonId || JSON.stringify(current.config) !== JSON.stringify(value.observation!.config)
      || current.profileState !== value.observation!.profileState) {
    value.state = 'unknown';
    value.failure = new HostedBootstrapUnavailableError('unknown', 'Bootstrap daemon/config/profile lifetime changed.', { configuration: '/etc/docker/daemon.json', profileName: value.profile?.name ?? null });
    throw value.failure;
  }
  value.state = 'active';
}

function closeLocalTransport(value: Record): ReturnType<ProcessResourceSession['close']> | undefined {
  if (value.localCloseAttempted) {
    if (value.localCloseFailure !== undefined) throw value.localCloseFailure.error;
    return value.localProcessReceipt;
  }
  value.localCloseAttempted = true;
  try {
    settleResources({ cleanup: [
      { label: 'bootstrap-process-close', settle: () => { value.localProcessReceipt = value.process?.close(); } },
      { label: 'bootstrap-cwd-close', settle: () => value.boundary.workingDirectory.dispose() },
      ...value.files.map(file => ({ label: 'bootstrap-platform-file-close', settle: () => file.dispose() }))
    ] });
    return value.localProcessReceipt;
  } catch (error) { value.localCloseFailure = { error }; throw error; }
}

export async function retireHostedBootstrapProcess(handle: HostedBootstrapProcess): Promise<void> {
  const value = record(handle);
  if (value.state === 'closed') return;
  if (value.busy) unsupported('Bootstrap cannot retire an active root invocation.');
  const completedActiveLifecycle = value.state === 'active';
  let primary: Readonly<{ error: unknown }> | undefined;
  if (value.state === 'active') {
    value.state = 'retiring';
    try { value.observation = await run(value, 'retire'); }
    catch (error) { primary = { error }; }
  }
  else if (value.state === 'unknown') primary = { error: value.failure ?? new HostedBootstrapUnavailableError('unknown', 'Unsettled bootstrap resources remain owned.', { configuration: '/etc/docker/daemon.json', profileName: value.profile?.name ?? null }) };
  else if (value.state !== 'prepared') unsupported('Bootstrap lifecycle cannot be retired concurrently.');
  if (primary !== undefined) {
    value.state = 'unknown';
    // Releasing local handles cannot establish that a profile was unloaded or
    // that an unknown root group stopped. Preserve the original resource debt.
    settleResources({ primary: { label: 'bootstrap-owned-resource-retirement', error: primary.error },
      cleanup: [{ label: 'bootstrap-local-transport-close', settle: () => { closeLocalTransport(value); } }] });
    throw new Error('Unreachable bootstrap unknown settlement.');
  }
  try {
    const processReceipt = closeLocalTransport(value);
    if (value.operation !== undefined && processReceipt !== undefined) {
      value.settlement = issueSecProviderSettlementReceipt(value.operation, {
        requirementId: 'hosted-job.linux-bootstrap', physicalDisposition: completedActiveLifecycle ? 'settled' : 'not-started',
        providerSettlementReferenceDigest: sha256({ schema: 'sec-hosted-vm-bootstrap-settlement-v1',
          provider: value.identityDigest, process: processReceipt, readback: value.observation ?? null,
          rootWorkerGroups: completedActiveLifecycle ? 'independently-absent-after-every-command' : 'not-started',
          privateOutputs: completedActiveLifecycle ? 'retired' : 'not-created', profile: completedActiveLifecycle ? 'absent' : 'not-installed',
          daemonConfigurationAndCacheOwner: 'authenticated-disposable-job-vm', vmDestruction: 'not-certified' }) as `sha256:${string}`
      });
    }
    value.state = 'closed'; }
  catch (cause) { value.state = 'unknown'; value.failure = new HostedBootstrapUnavailableError('unknown', 'Bootstrap transport close is unconfirmed.', { configuration: '/etc/docker/daemon.json', profileName: value.profile?.name ?? null }, { cause }); throw value.failure; }
}
