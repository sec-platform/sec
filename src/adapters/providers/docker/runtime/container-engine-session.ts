import path from 'node:path';
import { types as nativeTypes } from 'node:util';

import { sha256 } from '../../../../contracts/canonical.ts';
import { linkNativeAbortSignals } from '../../../../contracts/native-abort.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  assertSemanticOperationProjection,
  bindSemanticOperation,
  issueProviderSettlementReceipt,
  type BoundSemanticOperation,
  type OperationDigest,
  type ProviderSettlementReceipt
} from '../../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
import {
  issueIndependentProviderProcessCapability,
  type IndependentProviderProcessCapability
} from '../../../runtime-state/physical/runtime/independent-provider-process.ts';
import {
  type PhysicalDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { issueRetainedCommandBoundary, RetainedCommandTransportError } from '../../../runtime-state/physical/runtime/process.ts';
import {
  openRetainedWindowsRuntimeStateDirectory,
  type RetainedRuntimeStateDirectory
} from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import {
  assertRuntimeGenerationCensusReceipt,
  censusRetainedRuntimeGenerations,
  observeRetainedRuntimeEndpointResidue,
  type RuntimeEndpointResidueReceipt,
  type RuntimeGenerationCensusReceipt
} from '../../../runtime-state/physical/runtime/runtime-endpoint-residue.ts';
import { DockerCommandOperationUnavailableError } from '../contract/command-provider.ts';
import type {
  ContainerEngineCommandResult,
  ContainerEngineOperation,
  ContainerEngineOperationOptions,
  ContainerEngineOperationScope,
  ContainerEngineSession,
  OpenContainerEngineSessionInput
} from '../contract/container-engine-session.ts';
import {
  createDockerEndpointIdentity,
  DockerDaemonAvailabilityFailure,
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../contract/daemon.ts';
import { DOCKER_DESKTOP_WINDOWS_RUNTIME_STATE_CONTRACT, isDockerDesktopManagedEndpoint } from '../contract/windows-runtime-state.ts';
import {
  claimDockerCommandProviderCapability,
  disposeClaimedDockerCommandProvider
} from './command-provider.ts';
import {
  ensureDockerDaemonStartedWithCommand,
  observeDockerDaemonWithCommand,
  projectStartedDockerDaemonLauncherFailure,
  type DockerDaemonCommandResult,
  type DockerDaemonLauncherResult
} from './daemon-algorithm.ts';
import { withDockerDesktopLauncherLock } from './daemon.ts';
import { assertQualifiedLinuxDockerCli, type QualifiedLinuxDockerCli } from './linux-cli-qualification.ts';

export const LINUX_DOCKER_OPERATIONS: readonly ContainerEngineOperation['kind'][] = Object.freeze([]);
const issuedSessions = new WeakMap<object, Readonly<{
  assertCurrent(): Promise<void>;
  assertIdle(): void;
  observeCloseState(): 'open' | 'settled' | 'unknown';
  qualifiedLinux: boolean;
  originIdentityDigest: OperationDigest | null;
  signal: AbortSignal;
}>>();

export async function assertRetainedQualifiedLinuxEngineSession(session: ContainerEngineSession): Promise<void> {
  const retained = issuedSessions.get(session);
  if (retained?.qualifiedLinux !== true) fail('session has no qualified Linux CLI');
  await retained.assertCurrent();
}

export function qualifiedLinuxEngineOriginIdentity(session: ContainerEngineSession): OperationDigest {
  const retained = issuedSessions.get(session);
  if (retained?.qualifiedLinux !== true || retained.originIdentityDigest === null) fail('session has no authenticated Linux origin');
  return retained.originIdentityDigest;
}

export function assertContainerEngineSessionTransferable(session: ContainerEngineSession): void {
  const retained = issuedSessions.get(session);
  if (retained === undefined) fail('session is not owner-issued');
  retained.assertIdle();
}

export function retainedContainerEngineSessionSignal(session: ContainerEngineSession): AbortSignal {
  const retained = issuedSessions.get(session);
  if (retained === undefined) fail('session is not owner-issued');
  return retained.signal;
}

export function observeRetainedContainerEngineSessionClose(session: ContainerEngineSession): 'open' | 'settled' | 'unknown' {
  const retained = issuedSessions.get(session);
  if (retained === undefined) fail('session is not owner-issued');
  return retained.observeCloseState();
}

export class QualifiedLinuxDockerScopeUnavailableError extends Error {
  readonly code = 'SEC-LINUX-DOCKER-OPERATION-BUDGET-UNSUPPORTED' as const;
  readonly disposition = 'unsupported' as const;
}

/** A narrower advertised scope cannot borrow a longer physical run deadline. */
export function assertQualifiedLinuxDockerScopeBudget(input: Readonly<{
  operation: BoundSemanticOperation;
  sessionDeadlineAtUnixMs: number;
}>): void {
  assertSemanticOperationProjection(input.operation);
  const deadline = input.operation.plan.attempt.deadlineAtUnixMs;
  const duration = input.operation.plan.execution.aggregateBudgets.find(({ resource }) => resource === 'duration-ms')?.maximum ?? 0;
  const remaining = deadline - Date.now();
  if (deadline !== input.sessionDeadlineAtUnixMs || remaining <= 0 || duration < remaining) {
    throw new QualifiedLinuxDockerScopeUnavailableError('Qualified Linux scope must share the original physical session deadline and duration ceiling.');
  }
}

/** This is a capability decision, before starting the CLI or charging transport. */
export function assertDockerCommandOperationAvailable(
  platform: NodeJS.Platform,
  operation: ContainerEngineOperation['kind'] | undefined,
  qualifiedLinuxCli?: QualifiedLinuxDockerCli
): void {
  if (platform === 'linux') {
    if (qualifiedLinuxCli !== undefined) {
      assertQualifiedLinuxDockerCli(qualifiedLinuxCli);
      return;
    }
    throw new DockerCommandOperationUnavailableError(
      operation ?? 'docker-cli',
      operation === 'buildx-build' || operation === 'buildx-bake' || operation === 'buildx-inspect-default'
        ? 'linux-buildx-closure-unavailable'
        : 'linux-cli-plugin-closure-unavailable'
    );
  }
}


const OPERATION_PREFIX = Object.freeze({
  'buildx-bake': ['buildx', 'bake'],
  'buildx-build': ['buildx', 'build'],
  'buildx-inspect-default': ['buildx', 'inspect', 'default'],
  'container-copy': ['container', 'cp'],
  'container-create': ['container', 'create'],
  'container-exec': ['container', 'exec'],
  'container-inspect': ['container', 'inspect'],
  'container-list': ['container', 'ls'],
  'container-remove': ['container', 'rm'],
  'container-run': ['container', 'run'],
  'container-start': ['container', 'start'],
  'container-stop': ['container', 'stop'],
  'image-inspect': ['image', 'inspect'],
  'image-list': ['image', 'ls'],
  'image-remove': ['image', 'rm'],
  'network-disconnect': ['network', 'disconnect'],
  'volume-create': ['volume', 'create'],
  'volume-inspect': ['volume', 'inspect']
} as const satisfies Record<ContainerEngineOperation['kind'], readonly string[]>);

function fail(message: string): never {
  throw new Error(`Container Engine session: ${message}`);
}

function semanticOperationBudget(
  operation: BoundSemanticOperation,
  resource: 'input-bytes' | 'output-bytes' | 'processes'
): number {
  return operation.plan.execution.aggregateBudgets
    .find((candidate) => candidate.resource === resource)?.maximum ?? 0;
}

/**
 * Canonical admission guard separating a non-settling outer resource envelope
 * from a real provider-owned semantic operation scope.
 */
export function assertContainerEngineOperationScopeAdmission(input: Readonly<{
  operation: BoundSemanticOperation;
  requirementId: string;
  providerIdentityDigest: OperationDigest;
  sessionDeadlineAtUnixMs: number;
}>): void {
  assertSemanticOperationProjection(input.operation);
  const requirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === input.requirementId
  );
  const binding = input.operation.bindings.find(
    ({ requirementId }) => requirementId === input.requirementId
  );
  if (requirement === undefined || binding === undefined
      || !(['filesystem', 'process', 'provider'] as const).every((kind) => (
        requirement.effectKinds.includes(kind)
      ))
      || binding.contractDigest !== requirement.contractDigest
      || binding.providerIdentityDigest !== input.providerIdentityDigest) {
    fail('provider settlement scope does not bind this retained Container Engine provider');
  }
  for (const resource of ['processes', 'output-bytes'] as const) {
    if (semanticOperationBudget(input.operation, resource) < 1) {
      fail(`provider settlement scope requires a positive ${resource} budget`);
    }
  }
  if (input.operation.plan.attempt.deadlineAtUnixMs > input.sessionDeadlineAtUnixMs) {
    fail('provider settlement scope deadline exceeds the retained session deadline');
  }
}

export function compileContainerEngineAdmissionProviderIdentity(input: Readonly<{
  authorityProviderIdentityDigest: OperationDigest;
  projectionProviderIdentityDigest: OperationDigest;
  environmentDigest: OperationDigest;
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  executable: Readonly<{
    path: string;
    size: number;
    byteDigest: `sha256:${string}`;
    contentDigest: `sha256:${string}`;
  }>;
  workingDirectory: PhysicalDirectoryIdentity;
  runtimeStateRoots: readonly Readonly<{
    root: PhysicalDirectoryIdentity;
    directory: PhysicalDirectoryIdentity;
  }>[];
  generationCensus: RuntimeGenerationCensusReceipt;
}>): OperationDigest {
  assertRuntimeGenerationCensusReceipt(input.generationCensus);
  if (input.generationCensus.providerIdentityDigest
      !== input.authorityProviderIdentityDigest) {
    throw new Error('Container Engine generation census authority provider changed.');
  }
  return sha256({
    schema: 'sec-container-engine-provider-admission-identity-v1',
    ...input
  }) as OperationDigest;
}

export function compileObservedContainerEngineProviderIdentity(input: Readonly<{
  authorityProviderIdentityDigest: OperationDigest;
  projectionProviderIdentityDigest: OperationDigest;
  environmentDigest: OperationDigest;
  operationIdentityDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  executable: Readonly<{
    path: string;
    size: number;
    byteDigest: `sha256:${string}`;
    contentDigest: `sha256:${string}`;
  }>;
  workingDirectory: PhysicalDirectoryIdentity;
}>): OperationDigest {
  return sha256({
    schema: 'sec-container-engine-observed-provider-identity-v1',
    ...input
  }) as OperationDigest;
}

export function compileContainerEngineReadyProviderIdentity(input: Readonly<{
  admissionProviderIdentityDigest: OperationDigest;
  endpoint: DockerEndpointIdentity;
}>): OperationDigest {
  const endpoint = parseDockerEndpointIdentity(input.endpoint);
  return sha256({
    schema: 'sec-container-engine-retained-provider-identity-v1',
    predecessorAdmissionProviderIdentityDigest: input.admissionProviderIdentityDigest,
    endpoint
  }) as OperationDigest;
}

interface DockerDesktopLifecycleEnvironment {
  identityMaterial(): readonly Readonly<{
    root: PhysicalDirectoryIdentity;
    directory: PhysicalDirectoryIdentity;
  }>[];
  assertCurrent(): void;
  censusRuntimeGenerations(
    providerIdentityDigest: `sha256:${string}`
  ): RuntimeGenerationCensusReceipt;
  observeRuntimeEndpointResidue(
    providerEvidence: string,
    providerIdentityDigest: `sha256:${string}`
  ): RuntimeEndpointResidueReceipt | null;
  close(): void;
}

async function dockerDesktopLifecycleEnvironment(): Promise<DockerDesktopLifecycleEnvironment> {
  const retained: RetainedRuntimeStateDirectory[] = [];
  let generationCensusReceipt: RuntimeGenerationCensusReceipt | null = null;
  let admittedGenerationRoots: readonly PhysicalDirectoryIdentity[] = Object.freeze([]);
  let closed = false;
  let terminalCloseFailure: Readonly<{ error: unknown }> | undefined;
  const close = (): void => {
    if (closed) {
      if (terminalCloseFailure !== undefined) throw terminalCloseFailure.error;
      return;
    }
    try {
      settlePhysicalResources({
        cleanup: [
          ...[...retained].reverse().map((directory, index) => ({
            label: `runtime-state-root-${index}`,
            settle: () => { directory.close(); }
          }))
        ]
      });
    } catch (error) {
      terminalCloseFailure = Object.freeze({ error });
      throw error;
    } finally {
      closed = true;
    }
  };
  try {
    const localAppData = await openRetainedWindowsRuntimeStateDirectory({
      ...DOCKER_DESKTOP_WINDOWS_RUNTIME_STATE_CONTRACT.localAppData,
      requireHostNamespace: true
    });
    retained.push(localAppData);
    const ownerByFolder = new Map([
      [DOCKER_DESKTOP_WINDOWS_RUNTIME_STATE_CONTRACT.localAppData.folder, localAppData]
    ] as const);
    return Object.freeze({
      identityMaterial() {
        if (closed) throw new Error('Docker Desktop retained runtime-state environment is closed.');
        return Object.freeze(retained.map(({ root, directory }) => Object.freeze({
          root,
          directory
        })));
      },
      assertCurrent(): void {
        if (closed) throw new Error('Docker Desktop retained runtime-state environment is closed.');
        for (const directory of retained) directory.assertCurrent();
      },
      censusRuntimeGenerations(
        providerIdentityDigest: `sha256:${string}`
      ): RuntimeGenerationCensusReceipt {
        if (closed) throw new Error('Docker Desktop retained runtime-state environment is closed.');
        if (generationCensusReceipt !== null) {
          if (generationCensusReceipt.providerIdentityDigest !== providerIdentityDigest) {
            throw new Error('Docker Desktop runtime generation census provider identity changed.');
          }
          return generationCensusReceipt;
        }
        const census = censusRetainedRuntimeGenerations({
          providerIdentityDigest,
          ...DOCKER_DESKTOP_WINDOWS_RUNTIME_STATE_CONTRACT.generationCensus,
          profiles: DOCKER_DESKTOP_WINDOWS_RUNTIME_STATE_CONTRACT.generationRoots.map((profile) => {
            const owner = ownerByFolder.get(profile.folder);
            if (owner === undefined) {
              throw new Error('Docker Desktop generation root has no retained Known Folder owner.');
            }
            return Object.freeze({
              id: profile.id,
              owner,
              segments: profile.segments,
              childDescriptor: profile.childDescriptor
            });
          })
        });
        try {
          admittedGenerationRoots = Object.freeze(
            census.generations.map(({ directory }) => directory)
          );
          generationCensusReceipt = census.receipt;
        } finally {
          // The official provider owns mutations beneath these generation
          // roots. Retain them through census readback, then release before
          // the launcher Effect rather than requiring the preimage to remain
          // unchanged while Docker performs its own recovery.
          census.close();
        }
        return generationCensusReceipt;
      },
      observeRuntimeEndpointResidue(
        providerEvidence: string,
        providerIdentityDigest: `sha256:${string}`
      ): RuntimeEndpointResidueReceipt | null {
        if (closed) throw new Error('Docker Desktop retained runtime-state environment is closed.');
        if (generationCensusReceipt === null) {
          throw new Error('Docker Desktop runtime generation census has not been admitted.');
        }
        return observeRetainedRuntimeEndpointResidue({
          admittedGenerationRoots,
          providerEvidence,
          providerIdentityDigest,
          roots: retained
        });
      },
      close
    });
  } catch (error) {
    settlePhysicalResources({
      primary: Object.freeze({ label: 'runtime-state-admission', error }),
      cleanup: [{ label: 'runtime-state-close', settle: close }]
    });
    throw error;
  }
}

function boundedArguments(arguments_: readonly string[]): readonly string[] {
  if (!Array.isArray(arguments_) || arguments_.length > 4_096) {
    fail('operation argument count is invalid');
  }
  let bytes = 0;
  const retained = arguments_.map((argument) => {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      fail('operation arguments must be NUL-free strings');
    }
    bytes += Buffer.byteLength(argument, 'utf8') + 1;
    if (!Number.isSafeInteger(bytes) || bytes > 16 * 1024 * 1024) {
      fail('operation arguments exceed the byte bound');
    }
    if (argument === '--host' || argument.startsWith('--host=')) {
      fail('operation cannot replace the retained endpoint');
    }
    return argument;
  });
  return Object.freeze(retained);
}

