import { describe, expect, test } from 'bun:test';

import { formatVerificationReport } from '../../src/entry/cli/verification-report-inspect.ts';

describe('verification report inspection presentation boundary', () => {
  test('entry renders the report statuses without changing the source', () => {
    const source = {
      summary: {
        status: 'failed',
        requestedLane: 'runtime',
        failedLanes: ['fast', 'runtime']
      },
      fast: {
        status: 'failed',
        build: { status: 'passed' },
        unit: { status: 'failed' },
        acceptance: { status: 'passed' },
        policy: { status: 'failed' }
      },
      runtime: {
        status: 'failed',
        build: { status: 'passed' },
        unit: { status: 'failed' },
        acceptance: { status: 'failed' }
      }
    };
    const before = structuredClone(source);
    expect(formatVerificationReport(source)).toBe([
      'Verification report failed; requestedLane=runtime; failedLanes=fast, runtime',
      'Fast: failed; build=passed; unit=failed; acceptance=passed; policy=failed',
      'Runtime: failed; build=passed; unit=failed; acceptance=failed'
    ].join('\n'));
    expect(source).toEqual(before);
  });
});
