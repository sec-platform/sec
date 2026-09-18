import { describe, expect, test } from 'bun:test';

import { projectPolicySources } from '../../src/application/policy-source-inspection.ts';
import { formatPolicySources } from '../../src/entry/cli/policy-source-inspection.ts';

describe('policy source inspection presentation boundary', () => {
  test('application snapshots policy ids and owns stable source ordering while entry only renders', () => {
    const source = {
      status: 'passed',
      official: {
        sources: [
          { path: 'z', policyIds: ['official:z'] },
          { path: 'a', policyIds: ['official:a', 'official:b'] }
        ]
      },
      project: {
        sources: [{ path: 'b', policyIds: ['project:b'] }]
      }
    };
    const originalOfficial = source.official.sources.map((entry) => entry.path);

    const view = projectPolicySources(source);

    source.official.sources[0]!.policyIds.push('later');
    expect(view).toEqual({
      status: 'passed',
      sourceCount: 3,
      policyCount: 4,
      sources: [
        { scope: 'official', path: 'a', policyCount: 2, policyIds: ['official:a', 'official:b'] },
        { scope: 'official', path: 'z', policyCount: 1, policyIds: ['official:z'] },
        { scope: 'project', path: 'b', policyCount: 1, policyIds: ['project:b'] }
      ]
    });
    expect(source.official.sources.map((entry) => entry.path)).toEqual(originalOfficial);
    expect(formatPolicySources(view)).toBe([
      'Policy sources passed',
      'sources=3; policies=4',
      'Source official; path=a; policies=official:a, official:b',
      'Source official; path=z; policies=official:z',
      'Source project; path=b; policies=project:b'
    ].join('\n'));
  });
});
