/**
 * SEC minimal Verification Session foundation (Issue #311 Phase 0).
 *
 * Machine Work Package registry projection, stable Manifest/FreezeSession
 * separation, and Candidate Tree parity. The #313 published receipt mechanism
 * is an input fact for sessions; this module never duplicates publication or
 * readback.
 */

import { createHash } from 'node:crypto';

export const VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1 =
  'sec-verification-registry-projection-v1' as const;
export const VERIFICATION_FREEZE_SESSION_SCHEMA_V1 =
  'sec-verification-freeze-session-v1' as const;
export const VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1 =
  'sec-verification-candidate-tree-parity-v1' as const;

export type VerificationManifestSource = 'default' | 'open-pr';

export interface VerificationRegistryEntryV1 {
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  source: VerificationManifestSource;
  prNumber: number | null;
  baseSha: string | null;
  headSha: string | null;
  headTreeSha: string | null;
}

export interface VerificationRegistryProjectionV1 {
  schema: typeof VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1;
  observedAt: string;
  repository: string;
  defaultBranch: string;
  defaultTreeSha: string;
  entries: VerificationRegistryEntryV1[];
}

export interface VerificationFreezeSessionV1 {
  schema: typeof VERIFICATION_FREEZE_SESSION_SCHEMA_V1;
  sessionId: string;
  frozenAt: string;
  repository: string;
  prNumber: number;
  baseSha: string;
  headSha: string;
  manifestPath: string;
  manifestDigest: `sha256:${string}`;
  candidateTreeSha: string;
  sessionDigest: `sha256:${string}`;
}

