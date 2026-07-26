import { spawn, type ChildProcess } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import type { CommitFence } from '../../shared/fs.ts';
import { listFilesRecursive, pathExists, writeText } from '../../shared/fs.ts';
import { defaultLogger } from '../../shared/logger.ts';
import { compilerRoot, relativePosixPath } from '../../shared/paths.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  pathEnvKey,
  runCommand
} from '../../shared/process.ts';
import {
  dependencyAuthorityPaths,
  ensureProjectDependencies,
  materializePlaywrightBrowserCache
} from '../../shared/project-runtime.ts';
import type { RuntimeVerificationLaneReport, VerificationStatus, VerificationStepReport } from '../../shared/verification-types.ts';
import {
  withSemanticMutationIsolatedPhaseTelemetry,
  type SemanticMutationIsolatedPhase
} from '../semantic-mutation/isolated-verification-phase-telemetry.ts';
import {
  assertIsolatedStagingTree,
  type IsolatedStagingTreeOptions
} from './assert-isolated-staging-tree.ts';
import {
  RUNTIME_VERIFICATION_INVOCATION_CONTRACT,
  type RuntimeVerificationStep
} from './runtime-verification-invocation-contract.ts';
import {
  semanticMutationIsolatedBrowserPath,
  semanticMutationIsolatedNodeExecutablePath
} from './semantic-mutation-isolated-runtime-plan.ts';
import {
  assertRegisteredWindowsBrowserLaunchProofCurrent
} from './windows-browser-launch-path.ts';

type RuntimeVerificationMode = 'service' | 'full';

type RuntimeVerificationOptions = {
  beforeCommit?: CommitFence;
  browserLaunchProofForTests?: string;
  emitTiming?: boolean;
  isolated?: boolean;
  signal?: AbortSignal;
  stagingTreeOptions?: IsolatedStagingTreeOptions;
  stagingWorkspaceRoot?: string;
};

export function runtimeVerificationInvocation(
  step: RuntimeVerificationStep,
  projectRoot: string,
  isolated = false,
  isolatedConfigPath?: string,
  isolatedNodeExecutablePath?: string
): { command: string; args: string[] } {
  if (isolated && step === 'unit' && !isolatedConfigPath) {
    throw new Error('Isolated Bun invocation requires a fixed config path');
  }
  const descriptor = RUNTIME_VERIFICATION_INVOCATION_CONTRACT[step];
  if (!isolated) {
    return { command: 'bun', args: ['run', descriptor.packageScript] };
  }

  const canonicalProjectRoot = path.resolve(projectRoot);
  const moduleArg = descriptor.moduleRelativePath === null
    ? []
    : [path.join(canonicalProjectRoot, 'node_modules', ...descriptor.moduleRelativePath.split('/'))];
  if (step !== 'unit') {
    if (!isolatedNodeExecutablePath || !path.isAbsolute(isolatedNodeExecutablePath)) {
      throw new Error('Isolated Node invocation requires its fixed staged executable');
    }
    return {
      command: path.resolve(isolatedNodeExecutablePath),
      args: [...moduleArg, ...descriptor.argvTail]
    };
  }
  const fixedArgs = ['--no-env-file', `--config=${isolatedConfigPath!}`, '--no-install'];
  return {
    command: process.execPath,
    args: [...fixedArgs, ...moduleArg, ...descriptor.argvTail]
  };
}

interface DependencyPathMetadata {
  readonly identity: string;
  readonly isDirectory: boolean;
  readonly isSymbolicLink: boolean;
}

interface DependencyPathProbe {
  lstat(value: string): DependencyPathMetadata;
  realpath(value: string): string;
}

interface RuntimeAcceptancePathMetadata {
  readonly identity: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

interface RuntimeAcceptancePathProbe {
  lstat(value: string): RuntimeAcceptancePathMetadata;
  realpath(value: string): string;
}

export interface RuntimeAcceptanceShellAuthorityTestOptions {
  readonly additionalEnv?: NodeJS.ProcessEnv;
  readonly nodeExecutablePath: string;
  readonly platform: NodeJS.Platform;
  readonly probe: RuntimeAcceptancePathProbe;
  readonly source: NodeJS.ProcessEnv;
}

export interface IsolatedRuntimeDependencySources {
  readonly browserCache: string;
  readonly compilerModulesRoot: string;
  readonly dependencyModules: string;
}

export interface IsolatedRuntimeBuildNodeModulesProof {
  readonly nodeModulesBridge: string;
  readonly buildNodeModulesRoot: string;
  readonly bridgeMetadata: DependencyPathMetadata;
  readonly targetMetadata: DependencyPathMetadata;
}

export interface IsolatedRuntimeAcceptanceServerRequest {
  readonly beforeSpawn?: CommitFence;
  readonly environment: NodeJS.ProcessEnv;
  readonly nodeExecutablePath: string;
  readonly port: number;
  readonly projectRoot: string;
  readonly signal?: AbortSignal;
  readonly stagingWorkspaceRoot: string;
}

const NODE_DEPENDENCY_PATH_PROBE: DependencyPathProbe = Object.freeze({
  lstat(value: string): DependencyPathMetadata {
    const metadata = lstatSync(value);
    return Object.freeze({
      identity: [
        metadata.dev,
        metadata.ino,
        metadata.mode,
        metadata.nlink,
        metadata.size,
        metadata.ctimeMs,
        metadata.mtimeMs
      ].map(String).join(':'),
      isDirectory: metadata.isDirectory(),
      isSymbolicLink: metadata.isSymbolicLink()
    });
  },
  realpath: realpathSync
});

const NODE_RUNTIME_ACCEPTANCE_PATH_PROBE: RuntimeAcceptancePathProbe = Object.freeze({
  lstat(value: string): RuntimeAcceptancePathMetadata {
    const metadata = lstatSync(value);
    return Object.freeze({
      identity: [
        metadata.dev,
        metadata.ino,
        metadata.mode,
        metadata.nlink,
        metadata.size,
        metadata.ctimeMs,
        metadata.mtimeMs
      ].map(String).join(':'),
      isDirectory: metadata.isDirectory(),
      isFile: metadata.isFile(),
      isSymbolicLink: metadata.isSymbolicLink()
    });
  },
  realpath: realpathSync
});

function foldedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? resolved.toLocaleLowerCase('en-US')
    : resolved;
}

