import { lstatSync, realpathSync } from 'node:fs';
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
import { ensureProjectDependencies } from '../../shared/project-runtime.ts';
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

type RuntimeVerificationMode = 'service' | 'full';

type RuntimeVerificationOptions = {
  beforeCommit?: CommitFence;
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
  isolatedConfigPath?: string
): { command: string; args: string[] } {
  if (isolated && !isolatedConfigPath) {
    throw new Error('Isolated Bun invocation requires a fixed config path');
  }
  const descriptor = RUNTIME_VERIFICATION_INVOCATION_CONTRACT[step];
  if (!isolated) {
    return { command: 'bun', args: ['run', descriptor.packageScript] };
  }

  const fixedArgs = ['--no-env-file', `--config=${isolatedConfigPath!}`, '--no-install'];
  const canonicalProjectRoot = path.resolve(projectRoot);
  const moduleArg = descriptor.moduleRelativePath === null
    ? []
    : [path.join(canonicalProjectRoot, 'node_modules', ...descriptor.moduleRelativePath.split('/'))];
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

export interface IsolatedRuntimeDependencySources {
  readonly nodeModules: string;
  readonly browserCache: string;
}

export interface IsolatedRuntimeBuildNodeModulesProof {
  readonly nodeModulesBridge: string;
  readonly buildNodeModulesRoot: string;
  readonly bridgeMetadata: DependencyPathMetadata;
  readonly targetMetadata: DependencyPathMetadata;
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
    const nodeModulesBridge = path.join(root, 'node_modules');
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
  const before = probe.lstat(value);
  if (!before.isDirectory || before.isSymbolicLink) return false;
  const physical = probe.realpath(value);
  const after = probe.lstat(value);
  return sameMetadata(before, after) && foldedPath(physical) === foldedPath(value);
}

function fallbackDependencySources(root: string): Readonly<IsolatedRuntimeDependencySources> {
  return Object.freeze({
    nodeModules: path.join(root, '.shared-deps', 'node_modules'),
    browserCache: path.join(root, '.shared-deps', '.playwright-browsers')
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
    const sharedDependenciesRoot = path.resolve(dependencyHost, '.shared-deps');
    const nodeModules = path.join(sharedDependenciesRoot, 'node_modules');
    const browserCache = path.join(
      sharedDependenciesRoot,
      '.playwright-browsers'
    );
    if (!stableCanonicalPhysicalDirectory(nodeModules, probe) ||
      !stableCanonicalPhysicalDirectory(browserCache, probe)) {
      return fallback;
    }
    return Object.freeze({ nodeModules, browserCache });
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

export function isolatedPlaywrightBrowsersPath(stagingWorkspaceRoot?: string): string {
  return stagingWorkspaceRoot
    ? path.join(stagingWorkspaceRoot, '.isolated-process', 'playwright-browsers')
    : path.join(compilerRoot, '.shared-deps', '.playwright-browsers');
}

export function buildIsolatedRuntimeEnvironment(
  stagingWorkspaceRoot: string,
  additionalEnv: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  return buildIsolatedProcessEnvironment(path.join(stagingWorkspaceRoot, '.isolated-process', 'runtime'), {
    [ISOLATED_VERIFICATION_ENV_KEY]: '1',
    CI: 'true',
    PLAYWRIGHT_BROWSERS_PATH: isolatedPlaywrightBrowsersPath(stagingWorkspaceRoot),
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    ...additionalEnv
  });
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
  signal?: AbortSignal
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const playwrightCli = path.join(projectRoot, 'node_modules', 'playwright', 'cli.js');
  return runCommand(process.execPath, [playwrightCli, 'install', 'chromium'], {
    cwd: projectRoot,
    env: {
      ...env,
      PLAYWRIGHT_BROWSERS_PATH: isolatedPlaywrightBrowsersPath()
    },
    signal
  });
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
  const runtimeUnitFiles = relativeFiles(
    projectRoot,
    (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'unit'))).filter((file) => file.endsWith('.test.ts'))
  );
  const runtimeAcceptanceFiles = relativeFiles(
    projectRoot,
    (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'acceptance'))).filter((file) => file.endsWith('.spec.ts'))
  );

  await timed('project deps materialize', emitTiming, () => ensureProjectDependencies(projectRoot, {
    beforeCommit: options.beforeCommit,
    signal: options.signal,
    skipSharedDepsWarmup: true,
    ...(isolated ? { installMode: 'prebound-only' as const } : {})
  }));

  const isolatedRuntimeRoot = options.stagingWorkspaceRoot
    ? path.join(options.stagingWorkspaceRoot, '.isolated-process', 'runtime')
    : undefined;
  const isolatedConfigPath = isolatedRuntimeRoot
    ? path.join(isolatedRuntimeRoot, 'bunfig.toml')
    : undefined;
  if (isolatedRuntimeRoot && isolatedConfigPath) {
    await ensureIsolatedProcessDirectories(isolatedRuntimeRoot, options.beforeCommit);
    await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
  }
  const envPathKey = pathEnvKey();
  const baseEnv = isolated
    ? buildIsolatedRuntimeEnvironment(options.stagingWorkspaceRoot!)
    : {
        ...process.env,
        [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`,
        PLAYWRIGHT_BROWSERS_PATH: isolatedPlaywrightBrowsersPath()
      };
  const lane = createSkippedRuntimeLane();
  if (isolated) {
    await assertIsolatedStagingTree(options.stagingWorkspaceRoot!, options.stagingTreeOptions);
  }
  const runRuntimeCommand = async (
    invocation: { readonly command: string; readonly args: string[] },
    env: NodeJS.ProcessEnv
  ) => {
    const result = await runCommand(invocation.command, invocation.args, {
      beforeSpawn: isolated ? options.beforeCommit : undefined,
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
      const buildInvocation = runtimeVerificationInvocation('build', projectRoot, isolated, isolatedConfigPath);
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
      const unitInvocation = runtimeVerificationInvocation('unit', projectRoot, isolated, isolatedConfigPath);
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
      if (!(await pathExists(isolatedPlaywrightBrowsersPath(options.stagingWorkspaceRoot!)))) {
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
    const acceptanceInvocation = runtimeVerificationInvocation('acceptance', projectRoot, isolated, isolatedConfigPath);
    const acceptanceEnv = isolated
      ? buildIsolatedRuntimeEnvironment(options.stagingWorkspaceRoot!, { TEST_PORT: String(testPort) })
      : { ...baseEnv, CI: process.env.CI ?? 'true', TEST_PORT: String(testPort) };
    const acceptanceResult = await timed('playwright test', emitTiming, () =>
      withIsolatedPhaseTelemetry('playwright', () =>
        runRuntimeCommand(acceptanceInvocation, acceptanceEnv))
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
