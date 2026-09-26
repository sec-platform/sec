import { describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../../src/adapters/providers/docker/contract/daemon.ts';
import { LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { acquirePhysicalMutationLease } from '../../src/adapters/runtime-state/physical/runtime/mutation-lease.ts';
import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import {
  assertExactLocalGitHubActionsRunnerProfileContainers,
  assertExactLocalGitHubActionsRunnerProfileInventory,
  assertLocalGitHubActionsRunnerImageIdentity,
  assertLocalGitHubActionsRunnerReplacementImageIdentity,
  assertOwnedLocalGitHubActionsRunner,
  assertRepositoryIdentityMatchesOrigin,
  assertRepositoryIdentityMatchesRemoteUrls,
  createBuildxRawJsonProgressAdmission,
  createLocalGitHubActionsRunnerBuildInputProjection,
  createLocalGitHubActionsRunnerDockerfile,
  createLocalGitHubActionsRunnerEnvironmentSpec,
  createLocalGitHubActionsRunnerOciBakeDefinition,
  createLocalGitHubActionsRunnerOciCandidateBinding,
  createLocalGitHubActionsRunnerProjectionBuildxArgs,
  createLocalGitHubActionsRunnerState,
  LOCAL_GITHUB_ACTIONS_RUNNER_CONFIGURED_MARKER,
  LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA,
  LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT,
  parseLocalGitHubActionsRunnerState,
  readValidatedRunnerOciLayoutIdentity,
  reconcileReclaimedLocalGitHubActionsRunnerOciCandidate,
  retireLocalGitHubActionsRunnerOciCandidate,
  type GitHubEndpointIdentity,
  type LocalGitHubActionsRunnerInstance,
  type LocalGitHubActionsRunnerRole
} from '../../src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts';

const repository = 'sec-platform/sec';
const providerName = 'sec-main-health-1';
const operationLabel = `sec-operation-${'b'.repeat(64)}`;
const roles = ['control', 'trusted', 'sut'] as const;
const environment = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;

function createOciFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runner-oci-'));
  const blobs = path.join(root, 'blobs', 'sha256');
  mkdirSync(blobs, { recursive: true });
  const add = (value: Uint8Array | Record<string, unknown>) => {
    const bytes = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(JSON.stringify(value), 'utf8');
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
    writeFileSync(path.join(blobs, digest.slice(7)), bytes);
    return Object.freeze({ digest, size: bytes.byteLength });
  };
  const config = add(Buffer.from('{}', 'utf8'));
  const layer = add(Buffer.from('runtime-layer', 'utf8'));
  const runtime = add({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', ...config },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', ...layer }]
  });
  const provenance = add(Buffer.from('{"_type":"https://in-toto.io/Statement/v1"}', 'utf8'));
  const attestation = add({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: 'application/vnd.docker.attestation.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.empty.v1+json', ...config, data: 'e30=' },
    layers: [{
      mediaType: 'application/vnd.in-toto+json',
      ...provenance,
      annotations: { 'in-toto.io/predicate-type': 'https://slsa.dev/provenance/v1' }
    }],
    subject: { mediaType: 'application/vnd.oci.image.manifest.v1+json', ...runtime }
  });
  const nested = add({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json', ...runtime,
        platform: { architecture: 'amd64', os: 'linux' }
      },
      {
        mediaType: 'application/vnd.oci.image.manifest.v1+json', ...attestation,
        annotations: {
          'vnd.docker.reference.digest': runtime.digest,
          'vnd.docker.reference.type': 'attestation-manifest'
        },
        platform: { architecture: 'unknown', os: 'unknown' }
      }
    ]
  });
  writeFileSync(path.join(root, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}\n');
  writeFileSync(path.join(root, 'index.json'), JSON.stringify({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.index.v1+json',
    manifests: [{ mediaType: 'application/vnd.oci.image.index.v1+json', ...nested }]
  }));
  return Object.freeze({ root, blobs, runtime, nested, layer, provenance, attestation });
}