export interface VerificationCandidateTreeParityV1 {
  schema: typeof VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1;
  checkedAt: string;
  repository: string;
  sessionId: string;
  prNumber: number;
  candidateTreeSha: string;
  mergedTreeSha: string;
  parity: 'matched' | 'drift';
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function assertSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be a 40-character SHA.`);
  }
  return value;
}

function assertDigest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function assertRepository(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)
  ) {
    throw new Error('Verification session repository must be one owner/name identity.');
  }
  return value;
}

function assertManifestPath(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(value)
  ) {
    throw new Error('Manifest path must match docs/work-packages/<id>.md.');
  }
  return value;
}

function assertSessionId(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[a-z0-9][a-z0-9-]{1,127}$/u.test(value)
  ) {
    throw new Error('Session id must be a bounded lowercase identifier.');
  }
  return value;
}

function assertPrNumber(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('Pull request number must be a positive safe integer.');
  }
  return value as number;
}

function assertIsoDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return value;
}

export function parseVerificationRegistryProjectionV1(
  source: string
): VerificationRegistryProjectionV1 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Verification registry projection');
  if (parsed.schema !== VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1) {
    throw new Error('Verification registry projection schema mismatch.');
  }
  assertExactKeys(
    parsed,
    ['schema', 'observedAt', 'repository', 'defaultBranch', 'defaultTreeSha', 'entries'],
    'Verification registry projection'
  );
  const entries = parsed.entries;
  if (!Array.isArray(entries)) throw new Error('Registry entries must be an array.');
  const normalizedEntries = entries.map((entry, index) => {
    assertRecord(entry, `Registry entry ${index}`);
    assertExactKeys(
      entry,
      ['manifestPath', 'manifestDigest', 'source', 'prNumber', 'baseSha', 'headSha', 'headTreeSha'],
      `Registry entry ${index}`
    );
    const source = entry.source;
    let sourceKind: VerificationManifestSource;
    if (source === 'default') {
      sourceKind = 'default';
    } else if (source === 'open-pr') {
      sourceKind = 'open-pr';
    } else {
      throw new Error(`Registry entry ${index} source is invalid.`);
    }
    const manifestPath = assertManifestPath(entry.manifestPath);
    const prNumber = entry.prNumber === null ? null : assertPrNumber(entry.prNumber);
    if (sourceKind === 'open-pr' && (prNumber === null || entry.baseSha === null || entry.headSha === null || entry.headTreeSha === null)) {
      throw new Error(`Registry entry ${index} open-pr source requires PR/base/head/tree identity.`);
    }
    if (sourceKind === 'default' && (prNumber !== null || entry.baseSha !== null || entry.headSha !== null || entry.headTreeSha !== null)) {
      throw new Error(`Registry entry ${index} default source cannot bind PR identity.`);
    }
    return {
      manifestPath,
      manifestDigest: assertDigest(entry.manifestDigest, `Registry entry ${index} digest`),
      source: sourceKind,
      prNumber,
      baseSha: entry.baseSha === null ? null : assertSha(entry.baseSha, `Registry entry ${index} base`),
      headSha: entry.headSha === null ? null : assertSha(entry.headSha, `Registry entry ${index} head`),
      headTreeSha: entry.headTreeSha === null
        ? null
        : assertSha(entry.headTreeSha, `Registry entry ${index} head tree`)
    };
  });
  const paths = normalizedEntries.map(({ manifestPath }) => manifestPath);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Registry projection contains duplicate manifest paths.');
  }
  return {
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA_V1,
    observedAt: assertIsoDate(parsed.observedAt, 'Registry observedAt'),
    repository: assertRepository(parsed.repository),
    defaultBranch: typeof parsed.defaultBranch === 'string' && parsed.defaultBranch.length > 0
      ? parsed.defaultBranch
      : (() => { throw new Error('Registry defaultBranch is invalid.'); })(),
    defaultTreeSha: assertSha(parsed.defaultTreeSha, 'Registry defaultTreeSha'),
    entries: normalizedEntries
  };
}

export function createFreezeSessionV1(input: Omit<
  VerificationFreezeSessionV1,
  'schema' | 'sessionDigest'
>): VerificationFreezeSessionV1 {
  assertSessionId(input.sessionId);
  assertIsoDate(input.frozenAt, 'Freeze session frozenAt');
  assertRepository(input.repository);
  assertPrNumber(input.prNumber);
  assertSha(input.baseSha, 'Freeze session base');
  assertSha(input.headSha, 'Freeze session head');
  assertManifestPath(input.manifestPath);
  assertDigest(input.manifestDigest, 'Freeze session manifestDigest');
  assertSha(input.candidateTreeSha, 'Freeze session candidateTreeSha');
  const withoutDigest = {
    schema: VERIFICATION_FREEZE_SESSION_SCHEMA_V1,
    ...input
  };
  return {
    ...withoutDigest,
    sessionDigest: sessionDigest(withoutDigest)
  };
}

function sessionDigest(value: Record<string, unknown>): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

export function parseVerificationFreezeSessionV1(source: string): VerificationFreezeSessionV1 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Verification freeze session');
  if (parsed.schema !== VERIFICATION_FREEZE_SESSION_SCHEMA_V1) {
    throw new Error('Verification freeze session schema mismatch.');
  }
  assertExactKeys(
    parsed,
    ['schema', 'sessionId', 'frozenAt', 'repository', 'prNumber', 'baseSha', 'headSha', 'manifestPath', 'manifestDigest', 'candidateTreeSha', 'sessionDigest'],
    'Verification freeze session'
  );
  const { sessionDigest: _sessionDigest, ...withoutDigest } = parsed;
  if (sessionDigest(withoutDigest) !== parsed.sessionDigest) {
    throw new Error('Verification freeze session digest mismatch.');
  }
  return {
    schema: VERIFICATION_FREEZE_SESSION_SCHEMA_V1,
    sessionId: assertSessionId(parsed.sessionId),
    frozenAt: assertIsoDate(parsed.frozenAt, 'Freeze session frozenAt'),
    repository: assertRepository(parsed.repository),
    prNumber: assertPrNumber(parsed.prNumber),
    baseSha: assertSha(parsed.baseSha, 'Freeze session base'),
    headSha: assertSha(parsed.headSha, 'Freeze session head'),
    manifestPath: assertManifestPath(parsed.manifestPath),
    manifestDigest: assertDigest(parsed.manifestDigest, 'Freeze session manifestDigest'),
    candidateTreeSha: assertSha(parsed.candidateTreeSha, 'Freeze session candidateTreeSha'),
    sessionDigest: assertDigest(parsed.sessionDigest, 'Freeze session sessionDigest')
  };
}

export function createCandidateTreeParityV1(input: Omit<
  VerificationCandidateTreeParityV1,
  'schema' | 'parity'
>): VerificationCandidateTreeParityV1 {
  assertIsoDate(input.checkedAt, 'Candidate tree parity checkedAt');
  assertRepository(input.repository);
  assertSessionId(input.sessionId);
  assertPrNumber(input.prNumber);
  assertSha(input.candidateTreeSha, 'Candidate tree candidateTreeSha');
  assertSha(input.mergedTreeSha, 'Candidate tree mergedTreeSha');
  return {
    ...input,
    schema: VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1,
    parity: input.candidateTreeSha === input.mergedTreeSha ? 'matched' : 'drift'
  };
}

export function parseVerificationCandidateTreeParityV1(
  source: string
): VerificationCandidateTreeParityV1 {
  const parsed: unknown = JSON.parse(source);
  assertRecord(parsed, 'Candidate tree parity');
  if (parsed.schema !== VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1) {
    throw new Error('Candidate tree parity schema mismatch.');
  }
  assertExactKeys(
    parsed,
    ['schema', 'checkedAt', 'repository', 'sessionId', 'prNumber', 'candidateTreeSha', 'mergedTreeSha', 'parity'],
    'Candidate tree parity'
  );
  if (parsed.parity !== 'matched' && parsed.parity !== 'drift') {
    throw new Error('Candidate tree parity value is invalid.');
  }
  return {
    schema: VERIFICATION_CANDIDATE_TREE_PARITY_SCHEMA_V1,
    checkedAt: assertIsoDate(parsed.checkedAt, 'Candidate tree parity checkedAt'),
    repository: assertRepository(parsed.repository),
    sessionId: assertSessionId(parsed.sessionId),
    prNumber: assertPrNumber(parsed.prNumber),
    candidateTreeSha: assertSha(parsed.candidateTreeSha, 'Candidate tree candidateTreeSha'),
    mergedTreeSha: assertSha(parsed.mergedTreeSha, 'Candidate tree mergedTreeSha'),
    parity: parsed.parity
  };
}
