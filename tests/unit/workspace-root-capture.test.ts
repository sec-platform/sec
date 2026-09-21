import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { resolveWorkspace } from '../../src/bootstrap/engineering/block-orchestrator.ts';
import { buildWorkspaceEngineeringIR } from '../../src/bootstrap/engineering/semantic-orchestrator.ts';
import { lockWorkspace, explainWorkspace, writeWorkspaceArtifacts, observeWorkspaceArtifacts } from '../../src/bootstrap/engineering/emit-orchestrator.ts';
import { repairWorkspace } from '../../src/bootstrap/engineering/repair-orchestrator.ts';
import { composeWorkspace } from '../../src/bootstrap/engineering/compose-orchestrator.ts';
import { verifyWorkspace } from '../../src/bootstrap/engineering/verify-orchestrator.ts';
import { upgradeWorkspace } from '../../src/bootstrap/upgrade/orchestration.ts';
import { getWorkspacePaths } from '../../src/adapters/workspace-context.ts';
import { loadPlan } from '../../src/adapters/workspace/sources/load-plan.ts';
import { writeYaml } from '../../src/adapters/workspace/yaml.ts';
import { saveLock } from '../../src/adapters/workspace/lock.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';

type Operation = { name: string; run(root: string): Promise<unknown>; fresh?: boolean };
const operations: Operation[] = [
  { name: 'init', run: root => initWorkspace(root), fresh: true },
  { name: 'resolve', run: root => resolveWorkspace(root) },
  { name: 'engineering input', run: root => buildWorkspaceEngineeringIR(root) },
  { name: 'inventory', run: root => observeWorkspaceArtifacts(root) },
  { name: 'artifact publication', run: root => writeWorkspaceArtifacts(root) },
  { name: 'repair', run: root => repairWorkspace(root) },
  { name: 'compose', run: root => composeWorkspace(root) },
  { name: 'lock', run: root => lockWorkspace(root) },
  { name: 'explain', run: root => explainWorkspace(root) },
  { name: 'verify', run: root => verifyWorkspace(root, { signal: AbortSignal.abort() }) },
  { name: 'upgrade', run: root => upgradeWorkspace(root, 'absent/block', '1.0.0') }
];

for (const operation of operations) {
  test(`${operation.name} binds its workspace before the first suspension`, async () => {
    const cwd = process.cwd();
    const baseline = await mkdtemp(path.join(tmpdir(), 'sec-root-baseline-'));
    const target = await mkdtemp(path.join(tmpdir(), 'sec-root-target-'));
    const decoy = await mkdtemp(path.join(tmpdir(), 'sec-root-decoy-'));
    const observe = async (pending: Promise<unknown>, root: string) => {
      try { const value = await pending; return { status: 'returned', ...(operation.name === 'inventory' ? { value } : {}) }; }
      catch (error) {
        const failure = error as Error & { code?: string };
        return { status: 'rejected', name: failure.name, code: failure.code,
          message: failure.message.split(root).join('<workspace>') };
      }
    };
    try {
      if (!operation.fresh) for (const root of [baseline, target]) {
        await initWorkspace(root);
        // This test exercises root identity, not the complete official catalog.
        // A real, empty private registry keeps the native resolver bounded.
        const planPath = getWorkspacePaths(root).workspaceConfigPath;
        const plan = loadPlan(planPath);
        plan.registry.sources = [{ id: 'root-test', kind: 'private', location: 'workspace', path: '.root-test-registry' }];
        await mkdir(path.join(root, '.root-test-registry'));
        await writeYaml(planPath, plan);
        // Satisfy stage prerequisites, but keep verification artifacts absent:
        // domain rejection must remain the same, not become a locator failure.
        await saveLock(root, buildReviewLock({ passStatus: { lock: 'succeeded' } }));
      }
      const expected = await observe(operation.run(baseline), baseline);
      const pending = operation.run(path.relative(cwd, target));
      process.chdir(decoy);
      const actual = await observe(pending, target);
      expect(actual).toEqual(expected);
      expect(await readdir(decoy)).toEqual([]);
      if (['init', 'resolve', 'engineering input'].includes(operation.name)) {
        expect(actual.status).toBe('returned');
      }
    } finally {
      process.chdir(cwd);
      await Promise.all([baseline, target, decoy].map(root => rm(root, { recursive: true, force: true })));
    }
  // Real resolve includes two temporary-project typechecks. Use the existing
  // execution budget; a Bun timeout would otherwise let cwd cleanup overlap.
  }, operation.name === 'resolve' ? DEFAULT_TEST_TIMEOUT_MS : undefined);
}
