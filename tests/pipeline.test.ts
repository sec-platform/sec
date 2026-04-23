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
  assert.equal(report.summary.requestedLane, 'all');
  assert.equal(report.build.status, 'passed');
  assert.equal(report.policy.status, 'passed');
  assert.equal(report.fast.status, 'passed');
  assert.equal(report.runtime.status, 'passed');

  const locked = await lockWorkspace(workspaceRoot);
  assert.equal(locked.passStatus.lock, 'succeeded');
  assert.equal(locked.passStatus.emit, 'succeeded');
  assert.ok(locked.generatedPaths.includes('generated/runtime-report.json'));
  assert.ok(locked.generatedPaths.includes('generated/policy-report.json'));
  assert.ok(locked.generatedPaths.includes('generated/acceptance-coverage.json'));

  const provenance = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'provenance.json'), 'utf8')
  ) as { artifacts: Array<{ path: string; originType: string }> };
  assert.ok(
    provenance.artifacts.some(
      (artifact) => artifact.path === 'custom/customer_normalizer.ts' && artifact.originType === 'slot'
    )
  );

  const runtimeReport = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'runtime-report.json'), 'utf8')
  ) as { status: string; build: { status: string }; acceptance: { status: string } };
  assert.equal(runtimeReport.status, 'passed');
  assert.equal(runtimeReport.build.status, 'passed');
  assert.equal(runtimeReport.acceptance.status, 'passed');

  const coverage = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'acceptance-coverage.json'), 'utf8')
  ) as { status: string; uncoveredBlocks: string[]; uncoveredSlots: string[] };
  assert.equal(coverage.status, 'passed');
  assert.deepEqual(coverage.uncoveredBlocks, []);
  assert.deepEqual(coverage.uncoveredSlots, []);

  const policyReport = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'generated', 'policy-report.json'), 'utf8')
  ) as { status: string; violations: unknown[] };
  assert.equal(policyReport.status, 'passed');
  assert.deepEqual(policyReport.violations, []);

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  assert.ok(graph.nodes.some((node) => node.id === 'slot:customer_normalizer'));
  assert.ok(graph.edges.some((edge) => edge.type === 'writes_to' && edge.to === 'file:custom/customer_normalizer.ts'));
  assert.deepEqual(reviewSummary.failurePoints, []);
  assert.ok(
    await fs
      .access(path.join(workspaceRoot, 'project', 'generated', 'views', 'source-view.html'))
      .then(() => true)
      .catch(() => false)
  );
  assert.ok(
    await fs
      .access(path.join(workspaceRoot, 'project', 'generated', 'views', 'slot-rule-view.html'))
      .then(() => true)
      .catch(() => false)
  );

  const refreshedProvenance = JSON.parse(
    await fs.readFile(path.join(workspaceRoot, 'project', 'provenance.json'), 'utf8')
  ) as { artifacts: Array<{ path: string; generatedByPass?: string }> };
  assert.ok(
    refreshedProvenance.artifacts.some(
      (artifact) => artifact.path === 'generated/explain-graph.json' && artifact.generatedByPass === 'explain'
    )
  );
});

test('fast lane alone does not unlock the workspace', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-fast-lane-'));

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);

  const { report } = await verifyWorkspace(workspaceRoot, { lane: 'fast' });
  assert.equal(report.summary.status, 'passed');
  assert.equal(report.summary.requestedLane, 'fast');
  await assert.rejects(
    async () => lockWorkspace(workspaceRoot),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'LOCK-BLOCKED-001'
  );
});

test('compose refreshes runtime host scaffold for an existing workspace baseline', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-compose-refresh-'));
  const projectRoot = path.join(workspaceRoot, 'project');

  await initWorkspace(workspaceRoot, { reset: true });
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'stale-generated-project',
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  const projectPackage = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(projectPackage.scripts.build, 'next build');
  assert.equal(projectPackage.scripts['verify:runtime'], 'npm run build && npm run test:unit && npm run test:acceptance');
});
