import { mock } from 'bun:test';
import path from 'node:path';

import type { GitHubApiCapability, GitHubApiOperation } from '../../src/adapters/providers/github-api/operation-session.ts';
import type { ExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import type { BranchLifecycleInventory, BranchRecoveryAuthority } from '../../src/execution/verification/branch-closeout.ts';

export const MAIN = 'a'.repeat(40);
export const HEAD = 'b'.repeat(40);
export const TREE = 'c'.repeat(40);
export const OTHER = 'd'.repeat(40);
export const REPOSITORY = 'sec-platform/sec';
export const ROOT = path.resolve('exact-ref-retirement-fixture');
export const RECOVERY: BranchRecoveryAuthority = Object.freeze({
  kind: 'bundle',
  path: path.resolve('exact-ref-retirement-recovery/exact-ref-retirement-recovery-fixture.bundle'),
  sha256: `sha256:${'e'.repeat(64)}`,
  verified: true,
  verifyOutput: 'verified independent recovery fixture'
});

type Phase = 'preparation' | 'initial' | 'before' | 'after';
export type Fault =
  | 'head-drift' | 'main-drift' | 'open-consumer'
  | 'closed-pull-changed' | 'tree-changed' | 'review-rejected'
  | 'ref-remains' | 'readback-failed'
  | 'inventory-main-changed' | 'inventory-consumer' | 'inventory-unknown' | 'inventory-ref-remains'
  | 'preparation-absent' | 'preparation-unverified' | 'recovery-readback-rejected';
export type Event = Readonly<{
  phase: Phase;
  capability: GitHubApiCapability;
  operation: GitHubApiOperation | Readonly<{
    kind: 'review-evidence'; repositoryRoot: string; issueNumber: number; commentId: number;
    branch: string; expectedHeadSha: string; expectedMainSha: string;
  }>;
}>;
type Session = { capability: GitHubApiCapability; kind: 'read' | 'write' };
export type Fixture = {
  request: ExactRefRetirement;
  fault?: Fault;
  events: Event[];
  sessions: Session[];
  recoveryCalls: unknown[];
  recoveryVerifications: unknown[];
  recoveryReadbackObserved: boolean;
  casObserved: boolean;
  localObservations: Array<{ kind: 'active' | 'inventory'; afterCas: boolean }>;
};
let active: Fixture | undefined;

function fixture(): Fixture {
  if (active === undefined) throw new Error('No exact-ref fixture is active');
  return active;
}
function phaseFor(capability: GitHubApiCapability): Phase {
  const state = fixture();
  const session = state.sessions.find((entry) => entry.capability === capability);
  if (session === undefined) throw new Error('Unknown provider capability');
  if (session.kind === 'read') return 'preparation';
  if (state.casObserved) return 'after';
  return state.recoveryReadbackObserved ? 'before' : 'initial';
}
function session(kind: 'read' | 'write', input: { operation: (capability: GitHubApiCapability) => Promise<unknown> }) {
  const state = fixture();
  // The external session provider issues a distinct identity for every acquisition.
  const capability = Object.freeze({ fixtureSession: state.sessions.length }) as unknown as GitHubApiCapability;
  state.sessions.push({ capability, kind });
  return input.operation(capability);
}
class FixtureProviderError extends Error {
  constructor(readonly statusCode: number) { super(`fixture HTTP ${statusCode}`); }
}
function inventory(): BranchLifecycleInventory {
  const state = fixture();
  state.localObservations.push({ kind: 'inventory', afterCas: state.casObserved });
  const readback = state.casObserved;
  return {
    schema: 'sec-branch-lifecycle-inventory-v1', observedAt: '2026-10-01T00:00:00.000Z',
    repository: { root: ROOT, commonDir: path.join(ROOT, '.git'), fullName: REPOSITORY,
      remote: 'origin', remoteUrl: `https://github.com/${REPOSITORY}.git`, defaultBranch: 'main' },
    main: { localSha: MAIN, remoteSha: readback && state.fault === 'inventory-main-changed' ? OTHER : MAIN },
    localBranches: [{ branch: 'main', sha: MAIN }],
    // Predeclared external observations; CAS does not mutate this fixture.
    remoteBranches: [{ branch: 'main', sha: MAIN }, ...(!readback || state.fault === 'inventory-ref-remains'
      ? [{ branch: state.request.branches[0], sha: HEAD }] : [])],
    worktrees: [], pullRequests: [],
    activeWorkPackage: readback && state.fault === 'inventory-consumer'
      ? { state: 'active', branch: state.request.branches[0], manifest: null, reason: null }
      : { state: 'none', branch: null, manifest: null, reason: null },
    repositorySetting: { observation: 'resolved', deleteBranchOnMerge: true, reason: null },
    pruneConfiguration: { observation: 'resolved', fetchPrune: true, remotePrune: true, fetchPruneTags: true, reason: null },
    unknowns: readback && state.fault === 'inventory-unknown' ? ['remote branch inventory is unavailable'] : []
  };
}

mock.module('../../src/adapters/providers/github-api/operation-session.ts', () => ({
  GitHubApiProviderError: FixtureProviderError,
  withGitHubApiReadSession: (input: Parameters<typeof session>[1]) => session('read', input),
  withGitHubApiBranchCloseoutWriteSession: (input: Parameters<typeof session>[1]) => session('write', input),
  executeGitHubApiOperation: async (capability: GitHubApiCapability, operation: GitHubApiOperation) => {
    const state = fixture();
    const phase = phaseFor(capability);
    state.events.push({ phase, capability, operation: structuredClone(operation) });
    const before = phase === 'before';
    const after = phase === 'after';
    switch (operation.kind) {
      case 'git-ref': {
        if (after && state.fault === 'readback-failed') throw new FixtureProviderError(503);
        if (operation.branch === 'main') return { ref: 'refs/heads/main', object: { type: 'commit', sha: before && state.fault === 'main-drift' ? OTHER : MAIN } };
        if ((phase === 'preparation' && state.fault === 'preparation-absent')
            || (after && state.fault !== 'ref-remains')) throw new FixtureProviderError(404);
        return { ref: `refs/heads/${operation.branch}`, object: { type: 'commit', sha: before && state.fault === 'head-drift' ? OTHER : HEAD } };
      }
      case 'open-pulls-page':
        return before && state.fault === 'open-consumer'
          ? [{ number: 99, state: 'open', head: { ref: 'unrelated', sha: OTHER, repo: { full_name: REPOSITORY } },
            base: { ref: state.request.branches[0], repo: { full_name: REPOSITORY } } }] : [];
      case 'pull':
        return { number: 631, state: before && state.fault === 'closed-pull-changed' ? 'open' : 'closed',
          head: { ref: state.request.branches[0], sha: HEAD, repo: { full_name: REPOSITORY } },
          base: { ref: 'main', repo: { full_name: REPOSITORY } } };
      case 'git-commit':
        return { sha: operation.sha, tree: { sha: before && state.fault === 'tree-changed' && operation.sha === HEAD ? OTHER : TREE } };
      case 'delete-ref-cas':
        // Select predeclared post-request observations without executing a ref
        // mutation or deciding settlement. Only the production owner does that.
        state.casObserved = true;
        return null;
      default: throw new Error(`Unexpected exact-ref provider operation ${operation.kind}`);
    }
  }
}));
mock.module('../../src/adapters/self-hosting/control/documentation/document-control-plane.ts', () => ({
  observeActiveWorkPackage: async () => {
    fixture().localObservations.push({ kind: 'active', afterCas: fixture().casObserved });
    return { state: 'none', reason: 'fixture' };
  }
}));
mock.module('../../src/adapters/self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts', () => ({
  collectBranchLifecycleInventory: inventory
}));
mock.module('../../src/adapters/self-hosting/control/branch-lifecycle/branch-recovery.ts', () => ({
  createRecoveryBundle: (input: unknown) => {
    fixture().recoveryCalls.push(input);
    return { recovery: fixture().fault === 'preparation-unverified' ? { ...RECOVERY, verified: false } : RECOVERY };
  },
  verifyRecoveryAuthorityHeadLive: (input: unknown) => {
    fixture().recoveryVerifications.push(input);
    fixture().recoveryReadbackObserved = true;
    return fixture().fault === 'recovery-readback-rejected'
      ? { status: 'failed', detail: 'published bundle no longer verifies' }
      : { status: 'success', detail: 'independent published recovery readback' };
  }
}));
mock.module('../../src/adapters/self-hosting/control/branch-lifecycle/closed-supersession-review.ts', () => ({
  observeReviewedRefSupersessionEvidence: async (input: { capability: GitHubApiCapability; repositoryRoot: string;
    issueNumber: number; commentId: number; branch: string; expectedHeadSha: string; expectedMainSha: string }) => {
    const { capability, ...identity } = input;
    const phase = phaseFor(capability);
    fixture().events.push({ phase, capability, operation: { kind: 'review-evidence', ...identity } });
    if (phase === 'before' && fixture().fault === 'review-rejected') throw new Error('independent review evidence rejected');
    return {};
  }
}));

// Import only after the external dependency doubles are installed. This owner is never mocked.
const { prepareExactRemoteRefRecovery, retireExactRemoteRefs } = await import(
  '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts'
);

export async function withExactRefFixture<T>(
  request: ExactRefRetirement,
  fault: Fault | undefined,
  operation: (state: Fixture, prepare: () => ReturnType<typeof prepareExactRemoteRefRecovery>,
    retire: () => ReturnType<typeof retireExactRemoteRefs>) => Promise<T>
): Promise<T> {
  if (active !== undefined) throw new Error('Exact-ref fixture requires serial execution');
  const state: Fixture = { request, ...(fault === undefined ? {} : { fault }), events: [], sessions: [],
    recoveryCalls: [], recoveryVerifications: [], recoveryReadbackObserved: false, casObserved: false, localObservations: [] };
  active = state;
  const input = { repositoryRoot: ROOT, repository: REPOSITORY, expectedMainSha: MAIN, retirement: request };
  try {
    return await operation(state,
      () => prepareExactRemoteRefRecovery(input),
      () => retireExactRemoteRefs({ ...input, preEffectRecovery: { refState: 'present', recovery: RECOVERY } }));
  } finally { active = undefined; }
}
