import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  initWorkspace,
  resolveWorkspace,
  composeWorkspace,
  adaptWorkspace,
  verifyWorkspace,
  lockWorkspace,
  explainWorkspace
} from '../platform/orchestrator.ts';

test('v0.1 pipeline runs end to end in a temporary workspace', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-'));

  await initWorkspace(workspaceRoot, { reset: true });
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  assert.equal(resolvedLock.resolvedBlocks.length, 3);
  assert.equal(resolvedLock.slotTasks.length, 1);

  await composeWorkspace(workspaceRoot);
  const skeleton = await fs.readFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    'utf8'
  );
  assert.match(skeleton, /Not implemented/);

  await adaptWorkspace(workspaceRoot);
  const synthesized = await fs.readFile(
    path.join(workspaceRoot, 'project', 'custom', 'customer_normalizer.ts'),
    'utf8'
  );
  assert.match(synthesized, /normalizeCustomerInput/);
  assert.match(synthesized, /Unknown/);

  const { report } = await verifyWorkspace(workspaceRoot);
  assert.equal(report.summary.status, 'passed');
  assert.equal(report.build.status, 'passed');

  const locked = await lockWorkspace(workspaceRoot);
  assert.equal(locked.passStatus.lock, 'succeeded');
  assert.equal(locked.passStatus.emit, 'succeeded');

  const provenance = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'provenance.json'), 'utf8')
  ) as { artifacts: Array<{ path: string; originType: string }> };
  assert.ok(
    provenance.artifacts.some(
      (artifact) => artifact.path === 'custom/customer_normalizer.ts' && artifact.originType === 'slot'
    )
  );

  const { graph } = await explainWorkspace(workspaceRoot);
  assert.ok(graph.nodes.some((node) => node.id === 'slot:customer_normalizer'));
  assert.ok(graph.edges.some((edge) => edge.type === 'writes_to' && edge.to === 'file:custom/customer_normalizer.ts'));

  const refreshedProvenance = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'provenance.json'), 'utf8')
  ) as { artifacts: Array<{ path: string; generatedByPass?: string }> };
  assert.ok(
    refreshedProvenance.artifacts.some(
      (artifact) => artifact.path === 'generated/explain-graph.json' && artifact.generatedByPass === 'explain'
    )
  );
});
