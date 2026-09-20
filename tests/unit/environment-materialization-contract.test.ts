import { describe, expect, test } from 'bun:test';

import {
  compileEnvironmentMaterializationPlan,
  createEnvironmentMaterializationSpec
} from '../../src/adapters/providers/linux-verification/materialization.ts';

const A = `sha256:${'a'.repeat(64)}` as const;
const B = `sha256:${'b'.repeat(64)}` as const;

function spec() {
  return createEnvironmentMaterializationSpec({
    imageName: 'sec-runtime:exact',
    acceptedImageDigest: A,
    sourcePolicyRevision: 'snapshot-and-checksum-v1',
    providerRequirement: 'buildkit-buildx-v1',
    components: [
      { id: 'runner', version: '2.336.0', sourceDigest: B },
      { id: 'base', version: 'ubuntu-24.04', sourceDigest: A }
    ]
  });
}

describe('environment materialization contract', () => {
  test('canonicalizes components without provider implementation details', () => {
    const value = spec();
    expect(value.components.map(({ id }) => id)).toEqual(['base', 'runner']);
    expect(value).not.toHaveProperty('command');
    expect(value).not.toHaveProperty('buildx');
    expect(value.specDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  test('reuses only the exact accepted local image', () => {
    expect(compileEnvironmentMaterializationPlan({
      spec: spec(),
      observation: {
        localTag: 'matching',
        localImageDigest: A,
        localArtifact: 'absent',
        immutableBuildInputs: 'unresolved',
        providerCapability: 'unresolved'
      }
    })).toMatchObject({ disposition: 'reuse-local', reason: 'exact-local-image' });
  });

  test('materializes only from admitted immutable inputs and provider capability', () => {
    expect(compileEnvironmentMaterializationPlan({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        localArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({
      disposition: 'materialize',
      reason: 'exact-build-inputs-and-provider'
    });
  });

  test('restores an exact local artifact before requesting remote inputs', () => {
    expect(compileEnvironmentMaterializationPlan({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        localArtifact: 'matching',
        immutableBuildInputs: 'unresolved',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'restore-local', reason: 'exact-local-artifact' });
  });

  test('preserves mismatched local tags and blocks missing or unresolved inputs', () => {
    expect(compileEnvironmentMaterializationPlan({
      spec: spec(),
      observation: {
        localTag: 'mismatched',
        localImageDigest: B,
        localArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'blocked', reason: 'local-tag-digest-conflict' });
    for (const immutableBuildInputs of ['missing', 'unresolved'] as const) {
      expect(compileEnvironmentMaterializationPlan({
        spec: spec(),
        observation: {
          localTag: 'absent',
          localImageDigest: null,
          localArtifact: 'absent',
          immutableBuildInputs,
          providerCapability: 'available'
        }
      }).disposition).toBe('blocked');
    }
    expect(compileEnvironmentMaterializationPlan({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        localArtifact: 'mismatched',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'blocked', reason: 'local-artifact-digest-conflict' });
  });
});
