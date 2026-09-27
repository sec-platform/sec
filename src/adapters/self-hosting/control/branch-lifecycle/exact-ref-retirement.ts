import path from 'node:path';

import {
  executeGitHubApiOperation,
  GitHubApiProviderError,
  withGitHubApiBranchCloseoutWriteSession,
  withGitHubApiReadSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { observeActiveWorkPackage } from '../documentation/document-control-plane.ts';
import type { BranchRecoveryAuthority } from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import {
  parseExactRefRetirement,
  type ExactRefRetirement
} from './exact-ref-retirement-contract.ts';
import {
  createRecoveryBundle,
  verifyRecoveryAuthorityHeadLive
} from './branch-recovery.ts';

const MAX_OPEN_PULL_PAGES = 2;
const OPEN_PULLS_PER_PAGE = 100;

type OpenPull = Readonly<{
  number: number;
  headBranch: string;
  headSha: string;
  headRepository: string | null;
  baseBranch: string;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function repositoryFullName(value: unknown, label: string): string {
  const repo = record(value, label);
  if (typeof repo.full_name !== 'string'
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo.full_name)) {
    throw new Error(`${label} full_name is invalid`);
  }
  return repo.full_name;
}

function optionalRepositoryFullName(value: unknown, label: string): string | null {
  if (value === null) return null;
  return repositoryFullName(value, label);
}

function parseOpenPull(value: unknown, repository: string): OpenPull {
  const pull = record(value, 'open pull request');
  const head = record(pull.head, 'open pull request head');
  const base = record(pull.base, 'open pull request base');
  const headRepository = optionalRepositoryFullName(
    head.repo,
    'open pull request head repository'
  );
  if (!Number.isSafeInteger(pull.number) || Number(pull.number) < 1
      || pull.state !== 'open'
      || typeof head.ref !== 'string' || typeof base.ref !== 'string'
      || typeof head.sha !== 'string' || !/^[0-9a-f]{40}$/u.test(head.sha)
      || repositoryFullName(base.repo, 'open pull request base repository') !== repository) {
    throw new Error('open pull request response is not one exact identity');
  }
  return Object.freeze({
    number: Number(pull.number),
    headBranch: head.ref,
    headSha: head.sha,
    headRepository,
    baseBranch: base.ref
  });
}

async function observeOpenPulls(
  capability: GitHubApiCapability,
  repository: string
): Promise<readonly OpenPull[]> {
  const pulls: OpenPull[] = [];
  for (let page = 1; page <= MAX_OPEN_PULL_PAGES; page += 1) {
    const value = await executeGitHubApiOperation(capability, {
      kind: 'open-pulls-page',
      page
    });
    if (!Array.isArray(value)) throw new Error('open pull request census is invalid');
    pulls.push(...value.map((entry) => parseOpenPull(entry, repository)));
    if (value.length < OPEN_PULLS_PER_PAGE) return Object.freeze(pulls);
  }
  throw new Error('open pull request census exceeds the bounded complete pagination');
}

function assertNoOpenPullConsumer(
  pulls: readonly OpenPull[],
  branches: readonly string[],
  repository: string
): void {
  for (const branch of branches) {
    const consumer = pulls.find((pull) => (
      (pull.headRepository === repository && pull.headBranch === branch)
      || pull.baseBranch === branch
    ));
    if (consumer !== undefined) {
      throw new Error(
        `branch ${branch} is still referenced by open PR #${consumer.number} as head or base`
      );
    }
  }
}

async function observeGitRef(
  capability: GitHubApiCapability,
  branch: string
): Promise<string | null> {
  try {
    const value = record(
      await executeGitHubApiOperation(capability, { kind: 'git-ref', branch }),
      `GitHub ref ${branch}`
    );
    const object = record(value.object, `GitHub ref ${branch} object`);
    if (value.ref !== `refs/heads/${branch}`
        || object.type !== 'commit'
        || typeof object.sha !== 'string'
        || !/^[0-9a-f]{40}$/u.test(object.sha)) {
      throw new Error(`GitHub ref ${branch} response is invalid`);
    }
    return object.sha;
  } catch (error) {
    if (error instanceof GitHubApiProviderError && error.statusCode === 404) return null;
    throw error;
  }
}

async function assertLiveMain(
  capability: GitHubApiCapability,
  defaultBranch: string,
  expectedMainSha: string
): Promise<void> {
  const live = await observeGitRef(capability, defaultBranch);
  if (live !== expectedMainSha) {
    throw new Error(
      `live default branch drifted: expected ${expectedMainSha}, observed ${live ?? '<absent>'}`
    );
  }
}

async function observeCommitTree(
  capability: GitHubApiCapability,
  commitSha: string
): Promise<string> {
  const value = record(
    await executeGitHubApiOperation(capability, { kind: 'git-commit', sha: commitSha }),
    `GitHub commit ${commitSha}`
  );
  const tree = record(value.tree, `GitHub commit ${commitSha} tree`);
  if (value.sha !== commitSha
      || typeof tree.sha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(tree.sha)) {
    throw new Error(`GitHub commit ${commitSha} tree identity is invalid`);
  }
  return tree.sha;
}

async function assertMainTreeIdentical(
  capability: GitHubApiCapability,
  request: Extract<ExactRefRetirement, { classification: 'main-tree-identical' }>,
  expectedMainSha: string
): Promise<void> {
  const [targetTree, mainTree] = await Promise.all([
    observeCommitTree(capability, request.expectedHeadSha),
    observeCommitTree(capability, expectedMainSha)
  ]);
  if (targetTree !== mainTree) {
    throw new Error(
      `branch ${request.branches[0]} tree ${targetTree} differs from live main tree ${mainTree}`
    );
  }
}

async function assertExactClosedPullRequest(
  capability: GitHubApiCapability,
  repository: string,
  request: Extract<ExactRefRetirement, { classification: 'closed-pr-superseded' }>
): Promise<void> {
  const pull = record(
    await executeGitHubApiOperation(capability, {
      kind: 'pull',
      pullRequestNumber: request.pullRequestNumber
    }),
    `closed PR #${request.pullRequestNumber}`
  );
  const head = record(pull.head, `closed PR #${request.pullRequestNumber} head`);
  const base = record(pull.base, `closed PR #${request.pullRequestNumber} base`);
  if (pull.number !== request.pullRequestNumber
      || pull.state !== 'closed'
      || head.ref !== request.branches[0]
      || head.sha !== request.expectedHeadSha
      || repositoryFullName(head.repo, 'closed PR head repository') !== repository
      || repositoryFullName(base.repo, 'closed PR base repository') !== repository) {
    throw new Error(
      `closed PR #${request.pullRequestNumber} does not bind ${request.branches[0]}@${request.expectedHeadSha}`
    );
  }
}

function assertActiveWorkPackageSafe(
  active: ReturnType<typeof collectBranchLifecycleInventory>['activeWorkPackage'],
  branches: readonly string[]
): void {
  if (active.state === 'invalid' || active.state === 'unresolved') {
    throw new Error(`active Work Package observation is ${active.state}: ${active.reason ?? 'unknown reason'}`);
  }
  if (active.state === 'active' && active.branch !== null && branches.includes(active.branch)) {
    throw new Error(`branch ${active.branch} is the active Work Package branch`);
  }
}

function criticalInventoryUnknowns(unknowns: readonly string[]): readonly string[] {
  return unknowns.filter((reason) => (
    /repository full name|default branch|remote branch inventory|local branch inventory|worktree/i.test(reason)
  ));
}

type RemoteStateInput = Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  expectedMainSha: string;
  request: ExactRefRetirement;
}>;

