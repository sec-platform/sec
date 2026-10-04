import { randomBytes } from 'node:crypto';
import { closeSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { encodeVerificationActionData } from '../../adapters/verification/platform/action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget, type CiVerificationExecutionEnvironment } from '../../adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../adapters/verification/platform/action/contract/environment.ts';
import type { VerificationActionProviderOrigin } from '../../adapters/verification/platform/action/contract/provider.ts';
import { buildHostedSutSandboxCommandPlan, hostedSutCapabilityCommandPlan, hostedSutTeardownCommandPlan } from '../../adapters/verification/platform/ci/contract/hosted-sut-command-plan.ts';
import { CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentHostedSutCandidateEnvironment, hostedSutCleanupComplete, hostedSutLifecycleComplete } from '../../adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../adapters/verification/platform/ci/contract/revision.ts';
import { CodexDevelopmentFailureTail, type CodexDevelopmentGateProcessResult } from '../../adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { assertHostedSutSupervisorLive, createHostedSutSupervisor, type HostedSutSupervisor } from '../../adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';
import { CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, ciActionDigest } from '../../adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { assertRetainedHostedSutArchive, hostedActionFileDigest, retainHostedSutArchive, type CodexDevelopmentRetainedHostedSutArchive } from '../../adapters/verification/platform/ci/verification-materialization.ts';
import { finalizeHostedSutSandboxReceipt, hostedSutRootIsolationReceipt, syntheticHostedSutSandboxProcessObservation } from '../../adapters/verification/platform/ci/verification-sut.ts';
import { executeHostedActionSut, prepareHostedActionSut, probeHostedSutCapability, type HostedSutPorts } from '../../application/hosted-sut.ts';
import type { OperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import type { BoundSemanticOperation } from '../../execution/operation/semantic.ts';
import { settleResources, type ResourceSettlementFailure } from '../../execution/resource-settlement.ts';

type NativeSutPorts = HostedSutPorts<
  typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CiVerificationExecutionEnvironment,
  VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
  typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentGateProcessResult,
  CodexDevelopmentRetainedHostedSutArchive
>;

interface HostedSutInvocation {
  readonly operation: BoundSemanticOperation;
  readonly requirementBindingContext: OperationRequirementBindingContext;
  readonly trustedSourceRoot: string;
  readonly signal?: AbortSignal;
}

/** Derive the exact sandbox subject before any Linux environment or process
 * session is opened. The application remains the sole owner of these joins. */
export function prepareHostedActionSutInputs(input: Parameters<typeof prepareHostedActionSut<
  typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CiVerificationExecutionEnvironment,
  VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
  typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentGateProcessResult,
  CodexDevelopmentRetainedHostedSutArchive
>>[0]) {
  return prepareHostedActionSut<
    typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CiVerificationExecutionEnvironment,
    VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
    typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
    typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
    typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentGateProcessResult,
    CodexDevelopmentRetainedHostedSutArchive
  >(input, {
    encodeData: encodeVerificationActionData,
    parseResolution: CodexDevelopmentParseHostedActionResolution,
    parseTicket: CodexDevelopmentParseHostedActionExecutionTicket,
    createAuthorization: CodexDevelopmentCreateHostedSutExecutionAuthorization,
    candidateEnvironment: CodexDevelopmentHostedSutCandidateEnvironment
  });
}

function bindHostedSutPorts(supervisor: HostedSutSupervisor): NativeSutPorts {
  return {
    platform: process.platform, bunExecutable: realpathSync.native(process.execPath),
    unitNonce: randomBytes(16).toString('hex'),
    outputByteLimit: CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT,
    capabilityMarker: CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER,
    unsupportedDiagnostic: 'Hosted SUT observation source cannot attest namespace establishment, candidate start, or candidate-unit settlement.',
    now: () => new Date(), digest: ciActionDigest, encodeData: encodeVerificationActionData,
    parseResolution: CodexDevelopmentParseHostedActionResolution,
    parseTicket: CodexDevelopmentParseHostedActionExecutionTicket,
    createAuthorization: CodexDevelopmentCreateHostedSutExecutionAuthorization,
    candidateEnvironment: CodexDevelopmentHostedSutCandidateEnvironment,
    createCapabilityPlan: hostedSutCapabilityCommandPlan,
    createTeardownPlan: hostedSutTeardownCommandPlan,
    createExecutionPlan: buildHostedSutSandboxCommandPlan,
    normalizedArgv: ciVerificationNormalizedOperationArgv,
    resolveAuthorizedOperation: resolveCiVerificationDevRunnerTarget,
    run: (plan, archive) => {
      assertHostedSutSupervisorLive(supervisor);
      return supervisor.run(plan, archive);
    },
    unobservedProcess: syntheticHostedSutSandboxProcessObservation,
    lifecycleComplete: hostedSutLifecycleComplete,
    cleanupComplete: hostedSutCleanupComplete,
    failureTail: CodexDevelopmentFailureTail,
    resolveArchive: source => realpathSync.native(path.resolve(source)),
    retainArchive: retainHostedSutArchive, assertArchive: assertRetainedHostedSutArchive,
    pathDigest: hostedActionFileDigest,
    closeArchive: archive => { closeSync(archive.fileDescriptor); },
    rootIsolation: hostedSutRootIsolationReceipt,
    finalizeReceipt: finalizeHostedSutSandboxReceipt,
    finalizeRawResult: CodexDevelopmentFinalizeHostedActionRawResult
  };
}

/** Opens the genuine supervisor only after original requirement preparation.
 * Its close validates every original retained run and physical settlement
 * before a historical result can leave this invocation. */
export async function runHostedActionSut(
  input: Parameters<typeof executeHostedActionSut<
    typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CiVerificationExecutionEnvironment,
    VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
    typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
    typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
    typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentGateProcessResult,
    CodexDevelopmentRetainedHostedSutArchive
  >>[0],
  invocation: HostedSutInvocation
) {
  const supervisor = createHostedSutSupervisor(invocation);
  let primary: ResourceSettlementFailure | undefined;
  try {
    return await executeHostedActionSut(input, bindHostedSutPorts(supervisor));
  } catch (error) {
    primary = { label: 'Hosted Action SUT execution', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'Hosted SUT supervisor settlement',
      settle: () => { supervisor.close(); } }] });
  }
}

export async function runHostedSutCapabilityProbe(
  input: Parameters<typeof probeHostedSutCapability<
    typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CiVerificationExecutionEnvironment,
    VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
    typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
    typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
    typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentGateProcessResult,
    CodexDevelopmentRetainedHostedSutArchive
  >>[0],
  invocation: HostedSutInvocation
) {
  const supervisor = createHostedSutSupervisor(invocation);
  let primary: ResourceSettlementFailure | undefined;
  try {
    return await probeHostedSutCapability(input, bindHostedSutPorts(supervisor));
  } catch (error) {
    primary = { label: 'Hosted SUT capability probe', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'Hosted SUT supervisor settlement',
      settle: () => { supervisor.close(); } }] });
  }
}

