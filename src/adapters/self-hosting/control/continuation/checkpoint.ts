import { Buffer } from 'node:buffer';
import { z } from 'zod';

import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';

const LOCAL_CONTINUATION_CHECKPOINT_SCHEMA =
  'sec-local-continuation-checkpoint-v1' as const;
const LOCAL_CONTINUATION_ADMISSION_SCHEMA =
  'sec-local-continuation-admission-v1' as const;
export const LOCAL_CONTINUATION_CHECKPOINT_MAX_BYTES = 8 * 1024;

type LocalContinuationDigest = `sha256:${string}`;

/**
 * Cross-session frozen facts that cannot be safely rediscovered from the local
 * candidate alone. Work Package semantics and parent identity are deliberately
 * derived from the exact bound Git objects instead of being duplicated here.
 */
export interface LocalContinuationCheckpoint {
  readonly schema: typeof LOCAL_CONTINUATION_CHECKPOINT_SCHEMA;
  readonly repository: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly checkpointDigest: LocalContinuationDigest;
}

export type LocalContinuationCheckpointInput = Omit<
  LocalContinuationCheckpoint,
  'schema' | 'checkpointDigest'
>;

export interface LocalContinuationObservation {
  readonly repositoryRoot: string;
  readonly branch: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly parentShas: readonly string[];
  readonly baseTreeSha: string;
  readonly worktreeClean: boolean;
  readonly manifestPath: string;
  readonly manifestDigest: LocalContinuationDigest;
  readonly workPackageId: string;
  readonly tracking: string;
  readonly manifestBaseSha: string;
  readonly requiredProfile: 'quick' | 'full';
  readonly ciRevision: `ci-verification-v${number}`;
  readonly changedPathCount: number;
  readonly ownershipChecked: true;
}

export interface LocalContinuationAdmission {
  readonly schema: typeof LOCAL_CONTINUATION_ADMISSION_SCHEMA;
  readonly status: 'admitted';
  readonly authority: 'context-compression-only';
  readonly checkpointDigest: LocalContinuationDigest;
  readonly repository: string;
  readonly prNumber: number;
  readonly branch: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestPath: string;
  readonly manifestDigest: LocalContinuationDigest;
  readonly workPackageId: string;
  readonly tracking: string;
  readonly requiredProfile: 'quick' | 'full';
  readonly ciRevision: `ci-verification-v${number}`;
  readonly changedPathCount: number;
  readonly remoteRefreshDisposition: 'not-required-by-local-invalidation';
  readonly nextAuthorityBoundary: 'trusted-base-physical-verification';
  readonly admissionDigest: LocalContinuationDigest;
}

function fail(message: string): never {
  throw new Error(`LocalContinuation ${message}`);
}

function hash(value: unknown): LocalContinuationDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

const canonicalText = z.string().min(1).max(512).refine(
  value => value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value),
  'must be bounded canonical text.'
);
const gitSha = canonicalText.regex(/^[0-9a-f]{40}$/u, 'must be a lowercase Git SHA.');
const canonicalBranch = canonicalText.refine(result => {
  const segments = result.split('/');
  return !(result === '@' || result.startsWith('/') || result.endsWith('/') || result.endsWith('.')
    || result.includes('..') || result.includes('@{') || result.includes('\\')
    || /[ ~^:?*\[]/u.test(result) || result.includes('//')
    || segments.some((segment) => segment.length === 0 || segment.startsWith('.') || segment.endsWith('.lock')));
}, 'branch is not a canonical Git branch name.');

const checkpointInput = z.object({
  repository: canonicalText.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u,
    'repository must be owner/name.'),
  prNumber: z.int().positive(),
  branch: canonicalBranch,
  baseSha: gitSha,
  baseTreeSha: gitSha,
  headSha: gitSha,
  headTreeSha: gitSha,
  manifestPath: canonicalText.regex(/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u,
    'manifestPath is not canonical.')
});
const checkpointEnvelope = checkpointInput.extend({
  schema: z.literal(LOCAL_CONTINUATION_CHECKPOINT_SCHEMA),
  checkpointDigest: z.string()
}).strict();