async function observeRemoteStateWithCapability(
  capability: GitHubApiCapability,
  input: RemoteStateInput
): Promise<ReadonlyMap<string, string | null>> {
  await assertLiveMain(capability, input.defaultBranch, input.expectedMainSha);
  assertNoOpenPullConsumer(
    await observeOpenPulls(capability, input.repository),
    input.request.branches,
    input.repository
  );
  if (input.request.classification === 'closed-pr-superseded') {
    await assertExactClosedPullRequest(capability, input.repository, input.request);
  } else if (input.request.classification === 'main-tree-identical') {
    await assertMainTreeIdentical(capability, input.request, input.expectedMainSha);
  }
  const state = new Map<string, string | null>();
  for (const branch of input.request.branches) {
    const observed = await observeGitRef(capability, branch);
    if (observed !== null && observed !== input.request.expectedHeadSha) {
      throw new Error(
        `branch ${branch} does not bind expected head ${input.request.expectedHeadSha}`
      );
    }
    state.set(branch, observed);
  }
  return state;
}

async function observeRemoteState(input: RemoteStateInput): Promise<ReadonlyMap<string, string | null>> {
  return withGitHubApiBranchCloseoutWriteSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => observeRemoteStateWithCapability(capability, input)
  });
}

async function observeRemoteStateReadOnly(
  input: RemoteStateInput
): Promise<ReadonlyMap<string, string | null>> {
  return withGitHubApiReadSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => observeRemoteStateWithCapability(capability, input)
  });
}

