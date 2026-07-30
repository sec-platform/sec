import { expect, test } from 'bun:test';

import {
  buildScopeAttestPayload,
  buildVerificationPayload,
  computeManifestDigestFromBytes,
  parsePrInfo,
  parseWorkflowRuns,
  selectSuccessfulRun,
  shouldSquashToSingleParent
} from '../../scripts/codex/sec-merge-bootstrap.ts';

const HEAD_SHA = '0123456789abcdef0123456789abcdef01234567';
const BASE_SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const OTHER_SHA = '1111111111111111111111111111111111111111';

const SAMPLE_MANIFEST = `---
schema: codex-development-work-package-v1
id: test-wp-v1
tracking: none
base: "${BASE_SHA}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: test-task
    owner: test-worker
    ownedPaths:
      - platform/shared/test.ts
forbiddenPaths:
  - platform/compiler/
acceptance:
  - one
tests:
  - tests/unit/test.test.ts
---

# Test Work Package
`;

function prInfo(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    number: 200,
    headRefOid: HEAD_SHA,
    baseRefOid: BASE_SHA,
    headRefName: 'feat/test-branch',
    state: 'OPEN',
    body: 'Work-Package: docs/work-packages/test-wp-v1.md\n\nSome description.',
    ...overrides
  });
}

function locatorParser(body: string): string {
  const match = body.match(/^Work-Package: (docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md)$/mu);
  if (!match) throw new Error('locator missing');
  return match[1]!;
}

// ---------------------------------------------------------------------------
// computeManifestDigestFromBytes
// ---------------------------------------------------------------------------

test('computeManifestDigestFromBytes produces sha256 digest and git blob SHA-1', () => {
  const bytes = Buffer.from(SAMPLE_MANIFEST, 'utf8');
  const result = computeManifestDigestFromBytes(bytes);
  expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(result.blobSha).toMatch(/^[0-9a-f]{40}$/u);
  expect(result.byteLength).toBe(bytes.byteLength);
});

test('computeManifestDigestFromBytes digest is stable across calls with same bytes', () => {
  const bytes = Buffer.from(SAMPLE_MANIFEST, 'utf8');
  const left = computeManifestDigestFromBytes(bytes);
  const right = computeManifestDigestFromBytes(bytes);
  expect(left.digest).toBe(right.digest);
  expect(left.blobSha).toBe(right.blobSha);
});

test('computeManifestDigestFromBytes digest changes when bytes differ', () => {
  const left = computeManifestDigestFromBytes(Buffer.from(SAMPLE_MANIFEST, 'utf8'));
  const right = computeManifestDigestFromBytes(Buffer.from(`${SAMPLE_MANIFEST}\n# extra\n`, 'utf8'));
  expect(left.digest).not.toBe(right.digest);
  expect(left.blobSha).not.toBe(right.blobSha);
});

// ---------------------------------------------------------------------------
// buildScopeAttestPayload
// ---------------------------------------------------------------------------

test('buildScopeAttestPayload produces exactly 4 keys with correct values', () => {
  const pr = parsePrInfo(prInfo(), locatorParser);
  const manifest = computeManifestDigestFromBytes(Buffer.from(SAMPLE_MANIFEST, 'utf8'));
  const payload = buildScopeAttestPayload(pr, manifest);
  const keys = Object.keys(payload).sort();
  expect(keys).toEqual(['expected_base', 'expected_head', 'manifest_digest', 'pull_request']);
  expect(payload.pull_request).toBe(200);
  expect(payload.expected_head).toBe(HEAD_SHA);
  expect(payload.expected_base).toBe(BASE_SHA);
  expect(payload.manifest_digest).toBe(manifest.digest);
});

// ---------------------------------------------------------------------------
// buildVerificationPayload
// ---------------------------------------------------------------------------

