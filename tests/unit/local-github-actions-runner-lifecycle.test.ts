import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createDockerEndpointIdentity } from '../../src/adapters/providers/docker/contract/daemon.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY as environment } from '../../src/adapters/providers/linux-verification/contract.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

// Exercise retired-start rejection plus real legacy recovery/stop and durable state.
// Provider transport and capability settlement are deterministic boundaries here;
// these tests do not issue credentials, operate Docker, or prove real API effects.
const semantic = await import('../../src/execution/operation/semantic.ts');
mock.module('../../src/execution/operation/semantic.ts', () => ({
  ...semantic,
  bindSecSemanticOperation: () => ({}),
  compileSecCapabilityBinding: () => ({}),
  compileSecProviderSettlementSet: () => ({}),
  compileSecSemanticOperationPlan: () => ({}),
  issueSecNormalDomainReadbackReceipt: () => ({}),
  issueSecNormalOwnerTerminalJoinReceipt: () => ({}),
  issueSecSemanticOperationAttemptContext: () => ({})
}));
const physical = await import('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts');
const replaceDurableFile = physical.replaceDurableCanonicalFile;
const recoverDurableFile = physical.recoverDurableCanonicalFileReplacement;
mock.module('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', () => ({
  ...physical,
  recoverDurableCanonicalFileReplacement: (input: Parameters<typeof recoverDurableFile>[0]) => {
    if (input.name === 'state.json') {
      events.push('recover-state');
      expect(existsSync(path.join(input.parent.path, 'lifecycle-lease.json'))).toBe(true);
      if (pendingState !== null) {
        expect(input.parent.path).toBe(path.dirname(statePath()));
        const kind = pendingState;
        if (kind === 'quarantined') renameSync(pendingPath(), statePath());
        else unlinkSync(pendingPath());
        pendingState = null;
        return { status: kind === 'quarantined' ? 'rolled-back' : 'completed', digest: null, physical: null };
      }
    }
    return recoverDurableFile(input);
  },
  replaceDurableCanonicalFile: (input: Parameters<typeof replaceDurableFile>[0]) => {
    if (input.name === 'state.json') {
      expect(input.expectedExistingBytes).toEqual(readFileSync(path.join(input.parent.path, input.name)));
    }
    replaceDurableFile(input);
    const state = JSON.parse(Buffer.from(input.bytes).toString('utf8')) as { lifecycle?: string };
    if (state.lifecycle !== undefined) events.push(`durable:${state.lifecycle}`);
  }
}));

const endpoint = createDockerEndpointIdentity({
  contextName: 'test-linux', endpointHost: 'unix:///var/run/docker.sock',
  daemonId: 'fixture-daemon', osType: 'linux', architecture: 'x86_64'
});
const digest = `sha256:${'a'.repeat(64)}`;
let root: string;
let events: string[];
let boundaryEntries: string[];
let failRelease: string | null;
let loseReleaseResponse: string | null;
let pendingState: 'quarantined' | 'installed' | null;
let loseLabelResponse: string | null;
interface Runner {
  id: number; name: string; os: string; status: string; busy: boolean;
  labels: Array<{ name: string }>;
}
interface Container {
  Id: string; Name: string; Image: string;
  Config: { Entrypoint: string[]; Cmd: string[]; Labels: Record<string, string> };
  HostConfig: {
    RestartPolicy: { Name: string; MaximumRetryCount: number }; Init: boolean;
    CapAdd: string[]; CapDrop: string[]; SecurityOpt: string[]; Privileged: boolean;
    Binds: null; PidsLimit: number; Memory: number; NanoCpus: number;
  };
  State: { Running: boolean };
}
let runners: Runner[];
let containers: Container[];
let released: Set<string>;
const statePath = () => path.join(root, '.git', 'sec-local-actions-runner', 'state.json');
const pendingPath = () => path.join(path.dirname(statePath()), 'pending-state-transaction.fixture');
function interruptReplacement(kind: 'quarantined' | 'installed') {
  // A deterministic boundary fixture, not fabricated native Windows evidence.
  // The durable-file owner's recovery result is injected; the lifecycle must
  // invoke it under lease before reading, rather than interpreting absence.
  pendingState = kind;
  if (kind === 'quarantined') renameSync(statePath(), pendingPath());
  else {
    const material = JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, unknown>;
    Reflect.deleteProperty(material, 'stateDigest'); material.lifecycle = 'teardown';
    writeFileSync(statePath(), JSON.stringify({ ...material, stateDigest: sha256(material) }, null, 2) + '\n');
    writeFileSync(pendingPath(), 'installed-candidate-awaits-owner-recovery');
  }
}
const durableState = () => JSON.parse(readFileSync(statePath(), 'utf8')) as {
  lifecycle: string; resources?: { cpus: number; memory: string }; instances: Array<{ runnerId: number }>;
};
const stdout = (value: unknown) => ({
  code: 0, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.alloc(0)
});

