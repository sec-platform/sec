import { expect, test } from 'bun:test';

import { projectE2eMatrix } from '../../src/application/e2e-matrix-inspect.ts';
import { formatE2eMatrix } from '../../src/entry/cli/e2e-matrix-inspect.ts';

test('E2E matrix projection owns finite row evidence while preserving JSON shape and entry text', () => {
  const source = {
    status: 'attention',
    rowCount: 2,
    rows: [
      { stage: 'verification', status: 'passed', detail: 'lane=fast', evidenceCount: 2, evidence: ['ci=passed', 'failures=0'] },
      { stage: 'artifacts', status: 'attention', detail: 'missing=1', evidenceCount: 1, evidence: ['missing=1'] }
    ]
  };

  const view = projectE2eMatrix(source);
  expect(view).toEqual(source);
  source.rows[0]!.evidence.push('later');
  expect(view.rows[0]!.evidence).toEqual(['ci=passed', 'failures=0']);

  expect(formatE2eMatrix(view)).toBe([
    'E2E matrix attention; rows=2',
    'verification: passed; lane=fast; evidence=ci=passed, failures=0',
    'artifacts: attention; missing=1; evidence=missing=1'
  ].join('\n'));
});