function foldedPathSegment(value: string): string {
  return process.platform === 'win32'
    ? value.toLocaleLowerCase('en-US')
    : value;
}

function sameMetadata(left: DependencyPathMetadata, right: DependencyPathMetadata): boolean {
  return left.identity === right.identity &&
    left.isDirectory === right.isDirectory &&
    left.isSymbolicLink === right.isSymbolicLink;
}

function frozenMetadata(value: DependencyPathMetadata): DependencyPathMetadata {
  return Object.freeze({
    identity: value.identity,
    isDirectory: value.isDirectory,
    isSymbolicLink: value.isSymbolicLink
  });
}

function provePhysicalNodeModulesBridgeWithProbe(
  root: string,
  probe: DependencyPathProbe
): Readonly<IsolatedRuntimeBuildNodeModulesProof> | undefined {
  try {
    const nodeModulesBridge = dependencyAuthorityPaths(root).compilerModulesRoot;
    const bridgeBefore = probe.lstat(nodeModulesBridge);
    const buildNodeModulesRoot = probe.realpath(nodeModulesBridge);
    const bridgeAfter = probe.lstat(nodeModulesBridge);
    if (!sameMetadata(bridgeBefore, bridgeAfter) ||
      foldedPathSegment(path.basename(buildNodeModulesRoot)) !== 'node_modules') {
      return undefined;
    }

    const targetBefore = probe.lstat(buildNodeModulesRoot);
    if (!targetBefore.isDirectory || targetBefore.isSymbolicLink) return undefined;
    const canonicalTarget = probe.realpath(buildNodeModulesRoot);
    const targetAfter = probe.lstat(buildNodeModulesRoot);
    if (!sameMetadata(targetBefore, targetAfter) ||
      foldedPath(canonicalTarget) !== foldedPath(buildNodeModulesRoot)) {
      return undefined;
    }

    return Object.freeze({
      nodeModulesBridge,
      buildNodeModulesRoot,
      bridgeMetadata: frozenMetadata(bridgeAfter),
      targetMetadata: frozenMetadata(targetAfter)
    });
  } catch {
    return undefined;
  }
}

function sameBuildNodeModulesProof(
  left: IsolatedRuntimeBuildNodeModulesProof,
  right: IsolatedRuntimeBuildNodeModulesProof
): boolean {
  return foldedPath(left.nodeModulesBridge) === foldedPath(right.nodeModulesBridge) &&
    foldedPath(left.buildNodeModulesRoot) === foldedPath(right.buildNodeModulesRoot) &&
    sameMetadata(left.bridgeMetadata, right.bridgeMetadata) &&
    sameMetadata(left.targetMetadata, right.targetMetadata);
}

function stableCanonicalPhysicalDirectory(value: string, probe: DependencyPathProbe): boolean {
  try {
    const before = probe.lstat(value);
    if (!before.isDirectory || before.isSymbolicLink) return false;
    const physical = probe.realpath(value);
    const after = probe.lstat(value);
    return sameMetadata(before, after) && foldedPath(physical) === foldedPath(value);
  } catch {
    return false;
  }
}

function fallbackDependencySources(root: string): Readonly<IsolatedRuntimeDependencySources> {
  const authority = dependencyAuthorityPaths(root);
  return Object.freeze({
    browserCache: authority.browserCache,
    compilerModulesRoot: authority.compilerModulesRoot,
    dependencyModules: authority.compilerModulesRoot
  });
}

function resolveIsolatedRuntimeDependencySourcesWithProbe(
  root: string,
  probe: DependencyPathProbe
): Readonly<IsolatedRuntimeDependencySources> {
  const fallback = fallbackDependencySources(root);
  try {
    const buildProof = provePhysicalNodeModulesBridgeWithProbe(root, probe);
    if (!buildProof) return fallback;
    const physicalNodeModules = buildProof.buildNodeModulesRoot;

    const physicalParent = path.dirname(physicalNodeModules);
    const dependencyHost = foldedPathSegment(path.basename(physicalParent)) === '.shared-deps'
      ? path.dirname(physicalParent)
      : physicalParent;
    const authority = dependencyAuthorityPaths(dependencyHost);
    const dependencyModules = stableCanonicalPhysicalDirectory(authority.dependencyModules, probe)
      ? authority.dependencyModules
      : physicalNodeModules;
    const browserCache = stableCanonicalPhysicalDirectory(authority.browserCache, probe)
      ? authority.browserCache
      : fallback.browserCache;
    return Object.freeze({
      browserCache,
      compilerModulesRoot: physicalNodeModules,
      dependencyModules
    });
  } catch {
    return fallback;
  }
}

/** Test-only pure seam for physical dependency bridge and cache proofs. */
export function resolveIsolatedRuntimeDependencySourcesForTests(
  root: string,
  probe: DependencyPathProbe
): Readonly<IsolatedRuntimeDependencySources> {
  return resolveIsolatedRuntimeDependencySourcesWithProbe(root, probe);
}

export function resolveIsolatedRuntimeDependencySources(): Readonly<IsolatedRuntimeDependencySources> {
  return resolveIsolatedRuntimeDependencySourcesWithProbe(compilerRoot, NODE_DEPENDENCY_PATH_PROBE);
}

function captureIsolatedRuntimeBuildNodeModulesProofWithProbe(
  root: string,
  probe: DependencyPathProbe
): Readonly<IsolatedRuntimeBuildNodeModulesProof> {
  const proof = provePhysicalNodeModulesBridgeWithProbe(root, probe);
  if (!proof) {
    throw new Error('Isolated runtime build node_modules root could not be proven');
  }
  return proof;
}

