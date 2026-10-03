import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync, mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync, writeFileSync
} from 'node:fs';
import path from 'node:path';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../providers/linux-verification/contract.ts';
import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../action/contract/action.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget } from '../action/contract/ci.ts';
import {
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT,
  CodexDevelopmentCreateHostedSutExecutionAuthorization,
  CodexDevelopmentFinalizeHostedActionRawResult,
  CodexDevelopmentHostedSutCandidateEnvironment,
  CodexDevelopmentParseHostedSutSandboxReceipt,
  hostedSutCleanupComplete, hostedSutLifecycleComplete,
  type CodexDevelopmentHostedActionRawResult,
  type CodexDevelopmentHostedSutExecutionAuthorization,
  type CodexDevelopmentHostedSutInventoryClosure, type CodexDevelopmentHostedSutProcessLifecycle,
  type CodexDevelopmentHostedSutSandboxReceipt
} from './contract/hosted-sut-observation.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
} from './contract/revision.ts';
import {
  CodexDevelopmentFailureTail
} from './runtime/ci-orchestration-core.ts';
import { assertHostedSutSupervisorLive, getHostedSutSupervisorDeadlineAtUnixMs, type HostedSutSupervisor } from './runtime/hosted-sut-supervisor.ts';
import type { CodexDevelopmentHostedActionExecutionTicket, CodexDevelopmentHostedActionResolution, CodexDevelopmentHostedSutSandboxCommandPlan, CodexDevelopmentHostedSutSandboxProcess, CodexDevelopmentHostedSutSandboxProcessObservation } from './verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, ciActionDigest } from './verification-hosted-action-contract.ts';
import type { CodexDevelopmentHostedActionArchiveInventory, CodexDevelopmentPreparedTrustedBootstrapSutInputs, CodexDevelopmentRetainedHostedSutArchive } from './verification-materialization.ts';
import { CodexDevelopmentPrepareTrustedBootstrapSutInputs, assertRetainedHostedSutArchive, hostedActionFileDigest, retainHostedSutArchive } from './verification-materialization.ts';
import { writeHostedActionJson } from './verification-shared.ts';

import {
  CodexDevelopmentBuildHostedSutSandboxCommandPlan,
  CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan,
  CodexDevelopmentCandidateProcessEnvironment,
  CodexDevelopmentHostedSutSandboxRoot,
  CodexDevelopmentTrustedBootstrapSutSubjectDigest,
  hostedSutCapabilityCommandPlan,
  hostedSutTeardownCommandPlan
} from './contract/hosted-sut-command-plan.ts';

export {
  CodexDevelopmentAssertHostedSutSandboxCommandPlan,
  CodexDevelopmentBuildHostedSutSandboxCommandPlan,
  CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan,
  CodexDevelopmentCandidateProcessEnvironment,
  CodexDevelopmentHostedSutCapabilityAssertion,
  CodexDevelopmentHostedSutSandboxRoot,
  CodexDevelopmentTrustedBootstrapSutHarness,
  CodexDevelopmentTrustedBootstrapSutSubjectDigest
} from './contract/hosted-sut-command-plan.ts';

/** Only the production observer's private live handle selects its process path.
 * The legacy injected process remains an explicit test seam, never admission. */
function selectedHostedSutProcess(supervisor: HostedSutSupervisor | undefined,
  testProcess?: CodexDevelopmentHostedSutSandboxProcess): CodexDevelopmentHostedSutSandboxProcess | undefined {
  if (supervisor === undefined) return testProcess;
  if (testProcess !== undefined) throw new Error('Hosted SUT production supervisor cannot be mixed with an injected process.');
  assertHostedSutSupervisorLive(supervisor);
  return async (plan, archive) => {
    assertHostedSutSupervisorLive(supervisor);
    return await supervisor.run(plan, archive);
  };
}

function defaultHostedSutSandboxProcess(
  plan: CodexDevelopmentHostedSutSandboxCommandPlan,
  retainedArchive?: CodexDevelopmentRetainedHostedSutArchive
): Promise<CodexDevelopmentHostedSutSandboxProcessObservation> {
  const consumesArchive = plan.phase === 'execute' || plan.phase === 'bootstrap-execute';
  if (consumesArchive !== (retainedArchive !== undefined)) {
    throw new Error('Hosted SUT process has a missing or extraneous retained archive descriptor.');
  }
  if (retainedArchive !== undefined) {
    assertRetainedHostedSutArchive(retainedArchive);
    if (plan.argv.filter((entry) => entry === HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH).length !== 1 ||
        plan.argv.filter((entry) => entry === retainedArchive.archiveDigest).length !== 1) {
      throw new Error('Hosted SUT process plan differs from its retained archive binding.');
    }
  }
  const child = spawn(plan.command, plan.argv, {
    cwd: process.cwd(),
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
    stdio: retainedArchive === undefined
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'pipe', 'pipe', retainedArchive.fileDescriptor],
    windowsHide: true
  });
  return observeHostedSutSandboxChild(child);
}

