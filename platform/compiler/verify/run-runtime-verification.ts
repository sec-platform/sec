import path from 'node:path';
import { compilerRoot } from '../../shared/paths.ts';
import { listFilesRecursive } from '../../shared/fs.ts';
import { ensureProjectDependencies, ensureSharedDepsReady } from '../../shared/project-runtime.ts';
import { runCommand } from '../../shared/process.ts';
import type { RuntimeVerificationLaneReport, VerificationStatus } from '../../shared/types.ts';

function generatePort(): number {
  const basePort = 3000;
  const workerId = parseInt(process.env.VITEST_POOL_ID ?? '0', 10);
  const processId = process.pid % 100;
  return basePort + workerId * 100 + processId;
}

function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function pathEnvKey(): string {
  return Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

function normalizeStatus(code: number): VerificationStatus {
  return code === 0 ? 'passed' : 'failed';
}

function relativeFiles(rootDir: string, files: string[]): string[] {
  return files
    .map((file) => path.relative(rootDir, file).replaceAll('\\', '/'))
    .sort((left, right) => left.localeCompare(right));
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[TIMING] ${label}: ${elapsed}s`);
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

export async function runRuntimeVerification(projectRoot: string): Promise<RuntimeVerificationLaneReport> {
  const runtimeUnitFiles = relativeFiles(
    projectRoot,
    (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'unit'))).filter((file) => file.endsWith('.test.ts'))
  );
  const runtimeAcceptanceFiles = relativeFiles(
    projectRoot,
    (await listFilesRecursive(path.join(projectRoot, 'tests', 'runtime', 'acceptance'))).filter((file) => file.endsWith('.spec.ts'))
  );

  await timed('shared deps warmup', () => ensureSharedDepsReady());
  await timed('project deps materialize', () => ensureProjectDependencies(projectRoot, { skipSharedDepsWarmup: true }));

  const envPathKey = pathEnvKey();
  const baseEnv = {
    ...process.env,
    [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`
  };
  const buildResult = await timed('next build', () =>
    runCommand(npmCommand(), ['run', 'build'], {
      cwd: projectRoot,
      env: baseEnv
    })
  );
  const lane: RuntimeVerificationLaneReport = {
    status: normalizeStatus(buildResult.code),
    build: {
      status: normalizeStatus(buildResult.code),
      passed: buildResult.code === 0 ? ['next build'] : [],
      failed: buildResult.code === 0 ? [] : ['next build'],
      command: 'npm run build'
    },
    unit: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:unit'
    },
    acceptance: {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:acceptance'
    },
    logs: {
      stdout: buildResult.stdout,
      stderr: buildResult.stderr
    }
  };

  if (buildResult.code !== 0) {
    return lane;
  }

  if (runtimeUnitFiles.length === 0) {
    lane.unit = {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:unit'
    };
  } else {
    const unitResult = await timed('vitest unit', () =>
      runCommand(npmCommand(), ['run', 'test:unit'], {
        cwd: projectRoot,
        env: baseEnv
      })
    );
    lane.unit = {
      status: normalizeStatus(unitResult.code),
      passed: unitResult.code === 0 ? runtimeUnitFiles : [],
      failed: unitResult.code === 0 ? [] : runtimeUnitFiles,
      command: 'npm run test:unit'
    };
    lane.logs.stdout += unitResult.stdout;
    lane.logs.stderr += unitResult.stderr;
    lane.status = normalizeStatus(unitResult.code);

    if (unitResult.code !== 0) {
      return lane;
    }
  }

  if (runtimeAcceptanceFiles.length === 0) {
    lane.acceptance = {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:acceptance'
    };
    lane.status = 'passed';
    return lane;
  }

  const browserInstallResult = await timed('playwright install', () => ensurePlaywrightBrowser(projectRoot, baseEnv));
  lane.logs.stdout += browserInstallResult.stdout;
  lane.logs.stderr += browserInstallResult.stderr;
  if (browserInstallResult.code !== 0) {
    lane.acceptance = {
      status: 'failed',
      passed: [],
      failed: runtimeAcceptanceFiles,
      command: 'npm run test:acceptance'
    };
    lane.status = 'failed';
    return lane;
  }

  const testPort = generatePort();
  const acceptanceResult = await timed('playwright test', () =>
    runCommand(npmCommand(), ['run', 'test:acceptance'], {
      cwd: projectRoot,
      env: {
        ...baseEnv,
        CI: process.env.CI ?? 'true',
        TEST_PORT: String(testPort)
      }
    })
  );
  lane.acceptance = {
    status: normalizeStatus(acceptanceResult.code),
    passed: acceptanceResult.code === 0 ? runtimeAcceptanceFiles : [],
    failed: acceptanceResult.code === 0 ? [] : runtimeAcceptanceFiles,
    command: 'npm run test:acceptance'
  };
  lane.logs.stdout += acceptanceResult.stdout;
  lane.logs.stderr += acceptanceResult.stderr;
  lane.status = normalizeStatus(acceptanceResult.code);

  return lane;
}
