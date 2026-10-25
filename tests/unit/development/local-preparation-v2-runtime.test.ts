import { settleResources, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSecRuntimeStateForRepository } from '../../../src/adapters/runtime-state/workspace-state/paths.ts';
import { readLocalVerificationStatusWithTrustedRuntime, verifyWithTrustedRuntime } from '../../../src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../../src/adapters/verification/platform/action/contract/environment.ts';
import { assertVerificationSessionLocalPreparationV2Current, createVerificationSessionLocalPreparationRequestV2 } from '../../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { parseVerificationSessionLocalPreparationRequest, prepareLocalVerificationIntent } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import type { GitHubCandidateObservation } from '../../../src/execution/verification/session.ts';

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

function stateFixture(operation: (input: { root: string; state: string; cache: string; records: string;
  prepared: ReturnType<typeof preparation> }) => void) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-local-v2-'));
  const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
  const oldState = process.env.SEC_STATE_HOME, oldCache = process.env.SEC_CACHE_HOME;
  let primary: ResourceSettlementFailure | undefined;
  try {
    mkdirSync(root);
    process.env.SEC_STATE_HOME = state; process.env.SEC_CACHE_HOME = cache;
    const layout = resolveSecRuntimeStateForRepository({ repositoryRoot: root, repository: 'sec-platform/sec' });
    const prepared = preparation();
    operation({ root, state, cache, prepared, records: path.join(layout.repositoryStateRoot, 'trusted-runtime',
      'local-preparation-v2', prepared.request.requestOperationId.slice(7)) });
  } catch (error) {
    primary = { label: 'V2 fixture callback', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [
      { label: 'previous state home', settle: () => {
        if (oldState === undefined) delete process.env.SEC_STATE_HOME; else process.env.SEC_STATE_HOME = oldState;
      } },
      { label: 'previous cache home', settle: () => {
        if (oldCache === undefined) delete process.env.SEC_CACHE_HOME; else process.env.SEC_CACHE_HOME = oldCache;
      } },
      { label: 'V2 fixture root', settle: () => rmSync(parent, { recursive: true, force: true }) }
    ] });
  }
}

test('copied preparation input alone never revives live qualification or creates a Session', () => {
  stateFixture(({ root, records, prepared }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'local-preparation-request.json'), `${encodeVerificationActionData(prepared)}\n`);
    const status = readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: prepared });
    expect(status).toMatchObject({ preparationInputMatched: true, sessionRevision: null,
      evidenceRecord: 'not-observed', sourceQualification: 'not-revalidated', integrationAuthorization: 'not-evaluated' });
    const { requestDigest: _digest, requestOperationId: _operation, ...body } = prepared.request;
    const other = createVerificationSessionLocalPreparationRequestV2({ ...body, actorNodeId: 'OTHER' });
    writeFileSync(path.join(records, 'local-preparation-request.json'), `${encodeVerificationActionData(other)}\n`);
    expect(() => readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: prepared })).toThrow('differs from current exact source');
  });
});

test('V2 repository mismatch is rejected before execution provider discovery', async () => {
  await expect(verifyWithTrustedRuntime({ repositoryRoot: '/does-not-exist',
    repository: 'other/repo', request: preparation() })).rejects.toThrow('another repository');
});

test('V2 attempt-only residue cannot be adopted by recreating a missing preparation input', () => {
  stateFixture(({ root, records, prepared }) => {
    mkdirSync(records, { recursive: true });
    writeFileSync(path.join(records, 'source-program-attempt-historical.json'), '{}');
    expect(() => readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot: root,
      repository: 'sec-platform/sec', request: prepared })).toThrow('no exact stored preparation');
  });
});

test('public local decoder uses bounded exact JSON before version-specific decoding', () => {
  expect(() => parseVerificationSessionLocalPreparationRequest('雪'.repeat(400_000)))
    .toThrow('bounded UTF-8 input size');
  const v2 = JSON.stringify(preparation());
  expect(() => parseVerificationSessionLocalPreparationRequest(v2.replace('{', '{"schema":"duplicate",')))
    .toThrow('duplicate');
});
