import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { projectLockInspect } from '../../src/application/lock-inspect.ts';
import { saveLock } from '../../src/adapters/workspace/lock.ts';
import { formatLockInspect } from '../../src/entry/cli/lock-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { semanticArtifactLock } from '../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('lock inspect routes canonical lock through application projection and entry rendering without changing JSON', async () => {
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
