import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import type {
  BoundSemanticOperation,
  OperationDigest
} from '../../../execution/operation/semantic.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  type ProcessResourceRunOptions,
  type ProcessResourceRunResult,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary
} from '../../runtime-state/physical/runtime/process.ts';
import type {
  RetainedCommandAuxiliaryInput,
  RetainedCommandBoundary
} from '../../runtime-state/physical/runtime/retained-command-boundary.ts';
import { canonicalGitChildEnvironment } from './environment.ts';

type GitPhysicalProviderIdentity = Readonly<{
  readonly executablePath: string;
  readonly executablePhysical: Readonly<{
    readonly device: string;
    readonly inode: string;
  }>;
  readonly executableSize: number;
  readonly executableDigest: `sha256:${string}`;
  readonly workingDirectory: PhysicalDirectoryChain['target'];
  readonly environmentDigest: OperationDigest;
  readonly identityDigest: OperationDigest;
}>;

export type GitPhysicalProviderCapability = Readonly<{
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly identity: GitPhysicalProviderIdentity;
  readonly operationIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly requirementId: string;
  readonly deadlineAtUnixMs: number;
}>;

export type GitPhysicalProviderReceipt = Readonly<{
  readonly providerIdentityDigest: OperationDigest;
  readonly operationIdentityDigest: OperationDigest;
  readonly boundAttemptDigest: OperationDigest;
  readonly requirementId: string;
  readonly processCount: number;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly receiptDigest: OperationDigest;
}>;

export type GitPhysicalProviderResolution =
  | Readonly<{ status: 'ready'; capability: GitPhysicalProviderCapability }>
  | Readonly<{
    status: 'unavailable';
    reason: 'invalid-input' | 'operation-binding' | 'deadline' | 'physical-admission';
  }>;

type GitPhysicalProviderState = {
  readonly boundary: RetainedCommandBoundary;
  readonly processSession: ProcessResourceSession;
  readonly processCountAtStart: number;
  readonly inputBytesAtStart: number;
  readonly outputBytesAtStart: number;
  readonly maximumInputBytes: number;
  readonly maximumOutputBytes: number;
  readonly maximumProcesses: number;
  active: boolean;
  closed: boolean;
  receipt: GitPhysicalProviderReceipt | null;
};

const GIT_PHYSICAL_PROVIDER_STATES = new WeakMap<object, GitPhysicalProviderState>();
const ISSUED_GIT_PHYSICAL_PROVIDER_RECEIPTS = new WeakSet<object>();

export function isGitPhysicalProviderCapability(
  value: unknown
): value is GitPhysicalProviderCapability {
  return value !== null && typeof value === 'object'
    && GIT_PHYSICAL_PROVIDER_STATES.has(value);
}

function processRequirement(
  operation: BoundSemanticOperation
): Readonly<{ id: string }> | null {
  const requirements = operation.plan.execution.requirements.filter(
    ({ effectKinds }) => effectKinds.includes('process')
  );
  return requirements.length === 1 ? requirements[0]! : null;
}

function operationBudget(
  operation: BoundSemanticOperation,
  resource: 'input-bytes' | 'output-bytes' | 'processes'
): number | null {
  return operation.plan.execution.aggregateBudgets
    .find((budget) => budget.resource === resource)?.maximum ?? null;
}

