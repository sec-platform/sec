import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES, CI_EXPLAIN_GRAPH_ARTIFACTS } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  expectCliJson,
  expectCliSuccess,
  expectCliText,
  expectCliVariants
} from '../testkit/cli.ts';
import { withTempWorkspace, withWorkspaceScenario } from '../testkit/workspace.ts';

const expectedDemoChecklistItemCount = [
  'verification-report',
  'runtime-report',
  'policy-report',
  'acceptance-coverage',
  'graph-lock',
  'provenance-registry',
  ...CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => artifact.id),
  'review-summary'
].length;
const [, explainGraphMermaidArtifact, explainGraphDotArtifact] = CI_EXPLAIN_GRAPH_ARTIFACTS;

test('CLI exposes demo checklist as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['demo', 'checklist'], [
      `Demo checklist attention; items=${expectedDemoChecklistItemCount}; missing=${expectedDemoChecklistItemCount}`,
      `verification-report: missing; ${CI_ARTIFACT_FILES.verificationReport}`,
      `${explainGraphMermaidArtifact.id}: missing; ${explainGraphMermaidArtifact.path}`,
      `${explainGraphDotArtifact.id}: missing; ${explainGraphDotArtifact.path}`,
      'Next command: bun run demo:quickstart'
    ]);
  });

  await withWorkspaceScenario('explained-all-default', async (workspaceRoot) => {
    await expectCliText(workspaceRoot, ['demo', 'checklist'], [
      `Demo checklist passed; items=${expectedDemoChecklistItemCount}; missing=0`,
      `review-summary: passed; ${CI_ARTIFACT_FILES.reviewSummary}`,
      `${explainGraphMermaidArtifact.id}: passed; ${explainGraphMermaidArtifact.path}`,
      `${explainGraphDotArtifact.id}: passed; ${explainGraphDotArtifact.path}`,
      'Next command: bun run demo:closed-loop'
    ]);

    await expectCliJson(
      workspaceRoot,
      ['demo', 'checklist', '--json', '--compact'],
      {
        status: 'passed',
        itemCount: expectedDemoChecklistItemCount,
        missingCount: 0,
        nextCommand: 'bun run demo:closed-loop',
        items: expect.arrayContaining(
          CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => ({
            id: artifact.id,
            status: 'passed',
            artifactPath: artifact.path,
            command: 'bun run sec -- explain'
          }))
        )
      },
      { compact: true }
    );
  });
}, 120000);

test('CLI exposes doctor as text and JSON readiness contracts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expectCliVariants(workspaceRoot, ['doctor'], {
      text: [
        'Developer environment doctor',
        'Checks: 5',
        'workspace-roots',
        'Workspace roots missing: model, src, .sec; run platform init.',
        'runtime-dependencies'
      ],
      json: {
        status: expect.any(String),
        checkCount: 5,
        checks: expect.arrayContaining([
          expect.objectContaining({ id: 'bun' }),
          expect.objectContaining({ id: 'workspace-plan' }),
          expect.objectContaining({ id: 'project-package' }),
          expect.objectContaining({
            id: 'workspace-roots',
            status: 'warn',
            message: 'Workspace roots missing: model, src, .sec; run platform init.'
          }),
          expect.objectContaining({ id: 'runtime-dependencies' })
        ]),
        dependencies: expect.objectContaining({
          mode: expect.any(String),
          recommendedAction: expect.any(String)
        })
      },
      compactJson: {
        status: expect.any(String),
        checkCount: 5,
        dependencies: expect.objectContaining({ mode: expect.any(String) })
      }
    });

    await expectCliSuccess(workspaceRoot, ['init'], 'Initialized project workspace\n');
    await expectCliJson(
      workspaceRoot,
      ['doctor', '--json', '--compact'],
      {
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: 'workspace-roots',
            status: 'ok',
            message: 'Workspace roots exist: workspace, model, src, .sec.'
          })
        ])
      },
      { compact: true }
    );
  });
}, 180000);
