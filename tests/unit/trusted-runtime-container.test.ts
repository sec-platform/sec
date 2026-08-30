import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  createMainHealthLedger,
  createMainHealthRepairWorkPackagePath
} from '../../src/control/main-health/contract.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/external-capabilities/linux-verification/contract.ts';
import { encodeVerificationActionData } from '../../src/verification/action/contract/action.ts';
import { parseDockerEndpointIdentity } from '../../src/verification/ci/runtime/local-github-actions-runner.ts';
import { TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID, TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256, TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT, TRUSTED_RUNTIME_CONTAINER_IMAGE_ID, TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST, TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC, TRUSTED_RUNTIME_STATE_ENVIRONMENT, TRUSTED_RUNTIME_STATE_ENVIRONMENT_DIGEST, TRUSTED_RUNTIME_TEST_TMPFS_SPEC, TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT, assertTrustedRuntimeContainerImageV1, assertTrustedRuntimeDependencyCacheVolume, assertTrustedRuntimeMainHealthCarryForwardBaselineV2, authorizeTrustedRuntimeContainerRecovery, composeTrustedRuntimeContainerLabels, createTrustedRuntimeCommandEnvironmentArgs, createTrustedRuntimeDependencyCacheMarker, createTrustedRuntimeDependencyCacheVolumeSpec, createTrustedRuntimeHostCommandEnvironment, createTrustedRuntimeImageBuildPlan, createTrustedRuntimeMainHealthBaselineObservation, createTrustedRuntimeMainHealthGatePlans, createTrustedRuntimeMainHealthReceipt, createTrustedRuntimeMainHealthSupersessionAuthorization, createTrustedRuntimeMainHealthSupersessionIntent, createTrustedRuntimeMainHealthSupersessionPermit, createTrustedRuntimeMainHealthSupersessionReceipt, parseTrustedRuntimeContainerIdentity, parseTrustedRuntimeMainHealthAffectedPlan, parseTrustedRuntimeMainHealthReceipt, parseTrustedRuntimeMainHealthSupersessionPermit, parseTrustedRuntimeMainHealthSupersessionReceipt, renderTrustedRuntimeCommandFailureDetail, trustedRuntimeMainHealthSupersessionPermitBytes, trustedRuntimeMainHealthSupersessionStatusRequest } from '../../src/verification/trusted-runtime/trusted-runtime-container.ts';

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

