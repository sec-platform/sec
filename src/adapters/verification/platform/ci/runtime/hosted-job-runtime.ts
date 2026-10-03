import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readdirSync, writeSync } from 'node:fs';
import path from 'node:path';
import { rawSha256, sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import {
  bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext, type SecBoundSemanticOperation,
  type SecProviderSettlementReceipt
} from '../../../../../execution/operation/semantic.ts';
import { settleResources, settleResourcesAsync } from '../../../../../execution/resource-settlement.ts';
import type { DockerCommandProviderCapability } from '../../../../providers/docker/contract/command-provider.ts';
import type { ContainerEngineSession } from '../../../../providers/docker/contract/container-engine-session.ts';
import { LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST } from '../../../../providers/docker/contract/linux-hosted-bootstrap-profile.ts';
import { disposeUnclaimedDockerCommandProviderCapability } from '../../../../providers/docker/runtime/command-provider.ts';
import { observeRetainedContainerEngineSessionClose, openContainerEngineSession } from '../../../../providers/docker/runtime/container-engine-session.ts';
import { openAuthenticatedLinuxDockerCommandProvider } from '../../../../providers/docker/runtime/linux-command-provider.ts';
import {
  applyAuthenticatedLinuxHostedBootstrap, assertAuthenticatedLinuxHostedBootstrapCurrent,
  observeAuthenticatedLinuxHostedBootstrap, prepareAuthenticatedLinuxHostedBootstrap,
  retireAuthenticatedLinuxHostedBootstrap, type AuthenticatedLinuxHostedBootstrap
} from '../../../../providers/docker/runtime/linux-hosted-bootstrap.ts';
import {
  closeUnclaimedQualifiedContainerEngineOciExporter, consumeQualifiedContainerEngineOciExporter,
  observeQualifiedContainerEngineOciExporterOwnership, qualifyLinuxDockerOciExporter,
  type QualifiedContainerEngineOciExporter
} from '../../../../providers/docker/runtime/linux-oci-exporter.ts';
import { publishLinuxDockerStaticToolchain } from '../../../../providers/docker/runtime/linux-static-toolchain-publisher.ts';
import { getCiVerificationPerJobHostedJobPolicy } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, closeAuthenticatedGitHubJobOrigin,
  getAuthenticatedGitHubJobOriginSignal, openAuthenticatedGitHubJobOrigin,
  type AuthenticatedGitHubJobOrigin
} from '../../../../providers/github-api/hosted-job-origin.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../../providers/linux-verification/contract.ts';
import {
  assertRetainedNoFollowCapability, createNoFollowDirectoryChain, inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile, retainNoFollowOrdinaryFile,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { ensureTrustedRuntimeContainerImageMaterialization, executeTrustedRuntimeMainHealthCheck } from '../../trusted-runtime/trusted-runtime-container.ts';
import { CI_HOSTED_JOB_RUNTIME_POLICY, CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST } from '../contract/hosted-job-runtime-policy.ts';
import { createHostedJobRuntimeReceipt, type HostedJobRuntimeReceipt } from '../contract/hosted-job-runtime.ts';
import {
  CodexDevelopmentParseHostedActionRawResult, hostedSutCleanupComplete,
  parseHostedSutCapabilityObservation
} from '../contract/hosted-sut-observation.ts';
import { CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution } from '../verification-hosted-action-contract.ts';
import { executeHostedBootstrapPhase } from './hosted-job-bootstrap-phases.ts';
import {
  assertHostedJobContainerReadback, createHostedJobContainerSpec,
  type HostedJobContainerReadback, type HostedJobContainerSpec
} from './hosted-job-container.ts';
import { ensureLocalGitHubActionsRunnerToolchainMaterialization } from './local-github-actions-runner.ts';

const ENVIRONMENT = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
const REQUIREMENT = 'hosted-job.container-engine';
const OUTPUT_LIMIT = CI_HOSTED_JOB_RUNTIME_POLICY.outputBytesPerStream;
const SOURCE = '/workspace/src/adapters/verification/platform/ci/verification.ts';
const INNER_INPUT = '/workspace/.tmp/codex/hosted-input';
const RAW_OUTPUT = '/workspace/.tmp/codex/raw/verification-action-raw-observation.json';
const MAIN_HEALTH_COMMANDS = Object.freeze({
  'imports:check': 'bun run imports:check --all', 'typecheck:verified': 'bun run typecheck:verified',
  audit: 'bun run audit -- --worktree-source-program --enforce', 'docs:doctor': 'bun run docs:doctor',
  test: 'bun run test -- --scope fast'
} as const);

export class HostedJobRuntimeEffectError extends Error {
  readonly code = 'hosted-job-runtime-effect-unsettled' as const;
  constructor(readonly retained: Readonly<{ originIdentityDigest: string; operationIdentityDigest: string;
    containerName: string; containerId: string | null; removalConfirmed: boolean }>, cause: unknown) {
    super('Hosted job execution or cleanup is not fully settled; preserve its exact owned resources.', { cause });
  }
}

function operation(engine: Pick<ContainerEngineSession, 'providerIdentityDigest' | 'deadlineAtUnixMs'>, origin: AuthenticatedGitHubJobOrigin, phase: string,
  lifecycle: 'setup' | 'execute' | 'cleanup', providerKind: 'engine' | 'bootstrap' = 'engine'): SecBoundSemanticOperation {
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const deadline = Math.min(engine.deadlineAtUnixMs, observed.originalDeadlineAtUnixMs);
  const duration = deadline - Date.now();
  if (duration <= 0) throw new Error('Hosted job original operation budget is exhausted.');
  const contractDigest = providerKind === 'engine' ? CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST : LINUX_HOSTED_BOOTSTRAP_PROFILE_DIGEST;
  const requirementId = providerKind === 'engine' ? REQUIREMENT : 'hosted-job.linux-bootstrap';
  const plan = compileSecSemanticOperationPlan({ operation: providerKind === 'engine'
      ? 'verification.hosted-job.runtime' : 'hosted-job-linux-bootstrap',
    intentDigest: sha256({ origin: observed.identityDigest, phase, lifecycle }),
    decisionDigest: contractDigest, deadlineAtUnixMs: deadline,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: observed.identityDigest,
      runIdDigest: sha256({ run: observed.runId, attempt: observed.runAttempt, job: observed.jobId }) }),
    aggregateBudgets: [{ resource: 'duration-ms', maximum: duration }, { resource: 'processes', maximum: 256 },
      { resource: 'input-bytes', maximum: 32 * 1024 * 1024 }, { resource: 'output-bytes', maximum: 256 * 1024 * 1024 }],
    requirements: [{ id: requirementId, contractDigest,
      effectKinds: providerKind === 'engine' ? ['filesystem', 'process', 'provider']
        : ['filesystem', 'process', 'provider', 'persistent-state'], failureKinds: ['provider.cancelled',
        'provider.deadline-exhausted', 'provider.drift', 'provider.execution-failed', 'provider.unavailable', 'provider.unverified'] }] });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({ requirementId,
    contractDigest, providerIdentityDigest: engine.providerIdentityDigest })]);
}

