import { describe, expect, test } from 'bun:test';

import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import { parseDockerEndpointIdentityV3 } from '../../scripts/codex/local-github-actions-runner.ts';
import {
  TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1,
  TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1,
  TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1,
  TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
  TRUSTED_RUNTIME_CONTAINER_PROFILES_V1,
  TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1,
  TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
  assertTrustedRuntimeContainerImageV1,
  assertTrustedRuntimeContainerProfileV1,
  assertTrustedRuntimeDependencyCacheMountV1,
  assertTrustedRuntimeDependencyCacheVolumeV1,
  authorizeTrustedRuntimeContainerRecoveryV1,
  createTrustedRuntimeBootstrapRepairReceiptV1,
  createTrustedRuntimeDependencyCacheMarkerV1,
  createTrustedRuntimeDependencyCacheMountV1,
  createTrustedRuntimeDependencyCacheVolumeSpecV1,
  createTrustedRuntimeHostCommandEnvironmentV1,
  createTrustedRuntimeMainHealthReceiptV1,
  parseTrustedRuntimeBootstrapRepairReceiptV1,
  parseTrustedRuntimeContainerIdentityV1,
  parseTrustedRuntimeDependencyCacheMarkerV1,
  parseTrustedRuntimeMainHealthReceiptV1
} from '../../scripts/codex/trusted-runtime-container.ts';

const dockerEndpoint = Object.freeze({
  schema: 'sec-docker-endpoint-identity-v1' as const,
  contextName: 'desktop-linux',
  endpointHost: process.platform === 'win32'
    ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
    : 'unix:///var/run/docker.sock',
  daemonId: 'daemon-example',
  osType: 'linux' as const,
  architecture: 'x86_64' as const
});

function imageInspect(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    Id: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
    Config: {
      Labels: {
        'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
        'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1,
        'sec.trusted-runtime.bun-image-manifest': TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1,
        'sec.trusted-runtime.bun-version': '1.3.14',
        ...overrides
      }
    }
  }]);
}

