import { expect, test } from 'bun:test';
import {
  parseExactRefRetirement, parsePlannedRefSupersessionReview
} from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import { parseExactRemoteRefBatchRecoveryPreparation } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const HEAD = 'b'.repeat(40);
const MAIN = 'a'.repeat(40);
const review = {
  kind: 'branch-supersession-review', version: 4, repository: 'sec-platform/sec',
  branch: 'fix/old', headSha: HEAD, headTreeSha: 'c'.repeat(40),
  currentMainSha: MAIN, currentMainTreeSha: 'd'.repeat(40), mergeBaseSha: 'e'.repeat(40),
  mergeBaseTreeSha: 'f'.repeat(40), reviewer: 'source review', verdict: 'approved',
  sourcePathSet: { count: 2, digest: `sha256:${'1'.repeat(64)}` },
  assessment: 'All exact source changes have a retained or superseding consumer.', unknowns: []
};

function preparation() {
  const retirements = [parseExactRefRetirement({ classification: 'reviewed-plan-superseded',
    branches: ['fix/old'], expectedHeadSha: HEAD, review })];
  const request = { schema: 'sec-repository-maintenance-request-v2', repository: 'sec-platform/sec',
    expectedMainSha: MAIN, operations: retirements.map((retirement) => ({ kind: 'exact-ref-retirement', retirement })) };
  return { schema: 'sec-exact-ref-batch-recovery-preparation-v1', repository: request.repository,
    expectedMainSha: MAIN, requestDigest: sha256(request), retirements,
    refs: [{ branch: 'fix/old', expectedHeadSha: HEAD, refState: 'present', blocker: null }],
    recovery: { bundleName: 'sec-branch-closeout-batch-plan.bundle', sha256: `sha256:${'2'.repeat(64)}`,
      verifyOutput: 'complete native bundle' } };
}

test('fixed batch preparation rejects changed plans, duplicate refs and incomplete source review', () => {
  expect(parseExactRemoteRefBatchRecoveryPreparation(preparation()).refs).toHaveLength(1);
  expect(() => parsePlannedRefSupersessionReview({ ...review, unknowns: ['unread source'] })).toThrow();
  expect(() => parsePlannedRefSupersessionReview({ ...review, issueNumber: 313 })).toThrow();
  expect(() => parseExactRefRetirement({ classification: 'reviewed-plan-superseded',
    branches: ['fix/other'], expectedHeadSha: HEAD, review })).toThrow('differs');
  const changed = preparation();
  changed.refs[0]!.expectedHeadSha = MAIN;
  expect(() => parseExactRemoteRefBatchRecoveryPreparation(changed)).toThrow('differs');
  const duplicated = preparation();
  duplicated.retirements.push(duplicated.retirements[0]!);
  duplicated.refs.push(duplicated.refs[0]!);
  expect(() => parseExactRemoteRefBatchRecoveryPreparation(duplicated)).toThrow('duplicate');
  expect(() => parseExactRemoteRefBatchRecoveryPreparation({ ...preparation(), requestDigest: `sha256:${'3'.repeat(64)}` }))
    .toThrow('fixed dispatch');
});

test('preparation v2 preserves historical absence independently of the latest present state and reads v1 conservatively', () => {
  const legacy = preparation();
  expect(parseExactRemoteRefBatchRecoveryPreparation(legacy).refs[0]!.absenceObserved).toBe(false);
  const current = { ...legacy, schema: 'sec-exact-ref-batch-recovery-preparation-v2',
    refs: legacy.refs.map((row) => ({ ...row, absenceObserved: true })) };
  expect(parseExactRemoteRefBatchRecoveryPreparation(current).refs[0]).toMatchObject({ refState: 'present', absenceObserved: true });
  expect(() => parseExactRemoteRefBatchRecoveryPreparation({ ...current,
    refs: current.refs.map((row) => ({ ...row, refState: 'absent', absenceObserved: false })) })).toThrow('exact plan');
  expect(() => parseExactRemoteRefBatchRecoveryPreparation({ ...current,
    refs: legacy.refs })).toThrow('fields');
});

// Reuse the provider's existing test session; the production receipt parser,
// request compiler, archive digest check, and ZIP reader remain real.
const api = await import('../../src/adapters/providers/github-api/operation-session.ts');
const { issueGitHubApiTestCapability, withGitHubApiTestSession } = await import('../../src/adapters/providers/github-api/test/operation-session.ts');
const { rawSha256 } = await import('../../src/contracts/canonical.ts');
const { mock } = await import('bun:test');
const { ZipFile } = require('yazl');
let historyCapability: Parameters<typeof withGitHubApiTestSession>[0]['capability'] | undefined;
mock.module('../../src/adapters/providers/github-api/operation-session.ts', () => ({ ...api,
  withGitHubApiVerificationSession: async (input: Parameters<typeof api.withGitHubApiVerificationSession>[0]) => {
    expect(input.effect).toBe('verification-read');
    expect(input.repository).toBe('sec-platform/sec');
    if (historyCapability === undefined) throw new Error('Missing history test session');
    return withGitHubApiTestSession({ capability: historyCapability, operation: () => input.operation(historyCapability!) });
  }
}));
const { observeExactRefBatchResumeReceipt } = await import('../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts');