function retainedInput(file: RetainedNoFollowOrdinaryFile, maximum: number): void {
  assertRetainedNoFollowCapability(file, 'ordinary-file', 'Hosted phase input');
  file.assertCurrent();
  if (file.size < 1 || file.size > maximum || file.linkCount !== 1) throw new Error('Hosted input is not one bounded retained ordinary file.');
}
function exactJson(bytes: Uint8Array, maximum: number): Record<string, unknown> {
  const value = parseExactJsonBytes(bytes, 'Hosted phase output', { maximumInputBytes: maximum, maximumDepth: 32 });
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hosted phase output is not an object.');
  return value as Record<string, unknown>;
}
function text(bytes: Uint8Array): string { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }

async function inspect(engine: ContainerEngineSession, spec: HostedJobContainerSpec,
  containerId: string): Promise<HostedJobContainerReadback> {
  const readback = await engine.execute({ kind: 'container-inspect', arguments: [containerId] },
    { maxStdoutBytes: 512 * 1024, maxStderrBytes: 64 * 1024 });
  return assertHostedJobContainerReadback({ source: readback.stdout, spec, containerId });
}

export type HostedJobSutPhase =
  | Readonly<{ phase: 'self-test-hosted-action-sandbox'; resolution: RetainedNoFollowOrdinaryFile }>
  | Readonly<{ phase: 'execute-hosted-action-sut'; resolution: RetainedNoFollowOrdinaryFile;
      ticket: RetainedNoFollowOrdinaryFile; candidateArchive: RetainedNoFollowOrdinaryFile }>;

/**
 * The two SUT routes use their existing facade and inner sandbox unchanged.
 * Inputs are retained ordinary files; no callback, shell or executable selector
 * is accepted. The genuine exporter lends its original Engine, whose opener
 * retains responsibility for final session/publisher/origin close, in that order.
 */
