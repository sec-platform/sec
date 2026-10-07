import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  executeGitHubApiOperation,
  withGitHubApiVerificationSession
} from '../../../providers/github-api/operation-session.ts';
import { parseExactRefRetirement, type ExactRefRetirement } from './exact-ref-retirement-contract.ts';

/** Historical maintenance evidence only. This module cannot dispatch or delete refs. */
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
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
  return withGitHubApiVerificationSession({ repositoryRoot: input.repositoryRoot, repository: input.repository,
    effect: 'verification-read',
    operation: async (capability) => {
      const run = record(await executeGitHubApiOperation(capability, {
        kind: 'verification-workflow-run-attempt', runId: locator.runId, runAttempt: locator.runAttempt
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
        kind: 'verification-artifact-text', artifactId: locator.artifactId,
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
      return observation;
    } });
}
