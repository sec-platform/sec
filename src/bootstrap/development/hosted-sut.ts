import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain, type PhysicalDirectoryIdentity } from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { encodeVerificationActionData } from '../../adapters/verification/platform/action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget, type CiVerificationExecutionEnvironment } from '../../adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../adapters/verification/platform/action/contract/environment.ts';
import type { VerificationActionProviderOrigin } from '../../adapters/verification/platform/action/contract/provider.ts';
import { buildHostedSutSandboxCommandPlan, buildTrustedBootstrapSutSandboxCommandPlan, hostedCandidateProcessEnvironment, hostedSutCapabilityCommandPlan, hostedSutTeardownCommandPlan } from '../../adapters/verification/platform/ci/contract/hosted-sut-command-plan.ts';
import { CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentHostedSutCandidateEnvironment, hostedSutCleanupComplete, hostedSutLifecycleComplete } from '../../adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../adapters/verification/platform/ci/contract/revision.ts';
import { CodexDevelopmentFailureTail, type CodexDevelopmentGateProcessResult } from '../../adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { assertHostedSutSupervisorLive, createHostedSutSupervisor, type HostedSutSupervisor } from '../../adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';
import { CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, ciActionDigest } from '../../adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { CodexDevelopmentPrepareTrustedBootstrapSutInputs, assertRetainedHostedSutArchive, hostedActionFileDigest, retainHostedSutArchive, type CodexDevelopmentRetainedHostedSutArchive } from '../../adapters/verification/platform/ci/verification-materialization.ts';
import { finalizeHostedSutSandboxReceipt, hostedSutRootIsolationReceipt, syntheticHostedSutSandboxProcessObservation } from '../../adapters/verification/platform/ci/verification-sut.ts';
import { executeHostedActionSut, executeTrustedBootstrapSut as executeTrustedBootstrapApplicationSut, prepareHostedActionSut, probeHostedSutCapability, type HostedSutPorts, type TrustedBootstrapSutInput } from '../../application/hosted-sut.ts';
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

export interface HostedSutInvocation {
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

/** The caller binds the original authenticated job to the same native process
 * requirement used by the other SUT flows. Paths and digest fields never open
 * a supervisor session by themselves. */
export async function executeTrustedBootstrapSut(input: TrustedBootstrapSutInput,
  invocation: HostedSutInvocation) {
  input = JSON.parse(encodeVerificationActionData(input)) as TrustedBootstrapSutInput;
  const supervisor = createHostedSutSupervisor(invocation);
  const outputDirectory = path.resolve(input.outputDirectory);
  const transportDirectory = path.resolve(outputDirectory, '.transport');
  let transportOwned = false;
  let evidenceIdentity: PhysicalDirectoryIdentity | undefined;
  let transportIdentity: PhysicalDirectoryIdentity | undefined;
  let primary: ResourceSettlementFailure | undefined;
  const evidencePath = (name: string): string => {
    if (!/^[A-Za-z0-9.-]+$/u.test(name)) throw new Error('Trusted bootstrap evidence member is invalid.');
    if (evidenceIdentity === undefined) throw new Error('Trusted bootstrap evidence root was not prepared.');
    assertSameNoFollowDirectoryIdentity(evidenceIdentity, 'Trusted bootstrap evidence root');
    return path.join(outputDirectory, name);
  };
  try {
    return await executeTrustedBootstrapApplicationSut(input, {
      ...bindHostedSutPorts(supervisor),
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
      prepareEvidenceRoot: () => {
        if (existsSync(outputDirectory) && readdirSync(outputDirectory).length !== 0) {
          throw new Error('Trusted bootstrap SUT evidence root must begin empty.');
        }
        mkdirSync(outputDirectory, { recursive: true });
        if (!lstatSync(outputDirectory).isDirectory() || realpathSync.native(outputDirectory) !== outputDirectory) {
          throw new Error('Trusted bootstrap evidence root is not one ordinary directory.');
        }
        evidenceIdentity = inspectNoFollowDirectoryChain(outputDirectory, 'Trusted bootstrap evidence root').target;
        mkdirSync(transportDirectory, { recursive: false });
        transportOwned = true;
        transportIdentity = inspectNoFollowDirectoryChain(transportDirectory, 'Trusted bootstrap transport root').target;
      },
      prepareBootstrap: source => CodexDevelopmentPrepareTrustedBootstrapSutInputs({
        ...source, outputDirectory: transportDirectory
      }),
      bootstrapEnvironment: source => Object.freeze(Object.fromEntries(Object.entries(hostedCandidateProcessEnvironment({}, {
        SEC_BOOTSTRAP_BASE: source.baseSha, SEC_BOOTSTRAP_HEAD: source.headSha,
        SEC_BOOTSTRAP_TREE: source.treeSha, SEC_CHANGED_BASE: source.baseSha,
        SEC_AFFECTED_TESTS_BASE: source.baseSha, SEC_REPOSITORY_AUDIT_DEFAULT_REF: source.baseSha,
        SEC_WORK_PACKAGE_MANIFEST_PATH: source.manifestPath
      })).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
      createBootstrapPlan: buildTrustedBootstrapSutSandboxCommandPlan,
      writeEvidenceMember: (name, value) => writeFileSync(evidencePath(name),
        `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }),
      evidenceMemberByteDigest: name => createHash('sha256').update(readFileSync(evidencePath(name))).digest('hex'),
      writeEvidenceText: (name, source) => writeFileSync(evidencePath(name), source,
        { encoding: 'utf8', flag: 'wx' }),
      byteDigest: source => `sha256:${createHash('sha256').update(source).digest('hex')}`,
      retireBootstrapInputs: () => {
        if (!transportOwned) return;
        if (transportIdentity === undefined || evidenceIdentity === undefined) {
          throw new Error('Trusted bootstrap transport ownership observation is missing.');
        }
        assertSameNoFollowDirectoryIdentity(evidenceIdentity, 'Trusted bootstrap evidence root');
        assertSameNoFollowDirectoryIdentity(transportIdentity, 'Trusted bootstrap transport root');
        const observed = lstatSync(transportDirectory);
        if (!observed.isDirectory() || observed.isSymbolicLink()
            || realpathSync.native(transportDirectory) !== transportDirectory
            || realpathSync.native(outputDirectory) !== outputDirectory) {
          throw new Error('Trusted bootstrap owned transport identity changed before retirement.');
        }
        rmSync(transportDirectory, { recursive: true, force: false });
        if (existsSync(transportDirectory)) throw new Error('Trusted bootstrap transport retirement was not observed.');
        transportOwned = false;
      }
    });
  } catch (error) {
    primary = { label: 'Trusted bootstrap SUT execution', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'Trusted bootstrap SUT supervisor settlement',
      settle: () => { supervisor.close(); } }] });
  }
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

