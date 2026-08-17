import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { PhysicalNoFollowError } from '../../platform/shared/physical-no-follow.ts';
import {
  readWorkbenchJsonArtifact,
  readWorkbenchOrdinaryFile
} from '../../platform/orchestrator/workbench-safe-file.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function expectPhysicalRejection(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PhysicalNoFollowError);
    expect((error as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
    return;
  }
  throw new Error('Expected Workbench read boundary to reject a link-following path.');
}

test('workbench artifact reads require ordinary no-follow parents and leaves', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const viewsRoot = path.join(workspaceRoot, 'control', 'workbench', 'views');
    const externalRoot = path.join(workspaceRoot, 'external');
    await fs.mkdir(viewsRoot, { recursive: true });
    await fs.mkdir(externalRoot, { recursive: true });

    const ordinaryPath = path.join(viewsRoot, 'ordinary.json');
    await fs.writeFile(ordinaryPath, '{"ok":true}\n', 'utf8');
    expect(readWorkbenchJsonArtifact<{ ok: boolean }>(ordinaryPath, 'ordinary fixture')).toEqual({ ok: true });
    expect(readWorkbenchOrdinaryFile(path.join(viewsRoot, 'missing.json'), 'missing fixture')).toBeNull();

    await fs.writeFile(path.join(externalRoot, 'secret.json'), '{"secret":true}\n', 'utf8');
    const linkedDirectory = path.join(viewsRoot, 'linked');
    await fs.symlink(
      externalRoot,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expectPhysicalRejection(() =>
      readWorkbenchOrdinaryFile(path.join(linkedDirectory, 'secret.json'), 'linked fixture')
    );
  });
});
