import path from 'node:path';
import { listFilesRecursive } from '../../shared/fs.ts';
import { compilerRoot, relativePosixPath } from '../../shared/paths.ts';
import { pathEnvKey, runCommand } from '../../shared/process.ts';
import { ensureProjectDependencies, ensureSharedDepsReady } from '../../shared/project-runtime.ts';
import type { RuntimeVerificationLaneReport, VerificationStatus, VerificationStepReport } from '../../shared/verification-types.ts';

type RuntimeVerificationMode = 'service' | 'full';

type RuntimeVerificationOptions = {
  emitTiming?: boolean;
};

type RuntimeVerificationStep = 'build' | 'unit' | 'acceptance';

const RUNTIME_VERIFICATION_COMMANDS = {
  build: 'bun run build',
  unit: 'bun run test:unit',
  acceptance: 'bun run test:acceptance'
} satisfies Record<RuntimeVerificationStep, string>;

function bunRunInvocation(script: string): { command: string; args: string[] } {
  return { command: 'bun', args: ['run', script] };
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

function generatePort(projectRoot: string): number {
  const basePort = 3000;
  const workerId = parseInt(process.env.VITEST_POOL_ID ?? '0', 10);
  const pathHash = [...projectRoot].reduce(
    (hash, character) => (hash * 31 + character.charCodeAt(0)) % 1000,
    0
  );
  return basePort + workerId * 1000 + pathHash;
}

function normalizeStatus(code: number): VerificationStatus {
  return code === 0 ? 'passed' : 'failed';
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
  logs.stderr += result.stderr;
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
    console.log(`[TIMING] ${label}: ${elapsed}s`);
  }
  return result;
}

async function ensurePlaywrightBrowser(projectRoot: string, env: NodeJS.ProcessEnv): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const playwrightCli = path.join(projectRoot, 'node_modules', 'playwright', 'cli.js');
  return runCommand(process.execPath, [playwrightCli, 'install', 'chromium'], {
    cwd: projectRoot,
    env
  });
}

export async function runRuntimeVerification(
  projectRoot: string,
  mode: RuntimeVerificationMode = 'full',
  options: RuntimeVerificationOptions = {}
): Promise<RuntimeVerificationLaneReport> {
  const emitTiming = options.emitTiming ?? true;
  const runtimeUnitFiles = relativeFiles(
    projectRoot,
    (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'unit'))).filter((file) => file.endsWith('.test.ts'))
  );
  const runtimeAcceptanceFiles = relativeFiles(
    projectRoot,
    (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'acceptance'))).filter((file) => file.endsWith('.spec.ts'))
  );

  await timed('shared deps warmup', emitTiming, () => ensureSharedDepsReady());
  await timed('project deps materialize', emitTiming, () => ensureProjectDependencies(projectRoot, { skipSharedDepsWarmup: true }));

  const envPathKey = pathEnvKey();
  const baseEnv = {
    ...process.env,
    [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`
  };
  const lane = createSkippedRuntimeLane();

  if (mode === 'full') {
    const buildInvocation = bunRunInvocation('build');
    const buildResult = await timed('next build', emitTiming, () =>
      runCommand(buildInvocation.command, buildInvocation.args, {
        cwd: projectRoot,
        env: baseEnv
      })
    );
    lane.status = normalizeStatus(buildResult.code);
    lane.build = createRuntimeCommandStep(RUNTIME_VERIFICATION_COMMANDS.build, buildResult.code, ['next build']);
    appendCommandOutput(lane.logs, buildResult, 'runtime-build:passed');

    if (buildResult.code !== 0) {
      return lane;
    }
  }

  if (runtimeUnitFiles.length > 0) {
    const unitInvocation = bunRunInvocation('test:unit');
    const unitResult = await timed('bun unit', emitTiming, () =>
      runCommand(unitInvocation.command, unitInvocation.args, {
        cwd: projectRoot,
        env: baseEnv
      })
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
    return lane;
  }

  const browserInstallResult = await timed('playwright install', emitTiming, () => ensurePlaywrightBrowser(projectRoot, baseEnv));
  appendCommandOutput(lane.logs, browserInstallResult, 'playwright-install:passed');
  if (browserInstallResult.code !== 0) {
    lane.acceptance = createRuntimeStepReport('failed', [], runtimeAcceptanceFiles, RUNTIME_VERIFICATION_COMMANDS.acceptance);
    lane.status = 'failed';
    return lane;
  }

  const testPort = generatePort(projectRoot);
  const acceptanceInvocation = bunRunInvocation('test:acceptance');
  const acceptanceResult = await timed('playwright test', emitTiming, () =>
    runCommand(acceptanceInvocation.command, acceptanceInvocation.args, {
      cwd: projectRoot,
      env: {
        ...baseEnv,
        CI: process.env.CI ?? 'true',
        TEST_PORT: String(testPort)
      }
    })
  );
  lane.acceptance = createRuntimeCommandStep(RUNTIME_VERIFICATION_COMMANDS.acceptance, acceptanceResult.code, runtimeAcceptanceFiles);
  appendCommandOutput(lane.logs, acceptanceResult, `runtime-acceptance:passed ${runtimeAcceptanceFiles.join(',')}`);
  lane.status = normalizeStatus(acceptanceResult.code);

  return lane;
}
