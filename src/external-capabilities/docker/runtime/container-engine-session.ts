import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary,
  resolveExecutableLocator,
  runRetainedCommandBytes,
  type RetainedCommandBoundary
} from '../../../runtime-state/physical/runtime/process.ts';
import { resolveWindowsKnownFolderPath } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';
import type {
  ContainerEngineCommandResult,
  ContainerEngineOperation,
  ContainerEngineOperationOptions,
  ContainerEngineSession,
  OpenContainerEngineSessionInput
} from '../contract/container-engine-session.ts';
import {
  createDockerEndpointIdentity,
  parseDockerEndpointIdentity,
  type DockerEndpointIdentity
} from '../contract/daemon.ts';
import {
  ensureDockerDaemonStartedWithCommand,
  observeDockerDaemonWithCommand,
  type DockerDaemonCommandResult
} from './daemon-algorithm.ts';
import { withDockerDesktopLauncherLock } from './daemon.ts';

const DOCKER_COMMAND_ENVIRONMENT_KEYS = Object.freeze([
  'HOME', 'PATH', 'PROGRAMFILES', 'SYSTEMROOT', 'TEMP', 'TMP',
  'USERPROFILE', 'WINDIR'
] as const);

const OPERATION_PREFIX = Object.freeze({
  'buildx-bake': ['buildx', 'bake'],
  'buildx-build': ['buildx', 'build'],
  'container-copy': ['container', 'cp'],
  'container-create': ['container', 'create'],
  'container-exec': ['container', 'exec'],
  'container-inspect': ['container', 'inspect'],
  'container-list': ['container', 'ls'],
  'container-remove': ['container', 'rm'],
  'container-run': ['container', 'run'],
  'container-start': ['container', 'start'],
  'image-inspect': ['image', 'inspect'],
  'image-list': ['image', 'ls'],
  'image-remove': ['image', 'rm'],
  'network-disconnect': ['network', 'disconnect'],
  'volume-create': ['volume', 'create'],
  'volume-inspect': ['volume', 'inspect']
} as const satisfies Record<ContainerEngineOperation['kind'], readonly string[]>);

function fail(message: string): never {
  throw new Error(`Container Engine session: ${message}`);
}

function projectedEnvironment(
  keys: readonly string[],
  source: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const expected of keys) {
    const actual = Object.keys(source).find((candidate) => candidate.toUpperCase() === expected);
    if (actual !== undefined && source[actual] !== undefined) environment[actual] = source[actual];
  }
  return environment;
}

async function dockerDesktopLifecycleEnvironment(): Promise<NodeJS.ProcessEnv> {
  const [localAppData, appData, programData] = await Promise.all([
    resolveWindowsKnownFolderPath('local-app-data'),
    resolveWindowsKnownFolderPath('roaming-app-data'),
    resolveWindowsKnownFolderPath('program-data')
  ]);
  for (const [label, directory] of Object.entries({ localAppData, appData, programData })) {
    inspectNoFollowDirectoryChain(directory, `Docker Desktop ${label} known folder`);
  }
  return {
    ...projectedEnvironment(DOCKER_COMMAND_ENVIRONMENT_KEYS, process.env),
    APPDATA: appData,
    LOCALAPPDATA: localAppData,
    PROGRAMDATA: programData
  };
}

function boundedArguments(arguments_: readonly string[]): readonly string[] {
  if (!Array.isArray(arguments_) || arguments_.length > 4_096) {
    fail('operation argument count is invalid');
  }
  let bytes = 0;
  const retained = arguments_.map((argument) => {
    if (typeof argument !== 'string' || argument.includes('\0')) {
      fail('operation arguments must be NUL-free strings');
    }
    bytes += Buffer.byteLength(argument, 'utf8') + 1;
    if (!Number.isSafeInteger(bytes) || bytes > 16 * 1024 * 1024) {
      fail('operation arguments exceed the byte bound');
    }
    if (argument === '--host' || argument.startsWith('--host=')) {
      fail('operation cannot replace the retained endpoint');
    }
    return argument;
  });
  return Object.freeze(retained);
}