for (const fault of ['none', 'run', 'request', 'archive'] as const) {
  test.serial(`historical receipt verification-read ${fault}`, async () => {
    const prepared = preparation();
    const receipt = { schema: 'sec-repository-maintenance-result-v3', requestDigest: prepared.requestDigest as string,
      resumeReceipt: null, recoveryPreparation: prepared,
      recoveryCarrier: { provider: 'github-actions-artifact', repository: 'sec-platform/sec', artifactId: 2,
        artifactName: 'sec-repository-maintenance-recovery-10-1', artifactDigest: `sha256:${'f'.repeat(64)}`,
        runId: 10, runAttempt: 1, requestedRetentionDays: 30,
        createdAt: '2026-10-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z',
        url: 'https://github.com/sec-platform/sec/actions/runs/10/artifacts/2' },
      progress: ['effect-started', 'effect-returned', 'absence-observed'].map(phase => ({ branch: 'fix/old', expectedHeadSha: HEAD, phase })),
      results: [{ branch: 'fix/old', expectedHeadSha: HEAD, status: 'retired' as const, targetState: 'absent' as const,
        effectOutcome: 'acknowledged' as const, detail: 'Original acknowledged deletion and absence readback' }] };
    if (fault === 'request') receipt.requestDigest = `sha256:${'0'.repeat(64)}`;
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(receipt)), 'maintenance-result.json');
    const archivePromise = new Response(zip.outputStream).arrayBuffer();
    zip.end();
    const archive = new Uint8Array(await archivePromise);
    const archiveDigest = rawSha256(archive);
    const received = archive.slice();
    if (fault === 'archive') received[0] = received[0]! ^ 1;
    const requests: string[] = [];
    historyCapability = issueGitHubApiTestCapability({ repository: 'sec-platform/sec', token: 'test-token-0123456789',
      principal: { transport: 'github-rest-token', login: 'reader', nodeId: 'READER', userId: 1, permission: 'read' },
      effect: 'verification-read', transport: async (target, init) => {
        expect(init?.method).toBe('GET'); // The historical lane can issue no mutation.
        const url = new URL(String(target)); requests.push(url.pathname);
        if (url.pathname.endsWith('/attempts/1')) return Response.json({ id: 10, run_attempt: 1,
          path: '.github/workflows/repository-maintenance.yml', event: 'workflow_dispatch', status: 'completed',
          head_sha: fault === 'run' ? HEAD : MAIN, head_branch: 'main',
          repository: { full_name: 'sec-platform/sec' }, head_repository: { full_name: 'sec-platform/sec' },
          actor: { type: 'User' }, display_title: `maintenance/${sha256({ requestDigest: prepared.requestDigest, resumeReceipt: null })}` });
        if (url.pathname.endsWith('/artifacts/1')) return Response.json({ id: 1,
          name: 'sec-repository-maintenance-result-10-1', workflow_run: { id: 10 }, expired: false,
          size_in_bytes: archive.byteLength, digest: archiveDigest });
        if (url.pathname.endsWith('/artifacts/1/zip')) return new Response(null, { status: 302,
          headers: { location: 'https://fixture.blob.core.windows.net/receipt.zip' } });
        if (url.hostname === 'fixture.blob.core.windows.net') {
          expect(new Headers(init?.headers).has('authorization')).toBe(false);
          return new Response(received);
        }
        throw new Error(`Unexpected historical read: ${url.pathname}`);
      } });
    try {
      const result = observeExactRefBatchResumeReceipt({ repositoryRoot: process.cwd(), repository: prepared.repository,
        expectedMainSha: MAIN, retirements: prepared.retirements, requestDigest: prepared.requestDigest,
        resumeReceipt: { artifactId: '1', artifactDigest: archiveDigest, runId: '10', runAttempt: 1 } });
      if (fault === 'none') {
        expect((await result).results).toEqual(receipt.results);
        expect(requests).toHaveLength(4);
      } else {
        await expect(result).rejects.toThrow(fault === 'run' ? 'trusted completed' : fault === 'request' ? 'fixed request' : 'archive identity');
      }
    } finally { historyCapability = undefined; }
  });
}
