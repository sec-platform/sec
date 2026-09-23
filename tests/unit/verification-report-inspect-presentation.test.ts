import { describe, expect, test } from 'bun:test';

import { projectVerificationReportInspect } from '../../src/application/verification-report-inspect.ts';
import { formatVerificationReport } from '../../src/entry/cli/verification-report-inspect.ts';

describe('verification report inspection presentation boundary', () => {
  test('application snapshots the finite status projection while entry only renders it', () => {
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
    const view = projectVerificationReportInspect(source);
    source.summary.failedLanes.push('later');

    expect(view).toEqual({
      status: 'failed',
      requestedLane: 'runtime',
      failedLanes: ['fast', 'runtime'],
      fast: {
        status: 'failed',
        buildStatus: 'passed',
        unitStatus: 'failed',
        acceptanceStatus: 'passed',
        policyStatus: 'failed'
      },
      runtime: {
        status: 'failed',
        buildStatus: 'passed',
        unitStatus: 'failed',
        acceptanceStatus: 'failed'
      }
    });
    expect(formatVerificationReport(view)).toBe([
      'Verification report failed; requestedLane=runtime; failedLanes=fast, runtime',
      'Fast: failed; build=passed; unit=failed; acceptance=passed; policy=failed',
      'Runtime: failed; build=passed; unit=failed; acceptance=failed'
    ].join('\n'));
  });
});
