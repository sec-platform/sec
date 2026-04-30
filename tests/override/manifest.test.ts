import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import {
  expectGraphEdge,
  expectGraphNode,
  expectReviewConflictHint,
  expectReviewRegressionRisk
} from '../helpers/graph-assertions.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

test('override-manifest can replace a generated file and surface override provenance', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-override-');
  const { overrideManifestPath, projectRoot, provenancePath, sourceOverridesRoot } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'customer-normalizer-manual',
        entry: 'patches/customer-normalizer.override.ts',
        target: 'custom/customer_normalizer.ts',
        reason: 'manual-normalizer-rewrite',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: ['entity/customer-basic@>=0.2.0']
      }
    ]
  });

  const customerNormalizerOverride = String.raw`import type { CustomerInput, NormalizedCustomerInput } from '../src/runtime/database.ts';

// manual override path
export function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {
  const name = String(input.name ?? '').trim();
  if (!name) {
    throw new Error('Customer name is required');
  }

  return {
    name,
    email: String(input.email ?? '').trim().toLowerCase(),
    phone: String(input.phone ?? '').replace(/\D+/g, ''),
    company: String(input.company ?? '').trim() || 'Unknown'
  };
}
`;

  await fs.writeFile(
    path.join(sourceOverridesRoot, 'patches', 'customer-normalizer.override.ts'),
    customerNormalizerOverride,
    'utf8'
  );

  await adaptWorkspace(workspaceRoot);
  const overriddenSource = await fs.readFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'utf8');
  expect(overriddenSource).toMatch(/manual override path/);

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  await lockWorkspace(workspaceRoot);
  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expectGraphNode(graph, { id: 'override:customer-normalizer-manual' });
  expectGraphNode(graph, { type: 'pin' });
  expectGraphNode(graph, { id: 'policy:tenant-scope-required' });
  expectGraphEdge(graph, {
    from: 'policy:tenant-scope-required',
    to: 'file:src/installed/entity/customer-service.ts',
    type: 'connects_to'
  });
  expectGraphEdge(graph, {
    from: 'file:custom/customer_normalizer.ts',
    to: 'override:customer-normalizer-manual',
    type: 'originates_from'
  });

  const provenance = await readJson<{
    artifacts: Array<{ path: string; originType: string; overrideStatus: string }>;
  }>(provenancePath);
  expect(
    provenance.artifacts.some(
      (artifact) =>
        artifact.path === 'custom/customer_normalizer.ts' &&
        artifact.originType === 'override' &&
        artifact.overrideStatus === 'manual'
    )
  ).toBe(true);
  expectReviewRegressionRisk(reviewSummary, {
    kind: 'override-active',
    blockId: 'entity/customer-basic',
    slotId: 'customer_normalizer',
    message: 'Override active: customer-normalizer-manual -> custom/customer_normalizer.ts'
  });
  expectReviewConflictHint(reviewSummary, {
    kind: 'override-conflict',
    relatedId: 'entity/customer-basic@>=0.2.0',
    message: 'Override customer-normalizer-manual conflicts with entity/customer-basic@>=0.2.0'
  });
}, 120000);

test('override-manifest loads developer source layer overrides before legacy overrides', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-source-override-');
  const { overrideManifestPath, legacyOverrideManifestPath, projectRoot, sourceOverridesRoot } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  await writeYaml(legacyOverrideManifestPath, {
    overrides: [
      {
        id: 'customer-normalizer-legacy-manual',
        entry: 'patches/customer-normalizer.legacy.ts',
        target: 'custom/customer_normalizer.ts',
        reason: 'legacy-override-should-lose-to-source-layer',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: []
      }
    ]
  });

  await fs.writeFile(
    path.join(projectRoot, 'overrides', 'patches', 'customer-normalizer.legacy.ts'),
    'legacy override path\n',
    'utf8'
  );

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'customer-normalizer-source-manual',
        entry: 'patches/customer-normalizer.source.ts',
        target: 'custom/customer_normalizer.ts',
        reason: 'source-layer-override-wins',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: []
      }
    ]
  });

  await fs.writeFile(
    path.join(sourceOverridesRoot, 'patches', 'customer-normalizer.source.ts'),
    'source layer override path\n',
    'utf8'
  );

  await adaptWorkspace(workspaceRoot);

  await expect(fs.readFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'utf8')).resolves.toBe(
    'source layer override path\n'
  );
});

test('override-manifest surfaces ticket runtime override attribution', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-ticket-override-');
  const { overrideManifestPath, projectRoot, sourceOverridesRoot } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  await addBlock(workspaceRoot, 'reporting/ticket-summary');
  await addBlock(workspaceRoot, 'worklog/basic');
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  const ticketSummaryExportPath = path.join(projectRoot, 'app', 'api', 'tickets', 'summary', 'export', 'route.ts');
  await expect(fs.readFile(ticketSummaryExportPath, 'utf8')).rejects.toThrow();

  const ticketPagePath = path.join(projectRoot, 'app', 'tickets', 'page.tsx');
  const ticketPageOverride = (await fs.readFile(ticketPagePath, 'utf8')).replace(
    '<h1>Tickets</h1>',
    '<h1>Tickets</h1>\n            <p>Manual ticket runtime override active.</p>'
  );

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'ticket-page-runtime-manual',
        entry: 'patches/ticket-page.override.tsx',
        target: 'app/tickets/page.tsx',
        reason: 'manual-ticket-runtime-copy-change',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: ['ticket/basic@>=0.2.0', 'worklog/basic@>=0.2.0']
      }
    ]
  });
  const ticketPageOverridePath = path.join(sourceOverridesRoot, 'patches', 'ticket-page.override.tsx');
  await fs.writeFile(ticketPageOverridePath, ticketPageOverride, 'utf8');

  await adaptWorkspace(workspaceRoot);
  await expect(fs.readFile(ticketPagePath, 'utf8')).resolves.toContain('Manual ticket runtime override active.');

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  await lockWorkspace(workspaceRoot);
  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  const ticketChangeSource = reviewSummary.changeSources.find((source) => source.path === 'app/tickets/page.tsx');

  expect(ticketChangeSource).toMatchObject({
    path: 'app/tickets/page.tsx',
    originType: 'override',
    originId: 'ticket-page-runtime-manual',
    runtimeKind: 'page',
    vertical: 'ticket',
    relatedBlocks: ['reporting/ticket-summary', 'ticket/basic', 'worklog/basic']
  });
  expectReviewRegressionRisk(reviewSummary, {
    kind: 'override-active',
    blockId: 'ticket/basic',
    message: 'Override active: ticket-page-runtime-manual -> app/tickets/page.tsx'
  });
  expectReviewConflictHint(reviewSummary, {
    kind: 'override-conflict',
    relatedId: 'worklog/basic@>=0.2.0',
    message: 'Override ticket-page-runtime-manual conflicts with worklog/basic@>=0.2.0'
  });
  expectGraphEdge(graph, {
    from: 'file:app/tickets/page.tsx',
    to: 'override:ticket-page-runtime-manual',
    type: 'originates_from'
  });
}, 120000);
