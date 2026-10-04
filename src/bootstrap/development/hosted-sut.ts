import { randomBytes } from 'node:crypto';
import { closeSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProcessResourceSessionReceipt } from '../../adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { encodeVerificationActionData } from '../../adapters/verification/platform/action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget, type CiVerificationExecutionEnvironment } from '../../adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../adapters/verification/platform/action/contract/environment.ts';
import type { VerificationActionProviderOrigin } from '../../adapters/verification/platform/action/contract/provider.ts';
import { encodeHostedSutNativeControl, parseHostedSutNativeOuterCorrelation, type HostedSutNativeOuterCorrelation } from '../../adapters/verification/platform/ci/contract/hosted-job-runtime.ts';
import { buildHostedSutSandboxCommandPlan, hostedSutCapabilityCommandPlan, hostedSutTeardownCommandPlan } from '../../adapters/verification/platform/ci/contract/hosted-sut-command-plan.ts';
import { CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentHostedSutCandidateEnvironment, hostedSutCleanupComplete, hostedSutLifecycleComplete } from '../../adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../adapters/verification/platform/ci/contract/revision.ts';
import { CodexDevelopmentFailureTail, type CodexDevelopmentGateProcessResult } from '../../adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { assertHostedSutSupervisorLive, createHostedSutSupervisor, HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST, HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID, HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS, type HostedSutSupervisor } from '../../adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';
import { CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, ciActionDigest, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution } from '../../adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { assertRetainedHostedSutArchive, hostedActionFileDigest, retainHostedSutArchive, type CodexDevelopmentRetainedHostedSutArchive } from '../../adapters/verification/platform/ci/verification-materialization.ts';
import { finalizeHostedSutSandboxReceipt, hostedSutRootIsolationReceipt, syntheticHostedSutSandboxProcessObservation } from '../../adapters/verification/platform/ci/verification-sut.ts';
import { runHostedSutPreflight } from '../../application/hosted-job-runtime.ts';
import { executeHostedActionSut, prepareHostedActionSut, probeHostedSutCapability, type HostedSutPorts } from '../../application/hosted-sut.ts';
import { sha256 } from '../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../contracts/exact-json.ts';
import { issueOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type BoundSemanticOperation, type OperationDigest } from '../../execution/operation/semantic.ts';
import { settleResources, type ResourceSettlementFailure } from '../../execution/resource-settlement.ts';

export const HOSTED_SUT_NATIVE_REQUEST_SCHEMA = 'sec-hosted-sut-native-unit-request-v1';
export const HOSTED_SUT_NATIVE_ARCHIVE_PATH = '/authenticated-input/prepared-candidate.tar';
const NATIVE_INPUT_MAX_BYTES = 2 * 1024 * 1024;

type NativeSutPorts = HostedSutPorts<
  typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CiVerificationExecutionEnvironment,
  VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, typeof CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
  typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, typeof CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  typeof CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentGateProcessResult,
  CodexDevelopmentRetainedHostedSutArchive
>;

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

/** Compiles only correlation and bounded process requirements in this process.
 * The native fixed-program launch owns effects; JSON data cannot restore a
 * parent operation, a root capability or an authenticated provider origin. */
export function compileHostedSutNativeInnerOperation(input: Readonly<{
  outer: HostedSutNativeOuterCorrelation;
  phase: 'self-test-hosted-action-sandbox' | 'execute-hosted-action-sut';
  actionKey: string;
  resolutionDigest: string;
}>): BoundSemanticOperation {
  const outer = parseHostedSutNativeOuterCorrelation(input.outer);
  if (outer.deadlineAtUnixMs <= Date.now()
      || !['self-test-hosted-action-sandbox', 'execute-hosted-action-sut'].includes(input.phase)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.actionKey) || !/^sha256:[0-9a-f]{64}$/u.test(input.resolutionDigest)) {
    throw new Error('Hosted SUT inner operation has no bounded original correlation.');
  }
  const requirement = Object.freeze({ id: HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID,
    contractDigest: HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST, effectKinds: ['process'] as const,
    failureKinds: ['hosted-sut.process-admission', 'hosted-sut.process-settlement'] });
  // A new process-local operation is compiled by the original foundation.
  // Parent digests are correlation under the actually launched fixed native
  // program; they neither restore a parent capability nor mint a job origin.
  return bindSemanticOperation(compileSemanticOperationPlan({
    operation: 'verification.hosted-sut.inner',
    intentDigest: sha256({ outer, phase: input.phase, actionKey: input.actionKey,
      resolutionDigest: input.resolutionDigest }) as OperationDigest,
    decisionDigest: requirement.contractDigest,
    deadlineAtUnixMs: Math.min(outer.deadlineAtUnixMs, Date.now() + HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS[0]!.maximum),
    aggregateBudgets: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS,
    requirements: [requirement],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: outer.operationIdentityDigest as OperationDigest, runIdDigest: outer.boundAttemptDigest as OperationDigest })
  }), [compileCapabilityBinding({ requirementId: requirement.id, contractDigest: requirement.contractDigest,
    providerIdentityDigest: sha256({ substrate: 'original-supervisor-in-fixed-native-unit',
      outerProvider: outer.providerIdentityDigest, contract: requirement.contractDigest }) as OperationDigest })]);
}