function operationArguments(operation: ContainerEngineOperation): readonly string[] {
  const prefix = OPERATION_PREFIX[operation.kind];
  return Object.freeze([...prefix, ...boundedArguments(operation.arguments)]);
}

function parseJsonObject(source: Uint8Array, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(source).toString('utf8'));
  } catch {
    fail(`${label} is not JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`${label} must be one object`);
  }
  return parsed as Record<string, unknown>;
}

function boundedIdentityText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function dockerEndpointHost(value: unknown): string {
  const host = boundedIdentityText(value, 'endpoint host', 1_024);
  if (!/^npipe:\/{4}\.\/pipe\/[A-Za-z0-9_.-]+$/u.test(host)
      && !/^unix:\/{3}[^\u0000-\u001f]+$/u.test(host)) {
    fail('endpoint must use a local npipe or unix transport');
  }
  return host;
}

function endpointFromInfo(input: Readonly<{
  contextName: string;
  endpointHost: string;
  info: Uint8Array;
}>): DockerEndpointIdentity {
  const info = parseJsonObject(input.info, 'daemon info');
  return createDockerEndpointIdentity({
    contextName: input.contextName,
    endpointHost: input.endpointHost,
    daemonId: boundedIdentityText(info.ID, 'daemon identity', 128),
    osType: info.OSType as 'linux',
    architecture: info.Architecture as 'x86_64'
  });
}

function assertPositiveBound(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 64 * 1024 * 1024) {
    fail(`${label} is invalid`);
  }
  return value;
}

async function retainDockerCommandBoundary(cwd: string): Promise<Readonly<{
  boundary: RetainedCommandBoundary;
  executable: string;
}>> {
  const canonicalCwd = path.resolve(cwd);
  if (!path.isAbsolute(cwd) || canonicalCwd !== cwd) fail('cwd must be canonical and absolute');
  const cwdIdentity = inspectNoFollowDirectoryChain(canonicalCwd, 'Container Engine session cwd');
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH');
  const pathValue = pathKey === undefined ? '' : process.env[pathKey] ?? '';
  const executable = resolveExecutableLocator('docker', { cwd: canonicalCwd, pathValue });
  if (executable === null) fail('Docker executable is unavailable');
  const executableParent = inspectNoFollowDirectoryChain(
    path.dirname(executable),
    'Container Engine executable parent'
  );
  const executableEntry = inspectNoFollowOrdinaryFileEntry(
    executableParent.target,
    path.basename(executable)
  );
  if (executableEntry === null || executableEntry.kind !== 'file') {
    fail('Docker executable is not a retained ordinary file');
  }
  let retainedExecutable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let retainedCwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  try {
    retainedExecutable = retainNoFollowOrdinaryFile(
      executableParent,
      path.basename(executable),
      { device: executableEntry.device, inode: executableEntry.inode },
      'Container Engine retained executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    retainedCwd = retainNoFollowDirectoryForChildProcess(
      cwdIdentity,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Container Engine retained working directory'
    );
    return Object.freeze({
      boundary: issueRetainedCommandBoundary({
        executable: retainedExecutable,
        workingDirectory: retainedCwd
      }),
      executable
    });
  } catch (error) {
    retainedCwd?.dispose();
    retainedExecutable?.dispose();
    throw error;
  }
}

export async function openContainerEngineSession(
  input: OpenContainerEngineSessionInput
): Promise<ContainerEngineSession> {
  const cwd = path.resolve(input.cwd);
  if (!path.isAbsolute(input.cwd) || cwd !== input.cwd) fail('cwd must be canonical and absolute');
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()) {
    fail('deadline is exhausted');
  }
  const maxStdoutBytes = assertPositiveBound(input.maxStdoutBytes, 'stdout bound');
  const maxStderrBytes = assertPositiveBound(input.maxStderrBytes, 'stderr bound');
  const retained = await retainDockerCommandBoundary(cwd);
  let active = 0;
  let closing = false;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  const settlements = new Set<Promise<void>>();
  const environment = projectedEnvironment(DOCKER_COMMAND_ENVIRONMENT_KEYS, process.env);

  const rawRun = async (
    args: readonly string[],
    options: ContainerEngineOperationOptions = {},
    lifecycle: 'observe' | 'start' = 'observe'
  ): Promise<ContainerEngineCommandResult> => {
    if (closed || closing) fail(closed ? 'session is closed' : 'session is closing');
    const remaining = input.deadlineAtUnixMs - Date.now();
    if (remaining < 1) fail('deadline is exhausted');
    const stdoutBound = Math.min(
      maxStdoutBytes,
      options.maxStdoutBytes ?? maxStdoutBytes
    );
    const stderrBound = Math.min(
      maxStderrBytes,
      options.maxStderrBytes ?? maxStderrBytes
    );
    if (stdoutBound < 1 || stderrBound < 1) fail('operation output bound is invalid');
    const stallTimeoutMs = options.stallTimeoutMs;
    if (stallTimeoutMs !== undefined && (!Number.isSafeInteger(stallTimeoutMs)
        || stallTimeoutMs < 1 || stallTimeoutMs >= remaining || options.admitProgress === undefined)) {
      fail('operation stall deadline is invalid');
    }
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => { settle = resolve; });
    settlements.add(settlement);
    active += 1;
    try {
      const result = await runRetainedCommandBytes(retained.boundary, [
        ...boundedArguments(args)
      ], {
        env: lifecycle === 'observe' ? environment : await dockerDesktopLifecycleEnvironment(),
        envMode: 'replace',
        ...(options.input === undefined ? {} : {
          input: options.input,
          maxStdinBytes: options.maxStdinBytes ?? options.input.byteLength
        }),
        ...(stallTimeoutMs === undefined ? {} : {
          stallTimeoutMs,
          admitProgress: options.admitProgress
        }),
        maxStdoutBytes: stdoutBound,
        maxStderrBytes: stderrBound,
        timeoutMs: remaining
      });
      const commandResult = Object.freeze({
        code: result.code,
        stdout: Buffer.from(result.stdout),
        stderr: Buffer.from(result.stderr, 'utf8')
      });
      if (options.acceptAnyExitCode !== true
          && !(options.acceptedCodes ?? [0]).includes(commandResult.code)) {
        fail(`operation failed with ${commandResult.code}: ${commandResult.stderr
          .toString('utf8').slice(-8_192)}`);
      }
      return commandResult;
    } finally {
      active -= 1;
      settlements.delete(settlement);
      settle();
    }
  };

  try {
    let endpoint: DockerEndpointIdentity;
    if (input.expectedEndpoint === undefined) {
      const contextName = boundedIdentityText(
        (await rawRun(['context', 'show'])).stdout.toString('utf8').trim(),
        'context name',
        200
      );
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(contextName)) fail('context name is invalid');
      const context = parseJsonObject((await rawRun([
        'context', 'inspect', contextName, '--format', '{{json .}}'
      ])).stdout, 'context inspection');
      if (context.Name !== contextName) fail('context identity differs');
      const endpoints = context.Endpoints;
      const docker = endpoints !== null && typeof endpoints === 'object' && !Array.isArray(endpoints)
        ? (endpoints as Record<string, unknown>).docker
        : null;
      if (docker === null || typeof docker !== 'object' || Array.isArray(docker)) {
        fail('context has no Docker endpoint');
      }
      const endpointHost = dockerEndpointHost((docker as Record<string, unknown>).Host);
      const daemonRun = async (command: Readonly<{
        args: readonly string[];
        lifecycle: 'observe' | 'start';
      }>): Promise<DockerDaemonCommandResult> => {
        const result = await rawRun(
          command.args,
          { acceptAnyExitCode: true, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 },
          command.lifecycle
        );
        return Object.freeze({
          code: result.code,
          stdout: result.stdout.toString('utf8'),
          stderr: result.stderr.toString('utf8')
        });
      };
      const daemonInput = Object.freeze({
        cwd,
        deadlineAtUnixMs: input.deadlineAtUnixMs,
        endpointHost,
        run: daemonRun
      });
      const available = input.availability === 'ensure-started'
        ? await ensureDockerDaemonStartedWithCommand({
          ...daemonInput,
          withLauncherLock: async (operation) => await withDockerDesktopLauncherLock(
            { deadlineAtUnixMs: input.deadlineAtUnixMs, endpointHost },
            operation
          )
        })
        : await observeDockerDaemonWithCommand(daemonInput);
      endpoint = endpointFromInfo({
        contextName,
        endpointHost,
        info: Buffer.from(available.stdout, 'utf8')
      });
    } else {
      const expected = parseDockerEndpointIdentity(input.expectedEndpoint);
      const info = await rawRun([
        '--host', expected.endpointHost, 'info', '--format', '{{json .}}'
      ], { maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
      endpoint = endpointFromInfo({
        contextName: expected.contextName,
        endpointHost: expected.endpointHost,
        info: info.stdout
      });
      if (JSON.stringify(endpoint) !== JSON.stringify(expected)) {
        fail('expected endpoint identity changed');
      }
    }

    const session: ContainerEngineSession = Object.freeze({
      endpoint,
      cwd,
      executable: retained.executable,
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      maxStdoutBytes,
      maxStderrBytes,
      execute: async (
        operation: ContainerEngineOperation,
        options: ContainerEngineOperationOptions = {}
      ): Promise<ContainerEngineCommandResult> => await rawRun([
        '--host', endpoint.endpointHost, ...operationArguments(operation)
      ], options),
      close: async (): Promise<void> => {
        if (closed) return;
        if (closePromise !== null) return closePromise;
        closing = true;
        closePromise = (async () => {
          while (active > 0) await Promise.all([...settlements]);
          let closeFailure: unknown;
          try {
            retained.boundary.executable.assertCurrent();
            retained.boundary.workingDirectory.assertCurrent();
          } catch (error) {
            closeFailure = error;
          } finally {
            try { retained.boundary.workingDirectory.dispose(); } catch (error) { closeFailure ??= error; }
            try { retained.boundary.executable.dispose(); } catch (error) { closeFailure ??= error; }
            closed = true;
          }
          if (closeFailure !== undefined) throw closeFailure;
        })();
        return closePromise;
      }
    });
    return session;
  } catch (error) {
    try { retained.boundary.workingDirectory.dispose(); } catch { /* preserve admission failure */ }
    try { retained.boundary.executable.dispose(); } catch { /* preserve admission failure */ }
    throw error;
  }
}

export async function executeContainerEngineOperation(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
  endpoint: DockerEndpointIdentity;
  operation: ContainerEngineOperation;
  options?: ContainerEngineOperationOptions;
  maxStdoutBytes: number;
  maxStderrBytes: number;
}>): Promise<ContainerEngineCommandResult> {
  const session = await openContainerEngineSession({
    cwd: input.cwd,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    availability: 'observe',
    expectedEndpoint: input.endpoint,
    maxStdoutBytes: input.maxStdoutBytes,
    maxStderrBytes: input.maxStderrBytes
  });
  try {
    return await session.execute(input.operation, input.options);
  } finally {
    await session.close();
  }
}

export async function observeContainerEngineEndpointIdentity(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
}>): Promise<DockerEndpointIdentity> {
  const session = await openContainerEngineSession({
    ...input,
    availability: 'observe',
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024
  });
  try {
    return session.endpoint;
  } finally {
    await session.close();
  }
}

export async function ensureContainerEngineEndpointIdentity(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
}>): Promise<DockerEndpointIdentity> {
  const session = await openContainerEngineSession({
    ...input,
    availability: 'ensure-started',
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024
  });
  try {
    return session.endpoint;
  } finally {
    await session.close();
  }
}

export async function assertContainerEngineEndpointIdentity(input: Readonly<{
  cwd: string;
  deadlineAtUnixMs: number;
  expectedEndpoint: DockerEndpointIdentity;
}>): Promise<DockerEndpointIdentity> {
  const session = await openContainerEngineSession({
    ...input,
    availability: 'observe',
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 1024 * 1024
  });
  try {
    return session.endpoint;
  } finally {
    await session.close();
  }
}