mock.module('../../src/adapters/providers/git-read/authority.ts', () => ({
  withAuthorityGitReadSession: async (_input: unknown, operation: (session: object) => unknown) => {
    boundaryEntries.push('git-read-session');
    return await operation({});
  }
}));
mock.module('../../src/adapters/self-hosting/development/tooling/git/git-read.ts', () => ({
  GIT_READ_OPERATION_BUDGET: {},
  gitReadText: async (_session: unknown, args: readonly string[]) => args.includes('--show-toplevel') ? root
    : args.includes('--git-common-dir') ? path.join(root, '.git') : 'https://github.com/sec-platform/sec.git'
}));
mock.module('../../src/adapters/providers/docker/runtime/windows-command-provider.ts', () => ({
  openWindowsDockerCommandProvider: async () => {
    boundaryEntries.push('docker-provider');
    return { providerIdentityDigest: digest };
  }
}));
mock.module('../../src/adapters/providers/docker/runtime/container-engine-session.ts', () => ({
  openContainerEngineSession: async () => {
    boundaryEntries.push('docker-session');
    return ({
    endpoint, providerIdentityDigest: digest, deadlineAtUnixMs: Date.now() + 60_000,
    openOperationScope: () => ({ settle: () => ({ physicalDisposition: 'settled' }) }),
    observeEndpoint: async () => endpoint, close: () => undefined,
    execute: async (operation: { kind: string; arguments: readonly string[] }) => {
      const args = operation.arguments;
      switch (operation.kind) {
        case 'image-list': return stdout(environment.image.dockerProjectionDigest);
        case 'image-inspect': return stdout([{
          Id: environment.image.dockerProjectionDigest,
          Config: { Labels: {
            'sec.local-runner.image-schema': environment.image.lineageSchema,
            'sec.local-runner.image-revision': environment.image.buildRevision,
            'sec.local-runner.runner-version': environment.archives.runner.version,
            'sec.local-runner.node-version': environment.archives.node.version,
            'sec.local-runner.node-archive-sha256': environment.archives.node.digest.slice(7),
            'sec.local-runner.github-cli-version': environment.archives.githubCli.version,
            'sec.local-runner.github-cli-archive-sha256': environment.archives.githubCli.digest.slice(7),
            'sec.local-runner.python-version': environment.runtime.pythonVersion,
            'sec.local-runner.ubuntu-snapshot': environment.ubuntu.snapshot,
            'sec.local-runner.bootstrap-ca-bundle-sha256': environment.archives.bootstrapCa.digest.slice(7),
            'sec.local-runner.dockerfile-frontend': environment.provider.dockerfileFrontend.reference
          } }
        }]);
        case 'container-list': return stdout(containers.map((container) => `${container.Id}\t${container.Name.slice(1)}`).join('\n'));
        case 'container-inspect': return stdout(containers.filter((container) => container.Id === args[0]));
        case 'container-exec': {
          const container = containers.find((entry) => args.includes(entry.Id))!;
          const role = container.Config.Labels['sec.local-runner.role']!;
          const script = args.at(-1)!;
          if (script.includes('./config.sh')) throw new Error('Legacy recovery must never register a runner');
          {
            if (failRelease === role) { failRelease = null; throw new Error('listener release response unavailable'); }
            const lifecycle = durableState().lifecycle;
            events.push(`listener:${role}:${lifecycle}`);
            expect(['routing', 'active']).toContain(lifecycle);
            if (!released.has(role)) {
              released.add(role);
              runners.find((runner) => runner.name === container.Name.slice(1))!.status = 'online';
            }
            if (loseReleaseResponse === role) {
              loseReleaseResponse = null;
              runners.find((runner) => runner.name === container.Name.slice(1))!.busy = true;
              throw new Error('listener release acknowledgement lost after effect');
            }
          }
          return stdout('');
        }
        case 'container-remove': {
          events.push('delete-container:' + args.at(-1));
          containers = containers.filter((container) => container.Id !== args.at(-1));
          return stdout('');
        }
        default: throw new Error(`Unexpected container operation ${operation.kind}`);
      }
    }
  }); }
}));
const apiSession = async (input: { operation: (api: object) => unknown }) => {
  boundaryEntries.push('github-api-session');
  return await input.operation({});
};
mock.module('../../src/adapters/providers/github-api/operation-session.ts', () => ({
  withGitHubApiReadSession: apiSession, withGitHubApiRunnerAdminSession: apiSession,
  inspectGitHubApiCapability: () => ({ principal: { login: 'maintainer' } }),
  executeGitHubApiOperation: async (_api: unknown, operation: { kind: string; runnerId?: number; labels?: string[] }) => {
    if (operation.kind === 'repository') return { full_name: 'sec-platform/sec' };
    if (operation.kind === 'repository-runners') return { runners: structuredClone(runners) };
    if (operation.kind === 'delete-repository-runner') {
      events.push('delete-runner:' + operation.runnerId);
      runners = runners.filter((runner) => runner.id !== operation.runnerId);
      return null;
    }
    if (operation.kind === 'add-repository-runner-labels') {
      const runner = runners.find((entry) => entry.id === operation.runnerId)!;
      const role = runner.name.split('-').at(-1)!;
      const lifecycle = durableState().lifecycle;
      events.push(`publish:${role}:${lifecycle}`);
      expect(lifecycle).toBe('routing');
      for (const label of operation.labels!) {
        if (!runner.labels.some(({ name }) => name === label)) runner.labels.push({ name: label });
      }
      if (loseLabelResponse === role) {
        loseLabelResponse = null;
        throw new Error('label publication response lost after effect');
      }
      return { labels: structuredClone(runner.labels) };
    }
    throw new Error(`Unexpected GitHub operation ${operation.kind}`);
  }
}));
const { startLocalGitHubActionsProvider, recoverLocalGitHubActionsProvider, stopLocalGitHubActionsProvider, observeLocalGitHubActionsProvider, createLocalGitHubActionsRunnerState } =
  await import('../../src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts');
