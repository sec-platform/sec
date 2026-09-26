import { expect, test } from 'bun:test';

import {
  MergeGateProducerIdentity,
  createTrustedRuntimeArtifactObservation,
  createTrustedRuntimeMergeGateProvenance
} from '../../src/adapters/self-hosting/control/integration/merge-gate.ts';

const BASE = '1'.repeat(40);
const D = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;

test('trusted runtime provenance binds the exact trusted merge-gate revision', () => {
  const provenance = createTrustedRuntimeMergeGateProvenance({
    runtimePath: MergeGateProducerIdentity,
    runtimeRef: `${MergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  });
  expect(provenance.runtimeSha).toBe(BASE);
  expect(provenance.runtimeRef).toBe(`${MergeGateProducerIdentity}@${BASE}`);
  expect(provenance.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('trusted runtime provenance rejects candidate or ambiguous runtime identity', () => {
  expect(() => createTrustedRuntimeMergeGateProvenance({
    runtimePath: MergeGateProducerIdentity,
    runtimeRef: `${MergeGateProducerIdentity}@${'2'.repeat(40)}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  })).toThrow('runtime ref must bind the exact merge-gate revision');

  expect(() => createTrustedRuntimeMergeGateProvenance({
    runtimePath: 'scripts/codex/other-gate.ts' as typeof MergeGateProducerIdentity,
    runtimeRef: `${MergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  })).toThrow('canonical merge-gate entrypoint');
});

test('trusted runtime artifact observation is durable-file readback, not an Actions artifact alias', () => {
  const observation = createTrustedRuntimeArtifactObservation({
    artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: D('a'),
    artifactByteLength: 123,
    runtimeRef: `${MergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    producerSourceDigest: D('b'),
    readbackTransport: 'trusted-runtime-durable-file'
  });
  expect(observation.readbackTransport).toBe('trusted-runtime-durable-file');
  expect(observation.runtimeSha).toBe(BASE);
});

test('trusted runtime artifact observation rejects Actions-style or stale readback identity', () => {
  expect(() => createTrustedRuntimeArtifactObservation({
    artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: D('a'),
    artifactByteLength: 123,
    runtimeRef: `${MergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    producerSourceDigest: D('b'),
    readbackTransport: 'github-actions-artifact-api' as 'trusted-runtime-durable-file'
  })).toThrow('readback transport is not canonical');
});