/** Validates the complete argv after the owner has injected its retained endpoint. */
function boundedOwnerArguments(arguments_: readonly string[]): readonly string[] {
  if (!Array.isArray(arguments_) || arguments_.length > 4_096) {
    fail('owner operation argument count is invalid');
  }
  let bytes = 0;
  return Object.freeze(arguments_.map((argument) => {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      fail('owner operation arguments must be NUL-free strings');
    }
    bytes += Buffer.byteLength(argument, 'utf8') + 1;
    if (!Number.isSafeInteger(bytes) || bytes > 16 * 1024 * 1024) {
      fail('owner operation arguments exceed the byte bound');
    }
    return argument;
  }));
}

function operationArguments(operation: ContainerEngineOperation): readonly string[] {
  if (operation.kind === 'buildx-inspect-default' && operation.arguments.length !== 0) {
    fail('default builder inspection cannot accept bootstrap, another selector or other arguments');
  }
  const prefix = OPERATION_PREFIX[operation.kind];
  return Object.freeze([...prefix, ...boundedArguments(operation.arguments)]);
}

export function compileContainerEngineOperationArguments(
  endpoint: DockerEndpointIdentity,
  operation: ContainerEngineOperation
): readonly string[] {
  const retainedEndpoint = parseDockerEndpointIdentity(endpoint);
  return boundedOwnerArguments([
    '--host',
    retainedEndpoint.endpointHost,
    ...operationArguments(operation)
  ]);
}

