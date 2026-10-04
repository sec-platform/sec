import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent,
  type AuthenticatedGitHubJobOrigin,
  type AuthenticatedGitHubJobOriginObservation
} from '../../../providers/github-api/hosted-job-origin.ts';
import {
  createSecTrustedBootstrapTrustRoot,
  matchSecTrustedBootstrapPath,
  SEC_TCB_CLOSURE_RUNTIME_PATH,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY,
  type SecTrustedBootstrapTrustRoot
} from '../../../verification/platform/trust/contract/root.ts';
import { compileTcbClosureIdentity, createTcbClosureCandidateSnapshot, finalizeTcbClosureCandidateSnapshot, trustedRuntimeClosure } from '../../../verification/platform/trust/runtime/closure-lock.ts';
import { GIT_READ_OPERATION_BUDGET, gitReadText } from '../../development/tooling/git/git-read.ts';

declare const postMergePlanBrand: unique symbol;
export type TrustedRuntimePostMergeMainHealthPlan = Readonly<{ [postMergePlanBrand]: true }>;
export class PostMergeMainHealthUnqualifiedError extends Error {
  readonly code = 'post-merge-main-health-unqualified' as const;
  constructor(readonly reason: 'origin' | 'driver-drift' | 'subject-drift' | 'plan-changed' | 'closure-unavailable') {
    super(`Post-merge MainHealth is unqualified (${reason}).`);
  }
}

interface PlanRecord {
  readonly origin: AuthenticatedGitHubJobOrigin;
  readonly observation: AuthenticatedGitHubJobOriginObservation;
  readonly trustRoot: SecTrustedBootstrapTrustRoot;
  readonly candidateTreeSha: string;
}
const plans = new WeakMap<object, PlanRecord>();
const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
function fail(reason: PostMergeMainHealthUnqualifiedError['reason']): never {
  throw new PostMergeMainHealthUnqualifiedError(reason);
}

/** Pure applicability over a complete exact-tree diff, including deletions and
 * both sides of renames. This result never qualifies an execution by itself. */
export function assertMainHealthDriverPlanApplicable(
  changedPaths: readonly string[], trustRoot: SecTrustedBootstrapTrustRoot
): void {
  if (new Set(changedPaths).size !== changedPaths.length) fail('closure-unavailable');
  for (const changedPath of changedPaths) {
    try {
      if (matchSecTrustedBootstrapPath(changedPath, trustRoot) !== null) fail('plan-changed');
    } catch (error) {
      if (error instanceof PostMergeMainHealthUnqualifiedError) throw error;
      fail('closure-unavailable');
    }
  }
}

/** Data check used after the original walker reads the real static target. */
export function assertMainHealthStaticBoundaryCovered(
  dependencies: Iterable<string>, trustRoot: SecTrustedBootstrapTrustRoot
): void {
  for (const dependency of dependencies) {
    if (matchSecTrustedBootstrapPath(dependency, trustRoot) === null) fail('closure-unavailable');
  }
}

async function observeCompatibleSubject(record: PlanRecord, subjectSha: string, subjectTreeSha: string): Promise<void> {
  if (!/^[0-9a-f]{40}$/u.test(subjectSha) || !/^[0-9a-f]{40}$/u.test(subjectTreeSha)) fail('subject-drift');
  const observation = assertAuthenticatedGitHubJobOriginCurrent(record.origin);
  if (observation.identityDigest !== record.observation.identityDigest
      || observation.trustedDriverRoot !== SOURCE_ROOT) fail('origin');
  await withAuthorityGitReadSession({ cwd: observation.trustedDriverRoot,
    budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
    const assertDriver = async (): Promise<void> => {
      const head = (await gitReadText(session, ['rev-parse', 'HEAD'])).trim();
      const tree = (await gitReadText(session, ['rev-parse', 'HEAD^{tree}'])).trim();
      const status = await gitReadText(session, ['status', '--porcelain=v1', '--untracked-files=all']);
      if (head !== observation.trustedSourceSha || tree !== observation.trustedSourceTreeSha || status !== '') fail('driver-drift');
    };
    await assertDriver();
    const subjectTree = (await gitReadText(session, ['rev-parse', '--verify', `${subjectSha}^{tree}`])).trim();
    if (subjectTree !== subjectTreeSha) fail('subject-drift');
    const paths = await gitReadText(session, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames',
      '--name-only', '-z', observation.trustedSourceSha, subjectSha, '--']);
    if (paths !== '' && !paths.endsWith('\0')) fail('closure-unavailable');
    assertMainHealthDriverPlanApplicable(paths === '' ? [] : paths.slice(0, -1).split('\0'), record.trustRoot);
    await assertDriver();
  });
  assertAuthenticatedGitHubJobOriginCurrent(record.origin);
}