function revalidateIsolatedRuntimeBuildNodeModulesProofWithProbe(
  root: string,
  proof: IsolatedRuntimeBuildNodeModulesProof,
  probe: DependencyPathProbe
): string {
  const current = provePhysicalNodeModulesBridgeWithProbe(root, probe);
  if (!current || !sameBuildNodeModulesProof(proof, current)) {
    throw new Error('Isolated runtime build node_modules proof changed during bundle build');
  }
  return current.buildNodeModulesRoot;
}

export function captureIsolatedRuntimeBuildNodeModulesProof(): Readonly<IsolatedRuntimeBuildNodeModulesProof> {
  return captureIsolatedRuntimeBuildNodeModulesProofWithProbe(compilerRoot, NODE_DEPENDENCY_PATH_PROBE);
}

export function revalidateIsolatedRuntimeBuildNodeModulesProof(
  proof: IsolatedRuntimeBuildNodeModulesProof
): string {
  return revalidateIsolatedRuntimeBuildNodeModulesProofWithProbe(
    compilerRoot,
    proof,
    NODE_DEPENDENCY_PATH_PROBE
  );
}

/** Test-only pure seams for the frozen build-root proof lifecycle. */
export function captureIsolatedRuntimeBuildNodeModulesProofForTests(
  root: string,
  probe: DependencyPathProbe
): Readonly<IsolatedRuntimeBuildNodeModulesProof> {
  return captureIsolatedRuntimeBuildNodeModulesProofWithProbe(root, probe);
}

export function revalidateIsolatedRuntimeBuildNodeModulesProofForTests(
  root: string,
  proof: IsolatedRuntimeBuildNodeModulesProof,
  probe: DependencyPathProbe
): string {
  return revalidateIsolatedRuntimeBuildNodeModulesProofWithProbe(root, proof, probe);
}

export function isolatedPlaywrightBrowsersPath(): string {
  return dependencyAuthorityPaths().browserCache;
}

export function buildIsolatedRuntimeEnvironment(
  stagingWorkspaceRoot: string,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return buildIsolatedRuntimeEnvironmentFromSource(stagingWorkspaceRoot, additionalEnv, process.env);
}

function runtimeOwnedDirectoryPath(value: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? path.win32.toNamespacedPath(value) : value;
}

function ordinaryWindowsPath(value: string): string {
  const normalized = path.win32.normalize(value);
  if (normalized.startsWith('\\\\?\\UNC\\')) return `\\\\${normalized.slice(8)}`;
  return normalized.startsWith('\\\\?\\') ? normalized.slice(4) : normalized;
}

function samePhysicalRuntimePath(
  left: string,
  right: string,
  platform: NodeJS.Platform
): boolean {
  if (platform !== 'win32') return path.resolve(left) === path.resolve(right);
  return ordinaryWindowsPath(left).toLocaleLowerCase('en-US') ===
    ordinaryWindowsPath(right).toLocaleLowerCase('en-US');
}

