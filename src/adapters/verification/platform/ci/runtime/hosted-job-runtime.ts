import { closeSync, constants, fstatSync, openSync, readdirSync, writeSync } from 'node:fs';
import path from 'node:path';
import { rawSha256, sha256 } from '../../../../../contracts/canonical.ts';
import { settleResources, settleResourcesAsync } from '../../../../../execution/resource-settlement.ts';
import type { DockerCommandProviderCapability } from '../../../../providers/docker/contract/command-provider.ts';
import type { ContainerEngineSession } from '../../../../providers/docker/contract/container-engine-session.ts';
import { disposeUnclaimedDockerCommandProviderCapability } from '../../../../providers/docker/runtime/command-provider.ts';
import { observeRetainedContainerEngineSessionClose, openContainerEngineSession } from '../../../../providers/docker/runtime/container-engine-session.ts';
import { openAuthenticatedLinuxDockerCommandProvider } from '../../../../providers/docker/runtime/linux-command-provider.ts';
import {
  applyAuthenticatedLinuxHostedBootstrap,
  observeAuthenticatedLinuxHostedBootstrap, prepareAuthenticatedLinuxHostedBootstrap,
  retireAuthenticatedLinuxHostedBootstrap, type AuthenticatedLinuxHostedBootstrap
} from '../../../../providers/docker/runtime/linux-hosted-bootstrap.ts';
import {
  closeUnclaimedQualifiedContainerEngineOciExporter,
  observeQualifiedContainerEngineOciExporterOwnership, qualifyLinuxDockerOciExporter,
  type QualifiedContainerEngineOciExporter
} from '../../../../providers/docker/runtime/linux-oci-exporter.ts';
import { publishLinuxDockerStaticToolchain } from '../../../../providers/docker/runtime/linux-static-toolchain-publisher.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, closeAuthenticatedGitHubJobOrigin,
  getAuthenticatedGitHubJobOriginSignal, openAuthenticatedGitHubJobOrigin,
  type AuthenticatedGitHubJobOrigin
} from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  createNoFollowDirectoryChain, inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile, retainNoFollowOrdinaryFile,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { executeTrustedRuntimeMainHealthCheck } from '../../trusted-runtime/trusted-runtime-container.ts';
import {
  CodexDevelopmentParseHostedActionRawResult
} from '../contract/hosted-sut-observation.ts';
import { CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution } from '../verification-hosted-action-contract.ts';
import { executeHostedBootstrapPhase } from './hosted-job-bootstrap-phases.ts';
import {
  executeHostedJobSutPhase, HostedJobRuntimeEffectError,
  createHostedJobRuntimeOperation as operation,
  assertHostedJobRetainedInput as retainedInput,
  decodeHostedJobRuntimeText as text,
  type HostedJobSutPhase
} from './hosted-job-sut-runtime.ts';
export { executeHostedJobSutPhase, HostedJobRuntimeEffectError, type HostedJobSutPhase } from './hosted-job-sut-runtime.ts';

const REQUIREMENT = 'hosted-job.container-engine';
const MAIN_HEALTH_COMMANDS = Object.freeze({
  'imports:check': 'bun run imports:check --all', 'typecheck:verified': 'bun run typecheck:verified',
  audit: 'bun run audit -- --worktree-source-program --enforce', 'docs:doctor': 'bun run docs:doctor',
  test: 'bun run test -- --scope fast'
} as const);

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
