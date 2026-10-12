import type { OperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import type { BoundSemanticOperation, OperationDigest, ProviderSettlementReceipt } from '../../../../execution/operation/semantic.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../../providers/github-api/hosted-job-origin.ts';
import { parseSecLinuxVerificationNativeRuntimeManifest, SEC_LINUX_VERIFICATION_NATIVE_PROFILE } from '../../../providers/linux-verification/contract.ts';
import { isGitCandidateBundleByteLength } from '../contract/git-bundle.ts';
import {
  assertLinuxVerificationUnitResultBytes, canonicalLinuxVerificationUnitInvocation,
  LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST, LINUX_VERIFICATION_UNIT_PROFILE,
  LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, LINUX_VERIFICATION_UNIT_RESOURCE_CEILINGS,
  linuxVerificationUnitInvocationDigest, LinuxVerificationUnitUnavailableError,
  parseLinuxVerificationUnitReceipt, parseLinuxVerificationUnitResult,
  type LinuxVerificationRuntimeManifest, type LinuxVerificationUnitInvocation, type LinuxVerificationUnitResult
} from '../contract/linux-verification-unit.ts';
import type { PhysicalDirectoryIdentity, RetainedNoFollowOrdinaryFile, RetainedNoFollowProvenDirectoryGeneration } from './physical-no-follow.ts';
import type { ProcessResourceSessionReceipt } from './process-resource-session.ts';
export * from '../contract/linux-verification-unit.ts';
function invalid(message: string): never { throw new LinuxVerificationUnitUnavailableError('invalid', message); }
function unsupported(message: string): never { throw new LinuxVerificationUnitUnavailableError('unsupported', message); }
function integer(value: unknown, maximum: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid(`${label} is invalid.`);
  return Number(value);
}

export interface LinuxVerificationUnitInputs {
  readonly recoveryRoot: PhysicalDirectoryIdentity;
  /** Existing private origin, mandatory only for the fixed privileged SUT entry. Never transported. */
  readonly hostedSutOrigin?: AuthenticatedGitHubJobOrigin;
  readonly runtime: Readonly<{ root: PhysicalDirectoryIdentity; manifest: LinuxVerificationRuntimeManifest; manifestDigest: `sha256:${string}` }>;
  /** Borrowed from the original Git bundle owner; this owner never releases the borrow's issuer. */
  readonly bundle: Readonly<{ file: RetainedNoFollowOrdinaryFile; baseSha: string; headSha: string; baseTreeSha: string; headTreeSha: string; bundleDigest: `sha256:${string}` }>;
  /** Original publisher-proven input content, not a transplanted execution-generation proof. */
  readonly dependencies: Readonly<{ physicalGeneration: RetainedNoFollowProvenDirectoryGeneration; generationDigest: `sha256:${string}` }> | null;
  readonly retainedSutArchive?: RetainedNoFollowOrdinaryFile;
  readonly deadlineAtUnixMs: number;
}

declare const nativeSessionBrand: unique symbol;
export interface LinuxVerificationUnitSession {
  readonly [nativeSessionBrand]: true;
  /** Transport publication only; rejection/close also settles this promise. */
  readonly inputSnapshotReady: Promise<void>;
  readonly providerIdentityDigest: OperationDigest;
  readonly inputDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
}

export interface LinuxVerificationUnitSessionSettlement {
  readonly processReceipt: ProcessResourceSessionReceipt | null;
  readonly providerSettlement: ProviderSettlementReceipt | null;
  readonly transportRetired: true;
  readonly unitReceiptDigests: readonly OperationDigest[];
  readonly settlementDigest: OperationDigest;
}

declare const nativeRecoveryBrand: unique symbol;
export interface LinuxVerificationUnitRecovery {
  readonly [nativeRecoveryBrand]: true;
  readonly providerIdentityDigest: OperationDigest;
  readonly inputDigest: OperationDigest;
  readonly originalOperationIdentityDigest: OperationDigest;
  readonly originalBoundAttemptDigest: OperationDigest;
  readonly originalDeadlineAtUnixMs: number;
  readonly unitNames: readonly string[];
}
export interface LinuxVerificationUnitRecoverySettlement {
  readonly status: 'settled';
  readonly originalOperationIdentityDigest: OperationDigest;
  readonly originalBoundAttemptDigest: OperationDigest;
  readonly recoveryOperationIdentityDigest: OperationDigest;
  readonly originalProviderSettlement: ProviderSettlementReceipt;
  readonly transportRetired: true;
  readonly processReceipt: ProcessResourceSessionReceipt;
  readonly providerSettlement: ProviderSettlementReceipt;
  readonly settlementDigest: OperationDigest;
}
export class LinuxVerificationUnitRecoveryRequiredError extends Error {
  readonly code = 'SEC-LINUX-NATIVE-UNIT-RECOVERY-REQUIRED';
  constructor(readonly recovery: LinuxVerificationUnitRecovery, cause: unknown) {
    super('Original native unit resources require exact bounded recovery.', { cause });
  }
}


// The implementations below retain the original process owner and will reject
// unresolved inputs before any native privileged operation is admitted.

import { randomUUID } from 'node:crypto';
import { fstatSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepFreeze, rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../contracts/exact-json.ts';
import { assertSemanticOperationProjection, issueProviderSettlementReceipt } from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import { issueRetainedNoFollowCapability } from './physical-no-follow-authority.ts';
import { assertRetainedNoFollowCapability, assertRetainedNoFollowProvenDirectoryGeneration, assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile } from './physical-no-follow.ts';
import { assertProcessResourceRunResult, openProcessResourceSession, type ProcessResourceRunResult, type ProcessResourceSession } from './process-resource-session.ts';
import { issueRetainedCommandBoundary } from './process.ts';
import type { RetainedCommandBoundary } from './retained-command-boundary.ts';

const HELPER_PATH = fileURLToPath(new URL('./linux-verification-unit-helper.py', import.meta.url));
const PLATFORM_FILES = ['/usr/bin/python3.12', '/usr/bin/systemd-run', '/usr/bin/systemctl', '/usr/bin/git', '/usr/bin/tar', '/usr/bin/cp'] as const;
const CONTROL_ENVIRONMENT = Object.freeze({ PATH: '', HOME: '/', LANG: 'C', LC_ALL: 'C' });
const GIT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

/** Necessary read-only prerequisites only; success never issues qualification. */
export function assertLinuxVerificationUnitHostSupported(): void {
  if (process.platform !== 'linux' || process.arch !== 'x64') unsupported('Native verification requires Linux x64.');
  const status = readFileSync('/proc/self/status', 'utf8');
  const uid = process.getuid?.();
  if (readFileSync('/proc/1/comm', 'utf8').trim() !== 'systemd') unsupported('Native verification requires the selected host systemd system manager.');
  const controllers = readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8').trim().split(/\s+/u);
  if (!['cpu', 'memory', 'pids'].every(name => controllers.includes(name))) unsupported('Required cgroup v2 controllers are unavailable.');
  if (uid !== 0) {
    const sudo = statSync('/usr/bin/sudo', { bigint: true });
    if (sudo.uid !== 0n || (sudo.mode & 0o7777n) !== 0o4755n || sudo.nlink !== 1n
        || /^NoNewPrivs:\s+(\d+)$/mu.exec(status)?.[1] !== '0') unsupported('Existing fixed-helper administrator delegation prerequisites are unavailable.');
  }
  for (const file of PLATFORM_FILES) {
    const stat = statSync(file, { bigint: true });
    if (stat.uid !== 0n || (stat.mode & 0o022n) !== 0n || (stat.mode & 0o111n) === 0n || !stat.isFile()) unsupported('Native manager tools must be existing administrator-owned ordinary executables.');
  }
}

type NativeState = {
  inputs: LinuxVerificationUnitInputs;
  files: RetainedNoFollowOrdinaryFile[];
  boundary: RetainedCommandBoundary;
  tarBoundary: RetainedCommandBoundary;
  copyExecutable: RetainedNoFollowOrdinaryFile;
  snapshotCwd?: ReturnType<typeof retainNoFollowDirectoryForChildProcess>;
  helperSource: string;
  operation?: BoundSemanticOperation;
  process?: ProcessResourceSession;
  busy: boolean;
  closed: boolean;
  snapshot?: Readonly<{ root: PhysicalDirectoryIdentity; bundle: RetainedNoFollowOrdinaryFile; dependencies: RetainedNoFollowOrdinaryFile | null; sut: RetainedNoFollowOrdinaryFile | null }>;
  snapshotFailure?: unknown;
  snapshotRoot?: PhysicalDirectoryIdentity;
  ownedTransportFiles?: RetainedNoFollowOrdinaryFile[];
  pendingRequest?: Readonly<{ ordinal: number; unitName: string; invocationDigest: OperationDigest; terminalReceiptDigest?: OperationDigest }>;
  recovery?: LinuxVerificationUnitRecovery;
  recoverySettlement?: LinuxVerificationUnitRecoverySettlement;
  internalProcessReservations: number;
  disposed: Set<object>;
  transportRetired?: true;
  resolveSnapshot(): void;
  rejectSnapshot(error: unknown): void;
  runs: Array<Readonly<{ run: ProcessResourceRunResult; args: readonly string[]; request: Uint8Array; result: LinuxVerificationUnitResult }>>;
  settlement?: LinuxVerificationUnitSessionSettlement;
};
const sessions = new WeakMap<object, NativeState>();
const results = new WeakMap<object, Readonly<{ session: LinuxVerificationUnitSession; digest: OperationDigest }>>();
function state(session: LinuxVerificationUnitSession): NativeState {
  const record = sessions.get(session);
  if (record === undefined) invalid('Native unit session was not issued by its physical owner.');
  return record;
}
function assertOpen(session: LinuxVerificationUnitSession): NativeState {
  const record = state(session);
  if (record.closed || record.process?.signal.aborted || Date.now() >= session.deadlineAtUnixMs) invalid('Native unit session is closed, cancelled or expired.');
  for (const file of record.files) file.assertCurrent();
  record.boundary.workingDirectory.assertCurrent();
  assertSameNoFollowDirectoryIdentity(record.inputs.runtime.root, 'native runtime transport root');
  return record;
}
function platformFile(file: string, descriptor: number, executable = false): RetainedNoFollowOrdinaryFile {
  const parent = inspectNoFollowDirectoryChain(path.dirname(file));
  for (const ancestor of parent.ancestors) {
    const metadata = statSync(ancestor.path, { bigint: true });
    if (metadata.uid !== 0n || (metadata.mode & 0o022n) !== 0n) unsupported('Native platform executable has a mutable/non-administrator ancestor.');
  }
  return retainNoFollowOrdinaryFile(parent, path.basename(file), undefined, 'native verification platform file', descriptor, executable ? 'executable' : 'ordinary-file');
}

function assertHostedSutSource(inputs: LinuxVerificationUnitInputs): OperationDigest | null {
  if (inputs.hostedSutOrigin === undefined) return null;
  const origin = assertAuthenticatedGitHubJobOriginCurrent(inputs.hostedSutOrigin);
  if (origin.role !== 'sut' || inputs.bundle.baseSha !== origin.trustedSourceSha || inputs.bundle.headSha !== origin.trustedSourceSha
      || inputs.bundle.baseTreeSha !== origin.trustedSourceTreeSha || inputs.bundle.headTreeSha !== origin.trustedSourceTreeSha
      || inputs.deadlineAtUnixMs > origin.deadlineAtUnixMs) invalid('Privileged SUT source differs from its original authenticated origin.');
  return origin.identityDigest;
}

/** Retains existing inputs and host tools only. No root command or unit is started. */
export async function prepareLinuxVerificationUnitSession(inputs: LinuxVerificationUnitInputs): Promise<LinuxVerificationUnitSession> {
  inputs = Object.freeze({ ...inputs, recoveryRoot: Object.freeze({ ...inputs.recoveryRoot }),
    runtime: Object.freeze({ ...inputs.runtime, root: Object.freeze({ ...inputs.runtime.root }), manifest: deepFreeze(structuredClone(inputs.runtime.manifest)) }),
    bundle: Object.freeze({ ...inputs.bundle }),
    dependencies: inputs.dependencies === null ? null : Object.freeze({ ...inputs.dependencies }) });
  const originIdentityDigest = assertHostedSutSource(inputs);
  const accepted = SEC_LINUX_VERIFICATION_NATIVE_PROFILE.acceptedContent;
  if (accepted.status !== 'accepted') unsupported('Original native runtime content remains unresolved.');
  const manifest = parseSecLinuxVerificationNativeRuntimeManifest(inputs.runtime.manifest);
  if (sha256(manifest) !== accepted.manifestDigest || inputs.runtime.manifestDigest !== accepted.manifestDigest) invalid('Native runtime differs from the original accepted content authority.');
  assertLinuxVerificationUnitHostSupported();
  integer(inputs.deadlineAtUnixMs, Number.MAX_SAFE_INTEGER, 'native deadline', Date.now() + 1);
  if (inputs.runtime.manifest.schema !== 'sec-linux-verification-native-runtime-manifest-v1'
      || inputs.runtime.manifest.platform !== 'linux/amd64'
      || sha256(inputs.runtime.manifest) !== inputs.runtime.manifestDigest) invalid('Native runtime input manifest is not exact.');
  assertRetainedNoFollowCapability(inputs.bundle.file, 'ordinary-file', 'native Git bundle');
  const bundleBytes = inputs.bundle.file.digest();
  if (bundleBytes.byteDigest !== inputs.bundle.bundleDigest || !isGitCandidateBundleByteLength(bundleBytes.size)) invalid('Native bundle input bytes differ.');
  for (const key of ['baseSha', 'headSha', 'baseTreeSha', 'headTreeSha'] as const) if (!GIT_ID.test(inputs.bundle[key])) invalid('Native bundle source pins are invalid.');
  if (inputs.dependencies !== null) {
    assertRetainedNoFollowProvenDirectoryGeneration(inputs.dependencies.physicalGeneration);
    await inputs.dependencies.physicalGeneration.assertAuthorityCurrent();
  }
  const sutDigest = inputs.retainedSutArchive === undefined ? null : (() => {
    assertRetainedNoFollowCapability(inputs.retainedSutArchive, 'ordinary-file', 'native retained SUT archive');
    return inputs.retainedSutArchive.digest().byteDigest;
  })();
  const files: RetainedNoFollowOrdinaryFile[] = [];
  let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  try {
    const root = process.getuid?.() === 0;
    const rawExecutable = root ? platformFile('/usr/bin/python3.12', 3, true) : platformFile('/usr/bin/sudo', 3);
    files.push(rawExecutable);
    const executable = root ? rawExecutable : issueRetainedNoFollowCapability(Object.freeze({
      ...rawExecutable, childPath: '/proc/self/fd/3',
      assertCurrent() {
        rawExecutable.assertCurrent();
        const info = fstatSync(rawExecutable.stdioSourceDescriptor!, { bigint: true });
        if (info.uid !== 0n || (info.mode & 0o7777n) !== 0o4755n || info.nlink !== 1n) unsupported('Native fixed-helper sudo identity changed.');
        assertLinuxVerificationUnitHostSupported();
      }
    }), 'executable');
    for (const file of PLATFORM_FILES) files.push(platformFile(file, 5));
    const helper = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(HELPER_PATH)), path.basename(HELPER_PATH), undefined, 'fixed native unit helper', 5);
    files.push(helper);
    const helperSource = readFileSync(helper.stdioSourceDescriptor!, 'utf8');
    if (rawSha256(helperSource) !== helper.digest().byteDigest) invalid('Native helper read differs from retained bytes.');
    cwd = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain('/'), 4);
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory: cwd });
    const tar = platformFile('/usr/bin/tar', 3, true); files.push(tar);
    const tarBoundary = issueRetainedCommandBoundary({ executable: tar, workingDirectory: cwd });
    const copyExecutable = platformFile('/usr/bin/cp', 3, true); files.push(copyExecutable);
    const inputDigest = sha256({ hostedSutOriginIdentityDigest: originIdentityDigest, runtimeManifestDigest: inputs.runtime.manifestDigest,
      bundleDigest: inputs.bundle.bundleDigest, baseSha: inputs.bundle.baseSha, baseTreeSha: inputs.bundle.baseTreeSha,
      headSha: inputs.bundle.headSha, headTreeSha: inputs.bundle.headTreeSha,
      dependencyContentDigest: inputs.dependencies?.generationDigest ?? null, sutArchiveDigest: sutDigest }) as OperationDigest;
    assertSameNoFollowDirectoryIdentity(inputs.recoveryRoot, 'native original recovery namespace');
    const providerIdentityDigest = sha256({ recoveryRoot: inputs.recoveryRoot, profileDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
      helperDigest: rawSha256(helperSource), platform: files.map(file => ({ path: file.path, physical: file.physical, digest: file.digest().byteDigest })), inputDigest }) as OperationDigest;
    let resolveSnapshot!: () => void, rejectSnapshot!: (reason: unknown) => void;
    const inputSnapshotReady = new Promise<void>((resolve, reject) => { resolveSnapshot = resolve; rejectSnapshot = reject; });
    void inputSnapshotReady.catch(() => undefined);
    const handle = Object.freeze({ providerIdentityDigest, inputDigest, deadlineAtUnixMs: inputs.deadlineAtUnixMs, inputSnapshotReady }) as LinuxVerificationUnitSession;
    sessions.set(handle, { inputs, files, boundary, tarBoundary, copyExecutable, helperSource, busy: false, closed: false,
      resolveSnapshot, rejectSnapshot, runs: [], internalProcessReservations: 0, disposed: new Set() });
    return handle;
  } catch (error) {
    settleResources({ primary: { label: 'native preparation', error }, cleanup: [
      { label: 'native cwd', settle: () => cwd?.dispose() },
      ...files.map(file => ({ label: 'native retained input', settle: () => file.dispose() }))
    ] });
    throw error;
  }
}