function runtimeBrowserLaunchPath(
  stagingWorkspaceRoot: string,
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string {
  const physicalBrowserCache = semanticMutationIsolatedBrowserPath(
    stagingWorkspaceRoot,
    platform
  );
  const inheritedLaunchPath = source[ISOLATED_VERIFICATION_ENV_KEY] === '1'
    ? source.PLAYWRIGHT_BROWSERS_PATH
    : undefined;
  if (inheritedLaunchPath === undefined) {
    return physicalBrowserCache;
  }
  if (!path.isAbsolute(inheritedLaunchPath)) {
    throw new Error('Inherited browser launch path must be absolute');
  }
  const physicalTarget = realpathSync(physicalBrowserCache);
  const launchTarget = realpathSync(inheritedLaunchPath);
  if (!samePhysicalRuntimePath(physicalTarget, launchTarget, platform)) {
    throw new Error('Inherited browser launch path does not bind the staged browser cache');
  }
  return inheritedLaunchPath;
}

function runtimeTempDirectoryPath(value: string, platform: NodeJS.Platform): string {
  return runtimeOwnedDirectoryPath(value, platform);
}

/** Test-only pure seam for staging-owned runtime directory representations. */
export function runtimeOwnedDirectoryPathForTests(
  value: string,
  platform: NodeJS.Platform
): string {
  return runtimeOwnedDirectoryPath(value, platform);
}

/** Test-only pure seam for the Windows runtime TEMP representation. */
export function runtimeTempDirectoryPathForTests(
  value: string,
  platform: NodeJS.Platform
): string {
  return runtimeTempDirectoryPath(value, platform);
}

function buildIsolatedRuntimeEnvironmentFromSource(
  stagingWorkspaceRoot: string,
  additionalEnv: NodeJS.ProcessEnv,
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const browserCacheDirectory = runtimeBrowserLaunchPath(stagingWorkspaceRoot, source, platform);
  const environment = buildIsolatedProcessEnvironment(
    path.join(stagingWorkspaceRoot, '.isolated-process', 'runtime'),
    {
      ...additionalEnv,
      [ISOLATED_VERIFICATION_ENV_KEY]: '1',
      CI: 'true',
      PLAYWRIGHT_BROWSERS_PATH: browserCacheDirectory,
      PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
    },
    source
  );
  const tempDirectory = environment.TEMP;
  if (!tempDirectory || environment.TMP !== tempDirectory || environment.TMPDIR !== tempDirectory) {
    throw new Error('Isolated runtime TEMP authority is inconsistent');
  }
  const runtimeTemp = runtimeTempDirectoryPath(tempDirectory, platform);
  environment.TEMP = runtimeTemp;
  environment.TMP = runtimeTemp;
  environment.TMPDIR = runtimeTemp;
  return environment;
}

/** Test-only source seam for the parent-issued browser launch-path binding. */
export function buildIsolatedRuntimeEnvironmentFromSourceForTests(
  stagingWorkspaceRoot: string,
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return buildIsolatedRuntimeEnvironmentFromSource(
    stagingWorkspaceRoot,
    additionalEnv,
    source,
    platform
  );
}

function runtimeAcceptanceShellAuthorityError(reason: string): Error {
  return new Error(`Runtime acceptance shell authority is invalid: ${reason}`);
}

function runtimeAcceptancePathApi(platform: NodeJS.Platform): typeof path.win32 {
  return platform === 'win32' ? path.win32 : path.posix;
}

function foldedRuntimeAcceptancePath(value: string, platform: NodeJS.Platform): string {
  const resolved = runtimeAcceptancePathApi(platform).resolve(value);
  return platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function sameRuntimeAcceptancePathMetadata(
  left: RuntimeAcceptancePathMetadata,
  right: RuntimeAcceptancePathMetadata
): boolean {
  return left.identity === right.identity &&
    left.isDirectory === right.isDirectory &&
    left.isFile === right.isFile &&
    left.isSymbolicLink === right.isSymbolicLink;
}

function uniqueEnvironmentValue(source: NodeJS.ProcessEnv, key: string): string {
  const matches = Object.entries(source).filter(([candidate, value]) => (
    candidate.toLocaleLowerCase('en-US') === key.toLocaleLowerCase('en-US') && value !== undefined
  ));
  if (matches.length !== 1) {
    throw runtimeAcceptanceShellAuthorityError(`${key} must have one case-insensitive source`);
  }
  return matches[0]![1]!;
}

function withoutEnvironmentKeys(
  source: NodeJS.ProcessEnv,
  removedKeys: readonly string[]
): NodeJS.ProcessEnv {
  const removed = new Set(removedKeys.map((key) => key.toLocaleLowerCase('en-US')));
  return Object.fromEntries(Object.entries(source).filter(([key]) => (
    !removed.has(key.toLocaleLowerCase('en-US'))
  )));
}

function assertUniqueEnvironmentKeys(source: NodeJS.ProcessEnv): void {
  const keys = new Set<string>();
  for (const key of Object.keys(source)) {
    const folded = key.toLocaleLowerCase('en-US');
    if (keys.has(folded)) {
      throw runtimeAcceptanceShellAuthorityError('environment keys must be case-insensitively unique');
    }
    keys.add(folded);
  }
}

function proveRuntimeAcceptancePhysicalPath(
  value: string,
  expectedKind: 'directory' | 'file',
  label: string,
  platform: NodeJS.Platform,
  probe: RuntimeAcceptancePathProbe
): Readonly<{ metadata: RuntimeAcceptancePathMetadata; physicalPath: string }> {
  const pathApi = runtimeAcceptancePathApi(platform);
  try {
    if (!pathApi.isAbsolute(value)) throw new Error('relative');
    const resolved = pathApi.resolve(value);
    const before = probe.lstat(resolved);
    const kindMatches = expectedKind === 'directory' ? before.isDirectory : before.isFile;
    if (!kindMatches || before.isSymbolicLink) throw new Error('kind');
    const physicalPath = probe.realpath(resolved);
    const after = probe.lstat(resolved);
    if (!sameRuntimeAcceptancePathMetadata(before, after) ||
      foldedRuntimeAcceptancePath(physicalPath, platform) !== foldedRuntimeAcceptancePath(resolved, platform)) {
      throw new Error('identity');
    }
    return Object.freeze({ metadata: before, physicalPath });
  } catch {
    throw runtimeAcceptanceShellAuthorityError(`${label} must be one stable physical ${expectedKind}`);
  }
}

function buildIsolatedRuntimeAcceptanceEnvironmentWithAuthority(
  stagingWorkspaceRoot: string,
  options: RuntimeAcceptanceShellAuthorityTestOptions
): NodeJS.ProcessEnv {
  const pathApi = runtimeAcceptancePathApi(options.platform);
  const genericEnvironment = buildIsolatedRuntimeEnvironmentFromSource(
    stagingWorkspaceRoot,
    options.additionalEnv ?? {},
    options.source
  );
  const environment = withoutEnvironmentKeys(genericEnvironment, [
    'PATH',
    'ComSpec',
    'PATHEXT',
    'SystemRoot',
    'WINDIR'
  ]);
  const expectedNodeExecutablePath = semanticMutationIsolatedNodeExecutablePath(
    stagingWorkspaceRoot,
    options.platform
  );
  const nodeExecutable = proveRuntimeAcceptancePhysicalPath(
    options.nodeExecutablePath,
    'file',
    'staged Node executable',
    options.platform,
    options.probe
  );
  if (foldedRuntimeAcceptancePath(nodeExecutable.physicalPath, options.platform) !==
    foldedRuntimeAcceptancePath(expectedNodeExecutablePath, options.platform)) {
    throw runtimeAcceptanceShellAuthorityError('Node must be the exact staged executable');
  }
  const nodeDirectory = proveRuntimeAcceptancePhysicalPath(
    pathApi.dirname(nodeExecutable.physicalPath),
    'directory',
    'staged Node directory',
    options.platform,
    options.probe
  );

  if (options.platform !== 'win32') {
    environment.PATH = nodeDirectory.physicalPath;
    assertUniqueEnvironmentKeys(environment);
    return environment;
  }

  const systemRoot = proveRuntimeAcceptancePhysicalPath(
    uniqueEnvironmentValue(options.source, 'SystemRoot'),
    'directory',
    'SystemRoot',
    options.platform,
    options.probe
  );
  const windowsDirectory = proveRuntimeAcceptancePhysicalPath(
    uniqueEnvironmentValue(options.source, 'WINDIR'),
    'directory',
    'WINDIR',
    options.platform,
    options.probe
  );
  if (systemRoot.metadata.identity !== windowsDirectory.metadata.identity ||
    foldedRuntimeAcceptancePath(systemRoot.physicalPath, options.platform) !==
      foldedRuntimeAcceptancePath(windowsDirectory.physicalPath, options.platform)) {
    throw runtimeAcceptanceShellAuthorityError('SystemRoot and WINDIR must resolve to one authority');
  }
  const systemDirectory = proveRuntimeAcceptancePhysicalPath(
    pathApi.join(systemRoot.physicalPath, 'System32'),
    'directory',
    'System32',
    options.platform,
    options.probe
  );
  const commandShell = proveRuntimeAcceptancePhysicalPath(
    pathApi.join(systemDirectory.physicalPath, 'cmd.exe'),
    'file',
    'cmd.exe',
    options.platform,
    options.probe
  );
  proveRuntimeAcceptancePhysicalPath(
    pathApi.join(systemDirectory.physicalPath, 'taskkill.exe'),
    'file',
    'taskkill.exe',
    options.platform,
    options.probe
  );

  environment.PATH = [systemDirectory.physicalPath, nodeDirectory.physicalPath].join(pathApi.delimiter);
  environment.SystemRoot = systemRoot.physicalPath;
  environment.WINDIR = systemRoot.physicalPath;
  environment.ComSpec = commandShell.physicalPath;
  environment.PATHEXT = '.EXE';
  assertUniqueEnvironmentKeys(environment);
  return environment;
}

export function buildIsolatedRuntimeAcceptanceEnvironment(
  stagingWorkspaceRoot: string,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return buildIsolatedRuntimeAcceptanceEnvironmentWithAuthority(stagingWorkspaceRoot, {
    additionalEnv,
    nodeExecutablePath: semanticMutationIsolatedNodeExecutablePath(stagingWorkspaceRoot),
    platform: process.platform,
    probe: NODE_RUNTIME_ACCEPTANCE_PATH_PROBE,
    source: process.env
  });
}

/** Test-only pure seam for cross-platform acceptance shell authority vectors. */
export function buildIsolatedRuntimeAcceptanceEnvironmentForTests(
  stagingWorkspaceRoot: string,
  options: RuntimeAcceptanceShellAuthorityTestOptions
): NodeJS.ProcessEnv {
  return buildIsolatedRuntimeAcceptanceEnvironmentWithAuthority(stagingWorkspaceRoot, options);
}

function createRuntimeStepReport(
  status: VerificationStatus,
  passed: string[],
  failed: string[],
  command: string
): VerificationStepReport {
  return { status, passed, failed, command };
}

function createSkippedRuntimeStep(command: string): VerificationStepReport {
  return createRuntimeStepReport('skipped', [], [], command);
}

function createRuntimeCommandStep(command: string, code: number, files: string[]): VerificationStepReport {
  return createRuntimeStepReport(normalizeStatus(code), code === 0 ? files : [], code === 0 ? [] : files, command);
}

export function createSkippedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: createSkippedRuntimeStep(RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.logicalCommandLabel),
    unit: createSkippedRuntimeStep(RUNTIME_VERIFICATION_INVOCATION_CONTRACT.unit.logicalCommandLabel),
    acceptance: createSkippedRuntimeStep(
      RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.logicalCommandLabel
    ),
    logs: {
      stdout: '',
      stderr: ''
    }
  };
}

