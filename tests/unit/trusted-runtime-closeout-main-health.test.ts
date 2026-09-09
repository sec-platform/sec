import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { resolveSecRuntimeStateForRepository } from '../../src/runtime-state/workspace-state/paths.ts';
import { encodeVerificationActionData } from '../../src/verification/action/contract/action.ts';
import { createTrustedRuntimeMainHealthBaselineObservation, createTrustedRuntimeMainHealthReceipt, TRUSTED_RUNTIME_CONTAINER_IMAGE_ID, TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST } from '../../src/verification/trusted-runtime/trusted-runtime-container.ts';

const REPOSITORY = 'sec-platform/sec';
const TRUSTED_RUNTIME_MAIN_HEALTH_PROGRAM_PATH = path.resolve(
  import.meta.dir,
  '../helpers/trusted-runtime-main-health-child.ts'
);

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function installFakeMainHealthGh(binHome: string): void {
  const helperPath = path.resolve(import.meta.dir, '../helpers/fail-if-main-health-gh-runs.ts');
  const executablePath = path.join(binHome, process.platform === 'win32' ? 'gh.exe' : 'gh');
  const compiled = spawnSync(process.execPath, [
    'build', '--compile', helperPath, '--outfile', executablePath
  ], { encoding: 'utf8', windowsHide: true });
  if (compiled.status !== 0) {
    throw new Error(`cannot compile fake MainHealth gh: ${compiled.stderr || compiled.stdout}`);
  }
}

function runProductionMainHealth(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv
) {
  return spawnSync(process.execPath, [TRUSTED_RUNTIME_MAIN_HEALTH_PROGRAM_PATH, repositoryRoot, REPOSITORY, 'main'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: environment,
    windowsHide: true
  });
}

test('production sec main health returns its first typed provider admission failure without spawning PATH executables', async () => {
  const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-repo-'));
  const stateHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-state-'));
  const cacheHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-cache-'));
  const binHome = mkdtempSync(path.join(tmpdir(), 'sec-main-health-production-bin-'));
  try {
    git(repositoryRoot, ['init', '--initial-branch=main']);
    git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
    mkdirSync(path.join(repositoryRoot, '.git', 'disabled-hooks'), { recursive: true });
    git(repositoryRoot, ['config', 'core.hooksPath', '.git/disabled-hooks']);
    writeFileSync(path.join(repositoryRoot, 'baseline.txt'), 'baseline\n', 'utf8');
    git(repositoryRoot, ['add', 'baseline.txt']);
    git(repositoryRoot, ['commit', '-m', 'baseline']);
    const baselineSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const baselineTreeSha = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
    writeFileSync(path.join(repositoryRoot, 'main.txt'), 'main\n', 'utf8');
    git(repositoryRoot, ['add', 'main.txt']);
    git(repositoryRoot, ['commit', '-m', 'main']);
    git(repositoryRoot, ['remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);
    const mainSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const mainTreeSha = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);

    const fakeGhExecutionSentinel = path.join(binHome, 'fake-gh-executed');
    const childEnvironment = Object.freeze({
      ...process.env,
      SEC_STATE_HOME: stateHome,
      SEC_CACHE_HOME: cacheHome,
      GH_HOST: 'evil.example.invalid',
      GH_TOKEN: 'poisoned-ambient-token',
      SEC_TEST_GH_EXECUTION_SENTINEL: fakeGhExecutionSentinel,
      PATH: `${binHome}${path.delimiter}${process.env.PATH ?? ''}`
    });
    installFakeMainHealthGh(binHome);
    const layout = resolveSecRuntimeStateForRepository({
      repository: REPOSITORY,
      repositoryRoot,
      environment: childEnvironment
    });
    const healthRoot = path.join(layout.repositoryStateRoot, 'trusted-main-health', 'v1');
    mkdirSync(healthRoot, { recursive: true });
    const baseline = createTrustedRuntimeMainHealthBaselineObservation({
      mainSha,
      mainTreeSha,
      parentLine: `${mainSha} ${baselineSha}`,
      parentTreeSha: baselineTreeSha
    });
    const receipt = createTrustedRuntimeMainHealthReceipt({
      origin: 'physical-main',
      repository: REPOSITORY,
      mainSha,
      mainTreeSha,
      baselineSha,
      baselineTreeSha,
      baselineObservationDigest: baseline.observationDigest,
      executionId: 'production-main-health-reconciliation-test',
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      dockerEndpoint: Object.freeze({
        schema: 'sec-docker-endpoint-identity-v1' as const,
        contextName: 'test-linux',
        endpointHost: process.platform === 'win32'
          ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
          : 'unix:///var/run/docker.sock',
        daemonId: 'daemon-production-main-health-test',
        osType: 'linux' as const,
        architecture: 'x86_64' as const
      }),
      networkIsolatedBeforeExecution: true,
      planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
      actionResults: Object.freeze([
        Object.freeze({ actionId: 'affected-closure', resultDigest: `sha256:${'3'.repeat(64)}` })
      ]),
      transition: null,
      observedAt: new Date(Date.now() - 1_000).toISOString()
    });
    const receiptPath = path.join(healthRoot, `main-${mainSha}.json`);
    const receiptBytes = `${encodeVerificationActionData(receipt)}\n`;
    writeFileSync(receiptPath, receiptBytes, 'utf8');

    const firstRun = runProductionMainHealth(repositoryRoot, childEnvironment);
    expect(firstRun.status).not.toBe(0);
    expect(firstRun.stderr).toContain('github-api-provider-unavailable');
    expect(firstRun.stderr).toContain('GitHub API credential provider is unavailable');
    expect(() => readFileSync(fakeGhExecutionSentinel, 'utf8')).toThrow();
    expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);
    expect(() => readdirSync(path.join(healthRoot, 'supersessions'))).toThrow();

    git(repositoryRoot, ['branch', '-m', 'candidate']);
    const candidateRun = runProductionMainHealth(repositoryRoot, childEnvironment);
    expect(candidateRun.status).not.toBe(0);
    expect(candidateRun.stderr).toContain('standalone MainHealth must execute from the clean exact default-branch worktree');
    expect(candidateRun.stderr).not.toContain('github-api-provider-unavailable');
    expect(() => readFileSync(fakeGhExecutionSentinel, 'utf8')).toThrow();
    expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);

    git(repositoryRoot, ['branch', '-m', 'main']);
    writeFileSync(path.join(repositoryRoot, 'untracked.txt'), 'dirty\n');
    const dirtyRun = runProductionMainHealth(repositoryRoot, childEnvironment);
    expect(dirtyRun.stderr).toContain('standalone MainHealth must execute from the clean exact default-branch worktree');
    expect(dirtyRun.stderr).not.toContain('github-api-provider-unavailable');
    rmSync(path.join(repositoryRoot, 'untracked.txt'));
    git(repositoryRoot, ['remote', 'set-url', 'origin', 'https://github.com/unrelated/repository.git']);
    const originRun = runProductionMainHealth(repositoryRoot, childEnvironment);
    expect(originRun.stderr).toContain('origin remote does not match the requested GitHub repository');
    expect(originRun.stderr).not.toContain('github-api-provider-unavailable');
    expect(() => readFileSync(fakeGhExecutionSentinel, 'utf8')).toThrow();
    expect(readFileSync(receiptPath, 'utf8')).toBe(receiptBytes);
  } finally {
    const cleanup = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;
    rmSync(repositoryRoot, cleanup);
    rmSync(stateHome, cleanup);
    rmSync(cacheHome, cleanup);
    rmSync(binHome, cleanup);
  }
}, 30_000);
