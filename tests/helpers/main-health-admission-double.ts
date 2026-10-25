import { fileURLToPath } from 'node:url';
import type { RetainedBunTestWorkspaceRun } from '../testkit/process-resource.ts';

import type { OperationDigest } from '../../src/execution/operation/semantic.ts';
import type { BranchCloseoutAttempt, BranchCloseoutPreparation } from '../../src/execution/verification/branch-closeout.ts';

/** An isolated test process replaces only the original admission validator.
 * Git, its retained provider, workspace lease and CAS remain their actual
 * owners. This fixture never issues or proves a MainHealth qualification. */
export async function observeLocalRefCasWithAdmissionDouble(input: Readonly<{
  preparation: BranchCloseoutPreparation;
  operationId: OperationDigest;
  revokeAtFinalCheck?: boolean;
}>, run: RetainedBunTestWorkspaceRun): Promise<Readonly<{
  result: BranchCloseoutAttempt;
  attempts: readonly BranchCloseoutAttempt[];
  admissionChecks: number;
  realForgedAdmissionRejected: boolean;
}>> {
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
  const observed = await run(['--no-env-file', '-e', script], {
    cwd: root, input: Buffer.from(JSON.stringify(input)), maxStdinBytes: 1024 * 1024,
    env: process.env
  });
  if (observed.code !== 0) {
    throw new Error(`Isolated local CAS/admission oracle did not complete: ${observed.stderr}`);
  }
  return JSON.parse(observed.stdout) as Awaited<ReturnType<typeof observeLocalRefCasWithAdmissionDouble>>;
}
