import {
  EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS,
  EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
  compilerCoordinationLockPath,
  describe,
  effectfulTest,
  ensureCompilerDepsReady,
  expect,
  fs,
  installCompilerDependencyFixture,
  path,
  readJson,
  test,
  withCompilerTestWorkspace,
  withTempWorkspace,
  writeCompilerDependencyRoot
} from './compiler-dependency-installation.ts';

describe('compiler dependency installation', () => {
  effectfulTest(test, 'retries only bounded Windows transient generation renames and preserves the exact source identity', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-windows-rename-retry-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');

      let transientFailures = 0;
      const delays: number[] = [];
      const result = await ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish && transientFailures < 2) {
            transientFailures += 1;
            const error = new Error('injected transient Windows rename denial') as NodeJS.ErrnoException;
            error.code = 'EPERM';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot);

      expect(result.source).toBe('installed');
      expect(transientFailures).toBe(2);
      expect(delays).toEqual([25, 50]);
      expect(await fs.readFile(path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'), 'utf8'))
        .toBe('generation-2:typescript\n');
    }));

  effectfulTest(test, 'preserves a replaced staging source and recovers after its original identity returns', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-windows-rename-identity-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let replaced = false;
      let stagedSource: string | null = null;

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async () => undefined,
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish && !replaced) {
            replaced = true;
            stagedSource = source;
            await fs.rename(source, `${source}-original`);
            await fs.mkdir(source);
            const error = new Error('injected transient rename with source replacement') as NodeJS.ErrnoException;
            error.code = 'EBUSY';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({
        code: 'IMPORT-AUTHORITY-004'
      });
      expect(replaced).toBe(true);
      expect(stagedSource).not.toBeNull();
      expect((await fs.lstat(stagedSource!)).isDirectory()).toBeTrue();
      expect(await fs.readFile(path.join(
        `${stagedSource!}-original`, 'typescript', 'lib', 'typescript.js'
      ), 'utf8')).toBe('generation-2:typescript\n');
      await fs.rmdir(stagedSource!);
      await fs.rename(`${stagedSource!}-original`, stagedSource!);
      expect((await ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async () => {
          throw new Error('Recovered exact stage must not install again.');
        }
      }, tempRoot)).source).toBe('existing');
      expect(await fs.readFile(path.join(
        tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'
      ), 'utf8')).toBe('generation-2:typescript\n');
    }));

  effectfulTest(test, 'does not retry a non-transient compiler generation rename failure', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-non-transient-rename-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let failures = 0;

      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        sleep: async () => {
          throw new Error('non-transient rename must not sleep');
        },
        testCompilerPublishPlatform: 'win32',
        testCompilerRename: async (source, target) => {
          const stagedPublish = path.basename(source) === 'node_modules' &&
            path.basename(path.dirname(source)).includes('.staging-');
          if (stagedPublish) {
            failures += 1;
            const error = new Error('injected non-transient rename failure') as NodeJS.ErrnoException;
            error.code = 'ENOTEMPTY';
            throw error;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(failures).toBe(1);
    }));

  test('rejects invalid or widening operation budgets before creating a dependency namespace', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const candidateRoot = path.join(tempRoot, 'candidate');
      for (const lockTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 300_001]) {
        await expect(ensureCompilerDepsReady({ lockTimeoutMs }, candidateRoot))
          .rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
      }
      for (const pollIntervalMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_001]) {
        await expect(ensureCompilerDepsReady({ pollIntervalMs }, candidateRoot))
          .rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
      }
      await expect(fs.stat(candidateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-dev-deps-budget-admission-');
  });

  effectfulTest(test, 'aborts compiler lock waiting without spawning or replacing the live owner', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-lock-abort-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      const lockPath = compilerCoordinationLockPath(tempRoot);
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'live-owner'
      })}\n`);
      const controller = new AbortController();
      let installCalls = 0;

      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async () => {
          installCalls += 1;
          return { code: 0, stdout: '', stderr: '' };
        },
        lockTimeoutMs: 1_000,
        pollIntervalMs: 1,
        signal: controller.signal,
        sleep: async () => new Promise<void>(() => {
          queueMicrotask(() => controller.abort(new Error('fixture lock wait aborted')));
        })
      }, tempRoot)).rejects.toBeTruthy();

      expect(installCalls).toBe(0);
      expect(await readJson<{ token: string }>(lockPath)).toMatchObject({ token: 'live-owner' });
      await fs.rm(lockPath);
    }));

  effectfulTest(test, 'gives the compiler command only the operation budget remaining after lock contention', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-budget-narrowing-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'temporary-live-owner'
      })}\n`);
      const lockContentionElapsedMs = 150;
      const initialRemainingMs = operation.deadlineAtUnixMs - Date.now();
      let waited = false;
      let observedCommandTimeoutMs: number | undefined;

      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          observedCommandTimeoutMs = command.timeoutMs;
          await installCompilerDependencyFixture(command.cwd, 'remaining-budget');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        sleep: async () => {
          if (!waited) {
            waited = true;
            await new Promise<void>(resolve => setTimeout(resolve, lockContentionElapsedMs));
            await fs.rm(lockPath);
          }
        }
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(waited).toBe(true);
      expect(observedCommandTimeoutMs).toBeGreaterThan(0);
      expect(observedCommandTimeoutMs).toBeLessThan(initialRemainingMs - lockContentionElapsedMs);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }));

  effectfulTest(test, 'removes its exact compiler lock even when the final caller fence rejects', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-cleanup-fence-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'cleanup-fence');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);

      const lockPath = compilerCoordinationLockPath(tempRoot);
      let lifecycleBound = false;
      const lifecycle = Object.freeze({
        ...operation.generatedStateLifecycle,
        bind: async (...args: Parameters<typeof operation.generatedStateLifecycle.bind>) => {
          const registration = await operation.generatedStateLifecycle.bind(...args);
          lifecycleBound = true;
          return registration;
        }
      });
      await expect(ensureCompilerDepsReady({
        ...operation,
        beforeCommit: async () => {
          if (lifecycleBound) throw new Error('fixture final cleanup fence rejected');
        },
        generatedStateLifecycle: lifecycle
      }, tempRoot)).rejects.toThrow('fixture final cleanup fence rejected');

      expect(lifecycleBound).toBe(true);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }));

  effectfulTest(test, 'retries only the same Windows compiler lock identity and proves final absence', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-lock-delete-retry-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      const deleteAttempts: number[] = [];
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-retry');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        testInstallLockDeletePlatform: 'win32',
        testInstallLockDelete: async (filePath, attempt) => {
          expect(filePath.startsWith('\\\\?\\') ? filePath.slice(4) : filePath).toBe(lockPath);
          deleteAttempts.push(attempt);
          if (attempt === 1) {
            throw Object.assign(new Error('fixture Windows sharing violation'), { code: 'EBUSY' });
          }
        }
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(deleteAttempts).toEqual([1, 2, 1, 2]);
      await expect(fs.stat(lockPath))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }));

  effectfulTest(test, 'preserves a replacement Windows compiler lock after a transient deletion failure', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-lock-delete-replacement-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      let replaced = false;
      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-replacement');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 1,
        testInstallLockDeletePlatform: 'win32',
        testInstallLockDelete: async (filePath, attempt) => {
          if (attempt !== 1) return;
          await fs.rm(filePath);
          await fs.writeFile(filePath, `${JSON.stringify({
            createdAt: new Date().toISOString(),
            pid: process.pid,
            token: 'replacement-owner'
          })}\n`);
          replaced = true;
          throw Object.assign(new Error('fixture Windows replacement race'), { code: 'EPERM' });
        }
      }, tempRoot)).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-003',
        details: { outcome: 'preserved-replacement' }
      });

      expect(replaced).toBe(true);
      expect(await readJson<{ token: string }>(lockPath)).toMatchObject({ token: 'replacement-owner' });
      await fs.rm(lockPath);
    }));

  effectfulTest(test, 'reports an unknown Windows lock settlement when the operation deadline expires', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-lock-delete-deadline-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      let monotonicNowMs = performance.now();
      let failure: unknown;
      try {
        await ensureCompilerDepsReady({
          ...operation,
          materialize: async (_args, command) => {
            await installCompilerDependencyFixture(command.cwd, 'windows-lock-delete-deadline');
            return { code: 0, stdout: 'ok', stderr: '' };
          },
          monotonicNowMs: () => monotonicNowMs,
          pollIntervalMs: 1,
          testInstallLockDeletePlatform: 'win32',
          testInstallLockDelete: async () => {
            monotonicNowMs += 100_000;
            throw Object.assign(new Error('fixture Windows sharing violation'), { code: 'EBUSY' });
          }
        }, tempRoot);
      } catch (error) {
        failure = error;
      } finally {
        await fs.rm(lockPath, { force: true });
      }
      expect(failure).toMatchObject({
        code: 'RUNTIME-DEPS-003',
        details: { outcome: 'unknown' }
      });
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }));

  effectfulTest(test, 'reclaims a dead compiler install owner instead of timing out future development', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-orphan-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'preexisting');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot);
      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const lockPath = compilerCoordinationLockPath(tempRoot);
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-owner'
      })}\n`);
      let installCalls = 0;

      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'recovered');
          return { code: 0, stdout: 'ok', stderr: '' };
        },
        pollIntervalMs: 10,
      }, tempRoot);

      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(1);
      await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }));

  effectfulTest(test, 'preserves an unissued legacy reclaim marker for explicit architecture migration', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-legacy-reclaim-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lockPath = path.join(tempRoot, '.tmp', 'dependency-installs', 'compiler.lock');
      const reclaimPath = `${lockPath}.reclaim`;
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-legacy-owner'
      })}\n`);
      await fs.writeFile(reclaimPath, '123e4567-e89b-42d3-a456-426614174000\n');
      const expired = new Date('2026-01-01T00:00:00.000Z');
      await fs.utimes(reclaimPath, expired, expired);
      await expect(ensureCompilerDepsReady({
        ...operation,
        materialize: async () => {
          throw new Error('Unissued legacy marker must not start an install.');
        },
        pollIntervalMs: 10
      }, tempRoot)).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-004',
        details: { migrationRequired: true }
      });
      expect((await readJson<{ token: string }>(lockPath)).token).toBe('dead-legacy-owner');
      expect(await fs.readFile(reclaimPath, 'utf8')).toBe('123e4567-e89b-42d3-a456-426614174000\n');
      await fs.rm(reclaimPath);
      await fs.rm(lockPath);
      expect((await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'recovered-after-explicit-legacy-settlement');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot)).source).toBe('installed');
    }));
  });
