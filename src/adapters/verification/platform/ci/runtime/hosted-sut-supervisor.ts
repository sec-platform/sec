import type { HostedSutCommandPlan, HostedSutProcessLifecycle, HostedSutProcessObservation } from "../../../../../execution/verification/hosted.ts";
/**
 * Production inner SUT observer. The fixed Python helper is part of the same
 * authenticated source image as this module. Caller JSON, output markers and
 * injected callbacks never mint kernel lifecycle facts.
 */
import { createHash } from 'node:crypto';
import { fstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { isNativeAborted, linkNativeAbortSignals } from '../../../../../contracts/native-abort.ts';
import type { OperationRequirementBindingContext } from '../../../../../execution/operation/requirement-binding-context.ts';
import { assertSemanticOperationProjection, type BoundSemanticOperation, type OperationDigest } from '../../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../../execution/resource-settlement.ts';
import type { VerificationActionKeyDigest } from '../../../../../execution/verification/action.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../../providers/linux-verification/contract.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceRunResult,
  assertProcessResourceSession,
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSessionReceipt
} from '../../../../runtime-state/physical/runtime/process-resource-session.ts';
import { issueRetainedCommandBoundary, RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR } from '../../../../runtime-state/physical/runtime/process.ts';
import type { RetainedCommandBoundary } from '../../../../runtime-state/physical/runtime/retained-command-boundary.ts';
import { assertHostedSutSandboxCommandPlan } from '../contract/hosted-sut-command-plan.ts';
import { CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT } from '../contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from '../contract/revision.ts';
import { ciActionDigest, exactObject, HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH, type CodexDevelopmentHostedSutSandboxProcess } from '../verification-hosted-action-contract.ts';
import { assertRetainedHostedSutArchive, type CodexDevelopmentRetainedHostedSutArchive } from '../verification-materialization.ts';

const REQUEST_SCHEMA = 'sec-hosted-sut-supervisor-request-v1';
const RESPONSE_SCHEMA = 'sec-hosted-sut-supervisor-response-v1';
const HELPER_PATH = fileURLToPath(new URL('./hosted-sut-supervisor.py', import.meta.url));
const MODULE_ROOT = path.resolve(path.dirname(HELPER_PATH), '../../../../../..');
const HELPER_DESCRIPTOR = 5;
const ARCHIVE_DESCRIPTOR = 6;
const PYTHON_EXECUTABLE = `/usr/bin/python${CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.version.split('.').slice(0, 2).join('.')}`;
const TRUSTED_BUN = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_HELPER_STDERR_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 64 * 1024;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const FIXED_ENVIRONMENT = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' });

export const HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID = 'ci.hosted-sut-supervisor-process';
export const HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST = sha256({
  domain: 'sec.hosted-sut-supervisor.process-contract',
  schema: REQUEST_SCHEMA,
  responseSchema: RESPONSE_SCHEMA,
  substrate: 'linux-ptrace-exec-and-pid-namespace-init-reap',
  python: PYTHON_EXECUTABLE,
  bunExecutableDigest: TRUSTED_BUN.bunExecutableDigest,
  interpreterArguments: ['-I', '-S', '/proc/self/fd/5'],
  archiveDescriptor: ARCHIVE_DESCRIPTOR
}) as OperationDigest;

export const HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS = Object.freeze([
  Object.freeze({ resource: 'duration-ms' as const, maximum: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1000 }),
  Object.freeze({ resource: 'input-bytes' as const, maximum: 4 * MAX_REQUEST_BYTES }),
  Object.freeze({ resource: 'output-bytes' as const, maximum: 4 * (MAX_RESPONSE_BYTES + MAX_HELPER_STDERR_BYTES) }),
  // Four sequential helpers (probe, cleanup, execution, cleanup), plus their
  // original Physical owner's stdin/retained-execution transport resources.
  Object.freeze({ resource: 'processes' as const, maximum: 12 })
]);