/** Observes only child_process events. It cannot attest inner namespace or candidate facts. */
export function observeHostedSutSandboxChild(
  child: ChildProcess
): Promise<CodexDevelopmentHostedSutSandboxProcessObservation> {
  const outputByteLimit = CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT;
  const tailByteLimit = 64 * 1024;
  return new Promise((resolve) => {
    const streams = {
      stdout: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) },
      stderr: { hash: createHash('sha256'), bytes: 0, hashed: 0, tail: Buffer.alloc(0) }
    };
    let outputTruncated = false;
    let wallTimedOut = false;
    let supervisorSpawned = false;
    let processError = false;
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout> | null = null;
    const observe = (kind: 'stdout' | 'stderr', chunk: Buffer): void => {
      const stream = streams[kind];
      stream.bytes += chunk.byteLength;
      const remaining = Math.max(0, outputByteLimit - stream.hashed);
      if (remaining > 0) {
        const retained = chunk.subarray(0, remaining);
        stream.hash.update(retained);
        stream.hashed += retained.byteLength;
      }
      const tail = Buffer.concat([stream.tail, chunk]);
      stream.tail = tail.subarray(Math.max(0, tail.byteLength - tailByteLimit));
      if (stream.bytes > outputByteLimit && !outputTruncated) {
        outputTruncated = true;
        child.kill('SIGKILL');
      }
    };
    child.stdout?.on('data', (chunk: Buffer) => observe('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => observe('stderr', chunk));
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (wallTimer !== null) clearTimeout(wallTimer);
      const stdoutDigest = `sha256:${streams.stdout.hash.digest('hex')}` as VerificationActionKeyDigest;
      const stderrDigest = `sha256:${streams.stderr.hash.digest('hex')}` as VerificationActionKeyDigest;
      const failureTail = wallTimedOut
        ? 'Hosted SUT exceeded the trusted wall-clock bound and the unshare process was terminated.'
        : outputTruncated
        ? 'Hosted SUT stdout/stderr exceeded the trusted capture bound; SIGKILL was requested for the supervisor.'
        : [streams.stdout.tail.toString('utf8'), streams.stderr.tail.toString('utf8')]
            .filter((entry) => entry.length > 0).join('\n').trim();
      const outputProjection = Object.freeze({
        stdoutDigest, stderrDigest,
        stdoutBytesObserved: streams.stdout.bytes,
        stderrBytesObserved: streams.stderr.bytes,
        outputTruncated,
        lifecycle: Object.freeze({
          supervisorSpawned, supervisorClosed: true,
          supervisorCloseCode: code, supervisorSignal: signal,
          namespaceEstablished: null, candidateStarted: null, candidateUnitSettled: null,
          observationGap: 'unsupported-source' as const
        })
      });
      resolve(Object.freeze({
        code: wallTimedOut ? 124 : outputTruncated ? 125 : processError ? 1 : code ?? 1,
        rawOutputDigest: ciActionDigest({ ...outputProjection, wallTimedOut }),
        failureTail,
        ...outputProjection
      }));
    };
    child.on('spawn', () => { supervisorSpawned = true; });
    child.on('error', (error) => {
      observe('stderr', Buffer.from(error instanceof Error ? error.message : String(error)));
      processError = true;
      // An error event is not process/pipe settlement. Only close resolves this owner.
    });
    child.on('close', (code, signal) => finish(code, signal));
    wallTimer = setTimeout(() => {
      if (settled) return;
      wallTimedOut = true;
      child.kill('SIGKILL');
    }, CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1_000);
    wallTimer.unref();
  });
}

function syntheticHostedSutSandboxProcessObservation(
  code: number,
  diagnostic: string
): CodexDevelopmentHostedSutSandboxProcessObservation {
  const stdoutDigest = ciActionDigest('');
  const stderrDigest = ciActionDigest(diagnostic);
  return Object.freeze({
    code,
    rawOutputDigest: ciActionDigest({ stdoutDigest, stderrDigest, diagnostic }),
    failureTail: diagnostic,
    stdoutDigest,
    stderrDigest,
    stdoutBytesObserved: 0,
    stderrBytesObserved: Buffer.byteLength(diagnostic, 'utf8'),
    outputTruncated: false,
    lifecycle: Object.freeze({
      supervisorSpawned: null, supervisorClosed: null, supervisorCloseCode: null, supervisorSignal: null,
      namespaceEstablished: null, candidateStarted: null, candidateUnitSettled: null,
      observationGap: 'observation-lost'
    })
  });
}

const HOSTED_SUT_NOT_ATTEMPTED_LIFECYCLE: CodexDevelopmentHostedSutProcessLifecycle = Object.freeze({
  supervisorSpawned: false, supervisorClosed: false, supervisorCloseCode: null, supervisorSignal: null,
  namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: null,
  observationGap: null
});