async function collectAdmittedRetirementInventory(input: Readonly<{
  root: string;
  repository: string;
  expectedMainSha: string;
  request: ExactRefRetirement;
}>) {
  const activeWorkPackageObservation = await observeActiveWorkPackage(input.root);
  const before = collectBranchLifecycleInventory({
    repositoryRoot: input.root,
    activeWorkPackageObservation
  });
  if (before.repository.fullName !== input.repository) {
    throw new Error('exact ref retirement repository identity differs');
  }
  const criticalUnknowns = criticalInventoryUnknowns(before.unknowns);
  if (criticalUnknowns.length > 0) {
    throw new Error(
      `exact ref retirement critical inventory is unresolved: ${criticalUnknowns.join(' | ')}`
    );
  }
  assertActiveWorkPackageSafe(before.activeWorkPackage, input.request.branches);
  if (input.request.branches.includes(before.repository.defaultBranch)) {
    throw new Error('default branch cannot be retired');
  }
  if (before.main.remoteSha !== input.expectedMainSha) {
    throw new Error(
      `inventory default branch drifted: expected ${input.expectedMainSha}, observed ${before.main.remoteSha ?? '<absent>'}`
    );
  }
  return before;
}

const EXACT_REF_RECOVERY_PREPARATION_SCHEMA =
  'sec-exact-ref-retirement-recovery-preparation-v1' as const;

export type ExactRemoteRefRecoveryPreparation = Readonly<{
  schema: typeof EXACT_REF_RECOVERY_PREPARATION_SCHEMA;
  repository: string;
  expectedMainSha: string;
  retirement: ExactRefRetirement;
  refState: 'present' | 'absent';
  recovery: null | Readonly<{
    bundleName: string;
    sha256: `sha256:${string}`;
    verifyOutput: string;
  }>;
}>;

function preparationKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

export function parseExactRemoteRefRecoveryPreparation(
  value: unknown
): ExactRemoteRefRecoveryPreparation {
  const input = record(value, 'exact ref recovery preparation');
  preparationKeys(
    input,
    ['schema', 'repository', 'expectedMainSha', 'retirement', 'refState', 'recovery'],
    'exact ref recovery preparation'
  );
  if (input.schema !== EXACT_REF_RECOVERY_PREPARATION_SCHEMA
      || typeof input.repository !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)
      || typeof input.expectedMainSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(input.expectedMainSha)
      || (input.refState !== 'present' && input.refState !== 'absent')) {
    throw new Error('exact ref recovery preparation identity is invalid');
  }
  const retirement = parseExactRefRetirement(input.retirement);
  let recovery: ExactRemoteRefRecoveryPreparation['recovery'] = null;
  if (input.recovery !== null) {
    const candidate = record(input.recovery, 'exact ref recovery bundle');
    preparationKeys(
      candidate,
      ['bundleName', 'sha256', 'verifyOutput'],
      'exact ref recovery bundle'
    );
    if (typeof candidate.bundleName !== 'string'
        || !/^sec-branch-closeout-[A-Za-z0-9.-]+\.bundle$/u.test(candidate.bundleName)
        || typeof candidate.sha256 !== 'string'
        || !/^sha256:[0-9a-f]{64}$/u.test(candidate.sha256)
        || typeof candidate.verifyOutput !== 'string'
        || candidate.verifyOutput.length > 32_768
        || /[\u0000]/u.test(candidate.verifyOutput)) {
      throw new Error('exact ref recovery bundle identity is invalid');
    }
    recovery = Object.freeze({
      bundleName: candidate.bundleName,
      sha256: candidate.sha256 as `sha256:${string}`,
      verifyOutput: candidate.verifyOutput
    });
  }
  return Object.freeze({
    schema: EXACT_REF_RECOVERY_PREPARATION_SCHEMA,
    repository: input.repository,
    expectedMainSha: input.expectedMainSha,
    retirement,
    refState: input.refState,
    recovery
  });
}