export async function executeHostedJobSutPhase(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  exporter: QualifiedContainerEngineOciExporter;
  bootstrap: AuthenticatedLinuxHostedBootstrap;
  command: HostedJobSutPhase;
}>): Promise<Readonly<{ receipt: HostedJobRuntimeReceipt; output: Uint8Array }>> {
  const origin = input.origin;
  const exporter = input.exporter;
  const bootstrap = input.bootstrap;
  const command = Object.freeze({ ...input.command });
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  const requiredJob = command.phase === 'self-test-hosted-action-sandbox'
    ? 'preflight-verification-action-sut' : 'execute-verification-action-sut';
  const policy = getCiVerificationPerJobHostedJobPolicy(observed.workflowPath, observed.policyJobId);
  if (observed.role !== 'sut' || observed.policyJobId !== requiredJob || observed.phase !== command.phase || policy === null
      || !policy.stages.some(stage => stage.kind === 'phase' && stage.phase === command.phase)) {
    throw new Error('Hosted SUT phase requires its own authenticated executing job.');
  }
  retainedInput(command.resolution, 16 * 1024 * 1024);
  const resolution = CodexDevelopmentParseHostedActionResolution(text(command.resolution.readBytes()));
  if (resolution.executionEnvironment.executionEnvironmentRevision !== CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION
      || resolution.artifactInput.baseSha !== observed.trustedSourceSha) {
    throw new Error('Hosted Action is not bound to this new runtime and exact trusted source.');
  }
  const files = [{ file: command.resolution, target: '/sec-input/resolution.json' }];
  // A path selector, not authority: the original inner command-plan owner still
  // constructs and validates its namespace program. It is fixed before the
  // per-job AppArmor owner is allowed to select any exact sandbox mount root.
  const sandboxNonce = sha256({ schema: 'sec-hosted-sandbox-unit-v1',
    jobId: observed.jobId, checkRunId: observed.checkRunId, phase: observed.phase,
    actionKey: resolution.actionPlan.action.actionKey }).slice(7, 39);
  let sandboxUnitName = `sec-sut-${resolution.actionPlan.action.actionKey.slice(7, 23)}-${sandboxNonce}`;
  if (command.phase === 'execute-hosted-action-sut') {
    retainedInput(command.ticket, 16 * 1024 * 1024);
    retainedInput(command.candidateArchive, 1024 * 1024 * 1024);
    const ticket = CodexDevelopmentParseHostedActionExecutionTicket(text(command.ticket.readBytes()));
    if (ticket.actionKey !== resolution.actionPlan.action.actionKey || ticket.resolutionDigest !== resolution.resolutionDigest
        || ticket.preparedCandidateArchiveDigest !== command.candidateArchive.digest().byteDigest) {
      throw new Error('Hosted SUT retained ticket/archive differs from the trusted Action resolution.');
    }
    files.push({ file: command.ticket, target: '/sec-input/ticket.json' },
      { file: command.candidateArchive, target: '/sec-input/candidate.tar' });
    sandboxUnitName = `sec-sut-${resolution.actionPlan.action.actionKey.slice(7, 23)}-${ticket.ticketDigest.slice(7, 23)}`;
  }
  // The reviewed native workflow installs frozen trusted dependencies before
  // entering this owner. Reject an ambient/symlinked dependency root here.
  inspectNoFollowDirectoryChain(path.join(observed.trustedDriverRoot, 'node_modules'));
  await assertAuthenticatedLinuxHostedBootstrapCurrent(bootstrap);
  const substrate = observeAuthenticatedLinuxHostedBootstrap(bootstrap);
  if (substrate.state !== 'active' || substrate.originIdentityDigest !== observed.identityDigest
      || substrate.profileName === null || substrate.inputProfileDigest === null
      || substrate.profileObservation?.kernelEnforcement !== 'enforce'
      || substrate.roots.length !== 1 || substrate.roots[0] !== `/tmp/${sandboxUnitName}`) {
    throw new Error('SUT outer runtime has no live same-job profile for its exact inner namespace root.');
  }
  const engine = await consumeQualifiedContainerEngineOciExporter(exporter);
  if (exporter.originIdentityDigest !== observed.identityDigest || engine.cwd !== observed.trustedDriverRoot) {
    throw new Error('OCI exporter belongs to another job, source root or retained Engine.');
  }
  const setup = operation(engine, origin, command.phase, 'setup');
  const setupScope = engine.openOperationScope({ operation: setup, requirementId: REQUIREMENT });
  const settlements: SecProviderSettlementReceipt[] = [];
  const name = `sec-hosted-${observed.checkRunId}-${randomUUID()}`;
  const labels = Object.freeze({ 'sec.hosted-job.origin': observed.identityDigest,
    'sec.hosted-job.operation': setup.plan.identity.identityDigest,
    'sec.hosted-job.attempt': setup.boundAttemptDigest, 'sec.hosted-job.role': observed.role,
    'sec.hosted-job.phase': command.phase, 'sec.hosted-job.image': ENVIRONMENT.trustedRuntime.imageDigest,
    'sec.hosted-job.sandbox-unit': sandboxUnitName,
    'sec.hosted-job.apparmor-policy': substrate.inputProfileDigest });
  const spec = createHostedJobContainerSpec({ name, role: 'sut', labels, sourceRoot: observed.trustedDriverRoot,
    appArmorProfile: substrate.profileName,
    inputs: files.map(({ file, target }) => ({ source: file.path, target })) });
  let containerId: string | null = null;
  let removalConfirmed = false;
  let setupSettled = false;
  let safeToStop = true;
  let creation: HostedJobContainerReadback | null = null;
  let started: HostedJobContainerReadback | null = null;
  let terminal: HostedJobContainerReadback | null = null;
  let materialization: Awaited<ReturnType<typeof ensureLocalGitHubActionsRunnerToolchainMaterialization>> | null = null;
  let executionOperation: SecBoundSemanticOperation | null = null;
  let startedAtUnixMs: number | null = null;
  let settledAtUnixMs: number | null = null;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let output: Uint8Array | null = null;
  let sandboxObservationDigest: string | null = null;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    materialization = await ensureLocalGitHubActionsRunnerToolchainMaterialization({ repositoryRoot: observed.trustedDriverRoot,
      containerEngineSession: engine });
    await ensureTrustedRuntimeContainerImageMaterialization({ repositoryRoot: observed.trustedDriverRoot,
      containerEngineSession: engine });
    assertAuthenticatedGitHubJobOriginCurrent(origin);
    await assertAuthenticatedLinuxHostedBootstrapCurrent(bootstrap);
    for (const { file } of files) file.assertCurrent();
    const created = await engine.execute({ kind: 'container-create', arguments: spec.arguments },
      { maxStdoutBytes: 4096, maxStderrBytes: 64 * 1024 });
    const returnedId = text(created.stdout).trim();
    if (!/^[0-9a-f]{64}$/u.test(returnedId)) throw new Error('Container creation did not return an exact retained ID.');
    containerId = returnedId;
    creation = await inspect(engine, spec, containerId);
    if (creation.running || creation.activeExecIds.length !== 0) throw new Error('New container is unexpectedly busy.');
    await engine.execute({ kind: 'container-start', arguments: [containerId] });
    started = await inspect(engine, spec, containerId);
    if (!started.running || started.activeExecIds.length !== 0) throw new Error('Started outer container is not idle and exact.');
    const bunReadback = await engine.execute({ kind: 'container-exec', arguments: [containerId,
      '/usr/bin/sha256sum', '--', ENVIRONMENT.trustedRuntime.bunExecutablePath] },
      { maxStdoutBytes: 4096, maxStderrBytes: 4096 });
    if (text(bunReadback.stdout) !== `${ENVIRONMENT.trustedRuntime.bunExecutableDigest.slice(7)}  ${ENVIRONMENT.trustedRuntime.bunExecutablePath}\n`) {
      throw new Error('Actual hosted runtime Bun executable bytes differ.');
    }
    // The copy is from the authenticated read-only trusted checkout, never an
    // extracted candidate archive. Host credentials/Actions files are not mounted.
    await engine.execute({ kind: 'container-exec', arguments: [containerId, '/bin/bash', '-ceu',
      'cp -R --no-preserve=ownership -- /sec-trusted/. /workspace/; mkdir -p /workspace/.tmp/codex/raw /workspace/.tmp/codex/hosted-input /tmp/sec-home'] });
    for (const { file, target } of files) {
      const readback = await engine.execute({ kind: 'container-exec', arguments: [containerId, '/usr/bin/sha256sum', '--', target] },
        { maxStdoutBytes: 4096, maxStderrBytes: 4096 });
      file.assertCurrent();
      if (text(readback.stdout) !== `${file.digest().byteDigest.slice(7)}  ${target}\n`) throw new Error('Retained input bind readback changed.');
      // The original facade admits transport only below .tmp/codex. Copy the
      // authenticated input bytes into this private container workspace, never
      // weaken its transport parser to accept an arbitrary host path.
      const privateTarget = `${INNER_INPUT}/${path.posix.basename(target)}`;
      await engine.execute({ kind: 'container-exec', arguments: [containerId, '/bin/cp', '--no-preserve=ownership', '--', target, privateTarget] });
      const copied = await engine.execute({ kind: 'container-exec', arguments: [containerId, '/usr/bin/sha256sum', '--', privateTarget] },
        { maxStdoutBytes: 4096, maxStderrBytes: 4096 });
      file.assertCurrent();
      if (text(copied.stdout) !== `${file.digest().byteDigest.slice(7)}  ${privateTarget}\n`) throw new Error('Private input copy differs from the retained original.');
    }
    settlements.push(setupScope.settle());
    setupSettled = true;
    executionOperation = operation(engine, origin, command.phase, 'execute');
    const executionScope = engine.openOperationScope({ operation: executionOperation, requirementId: REQUIREMENT });
    let executionFailure: Readonly<{ label: string; error: unknown }> | undefined;
    try {
      safeToStop = false;
      startedAtUnixMs = Date.now();
      const result = await engine.execute({ kind: 'container-exec', arguments: [containerId, '/usr/bin/env', '-i',
        'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp/sec-home', 'TMPDIR=/tmp', 'LANG=C.UTF-8', 'CI=1',
        ENVIRONMENT.trustedRuntime.bunExecutablePath, '--no-env-file', SOURCE, command.phase,
        '--sandbox-deadline-at-unix-ms', String(engine.deadlineAtUnixMs),
        '--resolution', `${INNER_INPUT}/resolution.json`, ...(command.phase === 'execute-hosted-action-sut'
          ? ['--ticket', `${INNER_INPUT}/ticket.json`, '--prepared-candidate-archive', `${INNER_INPUT}/candidate.tar`, '--output', RAW_OUTPUT]
          : ['--sandbox-unit-nonce', sandboxNonce]), '--json'] },
        { maxStdoutBytes: OUTPUT_LIMIT, maxStderrBytes: OUTPUT_LIMIT, acceptAnyExitCode: true });
      stdoutBytes = result.stdout.length;
      stderrBytes = result.stderr.length;
      if (result.code !== 0) throw new Error('Hosted SUT facade failed; no successful inner settlement is asserted.');
      if (command.phase === 'self-test-hosted-action-sandbox') {
        const response = exactJson(result.stdout, OUTPUT_LIMIT);
        if (response.schema !== 'sec-verification-action-sut-capability-v2'
            || response.actionKey !== resolution.actionPlan.action.actionKey) throw new Error('SUT capability output has another Action identity.');
        const capability = parseHostedSutCapabilityObservation(response.observation);
        safeToStop = hostedSutCleanupComplete(capability.cleanup)
          && capability.lifecycle.supervisorClosed === true && capability.lifecycle.candidateUnitSettled === true;
        sandboxObservationDigest = sha256(capability);
        output = result.stdout;
      } else {
        const raw = await engine.execute({ kind: 'container-exec', arguments: [containerId, '/usr/bin/cat', '--', RAW_OUTPUT] },
          { maxStdoutBytes: OUTPUT_LIMIT - stdoutBytes, maxStderrBytes: Math.min(4096, OUTPUT_LIMIT - stderrBytes) });
        stdoutBytes += raw.stdout.length;
        stderrBytes += raw.stderr.length;
        const observation = CodexDevelopmentParseHostedActionRawResult(text(raw.stdout));
        const response = exactJson(result.stdout, OUTPUT_LIMIT);
        if (response.rawResultDigest !== observation.rawResultDigest
            || observation.sandboxReceipt.actionKey !== resolution.actionPlan.action.actionKey) throw new Error('Raw SUT transport differs from its exact command readback.');
        const lifecycle = observation.sandboxReceipt.execution.lifecycle;
        safeToStop = hostedSutCleanupComplete(observation.sandboxReceipt.cleanup)
          && lifecycle.supervisorClosed === true && lifecycle.candidateUnitSettled === true;
        sandboxObservationDigest = observation.sandboxReceipt.receiptDigest;
        output = raw.stdout;
      }
      settledAtUnixMs = Date.now();
      if (!safeToStop) throw new Error('Inner sandbox cleanup is unsettled; its exact outer resource is preserved.');
      terminal = await inspect(engine, spec, containerId);
      await assertAuthenticatedLinuxHostedBootstrapCurrent(bootstrap);
      if (terminal.activeExecIds.length !== 0) throw new Error('Outer runtime retains a busy execution.');
    } catch (error) { executionFailure = { label: 'hosted-sut-execution', error }; }
    await settleResourcesAsync({ primary: executionFailure,
      cleanup: [{ label: 'hosted-sut-provider-scope', settle: () => { settlements.push(executionScope.settle()); } }] });
  } catch (error) { primary = { label: 'hosted-job-runtime', error }; }
  try {
    await settleResourcesAsync({ primary, cleanup: [
      { label: 'hosted-job-setup-scope', settle: () => { if (!setupSettled) settlements.push(setupScope.settle()); } },
      { label: 'hosted-job-container', settle: async () => {
        if (containerId === null) return; // Unknown creation is never deleted by name.
        if (!safeToStop) throw new Error('A possibly busy inner execution is retained for its original owner.');
        assertAuthenticatedGitHubJobOriginCurrent(origin);
        const cleanupOperation = operation(engine, origin, command.phase, 'cleanup');
        const cleanupScope = engine.openOperationScope({ operation: cleanupOperation, requirementId: REQUIREMENT });
        let cleanupFailure: Readonly<{ label: string; error: unknown }> | undefined;
        try {
          const before = await inspect(engine, spec, containerId);
          if (before.activeExecIds.length !== 0) throw new Error('Busy owned container is preserved.');
          if (before.running) await engine.execute({ kind: 'container-stop', arguments: ['--time', '10', containerId] });
          const stopped = await inspect(engine, spec, containerId);
          if (stopped.running || stopped.activeExecIds.length !== 0) throw new Error('Container stop is not settled; preserve it.');
          terminal ??= stopped;
          await engine.execute({ kind: 'container-remove', arguments: [containerId] });
          const readback = await engine.execute({ kind: 'container-list', arguments: ['--all', '--quiet', '--no-trunc', '--filter', `id=${containerId}`] },
            { maxStdoutBytes: 4096, maxStderrBytes: 4096 });
          if (text(readback.stdout).trim() !== '') throw new Error('Exact container removal has no absent readback.');
          removalConfirmed = true;
        } catch (error) { cleanupFailure = { label: 'hosted-container-cleanup', error }; }
        await settleResourcesAsync({ primary: cleanupFailure,
          cleanup: [{ label: 'hosted-cleanup-provider-scope', settle: () => { settlements.push(cleanupScope.settle()); } }] });
      } }
    ] });
  } catch (error) {
    throw new HostedJobRuntimeEffectError(Object.freeze({ originIdentityDigest: observed.identityDigest,
      operationIdentityDigest: setup.plan.identity.identityDigest, containerName: name, containerId, removalConfirmed }), error);
  }
  if (materialization === null || creation === null || started === null || terminal === null
      || output === null || executionOperation === null || !removalConfirmed
      || settlements.length !== 3 || settlements.some(value => value.physicalDisposition !== 'settled')) {
    throw new Error('Hosted SUT runtime has no complete exact observation and provider settlement.');
  }
  for (const { file } of files) file.assertCurrent();
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  const receipt = createHostedJobRuntimeReceipt({
    origin: { repository: observed.repository, repositoryId: observed.repositoryId, workflowPath: observed.workflowPath,
      workflowSha: observed.workflowSha, trustedSourceSha: observed.trustedSourceSha, trustedSourceTreeSha: observed.trustedSourceTreeSha,
      runId: observed.runId, runAttempt: observed.runAttempt, jobId: observed.jobId, checkRunId: observed.checkRunId,
      policyJobId: observed.policyJobId, role: observed.role, identityDigest: observed.identityDigest,
      workflowSourceDigest: observed.workflowSourceDigest, launcherSourceDigest: observed.launcherSourceDigest,
      originalDeadlineAtUnixMs: observed.originalDeadlineAtUnixMs },
    operation: { phase: command.phase, actionKey: resolution.actionPlan.action.actionKey,
      operationIdentityDigest: executionOperation.plan.identity.identityDigest,
      boundAttemptDigest: executionOperation.boundAttemptDigest, deadlineAtUnixMs: executionOperation.plan.attempt.deadlineAtUnixMs },
    materialization: { specDigest: materialization.specDigest, runtimeManifestDigest: materialization.runtimeManifestDigest,
      dockerProjectionDigest: materialization.dockerProjectionDigest, provenanceArtifactDigest: materialization.provenanceArtifactDigest,
      executionImageDigest: ENVIRONMENT.trustedRuntime.imageDigest, bunExecutableDigest: ENVIRONMENT.trustedRuntime.bunExecutableDigest,
      engineProviderIdentityDigest: engine.providerIdentityDigest, ociExporterIdentityDigest: exporter.identityDigest },
    container: { id: containerId!, name, ownershipDigest: sha256(labels), creationReadbackDigest: creation.observationDigest,
      startedReadbackDigest: started.observationDigest, terminalReadbackDigest: terminal.observationDigest },
    execution: { started: true, settled: true, startedAtUnixMs, settledAtUnixMs, exitCode: 0, stdoutBytes, stderrBytes, outputDigest: rawSha256(output),
      outputTruncated: false, sandboxObservationDigest },
    cleanup: { containerAbsent: removalConfirmed, providerScopeSettled: true, outputSettled: true,
      // Sources are borrowed, never disposed here. No private source copy
      // survives the observed container removal; original handles remain owned.
      ownedSourcesReleased: true }
  });
  return Object.freeze({ receipt, output });
}