/** One selector for qualification and every subsequent materialization command. */
export function compileQualifiedLinuxDockerOperationArguments(
  endpoint: DockerEndpointIdentity,
  operation: ContainerEngineOperation
): readonly string[] {
  if (operation.kind !== 'buildx-build' && operation.kind !== 'buildx-bake') {
    return compileContainerEngineOperationArguments(endpoint, operation);
  }
  if (operation.arguments.some((argument) => argument === '--builder' || argument.startsWith('--builder='))) {
    fail('qualified Linux Buildx cannot replace its default builder selector');
  }
  return compileContainerEngineOperationArguments(endpoint, {
    ...operation, arguments: ['--builder=default', ...operation.arguments]
  });
}

/** Curl supplies HTTP framing; only a fixed local Engine observation is admitted. */
export function compileLinuxDockerDaemonProbeArguments(
  endpointHost: string,
  deadlineAtUnixMs: number
): readonly string[] {
  const host = dockerEndpointHost(endpointHost);
  const socket = host.slice('unix://'.length);
  if (!host.startsWith('unix:///') || path.posix.resolve(socket) !== socket) {
    fail('daemon probe requires a canonical local Linux endpoint');
  }
  const remainingMs = deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(remainingMs) || remainingMs < 1) fail('daemon probe deadline is exhausted');
  return Object.freeze([
    '--disable', '--silent', '--show-error', '--fail', '--proto', '=http',
    '--proxy', '', '--noproxy', '*', '--max-redirs', '0',
    '--unix-socket', socket, '--max-time', (remainingMs / 1_000).toFixed(3),
    '--url', 'http://localhost/info'
  ]);
}

