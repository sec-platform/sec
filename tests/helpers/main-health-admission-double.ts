import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { OperationDigest } from '../../src/execution/operation/semantic.ts';
import type { BranchCloseoutAttempt, BranchCloseoutPreparation } from '../../src/execution/verification/branch-closeout.ts';

/** An isolated test process replaces only the original admission validator.
 * Git, its retained provider, workspace lease and CAS remain their actual
 * owners. This fixture never issues or proves a MainHealth qualification. */
export function observeLocalRefCasWithAdmissionDouble(input: Readonly<{
  preparation: BranchCloseoutPreparation;
  operationId: OperationDigest;
  revokeAtFinalCheck?: boolean;
}>): Readonly<{
  result: BranchCloseoutAttempt;
  attempts: readonly BranchCloseoutAttempt[];
  admissionChecks: number;
  realForgedAdmissionRejected: boolean;
}> {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const script = `
    import { mock } from 'bun:test';
    const input = JSON.parse(await Bun.stdin.text());
    const { assertHostedCloseoutMainHealthCurrent, deleteHostedLocalRefCas } =
      await import('./src/adapters/verification/platform/ci/runtime/session-branch-closeout-effects.ts');
    const { withWorkspaceWriteLease } = await import('./src/adapters/filesystem/write-lease.ts');
    const mainSha = input.preparation.expectedHeadSha;
    const qualification = {
      ctx: { repositoryRoot: input.preparation.repository.root },
      binding: { repository: input.preparation.repository.fullName,
        newMainSha: mainSha, newMainTreeSha: mainSha },
      health: {
        ledger: { repository: input.preparation.repository.fullName, defaultBranch: 'main',
          mainSha, mainTreeSha: mainSha, trustRevision: mainSha },
        admission: { repositoryRoot: input.preparation.repository.root,
          authority: {}, receipt: {} },
        assertCurrent: async () => { await Promise.resolve(); }
      }
    };
    let realForgedAdmissionRejected = false;
    try { await assertHostedCloseoutMainHealthCurrent(qualification); }
    catch { realForgedAdmissionRejected = true; }
    if (!realForgedAdmissionRejected) throw new Error('Real native validator accepted a fabricated admission.');
    let admissionChecks = 0;
    mock.module('./src/adapters/self-hosting/control/main-health/live-admission.ts', {
      assertTrustedRuntimeMainHealthPublication: () => {
        admissionChecks += 1;
        if (input.revokeAtFinalCheck && admissionChecks > 1) {
          throw new Error('Isolated test admission was revoked after retained Git preparation.');
        }
      }
    });
    const attempts = [];
    const result = await withWorkspaceWriteLease(input.preparation.repository.commonDir, undefined,
      lease => deleteHostedLocalRefCas(input.preparation, attempts, lease, input.operationId, qualification));
    process.stdout.write(JSON.stringify({ result, attempts, admissionChecks, realForgedAdmissionRejected }));
  `;
  const observed = spawnSync(process.execPath, ['--no-env-file', '-e', script], {
    cwd: root, input: JSON.stringify(input), encoding: 'utf8', windowsHide: true,
    env: process.env, maxBuffer: 1024 * 1024
  });
  if (observed.status !== 0) {
    throw new Error(`Isolated local CAS/admission oracle did not complete: ${observed.stderr}`);
  }
  return JSON.parse(observed.stdout) as ReturnType<typeof observeLocalRefCasWithAdmissionDouble>;
}
