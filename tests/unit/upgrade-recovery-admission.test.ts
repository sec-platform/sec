import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each child keeps its narrow admission-boundary interleaving local. The
// inventory, file writes, fresh observations and reverse CAS are real providers.
for (const changed of ['live', 'original'] as const) {
  test(`recovery refuses ${changed} bytes changed between census and retained observation`, async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'sec-upgrade-admission-case-'));
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const script = path.join(temporary, 'case.ts');
    try {
      await Bun.write(
        script,
        `
        import { mock } from 'bun:test';
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import os from 'node:os';
        import path from 'node:path';
        const repo = ${JSON.stringify(repo)};
        const intentPath = path.join(repo, 'src/adapters/upgrade/recovery-intent.ts');
        const intent = await import(intentPath);
        const admitted = intent.admitUpgradeRecovery;
        let interleave;
        mock.module(intentPath, () => ({ ...intent, admitUpgradeRecovery(...args) {
          const selected = admitted(...args);
          interleave?.(); interleave = undefined;
          return selected;
        }}));
        const { snapshotWorkspace, restoreWorkspace, retireUpgradeBackup } = await import(path.join(repo, 'src/adapters/upgrade/workspace-snapshot.ts'));
        const { updateNoFollowMigrationFile } = await import(path.join(repo, 'src/adapters/upgrade/migration-physical.ts'));
        const { resolveWorkspaceArtifactPath } = await import(path.join(repo, 'src/adapters/workspace-context.ts'));
        const { CI_ARTIFACT_FILES } = await import(path.join(repo, 'src/assurance/verification/ci-artifacts/contract/manifest.ts'));
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-upgrade-admission-native-'));
        const target = path.join(root, 'sec.yaml');
        const lock = resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.graphLock);
        const before = Buffer.from('original B\\n'), after = Buffer.from('owned A\\n'), foreign = Buffer.from('foreign change\\n');
        const fence = async () => {};
        let snapshot;
        try {
          fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.writeFileSync(target, before);
          snapshot = await snapshotWorkspace(root, lock, fence, {
            operationIdentityDigest: 'sha256:' + '1'.repeat(64), attemptRevision: 'sha256:' + '2'.repeat(64)
          });
          await updateNoFollowMigrationFile({ root, targetPath: target, label: 'Admitted update',
            commitFence: fence, recoveryIntent: snapshot.recoveryIntent, createParents: false, update: () => after });
          interleave = () => fs.writeFileSync(${JSON.stringify(changed)} === 'live' ? target : path.join(snapshot.preimage.path, 'sec.yaml'), foreign);
          await assert.rejects(restoreWorkspace(snapshot, lock, fence), error => error.code === 'UPGRADE-BLOCKED-005');
          assert.deepEqual(fs.readFileSync(target), ${JSON.stringify(changed)} === 'live' ? foreign : after);
          console.log('unadmitted bytes preserved');
        } finally {
          interleave = undefined;
          if (snapshot) {
            if (${JSON.stringify(changed)} === 'original') fs.writeFileSync(path.join(snapshot.preimage.path, 'sec.yaml'), before);
            await retireUpgradeBackup(snapshot);
          }
          fs.rmSync(root, { recursive: true, force: true });
        }
      `
      );
      const child = Bun.spawn([process.execPath, script], { stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text()
      ]);
      expect(code, stderr).toBe(0);
      expect(stdout.trim()).toBe('unadmitted bytes preserved');
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