function parseJsonObject(source: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(source).toString('utf8'));
  } catch {
    fail(`${label} is not JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} must be one object`);
  }
  return parsed as Record<string, unknown>;
}

function boundedIdentityText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function dockerEndpointHost(value: unknown): string {
  const host = boundedIdentityText(value, 'endpoint host', 1_024);
  if (!/^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+$/u.test(host)
      && !/^unix:\/{3}[^\u0000-\u001f]+$/u.test(host)) {
    fail('endpoint must use a local npipe or unix transport');
  }
  return host;
}

function endpointFromInfo(input: Readonly<{
  contextName: string;
  endpointHost: string;
  info: Uint8Array;
}>): DockerEndpointIdentity {
  const info = parseJsonObject(input.info, 'daemon info');
  return createDockerEndpointIdentity({
    contextName: input.contextName,
    endpointHost: input.endpointHost,
    daemonId: boundedIdentityText(info.ID, 'daemon identity', 128),
    osType: info.OSType as 'linux',
    architecture: info.Architecture as 'x86_64'
  });
}

export async function observeBeforeDockerDesktopLifecycleAdmission(
  input: Readonly<{
    platform: NodeJS.Platform;
    endpointHost: string;
    observe(): Promise<DockerDaemonCommandResult>;
    admitAndEnsureStarted(): Promise<DockerDaemonCommandResult>;
  }>
): Promise<DockerDaemonCommandResult> {
  try {
    return await input.observe();
  } catch (error) {
    if (!(error instanceof DockerDaemonAvailabilityFailure)
        || error.reason !== 'endpoint-unavailable'
        || input.platform !== 'win32'
        || !isDockerDesktopManagedEndpoint(input.endpointHost)) {
      throw error;
    }
    return await input.admitAndEnsureStarted();
  }
}

function assertPositiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024) {
    fail(`${label} is invalid`);
  }
  return value;
}