const start = () => startLocalGitHubActionsProvider({ cwd: root, repository: 'sec-platform/sec', name: 'fixture', cpus: 3, memory: '768m' });
const recover = () => recoverLocalGitHubActionsProvider({ cwd: root, repository: 'sec-platform/sec', name: 'fixture' });
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sec-provider-routing-'));
  mkdirSync(path.join(root, '.git'));
  events = []; boundaryEntries = []; runners = []; containers = []; released = new Set();
  pendingState = null; failRelease = null; loseReleaseResponse = null; loseLabelResponse = null;
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

// Historical fixture material is data, not new provisioning. The state encoder
// is used only for canonical input framing; assertions use independent fixed
// effects, IDs and terminal observations. No transport can create/register.
function seedRetainedGeneration(lifecycle: 'provisioning' | 'routing' | 'active' = 'routing', registered = 3) {
  const roles = ['control', 'trusted', 'sut'] as const;
  const operationLabel = `sec-operation-${'b'.repeat(64)}`;
  const resources = { cpus: 3, memory: '768m' };
  const active = lifecycle === 'active';
  for (const [index, role] of roles.entries()) {
    const name = `fixture-${role}`;
    const id = String.fromCharCode(97 + index).repeat(64);
    containers.push({
      Id: id, Name: '/' + name, Image: environment.image.dockerProjectionDigest,
      Config: {
        Entrypoint: ['/bin/bash'], Cmd: ['-ceu', [
          'set -euo pipefail', 'cd /actions-runner',
          'marker="/actions-runner/.sec-runner-configured-v1"',
          'while [ ! -f "$marker" ]; do sleep 1; done', 'exec ./run.sh'
        ].join('\n')],
        Labels: {
          'sec.local-runner.schema': 'sec-local-github-actions-provider-state-v5',
          'sec.local-runner.repository': 'sec-platform/sec',
          'sec.local-runner.provider-name': 'fixture',
          'sec.local-runner.instance-name': name,
          'sec.local-runner.role': role,
          'sec.local-runner.operation-label': operationLabel,
          'sec.local-runner.container-init': environment.runtime.containerInitCapability,
          'sec.local-runner.image-id': environment.image.dockerProjectionDigest
        }
      },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 }, Init: true,
        CapAdd: role === 'sut' ? CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outerSutContainerCapabilities.map(value => `CAP_${value}`) : [],
        CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'], Privileged: false, Binds: null,
        PidsLimit: environment.runtime.resources[role].pids,
        Memory: role === 'sut' ? environment.runtime.resources.sut.memoryGiB * 1024 ** 3 : 768 * 1024 ** 2,
        NanoCpus: (role === 'sut' ? environment.runtime.resources.sut.cpus : 3) * 1_000_000_000
      }, State: { Running: true }
    });
    if (index < registered) {
      const labels = active
        ? [...environment.runtime.labels, environment.runtime.roleLabels[role], operationLabel]
        : ['self-hosted', 'Linux', 'X64', operationLabel];
      runners.push({ id: 21 + index, name, os: 'Linux', status: active ? 'online' : 'offline', busy: false,
        labels: labels.map(name => ({ name })) });
      if (active) released.add(role);
    }
  }
  const state = createLocalGitHubActionsRunnerState({
    repository: 'sec-platform/sec', repositoryRoot: root, commonDirectory: path.join(root, '.git'),
    providerName: 'fixture', operationLabel, lifecycle, resources, dockerEndpoint: endpoint,
    githubEndpoint: { schema: 'sec-github-api-endpoint-identity-v1', host: 'github.com', repository: 'sec-platform/sec', principal: 'maintainer' },
    instances: roles.map((role, index) => ({
      role, roleLabel: environment.runtime.roleLabels[role], name: `fixture-${role}`,
      containerId: String.fromCharCode(97 + index).repeat(64), containerState: 'present',
      runnerId: index < registered ? 21 + index : null,
      runnerState: index < registered ? 'present' : 'uncreated'
    })), startedAt: '2026-09-01T00:00:00.000Z'
  });
  mkdirSync(path.dirname(statePath()), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n');
}

