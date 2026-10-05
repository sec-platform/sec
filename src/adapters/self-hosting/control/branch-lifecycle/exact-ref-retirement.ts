import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';

import {
  assertGitHubApiMaintenanceRequest,
  executeGitHubApiOperation,
  GitHubApiProviderError,
  revalidateGitHubApiMaintenanceRequest,
  withGitHubApiBranchCloseoutWriteSession,
  withGitHubApiMaintenanceOperationBudget,
  withGitHubApiReadSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { observeActiveWorkPackage } from '../documentation/document-control-plane.ts';
import type { BranchRecoveryAuthority } from './branch-lifecycle-contract.ts';
import { collectBranchLifecycleInventory } from './branch-lifecycle-inventory.ts';
import { createBatchRecoveryBundle, verifyRecoveryAuthorityHeadsLive, withBatchRecoverySource } from './branch-recovery.ts';
import { observePlannedRefSupersessionEvidence } from './closed-supersession-review.ts';
import {
  decideExactRefBatchContinuation,
  parseExactRefRetirement,
  type ExactRefRetirement
} from './exact-ref-retirement-contract.ts';

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

export type ExactRemoteRefBatchRecoveryPreparation = Readonly<{
  schema: 'sec-exact-ref-batch-recovery-preparation-v2';
  repository: string;
  expectedMainSha: string;
  requestDigest: `sha256:${string}`;
  retirements: readonly ExactRefRetirement[];
  refs: readonly Readonly<{
    branch: string;
    expectedHeadSha: string;
    refState: 'present' | 'absent' | 'unknown';
    absenceObserved: boolean;
    blocker: string | null;
  }>[];
  recovery: NonNullable<ExactRemoteRefRecoveryPreparation['recovery']>;
}>;

export type ExactRemoteRefBatchResult = Readonly<{
  branch: string;
  expectedHeadSha: string;
  status: 'retired' | 'converged-observed' | 'blocked' | 'unsettled' | 'absent-unattributed';
  targetState: 'absent' | 'present' | 'unknown';
  effectOutcome: 'acknowledged' | 'unknown' | 'not-attempted';
  detail: string;
}>;

export type ExactRemoteRefBatchProgress = Readonly<{
  branch: string;
  expectedHeadSha: string;
  phase: 'effect-started' | 'effect-returned' | 'absence-observed' | 'recreation-observed';
}>;

type BatchInput = Readonly<{
  repositoryRoot: string;
  repository: string;
  expectedMainSha: string;
  retirements: readonly ExactRefRetirement[];
  requestDigest: `sha256:${string}`;
}>;

function captureBatchInput(input: BatchInput): BatchInput {
  if (!Array.isArray(input.retirements) || input.retirements.length < 1 || input.retirements.length > 64) {
    throw new Error('Exact ref batch requires 1..64 operations');
  }
  const retirements = Object.freeze(input.retirements.map(parseExactRefRetirement));
  if (new Set(retirements.map((ref) => ref.branches[0])).size !== retirements.length) {
    throw new Error('Exact ref batch contains duplicate branches');
  }
  if (retirements.some((item) => item.classification === 'reviewed-superseded')) {
    throw new Error('Batch reviewed supersession must use its native dispatch plan, not a mutable comment');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)
      || !/^[0-9a-f]{40}$/u.test(input.expectedMainSha)) {
    throw new Error('Exact ref batch repository or main identity is invalid');
  }
  const requestDigest = sha256({ schema: 'sec-repository-maintenance-request-v2',
    repository: input.repository, expectedMainSha: input.expectedMainSha,
    operations: retirements.map((retirement) => ({ kind: 'exact-ref-retirement', retirement })) });
  if (requestDigest !== input.requestDigest) throw new Error('Exact ref batch differs from the fixed dispatch plan');
  return Object.freeze({ ...input, repositoryRoot: path.resolve(input.repositoryRoot), retirements });
}

