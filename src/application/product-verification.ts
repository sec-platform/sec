import type { AcceptanceCoverageReport } from '../assurance/acceptance/coverage.ts';
import type { CanonicalVerificationArtifactSet } from '../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  shouldExecuteRuntimeVerification,
  verificationLaneProfile,
  type VerificationRuntimeMode
} from '../assurance/verification/contract/lanes.ts';
import type {
  FastVerificationLaneReport,
  RuntimeVerificationLaneReport,
  VerificationLane,
  VerificationReport
} from '../assurance/verification/contract/types.ts';
import {
  buildProductVerificationReport,
  createSkippedFastLane,
  createSkippedPolicyReport,
  createSkippedRuntimeLane,
  productVerificationSubjectRevision
} from '../assurance/verification/project/report.ts';
import {
  buildProductVerificationObservationBindings,
  type ProductVerificationGateObservation,
  type ProductVerificationObservations
} from '../assurance/verification/profile/contract/product.ts';
import { throwIfNativeAborted } from '../contracts/native-abort.ts';
import type { LockFile } from '../compiler/contract.ts';
import { addGeneratedPaths, assertPassStatus } from '../compiler/contract/lock-schema.ts';
import { CompilerError } from '../compiler/errors.ts';
import type { PipelineExecutionBoundary } from '../compiler/pipeline/execution-boundaries.ts';
import { observeOptionalDiagnostic } from '../execution/optional-diagnostic.ts';
import type { PolicyReport } from '../semantics/policies/types.ts';

export type ProductVerificationFastResult = Readonly<{
  lane: FastVerificationLaneReport;
  failure?: Readonly<{ reason: unknown }>;
}>;

export type ProductVerificationArtifactSet = Readonly<{
  verificationReport: VerificationReport;
  runtimeReport: RuntimeVerificationLaneReport;
  policyReport: PolicyReport;
  acceptanceCoverage: AcceptanceCoverageReport;
}>;

export interface ProductVerificationExecutionOptions<StagedProof> {
  readonly emitTiming: boolean | undefined;
  readonly isolated: boolean;
  readonly signal: AbortSignal | undefined;
  readonly stagedVerificationProof: StagedProof | undefined;
}

export interface ProductVerificationOperations<StagedProof> {
  now(): number;
  beforeCommit(): Promise<void>;
  emitBoundary(
    boundary: Extract<PipelineExecutionBoundary, `verify-${string}`>
  ): Promise<void>;
  preflight(): Promise<void>;
  prepareIsolated(input: Readonly<{
    beforeCommit: () => Promise<void>;
    signal: AbortSignal | undefined;
  }>): Promise<void>;
  consumeStagedProof(proof: StagedProof): Promise<CanonicalVerificationArtifactSet>;
  assertStagedLiveContext(
    artifacts: CanonicalVerificationArtifactSet
  ): Promise<void>;
  revalidateStagedProof(proof: StagedProof): Promise<void>;
  runFast(input: Readonly<{
    beforeCommit: () => Promise<void>;
    isolated: boolean;
    signal?: AbortSignal;
  }>): Promise<ProductVerificationFastResult>;
  runRuntime(
    mode: VerificationRuntimeMode,
    input: Readonly<{
      beforeCommit: () => Promise<void>;
      emitTiming: boolean | undefined;
      isolated: boolean;
      signal: AbortSignal | undefined;
    }>
  ): Promise<RuntimeVerificationLaneReport>;
  buildCoverage(
    runtime: RuntimeVerificationLaneReport,
    fast: FastVerificationLaneReport
  ): Promise<AcceptanceCoverageReport>;
  captureObservation(
    binding: ProductVerificationGateObservation,
    status: 'passed' | 'failed' | 'skipped',
    output: unknown,
    startedAtMs: number,
    finishedAtMs: number
  ): ProductVerificationGateObservation;
  publishArtifacts(
    lock: LockFile,
    artifacts: ProductVerificationArtifactSet,
    beforeCommit: () => Promise<void>
  ): Promise<ProductVerificationArtifactSet>;
  reportFailure?(report: VerificationReport): unknown;
}