test('buildVerificationPayload produces exactly 7 keys with correct values', () => {
  const pr = parsePrInfo(prInfo(), locatorParser);
  const manifest = computeManifestDigestFromBytes(Buffer.from(SAMPLE_MANIFEST, 'utf8'));
  const payload = buildVerificationPayload(pr, manifest, 'full');
  const keys = Object.keys(payload).sort();
  expect(keys).toEqual([
    'expected_base',
    'expected_head',
    'manifest_digest',
    'manifest_path',
    'profile',
    'pull_request',
    'schema'
  ]);
  expect(payload.schema).toBe('codex-development-frozen-verification-request-v1');
  expect(payload.pull_request).toBe(200);
  expect(payload.expected_head).toBe(HEAD_SHA);
  expect(payload.expected_base).toBe(BASE_SHA);
  expect(payload.manifest_path).toBe('docs/work-packages/test-wp-v1.md');
  expect(payload.manifest_digest).toBe(manifest.digest);
  expect(payload.profile).toBe('full');
});

test('buildVerificationPayload accepts quick and full profiles', () => {
  const pr = parsePrInfo(prInfo(), () => 'docs/work-packages/test-wp-v1.md');
  const manifest = computeManifestDigestFromBytes(Buffer.from(SAMPLE_MANIFEST, 'utf8'));
  const quick = buildVerificationPayload(pr, manifest, 'quick');
  const full = buildVerificationPayload(pr, manifest, 'full');
  expect(quick.profile).toBe('quick');
  expect(full.profile).toBe('full');
});

// ---------------------------------------------------------------------------
// shouldSquashToSingleParent
// ---------------------------------------------------------------------------

test('shouldSquashToSingleParent returns false when exactly one parent equals base', () => {
  expect(shouldSquashToSingleParent([BASE_SHA], BASE_SHA)).toBe(false);
});

test('shouldSquashToSingleParent returns true when parents count differs from 1', () => {
  expect(shouldSquashToSingleParent([], BASE_SHA)).toBe(true);
  expect(shouldSquashToSingleParent([BASE_SHA, OTHER_SHA], BASE_SHA)).toBe(true);
});

test('shouldSquashToSingleParent returns true when single parent differs from base', () => {
  expect(shouldSquashToSingleParent([OTHER_SHA], BASE_SHA)).toBe(true);
});

// ---------------------------------------------------------------------------
// parsePrInfo
// ---------------------------------------------------------------------------

test('parsePrInfo parses valid PR JSON and extracts manifest path via locator', () => {
  const json = JSON.stringify({
    number: 42,
    headRefOid: HEAD_SHA,
    baseRefOid: BASE_SHA,
    headRefName: 'feat/branch',
    state: 'OPEN',
    body: 'Work-Package: docs/work-packages/my-wp-v1.md\n\ndesc'
  });
  const pr = parsePrInfo(json, (body) => {
    const match = body.match(/^Work-Package: (docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md)$/mu);
    if (!match) throw new Error('locator missing');
    return match[1]!;
  });
  expect(pr.number).toBe(42);
  expect(pr.headSha).toBe(HEAD_SHA);
  expect(pr.baseSha).toBe(BASE_SHA);
  expect(pr.headBranch).toBe('feat/branch');
  expect(pr.state).toBe('OPEN');
  expect(pr.manifestPath).toBe('docs/work-packages/my-wp-v1.md');
});

test('parsePrInfo throws when head SHA is not 40-char hex', () => {
  const json = JSON.stringify({
    number: 1,
    headRefOid: 'short',
    baseRefOid: BASE_SHA,
    headRefName: 'b',
    state: 'OPEN',
    body: ''
  });
  expect(() => parsePrInfo(json, () => 'docs/work-packages/x-v1.md')).toThrow('headRefOid');
});

test('parsePrInfo throws when PR number is not a safe positive integer', () => {
  const json = JSON.stringify({
    number: -1,
    headRefOid: HEAD_SHA,
    baseRefOid: BASE_SHA,
    headRefName: 'b',
    state: 'OPEN',
    body: ''
  });
  expect(() => parsePrInfo(json, () => 'docs/work-packages/x-v1.md')).toThrow('number');
});

