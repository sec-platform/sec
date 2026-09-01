import path from 'node:path';

import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../../system-architecture/operation/semantic.ts';
import { DockerCommandProviderUnavailableError } from '../contract/command-provider.ts';
import {
  DockerDaemonAvailabilityFailure,
  type DockerDaemonAvailabilityFailurePhase,
  type DockerDaemonAvailabilityFailureReason,
  type DockerEndpointIdentity
} from '../contract/daemon.ts';
import { disposeUnclaimedDockerCommandProviderCapability } from './command-provider.ts';
import { openContainerEngineSession } from './container-engine-session.ts';
import { openWindowsDockerCommandProvider } from './windows-command-provider.ts';

export const LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA =
  'sec-local-container-engine-readiness-v1' as const;

export type LocalContainerEngineReadinessMode = 'observe' | 'ensure-started';

export type LocalContainerEngineReadiness =
  | Readonly<{
    schema: typeof LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA;
    status: 'ready';
    mode: LocalContainerEngineReadinessMode;
    endpoint: DockerEndpointIdentity;
    providerIdentityDigest: SecOperationDigest;
  }>
  | Readonly<{
    schema: typeof LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA;
    status: 'unavailable';
    mode: LocalContainerEngineReadinessMode;
    reason: DockerDaemonAvailabilityFailureReason | 'command-provider-unavailable' | 'invalid-input' | 'session-unavailable';
    phase: DockerDaemonAvailabilityFailurePhase | 'provider-admission' | 'session-settlement';
    detailDigest: SecOperationDigest;
  }>;

const REQUIREMENT_ID = 'external.container-engine-readiness';
const DURATION_BUDGET_MS = 120_000;

function bindReadinessOperation(input: Readonly<{
  mode: LocalContainerEngineReadinessMode;
  providerIdentityDigest: SecOperationDigest;
}>) {
  const contractDigest = sha256({
    domain: 'sec.local-container-engine-readiness',
    requirementId: REQUIREMENT_ID,
    effectKinds: ['filesystem', 'process', 'provider'],
    durationBudgetMs: DURATION_BUDGET_MS
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: DURATION_BUDGET_MS },
      { resource: 'input-bytes', maximum: 1 },
      { resource: 'output-bytes', maximum: 8 * 1024 * 1024 },
      { resource: 'processes', maximum: 8 }
    ],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    deadlineAtUnixMs: Date.now() + DURATION_BUDGET_MS,
    decisionDigest: sha256({
      domain: 'sec.local-container-engine-readiness.decision',
      mode: input.mode
    }) as SecOperationDigest,
    intentDigest: sha256({
      domain: 'sec.local-container-engine-readiness.intent',
      mode: input.mode
    }) as SecOperationDigest,
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
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
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
}>): LocalContainerEngineReadiness {
  return Object.freeze({
    schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
    status: 'unavailable',
    mode: input.mode,
    reason: input.reason,
    phase: input.phase,
    detailDigest: sha256({
      domain: 'sec.local-container-engine-readiness.failure',
      reason: input.reason,
      phase: input.phase,
      detail: input.detail instanceof Error
        ? { name: input.detail.name, message: input.detail.message }
        : String(input.detail)
    }) as SecOperationDigest
  });
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
      detail: 'Local Container Engine readiness requires a canonical cwd and mode.'
    });
  }
  let provider: Awaited<ReturnType<typeof openWindowsDockerCommandProvider>>;
  try {
    provider = await openWindowsDockerCommandProvider({ workingDirectory: cwd });
  } catch (error) {
    return unavailable({
      mode,
      reason: 'command-provider-unavailable',
      phase: 'provider-admission',
      detail: error
    });
  }

  const operation = bindReadinessOperation({
    mode,
    providerIdentityDigest: provider.providerIdentityDigest
  });
  let session: Awaited<ReturnType<typeof openContainerEngineSession>> | null = null;
  try {
    session = await openContainerEngineSession({
      operation,
      provider,
      cwd,
      availability: mode
    });
    const endpoint = await session.observeEndpoint();
    const providerIdentityDigest = session.providerIdentityDigest;
    session.close();
    session = null;
    return Object.freeze({
      schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
      status: 'ready',
      mode,
      endpoint,
      providerIdentityDigest
    });
  } catch (error) {
    if (session !== null) {
      try {
        session.close();
      } catch (settlementError) {
        return unavailable({
          mode,
          reason: 'process-settlement-failed',
          phase: 'session-settlement',
          detail: new AggregateError([error, settlementError])
        });
      }
    } else if (error instanceof DockerCommandProviderUnavailableError) {
      try {
        disposeUnclaimedDockerCommandProviderCapability(provider);
      } catch {
        // openContainerEngineSession owns settlement after claiming the provider.
      }
    }
    if (error instanceof DockerDaemonAvailabilityFailure) {
      return Object.freeze({
        schema: LOCAL_CONTAINER_ENGINE_READINESS_SCHEMA,
        status: 'unavailable',
        mode,
        reason: error.reason,
        phase: error.phase,
        detailDigest: error.detailDigest
      });
    }
    return unavailable({
      mode,
      reason: 'session-unavailable',
      phase: 'provider-admission',
      detail: error
    });
  }
}