export function parseExactRemoteRefBatchRecoveryPreparation(
  value: unknown
): ExactRemoteRefBatchRecoveryPreparation {
  const input = record(value, 'batch recovery preparation');
  preparationKeys(input, ['schema', 'repository', 'expectedMainSha', 'requestDigest',
    'retirements', 'refs', 'recovery'], 'batch recovery preparation');
  if ((input.schema !== 'sec-exact-ref-batch-recovery-preparation-v1'
        && input.schema !== 'sec-exact-ref-batch-recovery-preparation-v2')
      || typeof input.repository !== 'string' || typeof input.expectedMainSha !== 'string'
      || typeof input.requestDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(input.requestDigest)
      || !Array.isArray(input.retirements) || !Array.isArray(input.refs)
      || input.refs.length !== input.retirements.length || input.recovery === null) {
    throw new Error('Batch recovery preparation identity is invalid');
  }
  const batch = captureBatchInput({ repositoryRoot: '.', repository: input.repository,
    expectedMainSha: input.expectedMainSha, requestDigest: input.requestDigest as `sha256:${string}`,
    retirements: input.retirements.map(parseExactRefRetirement) });
  const refs = input.refs.map((value, index) => {
    const row = record(value, 'batch recovery ref');
    preparationKeys(row, ['branch', 'expectedHeadSha', 'refState', 'blocker',
      ...(input.schema === 'sec-exact-ref-batch-recovery-preparation-v2' ? ['absenceObserved'] : [])], 'batch recovery ref');
    const retirement = batch.retirements[index]!;
    if (row.branch !== retirement.branches[0] || row.expectedHeadSha !== retirement.expectedHeadSha
        || (row.refState !== 'present' && row.refState !== 'absent' && row.refState !== 'unknown')
        || (input.schema === 'sec-exact-ref-batch-recovery-preparation-v2'
          && (typeof row.absenceObserved !== 'boolean' || (row.refState === 'absent' && row.absenceObserved !== true)))
        || (row.blocker !== null && (typeof row.blocker !== 'string'
          || row.blocker.length === 0 || row.blocker.length > 8192))) {
      throw new Error('Batch recovery ref differs from the exact plan');
    }
    return Object.freeze({ branch: retirement.branches[0], expectedHeadSha: retirement.expectedHeadSha,
      refState: row.refState, absenceObserved: row.absenceObserved === true || row.refState === 'absent', blocker: row.blocker });
  });
  // The established bundle codec remains the single durable bundle grammar.
  const recovery = parseExactRemoteRefRecoveryPreparation({
    schema: EXACT_REF_RECOVERY_PREPARATION_SCHEMA, repository: batch.repository,
    expectedMainSha: batch.expectedMainSha, retirement: batch.retirements[0],
    refState: 'present', recovery: input.recovery
  }).recovery;
  if (recovery === null) throw new Error('Batch recovery bundle is absent');
  return Object.freeze({ schema: 'sec-exact-ref-batch-recovery-preparation-v2',
    repository: batch.repository, expectedMainSha: batch.expectedMainSha,
    requestDigest: batch.requestDigest, retirements: batch.retirements,
    refs: Object.freeze(refs), recovery });
}

async function collectBatchInventory(input: BatchInput) {
  const activeWorkPackageObservation = await observeActiveWorkPackage(input.repositoryRoot);
  const inventory = collectBranchLifecycleInventory({
    repositoryRoot: input.repositoryRoot, activeWorkPackageObservation
  });
  if (inventory.repository.fullName !== input.repository
      || inventory.main.remoteSha !== input.expectedMainSha) {
    throw new Error('Batch inventory repository or exact main differs');
  }
  const unknowns = criticalInventoryUnknowns(inventory.unknowns);
  if (unknowns.length > 0) throw new Error(`Batch critical inventory is unresolved: ${unknowns.join(' | ')}`);
  // Unknown shared state blocks the batch; a known active branch blocks only that ref.
  assertActiveWorkPackageSafe(inventory.activeWorkPackage, []);
  return inventory;
}