export function bindLinuxVerificationUnitSession(session: LinuxVerificationUnitSession, input: Readonly<{
  operation: BoundSemanticOperation; requirementBindingContext: OperationRequirementBindingContext; signal?: AbortSignal;
}>): void {
  const record = assertOpen(session);
  if (record.process !== undefined) invalid('Native unit session binding is one-shot.');
  assertSemanticOperationProjection(input.operation);
  for (const ceiling of LINUX_VERIFICATION_UNIT_RESOURCE_CEILINGS) {
    const budget = input.operation.plan.execution.aggregateBudgets.find(value => value.resource === ceiling.resource);
    if (budget === undefined || budget.maximum > ceiling.maximum) invalid('Native unit aggregate resource ceiling is widened.');
  }
  const binding = input.operation.bindings.find(value => value.requirementId === LINUX_VERIFICATION_UNIT_REQUIREMENT_ID);
  const requirement = input.operation.plan.execution.requirements.find(value => value.id === LINUX_VERIFICATION_UNIT_REQUIREMENT_ID);
  if (binding?.providerIdentityDigest !== session.providerIdentityDigest || binding.contractDigest !== LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST
      || requirement?.contractDigest !== LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST
      || !(['process', 'provider', 'filesystem', 'persistent-state'] as const).every(kind => requirement.effectKinds.includes(kind))
      || input.operation.plan.attempt.deadlineAtUnixMs !== session.deadlineAtUnixMs) invalid('Native unit original operation/provider binding differs.');
  record.process = openProcessResourceSession(input);
  if (record.process.requirementId !== LINUX_VERIFICATION_UNIT_REQUIREMENT_ID || record.process.deadlineAtUnixMs !== session.deadlineAtUnixMs) {
    record.process.close(); invalid('Native process pool differs from the original aggregate deadline.');
  }
  record.operation = input.operation;
}

