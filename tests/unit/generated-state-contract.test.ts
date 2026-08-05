import { describe, expect, test } from 'bun:test';

import {
  GENERATED_STATE_OWNER_SCHEMA,
  GENERATED_STATE_RULES,
  KNOWN_GENERATED_STATE_PRODUCERS,
  KNOWN_GENERATED_STATE_PRODUCER_PATHS,
  assertGeneratedStateRegistry,
  classifyGeneratedStatePath,
  generatedStateCleanupAllowed,
  generatedStateDigest,
  isGeneratedStateOwner,
  type GeneratedStateClass
} from '../../platform/shared/generated-state-contract.ts';

describe('generated-state contract', () => {
  test('registry is closed, ordered, and classifies every known producer', () => {
    expect(() => assertGeneratedStateRegistry()).not.toThrow();
    expect(new Set(GENERATED_STATE_RULES.map((rule) => rule.id)).size)
      .toBe(GENERATED_STATE_RULES.length);
    for (const producer of KNOWN_GENERATED_STATE_PRODUCERS) {
      expect(classifyGeneratedStatePath(producer.relativePath).ruleId).toBe(producer.ruleId);
    }
    expect(KNOWN_GENERATED_STATE_PRODUCER_PATHS).toEqual(
      KNOWN_GENERATED_STATE_PRODUCERS.map((producer) => producer.relativePath)
    );

    const expected = new Map<string, GeneratedStateClass>([
      ['compiler-deps.stamp.json', 'rebuildable-cache'],
      ['test-impact-cache.json.123.tmp', 'ephemeral-workspace'],
      ['test-impact-cache.json', 'rebuildable-cache'],
      ['typecheck/tsconfig.tsbuildinfo', 'rebuildable-cache'],
      ['dependency-installs/compiler-backups/example', 'derived-toolchain'],
      ['test-workspaces/.templates/locked-default', 'rebuildable-cache'],
      ['test-workspaces/.templates/locked-default.staging-1', 'ephemeral-workspace'],
      ['test-workspaces/.templates/locked-default.lock/owner.json', 'identity-bound-control'],
      ['test-workspaces/playwright-transform-cache/aa/cache.js', 'rebuildable-cache'],
      ['test-workspaces/fast-1/example', 'ephemeral-workspace'],
      ['import-candidate-snapshots/a/project.ts', 'ephemeral-workspace'],
      ['ci-workspace-fast-a/project/package.json', 'ephemeral-workspace'],
      ['gate-execution-snapshots/a/HEAD', 'identity-bound-control'],
      ['heavy-verification-gate-v1/owner.json', 'identity-bound-control'],
      ['fence-policy-after.json', 'diagnostic'],
      ['tree.txt', 'diagnostic'],
      ['recovery/branch.bundle', 'recovery-asset'],
      ['.generated-state-transactions/tx/transaction.json', 'identity-bound-control'],
      ['ci-verification-evidence.json.4242.0f5c2f10-5f3b-4a1e-8c0d-9f0a1b2c3d4e.tmp', 'ephemeral-workspace'],
      ['ci-risk-batch-evidence.json.4242.0f5c2f10-5f3b-4a1e-8c0d-9f0a1b2c3d4e.tmp', 'ephemeral-workspace']
    ]);
    for (const [relativePath, stateClass] of expected) {
      expect(classifyGeneratedStatePath(relativePath).stateClass).toBe(stateClass);
    }
    expect(classifyGeneratedStatePath(
      'ci-verification-evidence.json.4242.0f5c2f10-5f3b-4a1e-8c0d-9f0a1b2c3d4e.tmp'
    )).toMatchObject({
      ruleId: 'ci-verification-evidence-staging',
      cleanup: ['safe', 'all-rebuildable'],
      settlement: 'allowed'
    });
    expect(classifyGeneratedStatePath(
      'ci-risk-batch-evidence.json.4242.0f5c2f10-5f3b-4a1e-8c0d-9f0a1b2c3d4e.tmp'
    )).toMatchObject({
      ruleId: 'ci-risk-batch-evidence-staging',
      cleanup: ['safe', 'all-rebuildable'],
      settlement: 'allowed'
    });
  });

  test('unknown paths and invalid traversal fail closed', () => {
    for (const relativePath of [
      'mystery.bin',
      '../outside',
      '/absolute',
      'test-workspaces/../../outside',
      'unknown/cache'
    ]) {
      expect(classifyGeneratedStatePath(relativePath)).toMatchObject({
        stateClass: 'unknown',
        reconstruction: 'none',
        settlement: 'block',
        cleanup: []
      });
    }
  });

  test('cleanup profiles are registry-owned and never authorize protected state', () => {
    for (const profile of ['automatic', 'safe', 'all-rebuildable'] as const) {
      for (const entry of [
        {
          stateClass: 'ephemeral-workspace' as const,
          status: 'active' as const,
          cleanupProfiles: ['automatic', 'safe', 'all-rebuildable'] as const
        },
        {
          stateClass: 'recovery-asset' as const,
          status: 'invalid-location' as const,
          cleanupProfiles: [] as const
        },
        {
          stateClass: 'identity-bound-control' as const,
          status: 'cleanup-residue' as const,
          cleanupProfiles: [] as const
        },
        {
          stateClass: 'unknown' as const,
          status: 'unknown' as const,
          cleanupProfiles: [] as const
        }
      ]) {
        expect(generatedStateCleanupAllowed(entry, profile)).toBe(false);
      }
    }
    expect(generatedStateCleanupAllowed({
      stateClass: 'ephemeral-workspace',
      status: 'orphaned',
      cleanupProfiles: ['automatic', 'safe', 'all-rebuildable']
    }, 'automatic')).toBe(true);
    expect(generatedStateCleanupAllowed({
      stateClass: 'ephemeral-workspace',
      status: 'legacy-expired',
      cleanupProfiles: ['safe', 'all-rebuildable']
    }, 'automatic')).toBe(false);
    expect(generatedStateCleanupAllowed({
      stateClass: 'ephemeral-workspace',
      status: 'legacy-expired',
      cleanupProfiles: ['safe', 'all-rebuildable']
    }, 'safe')).toBe(true);
    expect(generatedStateCleanupAllowed({
      stateClass: 'rebuildable-cache',
      status: 'rebuildable',
      cleanupProfiles: ['all-rebuildable']
    }, 'all-rebuildable')).toBe(true);
    expect(generatedStateCleanupAllowed({
      stateClass: 'rebuildable-cache',
      status: 'rebuildable',
      cleanupProfiles: []
    }, 'all-rebuildable')).toBe(false);
  });

  test('owner validation and canonical digest are deterministic', () => {
    const owner = {
      schema: GENERATED_STATE_OWNER_SCHEMA,
      repositoryRoot: '/repo',
      namespace: 'fast-1',
      host: 'host',
      pid: 123,
      token: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-08-04T00:00:00.000Z'
    } as const;
    expect(isGeneratedStateOwner(owner)).toBe(true);
    expect(isGeneratedStateOwner({ ...owner, namespace: '..' })).toBe(false);
    expect(generatedStateDigest({ b: 2, a: 1 })).toBe(generatedStateDigest({ a: 1, b: 2 }));
  });
});