function generatePort(projectRoot: string, isolated: boolean): number {
  const basePort = 3000;
  const workerId = isolated ? 0 : parseInt(process.env.VITEST_POOL_ID ?? '0', 10);
  const pathHash = [...projectRoot].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 1000,
    0
  );
  return basePort + workerId * 1000 + pathHash;
}

const RUNTIME_ACCEPTANCE_SERVER_START_TIMEOUT_MS = 120_000;
const RUNTIME_ACCEPTANCE_SERVER_STOP_TIMEOUT_MS = 5_000;
const RUNTIME_ACCEPTANCE_SERVER_POLL_MS = 100;
const RUNTIME_ACCEPTANCE_SERVER_DIAGNOSTIC_LIMIT = 16 * 1024;

function appendRuntimeAcceptanceServerDiagnostic(current: string, chunk: unknown): string {
  if (current.length >= RUNTIME_ACCEPTANCE_SERVER_DIAGNOSTIC_LIMIT) return current;
  return (current + String(chunk)).slice(0, RUNTIME_ACCEPTANCE_SERVER_DIAGNOSTIC_LIMIT);
}

function runtimeAcceptanceDirectChildReportedReady(stdout: string, stderr: string): boolean {
  return /(?:^|\r?\n).*Ready in [0-9]/u.test(`${stdout}\n${stderr}`);
}

/** Test-only direct-child readiness ownership seam. */
export function runtimeAcceptanceDirectChildReportedReadyForTests(
  stdout: string,
  stderr: string
): boolean {
  return runtimeAcceptanceDirectChildReportedReady(stdout, stderr);
}

function runtimeAcceptanceServerError(message: string, stdout: string, stderr: string): Error {
  const diagnostic = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
  return new Error(diagnostic.length > 0 ? `${message}\n${diagnostic}` : message);
}

async function waitForRuntimeAcceptanceServerClose(
  child: ChildProcess,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise<boolean>((resolve) => {
    const onClose = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      child.removeListener('close', onClose);
      resolve(false);
    }, timeoutMs);
    child.once('close', onClose);
  });
}

async function stopRuntimeAcceptanceServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (await waitForRuntimeAcceptanceServerClose(
    child,
    RUNTIME_ACCEPTANCE_SERVER_STOP_TIMEOUT_MS
  )) return;
  child.kill('SIGKILL');
  if (!(await waitForRuntimeAcceptanceServerClose(
    child,
    RUNTIME_ACCEPTANCE_SERVER_STOP_TIMEOUT_MS
  ))) {
    throw new Error('Isolated runtime acceptance server did not close');
  }
}

export class RuntimeAcceptancePortReleaseError extends Error {
  readonly code = 'VERIFY-RUNTIME-PORT-RELEASE' as const;

  constructor(public readonly port: number) {
    super(`Isolated runtime acceptance port ${port} was not released`);
    this.name = 'RuntimeAcceptancePortReleaseError';
  }
}

