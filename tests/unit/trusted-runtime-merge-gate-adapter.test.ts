import { expect, test } from 'bun:test';

import {
  CodexDevelopmentMergeGateProducerIdentity,
  createTrustedRuntimeArtifactObservation,
  createTrustedRuntimeMergeGateProvenance
} from '../../src/adapters/self-hosting/control/integration/merge-gate.ts';

const BASE = '1'.repeat(40);
const D = (value: string): `sha256:${string}` => `sha256:${value.repeat(64).slice(0, 64)}`;

test('trusted runtime provenance binds the exact revision, execution and actor', () => {
  const input = {
    runtimePath: CodexDevelopmentMergeGateProducerIdentity,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  } as const;
  const provenance = createTrustedRuntimeMergeGateProvenance(input);
  expect(provenance).toEqual({ ...input, sourceDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u) });
  expect(createTrustedRuntimeMergeGateProvenance(input).sourceDigest).toBe(provenance.sourceDigest);
  const otherRevision = '2'.repeat(40);
  for (const changed of [
    { executionId: 'trusted-runtime-2' },
    { actorNodeId: 'APP_sec_other' },
    { runtimeSha: otherRevision, runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${otherRevision}` }
  ]) {
    expect(createTrustedRuntimeMergeGateProvenance({ ...input, ...changed }).sourceDigest)
      .not.toBe(provenance.sourceDigest);
  }
});

test('trusted runtime provenance rejects candidate or ambiguous runtime identity', () => {
  expect(() => createTrustedRuntimeMergeGateProvenance({
    runtimePath: CodexDevelopmentMergeGateProducerIdentity,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${'2'.repeat(40)}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  })).toThrow('runtime ref must bind the exact merge-gate revision');

  expect(() => createTrustedRuntimeMergeGateProvenance({
    runtimePath: 'scripts/codex/other-gate.ts' as typeof CodexDevelopmentMergeGateProducerIdentity,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    actorNodeId: 'APP_sec_integrator',
    actorPermission: 'maintain'
  })).toThrow('canonical merge-gate entrypoint');
});

test('trusted runtime artifact observation retains declared durable-file identity', () => {
  const input = {
    artifactFileName: 'verification-session-artifact.json' as const,
    artifactByteDigest: D('a'),
    artifactByteLength: 123,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    producerSourceDigest: D('b'),
    readbackTransport: 'trusted-runtime-durable-file' as const
  };
  expect(createTrustedRuntimeArtifactObservation(input)).toEqual(input);
});

test('trusted runtime artifact observation rejects Actions-style readback transport', () => {
  expect(() => createTrustedRuntimeArtifactObservation({
    artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: D('a'),
    artifactByteLength: 123,
    runtimeRef: `${CodexDevelopmentMergeGateProducerIdentity}@${BASE}`,
    runtimeSha: BASE,
    executionId: 'trusted-runtime-1',
    producerSourceDigest: D('b'),
    readbackTransport: 'github-actions-artifact-api' as 'trusted-runtime-durable-file'
  })).toThrow('readback transport is not canonical');
});