import { createExclusiveNoFollowDirectory, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory } from './physical-no-follow.ts';

/** Only transports authenticated bytes. Relocated compiler readiness is issued inside the unit by its original owner. */
async function snapshotInputs(session: LinuxVerificationUnitSession, record: NativeState): Promise<void> {
  if (record.snapshot !== undefined) return;
  if (record.snapshotFailure !== undefined) throw record.snapshotFailure;
  const parent = inspectNoFollowDirectoryChain('/tmp').target;
  let root: PhysicalDirectoryIdentity | undefined;
  const retained: RetainedNoFollowOrdinaryFile[] = [];
  try {
    if (record.inputs.dependencies !== null) {
      assertRetainedNoFollowProvenDirectoryGeneration(record.inputs.dependencies.physicalGeneration);
      await record.inputs.dependencies.physicalGeneration.assertAuthorityCurrent();
    }
    record.inputs.bundle.file.assertCurrent();
    root = createExclusiveNoFollowDirectory(parent, `sec-native-transport-${randomUUID().replaceAll('-', '')}`);
    record.snapshotRoot = root; record.ownedTransportFiles = retained;
    record.snapshotCwd = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(root.path), 4);
    const copyFile = async (file: RetainedNoFollowOrdinaryFile, name: string): Promise<RetainedNoFollowOrdinaryFile> => {
      file.assertCurrent();
      const identity = file.digest();
      if (identity.size > LINUX_VERIFICATION_UNIT_PROFILE.maximumSnapshotBytes) invalid('Native retained input exceeds snapshot budget.');
      const boundary = issueRetainedCommandBoundary({ executable: record.copyExecutable, workingDirectory: record.snapshotCwd!,
        auxiliaryInputs: [{ kind: 'ordinary-file', capability: file }] });
      const copied = await record.process!.run(boundary, ['--reflink=never', '--sparse=never', '--no-preserve=ownership,mode', '--no-clobber', '--', file.childPath, name], {
        envMode: 'replace', env: CONTROL_ENVIRONMENT, maxStdoutBytes: 1024, maxStderrBytes: 65536,
        beforeSpawn: async () => { assertOpen(session); file.assertCurrent(); record.snapshotCwd!.assertCurrent(); }
      });
      if (copied.result.code !== 0) invalid('Native retained byte copy failed.');
      file.assertCurrent(); record.snapshotCwd!.assertCurrent();
      const result = retainNoFollowOrdinaryFile(assertSameNoFollowDirectoryIdentity(root!, 'native snapshot destination'), name, undefined, 'native immutable transport', 5);
      retained.push(result);
      const observed = result.digest();
      if (observed.byteDigest !== identity.byteDigest || observed.size !== identity.size) invalid('Native transport copy differs from original retained bytes.');
      return result;
    };
    const bundle = await copyFile(record.inputs.bundle.file, 'candidate.bundle');
    let dependencies: RetainedNoFollowOrdinaryFile | null = null;
    if (record.inputs.dependencies !== null) {
    const dependencyRoot = record.inputs.dependencies.physicalGeneration.root;
    const inventory = scanNoFollowDirectoryTreeInventory(dependencyRoot, {
      deadlineAtMs: performance.now() + Math.max(0, session.deadlineAtUnixMs - Date.now()),
      maximumEntries: LINUX_VERIFICATION_UNIT_PROFILE.maximumSnapshotEntries,
      maximumBytes: LINUX_VERIFICATION_UNIT_PROFILE.maximumSnapshotBytes
    });
    void inventory; // Actual inventory bounds precede the retained native archive command.
    const archivePath = path.join(root.path, 'dependency-content.tar');
    const archived = await record.process!.run(record.tarBoundary, ['--create', '--format=posix', '--file', archivePath,
      '--directory', dependencyRoot.path, '--', '.'], { envMode: 'replace', env: CONTROL_ENVIRONMENT,
      maxStdoutBytes: 1024, maxStderrBytes: 64 * 1024,
      beforeSpawn: async () => { assertOpen(session); record.inputs.dependencies!.physicalGeneration.assertCurrent(); } });
    if (archived.result.code !== 0) invalid('Native dependency content transport failed.');
    await record.inputs.dependencies.physicalGeneration.assertAuthorityCurrent();
    dependencies = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(root.path), 'dependency-content.tar', undefined, 'native dependency transport', 5);
    retained.push(dependencies);
    if (dependencies.size + bundle.size > LINUX_VERIFICATION_UNIT_PROFILE.maximumSnapshotBytes) invalid('Native input transport exceeds aggregate snapshot bytes.');
    }
    const sut = record.inputs.retainedSutArchive === undefined ? null : await copyFile(record.inputs.retainedSutArchive, 'prepared-candidate.tar');
    if ((dependencies?.size ?? 0) + bundle.size + (sut?.size ?? 0) > LINUX_VERIFICATION_UNIT_PROFILE.maximumSnapshotBytes) invalid('Native input transport exceeds aggregate snapshot bytes.');
    record.snapshot = Object.freeze({ root, bundle, dependencies, sut });
    record.resolveSnapshot();
  } catch (error) {
    record.snapshotFailure = error; record.rejectSnapshot(error);
    settleResources({ primary: { label: 'native input snapshot', error }, cleanup: retained.map(file => ({ label: 'native failed snapshot input', settle: () => file.dispose() })) });
    throw error;
  }
}

