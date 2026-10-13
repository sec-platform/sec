import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { failureMessage } from '../../../../contracts/failure-inspection.ts';
import type { VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import type { HostedActionExecutionTicket, HostedSutInventory, HostedSutProcessObservation, HostedSutSandboxReceipt } from '../../../../execution/verification/hosted.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, CodexDevelopmentParseHostedSutSandboxReceipt } from './contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from './contract/revision.ts';
import { ciActionDigest } from './verification-hosted-action-contract.ts';

export function observeHostedSutSandboxChild(
  child: ChildProcess
): Promise<HostedSutProcessObservation<import("./runtime/ci-orchestration-core.ts").CodexDevelopmentGateProcessResult>> {
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
      observe('stderr', Buffer.from(failureMessage(error)));
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

export function syntheticHostedSutSandboxProcessObservation(
  code: number,
  diagnostic: string
): HostedSutProcessObservation<import("./runtime/ci-orchestration-core.ts").CodexDevelopmentGateProcessResult> {
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

export function finalizeHostedSutSandboxReceipt(input: Omit<
  HostedSutSandboxReceipt<typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("./contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>,
  'schema' | 'policyDigest' | 'resources' | 'receiptDigest'
>): HostedSutSandboxReceipt<typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("./contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA> {
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

export function hostedSutRootIsolationReceipt(environmentNames: readonly string[]):
HostedSutSandboxReceipt<typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("./contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("./contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>['rootIsolation'] {
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

export function hostedSutInventoryClosureFromTicket(
  ticket: HostedActionExecutionTicket<import("./contract/evidence.ts").CodexDevelopmentVerificationActionArtifactProducer, typeof import("./verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA>
): HostedSutInventory {
  return Object.freeze({
    archiveDigest: ticket.preparedCandidateArchiveDigest,
    inventoryDigest: ticket.preparedCandidateInventoryDigest,
    entryCount: ticket.preparedCandidateEntryCount,
    totalFileBytes: ticket.preparedCandidateTotalFileBytes,
    dependencyClosureDigest: ticket.baseDependencyClosureDigest,
    gitBundleDigest: ticket.authenticatedGitClosureDigest
  });
}