/** Append only fixed, validated data outputs. Untrusted SUT streams never enter Actions command files. */
function publishActionsDataOutputs(file: string, values: Readonly<Record<string, string>>): void {
  if (!path.isAbsolute(file) || path.resolve(file) !== file) throw new Error('Actions output file is not canonical.');
  const entries = Object.entries(values);
  if (entries.some(([key, value]) => !/^[a-z][a-z0-9-]*$/u.test(key)
      || !/^[A-Za-z0-9_.:-]{1,512}$/u.test(value))) throw new Error('Actions output contains an inadmissible data value.');
  const parent = inspectNoFollowDirectoryChain(path.dirname(file));
  const retained = retainNoFollowOrdinaryFile(parent, path.basename(file));
  let descriptor: number | undefined;
  let readback: RetainedNoFollowOrdinaryFile | undefined;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    descriptor = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > 1024n * 1024n
        || String(stat.dev) !== retained.physical.device || String(stat.ino) !== retained.physical.inode) {
      throw new Error('Actions output is not one exact bounded ordinary file.');
    }
    retained.assertCurrent();
    const bytes = Buffer.from(entries.map(([key, value]) => `${key}=${value}\n`).join(''));
    let written = 0;
    while (written < bytes.length) {
      const count = writeSync(descriptor, bytes, written, bytes.length - written);
      if (count <= 0) throw new Error('Actions output append made no progress.');
      written += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (after.dev !== stat.dev || after.ino !== stat.ino || after.nlink !== 1n
        || after.mode !== stat.mode || after.uid !== stat.uid || after.gid !== stat.gid
        || after.size !== stat.size + BigInt(bytes.length)) throw new Error('Actions output changed during append.');
    readback = retainNoFollowOrdinaryFile(parent, path.basename(file), retained.physical);
    readback.assertCurrent();
  } catch (error) { primary = { label: 'hosted-actions-output-publication', error }; }
  settleResources({ primary, cleanup: [
    { label: 'hosted-actions-output-readback', settle: () => readback?.dispose() },
    { label: 'hosted-actions-output-descriptor', settle: () => { if (descriptor !== undefined) closeSync(descriptor); } },
    { label: 'hosted-actions-output-retained-handle', settle: () => retained.dispose() }
  ] });
}

