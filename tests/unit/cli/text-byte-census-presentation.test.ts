import { describe, expect, spyOn, test } from 'bun:test';

import { admitTextByteCensusThreshold, projectTextByteCensusReport, textByteCensusThresholdMatched } from '../../../src/application/text-byte-census.ts';
import type { JsonOpts } from '../../../src/entry/cli/command-options.ts';
import { bindTextCommandHandlers, type TextCommandOperations } from '../../../src/entry/cli/register-text-commands.ts';
import { formatTextByteCensus } from '../../../src/entry/cli/text-byte-census.ts';

const classifications = [
  'canonical-lf',
  'explicit-crlf',
  'binary',
  'preserve-external',
  'unknown'
] as const;
const anomalies = [
  'crlf-in-canonical-lf-blob', 'lf-in-explicit-crlf-blob', 'mixed-endings',
  'utf8-bom', 'nul-byte', 'unknown-encoding', 'attributes-unsupported'
] as const;

describe('text byte census presentation boundary', () => {
  test('entry caps flagged detail at twenty rows', () => {
    const view = projectTextByteCensusReport({
      totalFiles: 21,
      failClosed: true,
      classificationCounts: {
        'canonical-lf': 0,
        'explicit-crlf': 0,
        binary: 0,
        'preserve-external': 21,
        unknown: 0
      },
      anomalyCounts: {
        'crlf-in-canonical-lf-blob': 0,
        'lf-in-explicit-crlf-blob': 0,
        'mixed-endings': 0,
        'utf8-bom': 21,
        'nul-byte': 0,
        'unknown-encoding': 0,
        'attributes-unsupported': 0
      },
      flaggedEntries: Array.from({ length: 21 }, (_, index) => ({
        path: `src/${String(index).padStart(2, '0')}.ts`,
        classification: 'preserve-external' as const,
        anomalies: ['utf8-bom'] as const
      }))
    }, { classifications, anomalies });
    const text = formatTextByteCensus(view);
    expect(text).toMatch(/\bpreserve-external[\s:]+21(?=$|[\s;,])/u);
    expect(text).toMatch(/\bflagged[\s:]+21\s+file/u);
    expect(text).toMatch(/(?:^|\s)1\s+more(?=$|[\s;,])/u);
    expect(Array.from(text.matchAll(/(?:^|\s)(src\/\d+\.ts)(?=$|\s|\[)/gu), ([, file]) => file))
      .toEqual(Array.from({ length: 20 }, (_, index) => `src/${String(index).padStart(2, '0')}.ts`));
  });

  test('application admits finite fail-on thresholds and evaluates them without CLI casts', () => {
    expect(admitTextByteCensusThreshold(undefined, classifications)).toEqual({ status: 'absent' });
    expect(admitTextByteCensusThreshold('any', classifications)).toEqual({
      status: 'accepted',
      threshold: 'any'
    });
    expect(admitTextByteCensusThreshold('unknown', classifications)).toEqual({
      status: 'accepted',
      threshold: 'unknown'
    });
    expect(admitTextByteCensusThreshold('invalid', classifications)).toEqual({
      status: 'rejected',
      value: 'invalid'
    });
    const report = {
      failClosed: true,
      classificationCounts: {
        'canonical-lf': 2,
        'explicit-crlf': 0,
        binary: 0,
        'preserve-external': 0,
        unknown: 1
      }
    };
    expect(textByteCensusThresholdMatched(report, 'any')).toBe(true);
    expect(textByteCensusThresholdMatched(report, 'unknown')).toBe(true);
    expect(textByteCensusThresholdMatched(report, 'binary')).toBe(false);
  });

});


test('bound text census preserves finite thresholds, generic results and operation receivers', async () => {
  const thresholds: Array<'any' | 'unknown' | undefined> = [];
  const trace: string[] = [];
  const operations: TextCommandOperations<'unknown'> = {
    admitThreshold(value) {
      expect(this).toBe(operations);
      trace.push('admit');
      return value === undefined || value === 'unknown' || value === 'any'
        ? { status: 'accepted', threshold: value }
        : { status: 'rejected', expected: ['unknown'] };
    },
    async runCensus(root, threshold) {
      expect(this).toBe(operations);
      expect(root).toBe('/fixture');
      trace.push('census'); thresholds.push(threshold);
      return { value: { threshold: threshold ?? 'absent' }, text: 'census', thresholdMatched: false };
    },
    async progress<T>(_text: string, _output: JsonOpts, operation: () => Promise<T>): Promise<T> {
      expect(this).toBe(operations);
      trace.push('progress');
      return operation();
    }
  };
  const handlers = bindTextCommandHandlers(operations);
  const output = spyOn(console, 'log').mockImplementation(() => {});
  try {
    for (const failOn of [undefined, 'unknown', 'any']) {
      await handlers.census({ workspaceRoot: '/fixture', output: { json: true, compact: true }, failOn });
    }
    expect(Object.isFrozen(handlers)).toBe(true);
    expect(thresholds).toEqual([undefined, 'unknown', 'any']);
    expect(trace).toEqual(Array.from({ length: 3 }, () => ['admit', 'progress', 'census']).flat());
    expect(output.mock.calls.map(([value]) => JSON.parse(String(value)))).toEqual([
      { threshold: 'absent' }, { threshold: 'unknown' }, { threshold: 'any' }
    ]);
  } finally { output.mockRestore(); }
});

test('bound text census rejects invalid admission before effects and retains the primary execution error', async () => {
  const primary = new Error('census failed');
  let effects = 0;
  const operations: TextCommandOperations<'unknown'> = {
    admitThreshold: value => value === 'unknown'
      ? { status: 'accepted', threshold: 'unknown' }
      : { status: 'rejected', expected: ['unknown'] },
    runCensus: async () => { effects++; throw primary; },
    progress: async (_text, _output, operation) => operation()
  };
  const handlers = bindTextCommandHandlers(operations);
  await expect(handlers.census({ workspaceRoot: '/fixture', output: { json: false, compact: false }, failOn: 'invalid' })).rejects.toThrow('must be any or one of');
  expect(effects).toBe(0);
  await expect(handlers.census({ workspaceRoot: '/fixture', output: { json: false, compact: false }, failOn: 'unknown' })).rejects.toBe(primary);
  expect(effects).toBe(1);
});
