import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkspacePaths } from '../../src/adapters/workspace-context.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../src/adapters/workspace/engineering-input.ts';
import { loadPlan } from '../../src/adapters/workspace/sources/load-plan.ts';
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH } from '../../src/workspace/contract/authoring-index.ts';
import { withWorkspaceScenario } from '../testkit/workspace.ts';

test.serial('engineering input rejects a Plan revision crossed by asynchronous source capture', async () => {
  await withWorkspaceScenario('resolved-default', async root => {
    const first = await loadWorkspaceEngineeringIRBuildInput(root);
    expect(first.engineeringIRInput.app.name).toBeTruthy();

    const planPath = getWorkspacePaths(root).workspaceConfigPath;
    const authoringIndexPath = path.resolve(root, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
    const nativeLstat = fs.lstat.bind(fs);
    let changed = false;
    const lstat = spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (!changed && args[0] === authoringIndexPath) {
        changed = true;
        const plan = loadPlan(planPath);
        await writeYaml(planPath, { ...plan, app: { ...plan.app, name: `${plan.app.name}-changed` } });
      }
      return nativeLstat(...args);
    }) as typeof fs.lstat);
    try {
      await expect(loadWorkspaceEngineeringIRBuildInput(root))
        .rejects.toThrow('Workspace engineering input changed during source capture');
      expect(changed).toBe(true);
    } finally {
      lstat.mockRestore();
    }

    const stable = await loadWorkspaceEngineeringIRBuildInput(root);
    expect(stable.engineeringIRInput.app.name).toBe(`${first.engineeringIRInput.app.name}-changed`);
  });
}, 120000);