function mainHealthRetirementFixture() {
  const mainSha = '1'.repeat(40);
  const mainTreeSha = '2'.repeat(40);
  const baseline = createTrustedRuntimeMainHealthBaselineObservation({
    mainSha,
    mainTreeSha,
    parentLine: `${mainSha} ${'7'.repeat(40)}`,
    parentTreeSha: '8'.repeat(40)
  });
  const localReceipt = createTrustedRuntimeMainHealthReceipt({
    origin: 'physical-main',
    repository: 'sec-platform/sec',
    mainSha,
    mainTreeSha,
    baselineSha: '7'.repeat(40),
    baselineTreeSha: '8'.repeat(40),
    baselineObservationDigest: baseline.observationDigest,
    executionId: 'trusted-main-health-retirement',
    imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    dockerEndpoint,
    networkIsolatedBeforeExecution: true,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
    actionResults: [
      { actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` }
    ],
    transition: null,
    observedAt: '2026-08-21T00:00:00.000Z'
  });
  const failureFingerprint = `sha256:${'4'.repeat(64)}` as const;
  const owner = 'ci-verification-maintainer';
  const hostedLedger = createMainHealthLedger({
    repository: 'sec-platform/sec',
    defaultBranch: 'main',
    mainSha,
    mainTreeSha,
    status: 'degraded',
    failureFingerprints: [failureFingerprint],
    owner,
    repairWorkPackage: createMainHealthRepairWorkPackagePath({
      repository: 'sec-platform/sec',
      defaultBranch: 'main',
      mainSha,
      mainTreeSha,
      owner,
      failureFingerprints: [failureFingerprint]
    }),
    expiresAt: '2026-08-21T01:00:00.000Z',
    allowedLanes: ['repair'],
    trustRevision: mainSha,
    observedAt: '2026-08-21T00:00:00.000Z',
    producer: {
      identity: 'src/control/main-health/default-branch-revision.ts',
      trustRevision: mainSha,
      sourceTransport: 'github-api',
      sourceRunId: '33109458351',
      sourceRef: `github-check-runs:sec-platform/sec@${mainSha}`,
      sourceDigest: `sha256:${'5'.repeat(64)}`
    }
  });
  return Object.freeze({ localReceipt, hostedLedger, mainSha });
}

function imageInspect(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    Id: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    Config: {
      Labels: {
        'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
        'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
        'sec.trusted-runtime.bun-archive-sha256': TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256,
        'sec.trusted-runtime.bun-version': '1.3.14',
        ...overrides
      }
    }
  }]);
}

describe('provider-neutral trusted runtime container', () => {
  test('projects the exact base as the offline default-branch ref in both trees', () => {
    expect(TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT).toContain(
      'git -C /sec-runtime/trusted update-ref refs/remotes/origin/main "$base"'
    );
    expect(TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT).toContain(
      'git -C /sec-runtime/workspace update-ref refs/remotes/origin/main "$base"'
    );
    expect(TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT.match(
      /rev-parse refs\/remotes\/origin\/main/gu
    )).toHaveLength(2);
    expect(TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT).not.toContain('git fetch origin');
  });

  test('builds through Buildx with authority-owned absolute and semantic stall deadlines', () => {
    const plan = createTrustedRuntimeImageBuildPlan(
      path.resolve('config/verification/trusted-runtime.Dockerfile'),
      Object.freeze({
        specDigest: `sha256:${'1'.repeat(64)}` as const,
        layoutPath: path.resolve('.tmp/runner-layout'),
        runtimeManifestDigest: SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.image.runtimeContentDigest,
        dockerProjectionDigest: TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
        provenanceArtifactDigest: `sha256:${'2'.repeat(64)}` as const
      })
    );
    expect(plan.args.slice(0, 2)).toEqual(['buildx', 'build']);
    expect(plan.args).toContain('--load');
    expect(plan.args).toContain('--progress=rawjson');
    expect(plan.args.some((value) => new RegExp(
      `^runner=oci-layout://.*@${SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.image.runtimeContentDigest}$`, 'u'
    ).test(value))).toBe(true);
    expect(plan.args).not.toContain(expect.stringContaining('SEC_RUNNER_IMAGE='));
    expect(plan.args).toContain(`SEC_RUNNER_IMAGE_ID=${TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID}`);
    expect(plan.stallTimeoutMs).toBeLessThan(plan.absoluteTimeoutMs);
  });

  test('admits only the canonical executable test tmpfs and non-executable runtime state', () => {
    const container = {
      Id: '4'.repeat(64),
      Image: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      Name: '/sec-trusted-runtime-example',
      Config: { Labels: {} },
      HostConfig: {
        ReadonlyRootfs: true,
        Init: true,
        Tmpfs: {
          '/tmp': TRUSTED_RUNTIME_TEST_TMPFS_SPEC.slice('/tmp:'.length),
          '/sec-runtime': TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC.slice('/sec-runtime:'.length)
        }
      },
      Mounts: [{ Destination: '/candidate.bundle', Type: 'bind', RW: false }]
    };
    expect(parseTrustedRuntimeContainerIdentity(JSON.stringify([container])))
      .toMatchObject({
        initProcess: true,
        executableTestTmpfs: true,
        nonExecutableMutableTmpfs: true
      });
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: { ...container.HostConfig, Init: false }
    }]))).toThrow('container identity is invalid');
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: {
        ...container.HostConfig,
        Tmpfs: { ...container.HostConfig.Tmpfs, '/tmp': 'rw,noexec,nosuid,nodev,size=2g' }
      }
    }]))).toThrow('/tmp options differ');
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: {
        ...container.HostConfig,
        Tmpfs: { ...container.HostConfig.Tmpfs, '/foreign': 'rw' }
      }
    }]))).toThrow('targets differ');
  });

  test('projects one writable sibling state/cache authority into every trusted runtime command', () => {
    expect(TRUSTED_RUNTIME_STATE_ENVIRONMENT).toEqual({
      SEC_STATE_HOME: '/sec-runtime/output/state',
      SEC_CACHE_HOME: '/sec-runtime/output/cache'
    });
    const projected = createTrustedRuntimeCommandEnvironmentArgs({ SURFACE: 'main-health' });
    expect(projected).toContain('--env');
    expect(projected).toContain('SEC_STATE_HOME=/sec-runtime/output/state');
    expect(projected).toContain('SEC_CACHE_HOME=/sec-runtime/output/cache');
    expect(projected).toContain('SURFACE=main-health');
    expect(() => createTrustedRuntimeCommandEnvironmentArgs({
      SEC_STATE_HOME: '/caller/override'
    })).toThrow('cannot replace SEC_STATE_HOME');
  });

  test('uses stable per-gate ActionKeys and invalidates only when bound inputs change', () => {
    const affectedPlan = parseTrustedRuntimeMainHealthAffectedPlan(JSON.stringify({
      schema: 'sec-local-affected-check-plan-v1',
      resolved: true,
      changedPaths: ['platform/example.ts'],
      affectedPlan: {},
      gates: [
        { id: 'imports:check', command: 'bun run imports:check' },
        { id: 'typecheck', command: 'bun run typecheck' },
        { id: 'test:affected', command: 'bun run test:affected' }
      ],
      umbrellaCommand: 'bun run check:affected',
      subsumedStandaloneCommands: [
        'bun run imports:check', 'bun run typecheck', 'bun run test:affected'
      ]
    }));
    const common = {
      mainTreeSha: '1'.repeat(40),
      baselineObservationDigest: `sha256:${'2'.repeat(64)}` as const,
      affectedPlan,
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      dockerEndpoint
    };
    const first = createTrustedRuntimeMainHealthGatePlans(common);
    const same = createTrustedRuntimeMainHealthGatePlans(common);
    const changed = createTrustedRuntimeMainHealthGatePlans({
      ...common,
      mainTreeSha: '3'.repeat(40)
    });
    expect(first.map(({ action }) => action.actionKey))
      .toEqual(same.map(({ action }) => action.actionKey));
    expect(first.every(({ action }) => action.environment.contractRevision ===
      'sec-trusted-runtime-main-health-action-v2')).toBe(true);
    expect(first.every(({ action }) => action.operation.declaredEnvironment.some((entry) =>
      entry.name === 'trusted-runtime-state-environment'
      && entry.digest === TRUSTED_RUNTIME_STATE_ENVIRONMENT_DIGEST))).toBe(true);
    expect(first.map(({ action }) => action.actionKey))
      .not.toEqual(changed.map(({ action }) => action.actionKey));
    expect(first[2]!.plan.dependencies.map(({ actionKey }) => actionKey))
      .toEqual(first.slice(0, 2).map(({ action }) => action.actionKey).sort());
  });

  test('binds immutable Docker and Bun identities without a GitHub Actions run', () => {
    const image = assertTrustedRuntimeContainerImageV1(imageInspect());
    expect(image.imageId).toBe(TRUSTED_RUNTIME_CONTAINER_IMAGE_ID);
    expect(TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT).toMatchObject({
      kind: 'local',
      os: 'linux',
      arch: 'x64',
      toolchainRevision: 'bun@1.3.14'
    });
    expect(TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT.executionEnvironmentRevision)
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
    expect(parseDockerEndpointIdentity(dockerEndpoint)).toEqual(dockerEndpoint);
    expect(() => parseDockerEndpointIdentity({
      ...dockerEndpoint,
      endpointHost: 'tcp://remote.example:2376'
    })).toThrow(/local npipe or unix transport/);

    const environment = createTrustedRuntimeHostCommandEnvironment('git', {
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

    const dockerEnvironment = createTrustedRuntimeHostCommandEnvironment('docker', {
      DOCKER_CONFIG: path.join('attacker', 'docker-config'),
      DOCKER_CONTEXT: 'attacker-context',
      DOCKER_HOST: 'tcp://attacker.example:2376',
      PATH: 'C:\\tools'
    });
    expect(dockerEnvironment.DOCKER_CONFIG).toBeUndefined();
    expect(dockerEnvironment.DOCKER_CONTEXT).toBeUndefined();
    expect(dockerEnvironment.DOCKER_HOST).toBeUndefined();
  });

  test('retains bounded stdout and stderr when a provider command fails', () => {
    expect(renderTrustedRuntimeCommandFailureDetail({
      stdout: 'compiler diagnostic',
      stderr: 'process exit summary'
    })).toBe('stdout:\ncompiler diagnostic\nstderr:\nprocess exit summary');
    expect(renderTrustedRuntimeCommandFailureDetail({ stdout: '', stderr: '' }))
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
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
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
      initProcess: true as const,
      executableTestTmpfs: true as const,
      nonExecutableMutableTmpfs: true as const,
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
    expect(authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: identity,
      expected,
      observeProcessLiveness: () => {
        observations += 1;
        return 'dead';
      }
    })).toBe(identity.id);
    expect(observations).toBe(2);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: { ...identity,
        dependencyCacheVolumeName: 'sec-trusted-runtime-bun-cache-v1-1234567890abcdef1234567890abcdef' },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'alive'
    })).toThrow(/recovery is not authorized/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: { ...identity, id: '5'.repeat(64) },
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/identity or owner liveness changed/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: { ...identity, labels: { ...identity.labels,
        'sec.trusted-runtime.owner-host': 'foreign-host' } },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: { ...identity, labels: { ...identity.labels,
        'sec.trusted-runtime.image-schema': 'foreign-image' } },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
  });

  test('one exact label set drives Docker create and identity readback', () => {
    const labels = composeTrustedRuntimeContainerLabels(
      { 'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1' },
      { 'sec.trusted-runtime.operation': 'main-12345678' }
    );
    expect(labels).toEqual({
      'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
      'sec.trusted-runtime.operation': 'main-12345678'
    });
    expect(() => composeTrustedRuntimeContainerLabels(
      { shared: 'image' },
      { shared: 'operation' }
    )).toThrow('collide with retained operation identity');
  });

  test('reuses only one exact content-addressed Docker dependency cache', () => {
    const marker = createTrustedRuntimeDependencyCacheMarker({
      repository: 'sec-platform/sec',
      bunLockBlobSha: '1'.repeat(40),
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
    });
    const spec = createTrustedRuntimeDependencyCacheVolumeSpec(marker);
    const inspect = JSON.stringify([{
      CreatedAt: '2026-08-21T00:00:00Z',
      Driver: 'local',
      Labels: spec.labels,
      Name: spec.name,
      Options: null,
      Scope: 'local'
    }]);
    expect(spec.name).toMatch(/^sec-trusted-runtime-bun-cache-v1-[0-9a-f]{32}$/u);
    expect(assertTrustedRuntimeDependencyCacheVolume({
      source: inspect,
      expected: spec,
      endpointDigest: `sha256:${'2'.repeat(64)}`
    })).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(() => assertTrustedRuntimeDependencyCacheVolume({
      source: JSON.stringify([{
        ...JSON.parse(inspect)[0],
        Labels: { ...spec.labels, 'sec.trusted-runtime.cache-key': `sha256:${'3'.repeat(64)}` }
      }]),
      expected: spec,
      endpointDigest: `sha256:${'2'.repeat(64)}`
    })).toThrow(/differs from the content-addressed specification/);
  });

  test('binds one reusable exact-main health execution receipt', () => {
    const baseline = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      parentLine: `${'1'.repeat(40)} ${'7'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    });
    const receipt = createTrustedRuntimeMainHealthReceipt({
      origin: 'physical-main',
      repository: 'sec-platform/sec',
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      baselineSha: '7'.repeat(40),
      baselineTreeSha: '8'.repeat(40),
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'trusted-main-health-example',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      dockerEndpoint,
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
      actionResults: [
        { actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` }
      ],
      transition: null,
      observedAt: '2026-08-21T00:00:00.000Z'
    });
    expect(parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt))).toEqual(receipt);
    expect(() => parseTrustedRuntimeMainHealthReceipt({
      ...receipt,
      mainTreeSha: '7'.repeat(40)
    })).toThrow('baseline observation digest is invalid');
  });

  test('binds a terminal MainHealth supersession receipt to preimage, hosted authority, and issuer', () => {
    const fixture = mainHealthRetirementFixture();
    const sourceName = `main-${fixture.mainSha}.json`;
    const sourceBytes = Buffer.from(
      `${encodeVerificationActionData(fixture.localReceipt)}\n`,
      'utf8'
    );
    const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
      defaultBranch: fixture.hostedLedger.defaultBranch,
      sourceName,
      source: Object.freeze({
        relativePath: sourceName,
        kind: 'file' as const,
        device: 'fixture-device',
        inode: 'fixture-inode',
        size: sourceBytes.byteLength,
        bytes: sourceBytes,
        linkTarget: null
      }),
      localReceipt: fixture.localReceipt,
      hostedLedger: fixture.hostedLedger,
      hostedAuthorityDigest: `sha256:${'9'.repeat(64)}`,
      runtimeAuthorityBinding: `sha256:${'a'.repeat(64)}`,
      predecessorRecordDigest: null,
      issuer: {
        transport: 'github-rest-token',
        login: 'maintainer',
        nodeId: 'MDQ6VXNlcjE=',
        permission: 'maintain'
      }
    });
    const intent = createTrustedRuntimeMainHealthSupersessionIntent({
      authorization,
      preparedAt: '2026-08-21T00:00:00.000Z'
    });
    const request = trustedRuntimeMainHealthSupersessionStatusRequest(authorization);
    const record = createTrustedRuntimeMainHealthSupersessionReceipt({
      authorization,
      preparedIntentDigest: intent.intentDigest,
      providerAuthorization: {
        transport: 'github-commit-status',
        statusId: 123456,
        statusNodeId: 'SC_kwDOExample',
        state: request.state,
        context: request.context,
        description: request.description,
        targetUrl: request.targetUrl,
        createdAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
        creator: { login: 'maintainer', nodeId: 'MDQ6VXNlcjE=' }
      }
    });
    expect(parseTrustedRuntimeMainHealthSupersessionReceipt(
      encodeVerificationActionData(record)
    )).toEqual(record);
    expect(record).toMatchObject({
      phase: 'complete',
      effect: 'prefer-exact-registered-hosted-provider',
      reason: 'stronger-hosted-provider-conflict',
      issuer: { nodeId: 'MDQ6VXNlcjE=', permission: 'maintain' },
      localReceipt: { receiptDigest: fixture.localReceipt.receiptDigest },
      hostedLedger: { ledgerDigest: fixture.hostedLedger.ledgerDigest }
    });
    expect(() => createTrustedRuntimeMainHealthSupersessionAuthorization({
      defaultBranch: fixture.hostedLedger.defaultBranch,
      sourceName,
      source: { ...record.source, relativePath: `${sourceName}.forged`, bytes: sourceBytes,
        linkTarget: null, kind: 'file' },
      localReceipt: fixture.localReceipt,
      hostedLedger: fixture.hostedLedger,
      hostedAuthorityDigest: record.hostedAuthorityDigest,
      runtimeAuthorityBinding: record.runtimeAuthorityBinding,
      predecessorRecordDigest: null,
      issuer: record.issuer
    })).toThrow('exact canonical receipt preimage');
  });

  test('models the MainHealth Effect permit as an immutable available to consumed chain', () => {
    const fixture = mainHealthRetirementFixture();
    const sourceName = `main-${fixture.mainSha}.json`;
    const sourceBytes = Buffer.from(
      `${encodeVerificationActionData(fixture.localReceipt)}\n`,
      'utf8'
    );
    const authorization = createTrustedRuntimeMainHealthSupersessionAuthorization({
      defaultBranch: fixture.hostedLedger.defaultBranch,
      sourceName,
      source: Object.freeze({
        relativePath: sourceName,
        kind: 'file' as const,
        device: 'fixture-device',
        inode: 'fixture-inode',
        size: sourceBytes.byteLength,
        bytes: sourceBytes,
        linkTarget: null
      }),
      localReceipt: fixture.localReceipt,
      hostedLedger: fixture.hostedLedger,
      hostedAuthorityDigest: `sha256:${'9'.repeat(64)}`,
      runtimeAuthorityBinding: `sha256:${'a'.repeat(64)}`,
      predecessorRecordDigest: null,
      issuer: {
        transport: 'github-rest-token',
        login: 'maintainer',
        nodeId: 'MDQ6VXNlcjE=',
        permission: 'maintain'
      }
    });
    const intent = createTrustedRuntimeMainHealthSupersessionIntent({
      authorization,
      preparedAt: '2026-08-21T00:00:00.000Z'
    });
    const available = createTrustedRuntimeMainHealthSupersessionPermit({
      authorization,
      intentDigest: intent.intentDigest,
      phase: 'available'
    });
    const consumed = createTrustedRuntimeMainHealthSupersessionPermit({
      authorization,
      intentDigest: intent.intentDigest,
      phase: 'consumed'
    });
    expect(parseTrustedRuntimeMainHealthSupersessionPermit(
      trustedRuntimeMainHealthSupersessionPermitBytes(available).toString('utf8')
    )).toEqual(available);
    expect(parseTrustedRuntimeMainHealthSupersessionPermit(
      trustedRuntimeMainHealthSupersessionPermitBytes(consumed).toString('utf8')
    )).toEqual(consumed);
    expect(consumed.permitDigest).not.toBe(available.permitDigest);
    expect(() => parseTrustedRuntimeMainHealthSupersessionPermit({
      ...available,
      phase: 'consumed'
    })).toThrow('permit digest mismatch');
  });

  test('carries verified candidate evidence forward only when the new-main tree is exact', () => {
    const baseline = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      parentLine: `${'1'.repeat(40)} ${'7'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    });
    const receipt = createTrustedRuntimeMainHealthReceipt({
      origin: 'verified-candidate-transition',
      repository: 'sec-platform/sec',
      mainSha: '1'.repeat(40),
      mainTreeSha: '2'.repeat(40),
      baselineSha: '7'.repeat(40),
      baselineTreeSha: '8'.repeat(40),
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'trusted-runtime-transition',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      dockerEndpoint,
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
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
    expect(parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt))).toEqual(receipt);
    const differentTreeBaseline = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha: '1'.repeat(40),
      mainTreeSha: 'd'.repeat(40),
      parentLine: `${'1'.repeat(40)} ${'7'.repeat(40)}`,
      parentTreeSha: '8'.repeat(40)
    });
    expect(() => createTrustedRuntimeMainHealthReceipt({
      ...receipt,
      mainTreeSha: 'd'.repeat(40),
      baselineObservationDigest: differentTreeBaseline.observationDigest
    })).toThrow('does not bind the exact new-main tree');
  });

  test('carry-forward accepts only the observed single parent and exact parent tree', () => {
    const mainSha = '1'.repeat(40);
    const baselineSha = '7'.repeat(40);
    const observation = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha,
      mainTreeSha: '2'.repeat(40),
      parentLine: `${mainSha} ${baselineSha}`,
      parentTreeSha: '8'.repeat(40)
    });
    expect(() => createTrustedRuntimeMainHealthBaselineObservation({
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
