import path from 'node:path';
import { listFilesRecursive } from '../../shared/fs.ts';
import { compilerRoot, relativePosixPath } from '../../shared/paths.ts';
import { pathEnvKey, resolveNpmInvocation, runCommand } from '../../shared/process.ts';
import { ensureProjectDependencies, ensureSharedDepsReady } from '../../shared/project-runtime.ts';
import type { RuntimeVerificationLaneReport, VerificationStatus } from '../../shared/verification-types.ts';

type RuntimeVerificationMode = 'service' | 'full';

type RuntimeVerificationOptions = {
  emitTiming?: boolean;
};

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
  const lane: RuntimeVerificationLaneReport = {
    status: 'skipped',
    build: {
      status: 'skipped',
      passed: [],
      failed: [],
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
      stdout: '',
      stderr: ''
    }
  };

  if (mode === 'full') {
    const buildInvocation = resolveNpmInvocation(['run', 'build']);
    const buildResult = await timed('next build', emitTiming, () =>
      runCommand(buildInvocation.command, buildInvocation.args, {
        cwd: projectRoot,
        env: baseEnv
      })
    );
    lane.status = normalizeStatus(buildResult.code);
    lane.build = {
      status: normalizeStatus(buildResult.code),
      passed: buildResult.code === 0 ? ['next build'] : [],
      failed: buildResult.code === 0 ? [] : ['next build'],
      command: 'npm run build'
    };
    appendCommandOutput(lane.logs, buildResult, 'runtime-build:passed');

    if (buildResult.code !== 0) {
      return lane;
    }
  }

  if (runtimeUnitFiles.length === 0) {
    lane.unit = {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:unit'
    };
  } else {
    const unitInvocation = resolveNpmInvocation(['run', 'test:unit']);
    const unitResult = await timed('vitest unit', emitTiming, () =>
      runCommand(unitInvocation.command, unitInvocation.args, {
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
    lane.acceptance = {
      status: 'skipped',
      passed: [],
      failed: [],
      command: 'npm run test:acceptance'
    };
    lane.status = 'passed';
    return lane;
  }

  const browserInstallResult = await timed('playwright install', emitTiming, () => ensurePlaywrightBrowser(projectRoot, baseEnv));
  appendCommandOutput(lane.logs, browserInstallResult, 'playwright-install:passed');
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

  const testPort = generatePort(projectRoot);
  const acceptanceInvocation = resolveNpmInvocation(['run', 'test:acceptance']);
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
  lane.acceptance = {
    status: normalizeStatus(acceptanceResult.code),
    passed: acceptanceResult.code === 0 ? runtimeAcceptanceFiles : [],
    failed: acceptanceResult.code === 0 ? [] : runtimeAcceptanceFiles,
    command: 'npm run test:acceptance'
  };
  appendCommandOutput(lane.logs, acceptanceResult, `runtime-acceptance:passed ${runtimeAcceptanceFiles.join(',')}`);
  lane.status = normalizeStatus(acceptanceResult.code);

  return lane;
}
