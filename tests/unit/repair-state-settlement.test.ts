import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { readLockFile, saveLock } from '../../src/adapters/workspace/lock.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildPassingReviewReport } from '../helpers/review-fixtures.ts';

// Failure injection is confined to an isolated process. The real repair entry,
// artifact reader, plan builder and physical lease lifecycle still execute.
test('repair preserves its first publication failure when failure-state persistence also rejects', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-repair-settlement-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  try {
    await initWorkspace(root);
    const lock = readLockFile(root); lock.passStatus.verify = 'succeeded';
    await saveLock(root, lock);
    await writeFile(resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.verificationReport), JSON.stringify(buildPassingReviewReport()));
    const script = path.join(root, 'settlement.ts');
    await writeFile(script, `
      import { mock } from 'bun:test';
      const locks = await import(${JSON.stringify(path.join(repo, 'src/adapters/workspace/lock.ts'))});
      const plans = await import(${JSON.stringify(path.join(repo, 'src/adapters/verification/repair/build-repair-plan.ts'))});
      const primary = Object.freeze({ reason: 'publication-failed' });
      const secondary = Object.freeze({ reason: 'state-write-failed' });
      let publications = 0, settlements = 0;
      mock.module(${JSON.stringify(path.join(repo, 'src/adapters/workspace/lock.ts'))}, () => ({
        ...locks, saveLock: async () => { settlements++; throw secondary; }
      }));
      mock.module(${JSON.stringify(path.join(repo, 'src/adapters/verification/repair/build-repair-plan.ts'))}, () => ({
        ...plans, writeRepairPlan: async () => { publications++; throw primary; }
      }));
      const { repairWorkspace } = await import(${JSON.stringify(path.join(repo, 'src/bootstrap/engineering/repair-orchestrator.ts'))});
      try { await repairWorkspace(${JSON.stringify(root)}); throw new Error('unexpected success'); }
      catch (error) {
        if (!(error instanceof AggregateError) || error.cause !== primary || error.errors[0] !== primary || error.errors[1] !== secondary)
          throw new Error('original publication failure was lost');
      }
      if (publications !== 1 || settlements !== 1) throw new Error('operation was retried or omitted');
      console.log('both failures retained');
    `);
    const child = Bun.spawn([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0); expect(stdout.trim()).toBe('both failures retained');
  } finally { await rm(root, { recursive: true, force: true }); }
});
