import { describe, expect, test } from 'bun:test';

import { projectTextByteCensusReport } from '../../src/application/text-byte-census.ts';
import { formatTextByteCensus } from '../../src/entry/cli/text-byte-census.ts';

const classifications = [
  'canonical-lf',
  'explicit-crlf',
  'binary',
  'preserve-external',
  'unknown'
] as const;
const anomalies = ['mixed-endings', 'utf8-bom'] as const;

describe('text byte census presentation boundary', () => {
  test('application projects an ordered finite view and entry preserves the text contract', () => {
    const view = projectTextByteCensusReport({
      totalFiles: 3,
      failClosed: true,
      classificationCounts: {
        'canonical-lf': 2,
        'explicit-crlf': 0,
        binary: 0,
        'preserve-external': 0,
        unknown: 1
      },
      anomalyCounts: {
        'mixed-endings': 1,
        'utf8-bom': 0
      },
      flaggedEntries: [{
        path: 'src/mixed.ts',
        classification: 'unknown',
        anomalies: ['mixed-endings']
      }]
    }, { classifications, anomalies });

    expect(view).toEqual({
      totalFiles: 3,
      failClosed: true,
      classifications: [
        { id: 'canonical-lf', count: 2 },
        { id: 'unknown', count: 1 }
      ],
      anomalies: [{ id: 'mixed-endings', count: 1 }],
      flaggedEntries: [{
        path: 'src/mixed.ts',
        classification: 'unknown',
        anomalies: ['mixed-endings']
      }]
    });
    expect(formatTextByteCensus(view)).toBe([
      'Text Byte Census',
      '  totalFiles: 3',
      '  failClosed: true',
      '  classifications:',
      '    canonical-lf: 2',
      '    unknown: 1',
      '  anomalies:',
      '    mixed-endings: 1',
      '  flagged: 1 file(s)',
      '    src/mixed.ts [unknown] mixed-endings'
    ].join('\n'));
  });

  test('entry prints no-anomaly state and caps flagged detail at twenty rows', () => {
    const view = projectTextByteCensusReport({
      totalFiles: 21,
      failClosed: false,
      classificationCounts: {
        'canonical-lf': 21,
        'explicit-crlf': 0,
        binary: 0,
        'preserve-external': 0,
        unknown: 0
      },
      anomalyCounts: {
        'mixed-endings': 0,
        'utf8-bom': 0
      },
      flaggedEntries: Array.from({ length: 21 }, (_, index) => ({
        path: `src/${index}.ts`,
        classification: 'canonical-lf' as const,
        anomalies: [] as const
      }))
    }, { classifications, anomalies });
    const text = formatTextByteCensus(view);
    expect(text).toContain('  anomalies:\n    (none)');
    expect(text).toContain('  flagged: 21 file(s)');
    expect(text).toContain('    ... and 1 more');
    expect(text).not.toContain('src/20.ts');
  });
});