/** Capture the loaded driver's closed policy before merge, never from the
 * post-merge subject. The opaque plan records applicability, not health. */
async function captureLoadedDriverMainHealthPlan(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  repository: string;
  repositoryRoot: string;
  candidateSha: string;
  candidateTreeSha: string;
}>, invocation: 'before-merge' | 'closeout-recovery'): Promise<TrustedRuntimePostMergeMainHealthPlan> {
  input = Object.freeze({ origin: input.origin, repository: input.repository,
    repositoryRoot: input.repositoryRoot, candidateSha: input.candidateSha,
    candidateTreeSha: input.candidateTreeSha });
  const observation = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  if (observation.repository !== input.repository || observation.trustedDriverRoot !== input.repositoryRoot
      || observation.trustedDriverRoot !== SOURCE_ROOT || observation.policyJobId !== 'integrate'
      || observation.role !== 'control'
      || observation.workflowPath !== '.github/workflows/merge-gate.yml') fail('origin');
  if (invocation === 'before-merge'
    ? observation.phase !== 'integrate-hosted'
    : observation.phase !== 'closeout-mutate-hosted' && observation.phase !== 'closeout-publish-hosted') {
    fail('origin');
  }
  let trustRoot: SecTrustedBootstrapTrustRoot;
  try {
    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: observation.trustedDriverRoot });
    const closure = compileTcbClosureIdentity({ candidateSnapshot: snapshot });
    trustRoot = createSecTrustedBootstrapTrustRoot({ registry: SEC_TRUSTED_BOOTSTRAP_REGISTRY,
      causalRuntimePaths: closure.modules });
    // The static-exact boundary prevents a self-hash cycle. Independently walk
    // its real dependencies in the same retained source snapshot: skipping the
    // boundary must not silently exempt another executable source file.
    const boundary = trustedRuntimeClosure([SEC_TCB_CLOSURE_RUNTIME_PATH], { candidateSnapshot: snapshot });
    assertMainHealthStaticBoundaryCovered(boundary.closure, trustRoot);
    finalizeTcbClosureCandidateSnapshot(snapshot);
  } catch { fail('closure-unavailable'); }
  const record: PlanRecord = Object.freeze({ origin: input.origin, observation, trustRoot,
    candidateTreeSha: input.candidateTreeSha });
  await observeCompatibleSubject(record, input.candidateSha, input.candidateTreeSha);
  const plan = Object.freeze({}) as TrustedRuntimePostMergeMainHealthPlan;
  plans.set(plan, record);
  return plan;
}

export function prepareTrustedRuntimePostMergeMainHealthPlan(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  repository: string;
  repositoryRoot: string;
  candidateSha: string;
  candidateTreeSha: string;
}>): Promise<TrustedRuntimePostMergeMainHealthPlan> {
  return captureLoadedDriverMainHealthPlan(input, 'before-merge');
}

/** A recovery process qualifies its own actually loaded driver against the
 * exact merged subject. Historical plans, receipts and preceding deadlines
 * cannot revive this invocation. This capability proves applicability only;
 * original marker, request and human authorization admission remains required
 * at every native closeout effect. */
export function prepareTrustedRuntimeRecoveryMainHealthPlan(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  repository: string;
  repositoryRoot: string;
  mergedSha: string;
  mergedTreeSha: string;
}>): Promise<TrustedRuntimePostMergeMainHealthPlan> {
  return captureLoadedDriverMainHealthPlan({ origin: input.origin,
    repository: input.repository, repositoryRoot: input.repositoryRoot,
    candidateSha: input.mergedSha, candidateTreeSha: input.mergedTreeSha }, 'closeout-recovery');
}

export async function assertTrustedRuntimePostMergeMainHealthPlanCurrent(input: Readonly<{
  plan: TrustedRuntimePostMergeMainHealthPlan;
  origin: AuthenticatedGitHubJobOrigin;
  mainSha: string;
  mainTreeSha: string;
}>): Promise<AuthenticatedGitHubJobOriginObservation> {
  input = Object.freeze({ plan: input.plan, origin: input.origin,
    mainSha: input.mainSha, mainTreeSha: input.mainTreeSha });
  const record = plans.get(input.plan);
  if (record === undefined || record.origin !== input.origin) fail('origin');
  if (input.mainTreeSha !== record.candidateTreeSha) fail('subject-drift');
  await observeCompatibleSubject(record, input.mainSha, input.mainTreeSha);
  return assertAuthenticatedGitHubJobOriginCurrent(record.origin);
}