async function observeBatchStaticClosure(
  capability: GitHubApiCapability,
  input: BatchInput,
  inventory: ReturnType<typeof collectBranchLifecycleInventory>,
  sourceRepositoryRoot: string,
  resumeReceiptDigest: `sha256:${string}` | null,
  recoveryCarrier?: ExactRefBatchRecoveryCarrier,
  onObservedRef?: (request: ExactRefRetirement, state: 'present' | 'absent') => Promise<void>
): Promise<ExactRemoteRefBatchRecoveryPreparation['refs']> {
  if (assertGitHubApiMaintenanceRequest(capability, input.requestDigest).resumeReceiptDigest !== resumeReceiptDigest) {
    throw new Error('Batch fresh/resume mode differs from the authenticated native dispatch');
  }
  await assertLiveMain(capability, inventory.repository.defaultBranch, input.expectedMainSha);
  if (recoveryCarrier !== undefined) {
    await assertBatchRecoveryCarrierLive(capability, recoveryCarrier);
    const run = record(await executeGitHubApiOperation(capability, { kind: 'maintenance-workflow-run-attempt',
      runId: String(recoveryCarrier.runId), runAttempt: recoveryCarrier.runAttempt }), 'recovery source run');
    if (String(run.id) !== String(recoveryCarrier.runId) || run.run_attempt !== 1
        || recoveryCarrier.runAttempt !== 1 || run.event !== 'workflow_dispatch'
        || !['in_progress', 'completed'].includes(String(run.status))
        || !['.github/workflows/repository-maintenance.yml', '.github/workflows/repository-maintenance.yml@main',
          '.github/workflows/repository-maintenance.yml@refs/heads/main'].includes(String(run.path))
        || run.head_sha !== input.expectedMainSha || run.head_branch !== 'main'
        || record(run.repository, 'recovery source repository').full_name !== input.repository
        || run.display_title !== `maintenance/${sha256({ requestDigest: input.requestDigest, resumeReceipt: null })}`) {
      throw new Error('Batch recovery carrier is not from the original authenticated fresh preparation');
    }
  }
  const pulls = await observeOpenPulls(capability, input.repository);
  const rows: ExactRemoteRefBatchRecoveryPreparation['refs'][number][] = [];
  for (const request of input.retirements) {
    let refState: 'present' | 'absent' | 'unknown' = 'unknown';
    // This is a complete admitted remote census, not a cache or a failed query.
    // Keep its historical absence even if the later exact read sees a recreated ref.
    let absenceObserved = !inventory.remoteBranches.some((ref) => ref.branch === request.branches[0]);
    let blocker: string | null = null;
    try {
      const branch = request.branches[0];
      const current = await observeGitRef(capability, branch);
      refState = current === null ? 'absent' : 'present';
      absenceObserved ||= current === null;
      await onObservedRef?.(request, refState);
      if (branch === inventory.repository.defaultBranch) throw new Error('Default branch cannot be retired');
      if (current !== null && current !== request.expectedHeadSha) throw new Error('Exact ref head drifted');
      assertActiveWorkPackageSafe(inventory.activeWorkPackage, request.branches);
      assertNoOpenPullConsumer(pulls, request.branches, input.repository);
      if (request.classification === 'reviewed-plan-superseded') {
        if (request.review.currentMainSha !== input.expectedMainSha) throw new Error('Review main differs from the batch');
        await observePlannedRefSupersessionEvidence({ repositoryRoot: sourceRepositoryRoot,
          capability, requestDigest: input.requestDigest, review: request.review });
      } else if (request.classification === 'closed-pr-superseded') {
        await assertExactClosedPullRequest(capability, input.repository, request);
      } else if (request.classification === 'main-tree-identical') {
        await assertMainTreeIdentical(capability, request, input.expectedMainSha);
      }
    } catch (error) {
      if (error instanceof BatchSharedPreconditionError) throw error;
      blocker = (error instanceof Error ? error.message : String(error)).slice(0, 8192);
    }
    rows.push(Object.freeze({ branch: request.branches[0], expectedHeadSha: request.expectedHeadSha,
      refState, absenceObserved, blocker }));
  }
  return Object.freeze(rows);
}

export async function prepareExactRemoteRefBatchRecovery(
  source: BatchInput
): Promise<ExactRemoteRefBatchRecoveryPreparation> {
  const input = captureBatchInput(source);
  const inventory = await collectBatchInventory(input);
  const recovery = createBatchRecoveryBundle({ inventory,
    refs: input.retirements.map((item) => ({ branch: item.branches[0], expectedHeadSha: item.expectedHeadSha })) });
  const refs = await withBatchRecoverySource({ inventory, recovery,
    operation: (sourceRepositoryRoot) => withGitHubApiReadSession({ repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      operation: (capability) => observeBatchStaticClosure(capability, input, inventory, sourceRepositoryRoot, null) }) });
  if (recovery.kind !== 'bundle') throw new Error('Batch preparation did not produce a complete bundle');
  return Object.freeze({ schema: 'sec-exact-ref-batch-recovery-preparation-v2',
    repository: input.repository, expectedMainSha: input.expectedMainSha,
    requestDigest: input.requestDigest, retirements: input.retirements, refs,
    recovery: Object.freeze({ bundleName: path.basename(recovery.path), sha256: recovery.sha256,
      verifyOutput: recovery.verifyOutput }) });
}

class BatchSharedPreconditionError extends Error {
  constructor(message: string, readonly observedTargetState?: 'present' | 'absent') { super(message); }
}

async function sharedBatchCheck<T>(operation: () => T | Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) { throw new BatchSharedPreconditionError(error instanceof Error ? error.message : String(error)); }
}

