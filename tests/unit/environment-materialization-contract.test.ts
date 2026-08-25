import { describe, expect, test } from 'bun:test';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  acquireEnvironmentDependencyCacheConsumerV2,
  beginEnvironmentDependencyCacheMaterializationV2,
  compileEnvironmentMaterializationPlanV1,
  createEnvironmentDependencyCacheBirthV2,
  createEnvironmentDependencyCacheHandleV1,
  createEnvironmentDependencyCacheIdentityV1,
  createEnvironmentDependencyCachePhysicalReceiptV2,
  createEnvironmentDependencyClosureV1,
  createEnvironmentMaterializationGenerationV1,
  createEnvironmentMaterializationSpecV1,
  ENVIRONMENT_MATERIALIZATION_GENERATION_PHASE_ADJACENCY_V1,
  ENVIRONMENT_MATERIALIZATION_GENERATION_RETENTION_BY_PHASE_V1,
  parseEnvironmentDependencyCacheHandleV1,
  parseEnvironmentDependencyCacheIdentityV1,
  parseEnvironmentDependencyCachePhysicalReceiptV2,
  parseEnvironmentDependencyCacheStateV2,
  parseEnvironmentDependencyClosureV1,
  parseEnvironmentMaterializationGenerationV1,
  parseEnvironmentMaterializationObservationV1,
  parseEnvironmentMaterializationPlanV1,
  parseEnvironmentMaterializationSpecV1,
  recoverEnvironmentDependencyCacheConsumerV2,
  reduceEnvironmentDependencyCachePublishedStateV2,
  transitionEnvironmentMaterializationGenerationV1
} from '../../platform/shared/environment-materialization-contract.ts';

const A = `sha256:${'a'.repeat(64)}` as const;
const B = `sha256:${'b'.repeat(64)}` as const;
const C = `sha256:${'c'.repeat(64)}` as const;
const GENERATION_CREATED_AT = '2026-08-25T01:02:03.000Z';
const GENERATION_TERMINAL_AT = '2026-08-25T01:03:03.000Z';

