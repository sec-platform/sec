import { mock } from 'bun:test';
import path from 'node:path';
import type { GitHubApiCapability, GitHubApiOperation } from '../../src/adapters/providers/github-api/operation-session.ts';
import type { BranchLifecycleInventory, BranchRecoveryAuthority } from '../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-contract.ts';
import type { ExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import type { ExactRefBatchRecoveryCarrier, ExactRefBatchResumeLocator, ExactRemoteRefBatchProgress, ExactRemoteRefBatchRecoveryPreparation, ExactRemoteRefBatchResult } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

export const MAIN = 'a'.repeat(40);
export const HEAD = 'b'.repeat(40);
export const TREE = 'c'.repeat(40);
export const OTHER = 'd'.repeat(40);
export const REPOSITORY = 'sec-platform/sec';
export const ROOT = path.resolve('exact-ref-retirement-fixture');
export const RECOVERY: BranchRecoveryAuthority = Object.freeze({ kind: 'bundle',
  path: path.resolve('exact-ref-retirement-recovery/sec-branch-closeout-fixture.bundle'),
  sha256: `sha256:${'e'.repeat(64)}`, verified: true, verifyOutput: 'verified independent recovery fixture' });
export const CARRIER: ExactRefBatchRecoveryCarrier = Object.freeze({ provider: 'github-actions-artifact',
  repository: REPOSITORY, artifactId: 1, artifactName: 'sec-repository-maintenance-recovery-10-1',
  artifactDigest: `sha256:${'f'.repeat(64)}`, runId: 10, runAttempt: 1,
  requestedRetentionDays: 30, createdAt: '2026-10-01T00:00:00.000Z', expiresAt: '2100-01-01T00:00:00.000Z',
  url: 'https://github.com/sec-platform/sec/actions/runs/10/artifacts/1' });

type Phase = 'static' | 'before' | 'after';
export type Fault = 'head-drift' | 'main-drift' | 'open-consumer' | 'closed-pull-changed'
  | 'tree-changed' | 'review-rejected' | 'ref-remains' | 'readback-failed'
  | 'active-consumer' | 'active-unknown' | 'carrier-lost' | 'permission-lost'
  | 'permission-revoked-before' | 'permission-revoked-after' | 'run-changed-before' | 'run-changed-after'
  | 'execution-static-absent' | 'prepare-inventory-absent' | 'execution-inventory-absent'
  | 'execution-static-absent-shared-failure' | 'execution-inventory-absent-shared-failure'
  | 'preparation-absent' | 'preparation-unverified' | 'recovery-readback-rejected' | 'cas-conflict';
export type Event = Readonly<{ phase: Phase; capability: GitHubApiCapability;
  operation: GitHubApiOperation | Readonly<{ kind: 'review-evidence'; branch: string }> | Readonly<{ kind: 'authority-revalidation' }> }>;
type Session = { capability: GitHubApiCapability; kind: 'read' | 'write'; target?: string; cas: boolean };
export type Fixture = { requests: readonly ExactRefRetirement[]; fault?: Fault; stage: 'prepare' | 'retire';
  events: Event[]; sessions: Session[]; current?: Session; writes: number; casObserved: boolean;
  recoveryCalls: unknown[]; recoveryVerifications: unknown[]; localObservations: Array<{ kind: 'active' | 'inventory'; afterCas: boolean }>;
  progress: ExactRemoteRefBatchProgress[]; results: ExactRemoteRefBatchResult[]; requestDigest: `sha256:${string}`;
  currentTargetState?: 'present' | 'absent' | 'other'; resumeSource?: FixtureReceipt; resumeLocator?: ExactRefBatchResumeLocator };
export type FixtureReceipt = Readonly<{
  schema: 'sec-repository-maintenance-result-v3'; requestDigest: `sha256:${string}`;
  resumeReceipt: ExactRefBatchResumeLocator | null; recoveryCarrier: ExactRefBatchRecoveryCarrier;
  recoveryPreparation: ExactRemoteRefBatchRecoveryPreparation;
  progress: readonly ExactRemoteRefBatchProgress[]; results: readonly ExactRemoteRefBatchResult[];
}>;
export function fixtureReceipt(state: Fixture, recoveryPreparation: ExactRemoteRefBatchRecoveryPreparation): FixtureReceipt {
  return structuredClone({ schema: 'sec-repository-maintenance-result-v3', requestDigest: state.requestDigest,
    resumeReceipt: state.resumeLocator ?? null, recoveryCarrier: CARRIER, recoveryPreparation,
    progress: state.progress, results: state.results });
}
let active: Fixture | undefined;
function fixture(): Fixture { if (active === undefined) throw new Error('No exact-ref fixture is active'); return active; }
function firstTarget(session: Session | undefined): boolean { return session?.target === fixture().requests[0]!.branches[0]; }
function phaseFor(capability: GitHubApiCapability): Phase {
  const session = fixture().sessions.find((entry) => entry.capability === capability);
  if (session === undefined) throw new Error('Unknown provider capability');
  return session.kind === 'read' ? 'static' : session.cas ? 'after' : 'before';
}
async function session(kind: 'read' | 'write', input: { operation: (capability: GitHubApiCapability) => Promise<unknown> }) {
  const state = fixture();
  const target = kind === 'write' ? state.requests[state.writes++]?.branches[0] : undefined;
  if (kind === 'read' && state.stage === 'retire' && state.fault === 'execution-inventory-absent-shared-failure') {
    throw new Error('shared static admission failed');
  }
  if (kind === 'write' && state.fault === 'permission-lost') throw new Error('current maintainer permission lost');
  // External provider double only. The production retirement owner is never mocked.
  const capability = Object.freeze({ fixtureSession: state.sessions.length }) as unknown as GitHubApiCapability;
  const current: Session = { capability, kind, ...(target === undefined ? {} : { target }), cas: false };
  state.sessions.push(current);
  const previous = state.current; state.current = current;
  try {
    const result = await input.operation(capability);
    if (kind === 'read' && state.stage === 'retire' && state.fault === 'execution-static-absent-shared-failure') {
      throw new Error('shared static settlement failed');
    }
    return result;
  } finally { state.current = previous; }
}
class FixtureProviderError extends Error { constructor(readonly statusCode: number) { super(`fixture HTTP ${statusCode}`); } }
function inventory(): BranchLifecycleInventory {
  const state = fixture(); state.localObservations.push({ kind: 'inventory', afterCas: state.casObserved });
  return { schema: 'sec-branch-lifecycle-inventory-v1', observedAt: '2026-10-01T00:00:00.000Z',
    repository: { root: ROOT, commonDir: path.join(ROOT, '.git'), fullName: REPOSITORY,
      remote: 'origin', remoteUrl: `https://github.com/${REPOSITORY}.git`, defaultBranch: 'main' },
    main: { localSha: MAIN, remoteSha: MAIN }, localBranches: [{ branch: 'main', sha: MAIN }],
    remoteBranches: [{ branch: 'main', sha: MAIN }, ...((state.currentTargetState === 'absent')
      || (state.stage === 'prepare' && state.fault === 'prepare-inventory-absent')
      || (state.stage === 'retire' && ['execution-inventory-absent', 'execution-inventory-absent-shared-failure'].includes(state.fault ?? '')) ? []
        : state.requests.map((request) => ({ branch: request.branches[0], sha: HEAD })))],
    worktrees: [], pullRequests: [], activeWorkPackage: { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true, remotePrune: true, fetchPruneTags: true, reason: null }, unknowns: [] };
}
mock.module('../../src/adapters/providers/github-api/operation-session.ts', () => ({
  GitHubApiProviderError: FixtureProviderError,
  assertGitHubApiMaintenanceRequest: (_capability: GitHubApiCapability, digest: string) => {
    if (digest !== fixture().requestDigest) throw new Error('fixed plan differs');
    return { actor: 'fixture-maintainer', resumeReceiptDigest: fixture().resumeLocator === undefined ? null : sha256(fixture().resumeLocator) };
  },
  revalidateGitHubApiMaintenanceRequest: async (capability: GitHubApiCapability) => {
    const state = fixture(); const phase = phaseFor(capability);
    state.events.push({ phase, capability, operation: { kind: 'authority-revalidation' } });
    if (firstTarget(state.current) && ((phase === 'before' && ['permission-revoked-before', 'run-changed-before'].includes(state.fault ?? ''))
        || (phase === 'after' && ['permission-revoked-after', 'run-changed-after'].includes(state.fault ?? '')))) {
      throw new Error(state.fault!.startsWith('permission') ? 'current maintainer permission changed' : 'captured native run changed');
    }
  },
  withGitHubApiMaintenanceOperationBudget: (input: { operation: () => Promise<unknown> }) => input.operation(),
  withGitHubApiReadSession: (input: Parameters<typeof session>[1]) => session('read', input),
  withGitHubApiBranchCloseoutWriteSession: (input: Parameters<typeof session>[1]) => session('write', input),
  executeGitHubApiOperation: async (capability: GitHubApiCapability, operation: GitHubApiOperation) => {
    const state = fixture(); const phase = phaseFor(capability);
    state.events.push({ phase, capability, operation: structuredClone(operation) });
    const targeted = firstTarget(state.current); const before = phase === 'before' && targeted;
    const after = phase === 'after' && targeted;
    switch (operation.kind) {
      case 'git-ref':
        if (after && state.fault === 'readback-failed') throw new FixtureProviderError(503);
        if (operation.branch === 'main') return { ref: 'refs/heads/main', object: { type: 'commit', sha: before && state.fault === 'main-drift' ? OTHER : MAIN } };
        if (state.stage === 'retire' && phase === 'static' && ['execution-static-absent', 'execution-static-absent-shared-failure'].includes(state.fault ?? '')) throw new FixtureProviderError(404);
        if (state.currentTargetState === 'absent') throw new FixtureProviderError(404);
        if (state.currentTargetState === 'other') return { ref: `refs/heads/${operation.branch}`, object: { type: 'commit', sha: OTHER } };
        if (state.fault === 'preparation-absent' || (phase === 'after' && !(targeted && state.fault === 'ref-remains'))) throw new FixtureProviderError(404);
        return { ref: `refs/heads/${operation.branch}`, object: { type: 'commit', sha: before && state.fault === 'head-drift' ? OTHER : HEAD } };
      case 'open-pulls-page': return before && state.fault === 'open-consumer'
        ? [{ number: 99, state: 'open', head: { ref: 'unrelated', sha: OTHER, repo: { full_name: REPOSITORY } },
          base: { ref: state.requests[0]!.branches[0], repo: { full_name: REPOSITORY } } }] : [];
      case 'pull': return { number: 631, state: before && state.fault === 'closed-pull-changed' ? 'open' : 'closed',
        head: { ref: state.current?.target ?? state.requests[0]!.branches[0], sha: HEAD, repo: { full_name: REPOSITORY } },
        base: { ref: 'main', repo: { full_name: REPOSITORY } } };
      case 'git-commit': return { sha: operation.sha, tree: { sha: state.stage === 'retire' && state.fault === 'tree-changed' && operation.sha === HEAD ? OTHER : TREE } };
      case 'maintenance-artifact': return { id: CARRIER.artifactId, name: CARRIER.artifactName, digest: CARRIER.artifactDigest,
        expired: state.current?.kind === 'write' && state.fault === 'carrier-lost', expires_at: CARRIER.expiresAt,
        workflow_run: { id: CARRIER.runId } };
      case 'maintenance-artifact-text':
        if (state.resumeSource === undefined || operation.artifactId !== state.resumeLocator?.artifactId) throw new Error('unexpected receipt locator');
        return JSON.stringify(state.resumeSource);
      case 'maintenance-workflow-run-attempt':
        if (operation.runId === state.resumeLocator?.runId) return { id: Number(operation.runId), run_attempt: 1,
          event: 'workflow_dispatch', status: 'completed', path: '.github/workflows/repository-maintenance.yml',
          head_sha: MAIN, head_branch: 'main', repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY },
          actor: { login: 'original-maintainer', type: 'User' },
          display_title: `maintenance/${sha256({ requestDigest: state.requestDigest, resumeReceipt: state.resumeSource!.resumeReceipt })}` };
        return { id: 10, run_attempt: 1, event: 'workflow_dispatch', status: 'in_progress',
        path: '.github/workflows/repository-maintenance.yml', head_sha: MAIN, head_branch: 'main', repository: { full_name: REPOSITORY },
        display_title: `maintenance/${sha256({ requestDigest: state.requestDigest, resumeReceipt: null })}` };
      case 'delete-ref-cas':
        if (before && state.fault === 'cas-conflict') throw new FixtureProviderError(409);
        state.current!.cas = true; state.casObserved = true; return null;
      default: throw new Error(`Unexpected exact-ref provider operation ${operation.kind}`);
    }
  }
}));
mock.module('../../src/adapters/self-hosting/control/documentation/document-control-plane.ts', () => ({
  observeActiveWorkPackage: async () => {
    const state = fixture(); state.localObservations.push({ kind: 'active', afterCas: state.current?.cas === true });
    const activeConsumer = firstTarget(state.current) && state.fault === 'active-consumer';
    return { repository: REPOSITORY, defaultBranch: 'main', defaultSha: MAIN,
      state: state.current?.kind === 'write' && state.fault === 'active-unknown' ? 'unresolved' : activeConsumer ? 'active' : 'none',
      branch: activeConsumer ? state.requests[0]!.branches[0] : null, reason: 'fixture' };
  }
}));
mock.module('../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts', () => ({ collectBranchLifecycleInventory: inventory }));
mock.module('../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts', () => ({
  createBatchRecoveryBundle: (input: unknown) => { fixture().recoveryCalls.push(input); return fixture().fault === 'preparation-unverified' ? { ...RECOVERY, kind: 'unverified' } : RECOVERY; },
  withBatchRecoverySource: (input: { operation: (root: string) => Promise<unknown> }) => input.operation(ROOT),
  verifyRecoveryAuthorityHeadsLive: (input: unknown) => {
    fixture().recoveryVerifications.push(input);
    return fixture().fault === 'recovery-readback-rejected' ? { status: 'failed', detail: 'published bundle no longer verifies' }
      : { status: 'success', detail: 'independent complete published recovery readback' };
  }
}));
mock.module('../../src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts', () => ({
  observePlannedRefSupersessionEvidence: async (input: { capability: GitHubApiCapability; review: { branch: string } }) => {
    fixture().events.push({ phase: phaseFor(input.capability), capability: input.capability,
      operation: { kind: 'review-evidence', branch: input.review.branch } });
    if (fixture().stage === 'retire' && fixture().fault === 'review-rejected') throw new Error('independent review evidence rejected');
    return {};
  }
}));
const { prepareExactRemoteRefBatchRecovery, retireExactRemoteRefBatch } = await import(
  '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts'
);
export async function withExactRefFixture<T>(request: ExactRefRetirement | readonly ExactRefRetirement[], fault: Fault | undefined,
  operation: (state: Fixture, prepare: () => ReturnType<typeof prepareExactRemoteRefBatchRecovery>,
    retire: () => ReturnType<typeof retireExactRemoteRefBatch>,
    resumeFrom: (receipt: FixtureReceipt, runId?: string) => void) => Promise<T>): Promise<T> {
  if (active !== undefined) throw new Error('Exact-ref fixture requires serial execution');
  const requests: readonly ExactRefRetirement[] = Array.isArray(request) ? request : [request as ExactRefRetirement];
  const requestDigest = sha256({ schema: 'sec-repository-maintenance-request-v2', repository: REPOSITORY,
    expectedMainSha: MAIN, operations: requests.map((retirement) => ({ kind: 'exact-ref-retirement', retirement })) });
  const state: Fixture = { requests, ...(fault === undefined ? {} : { fault }), stage: 'prepare', events: [], sessions: [], writes: 0,
    casObserved: false, recoveryCalls: [], recoveryVerifications: [], localObservations: [], progress: [], results: [], requestDigest };
  active = state;
  const input = { repositoryRoot: ROOT, repository: REPOSITORY, expectedMainSha: MAIN, retirements: requests, requestDigest };
  let preparation: Awaited<ReturnType<typeof prepareExactRemoteRefBatchRecovery>> | undefined;
  try { return await operation(state,
    async () => { state.stage = 'prepare'; preparation = await prepareExactRemoteRefBatchRecovery(input); return preparation; },
    async () => { state.stage = 'retire'; if (preparation === undefined) throw new Error('fixture preparation was not performed');
      return retireExactRemoteRefBatch({ ...input, ...(state.resumeLocator === undefined ? {} : { resumeReceipt: state.resumeLocator }), preEffectRecovery: { preparation, recovery: RECOVERY }, recoveryCarrier: CARRIER,
        onProgress: (row) => { state.progress.push(row); }, onResult: (row) => {
          const index = state.results.findIndex((previous) => previous.branch === row.branch);
          if (index < 0) state.results.push(row); else state.results[index] = row;
        } }); },
    (receipt, runId = '20') => {
      state.resumeSource = structuredClone(receipt); preparation = receipt.recoveryPreparation;
      state.resumeLocator = { artifactId: `${runId}1`, runId, runAttempt: 1, artifactDigest: `sha256:${'9'.repeat(64)}` };
      state.progress = [...receipt.progress]; state.results = [...receipt.results];
    });
  } finally { active = undefined; }
}