test('retired provisioning rejects before Git, credential, Docker or durable-state effects', async () => {
  await expect(start()).rejects.toMatchObject({ name: 'LocalRunnerTopologyRetiredError', code: 'runner-topology-retired' });
  expect(boundaryEntries).toEqual([]);
  expect(events).toEqual([]); expect(runners).toEqual([]); expect(containers).toEqual([]);
  expect(existsSync(statePath())).toBe(false);
});

test('retired start leaves an interrupted legacy generation for its recovery owner', async () => {
  seedRetainedGeneration('active'); interruptReplacement('quarantined');
  await expect(start()).rejects.toMatchObject({ code: 'runner-topology-retired' });
  expect(boundaryEntries).toEqual([]);
  expect(events).toEqual([]); expect(pendingState).toBe('quarantined');
  expect(existsSync(pendingPath())).toBe(true); expect(runners).toHaveLength(3); expect(containers).toHaveLength(3);
});

test('committed legacy routing resumes exact IDs without provisioning and can be stopped', async () => {
  seedRetainedGeneration();
  await recover();
  expect(events).toEqual([
    'recover-state', 'listener:control:routing', 'publish:control:routing',
    'listener:trusted:routing', 'publish:trusted:routing',
    'listener:sut:routing', 'publish:sut:routing', 'durable:active'
  ]);
  expect(durableState().resources).toEqual({ cpus: 3, memory: '768m' });
  await stopLocalGitHubActionsProvider({ cwd: root });
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
});

test('unknown partial publication resumes from readback without registration or destructive rollback', async () => {
  seedRetainedGeneration(); loseLabelResponse = 'trusted';
  await expect(recover()).rejects.toThrow('label publication response lost');
  expect(durableState().lifecycle).toBe('routing');
  expect(events.some(event => event.startsWith('delete-'))).toBe(false);
  const ids = runners.map(({ id }) => id); runners[0]!.busy = true;
  await recover();
  expect(events.filter(event => event.startsWith('publish:'))).toEqual(['publish:control:routing', 'publish:trusted:routing', 'publish:sut:routing']);
  expect(runners.map(({ id }) => id)).toEqual(ids); expect(durableState().lifecycle).toBe('active');
});

test('legacy pre-commit partial registration is settled without releasing or creating runners', async () => {
  seedRetainedGeneration('provisioning', 2);
  await recover();
  expect(events.some(event => event.startsWith('listener:') || event.startsWith('publish:'))).toBe(false);
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
});

