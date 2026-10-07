import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSecRuntimeStateForRepository } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { readLocalVerificationStatusWithTrustedRuntime, verifyWithTrustedRuntime } from '../../src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { assertVerificationSessionLocalPreparationV2Current, createVerificationSessionLocalPreparationRequestV2 } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { parseVerificationSessionLocalPreparationRequest, prepareLocalVerificationIntent } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import type { GitHubCandidateObservation } from '../../src/execution/verification/session.ts';

const D = `sha256:${'a'.repeat(64)}` as const;
const BASE = '1'.repeat(40), HEAD = '3'.repeat(40);
function facts() {
  return {
    repository: 'sec-platform/sec',
    candidate: { repository: 'sec-platform/sec', number: 123, baseSha: BASE, baseTreeSha: '2'.repeat(40),
      headSha: HEAD, headTreeSha: '4'.repeat(40), authorNodeId: 'AUTHOR' } as GitHubCandidateObservation,
    manifestPath: 'config/repository/work-packages/local.md', manifestDigest: D,
    changedPaths: ['src/example.ts'], profile: 'full' as const,
    testImpactTransition: CodexDevelopmentCreateTestImpactTransitionObservation({ baseSha: BASE, headSha: HEAD,
      records: [{ status: 'changed', path: 'src/example.ts' }], readPathBlob: () => null }),
    // Full inventory has no source-provider selection dependency. This is a
    // pure planner fixture, never a source or physical qualification.
    testImpactSourceProvider: null, producerPrincipalNodeId: 'MAINTAINER',
    dependencyBlobs: CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map(p => ({ path: p,
      baseSource: 'fixed dependency fixture', candidateSource: 'fixed dependency fixture' }))
  };
}
function preparation() { return prepareLocalVerificationIntent(facts()); }

test('actual V2 planning owner freezes requirements without constructing health, Session or Action authority', () => {
  const prepared = preparation();
  expect(prepared).toEqual(preparation());
  expect(prepared.request.qualificationRequirements.nativeContentManifestDigest).toBeNull();
  expect(prepared.request.qualificationRequirements.trustedRevision).toBe(BASE);
  for (const key of ['health', 'healthy', 'mainHealth', 'expectedSessionRevision', 'expectedActionPlanDigest', 'authorization']) {
    expect(Object.hasOwn(prepared.request, key)).toBe(false);
  }
  expect(parseVerificationSessionLocalPreparationRequest(JSON.stringify(prepared))).toEqual(prepared);
});

test('source facts, actor, plan profile and dependency closure cannot drift under a saved V2 request', () => {
  const saved = preparation();
  const original = facts();
  const changedActor = prepareLocalVerificationIntent({ ...original, producerPrincipalNodeId: 'OTHER' });
  expect(() => assertVerificationSessionLocalPreparationV2Current(saved, changedActor)).toThrow();
  const changedDependencies = prepareLocalVerificationIntent({ ...original,
    dependencyBlobs: original.dependencyBlobs.map(v => ({ ...v, baseSource: 'different', candidateSource: 'different' })) });
  expect(() => assertVerificationSessionLocalPreparationV2Current(saved, changedDependencies)).toThrow();
  expect(() => prepareLocalVerificationIntent({ ...original, dependencyBlobs: [] })).toThrow('incomplete');
  expect(() => prepareLocalVerificationIntent({ ...original,
    dependencyBlobs: original.dependencyBlobs.map(v => ({ ...v, candidateSource: 'drift' })) })).toThrow('drifted');
});

function stateFixture(operation: (input: { root: string; state: string; cache: string; records: string }) => void) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-local-v2-'));
  const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
  mkdirSync(root);
  const oldState = process.env.SEC_STATE_HOME, oldCache = process.env.SEC_CACHE_HOME;
  process.env.SEC_STATE_HOME = state; process.env.SEC_CACHE_HOME = cache;
  try {
    const layout = resolveSecRuntimeStateForRepository({ repositoryRoot: root, repository: 'sec-platform/sec' });
    operation({ root, state, cache, records: path.join(layout.repositoryStateRoot, 'trusted-runtime',
      'local-preparation-v2', preparation().request.requestOperationId.slice(7)) });
  } finally {
    if (oldState === undefined) delete process.env.SEC_STATE_HOME; else process.env.SEC_STATE_HOME = oldState;
    if (oldCache === undefined) delete process.env.SEC_CACHE_HOME; else process.env.SEC_CACHE_HOME = oldCache;
    rmSync(parent, { recursive: true, force: true });
  }
}

test('V2 read-only status has no invented Session and creates no runtime roots', () => {
  stateFixture(({ root, state, cache }) => {
    const status = readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() });
    expect(status).toMatchObject({ status: 'LOCAL_REQUEST_OBSERVED', stage: 'read-only-projection',
      sessionRevision: null, verificationStatus: 'not-observed', preparationInputMatched: false,
      sourceQualification: 'not-revalidated', executionStarted: false });
    expect(existsSync(state)).toBe(false); expect(existsSync(cache)).toBe(false);
  });
});

test('copied preparation input alone never revives live qualification or creates a Session', () => {
  stateFixture(({ root, records }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'local-preparation-request.json'), `${encodeVerificationActionData(preparation())}\n`);
    const status = readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() });
    expect(status).toMatchObject({ preparationInputMatched: true, sessionRevision: null,
      evidenceRecord: 'not-observed', sourceQualification: 'not-revalidated', integrationAuthorization: 'not-evaluated' });
  });
});

test('V2 status rejects absent or different original preparation before accepting prior computation', () => {
  stateFixture(({ root, records }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'verification-action.json'), '{}');
    const read = () => readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() });
    expect(read).toThrow('no exact stored preparation');
    const { requestDigest: _digest, requestOperationId: _operation, ...body } = preparation().request;
    const other = createVerificationSessionLocalPreparationRequestV2({ ...body, actorNodeId: 'OTHER' });
    writeFileSync(path.join(records, 'local-preparation-request.json'), `${encodeVerificationActionData(other)}\n`);
    expect(read).toThrow();
  });
});

test('V2 repository mismatch is rejected before execution provider discovery', async () => {
  await expect(verifyWithTrustedRuntime({ repositoryRoot: '/does-not-exist',
    repository: 'other/repo', request: preparation() })).rejects.toThrow('another repository');
});

test('V2 attempt-only residue cannot be adopted by recreating a missing preparation input', () => {
  stateFixture(({ root, records }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'source-program-attempt-historical.json'), '{}');
    expect(() => readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: preparation() })).toThrow('no exact stored preparation');
  });
});

test('public local decoder enforces byte and depth limits before version-specific decoding', () => {
  expect(() => parseVerificationSessionLocalPreparationRequest(' '.repeat(1024 * 1024) + '{'))
    .toThrow('bounded UTF-8 input size');
  expect(() => parseVerificationSessionLocalPreparationRequest('雪'.repeat(400_000)))
    .toThrow('bounded UTF-8 input size');
  expect(() => parseVerificationSessionLocalPreparationRequest('{"a":{"b":{"c":{"d":{"e":1}}}}}'))
    .toThrow('depth');
  const v2 = JSON.stringify(preparation());
  expect(() => parseVerificationSessionLocalPreparationRequest(v2.replace('{', '{"schema":"duplicate",')))
    .toThrow('duplicate');
});