function reserveHelperProcesses(record: NativeState, owner: ProcessResourceSession, count: number): void {
  const capacity = owner.observeNativeResourceCapacity();
  // One Linux host admission is owned by ProcessResourceSession.run itself.
  // Fixed helper/manager starts consume the same narrowed pool, irrevocably.
  if (capacity.remaining < record.internalProcessReservations + count + 1) invalid('Native aggregate control-process budget is exhausted.');
  record.internalProcessReservations += count;
}
function disposeOwned(record: NativeState, resource: { dispose(): void }): void {
  if (record.disposed.has(resource)) return;
  resource.dispose(); record.disposed.add(resource);
}
function retireTransport(record: NativeState, deadlineAtMonotonicMs: number): void {
  if (record.transportRetired) return;
  for (const file of record.ownedTransportFiles ?? []) disposeOwned(record, file);
  if (record.snapshotCwd !== undefined) disposeOwned(record, record.snapshotCwd);
  if (record.snapshotRoot !== undefined) {
    const inventory = scanNoFollowDirectoryTreeInventory(record.snapshotRoot, { deadlineAtMs: deadlineAtMonotonicMs,
      maximumEntries: 3, maximumBytes: LINUX_VERIFICATION_UNIT_PROFILE.maximumSnapshotBytes });
    if (inventory.some(entry => entry.kind !== 'file' || !['candidate.bundle', 'dependency-content.tar', 'prepared-candidate.tar'].includes(entry.relativePath))) invalid('Native transport has unknown retirement residue.');
    retireNoFollowDirectoryTree({ parent: inspectNoFollowDirectoryChain('/tmp').target, root: record.snapshotRoot, inventory, deadlineAtMonotonicMs });
  }
  record.transportRetired = true;
}
function assertPlatformCurrent(record: NativeState): void {
  // Existing administrator tools are path-launched by the fixed helper. A live
  // package replacement invalidates the attempt before any qualification.
  for (const file of record.files) if (!record.disposed.has(file)) file.assertCurrent();
}
function retirePlatform(record: NativeState): void {
  disposeOwned(record, record.boundary.workingDirectory);
  for (const file of record.files) disposeOwned(record, file);
}

