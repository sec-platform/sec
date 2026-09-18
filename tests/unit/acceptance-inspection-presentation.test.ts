import { describe, expect, test } from 'bun:test';

import {
  projectAcceptanceCoverage,
  projectAcceptanceTargets
} from '../../src/application/acceptance-inspection.ts';
import {
  formatAcceptanceCoverage,
  formatAcceptanceTargets
} from '../../src/entry/cli/acceptance-inspection.ts';

describe('acceptance inspection presentation boundary', () => {
  test('application snapshots target evidence and preserves blocks JSON shape while entry only renders', () => {
    const source = {
      status: 'passed',
      acceptancePassed: ['acceptance:a', 'acceptance:b'],
      blocks: [
        {
          coveredBy: ['acceptance:a'],
          id: 'alpha',
          declaredAcceptance: ['declared:a'],
          uncovered: false
        },
        {
          coveredBy: [],
          id: 'beta',
          declaredAcceptance: ['declared:b', 'declared:c'],
          uncovered: true
        }
      ],
      uncoveredBlocks: ['beta']
    };
    const targets = projectAcceptanceTargets(source);
    const coverage = projectAcceptanceCoverage(source);

    source.blocks[0]!.coveredBy.push('later');
    source.uncoveredBlocks.length = 0;

    expect(targets).toEqual({
      status: 'passed',
      targetKind: 'blocks',
      targetCount: 2,
      coveredCount: 1,
      uncoveredCount: 1,
      uncoveredIds: ['beta'],
      targets: [
        {
          coveredBy: ['acceptance:a'],
          id: 'alpha',
          declaredAcceptance: ['declared:a'],
          uncovered: false,
          declaredAcceptanceCount: 1,
          coveredByCount: 1
        },
        {
          coveredBy: [],
          id: 'beta',
          declaredAcceptance: ['declared:b', 'declared:c'],
          uncovered: true,
          declaredAcceptanceCount: 2,
          coveredByCount: 0
        }
      ]
    });
    expect(coverage.acceptancePassedCount).toBe(2);
    expect(coverage.blockTargets).toEqual(targets);

    expect(formatAcceptanceCoverage(coverage)).toBe([
      'Acceptance coverage passed; acceptancePassed=2; blocks=1/2; uncoveredBlocks=1',
      'Uncovered blocks: beta',
      'Block alpha; declared=1; coveredBy=acceptance:a; uncovered=false',
      'Block beta; declared=2; coveredBy=none; uncovered=true'
    ].join('\n'));

    expect(formatAcceptanceTargets(targets)).toBe([
      'Acceptance coverage blocks passed',
      'targets=2; covered=1; uncovered=1',
      'Uncovered: beta',
      'Target alpha; declared=1; coveredBy=acceptance:a; uncovered=false',
      'Target beta; declared=2; coveredBy=none; uncovered=true'
    ].join('\n'));
  });
});
