import { settleWorkspaceCallback } from '../../../../../tests/testkit/workspace-cleanup.ts';
import { settleResourcesAsync } from '../../../../execution/resource-settlement.ts';
import { lstat, chmod, mkdtemp, readlink, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
import { createDockerEndpointIdentity, DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';
import {
  claimDockerCommandProviderCapability,
  disposeUnclaimedDockerCommandProviderCapability,
  issueDockerCommandProviderCapability
} from './command-provider.ts';
import { compileLinuxDockerDaemonProbeArguments, openContainerEngineSession } from './container-engine-session.ts';
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
  const cleanup: { label: string; settle(): void | Promise<void> }[] = [
    { label: 'Linux provider fixture root', settle: () => rm(root, { recursive: true, force: true }) }
  ];
  try {
    const probe = path.join(root, 'curl');
    const marker = path.join(root, 'probe-executed');
    if (options.daemonProbe === undefined) {
      await writeFile(probe, `#!/bin/sh\nprintf executed > '${marker}'\nprintf '%s\\n' '{"ID":"fixture-daemon","OSType":"linux","Architecture":"x86_64"}'\n`, { mode: 0o700 });
    }
    const directory = inspectNoFollowDirectoryChain(root);
    const probePath = options.daemonProbe ?? probe;
    const daemonProbe = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(probePath)), path.basename(probePath),
      undefined, 'Daemon probe fixture', 3, 'executable'
    );
    cleanup.unshift({ label: 'daemon probe', settle: () => daemonProbe.dispose() });
    const workingDirectory = retainNoFollowDirectoryForChildProcess(directory, 4);
    cleanup.unshift({ label: 'working directory', settle: () => workingDirectory.dispose() });
    const privateState = openLinuxDockerRuntimeState();
    cleanup.unshift({ label: 'private runtime state', settle: () => privateState.close() });
    const runtimeRoot = path.dirname(await readlink(privateState.environment.HOME!));
    const capability = issueDockerCommandProviderCapability({
      boundary: issueRetainedCommandBoundary({ executable: daemonProbe, workingDirectory }),
      commandProtocol: 'engine-http', daemonProbe, endpointHost: options.endpointHost ?? endpointHost, privateState,
      ...(options.linuxEndpoint === undefined ? {} : { linuxEndpoint: options.linuxEndpoint }),
      environment: privateState.environment, platform: 'linux',
      providerContractDigest: digest('Linux Docker fixture'), workingDirectory: directory.target
    });
    return { capability, root, probe, privateState, runtimeRoot, marker };
  } catch (error) {
    await settleResourcesAsync({ primary: { label: 'Linux provider fixture construction', error }, cleanup });
    throw error;
  }
}

linuxTest('Linux private config is exclusive, descriptor-addressed and retired after exact readback', async () => {
  const cleanup: { label: string; settle(): void }[] = [];
  await settleWorkspaceCallback(async () => {
    const first = openLinuxDockerRuntimeState();
    cleanup.push({ label: 'first private runtime', settle: () => first.close() });
    const second = openLinuxDockerRuntimeState();
    cleanup.push({ label: 'second private runtime', settle: () => second.close() });
    const root = path.dirname(await readlink(first.environment.HOME!));
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
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  }, async () => { await settleResourcesAsync({ cleanup }); });
});

linuxTest('Linux private config rejects lexical symlink replacement and permission drift', async () => {
  const state = openLinuxDockerRuntimeState();
  await settleWorkspaceCallback(async () => {
    const config = await readlink(state.environment.DOCKER_CONFIG!);
    const displaced = `${config}-displaced`;
    await chmod(config, 0o750);
    expect(() => state.assertCurrent()).toThrow('not private');
    await chmod(config, 0o700);
    await rename(config, displaced);
    await symlink(displaced, config);
    expect(() => state.assertCurrent()).toThrow();
    await rm(config);
    await rename(displaced, config);
  }, async () => { state.close(); });
});

