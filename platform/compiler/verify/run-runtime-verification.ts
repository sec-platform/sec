import path from 'node:path';
import { compilerRoot } from '../../shared/paths.ts';
import { listFilesRecursive } from '../../shared/fs.ts';
import { ensureProjectDependencies } from '../../shared/project-runtime.ts';
import { runCommand } from '../../shared/process.ts';
import type { RuntimeVerificationLaneReport, VerificationStatus } from '../../shared/types.ts';

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

async function ensurePlaywrightBrowser(projectRoot: string, env: NodeJS.ProcessEnv): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return runCommand(npmCommand(), ['exec', 'playwright', 'install', 'chromium'], {
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

  await ensureProjectDependencies(projectRoot);

  const envPathKey = pathEnvKey();
  const env = {
    [envPathKey]: `${path.join(compilerRoot, 'node_modules', '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`
  };
  const buildResult = await runCommand(npmCommand(), ['run', 'build'], {
    cwd: projectRoot,
    env
  });
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
    const unitResult = await runCommand(npmCommand(), ['run', 'test:unit'], {
      cwd: projectRoot,
      env
    });
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

  const browserInstallResult = await ensurePlaywrightBrowser(projectRoot, env);
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

  const acceptanceResult = await runCommand(npmCommand(), ['run', 'test:acceptance'], {
    cwd: projectRoot,
    env: {
      ...env,
      CI: process.env.CI ?? 'true'
    }
  });
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
