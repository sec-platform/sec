import { expect, test } from 'bun:test';

import {
  CodexDevelopmentMergeGateProducerIdentityV2,
  createTrustedRuntimeArtifactObservationV1,
  createTrustedRuntimeMergeGateProvenanceV1
} from '../../scripts/codex/merge-gate.ts';
import {
  compileTrustedRuntimePostMergeMainDeltaV1,
  createTrustedRuntimePostMergeMainIdentityTransitionV1,
  TRUSTED_RUNTIME_CRITICAL_PATH_RETIREMENT_BLOCKER_V1
} from '../../scripts/codex/trusted-runtime-closeout.ts';

const BASE = '1'.repeat(40);
const D = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;

test('generic caller retirement remains blocked outside the trusted closeout consumer', () => {
  expect(TRUSTED_RUNTIME_CRITICAL_PATH_RETIREMENT_BLOCKER_V1).toBe('NO_PRODUCTION_CONSUMER');
});

test('trusted runtime provenance binds the exact trusted merge-gate revision', () => {
  const provenance = createTrustedRuntimeMergeGateProvenanceV1({
    runtimePath: CodexDevelopmentMergeGateProducerIdentityV2,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentityV2}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  });
  expect(provenance.runtimeSha).toBe(BASE);
  expect(provenance.runtimeRef).toBe(`${CodexDevelopmentMergeGateProducerIdentityV2}@${BASE}`);
  expect(provenance.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('trusted runtime provenance rejects candidate or ambiguous runtime identity', () => {
  expect(() => createTrustedRuntimeMergeGateProvenanceV1({
    runtimePath: CodexDevelopmentMergeGateProducerIdentityV2,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentityV2}@${'2'.repeat(40)}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  })).toThrow('runtime ref must bind the exact merge-gate revision');

  expect(() => createTrustedRuntimeMergeGateProvenanceV1({
    runtimePath: 'scripts/codex/other-gate.ts' as typeof CodexDevelopmentMergeGateProducerIdentityV2,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentityV2}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  })).toThrow('canonical merge-gate entrypoint');
});

test('trusted runtime artifact observation is durable-file readback, not an Actions artifact alias', () => {
  const observation = createTrustedRuntimeArtifactObservationV1({
    artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: D('a'),
    artifactByteLength: 123,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentityV2}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    producerSourceDigest: D('b'),
    readbackTransport: 'trusted-runtime-durable-file'
  });
  expect(observation.readbackTransport).toBe('trusted-runtime-durable-file');
  expect(observation.runtimeSha).toBe(BASE);
});

test('trusted runtime artifact observation rejects Actions-style or stale readback identity', () => {
  expect(() => createTrustedRuntimeArtifactObservationV1({
    artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: D('a'),
    artifactByteLength: 123,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentityV2}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    producerSourceDigest: D('b'),
    readbackTransport: 'github-actions-artifact-api' as 'trusted-runtime-durable-file'
  })).toThrow('readback transport is not canonical');
});

test('post-merge MainDelta reuses only the exact verified tree and semantic closure', () => {
  const candidate = {
    treeSha: '2'.repeat(40),
    policyRevision: D('a'),
    toolchainRevision: D('b'),
    providerRevision: D('c'),
    environmentRevision: D('d'),
    closureDigest: D('e'),
    unknowns: Object.freeze([])
  } as const;
  const transition = createTrustedRuntimePostMergeMainIdentityTransitionV1({
    candidate,
    exactMainTreeSha: candidate.treeSha
  });
  const equivalent = compileTrustedRuntimePostMergeMainDeltaV1({ transition });
  expect(equivalent.disposition).toBe('tree-equivalent');
  expect(equivalent.mainHealthRequired).toBe(false);

  const changed = compileTrustedRuntimePostMergeMainDeltaV1({
    transition: createTrustedRuntimePostMergeMainIdentityTransitionV1({
      candidate,
      exactMainTreeSha: '3'.repeat(40)
    })
  });
  expect(changed.disposition).toBe('blocked');
  expect(changed.reasonCode).toBe('unknown-identity');
  expect(changed.mainHealthRequired).toBe(true);
});

test('post-merge MainDelta rejects a forged copied or drifted main transition', () => {
  const candidate = {
    treeSha: '2'.repeat(40),
    policyRevision: D('a'),
    toolchainRevision: D('b'),
    providerRevision: D('c'),
    environmentRevision: D('d'),
    closureDigest: D('e'),
    unknowns: Object.freeze([])
  } as const;
  const transition = createTrustedRuntimePostMergeMainIdentityTransitionV1({
    candidate,
    exactMainTreeSha: candidate.treeSha
  });
  expect(() => compileTrustedRuntimePostMergeMainDeltaV1({
    transition: {
      ...transition,
      main: { ...transition.main, toolchainRevision: D('f') }
    }
  })).toThrow(/transition is not canonical/);
  expect(() => compileTrustedRuntimePostMergeMainDeltaV1({
    transition: { ...transition, transitionDigest: D('f') }
  })).toThrow(/transition is not canonical/);
});