export function createLocalContinuationCheckpoint(
  input: LocalContinuationCheckpointInput
): LocalContinuationCheckpoint {
  return sealCheckpoint(checkpointInput.parse(input));
}

function sealCheckpoint(input: LocalContinuationCheckpointInput): LocalContinuationCheckpoint {
  const semantic = Object.freeze({
    schema: LOCAL_CONTINUATION_CHECKPOINT_SCHEMA,
    ...input
  });
  if (semantic.headSha === semantic.baseSha) {
    fail('headSha must differ from baseSha for one active handoff candidate.');
  }
  return Object.freeze({ ...semantic, checkpointDigest: hash(semantic) });
}

export function parseLocalContinuationCheckpoint(source: string): LocalContinuationCheckpoint {
  if (Buffer.byteLength(source, 'utf8') > LOCAL_CONTINUATION_CHECKPOINT_MAX_BYTES) {
    fail('checkpoint input exceeds the canonical byte bound.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error('LocalContinuation checkpoint is not JSON.', { cause: error });
  }
  const value = checkpointEnvelope.parse(parsed);
  const { schema: _schema, checkpointDigest: _checkpointDigest, ...input } = value;
  const checkpoint = sealCheckpoint(input);
  if (checkpoint.checkpointDigest !== value.checkpointDigest) fail('checkpoint digest mismatch.');
  return checkpoint;
}

export function admitLocalContinuation(input: Readonly<{
  checkpoint: LocalContinuationCheckpoint;
  observation: LocalContinuationObservation;
}>): LocalContinuationAdmission {
  const checkpoint = parseLocalContinuationCheckpoint(encodeVerificationActionData(input.checkpoint));
  const observation = input.observation;
  const checks: readonly [unknown, unknown, string][] = [
    [observation.branch, checkpoint.branch, 'branch'],
    [observation.headSha, checkpoint.headSha, 'headSha'],
    [observation.headTreeSha, checkpoint.headTreeSha, 'headTreeSha'],
    [observation.baseTreeSha, checkpoint.baseTreeSha, 'baseTreeSha'],
    [observation.manifestPath, checkpoint.manifestPath, 'manifestPath'],
    [observation.manifestBaseSha, checkpoint.baseSha, 'manifestBaseSha']
  ];
  for (const [actual, expected, label] of checks) {
    if (actual !== expected) fail(`${label} drifted; refresh external facts before continuing.`);
  }
  if (observation.parentShas.length !== 1 || observation.parentShas[0] !== checkpoint.baseSha) {
    fail('candidate is no longer the canonical one-parent child of the frozen base.');
  }
  if (observation.worktreeClean !== true) fail('worktree is not clean.');
  if (observation.ownershipChecked !== true || !Number.isSafeInteger(observation.changedPathCount)
    || observation.changedPathCount < 1) {
    fail('changed-path ownership admission is incomplete.');
  }
  const semantic = Object.freeze({
    schema: LOCAL_CONTINUATION_ADMISSION_SCHEMA,
    status: 'admitted' as const,
    authority: 'context-compression-only' as const,
    checkpointDigest: checkpoint.checkpointDigest,
    repository: checkpoint.repository,
    prNumber: checkpoint.prNumber,
    branch: checkpoint.branch,
    baseSha: checkpoint.baseSha,
    baseTreeSha: checkpoint.baseTreeSha,
    headSha: checkpoint.headSha,
    headTreeSha: checkpoint.headTreeSha,
    manifestPath: checkpoint.manifestPath,
    manifestDigest: observation.manifestDigest,
    workPackageId: observation.workPackageId,
    tracking: observation.tracking,
    requiredProfile: observation.requiredProfile,
    ciRevision: observation.ciRevision,
    changedPathCount: observation.changedPathCount,
    remoteRefreshDisposition: 'not-required-by-local-invalidation' as const,
    nextAuthorityBoundary: 'trusted-base-physical-verification' as const
  });
  return Object.freeze({ ...semantic, admissionDigest: hash(semantic) });
}