function spec() {
  return createEnvironmentMaterializationSpecV1({
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

function dependencyClosure() {
  return createEnvironmentDependencyClosureV1({
    environmentSpecDigest: A,
    lockDigest: B,
    toolchainDigest: C,
    providerRevision: 'sec-hosted-provider-v2',
    authority: [
      { path: '.bun-version', bytesDigest: C },
      { path: 'bun.lock', bytesDigest: B },
      { path: 'package.json', bytesDigest: A }
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

  test('reuses only the exact accepted local image plus exact OCI artifact closure', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'matching',
        localImageDigest: A,
        offlineArtifact: 'matching',
        immutableBuildInputs: 'unresolved',
        providerCapability: 'unresolved'
      }
    })).toMatchObject({ disposition: 'reuse-local', reason: 'exact-local-image' });
  });

  test('materializes a missing OCI artifact even when the Docker projection is exact', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'matching',
        localImageDigest: A,
        offlineArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({
      disposition: 'materialize',
      reason: 'exact-local-image-missing-artifact',
      phase: 'remote-missing'
    });
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'matching',
        localImageDigest: A,
        offlineArtifact: 'mismatched',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'blocked', reason: 'offline-artifact-digest-conflict' });
  });

  test('blocks exact-image artifact repair when its immutable inputs or provider are unavailable', () => {
    for (const observation of [
      { immutableBuildInputs: 'missing' as const, providerCapability: 'available' as const },
      { immutableBuildInputs: 'unresolved' as const, providerCapability: 'available' as const },
      { immutableBuildInputs: 'available' as const, providerCapability: 'unavailable' as const },
      { immutableBuildInputs: 'available' as const, providerCapability: 'unresolved' as const }
    ]) {
      expect(compileEnvironmentMaterializationPlanV1({
        spec: spec(),
        observation: {
          localTag: 'matching',
          localImageDigest: A,
          offlineArtifact: 'absent',
          ...observation
        }
      }).disposition).toBe('blocked');
    }
  });

  test('materializes only from admitted immutable inputs and provider capability', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        offlineArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({
      disposition: 'materialize',
      reason: 'exact-build-inputs-and-provider'
    });
  });

  test('restores an exact offline artifact before requesting remote inputs', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        offlineArtifact: 'matching',
        immutableBuildInputs: 'unresolved',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'restore-local', reason: 'exact-offline-artifact' });
  });

  test('restores an exact offline artifact without requiring remote acquisition', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        offlineArtifact: 'matching',
        immutableBuildInputs: 'unresolved',
        providerCapability: 'unavailable',
        remoteAcquisition: 'unavailable'
      }
    })).toMatchObject({
      disposition: 'restore-local',
      reason: 'exact-offline-artifact',
      phase: 'offline-exact'
    });
  });

  test('represents a local projection and offline artifact independently', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'matching',
        localImageDigest: A,
        offlineArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({
      disposition: 'materialize',
      reason: 'exact-local-image-missing-artifact',
      phase: 'remote-missing'
    });
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        offlineArtifact: 'matching',
        immutableBuildInputs: 'unresolved',
        providerCapability: 'unavailable'
      }
    })).toMatchObject({
      disposition: 'restore-local',
      reason: 'exact-offline-artifact',
      phase: 'offline-exact'
    });
  });

  test('parses observation enums and cross-field bindings before planning', () => {
    const valid = {
      localTag: 'absent' as const,
      localImageDigest: null,
      offlineArtifact: 'absent' as const,
      immutableBuildInputs: 'available' as const,
      providerCapability: 'available' as const
    };
    expect(parseEnvironmentMaterializationObservationV1(JSON.stringify(valid))).toEqual(valid);
    for (const forged of [
      { ...valid, localTag: 'forged' },
      { ...valid, offlineArtifact: 'forged' },
      { ...valid, immutableBuildInputs: 'forged' },
      { ...valid, providerCapability: 'forged' },
      { ...valid, remoteAcquisition: 'forged' }
    ]) {
      expect(() => compileEnvironmentMaterializationPlanV1({
        spec: spec(), observation: forged as never
      })).toThrow('invalid enum');
    }
    expect(() => parseEnvironmentMaterializationObservationV1({
      ...valid, localTag: 'matching', localImageDigest: null
    })).toThrow('presence disagree');
    expect(() => parseEnvironmentMaterializationObservationV1({
      ...valid, unexpected: true
    })).toThrow('keys are invalid');
    expect(() => parseEnvironmentMaterializationObservationV1({
      ...valid, remoteAcquisition: undefined
    })).toThrow('keys are invalid');
  });

  test('preserves mismatched local tags and blocks missing or unresolved inputs', () => {
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'mismatched',
        localImageDigest: B,
        offlineArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'blocked', reason: 'local-tag-digest-conflict' });
    for (const immutableBuildInputs of ['missing', 'unresolved'] as const) {
      expect(compileEnvironmentMaterializationPlanV1({
        spec: spec(),
        observation: {
          localTag: 'absent',
          localImageDigest: null,
          offlineArtifact: 'absent',
          immutableBuildInputs,
          providerCapability: 'available'
        }
      }).disposition).toBe('blocked');
    }
    expect(compileEnvironmentMaterializationPlanV1({
      spec: spec(),
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        offlineArtifact: 'mismatched',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    })).toMatchObject({ disposition: 'blocked', reason: 'offline-artifact-digest-conflict' });
  });

  test('parses the canonical spec and plan once, rejecting digest and semantic tamper', () => {
    const value = spec();
    const plan = compileEnvironmentMaterializationPlanV1({
      spec: value,
      observation: {
        localTag: 'absent',
        localImageDigest: null,
        offlineArtifact: 'absent',
        immutableBuildInputs: 'available',
        providerCapability: 'available'
      }
    });
    expect(parseEnvironmentMaterializationSpecV1(JSON.stringify(value))).toEqual(value);
    expect(parseEnvironmentMaterializationPlanV1(JSON.stringify(plan))).toEqual(plan);

    const tamperedSpec = structuredClone(value) as unknown as Record<string, unknown>;
    tamperedSpec.imageName = 'sec-runtime:tampered';
    expect(() => parseEnvironmentMaterializationSpecV1(tamperedSpec))
      .toThrow('spec digest mismatch');

    const tamperedPlan = structuredClone(plan) as unknown as Record<string, unknown>;
    tamperedPlan.phase = 'local-exact';
    const { planDigest: _planDigest, ...tamperedBody } = tamperedPlan;
    tamperedPlan.planDigest = sha256(tamperedBody);
    expect(() => parseEnvironmentMaterializationPlanV1(tamperedPlan))
      .toThrow('semantic binding');
  });

  test('binds a durable provider generation before publish and closes it terminally', () => {
    const created = createEnvironmentMaterializationGenerationV1({
      specDigest: spec().specDigest,
      generation: 4,
      providerRef: 'refs/tags/sec-provider-lease-sec-linux-verification-v1',
      providerObjectSha: 'd'.repeat(40),
      providerDigest: B,
      providerGeneration: 9,
      leaseId: C,
      phase: 'provisioning',
      retention: 'provider-current',
      terminalObligation: 'provider-absent-and-consumer-zero',
      receiptDigest: null,
      createdAt: GENERATION_CREATED_AT,
      terminalAt: null
    });
    expect(parseEnvironmentMaterializationGenerationV1(JSON.stringify(created))).toEqual(created);
    const published = transitionEnvironmentMaterializationGenerationV1({
      current: created,
      phase: 'published',
      retention: 'provider-current',
      receiptDigest: A,
      terminalAt: null
    });
    expect(published.generationDigest).toBe(created.generationDigest);
    expect(published.lifecycleDigest).not.toBe(created.lifecycleDigest);
    const terminal = transitionEnvironmentMaterializationGenerationV1({
      current: published,
      phase: 'terminal',
      retention: 'provider-terminal',
      receiptDigest: A,
      terminalAt: GENERATION_TERMINAL_AT
    });
    expect(terminal.generationDigest).toBe(created.generationDigest);
    expect(terminal.terminalObligation).toBe('provider-absent-and-consumer-zero');
    expect(() => transitionEnvironmentMaterializationGenerationV1({
      current: created,
      phase: 'published',
      retention: 'provider-current',
      receiptDigest: null,
      terminalAt: null
    })).toThrow('published phase requires a receipt');
    const tampered = JSON.parse(JSON.stringify(published)) as Record<string, unknown>;
    tampered.providerObjectSha = 'e'.repeat(40);
    tampered.lifecycleDigest = published.lifecycleDigest;
    expect(() => parseEnvironmentMaterializationGenerationV1(tampered))
      .toThrow('digest mismatch');
  });

  test('uses one canonical phase-to-retention relation and rejects every other pair', () => {
    const phases = [
      'provisioning', 'published', 'terminal', 'gc-pending'
    ] as const;
    for (const phase of phases) {
      for (const retention of ['provider-current', 'provider-terminal', 'gc-pending'] as const) {
        const input = {
          specDigest: spec().specDigest,
          generation: 4,
          providerRef: 'refs/tags/sec-provider-lease-sec-linux-verification-v1',
          providerObjectSha: 'd'.repeat(40),
          providerDigest: B,
          providerGeneration: 9,
          leaseId: C,
          phase,
          retention,
          terminalObligation: 'provider-absent-and-consumer-zero' as const,
          receiptDigest: phase === 'provisioning' ? null : A,
          createdAt: GENERATION_CREATED_AT,
          terminalAt: phase === 'provisioning' || phase === 'published'
            ? null
            : GENERATION_TERMINAL_AT
        };
        const expected = ENVIRONMENT_MATERIALIZATION_GENERATION_RETENTION_BY_PHASE_V1[phase];
        if (retention === expected) {
          expect(createEnvironmentMaterializationGenerationV1(input).retention)
            .toBe(expected);
        } else {
          expect(() => createEnvironmentMaterializationGenerationV1(input))
            .toThrow(`phase ${phase} requires ${expected} retention`);
        }
      }
    }
  });

  test('proves the complete generation phase adjacency matrix', () => {
    const provisioning = createEnvironmentMaterializationGenerationV1({
      specDigest: spec().specDigest,
      generation: 4,
      providerRef: 'refs/tags/sec-provider-lease-sec-linux-verification-v1',
      providerObjectSha: 'd'.repeat(40),
      providerDigest: B,
      providerGeneration: 9,
      leaseId: C,
      phase: 'provisioning',
      retention: 'provider-current',
      terminalObligation: 'provider-absent-and-consumer-zero',
      receiptDigest: null,
      createdAt: GENERATION_CREATED_AT,
      terminalAt: null
    });
    const published = transitionEnvironmentMaterializationGenerationV1({
      current: provisioning,
      phase: 'published',
      retention: 'provider-current',
      receiptDigest: A,
      terminalAt: null
    });
    const terminal = transitionEnvironmentMaterializationGenerationV1({
      current: provisioning,
      phase: 'terminal',
      retention: 'provider-terminal',
      receiptDigest: null,
      terminalAt: GENERATION_TERMINAL_AT
    });
    const gcPending = transitionEnvironmentMaterializationGenerationV1({
      current: terminal,
      phase: 'gc-pending',
      retention: 'gc-pending',
      receiptDigest: null,
      terminalAt: GENERATION_TERMINAL_AT
    });
    const byPhase = { provisioning, published, terminal, 'gc-pending': gcPending } as const;
    const phases = [
      'provisioning', 'published', 'terminal', 'gc-pending'
    ] as const;
    for (const from of phases) {
      for (const to of phases) {
        const allowed = ENVIRONMENT_MATERIALIZATION_GENERATION_PHASE_ADJACENCY_V1[from]
          .includes(to);
        const current = byPhase[from];
        const receiptDigest = to === 'provisioning'
          ? null
          : to === 'published'
            ? current.receiptDigest ?? A
            : current.receiptDigest;
        const terminalAt = to === 'provisioning' || to === 'published'
          ? null
          : current.terminalAt ?? GENERATION_TERMINAL_AT;
        const transition = () => transitionEnvironmentMaterializationGenerationV1({
          current,
          phase: to,
          retention: ENVIRONMENT_MATERIALIZATION_GENERATION_RETENTION_BY_PHASE_V1[to],
          receiptDigest,
          terminalAt
        });
        if (allowed) {
          const next = transition();
          expect(next.generationDigest).toBe(provisioning.generationDigest);
        } else {
          expect(transition).toThrow(`phase transition ${from}->${to} is invalid`);
        }
      }
    }
  });

  test('binds dependency cache identity only to the exact closure, never to a path or caller epoch', () => {
    const closure = dependencyClosure();
    const identity = createEnvironmentDependencyCacheIdentityV1({ closure });
    expect(parseEnvironmentDependencyClosureV1(JSON.stringify(closure))).toEqual(closure);
    expect(parseEnvironmentDependencyCacheIdentityV1(JSON.stringify(identity))).toEqual(identity);
    expect(createEnvironmentDependencyCacheIdentityV1({ closure }).identityDigest).toBe(identity.identityDigest);
    const changed = createEnvironmentDependencyClosureV1({
      environmentSpecDigest: A,
      lockDigest: B,
      toolchainDigest: A,
      providerRevision: 'sec-hosted-provider-v2',
      authority: [
        { path: '.bun-version', bytesDigest: A },
        { path: 'bun.lock', bytesDigest: B },
        { path: 'package.json', bytesDigest: A }
      ]
    });
    expect(createEnvironmentDependencyCacheIdentityV1({ closure: changed })
      .identityDigest).not.toBe(identity.identityDigest);
  });

  test('publishes a read-only cache handle and rejects tampered handle bytes', () => {
    const identity = createEnvironmentDependencyCacheIdentityV1({ closure: dependencyClosure() });
    const birth = createEnvironmentDependencyCacheBirthV2({
      identity,
      providerRevision: 'sec-hosted-provider-v2',
      createdAt: GENERATION_CREATED_AT,
      leaseExpiresAt: GENERATION_TERMINAL_AT,
      maxEntries: 32,
      maxTotalBytes: 1024,
      owner: {
        host: 'linux-host',
        bootId: '11111111-1111-1111-1111-111111111111',
        pid: 100,
        processStartTicks: '1000'
      }
    });
    const materializing = beginEnvironmentDependencyCacheMaterializationV2({
      current: birth,
      updatedAt: '2026-08-25T01:02:13.000Z',
      leaseExpiresAt: '2026-08-25T01:03:13.000Z',
      owner: {
        host: 'linux-host',
        bootId: '11111111-1111-1111-1111-111111111111',
        pid: 100,
        processStartTicks: '1000'
      }
    });
    const published = reduceEnvironmentDependencyCachePublishedStateV2({
      current: materializing,
      updatedAt: '2026-08-25T01:02:23.000Z',
      archiveDigest: A,
      archiveBytes: 42,
      sourceSnapshotDigest: B,
      archiveProjectionDigest: A
    });
    expect(parseEnvironmentDependencyCacheStateV2(JSON.stringify(published))).toEqual(published);
    const physicalReceipt = createEnvironmentDependencyCachePhysicalReceiptV2({ current: published });
    expect(parseEnvironmentDependencyCachePhysicalReceiptV2(JSON.stringify(physicalReceipt)))
      .toEqual(physicalReceipt);
    const handle = createEnvironmentDependencyCacheHandleV1({ current: published });
    expect(handle.readOnly).toBe(true);
    expect(parseEnvironmentDependencyCacheHandleV1(JSON.stringify(handle))).toEqual(handle);
    const tampered = structuredClone(handle) as unknown as Record<string, unknown>;
    tampered.archiveBytes = 43;
    expect(() => parseEnvironmentDependencyCacheHandleV1(tampered)).toThrow(/digest mismatch/u);
  });

  test('consumer recovery requires expiry plus an owner-death proof transition', () => {
    const identity = createEnvironmentDependencyCacheIdentityV1({ closure: dependencyClosure() });
    const birth = createEnvironmentDependencyCacheBirthV2({
      identity,
      providerRevision: 'sec-hosted-provider-v2',
      createdAt: GENERATION_CREATED_AT,
      leaseExpiresAt: GENERATION_TERMINAL_AT,
      maxEntries: 32,
      maxTotalBytes: 1024,
      owner: {
        host: 'linux-host',
        bootId: '11111111-1111-1111-1111-111111111111',
        pid: 100,
        processStartTicks: '1000'
      }
    });
    const materializing = beginEnvironmentDependencyCacheMaterializationV2({
      current: birth,
      updatedAt: '2026-08-25T01:02:13.000Z',
      leaseExpiresAt: '2026-08-25T01:03:13.000Z',
      owner: {
        host: 'linux-host',
        bootId: '11111111-1111-1111-1111-111111111111',
        pid: 100,
        processStartTicks: '1000'
      }
    });
    const published = reduceEnvironmentDependencyCachePublishedStateV2({
      current: materializing,
      updatedAt: '2026-08-25T01:02:23.000Z',
      archiveDigest: A,
      archiveBytes: 42,
      sourceSnapshotDigest: B,
      archiveProjectionDigest: A
    });
    const acquired = acquireEnvironmentDependencyCacheConsumerV2({
      current: published,
      consumerId: 'verification:crashed',
      updatedAt: '2026-08-25T01:02:24.000Z',
      leaseExpiresAt: '2026-08-25T01:02:25.000Z',
      owner: {
        host: 'linux-host',
        bootId: '11111111-1111-1111-1111-111111111111',
        pid: 101,
        processStartTicks: '2000'
      }
    });
    expect(() => recoverEnvironmentDependencyCacheConsumerV2({
      current: acquired.current,
      consumerId: 'verification:crashed',
      acquireCredentialDigest: acquired.handle.acquireCredentialDigest!,
      reason: 'process-absent',
      observedAt: '2026-08-25T01:02:24.999Z',
      deathProofDigest: C
    })).toThrow(/expired active lease/u);
    const recovered = recoverEnvironmentDependencyCacheConsumerV2({
      current: acquired.current,
      consumerId: 'verification:crashed',
      acquireCredentialDigest: acquired.handle.acquireCredentialDigest!,
      reason: 'process-absent',
      observedAt: '2026-08-25T01:02:25.000Z',
      deathProofDigest: C
    });
    expect(recovered.activeConsumers).toEqual([]);
    expect(recovered.lastConsumerRecovery).toMatchObject({
      consumerId: 'verification:crashed',
      reason: 'process-absent',
      deathProofDigest: C
    });
  });
});
