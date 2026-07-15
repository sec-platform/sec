import { realpathSync } from 'node:fs';
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

type RuntimeVerificationMode = 'service' | 'full';

type RuntimeVerificationOptions = {
  beforeCommit?: CommitFence;
  emitTiming?: boolean;
  isolated?: boolean;
  signal?: AbortSignal;
  stagingTreeOptions?: IsolatedStagingTreeOptions;
  stagingWorkspaceRoot?: string;
};

type RuntimeVerificationStep = 'build' | 'unit' | 'acceptance';

const RUNTIME_VERIFICATION_COMMANDS = {
  build: 'bun run build',
  unit: 'bun run test:unit',
  acceptance: 'bun run test:acceptance'
} satisfies Record<RuntimeVerificationStep, string>;

export function bunRunInvocation(
  script: string,
  isolated = false,
  isolatedConfigPath?: string
): { command: string; args: string[] } {
  if (isolated && !isolatedConfigPath) {
    throw new Error('Isolated Bun invocation requires a fixed config path');
  }
  return isolated
    ? {
        command: process.execPath,
        args: ['--no-env-file', `--config=${isolatedConfigPath!}`, '--no-install', 'run', script]
      }
    : { command: 'bun', args: ['run', script] };
}

type PhysicalPathResolver = (value: string) => string;

function resolveHostPlaywrightBrowsersPath(
  root: string,
  resolvePhysicalPath: PhysicalPathResolver
): string {
  const localFallback = path.join(root, '.shared-deps', '.playwright-browsers');
  try {
    const physicalNodeModules = resolvePhysicalPath(path.join(root, 'node_modules'));
    const physicalParent = path.dirname(physicalNodeModules);
    const dependencyHost = path.basename(physicalParent) === '.shared-deps'
      ? path.dirname(physicalParent)
      : physicalParent;
    return resolvePhysicalPath(path.join(dependencyHost, '.shared-deps', '.playwright-browsers'));
  } catch {
    return localFallback;
  }
}

/** Test-only pure seam for physical dependency-bridge path resolution. */
export function resolveHostPlaywrightBrowsersPathForTests(
  root: string,
  resolvePhysicalPath: PhysicalPathResolver
): string {
  return resolveHostPlaywrightBrowsersPath(root, resolvePhysicalPath);
}

export function isolatedPlaywrightBrowsersPath(stagingWorkspaceRoot?: string): string {
  if (stagingWorkspaceRoot) {
    return path.join(stagingWorkspaceRoot, '.isolated-process', 'playwright-browsers');
  }
  return resolveHostPlaywrightBrowsersPath(compilerRoot, realpathSync);
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
    build: createSkippedRuntimeStep(RUNTIME_VERIFICATION_COMMANDS.build),
    unit: createSkippedRuntimeStep(RUNTIME_VERIFICATION_COMMANDS.unit),
    acceptance: createSkippedRuntimeStep(RUNTIME_VERIFICATION_COMMANDS.acceptance),
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
      const buildInvocation = bunRunInvocation('build', isolated, isolatedConfigPath);
      const buildResult = await timed('next build', emitTiming, () =>
        withIsolatedPhaseTelemetry('next-build', () => runRuntimeCommand(buildInvocation, baseEnv))
      );
      lane.status = normalizeStatus(buildResult.code);
      lane.build = createRuntimeCommandStep(RUNTIME_VERIFICATION_COMMANDS.build, buildResult.code, ['next build']);
      appendCommandOutput(lane.logs, buildResult, 'runtime-build:passed');

      if (buildResult.code !== 0) {
        return lane;
      }
    }

    if (runtimeUnitFiles.length > 0) {
      const unitInvocation = bunRunInvocation('test:unit', isolated, isolatedConfigPath);
      const unitResult = await timed('bun unit', emitTiming, () =>
        withIsolatedPhaseTelemetry('unit', () => runRuntimeCommand(unitInvocation, baseEnv))
      );
      lane.unit = createRuntimeCommandStep(RUNTIME_VERIFICATION_COMMANDS.unit, unitResult.code, runtimeUnitFiles);
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
      lane.acceptance = { status: 'passed', passed: [], failed: [], command: RUNTIME_VERIFICATION_COMMANDS.acceptance };
      return lane;
    }

    if (isolated) {
      if (!(await pathExists(isolatedPlaywrightBrowsersPath(options.stagingWorkspaceRoot!)))) {
        lane.logs.stderr += 'Preinstalled Playwright browser cache is unavailable\n';
        lane.acceptance = createRuntimeStepReport('failed', [], runtimeAcceptanceFiles, RUNTIME_VERIFICATION_COMMANDS.acceptance);
        lane.status = 'failed';
        return lane;
      }
    } else {
      const browserInstallResult = await timed('playwright install', emitTiming, () =>
        ensurePlaywrightBrowser(projectRoot, baseEnv, options.signal)
      );
      appendCommandOutput(lane.logs, browserInstallResult, 'playwright-install:passed');
      if (browserInstallResult.code !== 0) {
        lane.acceptance = createRuntimeStepReport('failed', [], runtimeAcceptanceFiles, RUNTIME_VERIFICATION_COMMANDS.acceptance);
        lane.status = 'failed';
        return lane;
      }
    }

    const testPort = generatePort(projectRoot, isolated);
    const acceptanceInvocation = bunRunInvocation('test:acceptance', isolated, isolatedConfigPath);
    const acceptanceEnv = isolated
      ? buildIsolatedRuntimeEnvironment(options.stagingWorkspaceRoot!, { TEST_PORT: String(testPort) })
      : { ...baseEnv, CI: process.env.CI ?? 'true', TEST_PORT: String(testPort) };
    const acceptanceResult = await timed('playwright test', emitTiming, () =>
      withIsolatedPhaseTelemetry('playwright', () =>
        runRuntimeCommand(acceptanceInvocation, acceptanceEnv))
    );
    lane.acceptance = createRuntimeCommandStep(RUNTIME_VERIFICATION_COMMANDS.acceptance, acceptanceResult.code, runtimeAcceptanceFiles);
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
