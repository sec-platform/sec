import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  adaptWorkspace,
  explainWorkspace,
  lockWorkspace,
  verifyWorkspace
} from '../../src/compiler/orchestration/cli.ts';
import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { writeYaml } from '../../src/workspace/yaml.ts';
import {
  expectGraphEdge,
  expectGraphNode,
  expectReviewConflictHint,
  expectReviewRegressionRisk
} from '../helpers/graph-assertions.ts';
import { prepareComposedWorkspace } from '../testkit/workspace.ts';

test('override-manifest can replace a generated file and surface override provenance', async () => {
  const workspaceRoot = await prepareComposedWorkspace({ prefix: 'engineering-compiler-override-' });
  const { overrideManifestPath, projectRoot, provenancePath, sourceOverridesRoot } = getWorkspacePaths(workspaceRoot);

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

test('override-manifest surfaces ticket runtime override attribution', async () => {
  const workspaceRoot = await prepareComposedWorkspace({
    prefix: 'engineering-compiler-ticket-override-',
    blockIds: ['ticket/basic', 'reporting/ticket-summary', 'worklog/basic']
  });
  const { overrideManifestPath, projectRoot, sourceOverridesRoot } = getWorkspacePaths(workspaceRoot);

  const ticketServicePath = path.join(projectRoot, 'src', 'installed', 'ticket', 'ticket-service.ts');
  const ticketServiceOverride = `${await fs.readFile(ticketServicePath, 'utf8')}\n// Manual ticket runtime override active.\n`;

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'ticket-service-runtime-manual',
        entry: 'patches/ticket-service.override.ts',
        target: 'src/installed/ticket/ticket-service.ts',
        reason: 'manual-ticket-runtime-copy-change',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: ['ticket/basic@>=0.2.0', 'worklog/basic@>=0.2.0']
      }
    ]
  });
  const ticketServiceOverridePath = path.join(sourceOverridesRoot, 'patches', 'ticket-service.override.ts');
  await fs.writeFile(ticketServiceOverridePath, ticketServiceOverride, 'utf8');

  await adaptWorkspace(workspaceRoot);
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
  const ticketChangeSource = reviewSummary.changeSources.find(
    (source) => source.path === 'src/installed/ticket/ticket-service.ts'
  );

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