async function assertBatchRecoveryCarrierLive(capability: GitHubApiCapability,
  carrier: ExactRefBatchRecoveryCarrier | undefined): Promise<void> {
  if (carrier === undefined || Date.parse(carrier.expiresAt) <= Date.now()) {
    throw new Error('Batch durable recovery carrier is absent or expired');
  }
  const artifact = record(await executeGitHubApiOperation(capability, {
    kind: 'maintenance-artifact', artifactId: String(carrier.artifactId)
  }), 'batch durable recovery');
  if (artifact.id !== carrier.artifactId || artifact.name !== carrier.artifactName
      || artifact.digest !== carrier.artifactDigest || artifact.expired !== false
      || record(artifact.workflow_run, 'recovery workflow run').id !== carrier.runId
      || artifact.expires_at !== carrier.expiresAt || Date.parse(carrier.expiresAt) <= Date.now()) {
    throw new Error('Batch durable recovery carrier no longer matches its retained readback');
  }
}

async function observeBatchMutableBoundary(
  capability: GitHubApiCapability,
  input: BatchInput,
  request: ExactRefRetirement,
  defaultBranch: string,
  carrier: ExactRefBatchRecoveryCarrier | undefined
): Promise<string | null> {
  const active = await sharedBatchCheck(async () => {
  assertGitHubApiMaintenanceRequest(capability, input.requestDigest);
  const active = await observeActiveWorkPackage(input.repositoryRoot);
  if (active.repository !== input.repository || active.defaultBranch !== defaultBranch
      || active.defaultSha !== input.expectedMainSha) {
    throw new Error('Active Work Package owner identity drifted at the effect boundary');
  }
  assertActiveWorkPackageSafe(active, []);
  await assertLiveMain(capability, defaultBranch, input.expectedMainSha);
  await assertBatchRecoveryCarrierLive(capability, carrier);
  return active;
  });
  assertActiveWorkPackageSafe(active, request.branches);
  const pulls = await sharedBatchCheck(() => observeOpenPulls(capability, input.repository));
  assertNoOpenPullConsumer(pulls, request.branches, input.repository);
  if (request.classification === 'closed-pr-superseded') {
    await assertExactClosedPullRequest(capability, input.repository, request);
  }
  const observed = await observeGitRef(capability, request.branches[0]);
  try { await revalidateGitHubApiMaintenanceRequest(capability, input.requestDigest); }
  catch (error) {
    throw new BatchSharedPreconditionError(error instanceof Error ? error.message : String(error),
      observed === null ? 'absent' : 'present');
  }
  return observed;
}

