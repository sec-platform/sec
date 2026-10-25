import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { afterAll, expect, test } from 'bun:test';
import { chmod, lstat, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath } from '../../../src/adapters/workspace-context.ts';
import { saveLock } from '../../../src/adapters/workspace/lock.ts';
import { ensureCanonicalWorkspaceArtifactParents } from '../../../src/adapters/workspace/project-base.ts';
import { loadPlan } from '../../../src/adapters/workspace/sources/load-plan.ts';
import { writeYaml } from '../../../src/adapters/workspace/yaml.ts';
import { resolveWorkspace } from '../../../src/bootstrap/engineering/block-orchestrator.ts';
import { composeWorkspace } from '../../../src/bootstrap/engineering/compose-orchestrator.ts';
import { explainWorkspace, lockWorkspace, observeWorkspaceArtifacts, writeWorkspaceArtifacts } from '../../../src/bootstrap/engineering/emit-orchestrator.ts';
import { repairWorkspace } from '../../../src/bootstrap/engineering/repair-orchestrator.ts';
import { buildWorkspaceEngineeringIR } from '../../../src/bootstrap/engineering/semantic-orchestrator.ts';
import { verifyWorkspace } from '../../../src/bootstrap/engineering/verify-orchestrator.ts';
import { initWorkspace } from '../../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { upgradeWorkspace } from '../../../src/bootstrap/upgrade/orchestration.ts';
import { buildReviewLock } from '../../helpers/review-fixtures.ts';
import { copyWorkspaceFixture } from '../../testkit/workspace-files.ts';

let templateRoot: string | undefined;
let preparedTemplate: Promise<{ root: string; lockMode: number }> | undefined;

afterAll(async () => {
  if (templateRoot !== undefined) await rm(templateRoot, { recursive: true, force: true });
});

function rootCaptureTemplate(): Promise<{ root: string; lockMode: number }> {
  return preparedTemplate ??= (async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-root-template-'));
    templateRoot = root;
    await initWorkspace(root);
    // Root identity needs a real workspace, not the complete official catalog.
    const planPath = getWorkspacePaths(root).workspaceConfigPath;
    const plan = loadPlan(planPath);
    plan.registry.sources = [{ id: 'root-test', kind: 'private', location: 'workspace', path: '.root-test-registry' }];
    await mkdir(path.join(root, '.root-test-registry'));
    await writeYaml(planPath, plan);
    // Satisfy stage prerequisites, but keep verification artifacts absent:
    // domain rejection must remain the same, not become a locator failure.
    await saveLock(root, buildReviewLock({
      app: {
        id: plan.app.id,
        name: plan.app.name,
        stack: plan.app.stack,
        mode: plan.app.mode
      },
      acceptancePlan: plan.acceptance.map(({ id }) => id).sort(),
      passStatus: { lock: 'succeeded' }
    }));
    return { root, lockMode: (await lstat(await resolveWorkspaceLockPath(root))).mode & 0o777 };
  })();
}

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
    const roots = [baseline];
    await settleWorkspaceCallback(async () => {
      const target = await mkdtemp(path.join(tmpdir(), 'sec-root-target-'));
      roots.push(target);
      const decoy = await mkdtemp(path.join(tmpdir(), 'sec-root-decoy-'));
      roots.push(decoy);
      const observe = async (pending: Promise<unknown>, root: string) => {
        try { const value = await pending; return { status: 'returned', ...(operation.name === 'inventory' ? { value } : {}) }; }
        catch (error) {
          const failure = error as Error & { code?: string };
          return { status: 'rejected', name: failure.name, code: failure.code,
            message: failure.message.split(root).join('<workspace>') };
        }
      };
      if (!operation.fresh) {
        const template = await rootCaptureTemplate();
        for (const root of [baseline, target]) {
          // Independent native copies carry only data, never the initializer's
          // root-bound create journal, lease generations or retained authority.
          await copyWorkspaceFixture(template.root, root);
          await ensureCanonicalWorkspaceArtifactParents(root);
          await mkdir(getWorkspacePaths(root).cacheRoot, { recursive: true });
          await chmod(await resolveWorkspaceLockPath(root), template.lockMode);
        }
      }
      const expected = await observe(operation.run(baseline), baseline);
      const pending = operation.run(path.relative(cwd, target));
      const observed = observe(pending, target);
      const actual = await settleWorkspaceCallback(async () => {
        process.chdir(decoy);
        return await observed;
      }, async () => { await observed; });
      expect(actual).toEqual(expected);
      expect(await readdir(decoy)).toEqual([]);
      if (['init', 'resolve', 'engineering input'].includes(operation.name)) {
        if (actual.status !== 'returned') {
          throw new Error(`Expected successful ${operation.name} root capture: ${JSON.stringify(actual)}`);
        }
      }
    }, async () => {
      await settleResourcesAsync({ cleanup: [
        { label: 'original cwd', settle: () => process.chdir(cwd) },
        ...roots.map(root => ({ label: root, settle: () => rm(root, { recursive: true, force: true }) }))
      ] });
    });
  // Real resolve includes two temporary-project typechecks. Use the existing
  // execution budget; a Bun timeout would otherwise let cwd cleanup overlap.
  }, operation.name === 'resolve' ? DEFAULT_TEST_TIMEOUT_MS : undefined);
}
