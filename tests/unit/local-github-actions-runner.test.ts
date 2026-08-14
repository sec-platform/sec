import { describe, expect, test } from 'bun:test';

import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import {
  assertExactLocalGitHubActionsRunnerProfileContainersV3,
  assertExactLocalGitHubActionsRunnerProfileInventoryV3,
  assertInitialLocalGitHubActionsProviderLedgerV3,
  assertLocalGitHubActionsProviderLedgerTransitionV3,
  assertLocalGitHubActionsRunnerImageIdentityV1,
  assertOwnedLocalGitHubActionsRunnerV2,
  assertRepositoryIdentityMatchesOriginV2,
  assertRepositoryIdentityMatchesRemoteUrlsV2,
  createLocalGitHubActionsProviderLedgerCommitBytesV3,
  createLocalGitHubActionsProviderLedgerV3,
  createLocalGitHubActionsRunnerDockerfileV1,
  createLocalGitHubActionsRunnerStateV3,
  LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3,
  LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1,
  LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1,
  LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
  LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
  LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2,
  LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2,
  LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3,
  LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1,
  LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3,
  parseLocalGitHubActionsProviderLedgerCommitV3,
  parseLocalGitHubActionsProviderLedgerV3,
  parseLocalGitHubActionsRunnerStateV3,
  type DockerEndpointIdentityV3,
  type GitHubEndpointIdentityV3,
  type LocalGitHubActionsRunnerInstanceV2,
  type LocalGitHubActionsRunnerRoleV2
} from '../../scripts/codex/local-github-actions-runner.ts';

const repository = 'sec-platform/sec';
const providerName = 'sec-main-health-1';
const operationLabel = `sec-operation-${'b'.repeat(64)}`;
const roles = ['control', 'trusted', 'sut'] as const;

const dockerEndpoint: DockerEndpointIdentityV3 = Object.freeze({
  schema: 'sec-docker-endpoint-identity-v1',
  contextName: 'desktop-linux',
  endpointHost: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  daemonId: '01234567-89ab-cdef-0123-456789abcdef',
  osType: 'linux',
  architecture: 'x86_64'
});

const githubEndpoint: GitHubEndpointIdentityV3 = Object.freeze({
  schema: 'sec-github-api-endpoint-identity-v1',
  host: LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3,
  repository,
  principal: 'QzCrane'
});

const instances: readonly LocalGitHubActionsRunnerInstanceV2[] = Object.freeze(
  roles.map((role, index) => Object.freeze({
    role,
    roleLabel: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[role],
    name: `${providerName}-${role}`,
    runnerId: 21 + index,
    containerId: String.fromCharCode(97 + index).repeat(64),
    containerName: `${providerName}-${role}`
  }))
);

function runner(role: LocalGitHubActionsRunnerRoleV2, overrides: Record<string, unknown> = {}) {
  const instance = instances.find((candidate) => candidate.role === role)!;
  return {
    id: instance.runnerId,
    name: instance.name,
    os: 'Linux',
    status: 'online',
    busy: false,
    labels: [
      ...LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1,
      LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2[role],
      operationLabel
    ].map((name) => ({ name })),
    ...overrides
  };
}

function container(role: LocalGitHubActionsRunnerRoleV2, overrides: Record<string, unknown> = {}) {
  const instance = instances.find((candidate) => candidate.role === role)!;
  const isSut = role === 'sut';
  return {
    Id: instance.containerId,
    Name: `/${instance.name}`,
    Image: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
    Config: {
      Labels: {
        'sec.local-runner.schema': LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3,
        'sec.local-runner.repository': repository,
        'sec.local-runner.provider-name': providerName,
        'sec.local-runner.instance-name': instance.name,
        'sec.local-runner.role': role,
        'sec.local-runner.container-init': LOCAL_GITHUB_ACTIONS_RUNNER_CONTAINER_INIT_CAPABILITY_V1,
        'sec.local-runner.image-id': LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
        'sec.local-runner.operation-label': operationLabel
      }
    },
    HostConfig: {
      Init: true,
      CapAdd: isSut
        ? CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities
          .map((capability) => `CAP_${capability}`)
        : [],
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges:true'],
      Privileged: false,
      Binds: null,
      PidsLimit: isSut ? 256 : 4096,
      Memory: isSut ? 4 * 1024 * 1024 * 1024 : 12 * 1024 * 1024 * 1024,
      NanoCpus: (isSut ? 2 : 8) * 1_000_000_000
    },
    State: { Running: true },
    ...overrides
  };
}