async function retireExactRemoteRefBatchWithinBudget(source: BatchInput & Readonly<{
  preEffectRecovery: Readonly<{
    preparation: ExactRemoteRefBatchRecoveryPreparation;
    recovery: BranchRecoveryAuthority;
  }>;
  resumeReceipt?: ExactRefBatchResumeLocator;
  resumeObservation?: ExactRefBatchResumeObservation;
  recoveryCarrier: ExactRefBatchRecoveryCarrier;
  onResult: (result: ExactRemoteRefBatchResult) => void | Promise<void>;
  onProgress: (progress: ExactRemoteRefBatchProgress) => void | Promise<void>;
}>): Promise<Readonly<{
  schema: 'sec-exact-ref-batch-result-v1';
  requestDigest: `sha256:${string}`;
  completed: number;
  targetConverged: number;
  results: readonly ExactRemoteRefBatchResult[];
}>> {
  const input = captureBatchInput(source);
  if (typeof source.onProgress !== 'function' || typeof source.onResult !== 'function') {
    throw new Error('Batch execution requires its durable progress and result consumers');
  }
  const preparation = parseExactRemoteRefBatchRecoveryPreparation(source.preEffectRecovery.preparation);
  if (preparation.requestDigest !== input.requestDigest
      || preparation.recovery.sha256 !== source.preEffectRecovery.recovery.sha256) {
    throw new Error('Published batch recovery differs from the exact request');
  }
  const resume = source.resumeObservation ?? (source.resumeReceipt === undefined ? undefined
    : await observeExactRefBatchResumeReceipt({ ...input, resumeReceipt: source.resumeReceipt }));
  if (resume !== undefined && (!issuedBatchResumes.has(resume)
      || sha256(resume.recoveryPreparation) !== sha256(preparation)
      || source.recoveryCarrier === undefined
      || sha256(resume.recoveryCarrier) !== sha256(source.recoveryCarrier))) {
    throw new Error('Batch resume must retain the original owner-observed recovery and carrier');
  }
  const phases = new Map<ExactRemoteRefBatchProgress['phase'], Set<string>>([
    ['effect-started', new Set()], ['effect-returned', new Set()],
    ['absence-observed', new Set()], ['recreation-observed', new Set()]
  ]);
  for (const row of resume?.progress ?? []) phases.get(row.phase)!.add(row.branch);
  const recordProgress = async (branch: string, expectedHeadSha: string,
    phase: ExactRemoteRefBatchProgress['phase']): Promise<void> => {
    if (phases.get(phase)!.has(branch)) return;
    await sharedBatchCheck(() => source.onProgress(Object.freeze({ branch, expectedHeadSha, phase })));
    phases.get(phase)!.add(branch);
  };
  const noteObservedRef = async (request: ExactRefRetirement, state: 'present' | 'absent'): Promise<void> => {
    const branch = request.branches[0];
    if (state === 'absent') await recordProgress(branch, request.expectedHeadSha, 'absence-observed');
    else if (phases.get('absence-observed')!.has(branch) || phases.get('effect-returned')!.has(branch)) {
      await recordProgress(branch, request.expectedHeadSha, 'recreation-observed');
    }
  };
  // Historical facts precede this invocation's observations. Preserve them before
  // any later shared failure, without combining a newer absence with an older presence.
  for (const [index, request] of input.retirements.entries()) {
    const prepared = preparation.refs[index]!;
    const prior = resume?.results.find((row) => row.branch === request.branches[0]);
    if (prepared.absenceObserved || prior?.targetState === 'absent') {
      await recordProgress(request.branches[0], request.expectedHeadSha, 'absence-observed');
    }
    // A legacy receipt may predate recreation-observed while still proving that
    // its original CAS returned before a terminal present observation. Fold that
    // authenticated history now, before this invocation can observe a new absence.
    if ((prepared.absenceObserved && prepared.refState === 'present')
        || (prior?.targetState === 'present' && (phases.get('absence-observed')!.has(request.branches[0])
          || phases.get('effect-returned')!.has(request.branches[0])))) {
      await recordProgress(request.branches[0], request.expectedHeadSha, 'recreation-observed');
    }
  }
  const inventory = await collectBatchInventory(input);
  for (const request of input.retirements) {
    await noteObservedRef(request, inventory.remoteBranches.some((ref) => ref.branch === request.branches[0]) ? 'present' : 'absent');
  }
  const verified = verifyRecoveryAuthorityHeadsLive({ inventory,
    recovery: source.preEffectRecovery.recovery,
    expectedHeads: [...input.retirements.map((item) => item.expectedHeadSha), input.expectedMainSha],
    requireComplete: true });
  if (verified.status !== 'success') throw new Error(`Published batch recovery is invalid: ${verified.detail}`);
  // Static semantics are immutable exact Git objects, checked once for this execution.
  // This reissues evidence after a process boundary; downloaded JSON itself has no authority.
  const admitted = await withBatchRecoverySource({ inventory, recovery: source.preEffectRecovery.recovery,
    operation: (sourceRepositoryRoot) => withGitHubApiReadSession({ repositoryRoot: input.repositoryRoot,
      repository: input.repository,
      operation: (capability) => observeBatchStaticClosure(capability, input, inventory, sourceRepositoryRoot,
        source.resumeObservation !== undefined ? issuedBatchResumes.get(source.resumeObservation) ?? null
          : source.resumeReceipt === undefined ? null : sha256(source.resumeReceipt), source.recoveryCarrier,
        noteObservedRef) }) });
  const started = phases.get('effect-started')!;
  const results: ExactRemoteRefBatchResult[] = [];
  let sharedFailure: string | undefined;
  for (const [index, request] of input.retirements.entries()) {
    const identity = { branch: request.branches[0], expectedHeadSha: request.expectedHeadSha };
    let attempted = started.has(identity.branch);
    let effectAcknowledged = phases.get('effect-returned')!.has(identity.branch);
    let targetState: ExactRemoteRefBatchResult['targetState'] = 'unknown';
    let sessionEntered = false;
    let result: ExactRemoteRefBatchResult;
    try {
      if (sharedFailure !== undefined) throw new BatchSharedPreconditionError(sharedFailure);
      const blocker = admitted[index]!.blocker;
      if (blocker !== null) throw new Error(blocker);
      result = await withGitHubApiBranchCloseoutWriteSession({ repositoryRoot: input.repositoryRoot,
        repository: input.repository, operation: async (capability) => {
          sessionEntered = true;
          const before = await observeBatchMutableBoundary(capability, input, request,
            inventory.repository.defaultBranch, source.recoveryCarrier);
          targetState = before === null ? 'absent' : 'present';
          await noteObservedRef(request, targetState);
          const prior = resume?.results.find((row) => row.branch === identity.branch);
          const returned = resume?.progress.some((row) => row.branch === identity.branch && row.phase === 'effect-returned');
          const continuation = decideExactRefBatchContinuation({
            mode: resume === undefined ? 'fresh' : 'resume',
            absenceObserved: phases.get('absence-observed')!.has(identity.branch),
            recreationObserved: phases.get('recreation-observed')!.has(identity.branch),
            preparedState: preparation.refs[index]!.refState, expectedHeadSha: identity.expectedHeadSha,
            currentHeadSha: before, priorEffect: prior?.status === 'retired' ? 'settled'
              : returned === true ? 'returned' : started.has(identity.branch) ? 'started' : 'not-started'
          });
          if (continuation === 'readback-only') {
            throw new Error('Resume is readback-only; this unstarted item requires a newly explicit fresh plan and current admission');
          }
          if (continuation === 'unsettled-identity') {
            throw new Error('Target is currently absent, but authenticated recreation prevents attributing this object to the original CAS');
          }
          if (continuation === 'blocked-drift' || continuation === 'blocked-recreation') {
            throw new Error(continuation === 'blocked-drift' ? 'Exact ref old OID changed'
              : 'Previously absent or attempted ref is present; CAS cannot replay across a possible recreation');
          }
          if (continuation === 'retired') return Object.freeze({ ...identity, status: 'retired' as const,
            targetState: 'absent' as const, effectOutcome: 'acknowledged' as const,
            detail: 'Original successful CAS receipt and current terminal readback settled; CAS not replayed' });
          if (continuation === 'converged-observed') return Object.freeze({ ...identity, status: 'converged-observed' as const,
            targetState: 'absent' as const, effectOutcome: 'unknown' as const,
            detail: 'Target absence and current guards observed; original CAS outcome remains unknown; no replay' });
          if (continuation === 'absent-unattributed') return Object.freeze({ ...identity, status: 'absent-unattributed' as const,
            targetState: 'absent' as const, effectOutcome: 'not-attempted' as const,
            detail: 'Ref is absent without an authenticated original effect receipt; CAS not replayed' });
          await recordProgress(identity.branch, identity.expectedHeadSha, 'effect-started');
          attempted = true;
          targetState = 'unknown';
          await executeGitHubApiOperation(capability, { kind: 'delete-ref-cas',
            branch: identity.branch, expectedOldSha: identity.expectedHeadSha });
          effectAcknowledged = true;
          await recordProgress(identity.branch, identity.expectedHeadSha, 'effect-returned');
          const after = await observeBatchMutableBoundary(capability, input, request,
            inventory.repository.defaultBranch, source.recoveryCarrier);
          targetState = after === null ? 'absent' : 'present';
          await noteObservedRef(request, targetState);
          if (after !== null) throw new Error('Exact ref remains after CAS');
          return Object.freeze({ ...identity, status: 'retired' as const,
            targetState: 'absent' as const, effectOutcome: 'acknowledged' as const,
            detail: 'Exact-old-OID CAS and independent mutable-guard/ref readback settled' });
        } });
    } catch (error) {
      if (error instanceof BatchSharedPreconditionError && error.observedTargetState !== undefined) {
        targetState = error.observedTargetState;
        await noteObservedRef(request, targetState);
      }
      // A session-enrollment failure affects current maintainer/plan/budget authority for every remaining ref.
      if (error instanceof BatchSharedPreconditionError || (!sessionEntered && admitted[index]!.blocker === null)) {
        sharedFailure = error instanceof Error ? error.message : String(error);
      }
      result = Object.freeze({ ...identity, status: attempted ? 'unsettled' as const : 'blocked' as const,
        targetState, effectOutcome: effectAcknowledged ? 'acknowledged' as const
          : attempted ? 'unknown' as const : 'not-attempted' as const,
        detail: (error instanceof Error ? error.message : String(error)).slice(0, 8192) });
    }
    results.push(result);
    // An unpersisted result is not safe to bury beneath later effects.
    await source.onResult(result);
  }
  return Object.freeze({ schema: 'sec-exact-ref-batch-result-v1', requestDigest: input.requestDigest,
    completed: results.filter((result) => result.status === 'retired').length,
    targetConverged: results.filter((result) => result.targetState === 'absent').length,
    results: Object.freeze(results) });
}

