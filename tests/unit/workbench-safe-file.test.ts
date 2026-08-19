import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  publishWorkbenchMutationEnvelope,
  readWorkbenchJsonArtifact,
  readWorkbenchOrdinaryFile
} from '../../platform/orchestrator/workbench-safe-file.ts';
import { PhysicalNoFollowError } from '../../platform/shared/physical-no-follow.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function expectPhysicalRejection(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PhysicalNoFollowError);
    expect((error as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
    return;
  }
  throw new Error('Expected Workbench physical boundary to reject a link-following path.');
}

async function expectAsyncPhysicalRejection(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(PhysicalNoFollowError);
    expect((error as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_UNSAFE_PATH');
    return;
  }
  throw new Error('Expected Workbench physical publication to reject a link-following path.');
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

test('workbench mutation publication retains the workspace path and refuses a linked source ancestor', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const envelope = {
      formatVersion: '1',
      mutations: [{ id: 'm1', kind: 'set-app-name', value: 'Retained Name' }]
    };
    let fenceCalls = 0;
    const fence = async (): Promise<void> => {
      fenceCalls += 1;
    };

    await publishWorkbenchMutationEnvelope(workspaceRoot, envelope, fence);
    const mutationPath = path.join(workspaceRoot, 'source', 'views', 'mutations', 'graph-action.json');
    expect(JSON.parse(await fs.readFile(mutationPath, 'utf8'))).toEqual(envelope);
    expect(fenceCalls).toBeGreaterThanOrEqual(2);

    const retainedSource = path.join(workspaceRoot, 'source-retained');
    const externalSource = path.join(workspaceRoot, 'external-source');
    await fs.rename(path.join(workspaceRoot, 'source'), retainedSource);
    await fs.mkdir(externalSource, { recursive: true });
    await fs.symlink(
      externalSource,
      path.join(workspaceRoot, 'source'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expectAsyncPhysicalRejection(() =>
      publishWorkbenchMutationEnvelope(workspaceRoot, envelope, fence)
    );
    expect(await fs.readdir(externalSource)).toEqual([]);
  });
});
