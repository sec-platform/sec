import { describe, expect, test } from 'bun:test';

import { projectReviewDiagnostics } from '../../../src/application/review-diagnostics-inspect.ts';
import { formatReviewDiagnostics } from '../../../src/entry/cli/review-diagnostics-inspect.ts';

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
        { kind: 'coverage', message: 'unbound' },
        { kind: 'coverage', message: 'empty', blockId: '' },
        { kind: 'coverage', message: 'duplicate', blockId: 'block-a' }
      ],
      conflictHints: [
        { kind: 'overlap', message: 'conflict', relatedId: 'change:1' }
      ]
    } as const;

    const view = projectReviewDiagnostics(source);

    expect(view.status).toBe('attention');
    expect(view.diagnosticCount).toBe(8);
    expect(view.failureCount).toBe(2);
    expect(view.regressionRiskCount).toBe(5);
    expect(view.conflictHintCount).toBe(1);
    expect(view.artifactPaths).toEqual(['a/report.json', 'z/report.json']);
    expect(view.blocks).toEqual(['block-a', 'block-z']);
    expect(view.blockCount).toBe(2);
    expect(view.diagnostics.map((entry) => entry.id)).toEqual([
      'failure:0',
      'failure:1',
      'regression-risk:0',
      'regression-risk:1',
      'regression-risk:2',
      'regression-risk:3',
      'regression-risk:4',
      'conflict:0'
    ]);
    const lines = formatReviewDiagnostics(view).split('\n');
    const summary = lines.find((line) => /^Review diagnostics\b/u.test(line));
    for (const field of ['attention', 'diagnostics=8', 'failures=2', 'risks=5', 'conflicts=1']) {
      expect(summary).toContain(field);
    }
    const artifacts = lines.find((line) => /^Artifacts\b/u.test(line));
    expect(artifacts).toContain('a/report.json');
    expect(artifacts).toContain('z/report.json');
    const blocks = lines.find((line) => /^Blocks\b/u.test(line));
    expect(blocks).toContain('block-a');
    expect(blocks).toContain('block-z');
    // Each displayed record must preserve its own category, scope, message and
    // identity. Vocabulary found on some other record cannot satisfy this.
    const requiredRecords = [
      ['failure:0', ['kind=contract', 'lane=fast', 'artifact=z/report.json', 'failed contract']],
      ['failure:1', ['kind=contract', 'lane=runtime', 'artifact=a/report.json', 'second failure']],
      ['regression-risk:0', ['kind=coverage', 'block=block-z', 'risk one']],
      ['regression-risk:1', ['kind=coverage', 'block=block-a', 'risk two']],
      ['regression-risk:2', ['kind=coverage', 'block=none', 'unbound']],
      ['regression-risk:3', ['kind=coverage', 'block=none', 'empty']],
      ['regression-risk:4', ['kind=coverage', 'block=block-a', 'duplicate']],
      ['conflict:0', ['kind=overlap', 'related=change:1', 'conflict']]
    ] as const;
    const records = lines.filter((line) => /^Diagnostic\b/u.test(line));
    expect(records).toHaveLength(requiredRecords.length);
    for (const [id, fields] of requiredRecords) {
      const row = records.find((line) => line.startsWith(`Diagnostic ${id}`));
      expect(row).toBeDefined();
      for (const field of fields) expect(row).toContain(field);
    }
    const noDiagnostics = projectReviewDiagnostics({
      ciSummary: { status: 'passed' },
      failurePoints: [],
      regressionRisks: [],
      conflictHints: []
    });
    expect(noDiagnostics).toEqual({
      status: 'passed', diagnosticCount: 0, failureCount: 0,
      regressionRiskCount: 0, conflictHintCount: 0, artifactPathCount: 0,
      artifactPaths: [], blockCount: 0, blocks: [], diagnostics: []
    });
    const emptyLines = formatReviewDiagnostics(noDiagnostics).split('\n');
    const emptySummary = emptyLines.find((line) => /^Review diagnostics\b/u.test(line));
    for (const field of ['passed', 'diagnostics=0', 'failures=0', 'risks=0', 'conflicts=0']) {
      expect(emptySummary).toContain(field);
    }
    expect(emptyLines.find((line) => /^Artifacts\b/u.test(line))).toMatch(/\bnone\b/u);
    expect(emptyLines.find((line) => /^Blocks\b/u.test(line))).toMatch(/\bnone\b/u);
    expect(emptyLines.some((line) => /^Diagnostic\b/u.test(line))).toBe(false);
  });
});