export type ExactRefBatchResumeLocator = Readonly<{
  artifactId: string;
  artifactDigest: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}>;

export type ExactRefBatchRecoveryCarrier = Readonly<{
  provider: 'github-actions-artifact';
  repository: string;
  artifactId: number;
  artifactName: string;
  artifactDigest: `sha256:${string}`;
  runId: number;
  runAttempt: number;
  requestedRetentionDays: number;
  createdAt: string;
  expiresAt: string;
  url: string;
}>;

export type ExactRefBatchResumeObservation = Readonly<{
  recoveryPreparation: ExactRemoteRefBatchRecoveryPreparation;
  recoveryCarrier: ExactRefBatchRecoveryCarrier;
  progress: readonly ExactRemoteRefBatchProgress[];
  results: readonly ExactRemoteRefBatchResult[];
}>;
const issuedBatchResumes = new WeakMap<object, `sha256:${string}`>();

/** Read original execution receipts, not a caller's replacement or a new deletion request. */
export async function observeExactRefBatchResumeReceipt(
  source: BatchInput & Readonly<{ resumeReceipt: ExactRefBatchResumeLocator }>
): Promise<ExactRefBatchResumeObservation> {
  const input = captureBatchInput(source);
  const locator = Object.freeze({ ...source.resumeReceipt });
  if (!/^[1-9][0-9]*$/u.test(locator.artifactId) || !/^[1-9][0-9]*$/u.test(locator.runId)
      || !Number.isSafeInteger(Number(locator.artifactId)) || !Number.isSafeInteger(Number(locator.runId))
      || !Number.isSafeInteger(locator.runAttempt) || locator.runAttempt < 1
      || !/^sha256:[0-9a-f]{64}$/u.test(locator.artifactDigest)) {
    throw new Error('Batch resume locator is invalid');
  }
  return withGitHubApiReadSession({ repositoryRoot: input.repositoryRoot, repository: input.repository,
    operation: async (capability) => {
      if (assertGitHubApiMaintenanceRequest(capability, input.requestDigest).resumeReceiptDigest !== sha256(locator)) {
        throw new Error('Batch resume locator differs from the authenticated native dispatch');
      }
      const run = record(await executeGitHubApiOperation(capability, {
        kind: 'maintenance-workflow-run-attempt', runId: locator.runId, runAttempt: locator.runAttempt
      }), 'original maintenance run');
      if (String(run.id) !== locator.runId || run.run_attempt !== locator.runAttempt
          || !['.github/workflows/repository-maintenance.yml', '.github/workflows/repository-maintenance.yml@main',
            '.github/workflows/repository-maintenance.yml@refs/heads/main'].includes(String(run.path))
          || run.event !== 'workflow_dispatch' || run.status !== 'completed'
          || run.head_sha !== input.expectedMainSha || run.head_branch !== 'main'
          || record(run.repository, 'original run repository').full_name !== input.repository
          || record(run.head_repository, 'original run head repository').full_name !== input.repository
          || record(run.actor, 'original run actor').type !== 'User') {
        throw new Error('Batch resume source is not the original trusted completed maintenance run');
      }
      const text = await executeGitHubApiOperation(capability, {
        kind: 'maintenance-artifact-text', artifactId: locator.artifactId,
        artifactName: `sec-repository-maintenance-result-${locator.runId}-${locator.runAttempt}`,
        runId: locator.runId, archiveDigest: locator.artifactDigest, fileName: 'maintenance-result.json'
      });
      if (typeof text !== 'string') throw new Error('Batch resume result member is absent');
      const receipt = record(JSON.parse(text), 'batch result receipt');
      if (receipt.schema !== 'sec-repository-maintenance-result-v3' || receipt.requestDigest !== input.requestDigest
          || !Object.hasOwn(receipt, 'resumeReceipt')
          || run.display_title !== `maintenance/${sha256({ requestDigest: input.requestDigest, resumeReceipt: receipt.resumeReceipt })}`) {
        throw new Error('Batch resume receipt differs from the exact fixed request');
      }
      const recoveryPreparation = parseExactRemoteRefBatchRecoveryPreparation(receipt.recoveryPreparation);
      if (recoveryPreparation.requestDigest !== input.requestDigest) throw new Error('Resume recovery plan differs');
      const carrier = record(receipt.recoveryCarrier, 'batch recovery carrier');
      for (const key of ['artifactId', 'runId', 'runAttempt', 'requestedRetentionDays']) {
        if (!Number.isSafeInteger(carrier[key]) || Number(carrier[key]) < 1) {
          throw new Error('Batch recovery carrier numeric identity is invalid');
        }
      }
      if (carrier.provider !== 'github-actions-artifact' || carrier.repository !== input.repository
          || carrier.artifactName !== `sec-repository-maintenance-recovery-${carrier.runId}-${carrier.runAttempt}`
          || typeof carrier.artifactDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(carrier.artifactDigest)
          || typeof carrier.createdAt !== 'string' || !Number.isFinite(Date.parse(carrier.createdAt))
          || typeof carrier.expiresAt !== 'string' || !Number.isFinite(Date.parse(carrier.expiresAt))
          || Date.parse(carrier.expiresAt) <= Date.now()
          || carrier.url !== `https://github.com/${input.repository}/actions/runs/${carrier.runId}/artifacts/${carrier.artifactId}`) {
        throw new Error('Batch recovery carrier identity or retained recovery window is invalid');
      }
      const identities = new Map(input.retirements.map((item) => [item.branches[0], item.expectedHeadSha]));
      if (!Array.isArray(receipt.progress) || receipt.progress.length > input.retirements.length * 4
          || !Array.isArray(receipt.results) || receipt.results.length > input.retirements.length) {
        throw new Error('Batch resume progress/result census is invalid');
      }
      const started = new Set<string>();
      const returned = new Set<string>();
      const absent = new Set<string>();
      const recreated = new Set<string>();
      const progress = receipt.progress.map((value) => {
        const row = record(value, 'batch progress');
        preparationKeys(row, ['branch', 'expectedHeadSha', 'phase'], 'batch progress');
        if (typeof row.branch !== 'string' || identities.get(row.branch) !== row.expectedHeadSha
            || !['effect-started', 'effect-returned', 'absence-observed', 'recreation-observed'].includes(String(row.phase))) {
          throw new Error('Batch resume progress differs from the original exact ref');
        }
        if (row.phase === 'effect-started') {
          if (started.has(row.branch) || absent.has(row.branch) || recreated.has(row.branch)) {
            throw new Error('Batch receipt repeats an effect start or starts after observed absence/recreation');
          }
          started.add(row.branch);
        } else if (row.phase === 'effect-returned') {
          if (!started.has(row.branch) || returned.has(row.branch)) throw new Error('Batch effect return has no unique prior start');
          returned.add(row.branch);
        } else if (row.phase === 'absence-observed') {
          if (absent.has(row.branch)) throw new Error('Batch receipt repeats an absence fact');
          absent.add(row.branch);
        } else {
          if (recreated.has(row.branch) || (!absent.has(row.branch) && !returned.has(row.branch))) {
            throw new Error('Batch recreation has no authenticated prior absence or successful deletion');
          }
          recreated.add(row.branch);
        }
        return Object.freeze({ branch: row.branch, expectedHeadSha: row.expectedHeadSha as string,
          phase: row.phase as ExactRemoteRefBatchProgress['phase'] });
      });
      const resultBranches = new Set<string>();
      const results = receipt.results.map((value) => {
        const row = record(value, 'batch result');
        preparationKeys(row, ['branch', 'expectedHeadSha', 'status', 'targetState', 'effectOutcome', 'detail'], 'batch result');
        if (typeof row.branch !== 'string' || identities.get(row.branch) !== row.expectedHeadSha
            || resultBranches.has(row.branch) || typeof row.detail !== 'string' || row.detail.length > 8192
            || !['retired', 'converged-observed', 'blocked', 'unsettled', 'absent-unattributed'].includes(String(row.status))
            || (['retired', 'converged-observed', 'unsettled'].includes(String(row.status)) && !started.has(row.branch))
            || (row.status === 'retired' && (!returned.has(row.branch) || recreated.has(row.branch)))
            || (row.effectOutcome === 'acknowledged' && !returned.has(row.branch))
            || !['absent', 'present', 'unknown'].includes(String(row.targetState))
            || !['acknowledged', 'unknown', 'not-attempted'].includes(String(row.effectOutcome))
            || (['retired', 'converged-observed', 'absent-unattributed'].includes(String(row.status)) && row.targetState !== 'absent')
            || (row.status === 'retired' && row.effectOutcome !== 'acknowledged')
            || (row.status === 'converged-observed' && row.effectOutcome !== 'unknown')
            || (row.status === 'absent-unattributed' && row.effectOutcome !== 'not-attempted')) {
          throw new Error('Batch resume result differs from its original effect receipt');
        }
        resultBranches.add(row.branch);
        return Object.freeze({ branch: row.branch, expectedHeadSha: row.expectedHeadSha as string,
          status: row.status as ExactRemoteRefBatchResult['status'],
          targetState: row.targetState as ExactRemoteRefBatchResult['targetState'],
          effectOutcome: row.effectOutcome as ExactRemoteRefBatchResult['effectOutcome'], detail: row.detail });
      });
      const observation = Object.freeze({ recoveryPreparation,
        recoveryCarrier: Object.freeze({ ...carrier }) as ExactRefBatchRecoveryCarrier,
        progress: Object.freeze(progress), results: Object.freeze(results) });
      issuedBatchResumes.set(observation, sha256(locator));
      return observation;
    } });
}


export async function retireExactRemoteRefBatch(
  source: Parameters<typeof retireExactRemoteRefBatchWithinBudget>[0]
): ReturnType<typeof retireExactRemoteRefBatchWithinBudget> {
  const input = captureBatchInput(source);
  return withGitHubApiMaintenanceOperationBudget({ ...input,
    operation: () => retireExactRemoteRefBatchWithinBudget(source) });
}