const dockerEndpoint: DockerEndpointIdentity = createDockerEndpointIdentity({
  contextName: 'desktop-linux',
  endpointHost: 'npipe:////./pipe/dockerDesktopLinuxEngine',
  daemonId: '01234567-89ab-cdef-0123-456789abcdef',
  osType: 'linux',
  architecture: 'x86_64'
});

const githubEndpoint: GitHubEndpointIdentity = Object.freeze({
  schema: 'sec-github-api-endpoint-identity-v1',
  host: environment.provider.githubHost,
  repository,
  principal: 'maintainer'
});

const instances: readonly LocalGitHubActionsRunnerInstance[] = Object.freeze(
  roles.map((role, index) => Object.freeze({
    role,
    roleLabel: environment.runtime.roleLabels[role],
    name: `${providerName}-${role}`,
    runnerId: 21 + index,
    containerId: String.fromCharCode(97 + index).repeat(64),
    containerName: `${providerName}-${role}`
  }))
);

function runner(role: LocalGitHubActionsRunnerRole, overrides: Record<string, unknown> = {}) {
  const instance = instances.find((candidate) => candidate.role === role)!;
  return {
    id: instance.runnerId,
    name: instance.name,
    os: 'Linux',
    status: 'online',
    busy: false,
    labels: [
      ...environment.runtime.labels,
      environment.runtime.roleLabels[role],
      operationLabel
    ].map((name) => ({ name })),
    ...overrides
  };
}

