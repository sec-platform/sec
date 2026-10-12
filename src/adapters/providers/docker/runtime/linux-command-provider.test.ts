import { access, chmod, mkdtemp, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { issueRetainedCommandBoundary } from '../../../runtime-state/physical/runtime/process.ts';
import { createDockerEndpointIdentity } from '../contract/daemon.ts';
import {
  claimDockerCommandProviderCapability,
  disposeUnclaimedDockerCommandProviderCapability,
  issueDockerCommandProviderCapability
} from './command-provider.ts';
import { assertDockerCommandOperationAvailable, compileLinuxDockerDaemonProbeArguments, LINUX_DOCKER_OPERATIONS, openContainerEngineSession } from './container-engine-session.ts';
import { openLinuxDockerCommandProvider } from './linux-command-provider.ts';
import { assertLinuxDockerEndpoint, openLinuxDockerEndpoint, type LinuxDockerEndpoint } from './linux-endpoint.ts';
import { assertLinuxDockerRuntimeState, openLinuxDockerRuntimeState } from './linux-runtime-state.ts';

const linuxTest = test.skipIf(process.platform !== 'linux');
const digest = (value: unknown): OperationDigest => sha256(value) as OperationDigest;
const endpointHost = 'unix:///run/docker.sock';
const requirementId = 'fixture.container-engine';

function operation(providerIdentityDigest: OperationDigest, deadlineAtUnixMs = Date.now() + 60_000) {
  const contractDigest = digest('Linux Docker fixture contract');
  const plan = compileSemanticOperationPlan({
    operation: 'external.container-engine.linux-fixture',
    intentDigest: digest('Linux Docker fixture intent'),
    decisionDigest: digest('Linux Docker fixture decision'),
    deadlineAtUnixMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 60_000 },
      { resource: 'processes', maximum: 32 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 64 * 1024 * 1024 }
    ],
    requirements: [{
      id: requirementId, contractDigest,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: ['container-engine.endpoint-unavailable', 'container-engine.process-settlement-failed']
    }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest })
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId, contractDigest, providerIdentityDigest
  })]);
}

async function providerFixture(options: Readonly<{ endpointHost?: string; daemonProbe?: string; linuxEndpoint?: LinuxDockerEndpoint }> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-linux-docker-fixture-'));
  const probe = path.join(root, 'curl');
  const marker = path.join(root, 'probe-executed');
  await writeFile(probe, `#!/bin/sh\nprintf executed > '${marker}'\nprintf '%s\\n' '{"ID":"fixture-daemon","OSType":"linux","Architecture":"x86_64"}'\n`, { mode: 0o700 });
  const directory = inspectNoFollowDirectoryChain(root);
  const probePath = options.daemonProbe ?? probe;
  const daemonProbe = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(probePath)), path.basename(probePath),
    undefined, 'Daemon probe fixture', 3, 'executable'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(directory, 4);
  const privateState = openLinuxDockerRuntimeState();
  const runtimeRoot = path.dirname(await readlink(privateState.environment.HOME!));
  const capability = issueDockerCommandProviderCapability({
    boundary: issueRetainedCommandBoundary({ executable: daemonProbe, workingDirectory }),
    commandProtocol: 'engine-http', daemonProbe, endpointHost: options.endpointHost ?? endpointHost, privateState,
    ...(options.linuxEndpoint === undefined ? {} : { linuxEndpoint: options.linuxEndpoint }),
    environment: privateState.environment, platform: 'linux',
    providerContractDigest: digest('Linux Docker fixture'), workingDirectory: directory.target
  });
  return { capability, root, probe, privateState, runtimeRoot, marker };
}

linuxTest('Linux private config is exclusive, descriptor-addressed and retired after exact readback', async () => {
  const first = openLinuxDockerRuntimeState();
  const second = openLinuxDockerRuntimeState();
  const root = path.dirname(await readlink(first.environment.HOME!));
  try {
    expect(first.identityDigest).not.toBe(second.identityDigest);
    expect(() => assertLinuxDockerRuntimeState({ ...first })).toThrow('not owner-issued');
    for (const key of ['HOME', 'DOCKER_CONFIG', 'TMPDIR']) {
      const directory = first.environment[key]!;
      expect(directory.startsWith(`/proc/${process.pid}/fd/`)).toBe(true);
      const metadata = await stat(directory);
      expect(metadata.uid).toBe(process.geteuid!());
      expect(metadata.mode & 0o777).toBe(0o700);
    }
    await writeFile(path.join(first.environment.DOCKER_CONFIG!, 'config.json'), '{}');
    first.assertCurrent();
    first.close();
    first.close();
    await expect(access(root)).rejects.toBeDefined();
  } finally {
    first.close();
    second.close();
  }
});