test('parsePrInfo throws when headRefName is empty', () => {
  const json = JSON.stringify({
    number: 1,
    headRefOid: HEAD_SHA,
    baseRefOid: BASE_SHA,
    headRefName: '',
    state: 'OPEN',
    body: ''
  });
  expect(() => parsePrInfo(json, () => 'docs/work-packages/x-v1.md')).toThrow('headRefName');
});

// ---------------------------------------------------------------------------
// parseWorkflowRuns
// ---------------------------------------------------------------------------

test('parseWorkflowRuns parses valid array of workflow runs', () => {
  const json = JSON.stringify([
    {
      databaseId: 100,
      status: 'completed',
      conclusion: 'success',
      displayTitle: 'attest PR #1',
      headSha: BASE_SHA
    },
    {
      databaseId: 101,
      status: 'in_progress',
      conclusion: null,
      displayTitle: 'verify PR #1',
      headSha: BASE_SHA
    }
  ]);
  const runs = parseWorkflowRuns(json);
  expect(runs).toHaveLength(2);
  expect(runs[0]!.databaseId).toBe(100);
  expect(runs[0]!.conclusion).toBe('success');
  expect(runs[1]!.conclusion).toBeNull();
  expect(runs[1]!.status).toBe('in_progress');
});

test('parseWorkflowRuns throws when input is not an array', () => {
  expect(() => parseWorkflowRuns(JSON.stringify({ not: 'array' }))).toThrow('not an array');
});

test('parseWorkflowRuns throws when databaseId is invalid', () => {
  const json = JSON.stringify([{ databaseId: 0, status: 'completed', displayTitle: 't', headSha: BASE_SHA }]);
  expect(() => parseWorkflowRuns(json)).toThrow('databaseId');
});

test('parseWorkflowRuns throws when status is missing', () => {
  const json = JSON.stringify([{ databaseId: 1, displayTitle: 't', headSha: BASE_SHA }]);
  expect(() => parseWorkflowRuns(json)).toThrow('status');
});

// ---------------------------------------------------------------------------
// selectSuccessfulRun
// ---------------------------------------------------------------------------

test('selectSuccessfulRun returns latest matching successful run', () => {
  const runs = [
    { databaseId: 100, status: 'completed', conclusion: 'success', displayTitle: 't1', headSha: BASE_SHA },
    { databaseId: 200, status: 'completed', conclusion: 'success', displayTitle: 't1', headSha: BASE_SHA },
    { databaseId: 300, status: 'completed', conclusion: 'success', displayTitle: 't1', headSha: BASE_SHA }
  ];
  const selected = selectSuccessfulRun(runs, 't1', BASE_SHA);
  expect(selected.databaseId).toBe(300);
});

test('selectSuccessfulRun throws when no matching run exists', () => {
  const runs = [
    { databaseId: 1, status: 'completed', conclusion: 'success', displayTitle: 'other', headSha: BASE_SHA }
  ];
  expect(() => selectSuccessfulRun(runs, 't1', BASE_SHA)).toThrow('No workflow run');
});

test('selectSuccessfulRun throws when latest matching run is not successful', () => {
  const runs = [
    { databaseId: 1, status: 'completed', conclusion: 'failure', displayTitle: 't1', headSha: BASE_SHA }
  ];
  expect(() => selectSuccessfulRun(runs, 't1', BASE_SHA)).toThrow('not successful');
});

test('selectSuccessfulRun throws when latest matching run is still in_progress', () => {
  const runs = [
    { databaseId: 1, status: 'in_progress', conclusion: null, displayTitle: 't1', headSha: BASE_SHA }
  ];
  expect(() => selectSuccessfulRun(runs, 't1', BASE_SHA)).toThrow('not successful');
});
