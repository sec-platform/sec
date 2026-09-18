import { describe, expect, test } from 'bun:test';

import { projectReviewDiagnostics } from '../../src/application/review-diagnostics-inspect.ts';
import { formatReviewDiagnostics } from '../../src/entry/cli/review-diagnostics-inspect.ts';

describe('review diagnostics presentation boundary', () => {
  test('application owns diagnostic projection and canonical indexes while entry only renders', () => {
    const source = {
      ciSummary: { status: 'attention' },
      failurePoints: [
        { kind: 'contract', lane: 'fast', message: 'failed contract', artifactPath: 'z/report.json' },
        { kind: 'contract', lane: 'runtime', message: 'second failure', artifactPath: 'a/report.json' }
      ],
      regressionRisks: [
        { kind: 'coverage', message: 'risk one', blockId: 'block-z' },
        { kind: 'coverage', message: 'risk two', blockId: 'block-a' },
        { kind: 'coverage', message: 'unbound' }
      ],
      conflictHints: [
        { kind: 'overlap', message: 'conflict', relatedId: 'change:1' }
      ]
    } as const;

    const view = projectReviewDiagnostics(source);

    expect(view.status).toBe('attention');
    expect(view.diagnosticCount).toBe(6);
    expect(view.failureCount).toBe(2);
    expect(view.regressionRiskCount).toBe(3);
    expect(view.conflictHintCount).toBe(1);
    expect(view.artifactPaths).toEqual(['a/report.json', 'z/report.json']);
    expect(view.blocks).toEqual(['block-a', 'block-z']);
    expect(view.diagnostics.map((entry) => entry.id)).toEqual([
      'failure:0',
      'failure:1',
      'regression-risk:0',
      'regression-risk:1',
      'regression-risk:2',
      'conflict:0'
    ]);
    expect(formatReviewDiagnostics(view)).toBe([
      'Review diagnostics attention; diagnostics=6; failures=2; risks=3; conflicts=1',
      'Artifacts: a/report.json, z/report.json',
      'Blocks: block-a, block-z',
      'Diagnostic failure:0; kind=contract; lane=fast; artifact=z/report.json; failed contract',
      'Diagnostic failure:1; kind=contract; lane=runtime; artifact=a/report.json; second failure',
      'Diagnostic regression-risk:0; kind=coverage; block=block-z; risk one',
      'Diagnostic regression-risk:1; kind=coverage; block=block-a; risk two',
      'Diagnostic regression-risk:2; kind=coverage; block=none; unbound',
      'Diagnostic conflict:0; kind=overlap; related=change:1; conflict'
    ].join('\n'));
  });
});