export async function prepareExactRemoteRefRecovery(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  expectedMainSha: string;
  retirement: ExactRefRetirement;
}>): Promise<ExactRemoteRefRecoveryPreparation> {
  const root = path.resolve(input.repositoryRoot);
  const request = parseExactRefRetirement(input.retirement);
  const before = await collectAdmittedRetirementInventory({
    root,
    repository: input.repository,
    expectedMainSha: input.expectedMainSha,
    request
  });
  const state = await observeRemoteStateReadOnly({
    repositoryRoot: root,
    repository: input.repository,
    defaultBranch: before.repository.defaultBranch,
    expectedMainSha: input.expectedMainSha,
    request
  });
  const present = state.get(request.branches[0]) !== null;
  const recoveryRequired = request.classification === 'closed-pr-superseded' || present;
  const recovery = recoveryRequired
    ? createRecoveryBundle({
        inventory: before,
        branch: request.branches[0],
        expectedSha: request.expectedHeadSha,
        refSource: request.classification === 'closed-pr-superseded'
          ? { kind: 'pull' as const, number: request.pullRequestNumber }
          : { kind: 'remote-branch' as const }
      }).recovery
    : null;
  if (recovery !== null && (recovery.kind !== 'bundle' || recovery.verified !== true)) {
    throw new Error('exact ref recovery preparation did not produce one verified git bundle');
  }
  return Object.freeze({
    schema: EXACT_REF_RECOVERY_PREPARATION_SCHEMA,
    repository: input.repository,
    expectedMainSha: input.expectedMainSha,
    retirement: request,
    refState: present ? 'present' as const : 'absent' as const,
    recovery: recovery === null
      ? null
      : Object.freeze({
          bundleName: path.basename(recovery.path),
          sha256: recovery.sha256,
          verifyOutput: recovery.verifyOutput
        })
  });
}

