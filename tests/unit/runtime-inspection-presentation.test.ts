import { describe, expect, test } from 'bun:test';

import { projectRuntimeInspection } from '../../src/application/runtime-inspection.ts';
import {
  formatRuntimeReport,
  formatRuntimeStepsInspect
} from '../../src/entry/cli/runtime-inspection.ts';

describe('runtime inspection presentation boundary', () => {
  test('application snapshots step evidence and counts while entry only renders the finite view', () => {
    const source = {
      status: 'failed',
      build: { status: 'passed', passed: ['build:a'], failed: [], command: 'bun run build' },
      unit: { status: 'failed', passed: ['unit:a'], failed: ['unit:b'], command: 'bun test' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: null }
    };
    const view = projectRuntimeInspection(source);

    source.build.passed.push('later');
    source.unit.failed.length = 0;

    expect(view).toEqual({
      status: 'failed',
      stepCount: 3,
      passedCount: 1,
      failedCount: 1,
      skippedCount: 1,
      steps: [
        {
          id: 'build',
          status: 'passed',
          passedCount: 1,
          failedCount: 0,
          command: 'bun run build',
          passed: ['build:a'],
          failed: []
        },
        {
          id: 'unit',
          status: 'failed',
          passedCount: 1,
          failedCount: 1,
          command: 'bun test',
          passed: ['unit:a'],
          failed: ['unit:b']
        },
        {
          id: 'acceptance',
          status: 'skipped',
          passedCount: 0,
          failedCount: 0,
          command: null,
          passed: [],
          failed: []
        }
      ]
    });
    expect(formatRuntimeReport(view)).toBe([
      'Runtime report failed',
      'Build: passed; passed=1; failed=0; command=bun run build',
      'Unit: failed; passed=1; failed=1; command=bun test',
      'Acceptance: skipped; passed=0; failed=0; command=none'
    ].join('\n'));
    expect(formatRuntimeStepsInspect(view)).toBe([
      'Runtime steps failed; steps=3; passed=1; failed=1; skipped=1',
      'build: passed; passed=1; failed=0; command=bun run build',
      'unit: failed; passed=1; failed=1; command=bun test',
      'acceptance: skipped; passed=0; failed=0; command=none'
    ].join('\n'));
  });
});
