import { deepFreeze } from '../../../../contracts/canonical.ts';

export const DEVELOPMENT_PERFORMANCE_SCENARIO_CATALOG_REVISION =
  'development-performance-scenario-v1' as const;

export type DevelopmentPerformanceMetricKind = 'count' | 'duration-ms';

export interface DevelopmentPerformanceMetricDefinitionV1 {
  readonly id: string;
  readonly kind: DevelopmentPerformanceMetricKind;
  /** Describes the upstream observation family; it does not transfer authority here. */
  readonly sourceClass:
    | 'action-journal'
    | 'control-observation'
    | 'process-provider'
    | 'verification-session'
    | 'settlement';
  readonly meaning: string;
}

export interface DevelopmentPerformanceScenarioV1 {
  readonly schema: 'sec-development-performance-scenario-v1';
  readonly revision: typeof DEVELOPMENT_PERFORMANCE_SCENARIO_CATALOG_REVISION;
  readonly scenarioId: 'development-closeout-v1';
  readonly goal: string;
  /** Ordered semantic stages. A sample may mark a stage unsupported/unknown but cannot silently omit it. */
  readonly stages: readonly string[];
  /**
   * Sample-time exact bindings required by #316. Values belong to the sample/Evidence producer,
   * not this descriptive catalog.
   */
  readonly requiredSampleBindings: readonly string[];
  readonly metrics: readonly DevelopmentPerformanceMetricDefinitionV1[];
}

const DEVELOPMENT_CLOSEOUT_METRICS: readonly DevelopmentPerformanceMetricDefinitionV1[] =
  deepFreeze([
    {
      id: 'action-executed-count',
      kind: 'count',
      sourceClass: 'action-journal',
      meaning: 'Required ActionKeys that physically execute because their owner state is missing or stale.'
    },
    {
      id: 'action-reused-pass-count',
      kind: 'count',
      sourceClass: 'action-journal',
      meaning: 'Required ActionKeys satisfied by one fresh owner-recorded passing terminal.'
    },
    {
      id: 'action-reused-failure-count',
      kind: 'count',
      sourceClass: 'action-journal',
      meaning: 'Required ActionKeys that reuse one fresh owner-recorded failure without converting it to PASS.'
    },
    {
      id: 'action-joined-count',
      kind: 'count',
      sourceClass: 'action-journal',
      meaning: 'Required ActionKeys joined to an authenticated in-flight owner execution.'
    },
    {
      id: 'action-invalidated-count',
      kind: 'count',
      sourceClass: 'action-journal',
      meaning: 'Previously reusable Action observations invalidated by a material identity or dependency change.'
    },
    {
      id: 'duplicate-physical-start-count',
      kind: 'count',
      sourceClass: 'action-journal',
      meaning: 'Additional physical starts for one otherwise equivalent live ActionKey; correctness target is zero, not a permanent timing threshold.'
    },
    {
      id: 'duplicate-owner-observation-count',
      kind: 'count',
      sourceClass: 'control-observation',
      meaning: 'Repeated production of the same exact owner observation within one operation/session when a shared immutable observation could have been reused.'
    },
    {
      id: 'github-observation-call-count',
      kind: 'count',
      sourceClass: 'control-observation',
      meaning: 'GitHub observation calls attributable to the measured development operation.'
    },
    {
      id: 'github-observation-page-count',
      kind: 'count',
      sourceClass: 'control-observation',
      meaning: 'GitHub pagination pages consumed by the measured development operation.'
    },
    {
      id: 'process-start-count',
      kind: 'count',
      sourceClass: 'process-provider',
      meaning: 'Physical child-process starts attributable to the measured operation.'
    },
    {
      id: 'provider-start-count',
      kind: 'count',
      sourceClass: 'process-provider',
      meaning: 'Provider/container/runner starts required to satisfy the measured operation.'
    },
    {
      id: 'queue-wait-ms',
      kind: 'duration-ms',
      sourceClass: 'verification-session',
      meaning: 'Observed queue or wait duration on the measured critical path.'
    },
    {
      id: 'verification-execution-ms',
      kind: 'duration-ms',
      sourceClass: 'verification-session',
      meaning: 'Observed physical Verification execution duration, excluding separately reported queue/wait.'
    },
    {
      id: 'cleanup-readback-ms',
      kind: 'duration-ms',
      sourceClass: 'settlement',
      meaning: 'Observed cleanup plus authoritative readback duration after the business result is otherwise complete.'
    },
    {
      id: 'operational-terminal-latency-ms',
      kind: 'duration-ms',
      sourceClass: 'settlement',
      meaning: 'Time from terminal request to the exact operational-terminal condition.'
    },
    {
      id: 'physical-gc-latency-ms',
      kind: 'duration-ms',
      sourceClass: 'settlement',
      meaning: 'Time from GC eligibility/authorization to physical-clean settlement; never substituted for operational-terminal latency.'
    }
  ] satisfies readonly DevelopmentPerformanceMetricDefinitionV1[]);

const DEVELOPMENT_CLOSEOUT_STAGES = Object.freeze([
  'finalize',
  'verification',
  'review',
  'merge',
  'main-readback',
  'operational-terminal',
  'physical-gc'
] as const);

const REQUIRED_SAMPLE_BINDINGS = Object.freeze([
  'exact-input-and-scale',
  'environment-and-resource-class',
  'correctness-and-verification-outcome',
  'workload-shape',
  'concurrency-and-arrival-pattern',
  'warm-cold-state',
  'measurement-method'
] as const);

/**
 * #316-owned descriptive scenario contract for #397/#398-like development closeout.
 * It intentionally carries no samples, baselines, percentiles, thresholds, or regression verdicts.
 * #441 (or another selected #316 producer) must bind those to exact environment/input Evidence.
 */
export function buildDevelopmentPerformanceScenarioV1(): DevelopmentPerformanceScenarioV1 {
  return deepFreeze({
    schema: 'sec-development-performance-scenario-v1',
    revision: DEVELOPMENT_PERFORMANCE_SCENARIO_CATALOG_REVISION,
    scenarioId: 'development-closeout-v1',
    goal: 'complete a small governed control-plane change through finalize, verification, review, merge, main readback, operational terminal, and eventual physical settlement',
    stages: DEVELOPMENT_CLOSEOUT_STAGES,
    requiredSampleBindings: REQUIRED_SAMPLE_BINDINGS,
    metrics: DEVELOPMENT_CLOSEOUT_METRICS
  });
}