function activeLedger() {
  return createLocalGitHubActionsProviderLedgerV3({
    repository,
    providerName,
    operationLabel,
    expectedMainSha: 'a'.repeat(40),
    createdAt: '2026-08-14T08:00:00.000Z',
    dockerEndpoint,
    githubEndpoint,
    lifecycle: 'active',
    generation: 7,
    predecessorObjectSha: 'c'.repeat(40),
    instances: instances.map((instance) => ({
      role: instance.role,
      roleLabel: instance.roleLabel,
      name: instance.name,
      containerId: instance.containerId,
      containerState: 'present' as const,
      runnerId: instance.runnerId,
      runnerState: 'present' as const
    }))
  });
}

function initialLedger() {
  return createLocalGitHubActionsProviderLedgerV3({
    repository,
    providerName,
    operationLabel,
    expectedMainSha: 'a'.repeat(40),
    createdAt: '2026-08-14T08:00:00.000Z',
    dockerEndpoint,
    githubEndpoint,
    lifecycle: 'provisioning',
    generation: 0,
    predecessorObjectSha: null,
    instances: instances.map((instance) => ({
      role: instance.role,
      roleLabel: instance.roleLabel,
      name: instance.name,
      containerId: null,
      containerState: 'uncreated' as const,
      runnerId: null,
      runnerState: 'uncreated' as const
    }))
  });
}