function hostedSutDirectoryCleanup(observed: CodexDevelopmentHostedSutSandboxProcessObservation):
CodexDevelopmentHostedSutSandboxReceipt['cleanup'] {
  return Object.freeze({
    supervisorSpawned: observed.lifecycle.supervisorSpawned,
    supervisorClosed: observed.lifecycle.supervisorClosed,
    exitCode: observed.lifecycle.supervisorClosed === true &&
      observed.lifecycle.supervisorCloseCode !== null && observed.lifecycle.supervisorCloseCode >= 0
      ? observed.lifecycle.supervisorCloseCode : null,
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest
  });
}

function hostedSutCleanupNotAttempted(): CodexDevelopmentHostedSutSandboxReceipt['cleanup'] {
  return Object.freeze({
    supervisorSpawned: false, supervisorClosed: false, exitCode: null,
    outputDigest: ciActionDigest('directory-cleanup-not-attempted')
  });
}

const HOSTED_SUT_UNSUPPORTED_SOURCE_DIAGNOSTIC =
  'Hosted SUT unsupported observation source: child_process events cannot attest namespace establishment, candidate start, or candidate-unit settlement.';

const TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES = Object.freeze([
  ['tcb-lock-pre.json', 'tcb-lock-pre'],
  ['imports.log', 'imports'],
  ['docs-doctor.log', 'docs-doctor'],
  ['typecheck.log', 'typecheck'],
  ['diff-check.log', 'diff-check'],
  ['focused-tests.log', 'focused-tests'],
  ['repository-audit.json', 'repository-audit'],
  ['affected-plan.json', 'affected-plan'],
  ['affected-tests.log', 'affected-tests'],
  ['tcb-lock-post.json', 'tcb-lock-post']
] as const);