/** The fixed physical native-unit program is the only caller of this entry.
 * Stdin contains correlation/subject data, never the host's opaque GitHub
 * origin, API credentials or a reconstructed live physical capability. */
async function runNativeUnitEntry(): Promise<void> {
  if (process.argv.length !== 3 || process.argv[2] !== '--native-unit'
      || process.platform !== 'linux' || process.getuid?.() !== 0) {
    throw new Error('Hosted SUT inner entry requires the fixed privileged native unit.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, NATIVE_INPUT_MAX_BYTES + 1 - size));
    const length = readSync(0, chunk, 0, chunk.byteLength, null);
    if (length === 0) break;
    chunks.push(chunk.subarray(0, length));
    size += length;
    if (size > NATIVE_INPUT_MAX_BYTES) throw new Error('Hosted SUT native input exceeds its bound.');
  }
  const value = parseExactJsonBytes(Buffer.concat(chunks, size), 'Hosted SUT native input',
    { maximumInputBytes: NATIVE_INPUT_MAX_BYTES, maximumDepth: 64 });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hosted SUT native input must be one request.');
  }
  const request = value as Record<string, unknown>;
  const probe = request.phase === 'self-test-hosted-action-sandbox';
  const execute = request.phase === 'execute-hosted-action-sut';
  const expectedKeys = probe ? ['schema', 'phase', 'outer', 'resolution']
    : ['schema', 'phase', 'outer', 'resolution', 'ticket', 'archiveInventory'];
  if (request.schema !== HOSTED_SUT_NATIVE_REQUEST_SCHEMA || (!probe && !execute)
      || Object.keys(request).sort().join(',') !== expectedKeys.sort().join(',')) {
    throw new Error('Hosted SUT native input has no fixed phase or exact protocol.');
  }
  const outer = parseHostedSutNativeOuterCorrelation(request.outer);
  const resolution = CodexDevelopmentParseHostedActionResolution(encodeVerificationActionData(request.resolution));
  const operation = compileHostedSutNativeInnerOperation({ outer,
    phase: probe ? 'self-test-hosted-action-sandbox' : 'execute-hosted-action-sut',
    actionKey: resolution.actionPlan.action.actionKey, resolutionDigest: resolution.resolutionDigest });
  const supervisor = createHostedSutSupervisor({ operation,
    requirementBindingContext: issueOperationRequirementBindingContext({ operation,
      requirementId: HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID, resourceCeilings: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS,
      absoluteDeadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs }),
    trustedSourceRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..') });
  let output: unknown;
  const settlements: ProcessResourceSessionReceipt[] = [];
  let primary: ResourceSettlementFailure | undefined;
  try {
    output = probe ? await runHostedSutPreflight({
      readResolution: () => resolution, issueInvocation: () => supervisor,
      probe: (input, observed) => probeHostedSutCapability(input, bindHostedSutPorts(observed)),
      policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
    }) : await executeHostedActionSut(prepareHostedActionSutInputs({ resolution,
      ticket: CodexDevelopmentParseHostedActionExecutionTicket(encodeVerificationActionData(request.ticket)),
      candidateArchive: HOSTED_SUT_NATIVE_ARCHIVE_PATH,
      archiveInventory: request.archiveInventory as Parameters<typeof prepareHostedActionSutInputs>[0]['archiveInventory']
    }), bindHostedSutPorts(supervisor));
  } catch (error) {
    primary = { label: 'Hosted native inner SUT', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'Hosted SUT original supervisor settlement',
      settle: () => { settlements.push(supervisor.close()); } }] });
  }
  const settlement = settlements[0];
  if (settlement === undefined) throw new Error('Hosted SUT lost its original supervisor settlement.');
  const source = encodeHostedSutNativeControl({ outer,
    phase: probe ? 'self-test-hosted-action-sandbox' : 'execute-hosted-action-sut',
    actionKey: resolution.actionPlan.action.actionKey, resolutionDigest: resolution.resolutionDigest,
    innerSupervisor: { operationIdentityDigest: settlement.operationIdentityDigest,
      boundAttemptDigest: settlement.boundAttemptDigest, deadlineAtUnixMs: settlement.deadlineAtUnixMs,
      requirementId: HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID, requirementContractDigest: HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST,
      resourceCeilingIdentityDigest: settlement.resourceCeilingIdentityDigest,
      settlementReceiptDigest: settlement.receiptDigest }, output });
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(source, error => error ? reject(error) : resolve());
  });
}

if (import.meta.main) {
  await runNativeUnitEntry();
}
