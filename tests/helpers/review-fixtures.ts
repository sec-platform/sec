import { buildReviewSummary } from '../../platform/compiler/emit/write-review-summary.ts';
import { SUPPORTED_STACK } from '../../platform/shared/constants.ts';
import type {
  AcceptanceCoverageReport,
  LockFile,
  ProvenanceFile,
  ReviewProvenanceRegistrySummary,
  ReviewSummary,
  VerificationReport
} from '../../platform/shared/types.ts';
import { emptyVerificationLogs } from './verification-fixtures.ts';
import { withTempWorkspace } from './workspace-fixtures.ts';

export function buildOfficialRegistrySummary(paths: string[]): ReviewProvenanceRegistrySummary {
  return {
    registrySourceId: 'official',
    registryKind: 'official',
    registryLocation: 'compiler',
    count: paths.length,
    paths
  };
}

type ReviewLockOptions = Partial<Omit<LockFile, 'app' | 'passStatus'>> & {
  app?: Partial<LockFile['app']>;
  passStatus?: Partial<LockFile['passStatus']>;
};

export function buildReviewLock(options: ReviewLockOptions = {}): LockFile {
  const base: LockFile = {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'succeeded',
      repair: 'skipped',
      lock: 'pending',
      emit: 'pending'
    }
  };

  return {
    ...base,
    ...options,
    app: { ...base.app, ...options.app },
    passStatus: { ...base.passStatus, ...options.passStatus }
  };
}

export function buildReviewProvenance(artifacts: ProvenanceFile['artifacts'] = []): ProvenanceFile {
  return {
    formatVersion: '1',
    artifacts
  };
}

export function buildPassingReviewCoverage(options: Partial<AcceptanceCoverageReport> = {}): AcceptanceCoverageReport {
  return {
    formatVersion: '1',
    status: 'passed',
    acceptancePassed: [],
    blocks: [],
    slots: [],
    uncoveredBlocks: [],
    uncoveredSlots: [],
    ...options
  };
}

type RuntimeVerificationReportOptions = Partial<
  Omit<VerificationReport['runtime'], 'build' | 'unit' | 'acceptance' | 'logs'>
> & {
  build?: Partial<VerificationReport['runtime']['build']>;
  unit?: Partial<VerificationReport['runtime']['unit']>;
  acceptance?: Partial<VerificationReport['runtime']['acceptance']>;
  logs?: VerificationReport['runtime']['logs'];
};

type ReviewReportOptions = Partial<Omit<VerificationReport, 'fast' | 'runtime' | 'summary'>> & {
  fast?: Partial<VerificationReport['fast']>;
  runtime?: Partial<VerificationReport['runtime']>;
  summary?: Partial<VerificationReport['summary']>;
};

export function buildRuntimeVerificationReport(
  options: RuntimeVerificationReportOptions = {}
): VerificationReport['runtime'] {
  const base: VerificationReport['runtime'] = {
    status: 'passed',
    build: { status: 'passed', passed: [], failed: [], command: 'npm run build' },
    unit: { status: 'passed', passed: [], failed: [], command: 'npm run test:unit' },
    acceptance: { status: 'passed', passed: [], failed: [], command: 'npm run test:acceptance' },
    logs: emptyVerificationLogs()
  };

  return {
    ...base,
    ...options,
    build: { ...base.build, ...options.build },
    unit: { ...base.unit, ...options.unit },
    acceptance: { ...base.acceptance, ...options.acceptance },
    logs: options.logs ?? base.logs
  };
}

export type ReviewInputsOptions = {
  lock?: ReviewLockOptions;
  provenance?: ProvenanceFile['artifacts'];
  report?: ReviewReportOptions;
  coverage?: Partial<AcceptanceCoverageReport>;
};

export type ReviewInputs = {
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  coverage: AcceptanceCoverageReport;
};

export function buildPassingReviewReport(options: ReviewReportOptions = {}): VerificationReport {
  const base: VerificationReport = {
    build: { status: 'passed' },
    unit: { status: 'passed', passed: [] },
    acceptance: { status: 'passed', passed: [], failed: [] },
    policy: { status: 'passed', violations: [] },
    fast: {
      status: 'passed',
      build: { status: 'passed' },
      unit: { status: 'passed', passed: [] },
      acceptance: { status: 'passed', passed: [], failed: [] },
      policy: { status: 'passed', violations: [] },
      logs: emptyVerificationLogs()
    },
    runtime: {
      status: 'skipped',
      build: { status: 'skipped', passed: [], failed: [], command: 'npm run build' },
      unit: { status: 'skipped', passed: [], failed: [], command: 'npm run test:unit' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: 'npm run test:acceptance' },
      logs: emptyVerificationLogs()
    },
    summary: {
      status: 'passed',
      requestedLane: 'fast',
      failedLanes: []
    },
    logs: emptyVerificationLogs()
  };

  return {
    ...base,
    ...options,
    fast: { ...base.fast, ...options.fast },
    runtime: { ...base.runtime, ...options.runtime },
    summary: { ...base.summary, ...options.summary },
    logs: options.logs ?? base.logs
  };
}

export function buildReviewInputs(options: ReviewInputsOptions = {}): ReviewInputs {
  return {
    lock: buildReviewLock(options.lock),
    provenance: buildReviewProvenance(options.provenance),
    report: buildPassingReviewReport(options.report),
    coverage: buildPassingReviewCoverage(options.coverage)
  };
}

export async function buildReviewSummaryFromInputs(
  workspaceRoot: string,
  options: ReviewInputsOptions = {}
): Promise<ReviewSummary> {
  const { lock, provenance, report, coverage } = buildReviewInputs(options);
  return buildReviewSummary(workspaceRoot, lock, provenance, report, coverage);
}

export async function buildReviewSummaryInTempWorkspace(
  options: ReviewInputsOptions = {},
  setup?: (workspaceRoot: string) => Promise<void>
): Promise<ReviewSummary> {
  return withTempWorkspace(async (workspaceRoot) => {
    await setup?.(workspaceRoot);
    return buildReviewSummaryFromInputs(workspaceRoot, options);
  });
}
