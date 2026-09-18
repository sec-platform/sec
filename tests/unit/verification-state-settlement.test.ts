import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { readLockFile, saveLock } from '../../src/adapters/workspace/lock.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';

// Isolate the engine, policy observation and final publication in a child.
// Actual request, lease and failed-snapshot construction retain their owners.
for (const lane of ['fast', 'runtime'] as const) for (const rejectPublication of [false, true]) {
  test(`${lane} verification preserves integrity failure when snapshot rejection=${rejectPublication}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-verify-settlement-'));
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    try {
      await initWorkspace(root);
      const lock = readLockFile(root);
      Object.assign(lock.passStatus, { parse: 'succeeded', align: 'succeeded', resolve: 'succeeded', compose: 'succeeded' });
      lock.semanticLoweringTasks = [];
      lock.semanticViews = buildSemanticViewFixture();
      await saveLock(root, lock);
      const script = path.join(root, 'settlement.ts');
      await writeFile(script, `
        import { mock } from 'bun:test';
        const engine = await import(${JSON.stringify(path.join(repo, 'src/adapters/verification/verify-project.ts'))});
        const { ProjectIntegrityError } = await import(${JSON.stringify(path.join(repo, 'src/workspace/contract/project-integrity.ts'))});
        const { PipelineSettlementFailure } = await import(${JSON.stringify(path.join(repo, 'src/adapters/compilation/pipeline/failure.ts'))});
        const primary = new ProjectIntegrityError('source no longer matches its provenance');
        const secondary = Object.freeze({ reason: 'snapshot-write-failed' });
        let executions = 0, publications = 0;
        mock.module(${JSON.stringify(path.join(repo, 'src/adapters/verification/verify-project.ts'))}, () => ({
          ...engine, verifyProject: async () => { executions++; throw primary; }
        }));
        mock.module(${JSON.stringify(path.join(repo, 'src/adapters/verification/verification-artifact-publication.ts'))}, () => ({
          publishVerificationArtifactSet: async (input) => {
            publications++;
            await input.commitFence();
            if (input.artifacts.verificationReport.summary.status !== 'failed') throw new Error('invented success snapshot');
            if (${rejectPublication}) throw secondary;
          }
        }));
        mock.module(${JSON.stringify(path.join(repo, 'src/adapters/verification/run-policy-gate.ts'))}, () => ({
          runPolicyGate: async () => ({ status: 'skipped', official: { policies: [], sources: [], violations: [] },
            project: { policies: [], sources: [], violations: [] }, merged: { policies: [] }, violations: [], diagnostics: [] })
        }));
        const { verifyWorkspace } = await import(${JSON.stringify(path.join(repo, 'src/bootstrap/engineering/verify-orchestrator.ts'))});
        try { await verifyWorkspace(${JSON.stringify(root)}, { lane: ${JSON.stringify(lane)} }); throw new Error('unexpected success'); }
        catch (error) {
          if (${lane !== 'runtime' && rejectPublication}) {
            if (!(error instanceof PipelineSettlementFailure) || error.cause !== primary
                || error.settlementFailures[0]?.operation !== 'verification-blocked-snapshot'
                || error.settlementFailures[0]?.reason !== secondary)
              throw new Error('original verification failure was lost');
          } else if (error !== primary) throw new Error('primary verification failure was replaced: ' + error);
        }
        if (executions !== 1 || publications !== ${lane === 'runtime' ? 0 : 1}) throw new Error('work was omitted or repeated');
        console.log('verification and settlement boundaries retained');
      `);
      const child = Bun.spawn([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, stderr).toBe(0);
      expect(stdout.trim()).toBe('verification and settlement boundaries retained');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
