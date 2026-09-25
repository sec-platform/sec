import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import { parseDockerEndpointIdentity } from '../../src/adapters/providers/docker/contract/daemon.ts';
import {
  LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY,
  LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
  LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH,
  LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH
} from '../../src/adapters/providers/linux-verification/contract.ts';
import {
  TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
  TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256,
  TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT,
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
  TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC,
  TRUSTED_RUNTIME_STATE_ENVIRONMENT,
  TRUSTED_RUNTIME_TEST_TMPFS_SPEC,
  TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT,
  assertTrustedRuntimeContainerImage,
  assertTrustedRuntimeDependencyCacheVolume,
  authorizeTrustedRuntimeContainerRecovery,
  composeTrustedRuntimeContainerLabels,
  createTrustedRuntimeCommandEnvironmentArgs,
  createTrustedRuntimeDependencyCacheMarker,
  createTrustedRuntimeDependencyCacheVolumeSpec,
  createTrustedRuntimeHostCommandEnvironment,
  createTrustedRuntimeImageBuildPlan,
  issueTrustedRuntimeContainerEngineOwnerTerminalJoin,
  parseTrustedRuntimeContainerIdentity,
  renderTrustedRuntimeCommandFailureDetail
} from '../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../src/execution/operation/semantic.ts';

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
    Id: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
    Config: {
      Labels: {
        'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
        'sec.trusted-runtime.base-image-id': TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
        'sec.trusted-runtime.bun-archive-sha256': TRUSTED_RUNTIME_CONTAINER_BUN_ARCHIVE_SHA256,
        'sec.trusted-runtime.bun-executable-sha256':
          LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST,
        'sec.trusted-runtime.bun-version':
          LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunVersion,
        ...overrides
      }
    }
  }]);
}