export async function retireExactRemoteRefs(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  expectedMainSha: string;
  retirement: ExactRefRetirement;
  preEffectRecovery: Readonly<{
    refState: 'present' | 'absent';
    recovery: BranchRecoveryAuthority | null;
  }>;
}>): Promise<Readonly<{
  retired: readonly string[];
  alreadyAbsent: readonly string[];
  recoveries: readonly Readonly<{ branch: string; sha256: string }>[];
}>> {
  const root = path.resolve(input.repositoryRoot);
  const request = parseExactRefRetirement(input.retirement);
  const before = await collectAdmittedRetirementInventory({
    root,
    repository: input.repository,
    expectedMainSha: input.expectedMainSha,
    request
  });

  const initialRemoteState = await observeRemoteState({
    repositoryRoot: root,
    repository: input.repository,
    defaultBranch: before.repository.defaultBranch,
    expectedMainSha: input.expectedMainSha,
    request
  });
  const present = request.branches.filter((branch) => initialRemoteState.get(branch) !== null);
  const alreadyAbsent = request.branches.filter((branch) => initialRemoteState.get(branch) === null);

  const observedRefState = present.length > 0 ? 'present' as const : 'absent' as const;
  if (input.preEffectRecovery.refState !== observedRefState) {
    throw new Error(
      `exact ref retirement state drifted after recovery publication: expected ${input.preEffectRecovery.refState}, observed ${observedRefState}`
    );
  }
  const published = input.preEffectRecovery.recovery;
  if ((observedRefState === 'present' || request.classification === 'closed-pr-superseded')
      && published === null) {
    throw new Error('exact ref retirement requires a published recovery bundle before effect');
  }
  let recoveries: ReadonlyArray<Readonly<{ branch: string; sha256: string }>>;
  if (published !== null) {
    const verification = verifyRecoveryAuthorityHeadLive({
      inventory: before,
      recovery: published,
      expectedHeadSha: request.expectedHeadSha
    });
    if (verification.status !== 'success') {
      throw new Error(`published recovery readback is invalid: ${verification.detail}`);
    }
    recoveries = Object.freeze([
      Object.freeze({
        branch: request.branches[0],
        sha256: published.sha256
      })
    ]);
  } else {
    recoveries = Object.freeze([]);
  }

  const retired: string[] = [];
  for (const branch of present) {
    const outcome = await withGitHubApiBranchCloseoutWriteSession({
      repositoryRoot: root,
      repository: input.repository,
      operation: async (capability) => {
        await assertLiveMain(capability, before.repository.defaultBranch, input.expectedMainSha);
        assertNoOpenPullConsumer(
          await observeOpenPulls(capability, input.repository),
          request.branches,
          input.repository
        );
        if (request.classification === 'closed-pr-superseded') {
          await assertExactClosedPullRequest(capability, input.repository, request);
        } else if (request.classification === 'main-tree-identical') {
          await assertMainTreeIdentical(capability, request, input.expectedMainSha);
        }
        const immediatelyBefore = await observeGitRef(capability, branch);
        if (immediatelyBefore === null) return 'already-absent' as const;
        if (immediatelyBefore !== request.expectedHeadSha) {
          throw new Error(
            `branch ${branch} moved before CAS: expected ${request.expectedHeadSha}, observed ${immediatelyBefore}`
          );
        }

        await executeGitHubApiOperation(capability, {
          kind: 'delete-ref-cas',
          branch,
          expectedOldSha: request.expectedHeadSha
        });

        const readback = await observeGitRef(capability, branch);
        if (readback !== null) {
          throw new Error(`branch ${branch} remains after exact ref retirement`);
        }
        const afterPulls = await observeOpenPulls(capability, input.repository);
        try {
          assertNoOpenPullConsumer(afterPulls, request.branches, input.repository);
          await assertLiveMain(capability, before.repository.defaultBranch, input.expectedMainSha);
        } catch (error) {
          throw new Error(
            `branch ${branch} was deleted but the effect is unsettled; recover from the uploaded bundle: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
        return 'retired' as const;
      }
    });
    if (outcome === 'retired') retired.push(branch);
    else if (!alreadyAbsent.includes(branch)) alreadyAbsent.push(branch);
  }

  const activeReadback = await observeActiveWorkPackage(root);
  const after = collectBranchLifecycleInventory({
    repositoryRoot: root,
    activeWorkPackageObservation: activeReadback
  });
  if (after.repository.fullName !== input.repository) {
    throw new Error('exact ref retirement readback repository identity differs');
  }
  assertActiveWorkPackageSafe(after.activeWorkPackage, request.branches);
  const readbackUnknowns = criticalInventoryUnknowns(after.unknowns);
  if (readbackUnknowns.length > 0) {
    throw new Error(`exact ref retirement readback is unresolved: ${readbackUnknowns.join(' | ')}`);
  }
  if (after.main.remoteSha !== input.expectedMainSha) {
    throw new Error('default branch changed during exact ref retirement');
  }
  for (const branch of request.branches) {
    if (after.remoteBranches.some((entry) => entry.branch === branch)) {
      throw new Error(`branch ${branch} remains after exact ref retirement readback`);
    }
  }
  return Object.freeze({
    retired: Object.freeze(retired),
    alreadyAbsent: Object.freeze(alreadyAbsent),
    recoveries: Object.freeze(recoveries)
  });
}