function container(role: LocalGitHubActionsRunnerRole, overrides: Record<string, unknown> = {}) {
  const instance = instances.find((candidate) => candidate.role === role)!;
  const isSut = role === 'sut';
  const resources = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.runtime.resources[role];
  return {
    Id: instance.containerId,
    Name: `/${instance.name}`,
    Image: environment.image.dockerProjectionDigest,
    Config: {
      Entrypoint: ['/bin/bash'],
      Cmd: ['-ceu', LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT],
      Labels: {
        'sec.local-runner.schema': LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA,
        'sec.local-runner.repository': repository,
        'sec.local-runner.provider-name': providerName,
        'sec.local-runner.instance-name': instance.name,
        'sec.local-runner.role': role,
        'sec.local-runner.container-init': environment.runtime.containerInitCapability,
        'sec.local-runner.image-id': environment.image.dockerProjectionDigest,
        'sec.local-runner.operation-label': operationLabel
      }
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      Init: true,
      CapAdd: isSut
        ? CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outerSutContainerCapabilities
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

describe('local GitHub Actions runner contract', () => {
  test('pins the Linux provider toolchain and contains the SUT sandbox', () => {
    const authority = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
    const retiredImage = authority.image.retirements.find(({ imageTag }) =>
      imageTag.endsWith('-archive-v7'));
    expect(retiredImage).toBeDefined();
    expect(() => assertLocalGitHubActionsRunnerReplacementImageIdentity(
      { Id: retiredImage!.imageId },
      retiredImage!.imageId
    )).not.toThrow();
    expect(() => assertLocalGitHubActionsRunnerReplacementImageIdentity(
      { Id: authority.image.dockerProjectionDigest },
      retiredImage!.imageId
    )).toThrow('superseding frozen image identity differs from its decision');

    const dockerfile = createLocalGitHubActionsRunnerDockerfile();
    expect(dockerfile).toContain(`FROM ${authority.ubuntu.baseReference}`);
    expect(dockerfile).toContain(`ADD --checksum=${authority.archives.runner.digest}`);
    expect(dockerfile).toContain(`ADD --checksum=${authority.archives.node.digest}`);
    expect(dockerfile).toContain(
      `ADD --checksum=${authority.archives.githubCli.digest}`
    );
    expect(dockerfile).toContain(
      `gh_${authority.archives.githubCli.version}_linux_amd64/bin/gh`
    );
    expect(dockerfile).toContain(
      `grep -E '^gh version ${authority.archives.githubCli.version.replaceAll('.', '\\.')}`
    );
    expect(dockerfile).toContain(`ADD --chmod=0444 --checksum=${authority.archives.bootstrapCa.digest}`);
    expect(dockerfile).toContain(`ARG UBUNTU_SNAPSHOT=${authority.ubuntu.snapshot}`);
    expect(dockerfile).toContain('URIs: https://snapshot.ubuntu.com/ubuntu/${UBUNTU_SNAPSHOT}');
    expect(dockerfile).toContain('Acquire::https::CAInfo=/tmp/bootstrap-cacert.pem');
    expect(dockerfile).toContain('mount=type=cache,id=sec-ubuntu-noble-apt-cache-v1');
    expect(dockerfile).toContain('tar --no-same-owner -xzf /tmp/runner.tar.gz');
    expect(dockerfile).toContain('python3 unzip xz-utils');
    expect(dockerfile).toContain('command -v unzip >/dev/null');
    expect(dockerfile).toContain(`test "$(node --version)" = "v${authority.archives.node.version}"`);
    expect(dockerfile).toContain(`test "$(python3 --version)" = "Python ${authority.runtime.pythonVersion}"`);
    expect(dockerfile).toContain(
      `LABEL sec.local-runner.image-schema=${authority.image.lineageSchema}`
    );
    expect(dockerfile).not.toContain(
      `LABEL sec.local-runner.image-schema=${LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA}`
    );
    expect(dockerfile).not.toContain(':latest');
    expect(dockerfile).not.toContain('http://archive.ubuntu.com');
    expect(dockerfile).not.toContain('http://security.ubuntu.com');
    expect(dockerfile).not.toContain('Verify-Peer');
    expect(dockerfile).not.toContain('curl -');
    expect(dockerfile).not.toMatch(/apt-get install[^\n]*\bnodejs\b/u);

    const environmentSpec = createLocalGitHubActionsRunnerEnvironmentSpec();
    expect(environmentSpec.providerRequirement)
      .toBe(LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.provider.requirement);
    expect(environmentSpec.components.map(({ id }) => id)).toEqual([
      'authority-input-closure', 'base-image', 'bootstrap-ca-bundle', 'dockerfile-frontend',
      'github-cli', 'node', 'runner', 'runner-build-input-closure'
    ]);

    const ociBake = JSON.parse(createLocalGitHubActionsRunnerOciBakeDefinition('D:\\cache\\candidate'));
    const buildInputProjection = createLocalGitHubActionsRunnerBuildInputProjection();
    expect(JSON.stringify(buildInputProjection)).toContain('<candidate-layout>');
    expect(JSON.stringify(buildInputProjection)).toContain('<layout>');
    expect(JSON.stringify(buildInputProjection)).toContain(
      authority.image.runtimeContentDigest
    );
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
    const providerLayoutPath = path.resolve('cache', 'layout');
    const projectionArgs = createLocalGitHubActionsRunnerProjectionBuildxArgs(providerLayoutPath);
    expect(projectionArgs).toContain(
      `runtime=oci-layout://${providerLayoutPath.split(path.sep).join('/')}@`
        + authority.image.runtimeContentDigest
    );
    expect(projectionArgs).toContain('type=docker');
    expect(projectionArgs).toContain('--provenance=false');

    const frozenImage = {
      Id: authority.image.dockerProjectionDigest,
      Config: { Labels: {
        'sec.local-runner.image-schema': authority.image.lineageSchema,
        'sec.local-runner.image-revision': authority.image.buildRevision,
        'sec.local-runner.runner-version': authority.archives.runner.version,
        'sec.local-runner.node-version': authority.archives.node.version,
        'sec.local-runner.node-archive-sha256': authority.archives.node.digest.slice(7),
        'sec.local-runner.github-cli-version': authority.archives.githubCli.version,
        'sec.local-runner.github-cli-archive-sha256':
          authority.archives.githubCli.digest.slice(7),
        'sec.local-runner.python-version': authority.runtime.pythonVersion,
        'sec.local-runner.ubuntu-snapshot': authority.ubuntu.snapshot,
        'sec.local-runner.bootstrap-ca-bundle-sha256':
          authority.archives.bootstrapCa.digest.slice(7),
        'sec.local-runner.dockerfile-frontend': authority.provider.dockerfileFrontend.reference
      } }
    } as const;
    expect(() => assertLocalGitHubActionsRunnerImageIdentity(frozenImage)).not.toThrow();
    expect(() => assertLocalGitHubActionsRunnerImageIdentity({
      ...frozenImage,
      Config: { Labels: {
        ...frozenImage.Config.Labels,
        'sec.local-runner.image-schema': LOCAL_GITHUB_ACTIONS_RUNNER_STATE_SCHEMA
      } }
    })).toThrow('cached runner image labels differ from the frozen provider revision');
    expect(() => assertLocalGitHubActionsRunnerImageIdentity({
      ...frozenImage,
      Id: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    })).toThrow('cached runner image ID differs from the frozen provider revision');
    for (const [label, value] of [
      ['sec.local-runner.github-cli-version', '2.96.0'],
      ['sec.local-runner.github-cli-archive-sha256', 'f'.repeat(64)]
    ] as const) {
      expect(() => assertLocalGitHubActionsRunnerImageIdentity({
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
      expect(() => assertLocalGitHubActionsRunnerImageIdentity({
        ...frozenImage,
        Config: { Labels: labels }
      })).toThrow('cached runner image labels differ from the frozen provider revision');
    }
  });

  test('admits only monotonic structured BuildKit progress', () => {
    const progress = createBuildxRawJsonProgressAdmission();
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
    expect(progress.push(Buffer.from(`${JSON.stringify({
      logs: [{ vertex: digest, data: 'presentation chatter' }]
    })}\n`))).toBe(false);
    const unknownVertexStatus = JSON.stringify({
      statuses: [{ id: 'download', vertex: `sha256:${'b'.repeat(64)}`, current: 1 }]
    });
    expect(progress.push(Buffer.from(`${unknownVertexStatus}\n`))).toBe(false);
    expect(progress.push(Buffer.from(`${JSON.stringify({
      statuses: [{ id: 'random-id-does-not-advance', vertex: digest, current: 2 }]
    })}\n`))).toBe(false);
    expect(progress.push(Buffer.from(`${JSON.stringify({
      statuses: [{ id: 'random-id-advances', vertex: digest, current: 3 }]
    })}\n`))).toBe(true);
    expect(progress.push(Buffer.from(`${JSON.stringify({
      statuses: [{ id: 'first-completion', vertex: digest, current: 3, completed: 'now' }]
    })}\n`))).toBe(true);
    expect(progress.push(Buffer.from(`${JSON.stringify({
      statuses: [{ id: 'second-completion', vertex: digest, current: 3, completed: 'later' }]
    })}\n`))).toBe(false);
    expect(progress.push(Buffer.from('presentation output\n'))).toBe(false);
  });

  test('recursively validates the complete OCI runtime and provenance closure', () => {
    const fixture = createOciFixture();
    try {
      expect(readValidatedRunnerOciLayoutIdentity(
        fixture.root, fixture.runtime.digest
      )).toBe(fixture.nested.digest);
      writeFileSync(path.join(fixture.blobs, fixture.layer.digest.slice(7)), 'corrupt-layer');
      expect(() => readValidatedRunnerOciLayoutIdentity(
        fixture.root, fixture.runtime.digest
      )).toThrow('runtime layer 0 blob identity is invalid');
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }

    const missingProvenance = createOciFixture();
    try {
      unlinkSync(path.join(missingProvenance.blobs, missingProvenance.provenance.digest.slice(7)));
      expect(() => readValidatedRunnerOciLayoutIdentity(
        missingProvenance.root, missingProvenance.runtime.digest
      )).toThrow('provenance layer blob identity is invalid');
    } finally {
      rmSync(missingProvenance.root, { recursive: true, force: true });
    }
  });

  test('leases candidate generations, protects live owners, and retires abandoned bytes no-follow', () => {
    const specDigest = createLocalGitHubActionsRunnerEnvironmentSpec().specDigest;
    const root = mkdtempSync(path.join(tmpdir(), 'sec-runner-candidate-'));
    const generationPath = path.join(root, specDigest.slice(7));
    mkdirSync(generationPath);
    const directory = inspectNoFollowDirectoryChain(
      generationPath, 'Runner OCI candidate lifecycle fixture'
    ).target;
    const oldLease = acquirePhysicalMutationLease(directory, 'materialization-lease.json', {
      now: () => 1_000,
      ownerHost: 'candidate-test-host',
      ownerPid: 41_001,
      processNonce: randomUUID(),
      processAlive: () => 'alive'
    });
    expect(oldLease).not.toBeNull();
    const oldBinding = createLocalGitHubActionsRunnerOciCandidateBinding(
      specDigest, oldLease!.owner
    );
    const oldCandidatePath = path.join(generationPath, oldBinding.candidateName);
    mkdirSync(path.join(oldCandidatePath, 'partial', 'nested'), { recursive: true });
    writeFileSync(path.join(oldCandidatePath, 'partial', 'nested', 'layer'), 'partial-build-output');

    const blocked = acquirePhysicalMutationLease(directory, 'materialization-lease.json', {
      now: () => 2_000,
      ownerHost: 'candidate-test-host',
      ownerPid: 41_002,
      processNonce: randomUUID(),
      processAlive: () => 'alive'
    });
    expect(blocked).toBeNull();
    expect(existsSync(oldCandidatePath)).toBe(true);

    const successor = acquirePhysicalMutationLease(directory, 'materialization-lease.json', {
      now: () => 3_000,
      ownerHost: 'candidate-test-host',
      ownerPid: 41_003,
      processNonce: randomUUID(),
      processAlive: (pid) => pid === oldLease!.owner.pid ? 'dead' : 'alive'
    });
    expect(successor).not.toBeNull();
    expect(successor!.reclaimedOwner).toEqual(oldLease!.owner);
    expect(reconcileReclaimedLocalGitHubActionsRunnerOciCandidate({
      directory,
      specDigest,
      owner: successor!.reclaimedOwner!
    })).toBe('retired-invalid');
    expect(existsSync(oldCandidatePath)).toBe(false);

    successor!.acknowledgeReclaimedRecovery();
    const currentBinding = createLocalGitHubActionsRunnerOciCandidateBinding(
      specDigest, successor!.owner
    );
    const currentCandidatePath = path.join(generationPath, currentBinding.candidateName);
    mkdirSync(path.join(currentCandidatePath, 'failed-validation'), { recursive: true });
    writeFileSync(path.join(currentCandidatePath, 'failed-validation', 'blob'), 'invalid');
    retireLocalGitHubActionsRunnerOciCandidate(directory, currentBinding);
    expect(existsSync(currentCandidatePath)).toBe(false);
    successor!.release();
    rmSync(root, { recursive: true, force: true });
  });

  test('local durable state owns lifecycle and retains every destructive identity', () => {
    const provisioning = createLocalGitHubActionsRunnerState({
      repository,
      repositoryRoot: 'D:/Project/sec',
      commonDirectory: 'D:/Project/sec/.git',
      providerName,
      operationLabel,
      lifecycle: 'provisioning',
      dockerEndpoint,
      githubEndpoint,
      instances: roles.map((role) => ({
        role,
        roleLabel: environment.runtime.roleLabels[role],
        name: `${providerName}-${role}`,
        containerId: null,
        containerState: 'uncreated' as const,
        runnerId: null,
        runnerState: 'uncreated' as const
      })),
      startedAt: '2026-08-14T08:00:00.000Z'
    });
    expect(parseLocalGitHubActionsRunnerState(JSON.stringify(provisioning))).toEqual(provisioning);
    const state = createLocalGitHubActionsRunnerState({
      repository,
      repositoryRoot: 'D:/Project/sec',
      commonDirectory: 'D:/Project/sec/.git',
      providerName,
      operationLabel,
      lifecycle: 'active',
      dockerEndpoint,
      githubEndpoint,
      instances: instances.map((instance) => ({
        role: instance.role,
        roleLabel: instance.roleLabel,
        name: instance.name,
        containerId: instance.containerId,
        containerState: 'present' as const,
        runnerId: instance.runnerId,
        runnerState: 'present' as const
      })),
      startedAt: '2026-08-14T08:00:00.000Z'
    });
    expect(parseLocalGitHubActionsRunnerState(JSON.stringify(state))).toEqual(state);
    expect(() => parseLocalGitHubActionsRunnerState(JSON.stringify({
      ...state,
      githubEndpoint: { ...state.githubEndpoint, principal: 'Attacker' }
    }))).toThrow('digest mismatch');
    expect(() => parseLocalGitHubActionsRunnerState(JSON.stringify({ ...state, token: 'secret' })))
      .toThrow('keys are invalid');
    expect(JSON.stringify(state)).not.toContain('token');
    expect(() => createLocalGitHubActionsRunnerState({
      ...state,
      lifecycle: 'active',
      instances: state.instances.map((instance) => instance.role === 'control'
        ? { ...instance, runnerState: 'uncreated' as const, runnerId: null }
        : instance)
    })).toThrow('active runner state is incomplete');
    const terminal = createLocalGitHubActionsRunnerState({
      ...state,
      lifecycle: 'terminal',
      instances: state.instances.map((instance) => ({
        ...instance,
        runnerState: 'absent' as const,
        containerState: 'absent' as const
      }))
    });
    expect(terminal.instances.map(({ runnerId, containerId }) => ({ runnerId, containerId })))
      .toEqual(instances.map(({ runnerId, containerId }) => ({ runnerId, containerId })));
    expect(() => createLocalGitHubActionsRunnerState({
      ...terminal,
      instances: terminal.instances.map((instance) => instance.role === 'trusted'
        ? { ...instance, containerState: 'present' as const, runnerState: 'present' as const }
        : instance)
    })).toThrow('terminal runner state retains resources');
  });

  test('requires one exact runner identity for every trust role', () => {
    const runners = roles.map((role) => runner(role));
    expect(assertOwnedLocalGitHubActionsRunner(runners[1]!, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel,
      runnerId: 22,
      requireIdleForRemoval: true
    })).toBe(22);
    const missingBusy: Record<string, unknown> = { ...runner('trusted') };
    Reflect.deleteProperty(missingBusy, 'busy');
    for (const candidate of [
      missingBusy,
      runner('trusted', { busy: null }),
      runner('trusted', { busy: 'false' }),
      runner('trusted', { busy: true })
    ]) {
      expect(() => assertOwnedLocalGitHubActionsRunner(candidate, {
        name: `${providerName}-trusted`,
        role: 'trusted',
        operationLabel,
        runnerId: 22,
        requireIdleForRemoval: true
      })).toThrow('busy state must be exact false before cleanup');
    }
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventory({
      runners,
      instances,
      operationLabel
    })).not.toThrow();
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventory({
      runners: runners.slice(0, 2),
      instances,
      operationLabel
    })).toThrow('missing, duplicated, or extra');
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventory({
      runners: [...runners, runner('sut', { id: 99, name: 'foreign-sut' })],
      instances,
      operationLabel
    })).toThrow('missing, duplicated, or extra');
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventory({
      runners: [runners[0]!, runner('trusted', { status: 'offline' }), runners[2]!],
      instances,
      operationLabel
    })).toThrow('final readiness census is not online');
    expect(() => assertExactLocalGitHubActionsRunnerProfileInventory({
      runners: [runners[0]!, runner('trusted', { busy: true }), runners[2]!],
      instances,
      operationLabel
    })).not.toThrow();
    expect(() => assertOwnedLocalGitHubActionsRunner({
      ...runner('trusted'),
      labels: [...runner('trusted').labels, {
        name: environment.runtime.roleLabels.sut
      }]
    }, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel
    })).toThrow('complete effective labels changed');
    const caseVaried = runner('trusted');
    caseVaried.labels = caseVaried.labels.map(({ name }) => ({ name: name.toUpperCase() }));
    expect(assertOwnedLocalGitHubActionsRunner(caseVaried, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel,
      runnerId: 22
    })).toBe(22);
    expect(() => assertOwnedLocalGitHubActionsRunner({
      ...runner('trusted'),
      labels: [...runner('trusted').labels, {
        name: environment.runtime.labels[3].toUpperCase()
      }]
    }, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel
    })).toThrow('duplicated case-insensitively');
    expect(() => assertOwnedLocalGitHubActionsRunner({ ...runner('trusted'), os: 'Windows' }, {
      name: `${providerName}-trusted`,
      role: 'trusted',
      operationLabel
    })).toThrow('operating system identity changed');
  });

  test('requires exact immutable container IDs and names for all three roles', () => {
    const containers = roles.map((role) => container(role));
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers,
      instances,
      repository,
      providerName,
      operationLabel
    })).not.toThrow();
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: containers.slice(0, 2),
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('missing, duplicated, or extra');
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: [containers[0]!, containers[1]!, container('sut', { Id: 'f'.repeat(64) })],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('foreign eligible container');
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: [containers[0]!, containers[1]!, container('sut', { Name: '/replacement-sut' })],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('retained name changed');
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: [containers[0]!, containers[1]!, container('sut', { State: { Running: false } })],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('final readiness census is not running');
    const withoutInit = container('trusted');
    withoutInit.HostConfig.Init = false;
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: [containers[0]!, withoutInit, containers[2]!],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('container capability boundary changed');
    const withoutRestart = container('trusted');
    withoutRestart.HostConfig.RestartPolicy = { Name: 'no', MaximumRetryCount: 0 };
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: [containers[0]!, withoutRestart, containers[2]!],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('container restart policy changed');
    const detachedRunner = container('trusted');
    detachedRunner.Config.Entrypoint = ['/usr/bin/sleep'];
    detachedRunner.Config.Cmd = ['infinity'];
    expect(() => assertExactLocalGitHubActionsRunnerProfileContainers({
      containers: [containers[0]!, detachedRunner, containers[2]!],
      instances,
      repository,
      providerName,
      operationLabel
    })).toThrow('container runner supervisor boundary changed');
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT).toContain(
      LOCAL_GITHUB_ACTIONS_RUNNER_CONFIGURED_MARKER
    );
    expect(LOCAL_GITHUB_ACTIONS_RUNNER_SUPERVISOR_SCRIPT).toContain('exec ./run.sh');
  });

  test('binds repository and every external effect to frozen endpoints and exact IDs', async () => {
    expect(assertRepositoryIdentityMatchesOrigin(
      repository,
      'https://github.com/sec-platform/sec.git'
    )).toBe(repository);
    expect(assertRepositoryIdentityMatchesRemoteUrls(
      repository,
      'git@github.com:sec-platform/sec.git',
      ['https://github.com/sec-platform/sec.git']
    )).toBe(repository);
    expect(() => assertRepositoryIdentityMatchesOrigin(
      repository,
      'https://example.com/sec-platform/sec.git'
    )).toThrow('origin repository identity differs');
  });

});