linuxTest('Linux private config rejects lexical symlink replacement and permission drift', async () => {
  const state = openLinuxDockerRuntimeState();
  const config = await readlink(state.environment.DOCKER_CONFIG!);
  const displaced = `${config}-displaced`;
  try {
    await chmod(config, 0o750);
    expect(() => state.assertCurrent()).toThrow('not private');
    await chmod(config, 0o700);
    await rename(config, displaced);
    await symlink(displaced, config);
    expect(() => state.assertCurrent()).toThrow();
    await rm(config);
    await rename(displaced, config);
  } finally {
    state.close();
  }
});

linuxTest('Linux session refuses an unretained endpoint before executing a probe and retires owned state', async () => {
  const fixture = await providerFixture();
  try {
    await expect(openContainerEngineSession({
      provider: fixture.capability, operation: operation(fixture.capability.providerIdentityDigest),
      cwd: fixture.root, availability: 'observe'
    })).rejects.toMatchObject({ code: 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE', reason: 'linux-endpoint-identity-unavailable' });
    await expect(access(fixture.marker)).rejects.toBeDefined();
    await expect(access(fixture.runtimeRoot)).rejects.toBeDefined();
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

linuxTest('replaced daemon probe rejects provider admission and settles its private roots', async () => {
  const fixture = await providerFixture();
  try {
    const replacement = path.join(fixture.root, 'replacement');
    await writeFile(replacement, '#!/bin/sh\nprintf attacker', { mode: 0o700 });
    await rename(replacement, fixture.probe);
    expect(() => claimDockerCommandProviderCapability(fixture.capability)).toThrow('changed before admission');
    await expect(access(fixture.runtimeRoot)).rejects.toBeDefined();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

linuxTest('a Linux session rejects a different expected endpoint before any command and retires state', async () => {
  const fixture = await providerFixture();
  try {
    await expect(openContainerEngineSession({
      provider: fixture.capability, operation: operation(fixture.capability.providerIdentityDigest),
      cwd: fixture.root, availability: 'observe',
      expectedEndpoint: createDockerEndpointIdentity({
        contextName: 'default', endpointHost: 'unix:///run/other.sock', daemonId: 'fixture-daemon',
        osType: 'linux', architecture: 'x86_64'
      })
    })).rejects.toThrow('differs from the installed provider endpoint');
    await expect(access(fixture.runtimeRoot)).rejects.toBeDefined();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('Linux installed provider rejects an unbound working directory before discovery', async () => {
  await expect(openLinuxDockerCommandProvider({ workingDirectory: '.' }))
    .rejects.toThrow(/working directory|platform/u);
});


test('Linux daemon probe disables ambient config, proxies and redirects and bounds the local request', () => {
  const deadline = Date.now() + 30_000;
  const args = compileLinuxDockerDaemonProbeArguments(endpointHost, deadline);
  expect(args.slice(0, 14)).toEqual([
    '--disable', '--silent', '--show-error', '--fail', '--proto', '=http',
    '--proxy', '', '--noproxy', '*', '--max-redirs', '0', '--unix-socket', '/run/docker.sock'
  ]);
  expect(args.at(-1)).toBe('http://localhost/info');
  expect(Number(args[15])).toBeGreaterThan(0);
  expect(Number(args[15])).toBeLessThanOrEqual(30);
  expect(() => compileLinuxDockerDaemonProbeArguments('unix:///run/../evil.sock', deadline))
    .toThrow('canonical local Linux endpoint');
  expect(() => compileLinuxDockerDaemonProbeArguments(endpointHost, Date.now() - 1))
    .toThrow('deadline is exhausted');
});

linuxTest('sealed curl observes a local Engine without inherited curlrc or proxies and preserves invalid data and drift', async () => {
  const root = await mkdtemp('/tmp/sec-native-docker-info-');
  const socket = path.join(root, 'engine.sock');
  let status = 200;
  let body = JSON.stringify({ ID: 'fixture-daemon', OSType: 'linux', Architecture: 'x86_64' });
  const requests: Array<Readonly<{ method: string | undefined; url: string | undefined; authorization: string | undefined }>> = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(body);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socket, resolve);
    });
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const old = { CURL_HOME: process.env.CURL_HOME, http_proxy: process.env.http_proxy };
  await writeFile(path.join(root, '.curlrc'), 'proxy = "http://127.0.0.1:1"\nurl = "http://127.0.0.1:1/attacker"\n');
  process.env.CURL_HOME = root;
  process.env.http_proxy = 'http://127.0.0.1:1';
  const fixtures: Awaited<ReturnType<typeof providerFixture>>[] = [];
  try {
    const fixture = await providerFixture({ endpointHost: `unix://${socket}`, daemonProbe: '/usr/bin/curl', linuxEndpoint: openLinuxDockerEndpoint({ endpointHost: `unix://${socket}`, peerUid: process.geteuid!() }) });
    fixtures.push(fixture);
    const session = await openContainerEngineSession({
      provider: fixture.capability, operation: operation(fixture.capability.providerIdentityDigest),
      cwd: fixture.root, availability: 'observe'
    });
    try {
      expect(session.endpoint.daemonId).toBe('fixture-daemon');
      expect(session.supportedOperations).toEqual([]);
      const scoped = operation(session.providerIdentityDigest, session.deadlineAtUnixMs);
      const scope = session.openOperationScope({ operation: scoped, requirementId });
      try {
        await expect(session.execute({ kind: 'container-list', arguments: ['--help'] }))
          .rejects.toMatchObject({ code: 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE', reason: 'linux-cli-plugin-closure-unavailable' });
        await expect(session.execute({ kind: 'buildx-build', arguments: ['--help'] }))
          .rejects.toMatchObject({ code: 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE', reason: 'linux-buildx-closure-unavailable' });
      } finally { expect(scope.settle().physicalDisposition).toBe('not-started'); }

      body = JSON.stringify({ ID: 'replacement-daemon', OSType: 'linux', Architecture: 'x86_64' });
      await expect(session.observeEndpoint()).rejects.toThrow('differs from the retained session endpoint');
    } finally {
      session.close();
    }
    body = 'not-json';
    const invalid = await providerFixture({ endpointHost: `unix://${socket}`, daemonProbe: '/usr/bin/curl', linuxEndpoint: openLinuxDockerEndpoint({ endpointHost: `unix://${socket}`, peerUid: process.geteuid!() }) });
    fixtures.push(invalid);
    await expect(openContainerEngineSession({
      provider: invalid.capability, operation: operation(invalid.capability.providerIdentityDigest),
      cwd: invalid.root, availability: 'observe'
    })).rejects.toThrow('daemon info is not JSON');
    status = 503;
    const unavailable = await providerFixture({ endpointHost: `unix://${socket}`, daemonProbe: '/usr/bin/curl', linuxEndpoint: openLinuxDockerEndpoint({ endpointHost: `unix://${socket}`, peerUid: process.geteuid!() }) });
    fixtures.push(unavailable);
    await expect(openContainerEngineSession({
      provider: unavailable.capability, operation: operation(unavailable.capability.providerIdentityDigest),
      cwd: unavailable.root, availability: 'observe'
    })).rejects.toMatchObject({ reason: 'endpoint-unavailable', phase: 'endpoint-observe' });
    expect(requests).toEqual(Array(4).fill({ method: 'GET', url: '/info', authorization: undefined }));
    for (const fixture of fixtures) await expect(access(fixture.runtimeRoot)).rejects.toBeDefined();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    for (const fixture of fixtures) await rm(fixture.root, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});


linuxTest('Linux endpoint admission rejects ordinary files and copied capabilities', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-linux-endpoint-invalid-'));
  try {
    const file = path.join(root, 'socket');
    await writeFile(file, 'not a socket');
    expect(() => openLinuxDockerEndpoint({ endpointHost: `unix://${file}`, peerUid: process.geteuid!() }))
      .toThrow('socket type, ownership or link identity is unqualified');
    expect(() => assertLinuxDockerEndpoint({
      endpointHost, transportHost: endpointHost, identityDigest: digest('forged endpoint'),
      assertCurrent() {}, close() {}
    })).toThrow('not owner-issued');
  } finally { await rm(root, { recursive: true, force: true }); }
});

linuxTest('Linux config cannot introduce credential helpers or ambient plugin directories', async () => {
  const state = openLinuxDockerRuntimeState();
  try {
    const config = path.join(state.environment.DOCKER_CONFIG!, 'config.json');
    for (const value of [{ credsStore: 'attacker' }, { cliPluginsExtraDirs: ['/attacker'] }, { auths: {} }]) {
      await writeFile(config, JSON.stringify(value));
      expect(() => state.assertCurrent()).toThrow('credential-free');
    }
    await writeFile(config, '{}');
  } finally { state.close(); }
});


test('Linux command-family admission refuses Docker CLI help/error reachability before transport', () => {
  expect(LINUX_DOCKER_OPERATIONS).toEqual([]);
  for (const kind of ['container-copy', 'container-create', 'container-exec', 'container-inspect',
    'container-list', 'container-remove', 'container-run', 'container-start', 'image-inspect',
    'image-list', 'image-remove', 'network-disconnect', 'volume-create', 'volume-inspect'] as const) {
    expect(() => assertDockerCommandOperationAvailable('linux', kind))
      .toThrow('linux-cli-plugin-closure-unavailable');
    expect(() => assertDockerCommandOperationAvailable('win32', kind)).not.toThrow();
  }
  expect(() => assertDockerCommandOperationAvailable('linux', undefined)).toThrow('linux-cli-plugin-closure-unavailable');
  expect(() => assertDockerCommandOperationAvailable('linux', 'buildx-build')).toThrow('linux-buildx-closure-unavailable');
  expect(() => assertDockerCommandOperationAvailable('linux', 'buildx-bake')).toThrow('linux-buildx-closure-unavailable');
});


linuxTest('unclaimed Linux provider disposal settles the private state and retained command inputs', async () => {
  const fixture = await providerFixture();
  try {
    disposeUnclaimedDockerCommandProviderCapability(fixture.capability);
    await expect(access(fixture.runtimeRoot)).rejects.toBeDefined();
    expect(() => claimDockerCommandProviderCapability(fixture.capability)).toThrow();
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
