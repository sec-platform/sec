import { describe, expect, test } from 'bun:test';

import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1 } from '../../platform/shared/ci-verification-revision.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1 } from '../../platform/shared/sec-linux-verification-environment.ts';
import {
  assertExactLocalGitHubActionsRunnerProfileContainersV3,
  assertExactLocalGitHubActionsRunnerProfileInventoryV3,
  assertInitialLocalGitHubActionsProviderLedgerV3,
  assertLocalGitHubActionsProviderLedgerTransitionV3,
  assertLocalGitHubActionsRunnerImageIdentityV1,
  assertLocalGitHubActionsRunnerReplacementImageIdentityV3,
  assertOwnedLocalGitHubActionsRunnerV2,
  assertRepositoryIdentityMatchesOriginV2,
  assertRepositoryIdentityMatchesRemoteUrlsV2,
  createBuildxRawJsonProgressAdmissionV1,
  createLocalGitHubActionsProviderLedgerCommitBytesV3,
  createLocalGitHubActionsProviderLedgerV3,
  createLocalGitHubActionsRunnerDockerfileV2,
  createLocalGitHubActionsRunnerEnvironmentSpecV1,
  createLocalGitHubActionsRunnerOciBakeDefinitionV1,
  createLocalGitHubActionsRunnerProjectionBuildxArgsV1,
  createLocalGitHubActionsRunnerStateV3,
  LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256_V1,
  LOCAL_GITHUB_ACTIONS_DOCKER_COMMAND_ENV_KEYS_V1,
  LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND_V1,
  LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1,
  LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1,
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
  LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_ROLE_LABELS_V2,
  LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA_V3,
  LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1,
  LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3,
  LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1,
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
  const resources = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1.runtime.resources[role];
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
      PidsLimit: resources.pids,
      Memory: resources.memoryGiB * 1024 * 1024 * 1024,
      NanoCpus: resources.cpus * 1_000_000_000
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
    const authority = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1;
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1).toBe(authority.archives.runner.version);
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1)
      .toBe(authority.archives.runner.digest.slice(7));
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1).toBe(authority.ubuntu.baseReference);
    expect(LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1).toBe(authority.archives.node.version);
    expect(LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1)
      .toBe(authority.archives.node.digest.slice(7));
    expect(LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1).toBe(authority.runtime.pythonVersion);
    expect(LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1).toBe(authority.archives.githubCli.version);
    expect(LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1)
      .toBe(authority.archives.githubCli.digest.slice(7));
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2)
      .toBe(authority.image.buildRevision);
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1).toBe(authority.image.lineageSchema);
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_V1)
      .toBe(`${authority.image.name}:${authority.archives.runner.version}-${authority.image.buildRevision}`);
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1)
      .toBe(authority.image.runtimeContentDigest);
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2)
      .toBe(authority.image.dockerProjectionDigest);
    expect(LOCAL_GITHUB_ACTIONS_DOCKER_COMMAND_ENV_KEYS_V1).toContain('PROGRAMFILES');
    expect(LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3.map(({ imageId }) => imageId))
      .toEqual(authority.image.retirements.map(({ imageId }) => imageId));
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1).toBe(
      'sha256:a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf'
    );
    expect(LOCAL_GITHUB_ACTIONS_SUPERSEDED_IMAGE_RETIREMENTS_V3.map(
      ({ replacementImageId }) => replacementImageId
    )).toEqual(authority.image.retirements.map(({ replacementImageId }) => replacementImageId));
    expect(() => assertLocalGitHubActionsRunnerReplacementImageIdentityV3(
      { Id: LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1 },
      LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1
    )).not.toThrow();
    expect(() => assertLocalGitHubActionsRunnerReplacementImageIdentityV3(
      { Id: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2 },
      LOCAL_GITHUB_ACTIONS_RUNNER_RETIRED_V7_IMAGE_ID_V1
    )).toThrow('superseding frozen image identity differs from its decision');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_LABELS_V1).toEqual([
      'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1'
    ]);

    const dockerfile = createLocalGitHubActionsRunnerDockerfileV2();
    expect(dockerfile).toContain(`FROM ${LOCAL_GITHUB_ACTIONS_RUNNER_BASE_IMAGE_V1}`);
    expect(dockerfile).toContain(`ADD --checksum=sha256:${LOCAL_GITHUB_ACTIONS_RUNNER_ARCHIVE_SHA256_V1}`);
    expect(dockerfile).toContain(`ADD --checksum=sha256:${LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1}`);
    expect(dockerfile).toContain(
      `ADD --checksum=sha256:${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1}`
    );
    expect(dockerfile).toContain(
      `gh_${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1}_linux_amd64/bin/gh`
    );
    expect(dockerfile).toContain(
      `grep -E '^gh version ${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1.replaceAll('.', '\\.')}`
    );
    expect(dockerfile).toContain(`ADD --chmod=0444 --checksum=sha256:${LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256_V1}`);
    expect(dockerfile).toContain(`ARG UBUNTU_SNAPSHOT=${LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1}`);
    expect(dockerfile).toContain('URIs: https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}');
    expect(dockerfile).toContain('Acquire::https::CAInfo=/tmp/bootstrap-cacert.pem');
    expect(dockerfile).toContain('mount=type=cache,id=sec-ubuntu-noble-apt-cache-v1');
    expect(dockerfile).toContain('tar --no-same-owner -xzf /tmp/runner.tar.gz');
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
    expect(dockerfile).not.toContain('http://archive.ubuntu.com');
    expect(dockerfile).not.toContain('http://security.ubuntu.com');
    expect(dockerfile).not.toContain('Verify-Peer');
    expect(dockerfile).not.toContain('curl -');
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bnodejs\b/u);

    const environmentSpec = createLocalGitHubActionsRunnerEnvironmentSpecV1();
    expect(environmentSpec.providerRequirement)
      .toBe(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY_V1.provider.requirement);
    expect(environmentSpec.components.map(({ id }) => id)).toEqual([
      'base-image', 'bootstrap-ca-bundle', 'dockerfile-frontend', 'github-cli', 'node', 'runner'
    ]);

    const ociBake = JSON.parse(createLocalGitHubActionsRunnerOciBakeDefinitionV1('D:\\cache\\candidate'));
    expect(ociBake.group.default.targets).toEqual(['runner-oci']);
    expect(ociBake.target['runner-oci'].attest).toEqual(['type=provenance,mode=max']);
    expect(ociBake.target['runner-oci'].output[0]).toContain('type=oci');
    const bakeDockerfile = ociBake.target['runner-oci']['dockerfile-inline'] as string;
    expect(bakeDockerfile).toBe(dockerfile.replaceAll('${', () => '$${'));
    expect(bakeDockerfile).toContain('$${UBUNTU_SNAPSHOT}');
    expect(bakeDockerfile).toContain('$${Package}=$${Version}');
    expect(bakeDockerfile).toContain('$(stat -c %a /tmp/bootstrap-cacert.pem)');
    expect(bakeDockerfile).toContain('$(python3 --version)');
    expect(bakeDockerfile).toContain('$(node --version)');
    expect(bakeDockerfile).not.toContain('$$(stat');
    expect(bakeDockerfile).not.toContain('$$(python3');
    expect(bakeDockerfile).not.toContain('$$(node');
    expect(bakeDockerfile).not.toContain('$$UBUNTU_SNAPSHOT');
    const projectionArgs = createLocalGitHubActionsRunnerProjectionBuildxArgsV1(
      'D:\\cache\\layout'
    );
    expect(projectionArgs).toContain(
      `runtime=oci-layout://D:/cache/layout@${LOCAL_GITHUB_ACTIONS_RUNNER_OCI_RUNTIME_MANIFEST_DIGEST_V1}`
    );
    expect(projectionArgs).toContain('type=docker');
    expect(projectionArgs).toContain('--provenance=false');

    const frozenImage = {
      Id: LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2,
      Config: { Labels: {
        'sec.local-runner.image-schema': LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_SCHEMA_V1,
        'sec.local-runner.image-revision': LOCAL_GITHUB_ACTIONS_RUNNER_IMAGE_BUILD_REVISION_V2,
        'sec.local-runner.runner-version': LOCAL_GITHUB_ACTIONS_RUNNER_VERSION_V1,
        'sec.local-runner.node-version': LOCAL_GITHUB_ACTIONS_NODE_VERSION_V1,
        'sec.local-runner.node-archive-sha256': LOCAL_GITHUB_ACTIONS_NODE_ARCHIVE_SHA256_V1,
        'sec.local-runner.github-cli-version': LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1,
        'sec.local-runner.github-cli-archive-sha256':
          LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1,
        'sec.local-runner.python-version': LOCAL_GITHUB_ACTIONS_PYTHON_VERSION_V1,
        'sec.local-runner.ubuntu-snapshot': LOCAL_GITHUB_ACTIONS_UBUNTU_SNAPSHOT_V1,
        'sec.local-runner.bootstrap-ca-bundle-sha256':
          LOCAL_GITHUB_ACTIONS_BOOTSTRAP_CA_BUNDLE_SHA256_V1,
        'sec.local-runner.dockerfile-frontend': LOCAL_GITHUB_ACTIONS_DOCKERFILE_FRONTEND_V1
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
    for (const [label, value] of [
      ['sec.local-runner.github-cli-version', '2.96.0'],
      ['sec.local-runner.github-cli-archive-sha256', 'f'.repeat(64)]
    ] as const) {
      expect(() => assertLocalGitHubActionsRunnerImageIdentityV1({
        ...frozenImage,
        Config: { Labels: { ...frozenImage.Config.Labels, [label]: value } }
      })).toThrow('cached runner image labels differ from the frozen provider revision');
    }
    for (const label of [
      'sec.local-runner.image-revision',
      'sec.local-runner.runner-version',
      'sec.local-runner.node-version',
      'sec.local-runner.node-archive-sha256',
      'sec.local-runner.github-cli-version',
      'sec.local-runner.github-cli-archive-sha256',
      'sec.local-runner.python-version',
      'sec.local-runner.ubuntu-snapshot',
      'sec.local-runner.bootstrap-ca-bundle-sha256',
      'sec.local-runner.dockerfile-frontend'
    ] as const) {
      const labels = { ...frozenImage.Config.Labels } as Record<string, string>;
      delete labels[label];
      expect(() => assertLocalGitHubActionsRunnerImageIdentityV1({
        ...frozenImage,
        Config: { Labels: labels }
      })).toThrow('cached runner image labels differ from the frozen provider revision');
    }
  });

  test('admits only monotonic structured BuildKit progress', () => {
    const progress = createBuildxRawJsonProgressAdmissionV1();
    const digest = `sha256:${'a'.repeat(64)}`;
    const vertex = JSON.stringify({ vertexes: [{ digest, name: 'build' }] });
    expect(progress.push(Buffer.from(vertex.slice(0, 20)))).toBe(false);
    expect(progress.push(Buffer.from(`${vertex.slice(20)}\n`))).toBe(true);
    expect(progress.push(Buffer.from(`${vertex}\n`))).toBe(false);
    const status = (current: number) => `${JSON.stringify({
      statuses: [{ id: 'download', vertex: digest, current }]
    })}\n`;
    expect(progress.push(Buffer.from(status(1)))).toBe(true);
    expect(progress.push(Buffer.from(status(1)))).toBe(false);
    expect(progress.push(Buffer.from(status(2)))).toBe(true);
    expect(progress.push(Buffer.from('presentation output\n'))).toBe(false);
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
  });
});
