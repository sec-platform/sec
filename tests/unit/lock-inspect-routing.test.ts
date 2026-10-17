import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { saveLock } from '../../src/adapters/workspace/lock.ts';
import { projectLockInspect } from '../../src/application/lock-inspect.ts';
import { formatLockInspect } from '../../src/entry/cli/lock-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { semanticArtifactLock } from '../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('lock inspect routes canonical lock through application projection and entry rendering without changing JSON', async () => {
  // Independent fixed projection and text oracle retained from tests/unit/lock-inspect-presentation.test.ts.
  {
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
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = semanticArtifactLock('generated/lock-inspect-routing.ts');
    await fs.mkdir(path.join(workspaceRoot, '.sec'), { recursive: true });
    await saveLock(workspaceRoot, lock);

    await expectCliSuccess(
      workspaceRoot,
      ['lock', 'inspect'],
      `${formatLockInspect(projectLockInspect(lock))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['lock', 'inspect', '--json']);
    expect(json).toEqual(lock);
  });
});
