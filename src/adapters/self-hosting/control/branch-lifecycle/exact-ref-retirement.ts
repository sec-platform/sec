import path from 'node:path';

import {
  executeGitHubApiOperation,
  GitHubApiProviderError,
  withGitHubApiBranchCloseoutWriteSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { observeActiveWorkPackage } from '../documentation/document-control-plane.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import {
  parseExactRefRetirement,
  type ExactRefRetirement
} from './exact-ref-retirement-contract.ts';
import { createRecoveryBundle } from './branch-recovery.ts';

const MAX_OPEN_PULL_PAGES = 20;
const OPEN_PULLS_PER_PAGE = 100;

type OpenPull = Readonly<{
  number: number;
  headBranch: string;
  headSha: string;
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

function parseOpenPull(value: unknown, repository: string): OpenPull {
  const pull = record(value, 'open pull request');
  const head = record(pull.head, 'open pull request head');
  const base = record(pull.base, 'open pull request base');
  if (!Number.isSafeInteger(pull.number) || Number(pull.number) < 1
      || pull.state !== 'open'
      || typeof head.ref !== 'string' || typeof base.ref !== 'string'
      || typeof head.sha !== 'string' || !/^[0-9a-f]{40}$/u.test(head.sha)
      || repositoryFullName(head.repo, 'open pull request head repository') !== repository
      || repositoryFullName(base.repo, 'open pull request base repository') !== repository) {
    throw new Error('open pull request response is not one same-repository exact identity');
  }
  return Object.freeze({
    number: Number(pull.number),
    headBranch: head.ref,
    headSha: head.sha,
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
  branches: readonly string[]
): void {
  for (const branch of branches) {
    const consumer = pulls.find((pull) => (
      pull.headBranch === branch || pull.baseBranch === branch
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

async function observeRemoteState(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  expectedMainSha: string;
  request: ExactRefRetirement;
}>): Promise<ReadonlyMap<string, string | null>> {
  return withGitHubApiBranchCloseoutWriteSession({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      await assertLiveMain(capability, input.defaultBranch, input.expectedMainSha);
      assertNoOpenPullConsumer(
        await observeOpenPulls(capability, input.repository),
        input.request.branches
      );
      if (input.request.classification === 'closed-pr-superseded') {
        await assertExactClosedPullRequest(capability, input.repository, input.request);
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
  });
}

export async function retireExactRemoteRefs(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  expectedMainSha: string;
  retirement: ExactRefRetirement;
}>): Promise<Readonly<{
  retired: readonly string[];
  alreadyAbsent: readonly string[];
  recoveries: readonly Readonly<{ branch: string; path: string; sha256: string }>[];
}>> {
  const root = path.resolve(input.repositoryRoot);
  const request = parseExactRefRetirement(input.retirement);
  const activeWorkPackageObservation = await observeActiveWorkPackage(root);
  const before = collectBranchLifecycleInventory({
    repositoryRoot: root,
    activeWorkPackageObservation
  });
  if (before.repository.fullName !== input.repository) {
    throw new Error('exact ref retirement repository identity differs');
  }
  const criticalUnknowns = criticalInventoryUnknowns(before.unknowns);
  if (criticalUnknowns.length > 0) {
    throw new Error(`exact ref retirement critical inventory is unresolved: ${criticalUnknowns.join(' | ')}`);
  }
  assertActiveWorkPackageSafe(before.activeWorkPackage, request.branches);
  if (request.branches.includes(before.repository.defaultBranch)) {
    throw new Error('default branch cannot be retired');
  }
  if (before.main.remoteSha !== input.expectedMainSha) {
    throw new Error(
      `inventory default branch drifted: expected ${input.expectedMainSha}, observed ${before.main.remoteSha ?? '<absent>'}`
    );
  }

  const initialRemoteState = await observeRemoteState({
    repositoryRoot: root,
    repository: input.repository,
    defaultBranch: before.repository.defaultBranch,
    expectedMainSha: input.expectedMainSha,
    request
  });
  const present = request.branches.filter((branch) => initialRemoteState.get(branch) !== null);
  const alreadyAbsent = request.branches.filter((branch) => initialRemoteState.get(branch) === null);

  const recoveries = present.map((branch) => {
    const prepared = createRecoveryBundle({
      inventory: before,
      branch,
      expectedSha: request.expectedHeadSha,
      refSource: request.classification === 'closed-pr-superseded'
        ? { kind: 'pull' as const, number: request.pullRequestNumber }
        : { kind: 'remote-branch' as const }
    });
    const recovery = prepared.recovery;
    if (recovery.kind !== 'bundle' || recovery.verified !== true) {
      throw new Error(`branch ${branch} recovery is not one verified git bundle`);
    }
    return Object.freeze({ branch, path: recovery.path, sha256: recovery.sha256 });
  });

  const retired: string[] = [];
  for (const branch of present) {
    const outcome = await withGitHubApiBranchCloseoutWriteSession({
      repositoryRoot: root,
      repository: input.repository,
      operation: async (capability) => {
        await assertLiveMain(capability, before.repository.defaultBranch, input.expectedMainSha);
        assertNoOpenPullConsumer(
          await observeOpenPulls(capability, input.repository),
          request.branches
        );
        if (request.classification === 'closed-pr-superseded') {
          await assertExactClosedPullRequest(capability, input.repository, request);
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
          assertNoOpenPullConsumer(afterPulls, request.branches);
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