function applyVerificationReportToLock(
  lock: LockFile,
  report: VerificationReport
): void {
  addGeneratedPaths(lock, [
    CI_ARTIFACT_FILES.verificationReport,
    CI_ARTIFACT_FILES.runtimeReport,
    CI_ARTIFACT_FILES.policyReport,
    CI_ARTIFACT_FILES.acceptanceCoverage
  ]);
  if (verificationLaneProfile(report.summary.requestedLane).scope === 'complete') {
    lock.passStatus.verify = report.summary.status === 'passed'
      ? 'succeeded'
      : 'failed';
    return;
  }
  lock.passStatus.verify = report.summary.status === 'failed'
    ? 'failed'
    : 'pending';
}

function verificationFailure(
  report: VerificationReport,
  fastFailure: unknown | undefined
): CompilerError {
  return new CompilerError(
    'VERIFY-ACCEPTANCE-003',
    'Project verification failed',
    { verificationReport: report },
    fastFailure === undefined ? undefined : { cause: fastFailure }
  );
}

function requireTimestamp(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be finite`);
  }
  return value;
}

/**
 * Own one Product Verification use-case from an already selected Lock and lane.
 * Host execution, staged-proof storage, project reads, artifact publication,
 * time and diagnostics are injected; application owns ordering and terminal
 * decisions.
 */
export async function executeProductVerification<StagedProof>(
  lock: LockFile,
  lane: VerificationLane,
  options: ProductVerificationExecutionOptions<StagedProof>,
  operations: ProductVerificationOperations<StagedProof>
): Promise<VerificationReport> {
  const {
    now,
    beforeCommit: ownerBeforeCommit,
    emitBoundary,
    preflight,
    prepareIsolated,
    consumeStagedProof,
    assertStagedLiveContext,
    revalidateStagedProof,
    runFast,
    runRuntime,
    buildCoverage,
    captureObservation,
    publishArtifacts,
    reportFailure
  } = operations;
  const required = [
    now,
    ownerBeforeCommit,
    emitBoundary,
    preflight,
    prepareIsolated,
    consumeStagedProof,
    assertStagedLiveContext,
    revalidateStagedProof,
    runFast,
    runRuntime,
    buildCoverage,
    captureObservation,
    publishArtifacts
  ];
  if (required.some(operation => typeof operation !== 'function') ||
      (reportFailure !== undefined && typeof reportFailure !== 'function')) {
    throw new TypeError('Product Verification operations must be callable');
  }

  const selection = verificationLaneProfile(lane);
  const subjectRevision = productVerificationSubjectRevision(lock);
  const assertSubjectCurrent = (): void => {
    throwIfNativeAborted(options.signal);
    if (productVerificationSubjectRevision(lock) !== subjectRevision) {
      throw new CompilerError(
        'VERIFY-SUBJECT-001',
        'Verification subject changed after invocation admission'
      );
    }
  };
  const beforeCommit = async (): Promise<void> => {
    assertSubjectCurrent();
    await Reflect.apply(ownerBeforeCommit, operations, []);
    assertSubjectCurrent();
  };
  const boundary = async (
    name: Extract<PipelineExecutionBoundary, `verify-${string}`>
  ): Promise<void> => {
    assertSubjectCurrent();
    await Reflect.apply(emitBoundary, operations, [name]);
    assertSubjectCurrent();
  };

  if (options.stagedVerificationProof !== undefined &&
      (options.isolated || selection.scope !== 'complete')) {
    throw new Error(
      'Staged Verification proof is restricted to one live all-lane rebuild'
    );
  }
  assertPassStatus(
    lock,
    'compose',
    'succeeded',
    new CompilerError(
      'VERIFY-BLOCKED-001',
      'compose must succeed before verify'
    )
  );

  await boundary('verify-preflight');
  await Reflect.apply(preflight, operations, []);
  assertSubjectCurrent();
  if (options.isolated) {
    await Reflect.apply(prepareIsolated, operations, [{
      beforeCommit,
      signal: options.signal
    }]);
  }

  if (options.stagedVerificationProof !== undefined) {
    await beforeCommit();
    const artifacts = await Reflect.apply(consumeStagedProof, operations, [
      options.stagedVerificationProof
    ]);
    await beforeCommit();
    await Reflect.apply(assertStagedLiveContext, operations, [artifacts]);
    await beforeCommit();
    applyVerificationReportToLock(lock, artifacts.verificationReport);
    await boundary('verify-artifact-publish');
    const published = await Reflect.apply(publishArtifacts, operations, [
      lock,
      artifacts,
      beforeCommit
    ]);
    await Reflect.apply(revalidateStagedProof, operations, [
      options.stagedVerificationProof
    ]);
    await Reflect.apply(assertStagedLiveContext, operations, [artifacts]);
    await beforeCommit();
    return published.verificationReport;
  }

  const fastStartedAtMs = requireTimestamp(
    Reflect.apply(now, operations, []),
    'Fast Verification start time'
  );
  const fastResult: ProductVerificationFastResult = !selection.runFast
    ? Object.freeze({ lane: createSkippedFastLane() })
    : await (async () => {
        await boundary('verify-fast');
        return Reflect.apply(runFast, operations, [{
          beforeCommit,
          isolated: options.isolated,
          signal: options.signal
        }]);
      })();
  const fastFinishedAtMs = requireTimestamp(
    Reflect.apply(now, operations, []),
    'Fast Verification finish time'
  );

  const runtimeMode = selection.runtimeMode;
  const runtimeStartedAtMs = requireTimestamp(
    Reflect.apply(now, operations, []),
    'Runtime Verification start time'
  );
  const runtimeLane = shouldExecuteRuntimeVerification(
    selection,
    fastResult.lane.status === 'passed'
  )
    ? await (async () => {
        await boundary('verify-runtime');
        return Reflect.apply(runRuntime, operations, [runtimeMode, {
          beforeCommit,
          emitTiming: options.emitTiming,
          isolated: options.isolated,
          signal: options.signal
        }]);
      })()
    : createSkippedRuntimeLane();
  const runtimeFinishedAtMs = requireTimestamp(
    Reflect.apply(now, operations, []),
    'Runtime Verification finish time'
  );

  const policyReport = fastResult.lane.policyReport ?? createSkippedPolicyReport();
  const coverage = await Reflect.apply(buildCoverage, operations, [
    runtimeLane,
    fastResult.lane
  ]);
  assertSubjectCurrent();

  const observationBindings = buildProductVerificationObservationBindings(
    subjectRevision,
    lane,
    runtimeMode
  );
  const observations: ProductVerificationObservations = {
    fast: Reflect.apply(captureObservation, operations, [
      observationBindings.fast,
      fastResult.lane.status,
      fastResult.lane,
      fastStartedAtMs,
      fastFinishedAtMs
    ]),
    runtime: Reflect.apply(captureObservation, operations, [
      observationBindings.runtime,
      runtimeLane.status,
      runtimeLane,
      runtimeStartedAtMs,
      runtimeFinishedAtMs
    ]),
    policy: Reflect.apply(captureObservation, operations, [
      observationBindings.policy,
      policyReport.status,
      policyReport,
      fastStartedAtMs,
      fastFinishedAtMs
    ])
  };
  const report = buildProductVerificationReport({
    lane,
    fast: fastResult.lane,
    runtime: runtimeLane,
    runtimeMode,
    policyReport,
    acceptanceCoverage: coverage,
    observations
  });
  applyVerificationReportToLock(lock, report);

  const primaryFailure = (): CompilerError => verificationFailure(
    report,
    fastResult.failure?.reason
  );
  let published: ProductVerificationArtifactSet;
  try {
    if (report.summary.status === 'passed') {
      await boundary('verify-artifact-publish');
    }
    await beforeCommit();
    published = await Reflect.apply(publishArtifacts, operations, [
      lock,
      {
        verificationReport: report,
        runtimeReport: runtimeLane,
        policyReport,
        acceptanceCoverage: coverage
      },
      beforeCommit
    ]);
  } catch (publicationFailure) {
    if (report.summary.status !== 'failed') throw publicationFailure;
    const primary = primaryFailure();
    throw new AggregateError(
      [primary, publicationFailure],
      'Verification failed and report publication did not complete',
      { cause: primary }
    );
  }

  if (report.summary.status === 'failed') {
    if (reportFailure !== undefined) {
      observeOptionalDiagnostic(() =>
        Reflect.apply(reportFailure, operations, [published.verificationReport])
      );
    }
    throw verificationFailure(
      published.verificationReport,
      fastResult.failure?.reason
    );
  }

  assertSubjectCurrent();
  return published.verificationReport;
}
