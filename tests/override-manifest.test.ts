import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}, 120000);

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

test('override-manifest can replace a generated file and surface override provenance', { timeout: 120000 }, async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-override-');
  const { overrideManifestPath, projectRoot } = getWorkspacePaths(workspaceRoot);

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

  await fs.writeFile(
    path.join(projectRoot, 'overrides', 'patches', 'customer-normalizer.override.ts'),
    `import type { CustomerInput, NormalizedCustomerInput } from '../src/runtime/database.ts';\n\n// manual override path\nexport function normalizeCustomerInput(input: CustomerInput): NormalizedCustomerInput {\n  const name = String(input.name ?? '').trim();\n  if (!name) {\n    throw new Error('Customer name is required');\n  }\n\n  return {\n    name,\n    email: String(input.email ?? '').trim().toLowerCase(),\n    phone: String(input.phone ?? '').replace(/\\D+/g, ''),\n    company: String(input.company ?? '').trim() || 'Unknown'\n  };\n}\n`,
    'utf8'
  );

  await adaptWorkspace(workspaceRoot);
  const overriddenSource = await fs.readFile(path.join(projectRoot, 'custom', 'customer_normalizer.ts'), 'utf8');
  expect(overriddenSource).toMatch(/manual override path/);

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  await lockWorkspace(workspaceRoot);
  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  expect(graph.nodes.some((node) => node.id === 'override:customer-normalizer-manual')).toBe(true);
  expect(graph.nodes.some((node) => node.type === 'pin')).toBe(true);
  expect(graph.nodes.some((node) => node.id === 'policy:tenant-scope-required')).toBe(true);
  expect(
    graph.edges.some(
      (edge) =>
        edge.from === 'file:custom/customer_normalizer.ts' &&
        edge.to === 'override:customer-normalizer-manual' &&
        edge.type === 'originates_from'
    )
  ).toBe(true);

  const provenance = JSON.parse(await fs.readFile(path.join(projectRoot, 'provenance.json'), 'utf8')) as {
    artifacts: Array<{ path: string; originType: string; overrideStatus: string }>;
  };
  expect(
    provenance.artifacts.some(
      (artifact) =>
        artifact.path === 'custom/customer_normalizer.ts' &&
        artifact.originType === 'override' &&
        artifact.overrideStatus === 'manual'
    )
  ).toBe(true);
  expect(reviewSummary.regressionRisks).toEqual(
    expect.arrayContaining([
      {
        kind: 'override-active',
        blockId: 'entity/customer-basic',
        slotId: 'customer_normalizer',
        message: 'Override active: customer-normalizer-manual -> custom/customer_normalizer.ts'
      }
    ])
  );
  expect(reviewSummary.conflictHints).toEqual(
    expect.arrayContaining([
      {
        kind: 'override-conflict',
        relatedId: 'entity/customer-basic@>=0.2.0',
        message: 'Override customer-normalizer-manual conflicts with entity/customer-basic@>=0.2.0'
      }
    ])
  );
});

test('override-manifest surfaces ticket runtime override attribution', { timeout: 120000 }, async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-ticket-override-');
  const { overrideManifestPath, projectRoot } = getWorkspacePaths(workspaceRoot);

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
  const ticketPageOverridePath = path.join(projectRoot, 'overrides', 'patches', 'ticket-page.override.tsx');
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
  expect(reviewSummary.regressionRisks).toEqual(
    expect.arrayContaining([
      {
        kind: 'override-active',
        blockId: 'ticket/basic',
        message: 'Override active: ticket-page-runtime-manual -> app/tickets/page.tsx'
      }
    ])
  );
  expect(reviewSummary.conflictHints).toEqual(
    expect.arrayContaining([
      {
        kind: 'override-conflict',
        relatedId: 'worklog/basic@>=0.2.0',
        message: 'Override ticket-page-runtime-manual conflicts with worklog/basic@>=0.2.0'
      }
    ])
  );
  expect(
    graph.edges.some(
      (edge) =>
        edge.from === 'file:app/tickets/page.tsx' &&
        edge.to === 'override:ticket-page-runtime-manual' &&
        edge.type === 'originates_from'
    )
  ).toBe(true);
});