declare const HOSTED_SUT_SUPERVISOR: unique symbol;
export type HostedSutSupervisor = Readonly<{
  readonly [HOSTED_SUT_SUPERVISOR]: true;
  readonly run: CodexDevelopmentHostedSutSandboxProcess;
  close(): ProcessResourceSessionReceipt;
}>;
const SUPERVISORS = new WeakMap<object, Readonly<{ assertLive(): void }>>();

export function assertHostedSutSupervisorLive(supervisor: HostedSutSupervisor): void {
  const state = supervisor !== null && typeof supervisor === 'object' ? SUPERVISORS.get(supervisor) : undefined;
  if (state === undefined) throw new Error('Hosted SUT requires its owner-issued production supervisor.');
  state.assertLive();
}

type StreamReport = Readonly<{
  digest: VerificationActionKeyDigest;
  bytesObserved: number;
  tailHex: string;
  eof: boolean;
}>;
type ReportBinding = Readonly<{
  operationIdentityDigest: string;
  boundAttemptDigest: string;
  deadlineAtUnixMs: number;
  stopAtUnixMs: number;
  planDigest: string;
  phase: HostedSutCommandPlan<typeof import("../verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, typeof import("../contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST>['phase'];
}>;
export type HostedSutSupervisorReport = ReportBinding & Readonly<{
  schema: typeof RESPONSE_SCHEMA;
  lifecycle: HostedSutProcessLifecycle;
  namespaceInitReaped: boolean;
  traceesReaped: boolean;
  stdout: StreamReport;
  stderr: StreamReport;
  outputTruncated: boolean;
  diagnostic: string;
}>;

function parseStream(value: unknown): StreamReport {
  const stream = exactObject(value, ['digest', 'bytesObserved', 'tailHex', 'eof'], 'Supervisor stream');
  if (typeof stream.digest !== 'string' || !DIGEST.test(stream.digest)
      || !Number.isSafeInteger(stream.bytesObserved) || Number(stream.bytesObserved) < 0
      || typeof stream.tailHex !== 'string' || stream.tailHex.length > MAX_TAIL_BYTES * 2
      || !/^(?:[0-9a-f]{2})*$/u.test(stream.tailHex)
      || stream.tailHex.length / 2 !== Math.min(Number(stream.bytesObserved), MAX_TAIL_BYTES)
      || typeof stream.eof !== 'boolean') {
    throw new Error('Supervisor stream report is invalid.');
  }
  return Object.freeze({ digest: stream.digest as VerificationActionKeyDigest,
    bytesObserved: Number(stream.bytesObserved), tailHex: stream.tailHex, eof: stream.eof });
}

/** Strict data codec only. Parsing cannot issue a live supervisor or observation. */
export function parseHostedSutSupervisorReport(source: Uint8Array, expected: ReportBinding): HostedSutSupervisorReport {
  if (source.byteLength > MAX_RESPONSE_BYTES) throw new Error('Supervisor structured output exceeds bound.');
  const value = exactObject(parseExactJsonBytes(source, 'Hosted SUT supervisor response', {
    maximumInputBytes: MAX_RESPONSE_BYTES, maximumDepth: 8
  }), [
    'schema', 'operationIdentityDigest', 'boundAttemptDigest', 'deadlineAtUnixMs', 'stopAtUnixMs',
    'planDigest', 'phase', 'lifecycle', 'namespaceInitReaped', 'traceesReaped',
    'stdout', 'stderr', 'outputTruncated', 'diagnostic'
  ], 'Supervisor report');
  if (value.schema !== RESPONSE_SCHEMA || Object.entries(expected).some(([key, entry]) => value[key] !== entry)
      || !DIGEST.test(String(value.operationIdentityDigest)) || !DIGEST.test(String(value.boundAttemptDigest))
      || !DIGEST.test(String(value.planDigest)) || !Number.isSafeInteger(value.deadlineAtUnixMs)
      || !Number.isSafeInteger(value.stopAtUnixMs) || Number(value.stopAtUnixMs) > Number(value.deadlineAtUnixMs)
      || typeof value.namespaceInitReaped !== 'boolean' || typeof value.traceesReaped !== 'boolean'
      || typeof value.outputTruncated !== 'boolean' || typeof value.diagnostic !== 'string'
      || Buffer.byteLength(value.diagnostic, 'utf8') > 4096) {
    throw new Error('Supervisor report binding or fields are invalid.');
  }
  const lifecycle = exactObject(value.lifecycle, [
    'supervisorSpawned', 'supervisorClosed', 'supervisorCloseCode', 'supervisorSignal',
    'namespaceEstablished', 'candidateStarted', 'candidateUnitSettled', 'observationGap'
  ], 'Supervisor lifecycle');
  for (const key of ['supervisorSpawned', 'supervisorClosed', 'namespaceEstablished', 'candidateStarted', 'candidateUnitSettled']) {
    if (typeof lifecycle[key] !== 'boolean' && lifecycle[key] !== null) throw new Error('Supervisor lifecycle fact invalid.');
  }
  if ((lifecycle.supervisorCloseCode !== null && (!Number.isSafeInteger(lifecycle.supervisorCloseCode)
          || Number(lifecycle.supervisorCloseCode) < 0 || Number(lifecycle.supervisorCloseCode) > 255))
      || (lifecycle.supervisorSignal !== null && (typeof lifecycle.supervisorSignal !== 'string'
          || !/^SIG[A-Z0-9]+$/u.test(lifecycle.supervisorSignal)))
      || (lifecycle.observationGap !== null && lifecycle.observationGap !== 'observation-lost')
      || lifecycle.supervisorSpawned !== true
      || (lifecycle.supervisorClosed !== true && (lifecycle.supervisorCloseCode !== null || lifecycle.supervisorSignal !== null))
      || (lifecycle.supervisorCloseCode !== null && lifecycle.supervisorSignal !== null)
      || (lifecycle.supervisorClosed === true && lifecycle.supervisorCloseCode === null && lifecycle.supervisorSignal === null)) {
    throw new Error('Supervisor terminal lifecycle is invalid.');
  }
  const stdout = parseStream(value.stdout);
  const stderr = parseStream(value.stderr);
  if (value.outputTruncated !== (stdout.bytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT
      || stderr.bytesObserved > CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT)
      || (value.namespaceInitReaped && lifecycle.namespaceEstablished !== true)
      || (lifecycle.candidateStarted === true && lifecycle.namespaceEstablished !== true)
      || (lifecycle.candidateUnitSettled === true && (lifecycle.observationGap !== null
        || lifecycle.supervisorClosed !== true || !value.traceesReaped || !stdout.eof || !stderr.eof
        || (lifecycle.namespaceEstablished === true && !value.namespaceInitReaped)))) {
    throw new Error('Supervisor report overclaims candidate-unit settlement.');
  }
  if (expected.phase === 'teardown' && (lifecycle.namespaceEstablished !== false || lifecycle.candidateStarted !== false)) {
    throw new Error('Teardown cannot issue candidate execution facts.');
  }
  return Object.freeze({ ...expected, schema: RESPONSE_SCHEMA,
    lifecycle: Object.freeze(lifecycle) as HostedSutProcessLifecycle,
    namespaceInitReaped: value.namespaceInitReaped, traceesReaped: value.traceesReaped,
    stdout, stderr, outputTruncated: value.outputTruncated, diagnostic: value.diagnostic });
}

function unknownObservation(diagnostic: string): HostedSutProcessObservation<import("./ci-orchestration-core.ts").CodexDevelopmentGateProcessResult> {
  const stdoutDigest = `sha256:${createHash('sha256').digest('hex')}` as VerificationActionKeyDigest;
  const stderrDigest = `sha256:${createHash('sha256').update(diagnostic).digest('hex')}` as VerificationActionKeyDigest;
  return Object.freeze({ code: 1, rawOutputDigest: ciActionDigest({ diagnostic }), failureTail: diagnostic,
    stdoutDigest, stderrDigest, stdoutBytesObserved: 0, stderrBytesObserved: Buffer.byteLength(diagnostic),
    outputTruncated: false, lifecycle: Object.freeze({ supervisorSpawned: null, supervisorClosed: null,
      supervisorCloseCode: null, supervisorSignal: null, namespaceEstablished: null, candidateStarted: null,
      candidateUnitSettled: null, observationGap: 'observation-lost' }) });
}

function retainFile(file: string, descriptor: number, role: 'ordinary-file' | 'executable'): RetainedNoFollowOrdinaryFile {
  return retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(file), 'Hosted SUT retained input parent'),
    path.basename(file), undefined, 'Hosted SUT retained ' + role, descriptor, role);
}

