import { describe, expect, test } from 'bun:test';

import { parseDockerEndpointIdentityV3 } from '../../scripts/codex/local-github-actions-runner.ts';
import {
  TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID_V1,
  TRUSTED_RUNTIME_CONTAINER_BUN_IMAGE_MANIFEST_V1,
  TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS_V2,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
  assertTrustedRuntimeContainerImageV1,
  assertTrustedRuntimeDependencyCacheVolumeV1,
  assertTrustedRuntimeMainHealthCarryForwardBaselineV2,
  authorizeTrustedRuntimeContainerRecoveryV1,
  composeTrustedRuntimeContainerLabelsV1,
  createTrustedRuntimeDependencyCacheMarkerV1,
  createTrustedRuntimeDependencyCacheVolumeSpecV1,
  createTrustedRuntimeHostCommandEnvironmentV1,
  createTrustedRuntimeMainHealthBaselineObservationV2,
  createTrustedRuntimeMainHealthReceiptV2,
  parseTrustedRuntimeMainHealthReceiptV2,
  renderTrustedRuntimeCommandFailureDetailV1
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

  test('retains bounded stdout and stderr when a provider command fails', () => {
    expect(renderTrustedRuntimeCommandFailureDetailV1({
      stdout: 'compiler diagnostic',
      stderr: 'process exit summary'
    })).toBe('stdout:\ncompiler diagnostic\nstderr:\nprocess exit summary');
    expect(renderTrustedRuntimeCommandFailureDetailV1({ stdout: '', stderr: '' }))
      .toBe('<no captured output>');
  });

  test('reclaims only one twice-observed exact dead-owner container identity', () => {
    const operationKey = 'session-1234567890abcdef';
    const ownerNonce = '12345678-1234-4234-9234-1234567890ab';
    const imageLabels = Object.freeze({
      'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1'
    });
    const expected = Object.freeze({
      operationKey,
      repository: 'sec-platform/sec',
      baseSha: '1'.repeat(40),
      headSha: '2'.repeat(40),
      endpointDigest: `sha256:${'3'.repeat(64)}` as `sha256:${string}`,
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      imageLabels,
      ownerHost: 'trusted-host',
      dependencyCacheVolumeName: null
    });
    const identity = Object.freeze({
      id: '4'.repeat(64),
      imageId: expected.imageId,
      name: `sec-trusted-runtime-${operationKey}-${ownerNonce}`,
      readOnlyRootfs: true as const,
      readOnlyCandidateBundle: true as const,
      dependencyCacheVolumeName: null,
      labels: Object.freeze({
        ...imageLabels,
        'sec.trusted-runtime.operation': operationKey,
        'sec.trusted-runtime.repository': expected.repository,
        'sec.trusted-runtime.base-sha': expected.baseSha,
        'sec.trusted-runtime.head-sha': expected.headSha,
        'sec.trusted-runtime.endpoint-digest': expected.endpointDigest,
        'sec.trusted-runtime.owner-host': expected.ownerHost,
        'sec.trusted-runtime.owner-pid': '4242',
        'sec.trusted-runtime.owner-nonce': ownerNonce,
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
      first: { ...identity,
        dependencyCacheVolumeName: 'sec-trusted-runtime-bun-cache-v1-1234567890abcdef1234567890abcdef' },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
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
    expect(() => authorizeTrustedRuntimeContainerRecoveryV1({
      first: { ...identity, labels: { ...identity.labels,
        'sec.trusted-runtime.image-schema': 'foreign-image' } },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
  });

  test('one exact label set drives Docker create and identity readback', () => {
    const labels = composeTrustedRuntimeContainerLabelsV1(
      { 'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1' },
      { 'sec.trusted-runtime.operation': 'main-12345678' }
    );
    expect(labels).toEqual({
      'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
      'sec.trusted-runtime.operation': 'main-12345678'
    });
    expect(() => composeTrustedRuntimeContainerLabelsV1(
      { shared: 'image' },
      { shared: 'operation' }
    )).toThrow('collide with retained operation identity');
  });

  test('reuses only one exact content-addressed Docker dependency cache', () => {
    const marker = createTrustedRuntimeDependencyCacheMarkerV1({
      repository: 'sec-platform/sec',
      bunLockBlobSha: '1'.repeat(40),
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1
    });
    const spec = createTrustedRuntimeDependencyCacheVolumeSpecV1(marker);
    const inspect = JSON.stringify([{
      CreatedAt: '2026-08-21T00:00:00Z',
      Driver: 'local',
      Labels: spec.labels,
      Name: spec.name,
      Options: null,
      Scope: 'local'
    }]);
    expect(spec.name).toMatch(/^sec-trusted-runtime-bun-cache-v1-[0-9a-f]{32}$/u);
    expect(assertTrustedRuntimeDependencyCacheVolumeV1({
      source: inspect,
      expected: spec,
      endpointDigest: `sha256:${'2'.repeat(64)}`
    })).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => assertTrustedRuntimeDependencyCacheVolumeV1({
      source: JSON.stringify([{
        ...JSON.parse(inspect)[0],
        Labels: { ...spec.labels, 'sec.trusted-runtime.cache-key': `sha256:${'3'.repeat(64)}` }
      }]),
      expected: spec,
      endpointDigest: `sha256:${'2'.repeat(64)}`
    })).toThrow(/differs from the content-addressed specification/);
  });

  test('binds one reusable exact-main health execution receipt', () => {
    expect(TRUSTED_RUNTIME_MAIN_HEALTH_ACTIONS_V2).toEqual([
      { id: 'affected-closure', argv: ['bun', 'run', 'check:affected'] }
    ]);
    const baseline = createTrustedRuntimeMainHealthBaselineObservationV2({
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      parentLine: `${'1'.repeat(40)} ${'7'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    });
    const receipt = createTrustedRuntimeMainHealthReceiptV2({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      baselineSha: '7'.repeat(40),
      baselineTreeSha: '8'.repeat(40),
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'trusted-main-health-example',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      dockerEndpoint,
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
      actionResults: [
        { actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` }
      ],
      transition: null,
      observedAt: '2026-08-21T00:00:00.000Z'
    });
    expect(parseTrustedRuntimeMainHealthReceiptV2(JSON.stringify(receipt))).toEqual(receipt);
    expect(() => parseTrustedRuntimeMainHealthReceiptV2({
      ...receipt,
      mainTreeSha: '7'.repeat(40)
    })).toThrow('baseline observation digest is invalid');
  });

  test('carries verified candidate evidence forward only when the new-main tree is exact', () => {
    const baseline = createTrustedRuntimeMainHealthBaselineObservationV2({
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      parentLine: `${'1'.repeat(40)} ${'7'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    });
    const receipt = createTrustedRuntimeMainHealthReceiptV2({
      origin: 'verified-candidate-transition',
      repository: 'sec-platform/sec',
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      baselineSha: '7'.repeat(40),
      baselineTreeSha: '8'.repeat(40),
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'trusted-runtime-transition',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID_V1,
      dockerEndpoint,
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
      actionResults: [
        { actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` }
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
    expect(parseTrustedRuntimeMainHealthReceiptV2(JSON.stringify(receipt))).toEqual(receipt);
    const differentTreeBaseline = createTrustedRuntimeMainHealthBaselineObservationV2({
      mainSha: '1'.repeat(40),
      mainTreeSha: 'd'.repeat(40),
      parentLine: `${'1'.repeat(40)} ${'7'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    });
    expect(() => createTrustedRuntimeMainHealthReceiptV2({
      ...receipt,
      mainTreeSha: 'd'.repeat(40),
      baselineObservationDigest: differentTreeBaseline.observationDigest
    })).toThrow('does not bind the exact new-main tree');
  });

  test('carry-forward accepts only the observed single parent and exact parent tree', () => {
    const mainSha = '1'.repeat(40);
    const baselineSha = '7'.repeat(40);
    const observation = createTrustedRuntimeMainHealthBaselineObservationV2({
      mainSha,
      mainTreeSha: '2'.repeat(40),
      parentLine: `${mainSha} ${baselineSha}`,
      parentTreeSha: '8'.repeat(40)
    });
    expect(() => createTrustedRuntimeMainHealthBaselineObservationV2({
      mainSha,
      mainTreeSha: '2'.repeat(40),
      parentLine: `${mainSha} ${baselineSha} ${'9'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    })).toThrow('one canonical parent baseline');
    expect(() => assertTrustedRuntimeMainHealthCarryForwardBaselineV2(
      observation,
      { baselineSha: '6'.repeat(40), baselineTreeSha: '8'.repeat(40) }
    )).toThrow('differs from the exact merged commit parent');
    expect(() => assertTrustedRuntimeMainHealthCarryForwardBaselineV2(
      observation,
      { baselineSha, baselineTreeSha: '9'.repeat(40) }
    )).toThrow('differs from the exact merged commit parent');
    expect(() => assertTrustedRuntimeMainHealthCarryForwardBaselineV2(
      observation,
      { baselineSha, baselineTreeSha: '8'.repeat(40) }
    )).not.toThrow();
  });
});
