import { expect, test } from 'vitest';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { expectCliJson, expectCliSuccess, expectCliText, runCliPipeline, withTempWorkspace } from '../helpers/test-utils.ts';

test('CLI exposes demo checklist as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['demo', 'checklist'], [
      'Demo checklist attention; items=8; missing=8',
      `verification-report: missing; ${CI_ARTIFACT_FILES.verificationReport}`,
      'Next command: npm run demo:quickstart'
    ]);

    await runCliPipeline(workspaceRoot, { verifyLane: 'all', lock: true, explain: true });

    await expectCliText(workspaceRoot, ['demo', 'checklist'], [
      'Demo checklist passed; items=8; missing=0',
      `review-summary: passed; ${CI_ARTIFACT_FILES.reviewSummary}`,
      'Next command: npm run demo:closed-loop'
    ]);

    await expectCliJson(
      workspaceRoot,
      ['demo', 'checklist', '--json', '--compact'],
      {
        formatVersion: '1',
        status: 'passed',
        itemCount: 8,
        missingCount: 0,
        nextCommand: 'npm run demo:closed-loop',
        items: expect.arrayContaining([
          {
            id: 'explain-graph',
            status: 'passed',
            artifactPath: CI_ARTIFACT_FILES.explainGraph,
            command: 'npm run platform -- explain'
          }
        ])
      },
      { compact: true }
    );
  });
}, 120000);

test('CLI exposes doctor as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['doctor'], [
      'Developer environment doctor',
      'Checks: 6',
      'node-version',
      'workspace-roots',
      'Workspace roots missing: source, project, control, .pjc; run platform init.',
      'runtime-dependencies'
    ]);

    await expectCliJson(workspaceRoot, ['doctor', '--json'], {
      status: expect.any(String),
      checkCount: 6,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'node-version' }),
        expect.objectContaining({ id: 'bun' }),
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'warn',
          message: 'Workspace roots missing: source, project, control, .pjc; run platform init.'
        }),
        expect.objectContaining({ id: 'runtime-dependencies' })
      ]),
      dependencies: expect.objectContaining({
        mode: expect.any(String),
        recommendedAction: expect.any(String)
      })
    });

    await expectCliJson(
      workspaceRoot,
      ['doctor', '--json', '--compact'],
      {
        status: expect.any(String),
        checkCount: 6,
        dependencies: expect.objectContaining({ mode: expect.any(String) })
      },
      { compact: true }
    );

    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
    await expectCliJson(
      workspaceRoot,
      ['doctor', '--json', '--compact'],
      {
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: 'workspace-roots',
            status: 'ok',
            message: 'Workspace roots exist: source, project, control, .pjc.'
          })
        ])
      },
      { compact: true }
    );
  });
});
