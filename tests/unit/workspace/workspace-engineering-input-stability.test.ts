import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from '../../../src/adapters/workspace-context.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../../src/adapters/workspace/engineering-input.ts';
import { saveLock } from '../../../src/adapters/workspace/lock.ts';
import { resolveGraph } from '../../../src/adapters/workspace/resolve-graph.ts';
import { loadPlan } from '../../../src/adapters/workspace/sources/load-plan.ts';
import { writeYaml } from '../../../src/adapters/workspace/yaml.ts';
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH } from '../../../src/workspace/contract/authoring-index.ts';
import { withWorkspaceScenario } from '../../testkit/workspace.ts';

test.serial('engineering input rejects app and block revisions crossed by asynchronous source capture', async () => {
  await withWorkspaceScenario('resolved-default', async root => {
    const first = await loadWorkspaceEngineeringIRBuildInput(root);
    expect(first.engineeringIRInput.app.name).toBeTruthy();

    const planPath = getWorkspacePaths(root).workspaceConfigPath;
    const originalPlan = loadPlan(planPath);
    const authoringIndexPath = path.resolve(root, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
    const nativeLstat = fs.lstat.bind(fs);
    for (const change of ['app', 'block'] as const) {
      // The first refusal never writes the Lock. Restore its Plan before the
      // next independent race so an app mismatch cannot mask a missing block.
      if (change === 'block') await writeYaml(planPath, originalPlan);
      const message = change === 'app'
        ? 'Workspace Plan/Lock selection is inconsistent'
        : 'selected block ticket/basic is absent or has a different version';
      let changed = false;
      const lstat = spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
        if (!changed && args[0] === authoringIndexPath) {
          changed = true;
          const plan = loadPlan(planPath);
          await writeYaml(planPath, change === 'app'
            ? { ...plan, app: { ...plan.app, name: `${plan.app.name}-changed` } }
            : { ...plan, blocks: [{ id: 'ticket/basic' }] });
        }
        return nativeLstat(...args);
      }) as typeof fs.lstat);
      try {
        await expect(loadWorkspaceEngineeringIRBuildInput(root)).rejects.toThrow(message);
        expect(changed).toBe(true);
      } finally {
        lstat.mockRestore();
      }
      await expect(loadWorkspaceEngineeringIRBuildInput(root)).rejects.toThrow(message);
    }
  });
}, 120000);

test.serial('engineering input rejects a stale Lock block removed from explicit Plan selection', async () => {
  await withWorkspaceScenario('resolved-default', async root => {
    const planPath = getWorkspacePaths(root).workspaceConfigPath;
    const originalPlan = loadPlan(planPath);
    const selectedPlan = { ...originalPlan,
      blocks: [...originalPlan.blocks, { id: 'ticket/basic' }] };
    await writeYaml(planPath, selectedPlan);
    await saveLock(root, await resolveGraph(root, selectedPlan));
    const selected = await loadWorkspaceEngineeringIRBuildInput(root);
    expect(selected.sourceLock.resolvedBlocks.some((block) => block.id === 'ticket/basic')).toBe(true);

    await writeYaml(planPath, originalPlan);
    await expect(loadWorkspaceEngineeringIRBuildInput(root))
      .rejects.toThrow('resolved block closure changed');
  });
}, 120000);