test('recovery preserves foreign labels and never publishes over drift', async () => {
  seedRetainedGeneration(); runners[0]!.labels.push({ name: 'external-maintainer-label' });
  await expect(recover()).rejects.toThrow('complete effective labels changed');
  expect(events.some(event => event.startsWith('publish:') || event.startsWith('delete-'))).toBe(false);
  expect(runners[0]!.labels.some(({ name }) => name === 'external-maintainer-label')).toBe(true);
});

test('marker release failure keeps committed routing intent and resumes without replacement', async () => {
  seedRetainedGeneration(); failRelease = 'trusted';
  await expect(recover()).rejects.toThrow('listener release response unavailable');
  expect(durableState().lifecycle).toBe('routing');
  expect(events.some(event => event.startsWith('delete-'))).toBe(false);
  await recover();
  expect(events.filter(event => event.startsWith('publish:'))).toEqual([
    'publish:control:routing', 'publish:trusted:routing', 'publish:sut:routing'
  ]);
  expect(runners.map(({ id }) => id)).toEqual([21, 22, 23]); expect(durableState().lifecycle).toBe('active');
});

test('replacement of a retained runner ID blocks recovery before label or delete effects', async () => {
  seedRetainedGeneration(); runners[0]!.id = 901;
  await expect(recover()).rejects.toThrow('uncommitted or replaced identity');
  expect(events.some(event => event.startsWith('publish:') || event.startsWith('delete-'))).toBe(false);
});

test('explicit stop can settle a retained v4 generation without inventing resource intent', async () => {
  seedRetainedGeneration('active');
  const current = JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, unknown>;
  Reflect.deleteProperty(current, 'resources'); Reflect.deleteProperty(current, 'stateDigest');
  current.schema = 'sec-local-github-actions-provider-state-v4';
  writeFileSync(statePath(), JSON.stringify({ ...current, stateDigest: sha256(current) }, null, 2) + '\n');
  for (const container of containers) container.Config.Labels['sec.local-runner.schema'] = 'sec-local-github-actions-provider-state-v4';
  await stopLocalGitHubActionsProvider({ cwd: root });
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
});

test('marker release acknowledgement loss retains already-running busy capacity', async () => {
  seedRetainedGeneration(); loseReleaseResponse = 'control';
  await expect(recover()).rejects.toThrow('listener release acknowledgement lost after effect');
  expect(durableState().lifecycle).toBe('routing');
  expect(runners[0]!.status).toBe('online'); expect(runners[0]!.busy).toBe(true);
  await recover();
  expect(events.filter(event => event.startsWith('publish:'))).toEqual([
    'publish:control:routing', 'publish:trusted:routing', 'publish:sut:routing'
  ]);
  expect(events.some(event => event.startsWith('delete-'))).toBe(false);
  expect(durableState().lifecycle).toBe('active');
});

for (const command of ['recover', 'stop'] as const) {
  test(`pending durable replacement is settled under lease before ${command} interprets absence`, async () => {
    seedRetainedGeneration('active'); interruptReplacement('quarantined');
    if (command === 'recover') await recover();
    else await stopLocalGitHubActionsProvider({ cwd: root });
    expect(events[0]).toBe('recover-state'); expect(pendingState).toBeNull();
    if (command === 'stop') {
      expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
    } else {
      expect(durableState().lifecycle).toBe('active'); expect(runners).toHaveLength(3); expect(containers).toHaveLength(3);
    }
  });
}

for (const phase of ['quarantined', 'installed'] as const) {
  test(`read-only status reports ${phase} durable artifacts without recovery or absence claims`, async () => {
    seedRetainedGeneration('active'); interruptReplacement(phase);
    const observed = await observeLocalGitHubActionsProvider({ cwd: root });
    expect(observed).toMatchObject({ status: 'residue', reason: 'lifecycle-state-recovery-required' });
    expect(pendingState).toBe(phase); expect(events).toEqual([]);
    expect(existsSync(pendingPath())).toBe(true); expect(existsSync(statePath())).toBe(phase === 'installed');
  });
}

test('installed teardown replacement is settled before recovery chooses its lifecycle', async () => {
  seedRetainedGeneration('active'); interruptReplacement('installed');
  await recover();
  expect(pendingState).toBeNull(); expect(existsSync(pendingPath())).toBe(false);
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
  expect(events.some(event => event.startsWith('publish:'))).toBe(false);
});
