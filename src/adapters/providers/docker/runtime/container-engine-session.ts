import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  assertSemanticOperationProjection,
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
import { RetainedCommandTransportError } from '../../../runtime-state/physical/runtime/process.ts';
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
  claimDockerCommandProviderCapability
} from './command-provider.ts';
import {
  ensureDockerDaemonStartedWithCommand,
  observeDockerDaemonWithCommand,
  projectStartedDockerDaemonLauncherFailure,
  type DockerDaemonCommandResult,
  type DockerDaemonLauncherResult
} from './daemon-algorithm.ts';
import { withDockerDesktopLauncherLock } from './daemon.ts';

const OPERATION_PREFIX = Object.freeze({
  'buildx-bake': ['buildx', 'bake'],
  'buildx-build': ['buildx', 'build'],
  'container-copy': ['container', 'cp'],
  'container-create': ['container', 'create'],
  'container-exec': ['container', 'exec'],
  'container-inspect': ['container', 'inspect'],
  'container-list': ['container', 'ls'],
  'container-remove': ['container', 'rm'],
  'container-run': ['container', 'run'],
  'container-start': ['container', 'start'],
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
  const auxiliaryCleanup = () => [...retained.auxiliaryInputs].reverse().map(
    (auxiliary, index) => ({
      label: `provider-auxiliary-dispose-${index}`,
      settle: () => auxiliary.capability.dispose()
    })
  );
  if (retained.workingDirectory.path !== cwd || retained.executable !== input.provider.executable) {
    settlePhysicalResources({
      primary: Object.freeze({
        label: 'command-provider-admission',
        error: new Error('Container Engine command provider does not bind this working directory.')
      }),
      cleanup: [
        ...auxiliaryCleanup(),
        ...[...retained.retainedOwners].reverse().map((owner, index) => ({
          label: `provider-owner-close-${index}`,
          settle: () => { owner.close(); }
        })),
        {
          label: 'working-directory-dispose',
          settle: () => retained.boundary.workingDirectory.dispose()
        },
        {
          label: 'executable-dispose',
          settle: () => retained.boundary.executable.dispose()
        },
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
        ...auxiliaryCleanup(),
        ...[...retained.retainedOwners].reverse().map((owner, index) => ({
          label: `provider-owner-close-${index}`,
          settle: () => { owner.close(); }
        })),
        {
          label: 'working-directory-dispose',
          settle: () => retained.boundary.workingDirectory.dispose()
        },
        {
          label: 'executable-dispose',
          settle: () => retained.boundary.executable.dispose()
        }
      ]
    });
    throw error;
  }
  const providerAuthorityIdentityDigest = providerAuthorityBinding.providerIdentityDigest;
  let processSession: ReturnType<typeof openProcessResourceSession>;
  try {
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
      ...(input.signal === undefined ? {} : { signal: input.signal })
    });
  } catch (error) {
    settlePhysicalResources({
      primary: Object.freeze({ label: 'process-session-admission', error }),
      cleanup: [
        ...auxiliaryCleanup(),
        ...[...retained.retainedOwners].reverse().map((owner, index) => ({
          label: `provider-owner-close-${index}`,
          settle: () => { owner.close(); }
        })),
        {
          label: 'working-directory-dispose',
          settle: () => retained.boundary.workingDirectory.dispose()
        },
        {
          label: 'executable-dispose',
          settle: () => retained.boundary.executable.dispose()
        }
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
    transportUnknown: boolean;
    settlements: ScopeCommandSettlement[];
  };
  let currentScope: ActiveScope | null = null;
  const environment = retained.environment;

  const rawRun = async (
    args: readonly string[],
    options: ContainerEngineOperationOptions = {},
    providerCapability?: IndependentProviderProcessCapability,
    scopedOperation?: ContainerEngineOperation
  ): Promise<ContainerEngineCommandResult> => {
    if (closed || closing) fail(closed ? 'session is closed' : 'session is closing');
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
      if (scope.processCount + 1 > semanticOperationBudget(scope.operation, 'processes')) {
        fail('provider settlement scope process budget is exhausted');
      }
      if (scope.inputBytes + commandInputBytes > semanticOperationBudget(scope.operation, 'input-bytes')) {
        fail('provider settlement scope input budget is exhausted');
      }
      if (scope.outputBytes + stdoutBound + stderrBound
          > semanticOperationBudget(scope.operation, 'output-bytes')) {
        fail('provider settlement scope output budget is exhausted');
      }
    }
    active += 1;
    let transportSettled = false;
    try {
      runtimeState?.assertCurrent();
      for (const owner of retained.retainedOwners) owner.assertCurrent();
      const { ordinal, result } = await processSession.run(retained.boundary, [
        ...boundedOwnerArguments(args)
      ], {
        env: environment,
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
      runtimeState?.assertCurrent();
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
      if (scope !== null && !transportSettled) {
        scope.processCount += 1;
        scope.inputBytes += commandInputBytes;
        scope.outputBytes += stdoutBound + stderrBound;
        scope.transportUnknown = true;
      }
      throw error;
    } finally {
      active -= 1;
    }
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
    if (input.expectedEndpoint === undefined) {
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
      const info = await rawRun([
        '--host', expected.endpointHost, 'info', '--format', '{{json .}}'
      ], { maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
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
      deadlineAtUnixMs: processSession.deadlineAtUnixMs,
      providerIdentityDigest,
      openOperationScope(
        scopeInput: Parameters<ContainerEngineSession['openOperationScope']>[0]
      ): ContainerEngineOperationScope {
        if (closed || closing) fail(closed ? 'session is closed' : 'session is closing');
        if (active > 0) fail('provider settlement scope cannot open during an active operation');
        if (currentScope !== null) fail('provider settlement scopes cannot nest or overlap');
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
        const info = await rawRun([
          '--host', endpoint.endpointHost, 'info', '--format', '{{json .}}'
        ], { maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
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
      ): Promise<ContainerEngineCommandResult> => await rawRun(
        compileContainerEngineOperationArguments(endpoint, operation),
        options,
        undefined,
        operation
      ),
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
              ...auxiliaryCleanup(),
              ...[...retained.retainedOwners].reverse().map((owner, index) => ({
                label: `provider-owner-close-${index}`,
                settle: () => { owner.close(); }
              })),
              {
                label: 'working-directory-dispose',
                settle: () => retained.boundary.workingDirectory.dispose()
              },
              {
                label: 'executable-dispose',
                settle: () => retained.boundary.executable.dispose()
              },
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
    return session;
  } catch (error) {
    settlePhysicalResources({
      primary: Object.freeze({ label: 'provider-admission', error }),
      cleanup: [
        { label: 'process-session-close', settle: () => { processSession.close(); } },
        { label: 'runtime-state-close', settle: () => { runtimeState?.close(); } },
        ...auxiliaryCleanup(),
        ...[...retained.retainedOwners].reverse().map((owner, index) => ({
          label: `provider-owner-close-${index}`,
          settle: () => { owner.close(); }
        })),
        {
          label: 'working-directory-dispose',
          settle: () => retained.boundary.workingDirectory.dispose()
        },
        {
          label: 'executable-dispose',
          settle: () => retained.boundary.executable.dispose()
        }
      ]
    });
    throw error;
  }
}
