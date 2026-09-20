import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { composeWorkspace, explainWorkspace, lockWorkspace, verifyWorkspace } from '../../src/bootstrap/engineering/cli.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import { expectGraphEdge, expectGraphNode, expectReviewConflictHint, expectReviewRegressionRisk } from '../helpers/graph-assertions.ts';
import { prepareComposedWorkspace } from '../testkit/workspace.ts';

test('override-manifest can replace a generated file and surface override provenance', async () => {
  const workspaceRoot = await prepareComposedWorkspace({ prefix: 'engineering-compiler-override-' });
  const paths = getWorkspacePaths(workspaceRoot);
  const overrideManifestPath = path.join(paths.overridesRoot, 'override-manifest.yaml');
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'customer-service-manual',
        entry: 'patches/customer-service.override.ts',
        target: 'src/installed/entity/customer-service.ts',
        reason: 'manual-customer-service-rewrite',
        source: 'manual',
        conflictsWith: ['entity/customer-basic@>=0.2.0']
      }
    ]
  });

  const customerServicePath = path.join(workspaceRoot, 'src', 'installed', 'entity', 'customer-service.ts');
  const customerServiceOverride = `${await fs.readFile(customerServicePath, 'utf8')}\n// Manual customer service override active.\n`;
  await fs.writeFile(
    path.join(paths.overridesRoot, 'patches', 'customer-service.override.ts'),
    customerServiceOverride,
    'utf8'
  );

  await composeWorkspace(workspaceRoot);
  await expect(fs.readFile(customerServicePath, 'utf8'))
    .resolves.toContain('Manual customer service override active.');

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  await lockWorkspace(workspaceRoot);
  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expectGraphNode(graph, { id: 'override:customer-service-manual' });
  expectGraphNode(graph, { type: 'pin' });
  expectGraphNode(graph, { id: 'policy:tenant-scope-required' });
  expectGraphEdge(graph, {
    from: 'policy:tenant-scope-required',
    to: 'file:src/installed/entity/customer-service.ts',
    type: 'connects_to'
  });
  expectGraphEdge(graph, {
    from: 'file:src/installed/entity/customer-service.ts',
    to: 'override:customer-service-manual',
    type: 'originates_from'
  });

  const provenance = await readJson<{
    artifacts: Array<{ path: string; originType: string; overrideStatus: string }>;
  }>(provenancePath);
  expect(
    provenance.artifacts.some(
      (artifact) =>
        artifact.path === 'src/installed/entity/customer-service.ts' && artifact.originType === 'override' && artifact.overrideStatus === 'manual'
    )
  ).toBe(true);
  expectReviewRegressionRisk(reviewSummary, {
    kind: 'override-active',
    blockId: 'entity/customer-basic',
    message: 'Override active: customer-service-manual -> src/installed/entity/customer-service.ts'
  });
  expectReviewConflictHint(reviewSummary, {
    kind: 'override-conflict',
    relatedId: 'entity/customer-basic@>=0.2.0',
    message: 'Override customer-service-manual conflicts with entity/customer-basic@>=0.2.0'
  });
}, 120000);

test('override-manifest surfaces ticket runtime override attribution', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-ticket-override-',
    blockIds: ['ticket/basic', 'reporting/ticket-summary', 'worklog/basic']
  });
  const paths = getWorkspacePaths(workspaceRoot);
  const overrideManifestPath = path.join(paths.overridesRoot, 'override-manifest.yaml');

  const ticketServicePath = path.join(workspaceRoot, 'src', 'installed', 'ticket', 'ticket-service.ts');
  const ticketServiceOverride = `${await fs.readFile(ticketServicePath, 'utf8')}\n// Manual ticket runtime override active.\n`;

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'ticket-service-runtime-manual',
        entry: 'patches/ticket-service.override.ts',
        target: 'src/installed/ticket/ticket-service.ts',
        reason: 'manual-ticket-runtime-copy-change',
        source: 'manual',
        conflictsWith: ['ticket/basic@>=0.2.0', 'worklog/basic@>=0.2.0']
      }
    ]
  });
  const ticketServiceOverridePath = path.join(paths.overridesRoot, 'patches', 'ticket-service.override.ts');
  await fs.writeFile(ticketServiceOverridePath, ticketServiceOverride, 'utf8');

  await composeWorkspace(workspaceRoot);
  await expect(fs.readFile(ticketServicePath, 'utf8')).resolves.toContain('Manual ticket runtime override active.');

  let report: any;
  try {
    const res = await verifyWorkspace(workspaceRoot);
    report = res.report;
  } catch (e: any) {
    console.error('VERIFY ERROR DETAILS:', JSON.stringify(e.details ?? e, null, 2));
    throw e;
  }
  expect(report.summary.status).toBe('passed');

  await lockWorkspace(workspaceRoot);
  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  const ticketChangeSource = reviewSummary.changeSources.find((source) => source.path === 'src/installed/ticket/ticket-service.ts');

  expect(ticketChangeSource).toMatchObject({
    path: 'src/installed/ticket/ticket-service.ts',
    originType: 'override',
    originId: 'ticket-service-runtime-manual',
    runtimeKind: 'service',
    vertical: 'ticket',
    relatedBlocks: ['auth/basic-session', 'tenant/basic-workspace', 'ticket/basic']
  });
  expectReviewRegressionRisk(reviewSummary, {
    kind: 'override-active',
    blockId: 'ticket/basic',
    message: 'Override active: ticket-service-runtime-manual -> src/installed/ticket/ticket-service.ts'
  });
  expectReviewConflictHint(reviewSummary, {
    kind: 'override-conflict',
    relatedId: 'worklog/basic@>=0.2.0',
    message: 'Override ticket-page-runtime-manual conflicts with worklog/basic@>=0.2.0'
  });
  expectGraphEdge(graph, {
    from: 'file:src/installed/ticket/ticket-service.ts',
    to: 'override:ticket-service-runtime-manual',
    type: 'originates_from'
  });
}, 120000);
