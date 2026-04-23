import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  adaptWorkspace,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

test('override-manifest can replace a generated file and surface override provenance', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-override-'));
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
  assert.match(overriddenSource, /manual override path/);

  const { report } = await verifyWorkspace(workspaceRoot);
  assert.equal(report.summary.status, 'passed');

  await lockWorkspace(workspaceRoot);
  const { graph } = await explainWorkspace(workspaceRoot);
  assert.ok(graph.nodes.some((node) => node.id === 'override:customer-normalizer-manual'));
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.from === 'file:custom/customer_normalizer.ts' &&
        edge.to === 'override:customer-normalizer-manual' &&
        edge.type === 'originates_from'
    )
  );

  const provenance = JSON.parse(await fs.readFile(path.join(projectRoot, 'provenance.json'), 'utf8')) as {
    artifacts: Array<{ path: string; originType: string; overrideStatus: string }>;
  };
  assert.ok(
    provenance.artifacts.some(
      (artifact) =>
        artifact.path === 'custom/customer_normalizer.ts' &&
        artifact.originType === 'override' &&
        artifact.overrideStatus === 'manual'
    )
  );
});