export class RuntimeAcceptancePortOccupationError extends Error {
  readonly code = 'VERIFY-RUNTIME-PORT-OCCUPIED' as const;

  constructor(public readonly port: number) {
    super(`Isolated runtime acceptance port ${port} is already occupied`);
    this.name = 'RuntimeAcceptancePortOccupationError';
  }
}

async function runtimeAcceptanceServerIsReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/login`, {
      signal: AbortSignal.timeout(1_000)
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function canExclusivelyBindRuntimeAcceptancePort(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const server = createServer();
    let settled = false;
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      action();
    };
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      settle(() => {
        if (error.code === 'EADDRINUSE') resolve(false);
        else reject(error);
      });
    });
    server.listen({
      exclusive: true,
      host: '127.0.0.1',
      port
    }, () => {
      server.close((error) => settle(() => {
        if (error) reject(error);
        else resolve(true);
      }));
    });
  });
}

async function assertRuntimeAcceptancePortReleased(
  port: number,
  timeoutMs = RUNTIME_ACCEPTANCE_SERVER_STOP_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await canExclusivelyBindRuntimeAcceptancePort(port)) return;
    if (Date.now() >= deadline) break;
    await delayRuntimeAcceptanceServerPoll();
  } while (true);
  throw new RuntimeAcceptancePortReleaseError(port);
}

async function assertRuntimeAcceptancePortAvailable(port: number): Promise<void> {
  if (!(await canExclusivelyBindRuntimeAcceptancePort(port))) {
    throw new RuntimeAcceptancePortOccupationError(port);
  }
}

/** Test-only production port-release proof seam. */
export function assertRuntimeAcceptancePortReleasedForTests(
  port: number,
  timeoutMs: number
): Promise<void> {
  return assertRuntimeAcceptancePortReleased(port, timeoutMs);
}

/** Test-only production pre-start occupation seam. */
export function assertRuntimeAcceptancePortAvailableForTests(port: number): Promise<void> {
  return assertRuntimeAcceptancePortAvailable(port);
}

async function delayRuntimeAcceptanceServerPoll(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve) => setTimeout(resolve, RUNTIME_ACCEPTANCE_SERVER_POLL_MS));
  signal?.throwIfAborted();
}

async function withRuntimeAcceptanceCleanup<T>(
  execute: () => Promise<T>,
  cleanup: () => Promise<void>
): Promise<T> {
  let primaryError: unknown;
  try {
    return await execute();
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (primaryError !== undefined) {
        throw new AggregateError(
          [primaryError, cleanupError],
          'Isolated runtime acceptance execution and server cleanup both failed'
        );
      }
      throw cleanupError;
    }
  }
}

/** Test-only production execution/cleanup aggregation seam. */
export function withRuntimeAcceptanceCleanupForTests<T>(
  execute: () => Promise<T>,
  cleanup: () => Promise<void>
): Promise<T> {
  return withRuntimeAcceptanceCleanup(execute, cleanup);
}

/**
 * Keeps isolated Next lifecycle under the SEC verifier instead of Playwright's
 * Windows shell/taskkill fallback. The generated Playwright config only
 * observes and reuses this exact ready server.
 */
export async function withIsolatedRuntimeAcceptanceServer<T>(
  request: IsolatedRuntimeAcceptanceServerRequest,
  execute: () => Promise<T>
): Promise<T> {
  if (!path.isAbsolute(request.projectRoot) ||
    !path.isAbsolute(request.nodeExecutablePath) ||
    !path.isAbsolute(request.stagingWorkspaceRoot) ||
    !Number.isSafeInteger(request.port) ||
    request.port < 1 ||
    request.port > 65_535) {
    throw new Error('Isolated runtime acceptance server request is invalid');
  }
  const stagingWorkspaceRoot = path.resolve(request.stagingWorkspaceRoot);
  const projectRoot = path.resolve(request.projectRoot);
  if (foldedPath(projectRoot) !== foldedPath(path.join(stagingWorkspaceRoot, 'project')) ||
    foldedPath(request.nodeExecutablePath) !== foldedPath(
      semanticMutationIsolatedNodeExecutablePath(stagingWorkspaceRoot)
    ) ||
    request.environment[ISOLATED_VERIFICATION_ENV_KEY] !== '1' ||
    request.environment.TEST_PORT !== String(request.port)) {
    throw new Error('Isolated runtime acceptance server authority is invalid');
  }
  request.signal?.throwIfAborted();
  await request.beforeSpawn?.();
  request.signal?.throwIfAborted();
  await assertRuntimeAcceptancePortAvailable(request.port);
  const nextModule = path.join(
    projectRoot,
    'node_modules',
    'next',
    'dist',
    'bin',
    'next'
  );
  const child = spawn(path.resolve(request.nodeExecutablePath), [
    nextModule,
    'start',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(request.port)
  ], {
    cwd: projectRoot,
    env: request.environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  let spawnError: Error | undefined;
  child.stdout?.on('data', (chunk) => {
    stdout = appendRuntimeAcceptanceServerDiagnostic(stdout, chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderr = appendRuntimeAcceptanceServerDiagnostic(stderr, chunk);
  });
  child.once('error', (error) => {
    spawnError = error;
  });

  return await withRuntimeAcceptanceCleanup(async () => {
    const deadline = Date.now() + RUNTIME_ACCEPTANCE_SERVER_START_TIMEOUT_MS;
    while (true) {
      const httpReady = await runtimeAcceptanceServerIsReady(request.port);
      if (httpReady && runtimeAcceptanceDirectChildReportedReady(stdout, stderr)) break;
      request.signal?.throwIfAborted();
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw runtimeAcceptanceServerError(
          'Isolated runtime acceptance server exited before readiness',
          stdout,
          stderr
        );
      }
      if (Date.now() >= deadline) {
        throw runtimeAcceptanceServerError(
          'Isolated runtime acceptance server readiness timed out',
          stdout,
          stderr
        );
      }
      await delayRuntimeAcceptanceServerPoll(request.signal);
    }
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw runtimeAcceptanceServerError(
        'Isolated runtime acceptance server exited after readiness',
        stdout,
        stderr
      );
    }
    await request.beforeSpawn?.();
    request.signal?.throwIfAborted();
    return await execute();
  }, async () => {
    await stopRuntimeAcceptanceServer(child);
    await assertRuntimeAcceptancePortReleased(request.port);
    await request.beforeSpawn?.();
  });
}

function normalizeStatus(code: number): VerificationStatus {
  return code === 0 ? 'passed' : 'failed';
}

export function normalizeRuntimeVerificationLog(value: string): string {
  return value.replace(/\[[0-9]+(?:\.[0-9]+)?(?:ms|s)\]/g, '[duration]');
}

function appendCommandOutput(
  logs: RuntimeVerificationLaneReport['logs'],
  result: {
    code: number;
    stdout: string;
    stderr: string;
  },
  passedSummary: string
): void {
  logs.stdout += result.code === 0 ? `${passedSummary}\n` : result.stdout;
  if (result.code !== 0) {
    logs.stderr += normalizeRuntimeVerificationLog(result.stderr);
  }
}

function relativeFiles(rootDir: string, files: string[]): string[] {
  return files
    .map((file) => relativePosixPath(rootDir, file))
    .sort((left, right) => left.localeCompare(right));
}

async function timed<T>(
  label: string,
  emitTiming: boolean,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  const result = await fn();
  if (emitTiming) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    defaultLogger.info('Runtime verification step timing', { label, elapsedSeconds: elapsed });
  }
  return result;
}

async function ensurePlaywrightBrowser(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  materialize: typeof materializePlaywrightBrowserCache = materializePlaywrightBrowserCache
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const result = await materialize({
    environment: env,
    playwrightProjectRoot: projectRoot,
    signal
  });
  return result.commandResult;
}

/** Test-only behavioral seam for the non-isolated runtime browser delegation. */
export async function ensurePlaywrightBrowserForTests(
  projectRoot: string,
  env: NodeJS.ProcessEnv,
  options: {
    readonly materialize?: typeof materializePlaywrightBrowserCache;
    readonly signal?: AbortSignal;
  } = {}
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return ensurePlaywrightBrowser(projectRoot, env, options.signal, options.materialize);
}

export async function runRuntimeVerification(
  projectRoot: string,
  mode: RuntimeVerificationMode = 'full',
  options: RuntimeVerificationOptions = {}
): Promise<RuntimeVerificationLaneReport> {
  const emitTiming = options.emitTiming ?? true;
  const isolated = options.isolated === true;
  if (isolated && !options.stagingWorkspaceRoot) {
    throw new Error('Isolated runtime verification requires its staging workspace root');
  }
  const withIsolatedPhaseTelemetry = async <T>(
    phase: SemanticMutationIsolatedPhase,
    execute: () => Promise<T>
  ): Promise<T> => isolated
    ? await withSemanticMutationIsolatedPhaseTelemetry(
        options.stagingWorkspaceRoot!,
        phase,
        execute
      )
    : await execute();
  const { runtimeUnitFiles, runtimeAcceptanceFiles } = await withIsolatedPhaseTelemetry(
    'runtime-test-discovery',
    async () => {
      const runtimeUnitFiles = relativeFiles(
        projectRoot,
        (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'unit')))
          .filter((file) => file.endsWith('.test.ts'))
      );
      const runtimeAcceptanceFiles = relativeFiles(
        projectRoot,
        (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'acceptance')))
          .filter((file) => file.endsWith('.spec.ts'))
      );
      return { runtimeUnitFiles, runtimeAcceptanceFiles };
    }
  );

  await withIsolatedPhaseTelemetry('runtime-dependency-validation', () =>
    timed('project deps materialize', emitTiming, () => ensureProjectDependencies(projectRoot, {
      beforeCommit: options.beforeCommit,
      signal: options.signal,
      skipSharedDepsWarmup: true,
      ...(isolated ? { installMode: 'prebound-only' as const } : {})
    }))
  );

  const isolatedRuntimeRoot = options.stagingWorkspaceRoot
    ? path.join(options.stagingWorkspaceRoot, '.isolated-process', 'runtime')
    : undefined;
  const isolatedConfigPath = isolatedRuntimeRoot
    ? path.join(isolatedRuntimeRoot, 'bunfig.toml')
    : undefined;
  const isolatedNodeExecutablePath = isolated
    ? semanticMutationIsolatedNodeExecutablePath(options.stagingWorkspaceRoot!)
    : undefined;
  if (isolatedRuntimeRoot && isolatedConfigPath) {
    await withIsolatedPhaseTelemetry('runtime-process-environment-materialize', async () => {
      await ensureIsolatedProcessDirectories(isolatedRuntimeRoot, options.beforeCommit);
      await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
    });
  }
  const envPathKey = pathEnvKey();
  const baseEnv = isolated
    ? buildIsolatedRuntimeEnvironment(options.stagingWorkspaceRoot!)
    : {
        ...process.env,
        [envPathKey]: `${path.join(dependencyAuthorityPaths().compilerModulesRoot, '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`,
        PLAYWRIGHT_BROWSERS_PATH: isolatedPlaywrightBrowsersPath()
      };
  const lane = createSkippedRuntimeLane();
  if (isolated) {
    await withIsolatedPhaseTelemetry('runtime-staging-tree-validation', () =>
      assertIsolatedStagingTree(options.stagingWorkspaceRoot!, options.stagingTreeOptions)
    );
  }
  const runRuntimeCommand = async (
    invocation: { readonly command: string; readonly args: string[] },
    env: NodeJS.ProcessEnv,
    beforeSpawn: CommitFence | undefined = isolated ? options.beforeCommit : undefined
  ) => {
    const result = await runCommand(invocation.command, invocation.args, {
      beforeSpawn,
      cwd: projectRoot,
      env,
      signal: options.signal,
      ...(isolated ? { envMode: 'replace' as const } : {})
    });
    if (isolated) await options.beforeCommit?.();
    return result;
  };

  try {
    if (mode === 'full') {
      const buildInvocation = runtimeVerificationInvocation(
        'build',
        projectRoot,
        isolated,
        isolatedConfigPath,
        isolatedNodeExecutablePath
      );
      const buildResult = await timed('next build', emitTiming, () =>
        withIsolatedPhaseTelemetry('next-build', () => runRuntimeCommand(buildInvocation, baseEnv))
      );
      lane.status = normalizeStatus(buildResult.code);
      lane.build = createRuntimeCommandStep(
        RUNTIME_VERIFICATION_INVOCATION_CONTRACT.build.logicalCommandLabel,
        buildResult.code,
        ['next build']
      );
      appendCommandOutput(lane.logs, buildResult, 'runtime-build:passed');

      if (buildResult.code !== 0) {
        return lane;
      }
    }

    if (runtimeUnitFiles.length > 0) {
      const unitInvocation = runtimeVerificationInvocation(
        'unit',
        projectRoot,
        isolated,
        isolatedConfigPath,
        isolatedNodeExecutablePath
      );
      const unitResult = await timed('bun unit', emitTiming, () =>
        withIsolatedPhaseTelemetry('unit', () => runRuntimeCommand(unitInvocation, baseEnv))
      );
      lane.unit = createRuntimeCommandStep(
        RUNTIME_VERIFICATION_INVOCATION_CONTRACT.unit.logicalCommandLabel,
        unitResult.code,
        runtimeUnitFiles
      );
      appendCommandOutput(lane.logs, unitResult, `runtime-unit:passed ${runtimeUnitFiles.join(',')}`);
      lane.status = normalizeStatus(unitResult.code);

      if (unitResult.code !== 0) {
        return lane;
      }
    }

    if (mode === 'service') {
      lane.status = 'passed';
      return lane;
    }

    if (runtimeAcceptanceFiles.length === 0) {
      lane.status = 'passed';
      lane.acceptance = {
        status: 'passed',
        passed: [],
        failed: [],
        command: RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.logicalCommandLabel
      };
      return lane;
    }

    if (isolated) {
      if (!(await pathExists(semanticMutationIsolatedBrowserPath(options.stagingWorkspaceRoot!)))) {
        lane.logs.stderr += 'Preinstalled Playwright browser cache is unavailable\n';
        lane.acceptance = createRuntimeStepReport(
          'failed',
          [],
          runtimeAcceptanceFiles,
          RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.logicalCommandLabel
        );
        lane.status = 'failed';
        return lane;
      }
    } else {
      const browserInstallResult = await timed('playwright install', emitTiming, () =>
        ensurePlaywrightBrowser(projectRoot, baseEnv, options.signal)
      );
      appendCommandOutput(lane.logs, browserInstallResult, 'playwright-install:passed');
      if (browserInstallResult.code !== 0) {
        lane.acceptance = createRuntimeStepReport(
          'failed',
          [],
          runtimeAcceptanceFiles,
          RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.logicalCommandLabel
        );
        lane.status = 'failed';
        return lane;
      }
    }

    const testPort = generatePort(projectRoot, isolated);
    const acceptanceInvocation = runtimeVerificationInvocation(
      'acceptance',
      projectRoot,
      isolated,
      isolatedConfigPath,
      isolatedNodeExecutablePath
    );
    const acceptanceEnv = isolated
      ? buildIsolatedRuntimeAcceptanceEnvironment(options.stagingWorkspaceRoot!, { TEST_PORT: String(testPort) })
      : { ...baseEnv, CI: process.env.CI ?? 'true', TEST_PORT: String(testPort) };
    const assertBrowserLaunchPreSpawn = isolated
      ? async (): Promise<void> => {
          await options.beforeCommit?.();
          const browsersPath = acceptanceEnv.PLAYWRIGHT_BROWSERS_PATH;
          if (!browsersPath || !path.isAbsolute(browsersPath)) {
            throw new Error('Isolated browser launch path is unavailable before spawn');
          }
          await assertRegisteredWindowsBrowserLaunchProofCurrent(
            semanticMutationIsolatedBrowserPath(options.stagingWorkspaceRoot!),
            browsersPath,
            options.browserLaunchProofForTests
          );
        }
      : undefined;
    const runAcceptance = (): Promise<{
      code: number;
      stdout: string;
      stderr: string;
    }> => runRuntimeCommand(
      acceptanceInvocation,
      acceptanceEnv,
      assertBrowserLaunchPreSpawn
    );
    const acceptanceResult = await timed('playwright test', emitTiming, () =>
      withIsolatedPhaseTelemetry('playwright', () => isolated
        ? withIsolatedRuntimeAcceptanceServer({
            beforeSpawn: assertBrowserLaunchPreSpawn,
            environment: acceptanceEnv,
            nodeExecutablePath: isolatedNodeExecutablePath!,
            port: testPort,
            projectRoot,
            signal: options.signal,
            stagingWorkspaceRoot: options.stagingWorkspaceRoot!
          }, runAcceptance)
        : runAcceptance())
    );
    lane.acceptance = createRuntimeCommandStep(
      RUNTIME_VERIFICATION_INVOCATION_CONTRACT.acceptance.logicalCommandLabel,
      acceptanceResult.code,
      runtimeAcceptanceFiles
    );
    appendCommandOutput(lane.logs, acceptanceResult, `runtime-acceptance:passed ${runtimeAcceptanceFiles.join(',')}`);
    lane.status = normalizeStatus(acceptanceResult.code);

    return lane;
  } finally {
    if (isolated) {
      await options.beforeCommit?.();
      await assertIsolatedStagingTree(options.stagingWorkspaceRoot!, options.stagingTreeOptions);
      await options.beforeCommit?.();
    }
  }
}