export async function openContainerEngineSession(
  input: OpenContainerEngineSessionInput & Readonly<{
    beforeDesktopLaunch?: () => Promise<void> | void;
    observeDesktopLaunchSettlement?: (
      input: DockerDaemonLauncherResult
    ) => Promise<void> | void;
  }>
): Promise<ContainerEngineSession> {
  const cwd = path.resolve(input.cwd);
  if (!path.isAbsolute(input.cwd) || cwd !== input.cwd) fail('cwd must be canonical and absolute');
  const retained = claimDockerCommandProviderCapability(input.provider);
  const providerCleanup = () => ({
    label: 'command-provider-dispose',
    settle: () => disposeClaimedDockerCommandProvider(retained)
  });
  if (retained.linuxCli !== undefined) {
    try {
      assertSemanticOperationProjection(input.operation);
      input = Object.freeze({ ...input, operation: bindSemanticOperation(input.operation.plan, input.operation.bindings) });
    } catch (error) {
      settlePhysicalResources({ primary: { label: 'linux-operation-admission', error }, cleanup: [providerCleanup()] });
      throw error;
    }
  }
  if (retained.linuxCli !== undefined
      && input.operation.plan.attempt.deadlineAtUnixMs > retained.linuxCli.deadlineAtUnixMs) {
    settlePhysicalResources({ primary: { label: 'linux-cli-deadline', error: new QualifiedLinuxDockerScopeUnavailableError('Container Engine session exceeds its original qualified Linux lifetime.') },
      cleanup: [providerCleanup()] });
  }
  if (retained.workingDirectory.path !== cwd || retained.executable !== input.provider.executable) {
    settlePhysicalResources({
      primary: Object.freeze({
        label: 'command-provider-admission',
        error: new Error('Container Engine command provider does not bind this working directory.')
      }),
      cleanup: [
        providerCleanup()
      ]
    });
  }
  const providerAuthorityBinding = input.operation.bindings.find((binding) => (
    input.operation.plan.execution.requirements.some((requirement) => (
      requirement.id === binding.requirementId
      && requirement.effectKinds.includes('provider')
      && requirement.effectKinds.includes('process')
    ))
  ));
  if (providerAuthorityBinding === undefined
      || providerAuthorityBinding.providerIdentityDigest !== retained.providerIdentityDigest) {
    const error = new Error(
      'Container Engine session: bound command provider identity is unavailable'
    );
    settlePhysicalResources({
      primary: Object.freeze({ label: 'provider-authority-admission', error }),
      cleanup: [
        providerCleanup()
      ]
    });
    throw error;
  }
  const providerAuthorityIdentityDigest = providerAuthorityBinding.providerIdentityDigest;
  let processSession: ReturnType<typeof openProcessResourceSession>;
  let processSessionOpened = false;
  let daemonProbeBoundary: ReturnType<typeof issueRetainedCommandBoundary> | undefined;
  try {
    if (retained.daemonProbe !== undefined) {
      daemonProbeBoundary = issueRetainedCommandBoundary({
        executable: retained.daemonProbe,
        workingDirectory: retained.boundary.workingDirectory
      });
    }
    processSession = openProcessResourceSession({
      operation: input.operation,
      requirementBindingContext: issueOperationRequirementBindingContext({
        operation: input.operation,
        requirementId: providerAuthorityBinding.requirementId,
        resourceCeilings: [
          ...input.operation.plan.execution.aggregateBudgets.filter(({ resource }) => (
            resource === 'duration-ms'
            || resource === 'input-bytes'
            || resource === 'output-bytes'
            || resource === 'processes'
          )),
          ...(input.operation.plan.execution.aggregateBudgets.some(
            ({ resource }) => resource === 'input-bytes'
          ) ? [] : [{ resource: 'input-bytes' as const, maximum: 0 }])
        ]
      }),
      ...(input.signal === undefined && retained.linuxCli === undefined ? {} : {
        signal: linkNativeAbortSignals(input.signal, retained.linuxCli?.signal)
      })
    });
    processSessionOpened = true;
    if (retained.linuxCli !== undefined && processSession.deadlineAtUnixMs !== retained.linuxCli.deadlineAtUnixMs) {
      throw new QualifiedLinuxDockerScopeUnavailableError('Qualified Linux CLI, private state and physical process session must retain one original deadline.');
    }
  } catch (error) {
    settlePhysicalResources({
      primary: Object.freeze({ label: 'process-session-admission', error }),
      cleanup: [
        { label: 'process-session-admission-close', settle: () => { if (processSessionOpened) processSession.close(); } },
        providerCleanup()
      ]
    });
    throw error;
  }
  let active = 0;
  let closing = false;
  let closed = false;
  let terminalCloseFailure: unknown;
  let runtimeState: DockerDesktopLifecycleEnvironment | null = null;
  let independentProvider: IndependentProviderProcessCapability | null = null;
  let admissionProviderIdentityDigest: OperationDigest = providerAuthorityIdentityDigest;
  type ScopeCommandSettlement = Readonly<{
    ordinal: number;
    operationKind: ContainerEngineOperation['kind'];
    argumentsDigest: OperationDigest;
    exitCode: number;
    stdoutDigest: OperationDigest;
    stderrDigest: OperationDigest;
  }>;
  type ActiveScope = {
    operation: BoundSemanticOperation;
    requirementId: string;
    processCount: number;
    inputBytes: number;
    outputBytes: number;
    reservedProcesses: number;
    reservedInputBytes: number;
    reservedOutputBytes: number;
    transportUnknown: boolean;
    settlements: ScopeCommandSettlement[];
  };
  let currentScope: ActiveScope | null = null;
  const environment = retained.environment;

  const rawRun = async (
    args: readonly string[],
    options: ContainerEngineOperationOptions = {},
    providerCapability?: IndependentProviderProcessCapability,
    scopedOperation?: ContainerEngineOperation,
    commandOwner: 'docker' | 'daemon-probe' = 'docker'
  ): Promise<ContainerEngineCommandResult> => {
    if (nativeTypes.isProxy(options)) fail('operation options cannot be a Proxy');
    const optionDescriptors = Object.getOwnPropertyDescriptors(options);
    for (const key of Reflect.ownKeys(optionDescriptors)) {
      const descriptor = Object.getOwnPropertyDescriptor(optionDescriptors, key)!.value;
      if (!Object.hasOwn(descriptor, 'value')) fail('operation options require own data');
    }
    options = Object.defineProperties({}, optionDescriptors);
    let ownedInput: Buffer | undefined;
    if (options.input !== undefined) {
      if (nativeTypes.isProxy(options.input) || !nativeTypes.isUint8Array(options.input)) fail('operation input must be native bytes');
      const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
      const inputLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')!.get!.call(options.input);
      const inputBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!.call(options.input);
      if (nativeTypes.isSharedArrayBuffer(inputBuffer)) fail('operation input cannot use shared memory');
      ownedInput = Buffer.alloc(inputLength);
      Uint8Array.prototype.set.call(ownedInput, options.input);
    }
    let acceptedCodes: readonly number[] | undefined;
    if (options.acceptedCodes !== undefined) {
      if (nativeTypes.isProxy(options.acceptedCodes) || !Array.isArray(options.acceptedCodes)) fail('accepted codes must be an ordinary array');
      const descriptors = Object.getOwnPropertyDescriptors(options.acceptedCodes);
      acceptedCodes = Object.freeze(Array.from({ length: Object.getOwnPropertyDescriptor(options.acceptedCodes, 'length')!.value }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'number') fail('accepted codes require own numbers');
        return descriptor.value;
      }));
    }
    options = Object.freeze({ ...options, input: ownedInput, acceptedCodes });
    if (closed || closing) fail(closed ? 'session is closed' : 'session is closing');
    if (retained.platform === 'linux') {
      if (commandOwner === 'docker') {
        // Help/error paths can execute unqualified system plugin metadata.
        assertDockerCommandOperationAvailable(retained.platform, scopedOperation?.kind, retained.linuxCli);
      }
      if (retained.linuxEndpoint === undefined) {
        throw new DockerCommandOperationUnavailableError(
          scopedOperation?.kind ?? 'daemon-info', 'linux-endpoint-identity-unavailable'
        );
      }
    }
    const remaining = processSession.deadlineAtUnixMs - Date.now();
    if (remaining < 1) fail('deadline is exhausted');
    const stdoutBound = assertPositiveBound(
      options.maxStdoutBytes ?? 1024 * 1024,
      'operation stdout bound'
    );
    const stderrBound = assertPositiveBound(
      options.maxStderrBytes ?? 1024 * 1024,
      'operation stderr bound'
    );
    if (stdoutBound < 1 || stderrBound < 1) fail('operation output bound is invalid');
    const stallTimeoutMs = options.stallTimeoutMs;
    if (stallTimeoutMs !== undefined && (!Number.isSafeInteger(stallTimeoutMs)
        || stallTimeoutMs < 1 || stallTimeoutMs >= remaining || options.admitProgress === undefined)) {
      fail('operation stall deadline is invalid');
    }
    const scope = scopedOperation === undefined ? null : currentScope;
    if (scopedOperation !== undefined && scope === null) {
      fail('operation execution requires one open provider settlement scope');
    }
    const commandInputBytes = options.input?.byteLength ?? 0;
    if (scope !== null) {
      if (scope.transportUnknown) fail('provider settlement scope is already physically unknown');
      if (Date.now() >= scope.operation.plan.attempt.deadlineAtUnixMs) {
        fail('provider settlement scope deadline is exhausted');
      }
      if (scope.processCount + scope.reservedProcesses + 1 > semanticOperationBudget(scope.operation, 'processes')) {
        fail('provider settlement scope process budget is exhausted');
      }
      if (scope.inputBytes + scope.reservedInputBytes + commandInputBytes > semanticOperationBudget(scope.operation, 'input-bytes')) {
        fail('provider settlement scope input budget is exhausted');
      }
      if (scope.outputBytes + scope.reservedOutputBytes + stdoutBound + stderrBound
          > semanticOperationBudget(scope.operation, 'output-bytes')) {
        fail('provider settlement scope output budget is exhausted');
      }
    }
    if (scope !== null) {
      scope.reservedProcesses += 1;
      scope.reservedInputBytes += commandInputBytes;
      scope.reservedOutputBytes += stdoutBound + stderrBound;
    }
    active += 1;
    let transportSettled = false;
    let transportAttempted = false;
    try {
      await retained.linuxCli?.assertCurrent();
      runtimeState?.assertCurrent();
      retained.privateState?.assertCurrent();
      retained.linuxEndpoint?.assertCurrent();
      retained.daemonProbe?.assertCurrent();
      for (const owner of retained.retainedOwners) owner.assertCurrent();
      const invocation = { arguments: boundedOwnerArguments(args), environment };
      const boundary = commandOwner === 'daemon-probe'
        ? daemonProbeBoundary ?? fail('retained daemon probe is unavailable')
        : retained.boundary;
      if (scope !== null) {
        if (currentScope !== scope || scope.transportUnknown) fail('provider settlement scope lost its current physical admission');
        if (Date.now() >= scope.operation.plan.attempt.deadlineAtUnixMs) fail('provider settlement scope deadline is exhausted');
      }
      transportAttempted = true;
      const { ordinal, result } = await processSession.run(boundary,
        invocation.arguments, {
        env: invocation.environment,
        envMode: 'replace',
        ...(options.input === undefined ? {} : {
          input: options.input,
          maxStdinBytes: options.maxStdinBytes ?? options.input.byteLength
        }),
        ...(stallTimeoutMs === undefined ? {} : {
          stallTimeoutMs,
          admitProgress: options.admitProgress
        }),
        maxStdoutBytes: stdoutBound,
        maxStderrBytes: stderrBound,
        ...(providerCapability === undefined ? {} : {
          independentProvider: providerCapability
        })
      });
      await retained.linuxCli?.assertCurrent();
      runtimeState?.assertCurrent();
      retained.privateState?.assertCurrent();
      retained.linuxEndpoint?.assertCurrent();
      retained.daemonProbe?.assertCurrent();
      for (const owner of retained.retainedOwners) owner.assertCurrent();
      const commandResult = Object.freeze({
        code: result.code,
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr, 'utf8')
      });
      transportSettled = true;
      if (scope !== null) {
        scope.processCount += 1;
        scope.inputBytes += commandInputBytes;
        scope.outputBytes += commandResult.stdout.byteLength + commandResult.stderr.byteLength;
        scope.settlements.push(Object.freeze({
          ordinal,
          operationKind: scopedOperation!.kind,
          argumentsDigest: sha256({
            arguments: boundedArguments(scopedOperation!.arguments)
          }) as OperationDigest,
          exitCode: commandResult.code,
          stdoutDigest: sha256({
            stdout: commandResult.stdout.toString('base64')
          }) as OperationDigest,
          stderrDigest: sha256({
            stderr: commandResult.stderr.toString('base64')
          }) as OperationDigest
        }));
      }
      if (options.acceptAnyExitCode !== true
          && !(options.acceptedCodes ?? [0]).includes(commandResult.code)) {
        fail(`operation failed with ${commandResult.code}: ${commandResult.stderr
          .toString('utf8').slice(-8_192)}`);
      }
      return commandResult;
    } catch (error) {
      if (scope !== null && !transportSettled && transportAttempted) {
        scope.processCount += 1;
        scope.inputBytes += commandInputBytes;
        scope.outputBytes += stdoutBound + stderrBound;
        scope.transportUnknown = true;
      }
      throw error;
    } finally {
      if (scope !== null) {
        scope.reservedProcesses -= 1;
        scope.reservedInputBytes -= commandInputBytes;
        scope.reservedOutputBytes -= stdoutBound + stderrBound;
      }
      active -= 1;
    }
  };

  const observeInfo = async (host: string, options: ContainerEngineOperationOptions = {}) => {
    if (daemonProbeBoundary === undefined) {
      return await rawRun(['--host', retained.linuxCli === undefined ? host : retained.linuxEndpoint!.transportHost,
        'info', '--format', '{{json .}}'], options);
    }
    if (host !== retained.endpointHost) fail('daemon probe cannot replace the installed endpoint');
    return await rawRun(compileLinuxDockerDaemonProbeArguments(
      retained.linuxEndpoint?.transportHost ?? host, processSession.cooperativeDeadlineAtUnixMs()
    ), options, undefined, undefined, 'daemon-probe');
  };

  const executableDigest = retained.boundary.executable.digest();
  const observedProviderIdentityInput = Object.freeze({
    authorityProviderIdentityDigest: providerAuthorityIdentityDigest,
    projectionProviderIdentityDigest: providerAuthorityIdentityDigest,
    environmentDigest: retained.environmentDigest,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    executable: Object.freeze({
      path: retained.executable,
      size: executableDigest.size,
      byteDigest: executableDigest.byteDigest,
      contentDigest: executableDigest.contentDigest
    }),
    workingDirectory: retained.workingDirectory
  });
  admissionProviderIdentityDigest = compileObservedContainerEngineProviderIdentity(
    observedProviderIdentityInput
  );

  try {
    let endpoint: DockerEndpointIdentity;
    if (retained.endpointHost !== undefined
        && input.expectedEndpoint !== undefined
        && input.expectedEndpoint.endpointHost !== retained.endpointHost) {
      fail('expected endpoint differs from the installed provider endpoint');
    }
    if (retained.platform === 'linux' && retained.endpointHost !== undefined
        && retained.linuxEndpoint === undefined) {
      throw new DockerCommandOperationUnavailableError('daemon-info', 'linux-endpoint-identity-unavailable');
    }
    if (input.expectedEndpoint === undefined && retained.endpointHost !== undefined) {
      const available = await observeDockerDaemonWithCommand({
        endpointHost: retained.endpointHost,
        cwd,
        deadlineAtUnixMs: processSession.deadlineAtUnixMs,
        commandDeadlineAtUnixMs: () => processSession.cooperativeDeadlineAtUnixMs(),
        run: async () => {
          const result = await observeInfo(retained.endpointHost!, { acceptAnyExitCode: true });
          return { code: result.code, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
        }
      });
      endpoint = endpointFromInfo({
        contextName: 'default', endpointHost: retained.endpointHost,
        info: Buffer.from(available.stdout, 'utf8')
      });
    } else if (input.expectedEndpoint === undefined) {
      const contextName = boundedIdentityText(
        (await rawRun(['context', 'show'])).stdout.toString('utf8').trim(),
        'context name',
        200
      );
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(contextName)) fail('context name is invalid');
      const context = parseJsonObject((await rawRun([
        'context', 'inspect', contextName, '--format', '{{json .}}'
      ])).stdout, 'context inspection');
      if (context.Name !== contextName) fail('context identity differs');
      const endpoints = context.Endpoints;
      const docker = endpoints !== null && typeof endpoints === 'object' && !Array.isArray(endpoints)
        ? (endpoints as Record<string, unknown>).docker
        : null;
      if (docker === null || typeof docker !== 'object' || Array.isArray(docker)) {
        fail('context has no Docker endpoint');
      }
      const endpointHost = dockerEndpointHost((docker as Record<string, unknown>).Host);
      const daemonRun = async (command: Readonly<{
        args: readonly string[];
        lifecycle: 'observe' | 'start';
      }>): Promise<DockerDaemonCommandResult> => {
        const result = await rawRun(
          command.args,
          { acceptAnyExitCode: true, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 },
          command.lifecycle === 'start'
            ? independentProvider ?? fail('independent provider admission is unavailable')
            : undefined
        );
        return Object.freeze({
          code: result.code,
          stdout: result.stdout.toString('utf8'),
          stderr: result.stderr.toString('utf8')
        });
      };
      const observationInput = Object.freeze({
        commandDeadlineAtUnixMs: () => processSession.cooperativeDeadlineAtUnixMs(),
        cwd,
        deadlineAtUnixMs: processSession.deadlineAtUnixMs,
        endpointHost,
        run: daemonRun
      });
      let available: DockerDaemonCommandResult;
      if (input.availability !== 'ensure-started') {
        available = await observeDockerDaemonWithCommand(observationInput);
      } else {
        available = await observeBeforeDockerDesktopLifecycleAdmission({
          platform: retained.platform,
          endpointHost,
          observe: async () => await observeDockerDaemonWithCommand(observationInput),
          admitAndEnsureStarted: async () => {
            runtimeState = await dockerDesktopLifecycleEnvironment();
            independentProvider = issueIndependentProviderProcessCapability({
              boundary: retained.boundary,
              operation: input.operation
            });
            const providerPhysicalIdentityDigest = independentProvider.providerPhysicalIdentityDigest;
            const generationCensus = runtimeState.censusRuntimeGenerations(
              providerPhysicalIdentityDigest
            );
            admissionProviderIdentityDigest = compileContainerEngineAdmissionProviderIdentity({
              ...observedProviderIdentityInput,
              authorityProviderIdentityDigest: providerPhysicalIdentityDigest,
              runtimeStateRoots: runtimeState.identityMaterial(),
              generationCensus
            });
            const launchInput = Object.freeze({
              ...observationInput,
              observeRuntimeEndpointResidue: (providerEvidence: string) => (
                runtimeState!.observeRuntimeEndpointResidue(
                  providerEvidence,
                  admissionProviderIdentityDigest
                )
              )
            });
            return await ensureDockerDaemonStartedWithCommand({
              ...launchInput,
              ...(input.beforeDesktopLaunch === undefined ? {} : {
                beforeLaunch: input.beforeDesktopLaunch
              }),
              censusRuntimeGenerations: () => runtimeState!.censusRuntimeGenerations(
                independentProvider!.providerPhysicalIdentityDigest
              ),
              providerAuthorityIdentityDigest: independentProvider!.providerPhysicalIdentityDigest,
              providerIdentityDigest: admissionProviderIdentityDigest,
              launch: async ({ args, deadlineAtUnixMs }) => {
              const timeoutMs = Math.min(
                deadlineAtUnixMs,
                processSession.deadlineAtUnixMs - 1
              ) - Date.now();
              if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
                fail('Docker Desktop launcher deadline is exhausted');
              }
              active += 1;
              try {
                const result = await rawRun(args, {
                  acceptAnyExitCode: true,
                  maxStdoutBytes: 1024 * 1024,
                  maxStderrBytes: 1024 * 1024
                }, independentProvider!);
                return Object.freeze({
                  code: result.code,
                  stdout: Buffer.from(result.stdout).toString('utf8'),
                  stderr: Buffer.from(result.stderr).toString('utf8'),
                  physicalDisposition: 'settled' as const
                });
              } catch (error) {
                if (error instanceof RetainedCommandTransportError) {
                  return projectStartedDockerDaemonLauncherFailure(error);
                }
                throw error;
              } finally {
                active -= 1;
              }
              },
              ...(input.observeDesktopLaunchSettlement === undefined ? {} : {
                observeLaunchSettlement: input.observeDesktopLaunchSettlement
              }),
              withLauncherLock: async (operation) => await withDockerDesktopLauncherLock(
                {
                  endpointHost,
                  operation: input.operation,
                  repositoryRoot: cwd,
                  requirementId: providerAuthorityBinding.requirementId
                },
                operation
              )
            });
          }
        });
      }
      endpoint = endpointFromInfo({
        contextName,
        endpointHost,
        info: Buffer.from(available.stdout, 'utf8')
      });
    } else {
      const expected = parseDockerEndpointIdentity(input.expectedEndpoint);
      const info = await observeInfo(expected.endpointHost, { maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
      endpoint = endpointFromInfo({
        contextName: expected.contextName,
        endpointHost: expected.endpointHost,
        info: info.stdout
      });
      if (JSON.stringify(endpoint) !== JSON.stringify(expected)) {
        fail('expected endpoint identity changed');
      }
    }

    const providerIdentityDigest = compileContainerEngineReadyProviderIdentity({
      admissionProviderIdentityDigest,
      endpoint
    });
    const session: ContainerEngineSession = Object.freeze({
      endpoint,
      cwd,
      executable: retained.executable,
      commandProtocol: retained.commandProtocol,
      supportedOperations: retained.platform === 'linux' && retained.linuxCli === undefined
        ? LINUX_DOCKER_OPERATIONS
        : Object.freeze(Object.keys(OPERATION_PREFIX) as ContainerEngineOperation['kind'][]),
      deadlineAtUnixMs: processSession.deadlineAtUnixMs,
      providerIdentityDigest,
      openOperationScope(
        scopeInput: Parameters<ContainerEngineSession['openOperationScope']>[0]
      ): ContainerEngineOperationScope {
        if (closed || closing) fail(closed ? 'session is closed' : 'session is closing');
        if (active > 0) fail('provider settlement scope cannot open during an active operation');
        if (currentScope !== null) fail('provider settlement scopes cannot nest or overlap');
        if (retained.linuxCli !== undefined) {
          assertQualifiedLinuxDockerCli(retained.linuxCli);
          assertSemanticOperationProjection(scopeInput.operation);
          scopeInput = Object.freeze({ ...scopeInput, operation: bindSemanticOperation(
            scopeInput.operation.plan, scopeInput.operation.bindings
          ) });
          assertQualifiedLinuxDockerScopeBudget({ operation: scopeInput.operation,
            sessionDeadlineAtUnixMs: processSession.deadlineAtUnixMs });
        }
        assertContainerEngineOperationScopeAdmission({
          operation: scopeInput.operation,
          requirementId: scopeInput.requirementId,
          providerIdentityDigest,
          sessionDeadlineAtUnixMs: processSession.deadlineAtUnixMs
        });
        const scope: ActiveScope = {
          operation: scopeInput.operation,
          requirementId: scopeInput.requirementId,
          processCount: 0,
          inputBytes: 0,
          outputBytes: 0,
          reservedProcesses: 0,
          reservedInputBytes: 0,
          reservedOutputBytes: 0,
          transportUnknown: false,
          settlements: []
        };
        currentScope = scope;
        let receipt: ProviderSettlementReceipt | null = null;
        const handle: ContainerEngineOperationScope = Object.freeze({
          operationIdentityDigest: scopeInput.operation.plan.identity.identityDigest,
          boundAttemptDigest: scopeInput.operation.boundAttemptDigest,
          requirementId: scopeInput.requirementId,
          settle(): ProviderSettlementReceipt {
            if (receipt !== null) return receipt;
            if (currentScope !== scope) fail('provider settlement scope is no longer current');
            if (active > 0) fail('provider settlement scope cannot settle during an active operation');
            const physicalDisposition = scope.transportUnknown
              ? 'unknown' as const
              : scope.settlements.length === 0
                ? 'not-started' as const
                : 'settled' as const;
            const providerSettlementReferenceDigest = sha256({
              schema: 'sec-container-engine-operation-scope-settlement-v1',
              providerIdentityDigest,
              endpoint,
              operationIdentityDigest: scope.operation.plan.identity.identityDigest,
              executionPlanDigest: scope.operation.plan.execution.executionPlanDigest,
              boundAttemptDigest: scope.operation.boundAttemptDigest,
              requirementId: scope.requirementId,
              physicalDisposition,
              processCount: scope.processCount,
              inputBytes: scope.inputBytes,
              outputBytes: scope.outputBytes,
              settlements: scope.settlements
            }) as OperationDigest;
            receipt = issueProviderSettlementReceipt(scope.operation, {
              requirementId: scope.requirementId,
              physicalDisposition,
              providerSettlementReferenceDigest
            });
            currentScope = null;
            return receipt;
          }
        });
        return handle;
      },
      async observeEndpoint(): Promise<DockerEndpointIdentity> {
        if (currentScope !== null) {
          fail('independent endpoint readback requires the operation scope to be settled');
        }
        const info = await observeInfo(endpoint.endpointHost, { maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
        const observed = endpointFromInfo({
          contextName: endpoint.contextName,
          endpointHost: endpoint.endpointHost,
          info: info.stdout
        });
        if (JSON.stringify(observed) !== JSON.stringify(endpoint)) {
          fail('independent endpoint readback differs from the retained session endpoint');
        }
        return observed;
      },
      execute: async (
        operation: ContainerEngineOperation,
        options: ContainerEngineOperationOptions = {}
      ): Promise<ContainerEngineCommandResult> => {
        const captured = Object.freeze({ ...operation, arguments: boundedArguments(operation.arguments) });
        return await rawRun(
          retained.linuxCli === undefined ? compileContainerEngineOperationArguments(endpoint, captured)
            : compileQualifiedLinuxDockerOperationArguments({ ...endpoint, endpointHost: retained.linuxEndpoint!.transportHost }, captured),
          options, undefined, captured
        );
      },
      close: () => {
        if (closed) {
          if (terminalCloseFailure !== undefined) throw terminalCloseFailure;
          return;
        }
        if (active > 0) fail('session cannot close with an active operation');
        if (currentScope !== null) fail('session cannot close with an unsettled operation scope');
        closing = true;
        try {
          settlePhysicalResources({
            cleanup: [
              {
                label: 'executable-readback',
                settle: () => retained.boundary.executable.assertCurrent()
              },
              {
                label: 'working-directory-readback',
                settle: () => retained.boundary.workingDirectory.assertCurrent()
              },
              { label: 'linux-endpoint-readback', settle: () => retained.linuxEndpoint?.assertCurrent() },
              { label: 'private-state-readback', settle: () => retained.privateState?.assertCurrent() },
              { label: 'daemon-probe-readback', settle: () => retained.daemonProbe?.assertCurrent() },
              ...retained.retainedOwners.map((owner, index) => ({
                label: `provider-owner-readback-${index}`,
                settle: () => owner.assertCurrent()
              })),
              ...retained.auxiliaryInputs.map((auxiliary, index) => ({
                label: `provider-auxiliary-readback-${index}`,
                settle: () => auxiliary.capability.assertCurrent()
              })),
              { label: 'process-session-close', settle: () => { processSession.close(); } },
              { label: 'runtime-state-close', settle: () => { runtimeState?.close(); } },
              providerCleanup()
            ]
          });
        } catch (error) {
          terminalCloseFailure = error;
          throw error;
        } finally {
          closed = true;
        }
      }
    });
    issuedSessions.set(session, { qualifiedLinux: retained.linuxCli !== undefined,
      signal: processSession.signal,
      observeCloseState: () => !closed ? 'open' : terminalCloseFailure === undefined ? 'settled' : 'unknown',
      originIdentityDigest: retained.linuxCli?.originIdentityDigest ?? null,
      assertIdle: () => {
        if (closed || closing || active !== 0 || currentScope !== null) fail('session is not idle and transferable');
      }, assertCurrent: async () => {
      if (closed || closing) fail('retained session has closed');
      if (Date.now() >= processSession.deadlineAtUnixMs) fail('retained session original deadline expired');
      await retained.linuxCli?.assertCurrent();
      retained.linuxEndpoint?.assertCurrent();
      retained.privateState?.assertCurrent();
      retained.boundary.executable.assertCurrent();
      retained.boundary.workingDirectory.assertCurrent();
    } });
    return session;
  } catch (error) {
    settlePhysicalResources({
      primary: Object.freeze({ label: 'provider-admission', error }),
      cleanup: [
        { label: 'process-session-close', settle: () => { processSession.close(); } },
        { label: 'runtime-state-close', settle: () => { runtimeState?.close(); } },
        providerCleanup()
      ]
    });
    throw error;
  }
}
