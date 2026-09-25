import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueRecoveredDomainReadbackReceipt,
  issueRecoveredOwnerTerminalJoinReceipt,
  issueRecoveredRetryAdmission,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import type {
  DurableExecutionDigest
} from '../../../runtime-state/workspace-state/durable-execution/contract.ts';
import {
  createDurableExecutionWriter,
  durableExecutionJournalIdentity,
  durableExecutionPredecessorAttemptReference,
  type DurableExecutionWriter
} from '../../../runtime-state/workspace-state/durable-execution/store.ts';
import { createRuntimeStateJournalFileSystem } from '../../../runtime-state/workspace-state/journal-filesystem.ts';
import { resolveWorkspaceRuntimeRoots } from '../../../runtime-state/workspace-state/paths.ts';
import { acquireRuntimeJournalAuthority } from '../../../runtime-state/workspace-state/physical-authority.ts';
import { DockerCommandProviderUnavailableError } from '../contract/command-provider.ts';
import {
  DockerDaemonAvailabilityFailure,
  type DockerDaemonAvailabilityFailurePhase,
  type DockerDaemonAvailabilityFailureReason,
  type DockerEndpointIdentity
} from '../contract/daemon.ts';
import type { DockerDesktopLoginStart } from '../contract/login-start.ts';
import { disposeUnclaimedDockerCommandProviderCapability } from './command-provider.ts';
import { openContainerEngineSession } from './container-engine-session.ts';
import type { DockerDaemonLauncherResult } from './daemon-algorithm.ts';
import { openWindowsDockerCommandProvider } from './windows-command-provider.ts';
import {
  observeWindowsDockerDesktopLoginStart,
  unavailableDockerDesktopLoginStart
} from './windows-login-start.ts';

export const LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA =
  'sec-local-container-engine-readiness-v2' as const;

export type LocalContainerEngineReadinessMode = 'observe' | 'ensure-started';

export type LocalContainerEngineReadiness =
  | Readonly<{
    schema: typeof LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA;
    status: 'ready';
    mode: LocalContainerEngineReadinessMode;
    endpoint: DockerEndpointIdentity;
    loginStart: DockerDesktopLoginStart;
    providerIdentityDigest: OperationDigest;
  }>
  | Readonly<{
    schema: typeof LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA;
    status: 'unavailable';
    mode: LocalContainerEngineReadinessMode;
    loginStart: DockerDesktopLoginStart;
    reason: DockerDaemonAvailabilityFailureReason | 'command-provider-unavailable' | 'invalid-input';
    phase: DockerDaemonAvailabilityFailurePhase | 'provider-admission';
    detailDigest: OperationDigest;
  }>;

const REQUIREMENT_ID = 'external.container-engine-readiness';
const DURATION_BUDGET_MS = 120_000;

