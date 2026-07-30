import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';

import {
  acquireHeavyVerificationGateLease,
  heavyVerificationGateMutexName
} from '../../platform/shared/heavy-verification-gate-lease.ts';
import { expectContainsAll, expectContainsNone } from '../helpers/assertion-helpers.ts';
import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

describe('dev-runner contract', () => {
  test('root package routes developer feedback through canonical runner commands', async () => {
    const { scripts } = await readCompilerPackageJson();

    expect(scripts.dev).toBe('bun ./platform/dev-runner.ts');
    expect(scripts.typecheck).toBe('bun ./platform/dev-runner.ts typecheck');
    expect(scripts.test).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:affected']).toBe('bun ./platform/dev-runner.ts test:affected');
    expect(scripts['test:fast']).toBe('bun ./platform/dev-runner.ts test:fast');
    expect(scripts['test:slow']).toBe('bun ./platform/dev-runner.ts test:slow');
    expect(scripts['test:full']).toBe('bun ./platform/dev-runner.ts test');
    expect(scripts.check).toBe('bun run check:fast');
    expect(scripts['check:affected']).toBe('bun ./platform/dev-runner.ts check:affected');
    expect(scripts['check:fast']).toBe('bun ./platform/dev-runner.ts check:fast');
    expect(scripts['check:full']).toBe(
      'bun run imports:prepare && bun run typecheck && bun run docs:doctor && bun run test:full'
    );
    expect(scripts['test:watch']).toBeUndefined();
    expect(scripts['test:coverage']).toBeUndefined();
    expect(scripts['imports:prepare']).toBe('bun ./platform/dev-runner.ts imports:prepare');
    expect(scripts['imports:organize']).toBe('bun ./platform/dev-runner.ts imports:organize');
    expect(scripts['imports:check']).toBe('bun ./platform/dev-runner.ts imports:check');
    expect(scripts['imports:freeze']).toBe('bun ./platform/dev-runner.ts imports:freeze');
    expect(scripts['imports:staged']).toBe('bun ./platform/dev-runner.ts imports:staged');
    expect(scripts['deps:ensure']).toBe('bun ./platform/dev-runner.ts deps:ensure');
  });

  test('runner surface excludes contracts owned by direct package scripts', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');

    expectContainsNone(runnerSource, ['reference-clean', 'benchmark-contract']);
  });

  test('command runner preserves the fixed no-shell process boundary', async () => {
    const commandRunnerSource = await readCompilerFile('platform/dev-runner/command-runner.ts');

    expectContainsAll(commandRunnerSource, [
      'spawn(command, applyDefaultFastTestConcurrency(command, args)',
      'cwd: compilerRoot',
      'shell: false',
      "stdio: 'inherit'",
      "child.on('error', reject)",
      "child.on('close', (code)"
    ]);
  });

  test('typecheck uses one TypeScript-owned derived incremental cache', async () => {
    const tsconfig = JSON.parse(await readCompilerFile('tsconfig.json')) as {
      compilerOptions?: Record<string, unknown>;
    };
    const gitignore = await readCompilerFile('.gitignore');
    const typecheckRunnerSource = await readCompilerFile('platform/dev-runner/typecheck-runner.ts');

    expect(tsconfig.compilerOptions).toMatchObject({
      incremental: true,
      noEmit: true,
      strict: true,
      tsBuildInfoFile: '.tmp/typecheck/tsconfig.tsbuildinfo'
    });
    expect(gitignore.replaceAll('\r\n', '\n').split('\n')).toContain('.tmp/');
    expect(typecheckRunnerSource).toContain("['--noEmit', '-p', 'tsconfig.json', ...args]");
    expect(typecheckRunnerSource).not.toContain('tsbuildinfo');
    expect(typecheckRunnerSource).not.toContain('tsBuildInfoFile');
  });

  test('affected runner shares canonical changed-file parsing and impact ownership', async () => {
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');

    expectContainsAll(testRunnerSource, [
      'gitChangedFileDiffArgs',
      'gitUntrackedFileArgs',
      'parseGitChangedFileOutput',
      "from '../shared/affected-test-inventory.ts'",
      "from '../shared/ci-pr-risk-selection.ts'",
      'CodexDevelopmentAffectedInventoryInputsV1(files, (file) => currentTestFiles.has(file))',
      'selectCiPrRiskSlowSuites(files)',
      'selectCiPrRiskSlowSuites([file])'
    ]);
    expectContainsNone(testRunnerSource, [
      'isTestImpactSourceFile',
      'function impactSourceFile',
      "['diff', '--name-only', '--diff-filter=ACMR'"
    ]);
  });

  test('fast runner owns test dependency readiness without production runtime setup', async () => {
    const runnerSource = await readCompilerFile('platform/dev-runner.ts');
    const testRunnerSource = await readCompilerFile('platform/dev-runner/test-runner.ts');
    const setupSource = await readCompilerFile('tests/setup/runtime-deps.setup.ts');
    const runtimeVerificationSource = await readCompilerFile(
      'platform/compiler/verify/run-runtime-verification.ts'
    );

    expectContainsAll(runnerSource, ['test:fast']);
    expectContainsAll(testRunnerSource, [
      'fastTestArgs',
      'ensureTestDependencies',
      'PLAYWRIGHT_BROWSERS_PATH',
      'SEC_SKIP_RUNTIME_DEPS_SETUP'
    ]);
    expectContainsAll(setupSource, [
      "process.env.SEC_SKIP_RUNTIME_DEPS_SETUP !== '1'",
      'ensureTestDependencies',
      'process.env.PLAYWRIGHT_BROWSERS_PATH = dependencies.browserCachePath',
      'await fs.rm(lockPath, { recursive: true, force: true });'
    ]);
    expectContainsNone(setupSource, ['ensureDevDependencies', 'ensurePlaywrightBrowserCacheReady']);
    expectContainsAll(runtimeVerificationSource, ['materializePlaywrightBrowserCache']);
    expectContainsNone(runtimeVerificationSource, [
      "path.join(projectRoot, 'node_modules', 'playwright', 'cli.js')",
      "path.join(compilerRoot, '.shared-deps', '.playwright-browsers')"
    ]);
  });

  test('runFastCheck runs docs:doctor in parallel with typecheck after imports:prepare', async () => {
    const checkRunnerSource = await readCompilerFile('platform/dev-runner/check-runner.ts');
    const fastCheckStart = checkRunnerSource.indexOf('export async function runFastCheck');
    expect(fastCheckStart).toBeGreaterThanOrEqual(0);
    const fastCheckSource = checkRunnerSource.slice(fastCheckStart);

    expectContainsAll(fastCheckSource, [
      'imports:prepare -> docs:doctor + typecheck (parallel) -> test:fast',
      'await runImportPreparation()',
      'Promise.all([',
      "runDevCommand('bun', ['docs/scripts/docs-doctor.ts'], {})",
      'typecheck()',
      "namespace: 'test:fast'",
      'waitTimeoutMs: 5000'
    ]);
    expectContainsNone(fastCheckSource, [
      'imports:prepare + docs:doctor (parallel) -> typecheck'
    ]);

    const importsIndex = fastCheckSource.indexOf('await runImportPreparation()');
    const parallelIndex = fastCheckSource.indexOf('Promise.all([');
    const docsIndex = fastCheckSource.indexOf("runDevCommand('bun', ['docs/scripts/docs-doctor.ts']");
    const typecheckIndex = fastCheckSource.indexOf('typecheck()');
    expect(importsIndex).toBeGreaterThanOrEqual(0);
    expect(parallelIndex).toBeGreaterThan(importsIndex);
    expect(docsIndex).toBeGreaterThan(parallelIndex);
    expect(typecheckIndex).toBeGreaterThan(parallelIndex);
  });

  test('heavy verification gate lease exposes per-namespace isolation and a wait timeout option', async () => {
    const leaseSource = await readCompilerFile('platform/shared/heavy-verification-gate-lease.ts');

    expectContainsAll(leaseSource, [
      'export function heavyVerificationGateMutexName',
      'namespace?: string',
      'waitTimeoutMs?: number',
      'heavyVerificationGateNamespaceSegment',
      'WaitForSingleObject(handle, waitTimeoutMs)'
    ]);

    const fast = heavyVerificationGateMutexName('C:\\repo', 'test:fast');
    const affected = heavyVerificationGateMutexName('C:\\repo', 'test:affected');
    const unscoped = heavyVerificationGateMutexName('C:\\repo');
    expect(fast).not.toBe(affected);
    expect(fast).not.toBe(unscoped);
    expect(affected).not.toBe(unscoped);
    expect(fast).toContain('Global\\sec-heavy-verification-gate-');
    expect(affected).toContain('Global\\sec-heavy-verification-gate-');
    expect(unscoped).toContain('Global\\sec-heavy-verification-gate-');
  });

  test('two heavy verification gate leases with different namespaces can be held concurrently', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-heavy-gate-ns-'));
    try {
      const fast = await acquireHeavyVerificationGateLease({
        gateId: 'test:fast',
        namespace: 'test:fast',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 101,
        token: '11111111111111111111111111111111'
      });
      const affected = await acquireHeavyVerificationGateLease({
        gateId: 'test:affected',
        namespace: 'test:affected',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 202,
        token: '22222222222222222222222222222222'
      });
      expect(fast.owner.gateId).toBe('test:fast');
      expect(affected.owner.gateId).toBe('test:affected');
      await fast.release();
      await affected.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('two heavy verification gate leases with the same namespace still conflict', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-heavy-gate-same-'));
    try {
      const first = await acquireHeavyVerificationGateLease({
        gateId: 'test:fast',
        namespace: 'test:fast',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 101,
        token: '11111111111111111111111111111111'
      });
      await expect(acquireHeavyVerificationGateLease({
        gateId: 'test:fast',
        namespace: 'test:fast',
        isProcessAlive: () => true,
        lockPath: root,
        ownerHost: 'test-host',
        ownerPid: 202,
        token: '22222222222222222222222222222222'
      })).rejects.toThrow('is already active');
      await first.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
