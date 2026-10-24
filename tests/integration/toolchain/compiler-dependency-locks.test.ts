import { randomUUID } from 'node:crypto';
import type { PhysicalDirectoryIdentity } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  observeNoFollowOwnedFile,
  readNoFollowOwnedFileBytes
} from '../../../src/adapters/toolchain/dependencies/runtime/dependency-coordination-location.ts';
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
  physicalNoFollow,
  readJson,
  settleWorkspaceCallback,
  test,
  withCompilerTestWorkspace,
  withTempWorkspace,
  writeCompilerDependencyRoot
} from './compiler-dependency-fixtures.ts';

// Capture before exercising the failure. A later path lookup is never authority
// to remove a replacement lock or unknown recovery residue.
function retainFixtureFileRemoval(filePath: string): () => Promise<void> {
  const observed = observeNoFollowOwnedFile(filePath, 'Injected compiler lock');
  if (observed === null) throw new Error('Injected compiler lock is absent before capture.');
  const bytes = readNoFollowOwnedFileBytes(observed, 'Injected compiler lock bytes');
  let removed = false;
  return async () => {
    if (removed) return;
    physicalNoFollow.assertSameNoFollowDirectoryIdentity(observed.parent, 'Injected compiler lock cleanup parent');
    if (observeNoFollowOwnedFile(filePath, 'Injected compiler lock cleanup') !== null) {
      const anchorName = `.compiler-fixture-cleanup-${randomUUID()}`;
      const anchorBytes = Buffer.from(`${anchorName}\n`);
      const anchor = physicalNoFollow.publishExclusiveDurableCanonicalFile({
        parent: observed.parent, name: anchorName, bytes: anchorBytes, validate: () => undefined
      });
      if (!anchor.created) throw new Error('Compiler fixture cleanup anchor was not newly created.');
      let guardSettled = false;
      await settleWorkspaceCallback(async () => {
        const guard = physicalNoFollow.tryRetainExclusiveFileGuard(
          observed.parent, anchorName, anchor.physical, anchorBytes, observed.name
        );
        if (guard === null) {
          guardSettled = true;
          throw new Error('Compiler fixture cleanup resource guard is busy.');
        }
        await settleWorkspaceCallback(async () => {
          physicalNoFollow.deleteRetainedNoFollowEntry({
            root: observed.parent,
            relativePath: observed.name,
            kind: 'file',
            device: observed.device,
            inode: observed.inode,
            expectedFileBytes: bytes,
            resourceGuard: guard,
            ancestorDirectories: []
          });
        }, async () => { guard.dispose(); guardSettled = true; });
      }, async () => {
        // This fresh anchor is fixture-owned and was never passed to the SUT.
        // Its native guard has settled before its exact identity is removed.
        if (!guardSettled) return;
        physicalNoFollow.deleteRetainedNoFollowEntry({
          root: observed.parent, relativePath: anchorName, kind: 'file',
          device: anchor.physical.device, inode: anchor.physical.inode, ancestorDirectories: []
        });
      });
    }
    removed = true;
  };
}

async function withInjectedFile(
  filePath: string,
  bytes: string,
  run: (remove: () => Promise<void>) => Promise<void>
): Promise<void> {
  let remove: (() => Promise<void>) | undefined;
  await settleWorkspaceCallback(async () => {
    await fs.writeFile(filePath, bytes, { flag: 'wx' });
    remove = retainFixtureFileRemoval(filePath);
    await run(remove);
  }, async () => { await remove?.(); });
}