function bindReadinessOperation(input: Readonly<{
  mode: LocalContainerEngineReadinessMode;
  providerIdentityDigest: OperationDigest;
  authorityGrantDigest?: OperationDigest;
  operationEpochDigest?: OperationDigest;
  resumeEpochDigest?: OperationDigest | null;
  runIdDigest?: OperationDigest | null;
}>) {
  const contractDigest = sha256({
    domain: 'sec.local-container-engine-readiness',
    requirementId: REQUIREMENT_ID,
    effectKinds: ['filesystem', 'process', 'provider'],
    durationBudgetMs: DURATION_BUDGET_MS
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: DURATION_BUDGET_MS },
      { resource: 'input-bytes', maximum: 1 },
      { resource: 'output-bytes', maximum: 8 * 1024 * 1024 },
      { resource: 'processes', maximum: 8 }
    ],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: input.authorityGrantDigest ?? contractDigest,
      ...(input.runIdDigest === undefined ? {} : { runIdDigest: input.runIdDigest }),
      ...(input.resumeEpochDigest === undefined
        ? {}
        : { resumeEpochDigest: input.resumeEpochDigest })
    }),
    deadlineAtUnixMs: Date.now() + DURATION_BUDGET_MS,
    decisionDigest: sha256({
      domain: 'sec.local-container-engine-readiness.decision',
      mode: input.mode,
      operationEpochDigest: input.operationEpochDigest ?? null
    }) as OperationDigest,
    intentDigest: sha256({
      domain: 'sec.local-container-engine-readiness.intent',
      mode: input.mode,
      operationEpochDigest: input.operationEpochDigest ?? null
    }) as OperationDigest,
    operation: 'external.container-engine-readiness',
    requirements: [{
      contractDigest,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'container-engine.command-provider-unavailable',
        'container-engine.desktop-launcher-path-unavailable',
        'container-engine.endpoint-unavailable',
        'container-engine.process-settlement-failed',
        'container-engine.runtime-endpoint-residue'
      ],
      id: REQUIREMENT_ID
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: REQUIREMENT_ID,
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function unavailable(input: Readonly<{
  mode: LocalContainerEngineReadinessMode;
  reason: Extract<LocalContainerEngineReadiness, { status: 'unavailable' }>['reason'];
  phase: Extract<LocalContainerEngineReadiness, { status: 'unavailable' }>['phase'];
  detail: unknown;
  loginStart: DockerDesktopLoginStart;
}>): LocalContainerEngineReadiness {
  return Object.freeze({
    schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
    status: 'unavailable',
    mode: input.mode,
    loginStart: input.loginStart,
    reason: input.reason,
    phase: input.phase,
    detailDigest: sha256({
      domain: 'sec.local-container-engine-readiness.failure',
      reason: input.reason,
      phase: input.phase,
      detail: input.detail instanceof Error
        ? { name: input.detail.name, message: input.detail.message }
        : String(input.detail)
    }) as OperationDigest
  });
}

type WindowsDockerProvider = Awaited<ReturnType<typeof openWindowsDockerCommandProvider>>;
type ReadySessionObservation = Readonly<{
  endpoint: DockerEndpointIdentity;
  providerIdentityDigest: OperationDigest;
}>;

async function observeWithOwnedProvider(input: Readonly<{
  provider: WindowsDockerProvider;
  operation: BoundSemanticOperation;
  cwd: string;
  availability: LocalContainerEngineReadinessMode;
  beforeDesktopLaunch?: () => Promise<void> | void;
  observeDesktopLaunchSettlement?: (
    input: DockerDaemonLauncherResult
  ) => Promise<void> | void;
}>): Promise<ReadySessionObservation> {
  let session: Awaited<ReturnType<typeof openContainerEngineSession>> | null = null;
  try {
    session = await openContainerEngineSession({
      operation: input.operation,
      provider: input.provider,
      cwd: input.cwd,
      availability: input.availability,
      ...(input.beforeDesktopLaunch === undefined ? {} : {
        beforeDesktopLaunch: input.beforeDesktopLaunch
      }),
      ...(input.observeDesktopLaunchSettlement === undefined ? {} : {
        observeDesktopLaunchSettlement: input.observeDesktopLaunchSettlement
      })
    });
    const endpoint = await session.observeEndpoint();
    const providerIdentityDigest = session.providerIdentityDigest;
    session.close();
    session = null;
    return Object.freeze({ endpoint, providerIdentityDigest });
  } catch (error) {
    if (session !== null) {
      try {
        session.close();
      } catch (settlementError) {
        throw new AggregateError([error, settlementError], 'Container Engine session settlement failed.');
      }
    } else if (error instanceof DockerCommandProviderUnavailableError) {
      try {
        disposeUnclaimedDockerCommandProviderCapability(input.provider);
      } catch {
        // The session owns settlement after a successful capability claim.
      }
    }
    throw error;
  }
}

function durableWriter(input: Readonly<{
  authority: Awaited<ReturnType<typeof acquireRuntimeJournalAuthority>>;
  repositoryRoot: string;
}>): DurableExecutionWriter {
  const roots = resolveWorkspaceRuntimeRoots({ repositoryRoot: input.repositoryRoot });
  return createDurableExecutionWriter({
    fileSystem: createRuntimeStateJournalFileSystem(
      input.authority.directory(roots.workspaceStateRoot)
    ),
    journalRoot: path.join(roots.workspaceStateRoot, 'durable-local-executions'),
    limits: {
      deadlineAtMonotonicMs: performance.now() + DURATION_BUDGET_MS,
      maximumRecords: 16,
      maximumStateBytes: 256 * 1024,
      maximumAttempts: 2,
      maximumProviderSettlementsPerAttempt: 1
    }
  });
}

/** @internal Shared by the readiness owner and its settlement counterexamples. */
export async function settleLocalContainerEngineReadinessCompletion<T>(input: Readonly<{
  completion: Promise<T>;
  release: () => Promise<void>;
}>): Promise<T> {
  let completionPresent = false;
  let completionValue: T | undefined;
  let primaryPresent = false;
  let primary: unknown;
  try {
    completionValue = await input.completion;
    completionPresent = true;
  } catch (error) {
    primaryPresent = true;
    primary = error;
  }
  let releasePresent = false;
  let releaseFailure: unknown;
  try {
    await input.release();
  } catch (error) {
    releasePresent = true;
    releaseFailure = error;
  }
  if (primaryPresent && releasePresent) {
    throw new AggregateError(
      [primary, releaseFailure],
      'Local Container Engine readiness and journal authority settlement failed.'
    );
  }
  if (primaryPresent) throw primary;
  if (releasePresent) throw releaseFailure;
  if (!completionPresent) throw new Error('Local Container Engine readiness did not complete.');
  return completionValue as T;
}

/**
 * Observes or starts only the local Container Engine. It deliberately has no
 * Git, candidate, MainHealth, Verification, registry-login, or network scope.
 */
export async function observeLocalContainerEngineReadiness(input: Readonly<{
  cwd: string;
  mode?: LocalContainerEngineReadinessMode;
}>): Promise<LocalContainerEngineReadiness> {
  const mode = input.mode ?? 'observe';
  const cwd = path.resolve(input.cwd);
  if ((mode !== 'observe' && mode !== 'ensure-started')
      || !path.isAbsolute(input.cwd) || cwd !== input.cwd) {
    return unavailable({
      mode,
      reason: 'invalid-input',
      phase: 'provider-admission',
      detail: 'Local Container Engine readiness requires a canonical cwd and mode.',
      loginStart: unavailableDockerDesktopLoginStart(
        'operation-input-invalid',
        'Login-start observation was not attempted for invalid operation input.'
      )
    });
  }
  const loginStart = await observeWindowsDockerDesktopLoginStart();
  let provider: Awaited<ReturnType<typeof openWindowsDockerCommandProvider>>;
  try {
    provider = await openWindowsDockerCommandProvider({ workingDirectory: cwd });
  } catch (error) {
    return unavailable({
      mode,
      reason: 'command-provider-unavailable',
      phase: 'provider-admission',
      detail: error,
      loginStart
    });
  }

  let operation = bindReadinessOperation({
    mode,
    providerIdentityDigest: provider.providerIdentityDigest
  });
  let journalAuthority: Awaited<ReturnType<typeof acquireRuntimeJournalAuthority>> | null = null;
  const completion = (async (): Promise<LocalContainerEngineReadiness> => {
    try {
    let writer: DurableExecutionWriter | null = null;
    let retryAlreadyClaimed = false;
    if (mode === 'ensure-started') {
      journalAuthority = await acquireRuntimeJournalAuthority({ repositoryRoot: cwd });
      writer = durableWriter({ authority: journalAuthority, repositoryRoot: cwd });
      const prior = writer.read(durableExecutionJournalIdentity(operation));
      if (prior?.activeAttempt !== null && prior?.activeAttempt !== undefined) {
        const predecessor = durableExecutionPredecessorAttemptReference(prior);
        const recoveryEpoch = sha256({
          domain: 'sec.docker.readiness.recovery-epoch',
          durableObservationDigest: prior.journalDigest,
          providerIdentityDigest: provider.providerIdentityDigest
        }) as OperationDigest;
        const recovery = bindReadinessOperation({
          mode,
          providerIdentityDigest: provider.providerIdentityDigest,
          authorityGrantDigest: operation.plan.attempt.authorityGrantDigest,
          resumeEpochDigest: recoveryEpoch,
          runIdDigest: sha256({
            domain: 'sec.docker.readiness.recovery-run',
            durableObservationDigest: prior.journalDigest
          }) as OperationDigest
        });
        try {
          const recoveredReady = await observeWithOwnedProvider({
            provider,
            operation: recovery,
            cwd,
            availability: 'observe'
          });
          const currentPhysicalEpochDigest = sha256({
            domain: 'sec.docker.daemon.physical-epoch',
            endpoint: recoveredReady.endpoint
          }) as OperationDigest;
          const recoveredReadback = issueRecoveredDomainReadbackReceipt(recovery, {
            predecessor,
            durableObservationDigest: prior.journalDigest,
            readbackContractDigest: sha256('sec.docker.daemon.handle-independent-readback') as OperationDigest,
            readbackReferenceDigest: currentPhysicalEpochDigest,
            currentPhysicalEpochDigest,
            disposition: 'applied'
          });
          writer.appendDomainReadback(recovery, recoveredReadback);
          const terminal = issueRecoveredOwnerTerminalJoinReceipt(recovery, recoveredReadback, {
            ownerTerminalContractDigest: sha256('sec.docker.daemon.ready-terminal') as OperationDigest,
            ownerTerminalReferenceDigest: recoveredReady.providerIdentityDigest
          });
          writer.appendOwnerTerminalResolution(recovery, terminal);
          return Object.freeze({
            schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
            status: 'ready',
            mode,
            endpoint: recoveredReady.endpoint,
            loginStart,
            providerIdentityDigest: recoveredReady.providerIdentityDigest
          });
        } catch (error) {
          if (!(error instanceof DockerDaemonAvailabilityFailure)
              || error.reason !== 'endpoint-unavailable') {
            throw error;
          }
          const currentPhysicalEpochDigest = sha256({
            domain: 'sec.docker.daemon.physical-epoch',
            unavailableReadbackDigest: error.detailDigest
          }) as OperationDigest;
          const recoveredReadback = issueRecoveredDomainReadbackReceipt(recovery, {
            predecessor,
            durableObservationDigest: prior.journalDigest,
            readbackContractDigest: sha256('sec.docker.daemon.handle-independent-readback') as OperationDigest,
            readbackReferenceDigest: error.detailDigest,
            currentPhysicalEpochDigest,
            disposition: 'not-applied'
          });
          writer.appendDomainReadback(recovery, recoveredReadback);
          if (predecessor.deadlineAtUnixMs <= Date.now()) {
            const terminal = issueRecoveredOwnerTerminalJoinReceipt(recovery, recoveredReadback, {
              ownerTerminalContractDigest: sha256('sec.docker.daemon.unavailable-terminal') as OperationDigest,
              ownerTerminalReferenceDigest: error.detailDigest
            });
            writer.appendOwnerTerminalResolution(recovery, terminal);
            const successorProvider = await openWindowsDockerCommandProvider({ workingDirectory: cwd });
            if (successorProvider.providerIdentityDigest !== provider.providerIdentityDigest) {
              disposeUnclaimedDockerCommandProviderCapability(successorProvider);
              throw new DockerCommandProviderUnavailableError(
                'Docker command provider identity changed after predecessor terminal recovery.'
              );
            }
            provider = successorProvider;
            operation = bindReadinessOperation({
              mode,
              providerIdentityDigest: provider.providerIdentityDigest,
              operationEpochDigest: terminal.joinReceiptDigest,
              runIdDigest: sha256({
                domain: 'sec.docker.readiness.post-terminal-run',
                terminalJoinReceiptDigest: terminal.joinReceiptDigest
              }) as OperationDigest
            });
            // The expired predecessor is terminal and never retried. The
            // explicit ensure-started invocation continues once as a new
            // normal operation whose identity is derived from that terminal
            // receipt and whose attempt receives the current canonical budget.
            retryAlreadyClaimed = false;
          } else {
            const retryAdmission = issueRecoveredRetryAdmission(recovery, recoveredReadback);
            const successorProvider = await openWindowsDockerCommandProvider({ workingDirectory: cwd });
            if (successorProvider.providerIdentityDigest !== provider.providerIdentityDigest) {
              disposeUnclaimedDockerCommandProviderCapability(successorProvider);
              throw new DockerCommandProviderUnavailableError(
                'Docker command provider identity changed during durable recovery.'
              );
            }
            provider = successorProvider;
            operation = bindReadinessOperation({
              mode,
              providerIdentityDigest: provider.providerIdentityDigest,
              authorityGrantDigest: recovery.plan.attempt.authorityGrantDigest,
              resumeEpochDigest: recovery.plan.attempt.resumeEpochDigest,
              runIdDigest: sha256({
                domain: 'sec.docker.readiness.successor-run',
                retryAdmissionDigest: retryAdmission.retryAdmissionDigest
              }) as OperationDigest
            });
            writer.appendRecoveredRetryAttemptStart(
              recovery,
              operation,
              sha256('sec.docker.desktop-launcher-worker') as DurableExecutionDigest,
              retryAdmission,
              currentPhysicalEpochDigest
            );
            retryAlreadyClaimed = true;
          }
        }
      } else if (prior !== null) {
        const currentReady = await observeWithOwnedProvider({
          provider,
          operation,
          cwd,
          availability: 'observe'
        });
        return Object.freeze({
          schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
          status: 'ready',
          mode,
          endpoint: currentReady.endpoint,
          loginStart,
          providerIdentityDigest: currentReady.providerIdentityDigest
        });
      }
    }

    let launcherSettlement: ReturnType<typeof issueProviderSettlementReceipt> | null = null;
    const ready = await observeWithOwnedProvider({
      provider,
      operation,
      cwd,
      availability: mode,
      ...(writer === null ? {} : {
        beforeDesktopLaunch: () => {
          if (retryAlreadyClaimed) return;
          writer!.createIntent(operation);
          writer!.appendInitialAttemptStart(
            operation,
            sha256('sec.docker.desktop-launcher-worker') as DurableExecutionDigest
          );
        },
        observeDesktopLaunchSettlement: (settlement) => {
          launcherSettlement = issueProviderSettlementReceipt(operation, {
            requirementId: REQUIREMENT_ID,
            physicalDisposition: settlement.physicalDisposition === 'unknown'
              ? 'unknown'
              : 'settled',
            providerSettlementReferenceDigest: sha256({
              domain: 'sec.docker.desktop-launcher-settlement',
              code: settlement.code,
              stdout: settlement.stdout,
              stderr: settlement.stderr,
              physicalDisposition: settlement.physicalDisposition,
              transportFailureStatus: settlement.transportFailureStatus ?? null
            }) as OperationDigest
          });
          writer!.appendProviderSettlement(operation, launcherSettlement);
          if (settlement.physicalDisposition === 'unknown') {
            writer!.appendLostHandle(operation, launcherSettlement);
          }
        }
      })
    });
    if (writer !== null) {
      const observation = writer.read(durableExecutionJournalIdentity(operation));
      if (observation?.activeAttempt !== null && observation?.activeAttempt !== undefined) {
        if (launcherSettlement === null) {
          launcherSettlement = issueProviderSettlementReceipt(operation, {
            requirementId: REQUIREMENT_ID,
            physicalDisposition: 'not-started',
            providerSettlementReferenceDigest: sha256({
              domain: 'sec.docker.desktop-launcher-not-required',
              endpoint: ready.endpoint
            }) as OperationDigest
          });
          writer.appendProviderSettlement(operation, launcherSettlement);
        }
        const providerSettlements = compileProviderSettlementSet(
          operation,
          [launcherSettlement]
        );
        const currentPhysicalEpochDigest = sha256({
          domain: 'sec.docker.daemon.physical-epoch',
          endpoint: ready.endpoint
        }) as OperationDigest;
        const readback = issueNormalDomainReadbackReceipt(operation, providerSettlements, {
          readbackContractDigest: sha256('sec.docker.daemon.handle-independent-readback') as OperationDigest,
          readbackReferenceDigest: currentPhysicalEpochDigest,
          currentPhysicalEpochDigest,
          disposition: 'applied'
        });
        writer.appendDomainReadback(operation, readback);
        const terminal = issueNormalOwnerTerminalJoinReceipt(
          operation,
          providerSettlements,
          readback,
          {
            ownerTerminalContractDigest: sha256('sec.docker.daemon.ready-terminal') as OperationDigest,
            ownerTerminalReferenceDigest: ready.providerIdentityDigest
          }
        );
        writer.appendOwnerTerminalResolution(operation, terminal);
      }
    }
    return Object.freeze({
      schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
      status: 'ready',
      mode,
      endpoint: ready.endpoint,
      loginStart,
      providerIdentityDigest: ready.providerIdentityDigest
    });
    } catch (error) {
      if (error instanceof DockerDaemonAvailabilityFailure) {
        return Object.freeze({
          schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
          status: 'unavailable',
          mode,
          loginStart,
          reason: error.reason,
          phase: error.phase,
          detailDigest: error.detailDigest
        });
      }
      // Only domain-classified availability failures can be projected as a
      // stable readiness result. An unknown journal/session failure retains its
      // original typed error and cause graph instead of being mislabeled as a
      // provider-admission blocker whose digest cannot be diagnosed.
      throw error;
    }
  })();
  return settleLocalContainerEngineReadinessCompletion({
    completion,
    release: async () => { await journalAuthority?.release(); }
  });
}