export function openGitPhysicalProvider(input: Readonly<{
  readonly cwd: string;
  readonly executablePath: string;
  readonly operation: BoundSemanticOperation;
  readonly processSession: ProcessResourceSession;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly environmentSource?: NodeJS.ProcessEnv;
  readonly maximumExecutableBytes: number;
}>): GitPhysicalProviderResolution {
  const cwd = path.resolve(input.cwd);
  const executablePath = path.resolve(input.executablePath);
  if (!path.isAbsolute(input.cwd) || cwd !== input.cwd
      || !path.isAbsolute(input.executablePath) || executablePath !== input.executablePath
      || !Number.isSafeInteger(input.maximumExecutableBytes)
      || input.maximumExecutableBytes < 1) {
    return Object.freeze({ status: 'unavailable', reason: 'invalid-input' });
  }
  const requirement = processRequirement(input.operation);
  const maximumInputBytes = operationBudget(input.operation, 'input-bytes');
  const maximumOutputBytes = operationBudget(input.operation, 'output-bytes');
  const maximumProcesses = operationBudget(input.operation, 'processes');
  if (requirement === null
      || maximumInputBytes === null || maximumInputBytes < 0
      || maximumOutputBytes === null || maximumOutputBytes < 1
      || maximumProcesses === null || maximumProcesses < 1) {
    return Object.freeze({ status: 'unavailable', reason: 'operation-binding' });
  }
  try {
    input.processSession.cooperativeDeadlineAtUnixMs();
  } catch {
    return Object.freeze({ status: 'unavailable', reason: 'deadline' });
  }
  if (input.processSession.operationIdentityDigest
        !== input.operation.plan.identity.identityDigest
      || input.processSession.boundAttemptDigest !== input.operation.boundAttemptDigest
      || input.processSession.requirementId !== requirement.id) {
    return Object.freeze({ status: 'unavailable', reason: 'operation-binding' });
  }
  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let workingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  try {
    const executableParent = inspectNoFollowDirectoryChain(
      path.dirname(executablePath),
      'Git physical provider executable parent'
    );
    executable = retainNoFollowOrdinaryFile(
      executableParent,
      path.basename(executablePath),
      undefined,
      'Git physical provider executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    if (executable.size > input.maximumExecutableBytes) {
      throw new Error('Git executable exceeds the provider byte ceiling.');
    }
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      cwd,
      'Git physical provider working directory'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Git physical provider working directory'
    );
    input.processSession.cooperativeDeadlineAtUnixMs();
    const executableDigest = executable.digest();
    const environment = canonicalGitChildEnvironment(
      input.environment ?? {},
      input.environmentSource
    );
    const environmentDigest = sha256(environment) as OperationDigest;
    const withoutIdentityDigest = Object.freeze({
      executablePath,
      executablePhysical: executable.physical,
      executableSize: executable.size,
      executableDigest: executableDigest.byteDigest,
      workingDirectory: workingDirectoryChain.target,
      environmentDigest
    });
    const identity = Object.freeze({
      ...withoutIdentityDigest,
      identityDigest: sha256({
        domain: 'external-capabilities.git.physical-provider',
        identity: withoutIdentityDigest
      }) as OperationDigest
    });
    const capability = Object.freeze({
      cwd,
      environment,
      identity,
      operationIdentityDigest: input.processSession.operationIdentityDigest,
      boundAttemptDigest: input.processSession.boundAttemptDigest,
      requirementId: input.processSession.requirementId,
      deadlineAtUnixMs: input.processSession.deadlineAtUnixMs
    });
    GIT_PHYSICAL_PROVIDER_STATES.set(capability, {
      boundary: issueRetainedCommandBoundary({ executable, workingDirectory }),
      processSession: input.processSession,
      processCountAtStart: input.processSession.processCount,
      inputBytesAtStart: input.processSession.inputBytes,
      outputBytesAtStart: input.processSession.outputBytes,
      maximumInputBytes,
      maximumOutputBytes,
      maximumProcesses,
      active: false,
      closed: false,
      receipt: null
    });
    return Object.freeze({ status: 'ready', capability });
  } catch {
    try { workingDirectory?.dispose(); } catch { /* typed unavailable */ }
    try { executable?.dispose(); } catch { /* typed unavailable */ }
    return Object.freeze({ status: 'unavailable', reason: 'physical-admission' });
  }
}

/** @internal Exact pre-effect admission for a semantic adapter command sequence. */
export function assertGitPhysicalResourceAdmissionInternal(
  capability: GitPhysicalProviderCapability,
  required: Readonly<{
    processes: number;
    inputBytes: number;
    outputBytes: number;
  }>
): void {
  const state = GIT_PHYSICAL_PROVIDER_STATES.get(capability);
  if (state === undefined || state.closed || state.active) {
    throw new Error('Git physical resource admission requires one idle owner-issued capability.');
  }
  state.processSession.cooperativeDeadlineAtUnixMs();
  if (!Number.isSafeInteger(required.processes) || required.processes < 1
      || !Number.isSafeInteger(required.inputBytes) || required.inputBytes < 0
      || !Number.isSafeInteger(required.outputBytes) || required.outputBytes < 1
      || state.processSession.processCount - state.processCountAtStart + required.processes
        > state.maximumProcesses
      || state.processSession.inputBytes - state.inputBytesAtStart + required.inputBytes
        > state.maximumInputBytes
      || state.processSession.outputBytes - state.outputBytesAtStart + required.outputBytes
        > state.maximumOutputBytes) {
    throw new Error('Git physical provider has insufficient aggregate resources.');
  }
}