describe('compiler dependency installation', () => {
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
      let stageParent: PhysicalDirectoryIdentity | undefined;
      let originalSource: PhysicalDirectoryIdentity | undefined;
      let replacementSource: PhysicalDirectoryIdentity | undefined;
      const restoreStage = async () => {
        if (originalSource === undefined) return;
        const sourceName = path.basename(originalSource.path);
        const current = physicalNoFollow.inspectNoFollowDirectoryLeaf(stageParent!, sourceName);
        const parked = physicalNoFollow.inspectNoFollowDirectoryLeaf(stageParent!, `${sourceName}-original`);
        const isOriginal = (value: PhysicalDirectoryIdentity | null) => value !== null &&
          value.device === originalSource!.device && value.inode === originalSource!.inode &&
          value.objectId === originalSource!.objectId;
        // Relocation may have thrown after rename but before durability/readback.
        // Reconcile only the two known names against the pre-effect identity.
        if (isOriginal(current) && parked === null) {
          originalSource = undefined;
          return;
        }
        if (!isOriginal(parked)) throw new Error('Original compiler fixture stage identity is unresolved; residue is preserved.');
        if (current !== null) {
          if (replacementSource === undefined || current.device !== replacementSource.device ||
              current.inode !== replacementSource.inode || current.objectId !== replacementSource.objectId) {
            throw new Error('Compiler fixture replacement stage changed; residue is preserved.');
          }
          physicalNoFollow.deleteRetainedNoFollowEntry({
            root: stageParent!, relativePath: sourceName, kind: 'directory',
            device: replacementSource.device, inode: replacementSource.inode, ancestorDirectories: []
          });
          replacementSource = undefined;
        }
        physicalNoFollow.relocateRetainedNoFollowDirectory({
          directory: parked!, tombstoneName: sourceName
        });
        originalSource = undefined;
      };

      await settleWorkspaceCallback(async () => {
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
              stageParent = physicalNoFollow.inspectNoFollowDirectoryChain(path.dirname(source), 'Compiler fixture stage parent').target;
              originalSource = physicalNoFollow.inspectNoFollowDirectoryChain(source, 'Compiler fixture stage').target;
              physicalNoFollow.relocateRetainedNoFollowDirectory({
                directory: originalSource,
                tombstoneName: `${path.basename(source)}-original`
              });
              replacementSource = physicalNoFollow.createExclusiveNoFollowDirectory(stageParent, path.basename(source));
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
        await restoreStage();
        expect((await ensureCompilerDepsReady({
          ...baseOptions,
          materialize: async () => {
            throw new Error('Recovered exact stage must not install again.');
          }
        }, tempRoot)).source).toBe('existing');
        expect(await fs.readFile(path.join(
          tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'
        ), 'utf8')).toBe('generation-2:typescript\n');
      }, restoreStage);
    }));

  test('rejects an invalid operation budget before creating a dependency namespace', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const candidateRoot = path.join(tempRoot, 'candidate');
      await expect(ensureCompilerDepsReady({ lockTimeoutMs: 0 }, candidateRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-003' });
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
      await withInjectedFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'live-owner'
      })}\n`, async () => {
        const controller = new AbortController();
        const cancellation = new Error('fixture lock wait aborted');
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
            queueMicrotask(() => controller.abort(cancellation));
          })
        }, tempRoot)).rejects.toBe(cancellation);

        expect(installCalls).toBe(0);
        expect(await readJson<{ token: string }>(lockPath)).toMatchObject({ token: 'live-owner' });
      });
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
      await withInjectedFile(lockPath, `${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'temporary-live-owner'
      })}\n`, async (removeLock) => {
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
              await removeLock();
            }
          }
        }, tempRoot);

        expect(ready.source).toBe('installed');
        expect(waited).toBe(true);
        expect(observedCommandTimeoutMs).toBeGreaterThan(0);
        expect(observedCommandTimeoutMs).toBeLessThan(initialRemainingMs - lockContentionElapsedMs);
        await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
      });
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
      let removeReplacement: (() => Promise<void>) | undefined;
      await settleWorkspaceCallback(async () => {
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
            await retainFixtureFileRemoval(filePath)();
            await fs.writeFile(filePath, `${JSON.stringify({
              createdAt: new Date().toISOString(),
              pid: process.pid,
              token: 'replacement-owner'
            })}\n`, { flag: 'wx' });
            removeReplacement = retainFixtureFileRemoval(filePath);
            replaced = true;
            throw Object.assign(new Error('fixture Windows replacement race'), { code: 'EPERM' });
          }
        }, tempRoot)).rejects.toMatchObject({
          code: 'RUNTIME-DEPS-003',
          details: { outcome: 'preserved-replacement' }
        });

        expect(replaced).toBe(true);
        expect(await readJson<{ token: string }>(lockPath)).toMatchObject({ token: 'replacement-owner' });
      }, async () => { await removeReplacement?.(); });
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
      await withInjectedFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-owner'
      })}\n`, async () => {
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
      });
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
      await withInjectedFile(lockPath, `${JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        pid: 2_147_483_647,
        token: 'dead-legacy-owner'
      })}\n`, async (removeLock) => {
        await withInjectedFile(reclaimPath, '123e4567-e89b-42d3-a456-426614174000\n', async (removeReclaim) => {
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
          await removeReclaim();
          await removeLock();
          expect((await ensureCompilerDepsReady({
            ...operation,
            materialize: async (_args, command) => {
              await installCompilerDependencyFixture(command.cwd, 'recovered-after-explicit-legacy-settlement');
              return { code: 0, stdout: 'ok', stderr: '' };
            }
          }, tempRoot)).source).toBe('installed');
        });
      });
    }));
  });