describe('local GitHub Actions runner contract', () => {
  test('pins the Linux provider toolchain and contains the SUT sandbox', () => {
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1).toBe('2.336.0');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1).toBe(
      '04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d'
    );
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1).toBe(
      'ubuntu@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea'
    );
    expect(LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1).toBe('24.19.0');
    expect(LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1).toBe(
      '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647'
    );
    expect(LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1).toBe('3.12.3');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2)
      .toBe('trust-domains-node24-python312-archive-v7');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1)
      .toBe('sec-local-github-actions-provider-state-v2');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1)
      .toBe('sec-actions-runner:2.336.0-trust-domains-node24-python312-archive-v7');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2).toBe(
      'sha256:a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf'
    );
    expect(LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3.map(({ imageId }) => imageId))
      .toEqual([
        'sha256:6ec6d4c46a92a8b9c64e33c3c864b0f817c296725b4a617f2c0e2aae9b40060e',
        'sha256:60d1c338f85133d997cc2fb3b0353d79a52fc297e84188963e3e9c2cf98cf209',
        'sha256:2fce0e62d0db84341fb2c76f4038879fbfceaf9babcb167c61b93f6b76ae906a'
      ]);
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1).toEqual([
      'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1'
    ]);

    const dockerfile = createLocalGitHubActionsRunnerDockerfileV1();
    expect(dockerfile).toContain(`FROM ${LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1}`);
    expect(dockerfile).toContain(`${LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1}  runner.tar.gz`);
    expect(dockerfile).toContain(`${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1}  node.tar.xz`);
    expect(dockerfile).toContain('sha256sum --check --strict');
    expect(dockerfile).toContain('tar --no-same-owner -xzf runner.tar.gz');
    expect(dockerfile).toContain('apt-get -o Acquire::Retries=5 update');
    expect(dockerfile).toContain('apt-get -o Acquire::Retries=5 install');
    expect(dockerfile).toContain('python3 unzip xz-utils');
    expect(dockerfile).toContain('command -v unzip >/dev/null');
    expect(dockerfile).toContain(`test "$(node --version)" = "v${LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1}"`);
    expect(dockerfile).toContain(`test "$(python3 --version)" = "Python ${LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1}"`);
    expect(dockerfile).toContain(
      `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1}`
    );
    expect(dockerfile).not.toContain(
      `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3}`
    );
    expect(dockerfile).not.toContain(':latest');
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bnodejs\b/u);

    const frozenImage = {
      Id: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
      Config: { Labels: {
        'sec.local-runner.image-schema': LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1,
        'sec.local-runner.image-revision': LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2,
        'sec.local-runner.runner-version': LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1,
        'sec.local-runner.node-version': LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1,
        'sec.local-runner.node-archive-sha256': LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1,
        'sec.local-runner.python-version': LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1
      } }
    } as const;
    expect(() => assertLocalGitHubActionsRunnerImageIdentityV1(frozenImage)).not.toThrow();
    expect(() => assertLocalGitHubActionsRunnerImageIdentityV1({
      ...frozenImage,
      Config: { Labels: {
        ...frozenImage.Config.Labels,
        'sec.local-runner.image-schema': LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3
      } }
    })).toThrow('cached runner image labels differ from the frozen provider revision');
    expect(() => assertLocalGitHubActionsRunnerImageIdentityV1({
      ...frozenImage,
      Id: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    })).toThrow('cached runner image ID differs from the frozen provider revision');
    for (const label of [
      'sec.local-runner.image-revision',
      'sec.local-runner.runner-version',
      'sec.local-runner.node-version',
      'sec.local-runner.node-archive-sha256',
      'sec.local-runner.python-version'
    ] as const) {
      const labels = { ...frozenImage.Config.Labels } as Record<string, string>;
      delete labels[label];
      expect(() => assertLocalGitHubActionsRunnerImageIdentityV1({
        ...frozenImage,
        Config: { Labels: labels }
      })).toThrow('cached runner image labels differ from the frozen provider revision');
    }
  });

  test('remote CAS ledger is the authority and local state is only its exact projection', () => {
    const initial = initialLedger();
    expect(() => assertInitialLocalGitHubActionsProviderLedgerV3(initial)).not.toThrow();
    const firstContainer = createLocalGitHubActionsProviderLedgerV3({
      ...initial,
      generation: 1,
      predecessorObjectSha: '1'.repeat(40),
      instances: initial.instances.map((instance) => instance.role === 'control'
        ? { ...instance, containerId: 'a'.repeat(64), containerState: 'present' as const }
        : instance)
    });
    expect(() => assertLocalGitHubActionsProviderLedgerTransitionV3(
      '1'.repeat(40), initial, firstContainer
    )).not.toThrow();
    const commitBytes = createLocalGitHubActionsProviderLedgerCommitBytesV3(
      firstContainer,
      'f'.repeat(40)
    );
    expect(parseLocalGitHubActionsProviderLedgerCommitV3(commitBytes.toString('utf8'))).toEqual({
      treeSha: 'f'.repeat(40),
      parentObjectSha: '1'.repeat(40),
      timestamp: Math.floor(Date.parse(firstContainer.createdAt) / 1000),
      generation: 1
    });
    expect(() => parseLocalGitHubActionsProviderLedgerCommitV3(
      commitBytes.toString('utf8').replace('SEC Provider Ledger', 'Untrusted Writer')
    )).toThrow('commit framing is invalid');
    const twoEffects = createLocalGitHubActionsProviderLedgerV3({
      ...firstContainer,
      generation: 2,
      predecessorObjectSha: '2'.repeat(40),
      instances: firstContainer.instances.map((instance) => {
        if (instance.role === 'control') {
          return { ...instance, runnerId: 21, runnerState: 'present' as const };
        }
        if (instance.role === 'trusted') {
          return { ...instance, containerId: 'b'.repeat(64), containerState: 'present' as const };
        }
        return instance;
      })
    });
    expect(() => assertLocalGitHubActionsProviderLedgerTransitionV3(
      '2'.repeat(40), firstContainer, twoEffects
    )).toThrow('exactly one lifecycle or resource effect');
    const teardown = createLocalGitHubActionsProviderLedgerV3({
      ...initial,
      lifecycle: 'teardown',
      generation: 1,
      predecessorObjectSha: '3'.repeat(40)
    });
    expect(() => assertLocalGitHubActionsProviderLedgerTransitionV3(
      '3'.repeat(40), initial, teardown
    )).not.toThrow();
    const skippedRunner = createLocalGitHubActionsProviderLedgerV3({
      ...teardown,
      generation: 2,
      predecessorObjectSha: '4'.repeat(40),
      instances: teardown.instances.map((instance) => instance.role === 'sut'
        ? { ...instance, runnerState: 'absent' as const }
        : instance)
    });
    expect(() => assertLocalGitHubActionsProviderLedgerTransitionV3(
      '4'.repeat(40), teardown, skippedRunner
    )).not.toThrow();

    const ledger = activeLedger();
    expect(parseLocalGitHubActionsProviderLedgerV3(JSON.stringify(ledger))).toEqual(ledger);
    expect(ledger.instances.map(({ role }) => role)).toEqual([...roles]);
    expect(ledger.lifecycle).toBe('active');
    expect(ledger.dockerEndpoint).toEqual(dockerEndpoint);
    expect(ledger.githubEndpoint).toEqual(githubEndpoint);
    expect(() => parseLocalGitHubActionsProviderLedgerV3(JSON.stringify({
      ...ledger,
      githubEndpoint: { ...ledger.githubEndpoint, principal: 'Attacker' }
    }))).toThrow('digest mismatch');
    expect(() => parseLocalGitHubActionsProviderLedgerV3(JSON.stringify({
      ...ledger,
      dockerEndpoint: { ...ledger.dockerEndpoint, extra: true }
    }))).toThrow('keys are invalid');
    expect(() => createLocalGitHubActionsProviderLedgerV3({
      ...ledger,
      dockerEndpoint: { ...ledger.dockerEndpoint, endpointHost: 'tcp://remote.example:2376' }
    })).toThrow('must be a local npipe or unix transport');

    const state = createLocalGitHubActionsRunnerStateV3({
      repository,
      repositoryRoot: 'D:/Project/sec',
      commonDirectory: 'D:/Project/sec/.git',
      providerName,
      operationLabel,
      providerLedgerRef: LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3,
      providerLedgerObjectSha: 'd'.repeat(40),
      providerLedgerDigest: ledger.ledgerDigest,
      dockerEndpoint,
      githubEndpoint,
      instances,
      startedAt: '2026-08-14T08:00:00.000Z'
    });
    expect(parseLocalGitHubActionsRunnerStateV3(JSON.stringify(state))).toEqual(state);
    expect(state.providerLedgerRef).toBe(LOCAL_GITHUB_ACTIONS_PROVIDER_LEDGER_REF_V3);
    expect(() => parseLocalGitHubActionsRunnerStateV3(JSON.stringify({
      ...state,
      providerLedgerObjectSha: 'e'.repeat(40)
    }))).toThrow('digest mismatch');
    expect(() => parseLocalGitHubActionsRunnerStateV3(JSON.stringify({ ...state, token: 'secret' })))
      .toThrow('keys are invalid');
    expect(JSON.stringify(state)).not.toContain('token');
  });

  test('requires one exact runner identity for every trust role', () => {
    const runners = roles.map((role) => runner(role));
    expect(assertOwnedLocalGitHubActionsRunnerV2(runners[1]!, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel,
      runnerId: 22
    })).toBe(22);
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventoryV3({
      runners,
      instances,
      operationLabel
    })).not.toThrow();
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventoryV3({
      runners: runners.slice(0, 2),
      instances,
      operationLabel
    })).toThrow('missing, duplicated, or extra');
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventoryV3({
      runners: [...runners, runner('sut', { id: 99, name: 'foreign-sut' })],
      instances,
      operationLabel
    })).toThrow('missing, duplicated, or extra');
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventoryV3({
      runners: [runners[0]!, runner('trusted', { status: 'offline' }), runners[2]!],
      instances,
      operationLabel
    })).toThrow('final readiness census is not online and idle');
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventoryV3({
      runners: [runners[0]!, runner('trusted', { busy: true }), runners[2]!],
      instances,
      operationLabel
    })).toThrow('final readiness census is not online and idle');
    expect(() => assertOwnedLocalGitHubActionsRunnerV2({
      ...runner('trusted'),
      labels: [...runner('trusted').labels, {
        name: LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2.sut
      }]
    }, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel
    })).toThrow('complete effective labels changed');
    const caseVaried = runner('trusted');
    caseVaried.labels = caseVaried.labels.map(({ name }) => ({ name: name.toUpperCase() }));
    expect(assertOwnedLocalGitHubActionsRunnerV2(caseVaried, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel,
      runnerId: 22
    })).toBe(22);
    expect(() => assertOwnedLocalGitHubActionsRunnerV2({
      ...runner('trusted'),
      labels: [...runner('trusted').labels, {
        name: LOCAL_GITHUB_ACTIONS_RUNNER_CUSTOM_LABEL_V1.toUpperCase()
      }]
    }, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel
    })).toThrow('duplicated case-insensitively');
    expect(() => assertOwnedLocalGitHubActionsRunnerV2({ ...runner('trusted'), os: 'Windows' }, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel
    })).toThrow('operating system identity changed');
  });

  test('requires exact immutable container IDs and names for all three roles', () => {
    const containers = roles.map((role) => container(role));
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers,
      instances,
      repository,
      providerName,
      operationLabel
    })).not.toThrow();
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers: containers.slice(0, 2),
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('missing, duplicated, or extra');
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers: [containers[0]!, containers[1]!, container('sut', { Id: 'f'.repeat(64) })],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('foreign eligible container');
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers: [containers[0]!, containers[1]!, container('sut', { Name: '/replacement-sut' })],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('retained name changed');
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers: [containers[0]!, containers[1]!, container('sut', { State: { Running: false } })],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('final readiness census is not running');
    const withoutInit = container('trusted');
    withoutInit.HostConfig.Init = false;
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainersV3({
      containers: [containers[0]!, withoutInit, containers[2]!],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('container capability boundary changed');
  });

  test('binds repository and every external effect to frozen endpoints and exact IDs', async () => {
    expect(assertRepositoryIdentityMatchesOriginV2(
      repository,
      'https://github.com/sec-platform/sec.git'
    )).toBe(repository);
    expect(assertRepositoryIdentityMatchesRemoteUrlsV2(
      repository,
      'git@github.com:sec-platform/sec.git',
      ['https://github.com/sec-platform/sec.git']
    )).toBe(repository);
    expect(() => assertRepositoryIdentityMatchesOriginV2(
      repository,
      'https://example.com/sec-platform/sec.git'
    )).toThrow('origin repository identity differs');

    const source = await Bun.file(
      new URL('../../scripts/codex/local-github-actions-runner.ts', import.meta.url)
    ).text();
    expect(source).toContain("'api', '--hostname', LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3");
    expect(source).toContain("['--host', dockerEndpointIdentity(endpoint).endpointHost, ...args]");
    expect(source).toContain("'auth', 'token', '--hostname', LOCAL_GITHUB_ACTIONS_GITHUB_HOST_V3");
    expect(source).toContain('githubToken: session.token');
    expect(source).toContain('childEnvironment.GH_TOKEN = options.githubToken');
    expect(source).not.toContain('environment?: Readonly<Record<string, string>>');
    expect(source).toContain("'run', '--detach', '--init', '--name', name");
    expect(source).toContain('host.Init !== true');
    expect(source).toContain('LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2');
    expect(source).toContain("'exec', '--interactive', containerId");
    expect(source).toContain("['rm', '--force', retained.containerId]");
    expect(source).toContain('assertExactLocalGitHubActionsRunnerProfileInventoryV3');
    expect(source).toContain('assertExactLocalGitHubActionsRunnerProfileContainersV3');
    expect(source).toContain('label=sec.local-runner.repository=${retainedRepository}');
    expect(source).not.toContain('label=sec.local-runner.schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3}');
    expect(source).toContain('advanceProviderLedgerV3');
    expect(source).toContain("['cat-file', 'commit', input.objectSha]");
    expect(source).toContain("'ls-tree', '--full-tree', '-z', input.objectSha");
    expect(source).not.toContain("input.objectSha, '--', 'provider-ledger.json'");
    expect(source).toContain("'mktree'");
    expect(source).toContain("['hash-object', '-t', 'commit', '-w', '--stdin']");
    expect(source).toContain("'fetch', '--no-tags', '--no-write-fetch-head', 'origin'");
    expect(source).toContain('assertLocalGitHubActionsProviderLedgerTransitionV3');
    expect(source).toContain('uncommitted GitHub runner residue exists without remote exact-ID authority');
    expect(source).toContain('uncommitted Docker container residue exists without remote exact-ID authority');
    expect(source).toContain('namedContainers.some((container) => container !== null)');
    expect(source).toContain("args.includes('--remove-image')");
    expect(source).toContain('active image retirement is not an ordinary stop authority');
    expect(source).toContain("command === 'retire-superseded-image'");
    expect(source).toContain("['image', 'rm', decision.imageId]");
    expect(source).toContain('image retirement is blocked while the provider ledger is active');
    expect(source).toContain('superseded image still has container references and is preserved');
    expect(source).not.toContain("['image', 'rm', LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1]");
    expect(source).not.toContain("['rm', '--force', retained.name]");
    expect(source).not.toContain('--unattended --replace');
    expect(source).not.toContain('/var/run/docker.sock');
    expect(source).not.toContain("['system', 'prune'");
    expect(source).not.toContain("['image', 'prune'");
    expect(source).not.toContain("['container', 'prune'");
    expect(source).not.toContain('sec-ephemeral-mainhealth-');
  });
});