/** Every call debits the same original process/input/output/deadline pool. */
export async function executeLinuxVerificationUnit(session: LinuxVerificationUnitSession, input: LinuxVerificationUnitInvocation): Promise<LinuxVerificationUnitResult> {
  const record = state(session);
  try { return await executeNativeUnit(session, input); }
  catch (error) {
    // C owns a join on this promise before it can close. Every rejected first
    // admission must settle it too, including expiry and malformed invocation.
    // A rejected concurrent call must not poison the active writer's promise.
    if (!record.busy && record.snapshot === undefined) {
      record.snapshotFailure ??= error; record.rejectSnapshot(error);
    }
    throw error;
  }
}
async function executeNativeUnit(session: LinuxVerificationUnitSession, input: LinuxVerificationUnitInvocation): Promise<LinuxVerificationUnitResult> {
  const record = assertOpen(session);
  if (record.busy || record.process === undefined || record.operation === undefined || record.snapshotFailure !== undefined) invalid('Native unit is unbound, busy or retains an unresolved prior attempt.');
  const invocation = canonicalLinuxVerificationUnitInvocation(input);
  if (invocation.kind === 'hosted-sut' && assertHostedSutSource(record.inputs) === null) invalid('Privileged SUT requires its existing original authenticated source capability.');
  if ((invocation.kind === 'lifecycle-canary') !== (record.inputs.dependencies === null)) invalid('Native dependency input presence differs from the closed invocation kind.');
  if (invocation.kind !== 'hosted-sut' && record.inputs.retainedSutArchive !== undefined) invalid('Only the fixed SUT entry consumes its original retained archive.');
  record.busy = true;
  const ordinal = record.runs.length + 1;
  const unitName = `sec-native-${rawSha256(`${record.operation.plan.identity.identityDigest}\0${record.operation.boundAttemptDigest}\0${ordinal}`).slice(7, 39)}.service`;
  try {
    await snapshotInputs(session, record);
    assertOpen(session);
    const snapshot = record.snapshot!;
    for (const file of [snapshot.bundle, ...(snapshot.dependencies === null ? [] : [snapshot.dependencies]), ...(snapshot.sut === null ? [] : [snapshot.sut])]) file.assertCurrent();
    const invocationData = { ...invocation, stdin: invocation.stdin === undefined ? null : Buffer.from(invocation.stdin).toString('base64') };
    const invocationDigest = linuxVerificationUnitInvocationDigest(invocation);
    const request = Buffer.from(JSON.stringify({ schema: 'sec-linux-native-unit-request-v1', mode: 'run', ordinal,
      profile: LINUX_VERIFICATION_UNIT_PROFILE, profileDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
      operationIdentityDigest: record.operation.plan.identity.identityDigest, boundAttemptDigest: record.operation.boundAttemptDigest,
      providerIdentityDigest: session.providerIdentityDigest, inputDigest: session.inputDigest, invocationDigest,
      deadlineAtUnixMs: session.deadlineAtUnixMs, stopAtUnixMs: record.process.cooperativeDeadlineAtUnixMs(), unitName,
      recoveryRoot: record.inputs.recoveryRoot, maximumControlProcesses: 64,
      runtime: record.inputs.runtime,
      bundle: { path: snapshot.bundle.path, physical: snapshot.bundle.physical, ...snapshot.bundle.digest(),
        baseSha: record.inputs.bundle.baseSha, baseTreeSha: record.inputs.bundle.baseTreeSha,
        headSha: record.inputs.bundle.headSha, headTreeSha: record.inputs.bundle.headTreeSha },
      dependencies: snapshot.dependencies === null ? null : { path: snapshot.dependencies.path, physical: snapshot.dependencies.physical, ...snapshot.dependencies.digest(), generationDigest: record.inputs.dependencies!.generationDigest },
      sutArchive: snapshot.sut === null ? null : { path: snapshot.sut.path, physical: snapshot.sut.physical, ...snapshot.sut.digest() },
      invocation: invocationData }));
    if (request.byteLength > LINUX_VERIFICATION_UNIT_PROFILE.maximumRequestBytes) invalid('Native unit request exceeds its transport bound.');
    const outputBound = Math.ceil((invocation.maxStdoutBytes + invocation.maxStderrBytes
      + invocation.outputFiles.reduce((sum, file) => sum + file.maxBytes, 0)) * 4 / 3) + 128 * 1024;
    const args = [...(process.getuid?.() === 0 ? [] : ['-n', '-k', '--', '/usr/bin/python3.12']),
      '-I', '-S', '-u', '-c', record.helperSource, String(session.deadlineAtUnixMs),
      record.operation.plan.identity.identityDigest, record.operation.boundAttemptDigest, String(ordinal)];
    reserveHelperProcesses(record, record.process, 64);
    record.pendingRequest = { ordinal, unitName, invocationDigest };
    const run = await record.process.run(record.boundary, args, { envMode: 'replace', env: CONTROL_ENVIRONMENT,
      input: request, maxStdinBytes: LINUX_VERIFICATION_UNIT_PROFILE.maximumRequestBytes,
      maxStdoutBytes: outputBound, maxStderrBytes: 64 * 1024,
      beforeSpawn: async () => { assertOpen(session); assertLinuxVerificationUnitHostSupported();
        if (invocation.kind === 'hosted-sut' && assertHostedSutSource(record.inputs) === null) invalid('Privileged SUT source capability is unavailable.'); } });
    if (run.result.code !== 0) throw new LinuxVerificationUnitUnavailableError('unknown', 'Native helper did not return a complete settled result.', { unitName, deadlineAtUnixMs: session.deadlineAtUnixMs });
    const result = parseLinuxVerificationUnitResult(parseExactJsonBytes(run.result.stdout, 'native unit response', { maximumInputBytes: outputBound, maximumDepth: 16 }), invocation);
    const receipt = result.receipt;
    if (receipt.operationIdentityDigest !== record.operation.plan.identity.identityDigest || receipt.boundAttemptDigest !== record.operation.boundAttemptDigest
        || receipt.providerIdentityDigest !== session.providerIdentityDigest || receipt.inputDigest !== session.inputDigest
        || receipt.unit.workingDirectory !== (invocation.cwd === 'scratch' ? '/tmp' : invocation.cwd === 'trusted' ? '/sec-runtime/trusted' : '/sec-runtime/workspace')
        || receipt.invocationDigest !== invocationDigest || receipt.deadlineAtUnixMs !== session.deadlineAtUnixMs || receipt.unit.name !== unitName
        || receipt.inputs.runtimeManifestDigest !== record.inputs.runtime.manifestDigest || receipt.inputs.bundleDigest !== record.inputs.bundle.bundleDigest
        || receipt.inputs.dependencyContentDigest !== (record.inputs.dependencies?.generationDigest ?? null)
        || receipt.inputs.sutArchiveDigest !== (snapshot.sut?.digest().byteDigest ?? null)
        || receipt.gitBefore.baseSha !== record.inputs.bundle.baseSha || receipt.gitBefore.baseTreeSha !== record.inputs.bundle.baseTreeSha
        || receipt.gitBefore.headSha !== record.inputs.bundle.headSha || receipt.gitBefore.headTreeSha !== record.inputs.bundle.headTreeSha) invalid('Native observed result differs from its exact original operation and inputs.');
    assertPlatformCurrent(record);
    results.set(result, { session, digest: receipt.receiptDigest });
    record.runs.push({ run, args, request, result });
    // Keep the terminal digest across acknowledgment response loss. The root
    // tombstone may be removed only after this parent retained the actual result.
    record.pendingRequest = { ordinal, unitName, invocationDigest, terminalReceiptDigest: receipt.receiptDigest };
    reserveHelperProcesses(record, record.process, 1);
    const acknowledgment = Buffer.from(JSON.stringify({ schema: 'sec-linux-native-unit-recovery-request-v1', mode: 'acknowledge',
      recoveryRoot: record.inputs.recoveryRoot, operationIdentityDigest: receipt.operationIdentityDigest,
      boundAttemptDigest: receipt.boundAttemptDigest, inputDigest: session.inputDigest, invocationDigest, unitName, ordinal,
      deadlineAtUnixMs: session.deadlineAtUnixMs, maximumControlProcesses: 1, terminalReceiptDigest: receipt.receiptDigest }));
    const acknowledged = await record.process.run(record.boundary, args, { envMode: 'replace', env: CONTROL_ENVIRONMENT,
      input: acknowledgment, maxStdinBytes: 65536, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
    if (acknowledged.result.code !== 0) invalid('Native terminal acknowledgment is unresolved.');
    const ack = parseExactJsonBytes(acknowledged.result.stdout, 'native terminal acknowledgment', { maximumInputBytes: 65536, maximumDepth: 4 }) as Record<string, unknown>;
    assertRecoveryProjection(ack, record.pendingRequest, session.inputDigest, receipt.operationIdentityDigest, receipt.boundAttemptDigest);
    assertPlatformCurrent(record);
    record.pendingRequest = undefined;
    return result;
  } catch (error) {
    record.snapshotFailure = error; record.rejectSnapshot(error);
    throw error;
  } finally { record.busy = false; }
}

export function assertLinuxVerificationUnitResult(result: LinuxVerificationUnitResult, session: LinuxVerificationUnitSession): void {
  const binding = results.get(result), record = state(session);
  if (binding?.session !== session || binding.digest !== result.receipt.receiptDigest || record.snapshotFailure !== undefined) invalid('Native unit result lacks its original live issued execution.');
  parseLinuxVerificationUnitReceipt(result.receipt); assertLinuxVerificationUnitResultBytes(result);
  if (record.settlement?.processReceipt !== undefined && record.settlement.processReceipt !== null) {
    const run = record.runs.find(item => item.result === result)!;
    assertProcessResourceRunResult(run.run, record.settlement.processReceipt, {
      operationIdentityDigest: result.receipt.operationIdentityDigest, boundAttemptDigest: result.receipt.boundAttemptDigest,
      requirementId: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, boundary: record.boundary,
      args: run.args, input: run.request, env: CONTROL_ENVIRONMENT, envMode: 'replace'
    });
  }
}

export function closeLinuxVerificationUnitSession(session: LinuxVerificationUnitSession): LinuxVerificationUnitSessionSettlement {
  const record = state(session);
  if (record.settlement !== undefined) return record.settlement;
  if (record.busy) invalid('Native session cannot close while execution is unresolved.');
  record.closed = true;
  record.rejectSnapshot(new LinuxVerificationUnitUnavailableError('invalid', 'Native session closed before input transport publication.'));
  try {
    const processReceipt = record.process?.close() ?? null;
    if (record.snapshotFailure !== undefined) throw record.snapshotFailure;
    assertPlatformCurrent(record);
    retireTransport(record, performance.now() + Math.max(1, session.deadlineAtUnixMs - Date.now()));
    retirePlatform(record);
    for (const run of record.runs) {
      assertLinuxVerificationUnitResult(run.result, session);
      if (processReceipt === null) invalid('Executed native unit has no original process settlement.');
      assertProcessResourceRunResult(run.run, processReceipt, {
        operationIdentityDigest: run.result.receipt.operationIdentityDigest, boundAttemptDigest: run.result.receipt.boundAttemptDigest,
        requirementId: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, boundary: record.boundary,
        args: run.args, input: run.request, env: CONTROL_ENVIRONMENT, envMode: 'replace'
      });
    }
    const unitReceiptDigests = Object.freeze(record.runs.map(run => run.result.receipt.receiptDigest));
    const providerSettlement = record.operation === undefined ? null : issueProviderSettlementReceipt(record.operation, {
      requirementId: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, physicalDisposition: record.runs.length === 0 ? 'not-started' : 'settled',
      providerSettlementReferenceDigest: sha256({ processReceipt, unitReceiptDigests, internalProcessReservations: record.internalProcessReservations, transportRetired: true }) as OperationDigest
    });
    const body = Object.freeze({ processReceipt, unitReceiptDigests, providerSettlement, transportRetired: true as const });
    record.settlement = Object.freeze({ ...body, settlementDigest: sha256(body) as OperationDigest });
    return record.settlement;
  } catch (error) {
    record.snapshotFailure ??= error;
    if (record.operation === undefined) throw error; // No bound effect exists yet.
    throw new LinuxVerificationUnitRecoveryRequiredError(getLinuxVerificationUnitRecovery(session), error);
  }
}


import { LINUX_VERIFICATION_UNIT_RECOVERY_CONTRACT_DIGEST, LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID, LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS } from '../contract/linux-verification-unit.ts';
const recoveryOwners = new WeakMap<object, LinuxVerificationUnitSession>();

/** Holds the SAME original resources. A saved JSON descriptor is not this handle. */
export function getLinuxVerificationUnitRecovery(session: LinuxVerificationUnitSession): LinuxVerificationUnitRecovery {
  const record = state(session);
  if (record.recovery !== undefined) return record.recovery;
  if (record.snapshotFailure === undefined || record.operation === undefined) invalid('Native recovery requires an original unresolved bound session.');
  const handle = Object.freeze({ providerIdentityDigest: session.providerIdentityDigest, inputDigest: session.inputDigest,
    originalOperationIdentityDigest: record.operation.plan.identity.identityDigest,
    originalBoundAttemptDigest: record.operation.boundAttemptDigest,
    originalDeadlineAtUnixMs: session.deadlineAtUnixMs,
    unitNames: Object.freeze(record.pendingRequest === undefined ? [] : [record.pendingRequest.unitName]) }) as LinuxVerificationUnitRecovery;
  recoveryOwners.set(handle, session); record.recovery = handle;
  return handle;
}

/** A new bounded cleanup pool does not renew the expired workload or its facts. */
export async function recoverLinuxVerificationUnitSession(recovery: LinuxVerificationUnitRecovery, input: Readonly<{
  operation: BoundSemanticOperation; requirementBindingContext: OperationRequirementBindingContext; signal?: AbortSignal;
}>): Promise<LinuxVerificationUnitRecoverySettlement> {
  const session = recoveryOwners.get(recovery);
  if (session === undefined) invalid('Native recovery handle is not owner-issued.');
  const record = state(session);
  if (record.recoverySettlement !== undefined) return record.recoverySettlement;
  if (record.busy || record.snapshotFailure === undefined) invalid('Native recovery has no unresolved original effect.');
  assertSemanticOperationProjection(input.operation);
  const requirement = input.operation.plan.execution.requirements.find(value => value.id === LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID);
  const binding = input.operation.bindings.find(value => value.requirementId === LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID);
  if (input.operation.plan.identity.operation !== LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID
      || requirement?.contractDigest !== LINUX_VERIFICATION_UNIT_RECOVERY_CONTRACT_DIGEST
      || binding?.providerIdentityDigest !== recovery.providerIdentityDigest
      || !(['process', 'provider', 'filesystem', 'persistent-state'] as const).every(kind => requirement.effectKinds.includes(kind))) invalid('Native recovery operation differs from the original retained provider and cleanup-only contract.');
  for (const ceiling of LINUX_VERIFICATION_UNIT_RECOVERY_RESOURCE_CEILINGS) {
    const budget = input.operation.plan.execution.aggregateBudgets.find(value => value.resource === ceiling.resource);
    if (budget === undefined || budget.maximum > ceiling.maximum) invalid('Native recovery budget is widened.');
  }
  const recoveryProcess = openProcessResourceSession(input);
  record.busy = true;
  try {
    assertPlatformCurrent(record);
    if (record.pendingRequest !== undefined) {
      const pending = record.pendingRequest;
      const request = Buffer.from(JSON.stringify({ schema: 'sec-linux-native-unit-recovery-request-v1',
        mode: 'recover', recoveryRoot: record.inputs.recoveryRoot, maximumControlProcesses: 32, terminalReceiptDigest: pending.terminalReceiptDigest ?? null,
        operationIdentityDigest: recovery.originalOperationIdentityDigest, boundAttemptDigest: recovery.originalBoundAttemptDigest,
        inputDigest: recovery.inputDigest, invocationDigest: pending.invocationDigest,
        unitName: pending.unitName, ordinal: pending.ordinal, deadlineAtUnixMs: recoveryProcess.deadlineAtUnixMs }));
      const args = [...(process.getuid?.() === 0 ? [] : ['-n', '-k', '--', '/usr/bin/python3.12']),
        '-I', '-S', '-u', '-c', record.helperSource, String(recoveryProcess.deadlineAtUnixMs),
        recovery.originalOperationIdentityDigest, recovery.originalBoundAttemptDigest, String(pending.ordinal)];
      // Recovery has its own bounded cleanup admission. It never refunds the
      // original session's irrevocable reservations or renews workload time.
      if (recoveryProcess.observeNativeResourceCapacity().remaining < 33) invalid('Native recovery control-process budget is insufficient.');
      const observed = await recoveryProcess.run(record.boundary, args, { envMode: 'replace', env: CONTROL_ENVIRONMENT, input: request,
        maxStdinBytes: 65536, maxStdoutBytes: 16384, maxStderrBytes: 16384 });
      if (observed.result.code !== 0) throw new LinuxVerificationUnitRecoveryRequiredError(recovery, new Error('Native cleanup remains unconfirmed.'));
      const result = parseExactJsonBytes(observed.result.stdout, 'native recovery result', { maximumInputBytes: 131072, maximumDepth: 8 }) as Record<string, unknown>;
      assertRecoveryProjection(result, pending, recovery.inputDigest, recovery.originalOperationIdentityDigest, recovery.originalBoundAttemptDigest);
      const terminalReceiptDigest = sha256(result) as OperationDigest;
      record.pendingRequest = { ...pending, terminalReceiptDigest };
      const acknowledgment = Buffer.from(JSON.stringify({ schema: 'sec-linux-native-unit-recovery-request-v1', mode: 'acknowledge',
        recoveryRoot: record.inputs.recoveryRoot, maximumControlProcesses: 1, terminalReceiptDigest,
        operationIdentityDigest: recovery.originalOperationIdentityDigest, boundAttemptDigest: recovery.originalBoundAttemptDigest,
        inputDigest: recovery.inputDigest, invocationDigest: pending.invocationDigest,
        unitName: pending.unitName, ordinal: pending.ordinal, deadlineAtUnixMs: recoveryProcess.deadlineAtUnixMs }));
      if (recoveryProcess.observeNativeResourceCapacity().remaining < 34) invalid('Native cleanup acknowledgment exceeds original recovery allowance.');
      const acknowledged = await recoveryProcess.run(record.boundary, args, { envMode: 'replace', env: CONTROL_ENVIRONMENT, input: acknowledgment,
        maxStdinBytes: 65536, maxStdoutBytes: 16384, maxStderrBytes: 16384 });
      if (acknowledged.result.code !== 0) invalid('Native cleanup acknowledgment remains unresolved.');
      const ack = parseExactJsonBytes(acknowledged.result.stdout, 'native cleanup acknowledgment', { maximumInputBytes: 16384, maximumDepth: 4 }) as Record<string, unknown>;
      assertRecoveryProjection(ack, pending, recovery.inputDigest, recovery.originalOperationIdentityDigest, recovery.originalBoundAttemptDigest);
      record.pendingRequest = undefined;
    }
    const originalProcessReceipt = record.process?.close() ?? null;
    assertPlatformCurrent(record);
    retireTransport(record, recoveryProcess.deadlineAtMonotonicMs);
    const processReceipt = recoveryProcess.close();
    const providerSettlement = issueProviderSettlementReceipt(input.operation, {
      requirementId: LINUX_VERIFICATION_UNIT_RECOVERY_REQUIREMENT_ID, physicalDisposition: 'settled',
      providerSettlementReferenceDigest: sha256({ processReceipt, original: recovery, transportRetired: true }) as OperationDigest
    });
    retirePlatform(record);
    const originalProviderSettlement = issueProviderSettlementReceipt(record.operation!, {
      requirementId: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, physicalDisposition: 'settled',
      providerSettlementReferenceDigest: sha256({ originalProcessReceipt, recoveryProcessReceipt: processReceipt,
        inputDigest: recovery.inputDigest, originalReservations: record.internalProcessReservations, transportRetired: true }) as OperationDigest
    });
    const body = Object.freeze({ status: 'settled' as const, originalOperationIdentityDigest: recovery.originalOperationIdentityDigest,
      originalBoundAttemptDigest: recovery.originalBoundAttemptDigest, recoveryOperationIdentityDigest: input.operation.plan.identity.identityDigest,
      transportRetired: true as const, processReceipt, providerSettlement, originalProviderSettlement });
    record.closed = true;
    // Keep the failed facts invalid. Recovery never republishes an issued unit result.
    record.recoverySettlement = Object.freeze({ ...body, settlementDigest: sha256(body) as OperationDigest });
    return record.recoverySettlement;
  } catch (error) {
    try { recoveryProcess.close(); } catch { /* Original recovery capability retains the unresolved debt. */ }
    throw new LinuxVerificationUnitRecoveryRequiredError(recovery, error);
  } finally { record.busy = false; }
}

function assertRecoveryProjection(result: Record<string, unknown>, pending: NonNullable<NativeState['pendingRequest']>, inputDigest: OperationDigest, operationIdentityDigest: OperationDigest, boundAttemptDigest: OperationDigest): void {
  const keys = ['schema', 'status', 'operationIdentityDigest', 'boundAttemptDigest', 'inputDigest', 'invocationDigest', 'unitName', 'qualification'];
  if (Object.keys(result).length !== keys.length || !keys.every(key => Object.hasOwn(result, key))
      || result.schema !== 'sec-linux-native-unit-recovery-result-v1' || result.status !== 'settled'
      || result.operationIdentityDigest !== operationIdentityDigest || result.boundAttemptDigest !== boundAttemptDigest
      || result.inputDigest !== inputDigest || result.invocationDigest !== pending.invocationDigest
      || result.unitName !== pending.unitName || result.qualification !== 'not-issued') invalid('Native cleanup readback differs from its original resource identity.');
}