describe('provider-neutral trusted runtime container', () => {
  test('joins only one provider-issued exact requirement settlement with independent endpoint readback', () => {
    const contractDigest = sha256({ contract: 'container-engine-test' }) as OperationDigest;
    const providerIdentityDigest = sha256({ provider: 'container-engine-test' }) as OperationDigest;
    const plan = compileSemanticOperationPlan({
      operation: 'verification.trusted-runtime-container-test',
      intentDigest: sha256({ intent: 'container-engine-test' }) as OperationDigest,
      decisionDigest: sha256({ decision: 'container-engine-test' }) as OperationDigest,
      deadlineAtUnixMs: Date.now() + 60_000,
      aggregateBudgets: [
        { resource: 'duration-ms', maximum: 60_000 },
        { resource: 'output-bytes', maximum: 1024 },
        { resource: 'processes', maximum: 1 }
      ],
      requirements: [{
        id: 'external.container-engine-process',
        contractDigest,
        effectKinds: ['process'],
        failureKinds: ['process.failed']
      }],
      attempt: issueSemanticOperationAttemptContext({
        authorityGrantDigest: contractDigest
      })
    });
    const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId: 'external.container-engine-process',
      contractDigest,
      providerIdentityDigest
    })]);
    const providerSettlement = issueProviderSettlementReceipt(operation, {
      requirementId: 'external.container-engine-process',
      physicalDisposition: 'settled',
      providerSettlementReferenceDigest: sha256({ command: 'settled' }) as OperationDigest
    });
    const join = issueTrustedRuntimeContainerEngineOwnerTerminalJoin({
      operation,
      providerSettlement,
      endpointReadback: parseDockerEndpointIdentity(dockerEndpoint),
      ownerTerminalContractDigest: sha256({ owner: 'contract' }) as OperationDigest,
      ownerTerminalReferenceDigest: sha256({ owner: 'reference' }) as OperationDigest
    });
    expect(join.providerSettlementSetDigest).not.toBeNull();
    expect(join.readbackReceiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const correlationOnlyClone = issueTrustedRuntimeContainerEngineOwnerTerminalJoin({
      operation,
      providerSettlement: { ...providerSettlement },
      endpointReadback: parseDockerEndpointIdentity(dockerEndpoint),
      ownerTerminalContractDigest: sha256({ owner: 'contract' }) as OperationDigest,
      ownerTerminalReferenceDigest: sha256({ owner: 'reference' }) as OperationDigest
    });
    expect(correlationOnlyClone.joinReceiptDigest).toBe(join.joinReceiptDigest);
  });

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

  test('enters dependency materialization through the exact Bun package runner', () => {
    expect(TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT).toContain(
      `CI=1 ${LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_PATH} run deps:ensure`
    );
    expect(TRUSTED_RUNTIME_WORKSPACE_SETUP_SCRIPT).not.toContain(
      'src/adapters/self-hosting/development/runner/cli.ts deps:ensure'
    );
  });

  test('builds through Buildx with authority-owned absolute and semantic stall deadlines', () => {
    const plan = createTrustedRuntimeImageBuildPlan(
      Object.freeze({
        specDigest: `sha256:${'1'.repeat(64)}` as const,
        layoutPath: path.resolve('.tmp/runner-layout'),
        runtimeManifestDigest: LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.image.runtimeContentDigest,
        dockerProjectionDigest: TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID,
        provenanceArtifactDigest: `sha256:${'2'.repeat(64)}` as const
      })
    );
    expect(plan.args.slice(0, 2)).toEqual(['buildx', 'build']);
    expect(plan.args).toContain('--load');
    expect(plan.args).toContain('--progress=rawjson');
    expect(plan.args.some((value) => new RegExp(
      `^runner=oci-layout://.*@${LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.image.runtimeContentDigest}$`, 'u'
    ).test(value))).toBe(true);
    expect(plan.args).not.toContain(expect.stringContaining('SEC_RUNNER_IMAGE='));
    expect(plan.args).toContain(`SEC_RUNNER_IMAGE_ID=${TRUSTED_RUNTIME_CONTAINER_BASE_IMAGE_ID}`);
    expect(plan.args).toContain(
      `SEC_BUN_EXECUTABLE_DIGEST=${LINUX_VERIFICATION_TRUSTED_BUN_EXECUTABLE_DIGEST}`
    );
    expect(plan.args[plan.args.indexOf('--file') + 1]).toBe(path.resolve(
      ...LINUX_VERIFICATION_TRUSTED_RUNTIME_DOCKERFILE_PATH.split('/')
    ));
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
      Mounts: [{
        Destination: '/candidate.bundle',
        Source: 'C:\\sec\\candidate.bundle',
        Type: 'bind',
        RW: false
      }]
    };
    expect(parseTrustedRuntimeContainerIdentity(JSON.stringify([container])))
      .toMatchObject({
        initProcess: true,
        candidateBundleSource: 'C:\\sec\\candidate.bundle',
        executableTestTmpfs: true,
        nonExecutableMutableTmpfs: true
      });
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: { ...container.HostConfig, Init: false }
    }]))).toThrow('container identity is invalid');
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      Mounts: [{ Destination: '/candidate.bundle', Type: 'bind', RW: false }]
    }]))).toThrow('read-only bind mount');
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

  test('binds immutable Docker and Bun identities without a GitHub Actions run', () => {
    const image = assertTrustedRuntimeContainerImage(imageInspect());
    expect(image.imageId).toBe(TRUSTED_RUNTIME_CONTAINER_IMAGE_ID);
    expect(TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT).toMatchObject({
      kind: 'local',
      os: 'linux',
      arch: 'x64',
      toolchainRevision:
        `bun@${LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunVersion}`
    });
    expect(TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT.executionEnvironmentRevision)
      .toContain(
        `local-dev-runner:linux:x64:bun-${LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.trustedRuntime.bunVersion}`
      );
  });

  test('rejects mutable or mislabeled execution images', () => {
    expect(() => assertTrustedRuntimeContainerImage(imageInspect({
      'sec.trusted-runtime.bun-version': 'latest'
    }))).toThrow('bun-version drifted');
    expect(() => assertTrustedRuntimeContainerImage(JSON.stringify([{
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
      candidateBundleSource: 'C:\\sec\\candidate.bundle',
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
      first: identity,
      confirmed: { ...identity, candidateBundleSource: 'C:\\foreign\\candidate.bundle' },
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
});
