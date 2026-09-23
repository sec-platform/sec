import { describe, expect, test } from 'bun:test';

import { projectLockInspect } from '../../src/application/lock-inspect.ts';
import { formatLockInspect } from '../../src/entry/cli/lock-inspect.ts';

describe('lock inspect presentation boundary', () => {
  test('application owns the finite projection and stable block order while entry only renders it', () => {
    const source = {
      app: { name: 'demo', stack: 'typescript', mode: 'service' },
      resolvedBlocks: [
        { id: 'zeta', version: '2.0.0', installOrder: 2 },
        { id: 'beta', version: '1.0.0', installOrder: 1 },
        { id: 'alpha', version: '1.1.0', installOrder: 1 }
      ],
      generatedPaths: ['src/a.ts', 'src/b.ts'],
      acceptancePlan: ['acceptance:a'],
      passStatus: {
        parse: 'succeeded',
        verify: 'failed',
        lock: 'succeeded'
      }
    } as const;
    const originalOrder = source.resolvedBlocks.map((block) => block.id);

    const view = projectLockInspect(source);

    expect(view).toEqual({
      appName: 'demo',
      stack: 'typescript',
      mode: 'service',
      blockCount: 3,
      generatedCount: 2,
      acceptanceCount: 1,
      blockOrder: ['1:alpha@1.1.0', '1:beta@1.0.0', '2:zeta@2.0.0'],
      passStates: ['succeeded', 'failed', 'succeeded']
    });
    expect(source.resolvedBlocks.map((block) => block.id)).toEqual(originalOrder);
    expect(formatLockInspect(view)).toBe([
      'Graph lock demo',
      'stack=typescript; mode=service; blocks=3; generated=2; acceptance=1',
      'Block order: 1:alpha@1.1.0, 1:beta@1.0.0, 2:zeta@2.0.0',
      'Pass status: failed=1, succeeded=2'
    ].join('\n'));
  });
});
