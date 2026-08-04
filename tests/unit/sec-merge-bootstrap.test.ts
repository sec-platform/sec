import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
    title: 'feat: test work package',
    state: 'OPEN',
    body: 'Work-Package: docs/work-packages/test-wp-v1.md\n\nSome description.',
    ...overrides
  });
}

function locatorParser(body: string): string {
  const match = /^Work-Package: (docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md)$/mu.exec(body);
  if (!match) throw new Error('locator missing');
  return match[1]!;
}

test('manifest identity includes stable SHA-256 and Git blob SHA-1', () => {
  const bytes = Buffer.from(SAMPLE_MANIFEST, 'utf8');
  const first = computeManifestDigestFromBytes(bytes);
  const second = computeManifestDigestFromBytes(bytes);
  expect(first).toEqual(second);
  expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(first.blobSha).toMatch(/^[0-9a-f]{40}$/u);
  expect(first.byteLength).toBe(bytes.byteLength);
  expect(computeManifestDigestFromBytes(Buffer.from(`${SAMPLE_MANIFEST}\n`)).digest)
    .not.toBe(first.digest);
});

test('scope and verification payloads have exact bounded keys', () => {
  const pr = parsePrInfo(prInfo(), locatorParser);
  const manifest = computeManifestDigestFromBytes(Buffer.from(SAMPLE_MANIFEST));
  const scope = buildScopeAttestPayload(pr, manifest);
  const verification = buildVerificationPayload(pr, manifest, 'full');
  expect(Object.keys(scope).sort()).toEqual([
    'expected_base', 'expected_head', 'manifest_digest', 'pull_request'
  ]);
  expect(Object.keys(verification).sort()).toEqual([
    'expected_base',
    'expected_head',
    'manifest_digest',
    'manifest_path',
    'profile',
    'pull_request',
    'schema'
  ]);
  expect(verification.profile).toBe('full');
  expect(verification.expected_head).toBe(HEAD_SHA);
});

test('single-parent decision binds the only parent to the exact base', () => {
  expect(shouldSquashToSingleParent([BASE_SHA], BASE_SHA)).toBe(false);
  expect(shouldSquashToSingleParent([], BASE_SHA)).toBe(true);
  expect(shouldSquashToSingleParent([BASE_SHA, OTHER_SHA], BASE_SHA)).toBe(true);
  expect(shouldSquashToSingleParent([OTHER_SHA], BASE_SHA)).toBe(true);
});

test('PR parser binds exact identity and frozen manifest locator', () => {
  const parsed = parsePrInfo(prInfo(), locatorParser);
  expect(parsed.number).toBe(200);
  expect(parsed.headSha).toBe(HEAD_SHA);
  expect(parsed.baseSha).toBe(BASE_SHA);
  expect(parsed.headBranch).toBe('feat/test-branch');
  expect(parsed.manifestPath).toBe('docs/work-packages/test-wp-v1.md');
});

test('PR parser rejects malformed identity', () => {
  expect(() => parsePrInfo(prInfo({ number: 0 }), locatorParser)).toThrow('number');
  expect(() => parsePrInfo(prInfo({ headRefOid: 'short' }), locatorParser)).toThrow('headRefOid');
  expect(() => parsePrInfo(prInfo({ baseRefOid: 'short' }), locatorParser)).toThrow('baseRefOid');
  expect(() => parsePrInfo(prInfo({ headRefName: '' }), locatorParser)).toThrow('headRefName');
});

test('workflow parser and selector use the latest exact title/head run', () => {
  const runs = parseWorkflowRuns(JSON.stringify([
    {
      databaseId: 100,
      status: 'completed',
      conclusion: 'success',
      displayTitle: 'exact',
      headSha: BASE_SHA
    },
    {
      databaseId: 200,
      status: 'completed',
      conclusion: 'success',
      displayTitle: 'exact',
      headSha: BASE_SHA
    },
    {
      databaseId: 300,
      status: 'completed',
      conclusion: 'failure',
      displayTitle: 'other',
      headSha: BASE_SHA
    }
  ]));
  expect(selectSuccessfulRun(runs, 'exact', BASE_SHA).databaseId).toBe(200);
  expect(() => selectSuccessfulRun(runs, 'missing', BASE_SHA)).toThrow('No workflow run');
  expect(() => selectSuccessfulRun(runs, 'other', BASE_SHA)).toThrow('not successful');
});

test('workflow parser rejects malformed rows', () => {
  expect(() => parseWorkflowRuns(JSON.stringify({}))).toThrow('not an array');
  expect(() => parseWorkflowRuns(JSON.stringify([{
    databaseId: 0,
    status: 'completed',
    displayTitle: 'x',
    headSha: BASE_SHA
  }]))).toThrow('databaseId');
});

test('full bootstrap orders proof, durable recovery, merge and typed closeout', () => {
  const source = readFileSync(
    join(__dirname, '../../scripts/codex/sec-merge-bootstrap-runtime.ts'),
    'utf8'
  ).replaceAll('\r\n', '\n');
  const start = source.indexOf('function commandAll(');
  const end = source.indexOf('\n}\n\ninterface CliArguments', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);

  const squash = body.indexOf('ensureSingleParent(ctx, pr)');
  const attest = body.indexOf('runAttestation(ctx, pr, manifest');
  const verify = body.indexOf('runVerification(ctx, pr, manifest');
  const recovery = body.indexOf('prepareMergedPullRequestCloseout(');
  const merge = body.indexOf('adminSquashMerge(ctx, pr)');
  const mainReadback = body.indexOf('readNewMain(ctx');
  const closeout = body.indexOf('finalizeMergedPullRequestCloseout(');

  expect(squash).toBeGreaterThan(-1);
  expect(squash).toBeLessThan(attest);
  expect(attest).toBeLessThan(verify);
  expect(verify).toBeLessThan(recovery);
  expect(recovery).toBeLessThan(merge);
  expect(merge).toBeLessThan(mainReadback);
  expect(mainReadback).toBeLessThan(closeout);
});

test('bootstrap contains no post-merge pointer patch or best-effort branch deletion', () => {
  const source = [
    'sec-merge-bootstrap.ts',
    'sec-merge-bootstrap-runtime.ts'
  ].map((fileName) => readFileSync(
    join(__dirname, `../../scripts/codex/${fileName}`),
    'utf8'
  )).join('\n');
  expect(source).not.toContain('postMergePointerPatch');
  expect(source).not.toContain("git', ['branch', '-D'");
  expect(source).not.toContain('/git/refs/heads/');
  expect(source).toContain('branch-lifecycle.ts');
});