linuxTest('Linux session refuses an unretained endpoint before executing a probe and retires owned state', async () => {
  const fixture = await providerFixture();
  try {
    await expect(openContainerEngineSession({
      provider: fixture.capability, operation: operation(fixture.capability.providerIdentityDigest),
      cwd: fixture.root, availability: 'observe'
    })).rejects.toMatchObject({ code: 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE', reason: 'linux-endpoint-identity-unavailable' });
    await expect(lstat(fixture.marker)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(fixture.runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

linuxTest('replaced daemon probe rejects provider admission and settles its private roots', async () => {
  const fixture = await providerFixture();
  try {
    const replacement = path.join(fixture.root, 'replacement');
    await writeFile(replacement, '#!/bin/sh\nprintf attacker', { mode: 0o700 });
    await rename(replacement, fixture.probe);
    expect(() => claimDockerCommandProviderCapability(fixture.capability)).toThrow('changed before admission');
    await expect(lstat(fixture.runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
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
    await expect(lstat(fixture.marker)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(fixture.runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
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
  let server: ReturnType<typeof createServer> | undefined;
  let activeSession: Awaited<ReturnType<typeof openContainerEngineSession>> | undefined;
  let unclaimed: Awaited<ReturnType<typeof providerFixture>>['capability'] | undefined;
  let nativeTerminalProven = true;
  const endpoints: LinuxDockerEndpoint[] = [];
  const fixtures: Awaited<ReturnType<typeof providerFixture>>[] = [];
  let old: { CURL_HOME: string | undefined; http_proxy: string | undefined } | undefined;
  let envMutationStarted = false;
  await settleWorkspaceCallback(async () => {
    server = createServer((request, response) => {
      requests.push({ method: request.method, url: request.url, authorization: request.headers.authorization });
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(body);
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(socket, resolve);
    });
    old = { CURL_HOME: process.env.CURL_HOME, http_proxy: process.env.http_proxy };
    await writeFile(path.join(root, '.curlrc'), 'proxy = "http://127.0.0.1:1"\nurl = "http://127.0.0.1:1/attacker"\n');
    envMutationStarted = true;
    process.env.CURL_HOME = root;
    process.env.http_proxy = 'http://127.0.0.1:1';
    const fixtureEndpoint = openLinuxDockerEndpoint({ endpointHost: `unix://${socket}`, peerUid: process.geteuid!() });
    endpoints.push(fixtureEndpoint);
    const fixture = await providerFixture({ endpointHost: `unix://${socket}`, daemonProbe: '/usr/bin/curl', linuxEndpoint: fixtureEndpoint });
    fixtures.push(fixture);
    unclaimed = fixture.capability;
    const opening = openContainerEngineSession({
      provider: fixture.capability, operation: operation(fixture.capability.providerIdentityDigest),
      cwd: fixture.root, availability: 'observe'
    });
    unclaimed = undefined;
    nativeTerminalProven = false;
    const session = await opening;
    activeSession = session;
    nativeTerminalProven = true;
    await settleWorkspaceCallback(async () => {
      expect(session.endpoint.daemonId).toBe('fixture-daemon');
      expect(session.supportedOperations).toEqual([]);
      const scoped = operation(session.providerIdentityDigest, session.deadlineAtUnixMs);
      const scope = session.openOperationScope({ operation: scoped, requirementId });
      try {
        nativeTerminalProven = false;
        await expect(session.execute({ kind: 'container-list', arguments: ['--help'] }))
          .rejects.toMatchObject({ code: 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE', reason: 'linux-cli-plugin-closure-unavailable' });
        await expect(session.execute({ kind: 'buildx-build', arguments: ['--help'] }))
          .rejects.toMatchObject({ code: 'SEC-DOCKER-COMMAND-OPERATION-UNAVAILABLE', reason: 'linux-buildx-closure-unavailable' });
      } finally {
        expect(scope.settle().physicalDisposition).toBe('not-started');
        nativeTerminalProven = true;
      }

      body = JSON.stringify({ ID: 'replacement-daemon', OSType: 'linux', Architecture: 'x86_64' });
      nativeTerminalProven = false;
      await expect(session.observeEndpoint().then(value => {
        nativeTerminalProven = true;
        return value;
      }, error => {
        if (error instanceof Error && error.cause === undefined
            && error.message === 'Container Engine session: independent endpoint readback differs from the retained session endpoint') {
          nativeTerminalProven = true;
        }
        throw error;
      })).rejects.toThrow('differs from the retained session endpoint');
    }, async () => {
      if (!nativeTerminalProven) throw new Error(`Docker probe termination is unproven; session and fixture roots are preserved: ${root}`);
      session.close();
      activeSession = undefined;
    });
    body = 'not-json';
    const invalidEndpoint = openLinuxDockerEndpoint({ endpointHost: `unix://${socket}`, peerUid: process.geteuid!() });
    endpoints.push(invalidEndpoint);
    const invalid = await providerFixture({ endpointHost: `unix://${socket}`, daemonProbe: '/usr/bin/curl', linuxEndpoint: invalidEndpoint });
    fixtures.push(invalid);
    unclaimed = invalid.capability;
    const invalidOpening = openContainerEngineSession({
      provider: invalid.capability, operation: operation(invalid.capability.providerIdentityDigest),
      cwd: invalid.root, availability: 'observe'
    });
    unclaimed = undefined;
    nativeTerminalProven = false;
    await expect(invalidOpening.then(value => {
      activeSession = value;
      nativeTerminalProven = true;
      return value;
    }, error => {
      if (error instanceof Error && error.cause === undefined
          && error.message === 'Container Engine session: daemon info is not JSON') {
        nativeTerminalProven = true;
      }
      throw error;
    })).rejects.toThrow('daemon info is not JSON');
    status = 503;
    const unavailableEndpoint = openLinuxDockerEndpoint({ endpointHost: `unix://${socket}`, peerUid: process.geteuid!() });
    endpoints.push(unavailableEndpoint);
    const unavailable = await providerFixture({ endpointHost: `unix://${socket}`, daemonProbe: '/usr/bin/curl', linuxEndpoint: unavailableEndpoint });
    fixtures.push(unavailable);
    unclaimed = unavailable.capability;
    const unavailableOpening = openContainerEngineSession({
      provider: unavailable.capability, operation: operation(unavailable.capability.providerIdentityDigest),
      cwd: unavailable.root, availability: 'observe'
    });
    unclaimed = undefined;
    nativeTerminalProven = false;
    await expect(unavailableOpening.then(value => {
      activeSession = value;
      nativeTerminalProven = true;
      return value;
    }, error => {
      if (error instanceof DockerDaemonAvailabilityFailure && error.cause === undefined
          && error.reason === 'endpoint-unavailable' && error.phase === 'endpoint-observe') {
        nativeTerminalProven = true;
      }
      throw error;
    })).rejects.toMatchObject({ reason: 'endpoint-unavailable', phase: 'endpoint-observe' });
    expect(requests).toEqual(Array(4).fill({ method: 'GET', url: '/info', authorization: undefined }));
    for (const fixture of fixtures) await expect(lstat(fixture.runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      ...(envMutationStarted ? Object.entries(old!) : []).map(([key, value]) => ({ label: `restore ${key}`, settle: () => {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      } })),
      { label: 'retire settled Docker probe fixtures', settle: async () => {
        if (!nativeTerminalProven) throw new Error(`Docker probe termination is unproven; endpoint and fixture roots are preserved: ${root}`);
        await settleResourcesAsync({ cleanup: [
          { label: 'active engine session', settle: () => { activeSession?.close(); } },
          { label: 'unclaimed command provider', settle: () => {
            if (unclaimed !== undefined) disposeUnclaimedDockerCommandProviderCapability(unclaimed);
          } },
          ...endpoints.map(endpoint => ({ label: 'retained Engine endpoint', settle: () => endpoint.close() }))
        ] });
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        }
        await settleResourcesAsync({ cleanup: [
          ...fixtures.map(fixture => ({ label: 'probe fixture root', settle: () => rm(fixture.root, { recursive: true, force: true }) })),
          { label: 'Engine server fixture root', settle: () => rm(root, { recursive: true, force: true }) }
        ] });
      } }
    ] });
  });
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


linuxTest('unclaimed Linux provider disposal settles the private state and retained command inputs', async () => {
  const fixture = await providerFixture();
  try {
    disposeUnclaimedDockerCommandProviderCapability(fixture.capability);
    await expect(lstat(fixture.runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => claimDockerCommandProviderCapability(fixture.capability)).toThrow();
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