/** @internal Only semantic adapters inside external-capabilities.git may import this transport. */
export async function runGitPhysicalCommandInternal(
  capability: GitPhysicalProviderCapability,
  args: readonly string[],
  options: ProcessResourceRunOptions,
  auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[] = []
): Promise<ProcessResourceRunResult> {
  const state = GIT_PHYSICAL_PROVIDER_STATES.get(capability);
  if (state === undefined || state.closed) {
    throw new Error('Git physical execution requires one live owner-issued capability.');
  }
  if (state.active) throw new Error('Git physical provider is single-flight.');
  state.active = true;
  try {
    state.boundary.executable.assertCurrent();
    state.boundary.workingDirectory.assertCurrent();
    const boundary = auxiliaryInputs.length === 0
      ? state.boundary
      : issueRetainedCommandBoundary({
          executable: state.boundary.executable,
          workingDirectory: state.boundary.workingDirectory,
          auxiliaryInputs
        });
    const result = await state.processSession.run(boundary, [...args], options);
    state.boundary.executable.assertCurrent();
    state.boundary.workingDirectory.assertCurrent();
    return result;
  } finally {
    state.active = false;
  }
}

/** @internal Semantic adapters may recheck the exact retained provider around non-child reads. */
export function assertGitPhysicalProviderCurrentInternal(
  capability: GitPhysicalProviderCapability
): void {
  const state = GIT_PHYSICAL_PROVIDER_STATES.get(capability);
  if (state === undefined || state.closed) {
    throw new Error('Git physical provider current check requires one live owner-issued capability.');
  }
  state.processSession.cooperativeDeadlineAtUnixMs();
  state.boundary.executable.assertCurrent();
  state.boundary.workingDirectory.assertCurrent();
}

export function closeGitPhysicalProvider(
  capability: GitPhysicalProviderCapability
): GitPhysicalProviderReceipt {
  const state = GIT_PHYSICAL_PROVIDER_STATES.get(capability);
  if (state === undefined) {
    throw new Error('Git physical close requires one owner-issued capability.');
  }
  if (state.receipt !== null) return state.receipt;
  if (state.active) throw new Error('Git physical provider cannot close during execution.');
  state.boundary.executable.assertCurrent();
  state.boundary.workingDirectory.assertCurrent();
  state.boundary.workingDirectory.dispose();
  state.boundary.executable.dispose();
  const withoutDigest = Object.freeze({
    providerIdentityDigest: capability.identity.identityDigest,
    operationIdentityDigest: capability.operationIdentityDigest,
    boundAttemptDigest: capability.boundAttemptDigest,
    requirementId: capability.requirementId,
    processCount: state.processSession.processCount - state.processCountAtStart,
    inputBytes: state.processSession.inputBytes - state.inputBytesAtStart,
    outputBytes: state.processSession.outputBytes - state.outputBytesAtStart
  });
  state.receipt = Object.freeze({
    ...withoutDigest,
    receiptDigest: sha256({
      domain: 'external-capabilities.git.physical-provider-receipt',
      receipt: withoutDigest
    }) as OperationDigest
  });
  ISSUED_GIT_PHYSICAL_PROVIDER_RECEIPTS.add(state.receipt);
  state.closed = true;
  return state.receipt;
}

export function assertGitPhysicalProviderReceipt(
  receipt: GitPhysicalProviderReceipt,
  capability: GitPhysicalProviderCapability
): void {
  if (receipt === null || typeof receipt !== 'object'
      || !ISSUED_GIT_PHYSICAL_PROVIDER_RECEIPTS.has(receipt)
      || receipt.providerIdentityDigest !== capability.identity.identityDigest
      || receipt.operationIdentityDigest !== capability.operationIdentityDigest
      || receipt.boundAttemptDigest !== capability.boundAttemptDigest
      || receipt.requirementId !== capability.requirementId) {
    throw new Error('Git physical provider receipt is not an exact owner-issued settlement.');
  }
}
