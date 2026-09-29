import { expect, test } from 'bun:test';

import {
  buildDevelopmentPerformanceScenarioV1
} from '../../src/adapters/verification/platform/benchmark/development-performance.ts';

test('development closeout performance scenario exposes the complete critical-path measurement surface', () => {
  const scenario = buildDevelopmentPerformanceScenarioV1();
  expect(scenario.scenarioId).toBe('development-closeout-v1');
  expect(scenario.stages).toEqual([
    'finalize',
    'verification',
    'review',
    'merge',
    'main-readback',
    'operational-terminal',
    'physical-gc'
  ]);
  expect(scenario.requiredSampleBindings).toEqual(expect.arrayContaining([
    'exact-input-and-scale',
    'environment-and-resource-class',
    'correctness-and-verification-outcome',
    'warm-cold-state',
    'measurement-method'
  ]));
  expect(scenario.metrics.map(({ id }) => id)).toEqual(expect.arrayContaining([
    'action-executed-count',
    'action-reused-pass-count',
    'action-reused-failure-count',
    'action-joined-count',
    'action-invalidated-count',
    'duplicate-physical-start-count',
    'duplicate-owner-observation-count',
    'github-observation-call-count',
    'github-observation-page-count',
    'process-start-count',
    'provider-start-count',
    'queue-wait-ms',
    'verification-execution-ms',
    'cleanup-readback-ms',
    'operational-terminal-latency-ms',
    'physical-gc-latency-ms'
  ]));
});

test('development performance catalog is descriptive and has no invented baseline or percentile threshold', () => {
  const scenario = buildDevelopmentPerformanceScenarioV1();
  const encoded = JSON.stringify(scenario);
  expect(new Set(scenario.metrics.map(({ id }) => id)).size).toBe(scenario.metrics.length);
  expect(encoded).not.toContain('p50');
  expect(encoded).not.toContain('p95');
  expect(encoded).not.toContain('p99');
  expect(encoded).not.toContain('baselineMs');
  expect(encoded).not.toContain('thresholdMs');
  expect(encoded).not.toContain('regressionVerdict');
  expect(scenario.metrics.find(({ id }) => id === 'duplicate-physical-start-count')?.meaning)
    .toContain('correctness target is zero');
});
