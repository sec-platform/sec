import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../src/contracts/canonical.ts';
import { createDockerEndpointIdentity } from '../../src/adapters/providers/docker/contract/daemon.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY as environment } from '../../src/adapters/providers/linux-verification/contract.ts';

// Exercise the real start/recover/stop control flow and physical durable state.
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
    if (state.lifecycle === 'routing' && loseCommitAcknowledgement) {
      loseCommitAcknowledgement = false;
      throw new Error('routing commit acknowledgement lost');
    }
  }
}));

const endpoint = createDockerEndpointIdentity({
  contextName: 'test-linux', endpointHost: 'unix:///var/run/docker.sock',
  daemonId: 'fixture-daemon', osType: 'linux', architecture: 'x86_64'
});
const digest = `sha256:${'a'.repeat(64)}`;
let root: string;
let events: string[];
let loseCommitAcknowledgement: boolean;
let failRegistration: string | null;
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
const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1]!;
const values = (args: readonly string[], name: string) => args.flatMap((value, index) => value === name ? [args[index + 1]!] : []);

mock.module('../../src/adapters/providers/git-read/authority.ts', () => ({
  withAuthorityGitReadSession: async (_input: unknown, operation: (session: object) => unknown) => await operation({})
}));
mock.module('../../src/adapters/self-hosting/development/tooling/git/git-read.ts', () => ({
  GIT_READ_OPERATION_BUDGET: {},
  gitReadText: async (_session: unknown, args: readonly string[]) => args.includes('--show-toplevel') ? root
    : args.includes('--git-common-dir') ? path.join(root, '.git') : 'https://github.com/sec-platform/sec.git'
}));
mock.module('../../src/adapters/providers/docker/runtime/windows-command-provider.ts', () => ({
  openWindowsDockerCommandProvider: async () => ({ providerIdentityDigest: digest })
}));
mock.module('../../src/adapters/providers/docker/runtime/container-engine-session.ts', () => ({
  openContainerEngineSession: async () => ({
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
        case 'container-run': {
          const id = String.fromCharCode(97 + containers.length).repeat(64);
          const labels = Object.fromEntries(values(args, '--label').map((label) => {
            const split = label.indexOf('='); return [label.slice(0, split), label.slice(split + 1)];
          }));
          const memory = flag(args, '--memory');
          containers.push({
            Id: id, Name: '/' + flag(args, '--name'), Image: environment.image.dockerProjectionDigest,
            Config: { Entrypoint: [flag(args, '--entrypoint')], Cmd: args.slice(-2), Labels: labels },
            HostConfig: {
              RestartPolicy: { Name: flag(args, '--restart'), MaximumRetryCount: 0 },
              Init: args.includes('--init'), CapAdd: values(args, '--cap-add').map((value) => `CAP_${value}`),
              CapDrop: values(args, '--cap-drop'), SecurityOpt: values(args, '--security-opt'),
              Privileged: false, Binds: null, PidsLimit: Number(flag(args, '--pids-limit')),
              Memory: Number(memory.slice(0, -1)) * (memory.endsWith('g') ? 1024 ** 3 : 1024 ** 2),
              NanoCpus: Number(flag(args, '--cpus')) * 1_000_000_000
            }, State: { Running: true }
          });
          events.push(`create:${flag(args, '--name')}`);
          return stdout(id);
        }
        case 'container-exec': {
          const container = containers.find((entry) => args.includes(entry.Id))!;
          const role = container.Config.Labels['sec.local-runner.role']!;
          const script = args.at(-1)!;
          if (script.includes('./config.sh')) {
            if (failRegistration === role) throw new Error('registration unavailable before effect');
            const labels = /--labels ([^ ]+) --work/u.exec(script)![1]!.split(',');
            runners.push({ id: 21 + runners.length, name: container.Name.slice(1), os: 'Linux',
              status: 'offline', busy: false,
              labels: ['self-hosted', 'Linux', 'X64', ...labels].map((name) => ({ name })) });
            events.push(`register:${role}`);
          } else {
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
  })
}));
const apiSession = async (input: { operation: (api: object) => unknown }) => await input.operation({});
mock.module('../../src/adapters/providers/github-api/operation-session.ts', () => ({
  withGitHubApiReadSession: apiSession, withGitHubApiRunnerAdminSession: apiSession,
  inspectGitHubApiCapability: () => ({ principal: { login: 'maintainer' } }),
  executeGitHubApiOperation: async (_api: unknown, operation: { kind: string; runnerId?: number; labels?: string[] }) => {
    if (operation.kind === 'repository') return { full_name: 'sec-platform/sec' };
    if (operation.kind === 'repository-runners') return { runners: structuredClone(runners) };
    if (operation.kind === 'create-runner-registration-token') return { token: 'fixture-only-registration-token' };
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
const { startLocalGitHubActionsProvider, recoverLocalGitHubActionsProvider, stopLocalGitHubActionsProvider, observeLocalGitHubActionsProvider } =
  await import('../../src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts');
const start = () => startLocalGitHubActionsProvider({ cwd: root, repository: 'sec-platform/sec', name: 'fixture', cpus: 3, memory: '768m' });
const recover = () => recoverLocalGitHubActionsProvider({ cwd: root, repository: 'sec-platform/sec', name: 'fixture' });
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'sec-provider-routing-'));
  mkdirSync(path.join(root, '.git'));
  events = []; runners = []; containers = []; released = new Set();
  pendingState = null; loseCommitAcknowledgement = false; failRegistration = null; failRelease = null; loseReleaseResponse = null; loseLabelResponse = null;
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

test('all registrations precede durable routing commit, listener release, and exact-ID publication', async () => {
  await start();
  expect(events.filter((event) => !event.startsWith('durable:provisioning') && !event.startsWith('create:'))).toEqual([
    'recover-state', 'register:control', 'register:trusted', 'register:sut', 'durable:routing',
    'listener:control:routing', 'publish:control:routing',
    'listener:trusted:routing', 'publish:trusted:routing',
    'listener:sut:routing', 'publish:sut:routing', 'durable:active'
  ]);
  expect(durableState().resources).toEqual({ cpus: 3, memory: '768m' });
  await stopLocalGitHubActionsProvider({ cwd: root });
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
});

test('unknown partial publication resumes from readback without registration or destructive rollback', async () => {
  loseLabelResponse = 'trusted';
  await expect(start()).rejects.toThrow('label publication response lost');
  expect(durableState().lifecycle).toBe('routing');
  expect(events.some((event) => event.startsWith('delete-'))).toBe(false);
  const ids = runners.map(({ id }) => id);
  runners[0]!.busy = true;
  await recover();
  expect(events.filter((event) => event.startsWith('register:'))).toEqual(['register:control', 'register:trusted', 'register:sut']);
  expect(events.filter((event) => event.startsWith('publish:'))).toEqual(['publish:control:routing', 'publish:trusted:routing', 'publish:sut:routing']);
  expect(runners.map(({ id }) => id)).toEqual(ids);
  expect(durableState().lifecycle).toBe('active');
});

test('durable commit acknowledgement loss leaves listeners blocked and resumes the retained generation', async () => {
  loseCommitAcknowledgement = true;
  await expect(start()).rejects.toThrow('provider start and exact cleanup both failed');
  expect(durableState().lifecycle).toBe('routing');
  expect(events.some((event) => event.startsWith('listener:') || event.startsWith('publish:') || event.startsWith('delete-'))).toBe(false);
  await recover();
  expect(durableState().lifecycle).toBe('active');
});

test('pre-commit registration failure cleans staged identities without ever releasing a listener', async () => {
  failRegistration = 'sut';
  await expect(start()).rejects.toThrow('registration unavailable before effect');
  expect(events.some((event) => event.startsWith('listener:') || event.startsWith('publish:'))).toBe(false);
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
});

test('recovery preserves foreign labels and never publishes over drift', async () => {
  loseLabelResponse = 'trusted';
  await expect(start()).rejects.toThrow();
  runners[0]!.labels.push({ name: 'external-maintainer-label' });
  const effectCount = events.filter((event) => event.startsWith('publish:') || event.startsWith('delete-')).length;
  await expect(recover()).rejects.toThrow('complete effective labels changed');
  expect(events.filter((event) => event.startsWith('publish:') || event.startsWith('delete-'))).toHaveLength(effectCount);
  expect(runners[0]!.labels.some(({ name }) => name === 'external-maintainer-label')).toBe(true);
});


test('marker release failure keeps committed routing intent and resumes without replacement', async () => {
  failRelease = 'trusted';
  await expect(start()).rejects.toThrow('listener release response unavailable');
  expect(durableState().lifecycle).toBe('routing');
  expect(events.some((event) => event.startsWith('delete-'))).toBe(false);
  await recover();
  expect(events.filter((event) => event.startsWith('publish:'))).toEqual([
    'publish:control:routing', 'publish:trusted:routing', 'publish:sut:routing'
  ]);
  expect(events.filter((event) => event.startsWith('register:'))).toHaveLength(3);
  expect(durableState().lifecycle).toBe('active');
});

test('replacement of a retained runner ID blocks recovery before label or delete effects', async () => {
  loseLabelResponse = 'trusted';
  await expect(start()).rejects.toThrow();
  runners[0]!.id = 901;
  const effectCount = events.filter((event) => event.startsWith('publish:') || event.startsWith('delete-')).length;
  await expect(recover()).rejects.toThrow('uncommitted or replaced identity');
  expect(events.filter((event) => event.startsWith('publish:') || event.startsWith('delete-'))).toHaveLength(effectCount);
});

test('explicit stop can settle a retained v4 generation without inventing resource intent', async () => {
  await start();
  const current = JSON.parse(readFileSync(statePath(), 'utf8')) as Record<string, unknown>;
  Reflect.deleteProperty(current, 'resources'); Reflect.deleteProperty(current, 'stateDigest');
  current.schema = 'sec-local-github-actions-provider-state-v4';
  const legacy = { ...current, stateDigest: sha256(current) };
  writeFileSync(statePath(), JSON.stringify(legacy, null, 2) + '\n');
  for (const container of containers) container.Config.Labels['sec.local-runner.schema'] = 'sec-local-github-actions-provider-state-v4';
  await stopLocalGitHubActionsProvider({ cwd: root });
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
});


test('marker release acknowledgement loss retains already-running busy capacity', async () => {
  loseReleaseResponse = 'control';
  await expect(start()).rejects.toThrow('listener release acknowledgement lost after effect');
  expect(durableState().lifecycle).toBe('routing');
  expect(runners[0]!.status).toBe('online'); expect(runners[0]!.busy).toBe(true);
  await recover();
  expect(events.filter((event) => event.startsWith('publish:'))).toEqual([
    'publish:control:routing', 'publish:trusted:routing', 'publish:sut:routing'
  ]);
  expect(events.some((event) => event.startsWith('delete-'))).toBe(false);
  expect(durableState().lifecycle).toBe('active');
});


for (const command of ['start', 'recover', 'stop'] as const) {
  test(`pending durable replacement is settled under lease before ${command} interprets absence`, async () => {
    await start(); interruptReplacement('quarantined');
    const previousEvents = events.length;
    if (command === 'start') await expect(start()).rejects.toThrow('active lifecycle state already exists');
    else if (command === 'recover') await recover();
    else await stopLocalGitHubActionsProvider({ cwd: root });
    expect(events[previousEvents]).toBe('recover-state');
    expect(pendingState).toBeNull();
    if (command === 'stop') {
      expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
    } else {
      expect(durableState().lifecycle).toBe('active');
      expect(runners).toHaveLength(3); expect(containers).toHaveLength(3);
    }
    expect(events.filter((event) => event.startsWith('register:'))).toHaveLength(3);
  });
}

for (const phase of ['quarantined', 'installed'] as const) {
  test(`read-only status reports ${phase} durable artifacts without recovery or absence claims`, async () => {
    await start(); interruptReplacement(phase);
    const previousEvents = events.length;
    const observed = await observeLocalGitHubActionsProvider({ cwd: root });
    expect(observed).toMatchObject({ status: 'residue', reason: 'lifecycle-state-recovery-required' });
    expect(pendingState).toBe(phase); expect(events).toHaveLength(previousEvents);
    expect(existsSync(pendingPath())).toBe(true);
    expect(existsSync(statePath())).toBe(phase === 'installed');
  });
}

test('installed teardown replacement is settled before recovery chooses its lifecycle', async () => {
  await start(); interruptReplacement('installed');
  await recover();
  expect(pendingState).toBeNull(); expect(existsSync(pendingPath())).toBe(false);
  expect(runners).toEqual([]); expect(containers).toEqual([]); expect(existsSync(statePath())).toBe(false);
  expect(events.filter((event) => event.startsWith('publish:'))).toHaveLength(3);
});