export async function CodexDevelopmentExecuteTrustedBootstrapSut(input: Readonly<{
  baseRoot: string;
  candidateRoot: string;
  outputDirectory: string;
  baseSha: string;
  headSha: string;
  treeSha: string;
  manifestPath: string;
  unitNonce?: string;
  supervisor?: HostedSutSupervisor;
}>): Promise<Readonly<{
  status: 'passed' | 'failed';
  bootstrapDigest: VerificationActionKeyDigest;
  receiptDigest: VerificationActionKeyDigest;
}>> {
  const supervisor = input.supervisor;
  const runSandbox = selectedHostedSutProcess(supervisor) ?? defaultHostedSutSandboxProcess;
  const bunExecutable = supervisor === undefined ? process.execPath
    : SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunExecutablePath;
  if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]{1,1024}$/u.test(input.manifestPath)) {
    throw new Error('Trusted bootstrap SUT manifest path is invalid.');
  }
  const unitSubjectDigest = CodexDevelopmentTrustedBootstrapSutSubjectDigest(input);
  if (input.unitNonce !== undefined) {
    CodexDevelopmentHostedSutSandboxRoot({ subjectDigest: unitSubjectDigest, unitNonce: input.unitNonce });
  }
  const capability = await CodexDevelopmentProbeHostedSutSandboxCapability({
    actionKey: unitSubjectDigest, unitNonce: input.unitNonce, supervisor, bunExecutable
  });
  if (capability.state !== 'supported') {
    throw new Error(`Trusted bootstrap SUT cannot start: ${capability.diagnostic ?? capability.state}`);
  }
  const outputDirectory = path.resolve(input.outputDirectory);
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length !== 0) {
    throw new Error('Trusted bootstrap SUT evidence root must begin empty.');
  }
  mkdirSync(outputDirectory, { recursive: true });
  const transportDirectory = path.resolve(outputDirectory, '.transport');
  const candidateNodeModules = path.resolve(input.candidateRoot, 'node_modules');
  let prepared: CodexDevelopmentPreparedTrustedBootstrapSutInputs | null = null;
  let retainedArchive: CodexDevelopmentRetainedHostedSutArchive | null = null;
  try {
    prepared = CodexDevelopmentPrepareTrustedBootstrapSutInputs({
      baseRoot: input.baseRoot,
      candidateRoot: input.candidateRoot,
      outputDirectory: transportDirectory,
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha
    });
    const bootstrapDigest = ciActionDigest(Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-operation-v1',
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha,
      manifestPath: input.manifestPath,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      dependencyMaterialization: prepared.dependencyMaterialization,
      dependencyArchiveProjection: prepared.dependencyArchiveProjection,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST
    }));
    const candidateEnvironment = CodexDevelopmentCandidateProcessEnvironment({}, {
      SEC_BOOTSTRAP_BASE: input.baseSha,
      SEC_BOOTSTRAP_HEAD: input.headSha,
      SEC_BOOTSTRAP_TREE: input.treeSha,
      SEC_CHANGED_BASE: input.baseSha,
      SEC_AFFECTED_TESTS_BASE: input.baseSha,
      SEC_REPOSITORY_AUDIT_DEFAULT_REF: input.baseSha,
      SEC_WORK_PACKAGE_MANIFEST_PATH: input.manifestPath
    });
    let commandPlan: CodexDevelopmentHostedSutSandboxCommandPlan | null = null;
    let execution = syntheticHostedSutSandboxProcessObservation(
      1, capability.diagnostic ?? `sandbox-capability:${capability.state}`
    );
    let teardown = syntheticHostedSutSandboxProcessObservation(1, 'sandbox-not-started');
    let retainedArchiveStable = false;
    if (capability.state === 'supported') {
      retainedArchive = retainHostedSutArchive(
        prepared.preparedCandidateArchive,
        prepared.archiveDigest
      );
      commandPlan = CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan({
        bootstrapDigest,
        ...(input.unitNonce === undefined ? {} : { unitSubjectDigest }),
        candidateArchiveDigest: retainedArchive.archiveDigest,
        bunExecutable: realpathSync.native(bunExecutable),
        baseSha: input.baseSha,
        headSha: input.headSha,
        candidateEnvironment,
        ...(supervisor === undefined ? {} : { dependencyPreparation: {
          schema: 'sec-hosted-sut-dependency-preparation-v1' as const,
          baseSha: input.baseSha, baseTreeSha: prepared.baseTreeSha,
          headSha: input.headSha, headTreeSha: input.treeSha,
          archiveDigest: retainedArchive.archiveDigest, inventoryDigest: prepared.archiveInventoryDigest,
          entryCount: prepared.entryCount, totalFileBytes: prepared.totalFileBytes,
          dependencyClosureDigest: prepared.dependencyClosureDigest, gitBundleDigest: prepared.authenticatedGitClosureDigest,
          deadlineAtUnixMs: getHostedSutSupervisorDeadlineAtUnixMs(supervisor)
        } }),
        unitNonce: input.unitNonce ?? `${process.pid}-${Date.now()}`.slice(0, 32)
      });
      try {
        execution = await runSandbox(commandPlan, retainedArchive);
      } finally {
        try {
          teardown = await runSandbox(hostedSutTeardownCommandPlan({
            actionKey: bootstrapDigest,
            unitName: commandPlan.unitName
          }));
        } finally {
          try {
            retainedArchiveStable =
              assertRetainedHostedSutArchive(retainedArchive) === prepared.archiveDigest;
          } finally {
            closeSync(retainedArchive.fileDescriptor);
            retainedArchive = null;
          }
        }
      }
    }
    let summary: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(execution.failureTail) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        summary = parsed as Record<string, unknown>;
      }
    } catch {
      summary = null;
    }
    const results = Array.isArray(summary?.results)
      ? summary.results.filter((entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      : [];
    const resultByLabel = new Map(results.map((result) => [String(result.label), result] as const));
    for (const [fileName, label] of TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES) {
      writeHostedActionJson(path.resolve(outputDirectory, fileName), Object.freeze({
        schema: 'sec-trusted-bootstrap-sandbox-step-observation-v1',
        bootstrapDigest,
        sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
        label,
        observation: resultByLabel.get(label) ?? null
      }));
    }
    const sumsSource = `${TRUSTED_BOOTSTRAP_SUT_EVIDENCE_FILES.map(([fileName]) =>
      `${createHash('sha256').update(readFileSync(path.resolve(outputDirectory, fileName))).digest('hex')}  ${fileName}`
    ).join('\n')}\n`;
    writeFileSync(path.resolve(outputDirectory, 'SHA256SUMS'), sumsSource, { encoding: 'utf8', flag: 'wx' });
    const cleanup = hostedSutDirectoryCleanup(teardown);
    const archiveStable = retainedArchiveStable;
    const summaryIdentityPassed = summary?.schema === 'sec-trusted-bootstrap-sandbox-summary-v1' &&
      summary.baseSha === input.baseSha && summary.headSha === input.headSha &&
      summary.treeSha === input.treeSha && summary.parentSha === input.baseSha;
    const status = capability.state === 'supported' && commandPlan !== null && hostedSutLifecycleComplete(execution.lifecycle) &&
      execution.code === 0 && !execution.outputTruncated && hostedSutCleanupComplete(cleanup) && archiveStable &&
      summaryIdentityPassed && summary?.status === 'passed'
      ? 'passed' as const : 'failed' as const;
    const semantic = Object.freeze({
      schema: 'sec-trusted-bootstrap-sut-receipt-v3' as const,
      baseSha: input.baseSha,
      headSha: input.headSha,
      treeSha: input.treeSha,
      parentSha: input.baseSha,
      auxiliaryStatus: status,
      evidenceSetDigest: `sha256:${createHash('sha256').update(sumsSource).digest('hex')}`,
      bootstrapDigest,
      sandboxPolicyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
      commandPlanDigest: commandPlan?.planDigest ?? null,
      archiveDigest: prepared.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventoryDigest,
      executionOutputDigest: execution.rawOutputDigest,
      capability: hostedSutCapabilityReceipt(capability),
      executionLifecycle: execution.lifecycle,
      cleanup
    });
    const receiptDigest = (`sha256:${createHash('sha256').update(JSON.stringify(semantic)).digest('hex')}`) as VerificationActionKeyDigest;
    writeFileSync(
      path.resolve(outputDirectory, 'sut-receipt.json'),
      `${JSON.stringify({ ...semantic, receiptDigest }, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    if (status !== 'passed') {
      throw new Error(
        `Trusted bootstrap candidate SUT failed inside the private sandbox: ${
          summary?.diagnostic ?? capability.diagnostic ?? execution.failureTail}`.slice(0, 2048)
      );
    }
    return Object.freeze({ status, bootstrapDigest, receiptDigest });
  } finally {
    if (retainedArchive !== null) closeSync(retainedArchive.fileDescriptor);
    if (prepared !== null && existsSync(prepared.preparedCandidateArchive)) {
      rmSync(prepared.preparedCandidateArchive, { force: true });
    }
    if (existsSync(transportDirectory)) rmSync(transportDirectory, { recursive: true, force: true });
    if (existsSync(candidateNodeModules)) rmSync(candidateNodeModules, { recursive: true, force: true });
  }
}

function hostedSutDiagnostic(value: string, fallback: string): string {
  const bounded = CodexDevelopmentFailureTail(value, fallback);
  const escaped = bounded.replace(/[\u0000-\u001f\u007f-\u009f]/gu, (character) =>
    `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`
  );
  return CodexDevelopmentFailureTail(escaped, fallback);
}

type HostedSutSandboxCapabilityObservation = CodexDevelopmentHostedSutSandboxReceipt['capability'] & Readonly<{
  state: 'supported' | 'unsupported' | 'invalidated' | 'unknown';
}>;

export async function CodexDevelopmentProbeHostedSutSandboxCapability(input: Readonly<{
  actionKey: VerificationActionKeyDigest;
  executionAuthorization?: CodexDevelopmentHostedSutExecutionAuthorization;
  bunExecutable?: string;
  unitNonce?: string;
  platform?: NodeJS.Platform;
  /** In-process test seam; production selects only its installed physical owner. */
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
  supervisor?: HostedSutSupervisor;
}>): Promise<HostedSutSandboxCapabilityObservation> {
  const run = selectedHostedSutProcess(input.supervisor, input.runSandboxProcess);
  if ((input.platform ?? process.platform) !== 'linux' || run === undefined) {
    const diagnostic = (input.platform ?? process.platform) !== 'linux'
      ? 'Hosted SUT sandbox requires the native ubuntu-24.04 Linux runner.'
      : HOSTED_SUT_UNSUPPORTED_SOURCE_DIAGNOSTIC;
    // Reject before creating a namespace or candidate: the installed owner cannot
    // supply the required facts. A capability stdout marker cannot fill this gap.
    return Object.freeze({
      state: 'unsupported', commandPlanDigest: null,
      lifecycle: Object.freeze({ ...HOSTED_SUT_NOT_ATTEMPTED_LIFECYCLE, observationGap: 'unsupported-source' }),
      exitCode: null, markerObserved: false, outputDigest: ciActionDigest(diagnostic),
      cleanup: hostedSutCleanupNotAttempted(), diagnostic
    });
  }
  const plan = hostedSutCapabilityCommandPlan({
    actionKey: input.actionKey,
    bunExecutable: input.bunExecutable ?? process.execPath,
    unitNonce: input.unitNonce ?? `${process.pid}`,
    executionAuthorization: input.executionAuthorization
  });
  let observed: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    observed = await run(plan);
  } catch (error) {
    observed = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const teardownPlan = hostedSutTeardownCommandPlan({ actionKey: input.actionKey, unitName: plan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    teardown = await run(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const cleanup = hostedSutDirectoryCleanup(teardown);
  const selfTestPassed = hostedSutLifecycleComplete(observed.lifecycle) && observed.code === 0 &&
    !observed.outputTruncated && observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER);
  const supported = selfTestPassed && hostedSutCleanupComplete(cleanup);
  const failure = `${observed.failureTail}\n${teardown.failureTail}`.trim();
  const settled = observed.lifecycle.supervisorClosed === true && observed.lifecycle.candidateUnitSettled === true &&
    hostedSutCleanupComplete(cleanup);
  const unsupported = settled && /not found|no such file|operation not permitted|failed to connect to bus|unshare failed|unknown option/iu
    .test(failure);
  const unknown = observed.lifecycle.supervisorClosed !== true || cleanup.supervisorClosed !== true;
  return Object.freeze({
    state: supported ? 'supported' : unknown ? 'unknown' : unsupported ? 'unsupported' : 'invalidated',
    commandPlanDigest: plan.physicalCommandProjectionDigest ?? plan.planDigest,
    lifecycle: observed.lifecycle,
    exitCode: observed.lifecycle.supervisorClosed === true ? observed.code : null,
    markerObserved: observed.failureTail.includes(CI_VERIFICATION_ACTION_SANDBOX_CAPABILITY_MARKER),
    outputDigest: observed.rawOutputDigest as VerificationActionKeyDigest,
    cleanup,
    diagnostic: supported ? null : hostedSutDiagnostic([
      observed.lifecycle.observationGap === 'unsupported-source' ? HOSTED_SUT_UNSUPPORTED_SOURCE_DIAGNOSTIC : '',
      failure
    ].filter(Boolean).join('\n'), 'Hosted SUT capability or physical settlement was not observed.')
  });
}

function finalizeHostedSutSandboxReceipt(input: Omit<
  CodexDevelopmentHostedSutSandboxReceipt,
  'schema' | 'policyDigest' | 'resources' | 'receiptDigest'
>): CodexDevelopmentHostedSutSandboxReceipt {
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: input.actionKey,
    capability: input.capability,
    commandPlanDigest: input.commandPlanDigest,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits,
    authenticatedArchive: input.authenticatedArchive,
    rootIsolation: input.rootIsolation,
    execution: input.execution,
    cleanup: input.cleanup,
    diagnostic: input.diagnostic
  });
  return CodexDevelopmentParseHostedSutSandboxReceipt(Object.freeze({
    ...withoutDigest,
    receiptDigest: ciActionDigest(withoutDigest)
  }));
}

function hostedSutRootIsolationReceipt(environmentNames: readonly string[]):
CodexDevelopmentHostedSutSandboxReceipt['rootIsolation'] {
  return Object.freeze({
    substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.substrate,
    namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.namespaces,
    uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid,
    gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid,
    network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.network,
    inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.inputMount,
    workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.workspace,
    outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outputTransport,
    candidateEnvironmentNames: Object.freeze([...environmentNames].sort())
  });
}

function hostedSutCapabilityReceipt(
  capability: HostedSutSandboxCapabilityObservation
): CodexDevelopmentHostedSutSandboxReceipt['capability'] {
  const { state: ignoredState, ...receipt } = capability;
  void ignoredState;
  return Object.freeze(receipt);
}

export function hostedSutInventoryClosureFromTicket(
  ticket: CodexDevelopmentHostedActionExecutionTicket
): CodexDevelopmentHostedSutInventoryClosure {
  return Object.freeze({
    archiveDigest: ticket.preparedCandidateArchiveDigest,
    inventoryDigest: ticket.preparedCandidateInventoryDigest,
    entryCount: ticket.preparedCandidateEntryCount,
    totalFileBytes: ticket.preparedCandidateTotalFileBytes,
    dependencyClosureDigest: ticket.baseDependencyClosureDigest,
    gitBundleDigest: ticket.authenticatedGitClosureDigest
  });
}

export async function CodexDevelopmentExecuteHostedActionSut(input: Readonly<{
  resolution: CodexDevelopmentHostedActionResolution;
  ticket: CodexDevelopmentHostedActionExecutionTicket;
  candidateArchive: string;
  archiveInventory: CodexDevelopmentHostedActionArchiveInventory;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  platform?: NodeJS.Platform;
  bunExecutable?: string;
  unitNonce?: string;
  runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
  supervisor?: HostedSutSupervisor;
}>): Promise<CodexDevelopmentHostedActionRawResult> {
  const supervisor = input.supervisor;
  const selectedProcess = selectedHostedSutProcess(supervisor, input.runSandboxProcess);
  const resolution = CodexDevelopmentParseHostedActionResolution(
    encodeVerificationActionData(input.resolution)
  );
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    encodeVerificationActionData(input.ticket)
  );
  if (ticket.resolutionDigest !== resolution.resolutionDigest ||
      ticket.actionKey !== resolution.actionPlan.action.actionKey ||
      ticket.candidateSha !== resolution.artifactInput.headSha ||
      ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
    throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
  }
  const ticketInventory = hostedSutInventoryClosureFromTicket(ticket);
  if (encodeVerificationActionData(ticketInventory) !== encodeVerificationActionData(input.archiveInventory)) {
    throw new Error('Hosted Action SUT archive inventory differs from the trusted execution ticket.');
  }
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex];
  if (normalizedOperation === undefined ||
      normalizedOperation.semanticDigest !== resolution.actionPlan.action.operation.semanticDigest) {
    throw new Error('Hosted Action resolution lost its normalized operation.');
  }
  const executionAuthorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: ticket.candidateSha,
    candidateBytesDigest: ticket.candidateBytesDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: ticketInventory,
    producer: ticket.producer
  });
  const env = CodexDevelopmentHostedSutCandidateEnvironment({
    normalizedOperation,
    manifestPath: resolution.artifactInput.manifestPath
  });
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const actionKey = resolution.actionPlan.action.actionKey;
  const unitNonce = input.unitNonce ?? `${process.pid}-${startedAt.getTime()}`;
  const runSandboxProcess = selectedProcess ?? defaultHostedSutSandboxProcess;
  const capability = await CodexDevelopmentProbeHostedSutSandboxCapability({
    actionKey,
    executionAuthorization,
    bunExecutable: input.bunExecutable,
    unitNonce: `cap-${unitNonce}`.slice(0, 32),
    platform: input.platform,
    runSandboxProcess: input.runSandboxProcess, supervisor
  });
  if (capability.state !== 'supported') {
    const finishedAt = now();
    const emptyDigest = ciActionDigest('not-executed');
    const receipt = finalizeHostedSutSandboxReceipt({
      actionKey,
      capability: hostedSutCapabilityReceipt(capability),
      commandPlanDigest: null,
      authenticatedArchive: Object.freeze({
        archiveDigest: input.archiveInventory.archiveDigest,
        inventoryDigest: input.archiveInventory.inventoryDigest,
        dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
        gitBundleDigest: input.archiveInventory.gitBundleDigest,
        entryCount: input.archiveInventory.entryCount,
        totalFileBytes: input.archiveInventory.totalFileBytes
      }),
      rootIsolation: hostedSutRootIsolationReceipt(Object.keys(env)),
      execution: Object.freeze({
        lifecycle: HOSTED_SUT_NOT_ATTEMPTED_LIFECYCLE, unitName: null, exitCode: null,
        authenticatedInputDigest: null,
        postExecutionInputDigest: null,
        postExecutionReadbackErrorDigest: null,
        stdoutStderrDigest: capability.outputDigest,
        stdoutDigest: emptyDigest,
        stderrDigest: capability.outputDigest,
        stdoutBytesObserved: 0,
        stderrBytesObserved: 0,
        outputTruncated: false,
        boundedFailureTailDigest: ciActionDigest(capability.diagnostic ?? '')
      }),
      cleanup: hostedSutCleanupNotAttempted(),
      diagnostic: capability.diagnostic
    });
    return CodexDevelopmentFinalizeHostedActionRawResult({
      executionAuthorizationDigest: executionAuthorization.authorizationDigest,
      command: null,
      sandboxReceipt: receipt,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString()
    });
  }

  const candidateArchive = realpathSync.native(path.resolve(input.candidateArchive));
  const retainedArchive = retainHostedSutArchive(
    candidateArchive,
    input.archiveInventory.archiveDigest
  );
  const preExecutionArchiveDigest = retainedArchive.archiveDigest;
  try {
  const commandPlan = CodexDevelopmentBuildHostedSutSandboxCommandPlan({
    actionKey,
    candidateArchiveDigest: retainedArchive.archiveDigest,
    bunExecutable: realpathSync.native(path.resolve(input.bunExecutable ?? process.execPath)),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: ciVerificationNormalizedOperationArgv(normalizedOperation),
    candidateEnvironment: env,
    executionAuthorization,
    ...(supervisor === undefined ? {} : { dependencyPreparation: {
      schema: 'sec-hosted-sut-dependency-preparation-v1' as const,
      baseSha: normalizedOperation.candidate.baseSha, baseTreeSha: normalizedOperation.candidate.baseTreeSha,
      headSha: normalizedOperation.candidate.headSha, headTreeSha: normalizedOperation.candidate.headTreeSha,
      archiveDigest: retainedArchive.archiveDigest, inventoryDigest: input.archiveInventory.inventoryDigest,
      entryCount: input.archiveInventory.entryCount, totalFileBytes: input.archiveInventory.totalFileBytes,
      dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest, gitBundleDigest: input.archiveInventory.gitBundleDigest,
      deadlineAtUnixMs: getHostedSutSupervisorDeadlineAtUnixMs(supervisor)
    } })
  });
  const authorizedOperation = resolveCiVerificationDevRunnerTarget({
    plan: resolution.actionPlan,
    authorizedClosure: resolution.actionPlanClosure
  });
  if (authorizedOperation.semanticDigest !== normalizedOperation.semanticDigest) {
    throw new Error('Hosted SUT executor received a substituted normalized operation.');
  }
  let physical: CodexDevelopmentHostedSutSandboxProcessObservation | null = null;
  let executionObservationLost = false;
  try {
    physical = await runSandboxProcess(commandPlan, retainedArchive);
  } catch (error) {
    executionObservationLost = true;
    physical = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const exitCode = physical.code;
  const observedPhysical = physical as CodexDevelopmentHostedSutSandboxProcessObservation | null;
  if (observedPhysical === null || exitCode !== observedPhysical.code) {
    throw new Error('Hosted Action facade lost its one physical process observation.');
  }
  const processResult = observedPhysical;
  const teardownPlan = hostedSutTeardownCommandPlan({ actionKey, unitName: commandPlan.unitName });
  let teardown: CodexDevelopmentHostedSutSandboxProcessObservation;
  try {
    teardown = await runSandboxProcess(teardownPlan);
  } catch (error) {
    teardown = syntheticHostedSutSandboxProcessObservation(
      1, error instanceof Error ? error.message : String(error)
    );
  }
  const cleanup = hostedSutDirectoryCleanup(teardown);
  const lifecycleComplete = hostedSutLifecycleComplete(processResult.lifecycle);
  const cleanupComplete = hostedSutCleanupComplete(cleanup);
  let postExecutionArchiveDigest: VerificationActionKeyDigest | null = null;
  let archiveReadbackDiagnostic: string | null = null;
  try {
    postExecutionArchiveDigest = assertRetainedHostedSutArchive(retainedArchive);
    if (hostedActionFileDigest(candidateArchive) !== retainedArchive.archiveDigest) {
      throw new Error('Hosted SUT archive pathname no longer names the retained authenticated bytes.');
    }
  } catch (error) {
    archiveReadbackDiagnostic = error instanceof Error ? error.message : String(error);
  }
  const archiveStable = postExecutionArchiveDigest === preExecutionArchiveDigest;
  const sandboxInvalidated = executionObservationLost || !lifecycleComplete ||
    processResult.outputTruncated ||
    processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT ||
    processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT ||
    !cleanupComplete || !archiveStable;
  const finishedAt = now();
  const diagnostic = sandboxInvalidated
    ? hostedSutDiagnostic([
        executionObservationLost ? 'Hosted SUT physical process observation was lost.' : '',
        processResult.outputTruncated ? 'Hosted SUT physical process output was truncated.' : '',
        processResult.stdoutBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
          ? 'Hosted SUT stdout exceeded its observed byte bound.' : '',
        processResult.stderrBytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
          ? 'Hosted SUT stderr exceeded its observed byte bound.' : '',
        lifecycleComplete ? '' : 'Hosted SUT namespace, candidate start, or candidate-unit settlement was not observed.',
        cleanupComplete ? '' : `Hosted SUT directory cleanup failed: ${teardown.failureTail}`,
        archiveStable ? '' : `Hosted SUT authenticated archive readback failed: ${archiveReadbackDiagnostic ?? 'digest changed'}`
      ].filter(Boolean).join('\n'), 'Hosted SUT sandbox was invalidated.')
    : processResult.code === 0 ? null
      : hostedSutDiagnostic(processResult.failureTail, `${normalizedOperation.gateId} failed.`);
  const receipt = finalizeHostedSutSandboxReceipt({
    actionKey,
    capability: hostedSutCapabilityReceipt(capability),
    commandPlanDigest: commandPlan.physicalCommandProjectionDigest,
    authenticatedArchive: Object.freeze({
      archiveDigest: input.archiveInventory.archiveDigest,
      inventoryDigest: input.archiveInventory.inventoryDigest,
      dependencyClosureDigest: input.archiveInventory.dependencyClosureDigest,
      gitBundleDigest: input.archiveInventory.gitBundleDigest,
      entryCount: input.archiveInventory.entryCount,
      totalFileBytes: input.archiveInventory.totalFileBytes
    }),
    rootIsolation: hostedSutRootIsolationReceipt(Object.keys(env)),
    execution: Object.freeze({
      lifecycle: processResult.lifecycle,
      unitName: commandPlan.unitName,
      exitCode: processResult.code,
      authenticatedInputDigest: preExecutionArchiveDigest,
      postExecutionInputDigest: postExecutionArchiveDigest,
      postExecutionReadbackErrorDigest: archiveReadbackDiagnostic === null
        ? null : ciActionDigest(archiveReadbackDiagnostic),
      stdoutStderrDigest: processResult.rawOutputDigest as VerificationActionKeyDigest,
      stdoutDigest: processResult.stdoutDigest,
      stderrDigest: processResult.stderrDigest,
      stdoutBytesObserved: processResult.stdoutBytesObserved,
      stderrBytesObserved: processResult.stderrBytesObserved,
      outputTruncated: processResult.outputTruncated,
      boundedFailureTailDigest: ciActionDigest(processResult.failureTail)
    }),
    cleanup,
    diagnostic
  });
  return CodexDevelopmentFinalizeHostedActionRawResult({
    executionAuthorizationDigest: executionAuthorization.authorizationDigest,
    command: Object.freeze({
      commandPlanDigest: commandPlan.physicalCommandProjectionDigest!,
      executionAuthorizationDigest: commandPlan.executionAuthorizationDigest!,
      physicalCommandProjectionDigest: commandPlan.physicalCommandProjectionDigest!
    }),
    sandboxReceipt: receipt,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString()
  });
  } finally {
    closeSync(retainedArchive.fileDescriptor);
  }
}
