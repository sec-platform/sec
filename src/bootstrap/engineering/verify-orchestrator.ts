import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationLane, VerificationReport } from '../../assurance/verification/contract/types.ts';
import { buildBlockedVerificationReport } from '../../assurance/verification/contract/blocked-report.ts';
import { ProjectIntegrityError } from '../../workspace/contract/project-integrity.ts';
import { assertWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { formatCompilerFailure } from '../../compiler/errors.ts';
import { addGeneratedPaths } from "../../compiler/contract/lock-schema.ts";
import { readLockFile } from "../../adapters/workspace/lock.ts";
import { executePipelineStage } from '../../adapters/compilation/pipeline/kernel.ts';
import { settlePipelineFailure } from '../../adapters/compilation/pipeline/failure.ts';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';
import { buildAcceptanceCoverage } from '../../adapters/verification/build-acceptance-coverage.ts';
import { runPolicyGate } from '../../adapters/verification/run-policy-gate.ts';
import { createSkippedRuntimeLane } from '../../adapters/verification/run-runtime-verification.ts';
import {
  type StagedVerificationProof
} from '../../adapters/verification/staged-verification-proof.ts';
import { publishVerificationArtifactSet } from '../../adapters/verification/verification-artifact-publication.ts';
import {
  productVerificationObservationBindings,
  verifyProject
} from '../../adapters/verification/verify-project.ts';
import {
  assertIsolatedVerificationCapability,
  type IsolatedVerificationCapability
} from '../../execution/isolated-verification-capability.ts';
export type { StagedVerificationProof };

export interface VerifyWorkspaceOptions {
  readonly emitTiming?: boolean;
  readonly isolatedVerificationCapability?: IsolatedVerificationCapability;
  readonly lane?: VerificationLane;
  readonly signal?: AbortSignal;
  readonly stagedVerificationProof?: StagedVerificationProof;
}

async function writeBlockedVerificationSnapshot(
  workspaceRoot: string,
  lock: LockFile,
  lane: Exclude<VerificationLane, 'runtime'>,
  failure: unknown,
  beforeCommit: () => Promise<void>
): Promise<void> {
  const policyReport = await runPolicyGate(workspaceRoot);
  const runtime = createSkippedRuntimeLane();
  const message = formatCompilerFailure(failure);
  const report = buildBlockedVerificationReport({
    lane, policyReport, runtime, message,
    observations: productVerificationObservationBindings(lock, lane, 'service')
  });
  const coverage = await buildAcceptanceCoverage(workspaceRoot, lock, runtime, report.fast);

  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  lock.passStatus.verify = 'failed';

  await publishVerificationArtifactSet({
    workspaceRoot,
    lock,
    artifacts: {
      verificationReport: report,
      runtimeReport: runtime,
      policyReport,
      acceptanceCoverage: coverage
    },
    commitFence: beforeCommit
  });
}

async function verifyWorkspaceCore(
  workspaceRoot: string,
  options: VerifyWorkspaceOptions,
  context: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = readLockFile(workspaceRoot);
  const lane = options.lane ?? 'all';
  const isolated = options.isolatedVerificationCapability !== undefined;
  if (isolated) {
    assertIsolatedVerificationCapability(workspaceRoot, options.isolatedVerificationCapability);
  }
  const beforeCommit = () => assertWorkspaceWriteLease(workspaceRoot, context.workspaceWriteLease);
  try {
    const report = await verifyProject(workspaceRoot, lock, lane, {
      emitTiming: isolated ? false : options.emitTiming,
      isolated,
      beforeCommit,
      ...(context.onEvent
        ? { pipelineObserver: { onEvent: context.onEvent, transactionId: context.transactionId } }
        : {}),
      signal: options.signal,
      ...(options.stagedVerificationProof
        ? { stagedVerificationProof: options.stagedVerificationProof }
        : {}),
      ...(isolated
        ? {
            stagingTreeOptions: {
              workspaceWriteLease: context.workspaceWriteLease
            }
          }
        : {})
    });
    return { lock, report };
  } catch (error) {
    if (lane !== 'runtime' && error instanceof ProjectIntegrityError) {
      return settlePipelineFailure(error, [{
        operation: 'verification-blocked-snapshot',
        run: () => writeBlockedVerificationSnapshot(workspaceRoot, lock, lane, error, beforeCommit)
      }]);
    }
    throw error;
  }
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: VerifyWorkspaceOptions = {},
  context?: PipelineExecutionContext
): Promise<{ lock: LockFile; report: VerificationReport }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const { isolatedVerificationCapability, lane, signal, stagedVerificationProof } = options;
  // Capture request values, not new authority. Capability owners still admit
  // the original references; an AbortSignal must remain live rather than cloned.
  options = Object.freeze({
    isolatedVerificationCapability, lane, signal, stagedVerificationProof,
    emitTiming: isolatedVerificationCapability === undefined ? options.emitTiming : undefined
  });
  return executePipelineStage(
    workspaceRoot,
    'verify',
    context,
    (stageContext) => verifyWorkspaceCore(workspaceRoot, options, stageContext),
    {
      extractLock: (result) => result.lock,
      preserveOwnedPassStates: true
    }
  );
}
