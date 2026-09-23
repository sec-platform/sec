import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectRuntimeInspection } from '../../src/application/runtime-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  formatRuntimeReport,
  formatRuntimeStepsInspect
} from '../../src/entry/cli/runtime-inspection.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('runtime inspection routes text through application and entry while preserving both JSON contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      status: 'failed',
      build: { status: 'passed', passed: ['build:a'], failed: [], command: 'bun run build' },
      unit: { status: 'failed', passed: ['unit:a'], failed: ['unit:b'], command: 'bun test' },
      acceptance: { status: 'skipped', passed: [], failed: [], command: null },
      logs: { stdout: 'out', stderr: 'err' }
    };
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const view = projectRuntimeInspection(report);
    await expectCliSuccess(workspaceRoot, ['runtime'], `${formatRuntimeReport(view)}\n`);
    const rawJson = await expectCliJson<typeof report>(workspaceRoot, ['runtime', '--json']);
    expect(rawJson).toEqual(report);

    await expectCliSuccess(
      workspaceRoot,
      ['runtime', 'steps'],
      `${formatRuntimeStepsInspect(view)}\n`
    );
    const stepsJson = await expectCliJson<typeof view>(workspaceRoot, ['runtime', 'steps', '--json']);
    expect(stepsJson).toEqual(view);
  });
});