describe('provider-neutral trusted runtime container', () => {
  test('binds immutable Docker and Bun identities without a GitHub Actions run', () => {
    const image = assertTrustedRuntimeContainerImageV1(imageInspect());
    expect(image.imageId).toBe(TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1);
    expect(TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1).toMatchObject({
      kind: 'local',
      os: 'linux',
      arch: 'x64',
      toolchainRevision: 'bun@1.3.14'
    });
    expect(TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1.executionEnvironmentRevision)
      .toContain('local-dev-runner:linux:x64:bun-1.3.14');
  });

  test('rejects mutable or mislabeled execution images', () => {
    expect(() => assertTrustedRuntimeContainerImageV1(imageInspect({
      'sec.trusted-runtime.bun-version': 'latest'
    }))).toThrow('bun-version drifted');
    expect(() => assertTrustedRuntimeContainerImageV1(JSON.stringify([{
      Id: 'sha256:'.padEnd(71, '0'),
      Config: { Labels: {} }
    }]))).toThrow('image ID drifted');
  });

  test('binds a local Docker endpoint and isolates host-side Git transport', () => {
    expect(parseDockerEndpointIdentityV3(dockerEndpoint)).toEqual(dockerEndpoint);
    expect(() => parseDockerEndpointIdentityV3({
      ...dockerEndpoint,
      endpointHost: 'tcp://remote.example:2376'
    })).toThrow(/local npipe or unix transport/);

    const environment = createTrustedRuntimeHostCommandEnvironmentV1('git', {
      PATH: 'C:\\tools',
      GIT_CONFIG_GLOBAL: 'hostile-global-config',
      GIT_CONFIG_NOSYSTEM: '0',
      GIT_TEMPLATE_DIR: 'hostile-template',
      GIT_TERMINAL_PROMPT: '1'
    });
    expect(environment.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(environment.GIT_CONFIG_GLOBAL).toBe(process.platform === 'win32' ? 'NUL' : '/dev/null');
    expect(environment.GIT_TERMINAL_PROMPT).toBe('0');
    expect(environment.GIT_TEMPLATE_DIR).toBeUndefined();
  });

  test('reclaims only one twice-observed exact dead-owner container identity', () => {
    const operationKey = 'session-1234567890abcdef';
    const ownerNonce = '12345678-1234-4234-9234-1234567890ab';
    const expected = Object.freeze({
      operationKey,
      repository: 'sec-platform/sec',
      baseSha: '1'.repeat(40),
      headSha: '2'.repeat(40),
      endpointDigest: `sha256:${'3'.repeat(64)}` as `sha256:${string}`,
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      ownerHost: 'trusted-host',
      profileId: TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary.id
    });
    const identity = Object.freeze({
      id: '4'.repeat(64),
      imageId: expected.imageId,
      name: `sec-trusted-runtime-${operationKey}-${ownerNonce}`,
      labels: Object.freeze({
        'sec.trusted-runtime.operation': operationKey,
        'sec.trusted-runtime.repository': expected.repository,
        'sec.trusted-runtime.base-sha': expected.baseSha,
        'sec.trusted-runtime.head-sha': expected.headSha,
        'sec.trusted-runtime.endpoint-digest': expected.endpointDigest,
        'sec.trusted-runtime.owner-host': expected.ownerHost,
        'sec.trusted-runtime.owner-pid': '4242',
        'sec.trusted-runtime.owner-nonce': ownerNonce,
        'sec.trusted-runtime.profile': expected.profileId,
        'sec.trusted-runtime.image-id': expected.imageId
      })
    });
    let observations = 0;
    expect(authorizeTrustedRuntimeContainerRecoveryV1({
      first: identity,
      confirmed: identity,
      expected,
      observeProcessLiveness: () => {
        observations += 1;
        return 'dead';
      }
    })).toBe(identity.id);
    expect(observations).toBe(2);
    expect(() => authorizeTrustedRuntimeContainerRecoveryV1({
      first: identity,
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'alive'
    })).toThrow(/recovery is not authorized/);
    expect(() => authorizeTrustedRuntimeContainerRecoveryV1({
      first: identity,
      confirmed: { ...identity, id: '5'.repeat(64) },
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/identity or owner liveness changed/);
    expect(() => authorizeTrustedRuntimeContainerRecoveryV1({
      first: { ...identity, labels: { ...identity.labels,
        'sec.trusted-runtime.owner-host': 'foreign-host' } },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
  });

  test('container identity separates inherited image attestation labels from operation labels', () => {
    const operationLabels = {
      'sec.trusted-runtime.operation': 'session-1234567890abcdef',
      'sec.trusted-runtime.repository': 'sec-platform/sec',
      'sec.trusted-runtime.base-sha': '1'.repeat(40),
      'sec.trusted-runtime.head-sha': '2'.repeat(40),
      'sec.trusted-runtime.endpoint-digest': `sha256:${'3'.repeat(64)}`,
      'sec.trusted-runtime.owner-host': 'trusted-host',
      'sec.trusted-runtime.owner-pid': '4242',
      'sec.trusted-runtime.owner-nonce': '12345678-1234-4234-9234-1234567890ab',
      'sec.trusted-runtime.image-id': TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      'sec.trusted-runtime.profile': TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary.id
    };
    const inspect = (extra: Record<string, string> = {}) => JSON.stringify([{
      Id: '4'.repeat(64),
      Image: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      Name: '/sec-trusted-runtime-session-1234567890abcdef-12345678-1234-4234-9234-1234567890ab',
      Config: { Labels: {
        ...operationLabels,
        'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
        'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1,
        'sec.trusted-runtime.bun-image-manifest': TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1,
        'sec.trusted-runtime.bun-version': '1.3.14',
        ...extra
      } }
    }]);
    expect(parseTrustedRuntimeContainerIdentityV1(inspect()).labels).toEqual(operationLabels);
    expect(() => parseTrustedRuntimeContainerIdentityV1(inspect({
      'sec.trusted-runtime.unowned': 'unexpected'
    }))).toThrow(/unknown trusted-runtime label/);
  });

  test('binds ordinary and bootstrap repair to explicit reusable-image resource profiles', () => {
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair.capAdd)
      .toEqual(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities);
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary.workspaceOwnerMode)
      .toBe('delegated-user-1000');
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair.workspaceOwnerMode)
      .toBe('container-root');
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary.trustedBaseMode)
      .toBe('read-only-after-setup');
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair.trustedBaseMode)
      .toBe('materializer-owned');
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary.networkIsolationBoundary)
      .toBe('outer-container-before-execution');
    expect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair.networkIsolationBoundary)
      .toBe('base-owned-sut-sandbox');
    const inspect = (profile: typeof TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary
      | typeof TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair,
    securityOpt: readonly string[] = profile.securityOpt,
    capAdd: readonly string[] | null = profile.capAdd.length === 0 ? null : profile.capAdd
    ): string => JSON.stringify([{
      HostConfig: {
        PidsLimit: profile.pidsLimit,
        NanoCpus: profile.nanoCpus,
        Memory: profile.memoryBytes,
        CapAdd: capAdd,
        CapDrop: profile.capDrop,
        SecurityOpt: securityOpt
      }
    }]);
    expect(() => assertTrustedRuntimeContainerProfileV1(
      inspect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary),
      TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary
    )).not.toThrow();
    expect(() => assertTrustedRuntimeContainerProfileV1(
      inspect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair),
      TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair
    )).not.toThrow();
    expect(() => assertTrustedRuntimeContainerProfileV1(
      inspect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair, ['no-new-privileges:true']),
      TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair
    )).not.toThrow();
    expect(() => assertTrustedRuntimeContainerProfileV1(
      inspect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair,
        ['no-new-privileges'],
        CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities
          .map((capability) => `CAP_${capability}`)),
      TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair
    )).not.toThrow();
    expect(() => assertTrustedRuntimeContainerProfileV1(
      inspect(TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.ordinary),
      TRUSTED_RUNTIME_CONTAINER_PROFILES_V1.bootstrapRepair
    )).toThrow(/profile differs/);
  });

  test('makes dependency reuse a content-addressed non-authoritative cache with an active-use fence', () => {
    const marker = createTrustedRuntimeDependencyCacheMarkerV1({
      repository: 'sec-platform/sec',
      bunLockBlobSha: '1'.repeat(40),
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
    });
    expect(marker).toMatchObject({
      classification: 'rebuildable-derived-cache',
      authority: 'none',
      bunVersion: '1.3.14',
      deletionEffect: 'performance-loss-only',
      activeUseFence: 'docker-mounted-volume-plus-operation-lease-v1'
    });
    expect(parseTrustedRuntimeDependencyCacheMarkerV1(JSON.stringify(marker))).toEqual(marker);
    expect(createTrustedRuntimeDependencyCacheMarkerV1({
      repository: 'sec-platform/sec',
      bunLockBlobSha: '2'.repeat(40),
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
    }).cacheKey).not.toBe(marker.cacheKey);
    expect(() => parseTrustedRuntimeDependencyCacheMarkerV1({
      ...marker,
      authority: 'verification'
    })).toThrow(/lifecycle contract is invalid/);
    expect(() => parseTrustedRuntimeDependencyCacheMarkerV1({
      ...marker,
      cacheKey: `sha256:${'f'.repeat(64)}`
    })).toThrow(/marker digest mismatch/);
    const volume = createTrustedRuntimeDependencyCacheVolumeSpecV1(marker);
    expect(volume).toMatchObject({
      schema: TRUSTED_RUNTIME_DEPENDENCY_CACHE_VOLUME_SCHEMA_V1,
      name: `sec-trusted-runtime-bun-cache-v1-${marker.cacheKey.slice(7, 39)}`
    });
    expect(createTrustedRuntimeDependencyCacheMountV1(volume.name))
      .toBe(`type=volume,source=${volume.name},target=${TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1}`);
    const endpointDigest = `sha256:${'e'.repeat(64)}` as const;
    const volumeInspect = JSON.stringify([{
      CreatedAt: '2026-08-21T14:00:00Z',
      Driver: 'local',
      Labels: volume.labels,
      Mountpoint: `/var/lib/docker/volumes/${volume.name}/_data`,
      Name: volume.name,
      Options: null,
      Scope: 'local'
    }]);
    expect(assertTrustedRuntimeDependencyCacheVolumeV1({
      source: volumeInspect,
      expected: volume,
      endpointDigest
    })).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => assertTrustedRuntimeDependencyCacheVolumeV1({
      source: volumeInspect.replace('"Driver":"local"', '"Driver":"foreign"'),
      expected: volume,
      endpointDigest
    })).toThrow(/differs from the content-addressed specification/);
    const containerInspect = JSON.stringify([{
      Mounts: [{
        Type: 'volume',
        Driver: 'local',
        Name: volume.name,
        Destination: TRUSTED_RUNTIME_DEPENDENCY_CACHE_CONTAINER_PATH_V1,
        RW: true
      }]
    }]);
    expect(() => assertTrustedRuntimeDependencyCacheMountV1(
      containerInspect,
      volume.name
    )).not.toThrow();
    expect(() => assertTrustedRuntimeDependencyCacheMountV1(
      containerInspect.replace(volume.name, `sec-trusted-runtime-bun-cache-v1-${'f'.repeat(32)}`),
      volume.name
    )).toThrow(/differs from the content-addressed volume/);
  });

  test('bootstrap repair receipt binds the reused image, exact candidate, profile, and SUT evidence', () => {
    const receipt = createTrustedRuntimeBootstrapRepairReceiptV1({
      repository: 'sec-platform/sec',
      baseSha: '1'.repeat(40),
      baseTreeSha: '2'.repeat(40),
      headSha: '3'.repeat(40),
      headTreeSha: '4'.repeat(40),
      manifestPath: 'docs/work-packages/sec-static-convergence-v1.md',
      executionId: 'trusted-bootstrap-example',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      dockerEndpoint,
      candidateNetworkIsolatedDuringExecution: true,
      containerProfileDigest: TRUSTED_RUNTIME_BOOTSTRAP_REPAIR_PROFILE_DIGEST_V1,
      dependencyCacheKey: `sha256:${'b'.repeat(64)}`,
      dependencyCacheMarkerFileDigest: `sha256:${'c'.repeat(64)}`,
      dependencyCacheVolumeObservationDigest: `sha256:${'d'.repeat(64)}`,
      trustedProgramBlobSha: '5'.repeat(40),
      bootstrapDigest: `sha256:${'6'.repeat(64)}`,
      sandboxPolicyDigest: `sha256:${'7'.repeat(64)}`,
      commandPlanDigest: `sha256:${'8'.repeat(64)}`,
      evidenceSetDigest: `sha256:${'9'.repeat(64)}`,
      sutReceiptDigest: `sha256:${'a'.repeat(64)}`
    });
    expect(parseTrustedRuntimeBootstrapRepairReceiptV1(JSON.stringify(receipt))).toEqual(receipt);
    expect(() => parseTrustedRuntimeBootstrapRepairReceiptV1({
      ...receipt,
      headTreeSha: 'b'.repeat(40)
    })).toThrow(/digest mismatch/);
  });

  test('binds one reusable exact-main health execution receipt', () => {
    const receipt = createTrustedRuntimeMainHealthReceiptV1({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      executionId: 'trusted-main-health-example',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      dockerEndpoint,
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
      commandResultDigests: [
        `sha256:${'3'.repeat(64)}`,
        `sha256:${'4'.repeat(64)}`,
        `sha256:${'5'.repeat(64)}`,
        `sha256:${'6'.repeat(64)}`
      ],
      transition: null,
      observedAt: '2026-08-21T00:00:00.000Z'
    });
    expect(parseTrustedRuntimeMainHealthReceiptV1(JSON.stringify(receipt))).toEqual(receipt);
    expect(() => parseTrustedRuntimeMainHealthReceiptV1({
      ...receipt,
      mainTreeSha: '7'.repeat(40)
    })).toThrow('receipt digest mismatch');
  });

  test('carries verified candidate evidence forward only when the new-main tree is exact', () => {
    const receipt = createTrustedRuntimeMainHealthReceiptV1({
      origin: 'verified-candidate-transition',
      repository: 'sec-platform/sec',
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      executionId: 'trusted-runtime-transition',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      dockerEndpoint,
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
      commandResultDigests: [
        `sha256:${'3'.repeat(64)}`,
        `sha256:${'4'.repeat(64)}`,
        `sha256:${'5'.repeat(64)}`,
        `sha256:${'6'.repeat(64)}`
      ],
      transition: {
        candidateHeadSha: '7'.repeat(40),
        candidateHeadTreeSha: '2'.repeat(40),
        sessionRevision: `sha256:${'8'.repeat(64)}`,
        verificationEvidenceDigest: `sha256:${'9'.repeat(64)}`,
        containerReceiptDigest: `sha256:${'a'.repeat(64)}`,
        mergeGateResultDigest: `sha256:${'b'.repeat(64)}`,
        statusPublicationDigest: `sha256:${'c'.repeat(64)}`
      },
      observedAt: '2026-08-21T00:00:00.000Z'
    });
    expect(parseTrustedRuntimeMainHealthReceiptV1(JSON.stringify(receipt))).toEqual(receipt);
    expect(() => createTrustedRuntimeMainHealthReceiptV1({
      ...receipt,
      mainTreeSha: 'd'.repeat(40)
    })).toThrow('does not bind the exact new-main tree');
  });
});