function retainArchiveProjection(archive: CodexDevelopmentRetainedHostedSutArchive): RetainedNoFollowOrdinaryFile {
  assertRetainedHostedSutArchive(archive);
  const before = fstatSync(archive.fileDescriptor, { bigint: true });
  const file = readlinkSync(`/proc/self/fd/${archive.fileDescriptor}`);
  if (!path.isAbsolute(file) || file.endsWith(' (deleted)') || before.nlink < 1n) {
    throw new Error('Hosted SUT archive has no current retained ordinary-file projection.');
  }
  const retained = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(file), 'Hosted SUT archive parent'),
    path.basename(file), { device: String(before.dev), inode: String(before.ino) },
    'Hosted SUT original archive projection', ARCHIVE_DESCRIPTOR);
  try {
    const digest = retained.digest();
    const after = fstatSync(archive.fileDescriptor, { bigint: true });
    if (retained.physical.device !== String(before.dev) || retained.physical.inode !== String(before.ino)
        || retained.size !== Number(before.size) || retained.linkCount !== Number(before.nlink)
        || digest.byteDigest !== archive.archiveDigest || before.dev !== after.dev || before.ino !== after.ino
        || before.nlink !== after.nlink || before.size !== after.size || before.mode !== after.mode
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
        || assertRetainedHostedSutArchive(archive) !== digest.byteDigest) {
      throw new Error('Hosted SUT archive projection differs from original retained identity.');
    }
    return retained;
  } catch (error) {
    settleResources({ primary: { label: 'Hosted SUT retained archive projection', error },
      cleanup: [{ label: 'Hosted SUT archive projection dispose', settle: () => retained.dispose() }] });
    throw error;
  }
}

