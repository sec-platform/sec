export type TestTimingThreshold = {
  lane: 'fast' | 'integration' | 'slow';
  maxDurationMs: number;
  action: 'fail' | 'warn';
};

export type TestTimingContract = {
  fastThresholdMs: number;
  integrationThresholdMs: number;
  slowThresholdMs: number;
  timingReportPath: string;
  flakySignals: string[];
  thresholds: TestTimingThreshold[];
};

export function buildTestTimingContract(): TestTimingContract {
  return {
    fastThresholdMs: 5000,
    integrationThresholdMs: 30000,
    slowThresholdMs: 180000,
    timingReportPath: 'control/test/timing-report.json',
    flakySignals: [
      'next-build',
      'playwright',
      'large-filesystem-copy',
      'spinner-stderr',
      'dependency-install',
      'parallel-lock'
    ],
    thresholds: [
      { lane: 'fast', maxDurationMs: 5000, action: 'warn' },
      { lane: 'integration', maxDurationMs: 30000, action: 'warn' },
      { lane: 'slow', maxDurationMs: 180000, action: 'warn' }
    ]
  };
}