/**
 * Bounded native workflow entry. Trusted orchestration stays in the authenticated
 * host; candidate code can only use the isolated SUT route and its real owners.
 */
export async function hostedJobRuntimeCli(args: readonly string[]): Promise<void> {
  const captured = Object.freeze([...args]);
  if (captured.length !== 4 || captured[0] !== '--job' || captured[2] !== '--phase') throw new Error('Hosted runtime expects one exact job and phase.');
  const jobId = captured[1]!;
  const phase = captured[3]!;
  const bootstrapPhase = (jobId === 'checker-pre' && phase === 'checker-pre')
    || (jobId === 'checker-post' && phase === 'checker-post');
  const mainHealthPhase = jobId === 'main-health' && Object.hasOwn(MAIN_HEALTH_COMMANDS, phase);
  if (!bootstrapPhase && !mainHealthPhase && !((jobId === 'preflight-verification-action-sut' && phase === 'self-test-hosted-action-sandbox')
      || (jobId === 'execute-verification-action-sut' && phase === 'execute-hosted-action-sut'))) {
    // Trusted compiler/claim/activation/integration/release routes remain closed
    // until their original process/API owners consume the authenticated budget.
    throw new Error('This hosted runtime phase has no admitted bounded source handler.');
  }
  const root = path.resolve(process.cwd());
  const runnerTemp = process.env.RUNNER_TEMP;
  const actionsOutput = process.env.GITHUB_OUTPUT;
  const needsJson = process.env.SEC_HOSTED_NEEDS_JSON;
  const stepsJson = process.env.SEC_HOSTED_STEPS_JSON;
  if (typeof runnerTemp !== 'string' || !path.isAbsolute(runnerTemp) || path.resolve(runnerTemp) !== runnerTemp
      || typeof actionsOutput !== 'string') throw new Error('Native Actions phase channels are unavailable.');
  const tempRoot = inspectNoFollowDirectoryChain(runnerTemp).target;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const retained: RetainedNoFollowOrdinaryFile[] = [];
  let origin: AuthenticatedGitHubJobOrigin | undefined;
  let bootstrap: AuthenticatedLinuxHostedBootstrap | undefined;
  let publisher: Awaited<ReturnType<typeof publishLinuxDockerStaticToolchain>> | undefined;
  let provider: DockerCommandProviderCapability | undefined;
  let providerOpeningStarted = false;
  let unclaimedProviderCloseConfirmed = false;
  let providerTransferred = false;
  let sessionOpeningStarted = false;
  let engine: ContainerEngineSession | undefined;
  let exporter: QualifiedContainerEngineOciExporter | undefined;
  let result: Awaited<ReturnType<typeof executeHostedJobSutPhase>> | undefined;
  let sutScopeStarted = false;
  let sutRemovalConfirmed = false;
  let outputRoot: ReturnType<typeof createNoFollowDirectoryChain> | undefined;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  const retain = (slot: string, name: string): RetainedNoFollowOrdinaryFile => {
    const parent = inspectNoFollowDirectoryChain(path.join(runnerTemp, 'sec-hosted-job', jobId, 'in', slot));
    const file = retainNoFollowOrdinaryFile(parent, name, undefined, 'Native hosted artifact input');
    retained.push(file);
    return file;
  };
  try {
    origin = await openAuthenticatedGitHubJobOrigin({ repositoryRoot: root, signal: controller.signal });
    const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
    if (observed.policyJobId !== jobId || observed.phase !== phase) throw new Error('CLI selector differs from the authenticated current job phase.');
    if (bootstrapPhase) {
      if (typeof needsJson !== 'string' || typeof stepsJson !== 'string') throw new Error('Native bootstrap phase data channels are unavailable.');
      const checked = await executeHostedBootstrapPhase({ origin, jobId, phase,
        nativeChannels: { runnerTemp, needsJson, stepsJson } });
      settleResources({ primary: checked.failure === null ? undefined : { label: 'bootstrap-checker', error: checked.failure.error },
        cleanup: [{ label: 'bootstrap-native-outputs', settle: () => publishActionsDataOutputs(actionsOutput, checked.outputs) }] });
      if (checked.exitCode !== 0) throw new Error(checked.diagnostic ?? 'Trusted bootstrap checker did not pass.');
    } else {
    let command: HostedJobSutPhase | undefined;
    let sandboxRoots: string[] = [];
    if (!mainHealthPhase) {
    const slot = phase === 'self-test-hosted-action-sandbox' ? 'capability' : 'raw';
    outputRoot = createNoFollowDirectoryChain(tempRoot, ['sec-hosted-job', jobId, 'out', slot]);
    if (readdirSync(outputRoot.path).length !== 0) throw new Error('Existing phase output is preserved for its original owner; no duplicate execution starts.');
    const resolution = retain('resolution', 'hosted-action-resolution.json');
    command = phase === 'self-test-hosted-action-sandbox'
      ? Object.freeze({ phase: 'self-test-hosted-action-sandbox', resolution })
      : Object.freeze({ phase: 'execute-hosted-action-sut', resolution,
          ticket: retain('prepared', 'verification-action-execution-ticket.json'),
          candidateArchive: retain('prepared', 'prepared-candidate.tar') });
    // Determine the one private namespace path before privileged bootstrap.
    // The original inner plan still owns argv and execution authorization.
    retainedInput(command.resolution, 16 * 1024 * 1024);
    const selectedResolution = CodexDevelopmentParseHostedActionResolution(text(command.resolution.readBytes()));
    if (selectedResolution.artifactInput.baseSha !== observed.trustedSourceSha
        || selectedResolution.executionEnvironment.executionEnvironmentRevision !== CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION) {
      throw new Error('SUT input does not bind the current authenticated source and runtime.');
    }
    const actionKey = selectedResolution.actionPlan.action.actionKey;
    let nonce = sha256({ schema: 'sec-hosted-sandbox-unit-v1', jobId: observed.jobId,
      checkRunId: observed.checkRunId, phase: observed.phase, actionKey }).slice(7, 39);
    if (command.phase === 'execute-hosted-action-sut') {
      retainedInput(command.ticket, 16 * 1024 * 1024);
      retainedInput(command.candidateArchive, 1024 * 1024 * 1024);
      const ticket = CodexDevelopmentParseHostedActionExecutionTicket(text(command.ticket.readBytes()));
      if (ticket.actionKey !== actionKey || ticket.resolutionDigest !== selectedResolution.resolutionDigest
          || ticket.preparedCandidateArchiveDigest !== command.candidateArchive.digest().byteDigest) {
        throw new Error('SUT ticket/archive does not bind the selected Action.');
      }
      nonce = ticket.ticketDigest.slice(7, 23);
    }
    sandboxRoots = [`/tmp/sec-sut-${actionKey.slice(7, 23)}-${nonce}`];
    } else if (observed.role !== 'trusted' || observed.workflowPath !== '.github/workflows/compiler-pr-validation.yml') {
      throw new Error('MainHealth requires its exact authenticated trusted job.');
    }
    bootstrap = prepareAuthenticatedLinuxHostedBootstrap({ origin,
      deadlineAtUnixMs: observed.originalDeadlineAtUnixMs, sandboxRoots });
    const bootstrapProvider = observeAuthenticatedLinuxHostedBootstrap(bootstrap);
    await applyAuthenticatedLinuxHostedBootstrap(bootstrap, {
      operation: operation(bootstrapProvider, origin, phase, 'setup', 'bootstrap'),
      requirementId: 'hosted-job.linux-bootstrap'
    });
    // Preserve a real cleanup margin inside the original provider job lifetime;
    // neither publisher nor any Engine phase obtains a replacement deadline.
    const engineDeadline = observed.originalDeadlineAtUnixMs - 60_000;
    if (engineDeadline <= Date.now()) throw new Error('Original job has insufficient remaining execution and cleanup budget.');
    publisher = await publishLinuxDockerStaticToolchain({ deadlineAtUnixMs: observed.originalDeadlineAtUnixMs,
      signal: getAuthenticatedGitHubJobOriginSignal(origin) });
    await publisher.assertCurrent();
    providerOpeningStarted = true;
    provider = await openAuthenticatedLinuxDockerCommandProvider({ origin, generation: publisher.generation,
      workingDirectory: root, deadlineAtUnixMs: engineDeadline });
    const admission = operation({ providerIdentityDigest: provider.providerIdentityDigest,
      deadlineAtUnixMs: engineDeadline }, origin, phase, 'setup');
    sessionOpeningStarted = true;
    const opening = openContainerEngineSession({ operation: admission, provider, cwd: root,
      availability: 'observe', signal: getAuthenticatedGitHubJobOriginSignal(origin) });
    providerTransferred = true;
    engine = await opening;
    const probe = operation(engine, origin, phase, 'setup');
    exporter = await qualifyLinuxDockerOciExporter({ session: engine, operation: probe,
      requirementId: REQUIREMENT, scratchParent: runnerTemp });
    if (mainHealthPhase) {
      const checked = await executeTrustedRuntimeMainHealthCheck({ repositoryRoot: observed.trustedDriverRoot,
        repository: observed.repository, mainSha: observed.trustedSourceSha, mainTreeSha: observed.trustedSourceTreeSha,
        command: MAIN_HEALTH_COMMANDS[phase as keyof typeof MAIN_HEALTH_COMMANDS], deadlineAtUnixMs: engine.deadlineAtUnixMs,
        signal: getAuthenticatedGitHubJobOriginSignal(origin), qualifiedEngineExporter: exporter,
        immutableInputBootstrap: bootstrap });
      assertAuthenticatedGitHubJobOriginCurrent(origin);
      publishActionsDataOutputs(actionsOutput, { 'main-health-check-digest': checked.resultDigest });
    } else {
    if (command === undefined) throw new Error('SUT command is absent.');
    sutScopeStarted = true;
    try {
      result = await executeHostedJobSutPhase({ origin, exporter, bootstrap, command });
      sutRemovalConfirmed = result.receipt.cleanup.containerAbsent;
    } catch (error) {
      if (error instanceof HostedJobRuntimeEffectError) sutRemovalConfirmed = error.retained.removalConfirmed;
      throw error;
    }
    }
    }
  } catch (error) { primary = { label: 'hosted-job-phase', error }; }
  await settleResourcesAsync({ primary, cleanup: [
    { label: 'hosted-job-input-handles', settle: async () => {
      await settleResourcesAsync({ cleanup: retained.map((file, index) => ({
        label: `input-${index}`, settle: () => file.dispose() })) });
    } },
    { label: 'hosted-job-engine', settle: async () => {
      if (exporter !== undefined) {
        const ownership = observeQualifiedContainerEngineOciExporterOwnership(exporter);
        if (ownership.ownership === 'available') await closeUnclaimedQualifiedContainerEngineOciExporter(exporter);
        const closed = observeQualifiedContainerEngineOciExporterOwnership(exporter);
        if (closed.sessionClose !== 'settled') throw new Error('Original Engine owner has not confirmed session close; preserve its generation.');
      } else if (engine !== undefined) {
        engine.close();
        if (observeRetainedContainerEngineSessionClose(engine) !== 'settled') throw new Error('Engine close is unconfirmed.');
      } else if (!providerTransferred && provider !== undefined) {
        disposeUnclaimedDockerCommandProviderCapability(provider);
        unclaimedProviderCloseConfirmed = true;
      }
    } },
    { label: 'hosted-job-linux-bootstrap', settle: async () => {
      if (bootstrap === undefined) return;
      const close = exporter !== undefined ? observeQualifiedContainerEngineOciExporterOwnership(exporter).sessionClose
        : engine !== undefined ? observeRetainedContainerEngineSessionClose(engine)
          : sessionOpeningStarted || (providerOpeningStarted && !unclaimedProviderCloseConfirmed) ? 'unknown' : 'settled';
      if (close !== 'settled' || sutScopeStarted && !sutRemovalConfirmed) {
        throw new Error('Unsettled SUT/Engine retains its exact AppArmor profile and bootstrap responsibility.');
      }
      await retireAuthenticatedLinuxHostedBootstrap(bootstrap);
    } },
    { label: 'hosted-job-static-toolchain', settle: async () => {
      if (publisher === undefined) return;
      const close = exporter !== undefined ? observeQualifiedContainerEngineOciExporterOwnership(exporter).sessionClose
        : engine !== undefined ? observeRetainedContainerEngineSessionClose(engine)
          : sessionOpeningStarted || (providerOpeningStarted && !unclaimedProviderCloseConfirmed) ? 'unknown' : 'settled';
      if (close !== 'settled') throw new Error('Published toolchain remains owned by an unconfirmed Engine opening/close.');
      await publisher.retire();
    } },
    { label: 'hosted-job-origin', settle: async () => { if (origin !== undefined) await closeAuthenticatedGitHubJobOrigin(origin); } },
    { label: 'hosted-job-signals', settle: () => { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); } }
  ] });
  if (bootstrapPhase || mainHealthPhase) return;
  if (result === undefined || outputRoot === undefined) throw new Error('Hosted job produced no fully settled runtime output.');
  const artifactFile = phase === 'self-test-hosted-action-sandbox' ? 'hosted-sut-capability.json' : 'verification-action-raw-observation.json';
  const receiptBytes = Buffer.from(`${JSON.stringify(result.receipt)}\n`);
  for (const [name, bytes] of [[artifactFile, result.output], ['hosted-job-runtime-receipt.json', receiptBytes]] as const) {
    const digest = rawSha256(bytes);
    publishExclusiveDurableCanonicalFile({ parent: outputRoot, name, bytes,
      validate: actual => { if (rawSha256(actual) !== digest) throw new Error('Hosted output publication bytes drifted.'); } });
  }
  const slot = phase === 'self-test-hosted-action-sandbox' ? 'capability' : 'raw';
  const prefix = slot === 'capability' ? 'sec-verification-action-sut-capability-v2' : 'sec-verification-action-raw-v2';
  const actionKey = result.receipt.operation.actionKey;
  if (actionKey === null) throw new Error('Hosted SUT output lost its Action identity.');
  const artifactName = `${prefix}-${actionKey.slice(7)}-run-${result.receipt.origin.runId}-attempt-${result.receipt.origin.runAttempt}`;
  publishActionsDataOutputs(actionsOutput, { [`${slot}-artifact-name`]: artifactName, [`${slot}-ready`]: 'true',
    'runtime-receipt-digest': result.receipt.receiptDigest,
    ...(phase === 'execute-hosted-action-sut' ? {
      'raw-result-digest': CodexDevelopmentParseHostedActionRawResult(text(result.output)).rawResultDigest
    } : {}) });
}

if (import.meta.main) await hostedJobRuntimeCli(process.argv.slice(2));