/** One lifetime owns the aggregate budget across probe, execution and teardown. */
export function createHostedSutSupervisor(input: Readonly<{
  operation: BoundSemanticOperation;
  requirementBindingContext: OperationRequirementBindingContext;
  trustedSourceRoot: string;
  signal?: AbortSignal;
}>): HostedSutSupervisor {
  // This branch is deliberately before any file retention, process or write.
  if (process.platform !== 'linux') throw new Error('Hosted SUT kernel supervisor is unsupported on this platform.');
  assertSemanticOperationProjection(input.operation);
  if (path.resolve(input.trustedSourceRoot) !== MODULE_ROOT) {
    throw new Error('Hosted SUT source root differs from its actually loaded trusted module.');
  }
  const requirement = input.operation.plan.execution.requirements.find(({ id }) => id === HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID);
  if (requirement?.contractDigest !== HOSTED_SUT_SUPERVISOR_CONTRACT_DIGEST) {
    throw new Error('Hosted SUT supervisor requires its original bound process contract.');
  }
  const session = openProcessResourceSession({ operation: input.operation,
    requirementBindingContext: input.requirementBindingContext, signal: linkNativeAbortSignals(input.signal) });
  try {
    if (session.requirementId !== HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID) {
      throw new Error('Hosted SUT supervisor requirement context differs from its contract.');
    }
    assertProcessResourceSession(session, { semanticOperation: input.operation.plan.identity.operation,
      requirementId: HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID,
      operationIdentityDigest: input.operation.plan.identity.identityDigest, boundAttemptDigest: input.operation.boundAttemptDigest,
      maximumDurationMs: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS[0]!.maximum,
      maximumInputBytes: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS[1]!.maximum,
      maximumOutputBytes: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS[2]!.maximum,
      maximumProcesses: HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS[3]!.maximum });
  } catch (error) {
    settleResources({ primary: { label: 'Hosted SUT supervisor admission', error },
      cleanup: [{ label: 'Hosted SUT process session close', settle: () => { session.close(); } }] });
    throw error;
  }
  let active = false;
  let closed = false;
  let receipt: ProcessResourceSessionReceipt | null = null;
  const invocations: Array<Readonly<{ run: ProcessResourceRunResult; boundary: RetainedCommandBoundary;
    args: readonly string[]; request: Uint8Array }>> = [];
  const assertLive = (): void => {
    if (closed || isNativeAborted(session.signal) || Date.now() >= session.deadlineAtUnixMs
        || performance.now() >= session.deadlineAtMonotonicMs) {
      throw new Error('Hosted SUT supervisor is closed, cancelled or past its original deadline.');
    }
  };
  const run: CodexDevelopmentHostedSutSandboxProcess = async (plan, archive) => {
    assertLive();
    if (active) throw new Error('Hosted SUT supervisor cannot admit overlapping plans.');
    assertHostedSutSandboxCommandPlan(plan);
    const consumesArchive = plan.phase === 'execute' || plan.phase === 'bootstrap-execute';
    if (consumesArchive !== (archive !== undefined)) throw new Error('Hosted SUT plan archive presence mismatch.');
    if (archive !== undefined && (assertRetainedHostedSutArchive(archive) !== archive.archiveDigest
        || plan.argv.filter((entry) => entry === HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH).length !== 1
        || plan.argv.filter((entry) => entry === archive.archiveDigest).length !== 1)) {
      throw new Error('Hosted SUT plan differs from original retained archive.');
    }
    if (plan.phase !== 'teardown' && plan.argv[plan.phase === 'capability-self-test' ? 10 : 12] !== TRUSTED_BUN.bunExecutablePath) {
      throw new Error('Hosted SUT Bun locator differs from original trusted runtime authority.');
    }
    active = true;
    const retained: Array<RetainedNoFollowOrdinaryFile | RetainedNoFollowChildProcessDirectory> = [];
    let primary: { label: string; error: unknown } | undefined;
    let observation: HostedSutProcessObservation<import("./ci-orchestration-core.ts").CodexDevelopmentGateProcessResult> | undefined;
    try {
      const executable = retainFile(PYTHON_EXECUTABLE,
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'executable');
      retained.push(executable);
      const workingDirectory = retainNoFollowDirectoryForChildProcess(
        inspectNoFollowDirectoryChain(MODULE_ROOT, 'Hosted SUT trusted source root'),
        RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, 'Hosted SUT trusted source root');
      retained.push(workingDirectory);
      const helper = retainFile(HELPER_PATH, HELPER_DESCRIPTOR, 'ordinary-file');
      retained.push(helper);
      const archiveProjection = archive === undefined ? undefined : retainArchiveProjection(archive);
      if (archiveProjection !== undefined) retained.push(archiveProjection);
      const boundary = issueRetainedCommandBoundary({ executable, workingDirectory,
        auxiliaryInputs: [{ kind: 'ordinary-file', capability: helper },
          ...(archiveProjection === undefined ? [] : [{ kind: 'ordinary-file' as const, capability: archiveProjection }])] });
      const expected: ReportBinding = Object.freeze({ operationIdentityDigest: session.operationIdentityDigest,
        boundAttemptDigest: session.boundAttemptDigest, deadlineAtUnixMs: session.deadlineAtUnixMs,
        stopAtUnixMs: session.cooperativeDeadlineAtUnixMs(), planDigest: plan.planDigest, phase: plan.phase });
      const request = Buffer.from(JSON.stringify({ schema: REQUEST_SCHEMA,
        operationIdentityDigest: expected.operationIdentityDigest, boundAttemptDigest: expected.boundAttemptDigest,
        deadlineAtUnixMs: expected.deadlineAtUnixMs, stopAtUnixMs: expected.stopAtUnixMs,
        plan, archiveDescriptor: consumesArchive ? ARCHIVE_DESCRIPTOR : null,
        bunExecutableDigest: TRUSTED_BUN.bunExecutableDigest }), 'utf8');
      if (request.byteLength > MAX_REQUEST_BYTES) throw new Error('Hosted SUT plan exceeds input bound.');
      const args = Object.freeze(['-I', '-S', helper.childPath]);
      const result = await session.run(boundary, args, { input: request, env: FIXED_ENVIRONMENT, envMode: 'replace',
        maxStdinBytes: request.byteLength, maxStdoutBytes: MAX_RESPONSE_BYTES, maxStderrBytes: MAX_HELPER_STDERR_BYTES });
      invocations.push(Object.freeze({ run: result, boundary, args, request }));
      if (archive !== undefined) assertRetainedHostedSutArchive(archive);
      if (result.result.code !== 0) {
        observation = unknownObservation(('Trusted supervisor did not return a complete control record.\n'
          + result.result.stderr).slice(0, 4096));
      } else {
      const report = parseHostedSutSupervisorReport(result.result.stdout, expected);
      const failureTail = [report.diagnostic, Buffer.from(report.stdout.tailHex, 'hex').toString('utf8'),
        Buffer.from(report.stderr.tailHex, 'hex').toString('utf8')].filter(Boolean).join('\n');
      observation = Object.freeze({ code: report.outputTruncated ? 125 : report.lifecycle.observationGap !== null ? 1
        : report.lifecycle.supervisorCloseCode ?? 1,
      rawOutputDigest: ciActionDigest(report), failureTail,
      stdoutDigest: report.stdout.digest, stderrDigest: report.stderr.digest,
      stdoutBytesObserved: report.stdout.bytesObserved, stderrBytesObserved: report.stderr.bytesObserved,
      outputTruncated: report.outputTruncated, lifecycle: report.lifecycle });
      }
    } catch (error) {
      primary = { label: 'Hosted SUT supervisor execution', error };
    }
    try {
      settleResources({ ...(primary === undefined ? {} : { primary }), cleanup: retained.reverse().map((resource) => ({
        label: 'Hosted SUT retained boundary dispose', settle: () => resource.dispose()
      })) });
    } catch (error) {
      // The original settlement owner preserves primary (including undefined)
      // and every cleanup failure. Presentation never changes its proof state.
      const failures: readonly unknown[] = error instanceof AggregateError ? error.errors : [error];
      observation = unknownObservation(failures.map((failure) => failure instanceof Error
        ? failure.message : String(failure)).join('\n').slice(0, 4096));
    } finally {
      active = false;
    }
    return observation ?? unknownObservation('Trusted supervisor observation lost.');
  };
  const supervisor = Object.freeze({ run,
    close(): ProcessResourceSessionReceipt {
      if (active) throw new Error('Hosted SUT supervisor cannot close an active call.');
      if (receipt !== null) return receipt;
      closed = true;
      const terminal = session.close();
      for (const invocation of invocations) {
        assertProcessResourceRunResult(invocation.run, terminal, {
          operationIdentityDigest: session.operationIdentityDigest, boundAttemptDigest: session.boundAttemptDigest,
          requirementId: HOSTED_SUT_SUPERVISOR_REQUIREMENT_ID, boundary: invocation.boundary,
          args: invocation.args, input: invocation.request, env: FIXED_ENVIRONMENT, envMode: 'replace'
        });
      }
      receipt = terminal;
      return terminal;
    }
  });
  SUPERVISORS.set(supervisor, Object.freeze({ assertLive }));
  return supervisor as HostedSutSupervisor;
}

