import {
  assertCompilerDependencyEnvironmentRetirementReceipt,
  disposeCompilerDependencyEnvironment,
  migrateDependencyTransitionJournal,
  removeSettledGeneratedStateFixtureRoot,
  settleEffectfulTestCleanup,
  type IsolatedGeneratedStateLifecycle,
  EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS,
  EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
  armRepositoryChangeObserver,
  describe,
  effectfulTest,
  ensureCompilerDepsReady,
  expect,
  fs,
  generatedStateDigest,
  generatedStateFixtureRoots,
  settleWorkspaceCleanups,
  inspectNoFollowDirectoryChain,
  inspectNoFollowLinkEntry,
  installCompilerDependencyFixture,
  observeCompilerDependencyExecutionGenerationAuthority,
  path,
  readJson,
  readRuntimeDependencyOperationTelemetry,
  runFixtureGit,
  runtimeDependencyOperationOptions,
  settleRepositoryChangeObserver,
  test,
  withCompilerTestWorkspace,
  withEffectfulCompilerWorkspace,
  withLinkedCompilerTestWorkspaces,
  writeCompilerDependencyRoot
} from './compiler-dependency-installation.ts';

describe('compiler dependency installation', () => {
  if (process.platform === 'win32') effectfulTest(test, 'reads an existing coordination locator without transient repository writes', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-coordination-zero-write-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const options = {
        ...operation,
        materialize: async (_args: string[], command: { cwd: string }) => {
          await installCompilerDependencyFixture(command.cwd, 'stable');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      };
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      const resolution = await armRepositoryChangeObserver({
        roots: [path.join(tempRoot, '.tmp', 'dependency-installs')],
        deadlineAtUnixMs: operation.deadlineAtUnixMs
      });
      expect(resolution.status).toBe('ready');
      if (resolution.status !== 'ready') return;
      try {
        expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
      } finally {
        const settlement = await settleRepositoryChangeObserver(resolution.observer);
        if (settlement.status !== 'zero-events') {
          throw new Error(`Existing compiler locator read mutated its coordination namespace: ${JSON.stringify({
            status: settlement.status,
            events: settlement.status === 'events' ? settlement.events.slice(0, 8) : undefined
          })}`);
        }
      }
    }));
  effectfulTest(test, 'retires an owned dangling linked-worktree locator after its physical owner advances', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withLinkedCompilerTestWorkspaces(effectfulContext, async ({ consumerOperation, consumerRoot, ownerOperation, ownerRoot }) => {
      const consumerLocator = path.join(consumerRoot, 'node_modules');
      expect((await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('The first linked consumer must reuse its owner.');
        }
      }, consumerRoot)).source).toBe('existing');
      const oldTarget = await fs.realpath(consumerLocator);

      await fs.writeFile(path.join(ownerRoot, 'bun.lock'), 'lock-v3\n');
      await runFixtureGit(ownerRoot, ['add', 'bun.lock']);
      await runFixtureGit(ownerRoot, ['commit', '-m', 'epoch-v3']);
      await runFixtureGit(consumerRoot, ['reset', '--hard', 'main']);
      await ensureCompilerDepsReady({
        ...ownerOperation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'primary-generation-v3');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      await expect(fs.lstat(oldTarget)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.lstat(consumerLocator)).isSymbolicLink()).toBeTrue();

      expect((await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('A dangling owned locator must recover from its physical owner.');
        }
      }, consumerRoot)).source).toBe('existing');
      expect(await fs.realpath(consumerLocator))
        .toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      expect(await fs.readFile(path.join(
        consumerLocator, 'typescript', 'lib', 'typescript.js'
      ), 'utf8')).toBe('primary-generation-v3:typescript\n');
    }));

  effectfulTest(test,
    'serializes immutable generations and invalidates the binding on lockfile or runtime changes',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-dev-deps-', async (
      tempRoot,
      lifecycleOwner
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots = new Set<string>();
      const materialize = async (args: string[], options: { cwd: string }) => {
        installCalls += 1;
        expect(args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile']);
        expect(options.cwd).not.toBe(tempRoot);
        const stagingName = path.basename(options.cwd);
        expect(stagingName.startsWith('c.staging-')).toBe(true);
        expect(stagingName.length).toBe('c.staging-'.length + 6);
        expect(path.dirname(options.cwd)).toBe(path.join(tempRoot, '.tmp', 'dependency-installs'));
        stagingRoots.add(options.cwd);
        await installCompilerDependencyFixture(options.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const controls = runtimeDependencyOperationOptions({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycleOwner,
        signal: effectful.operationSignal
      });
      const options = { ...controls, materialize };

      const firstCall = ensureCompilerDepsReady(options, tempRoot);
      const secondCall = ensureCompilerDepsReady(options, tempRoot);
      const concurrent = await Promise.allSettled([firstCall, secondCall]);
      const concurrentFailures = concurrent.flatMap(result =>
        result.status === 'rejected' ? [result.reason] : []
      );
      if (concurrentFailures.length === 1) throw concurrentFailures[0];
      if (concurrentFailures.length > 1) {
        throw new AggregateError(concurrentFailures, 'Concurrent compiler dependency admissions failed');
      }
      const first = concurrent.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);

      expect(installCalls).toBe(1);
      expect(first.map(({ source }) => source).sort()).toEqual(['existing', 'installed']);
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');

      const packagePath = path.join(tempRoot, 'package.json');
      const packageManifest = JSON.parse(await fs.readFile(packagePath, 'utf8')) as Record<string, unknown>;
      await fs.writeFile(packagePath, `${JSON.stringify({
        ...packageManifest,
        scripts: { diagnostics: 'bun ./scripts/diagnostics.ts' }
      })}\n`, 'utf8');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
      expect(installCalls).toBe(1);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n', 'utf8');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(await fs.readFile(path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'), 'utf8'))
        .toBe('generation-2:typescript\n');

      await writeCompilerDependencyRoot(tempRoot, 'lock-v2\n', '0.0.0');
      await expect(ensureCompilerDepsReady(options, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-001' });
      expect(installCalls).toBe(2);
      await writeCompilerDependencyRoot(tempRoot, 'lock-v2\n');
      expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
      expect(installCalls).toBe(2);
      expect(stagingRoots.size).toBe(2);
      for (const stagingRoot of stagingRoots) {
        await expect(fs.stat(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      }
      const binding = await readJson<Record<string, unknown>>(path.join(
        tempRoot,
        'node_modules',
        '.sec-compiler-deps-binding-v5.json'
      ));
      expect(binding).toMatchObject({
        bunExecutablePath: expect.any(String),
        bunExecutableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        bunVersion: process.versions.bun,
        declaredBunVersion: process.versions.bun,
        dependencyManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        formatVersion: 'compiler-deps-binding-v5'
      });
      expect(binding).not.toHaveProperty('packageManifestSha256');
      expect(binding).not.toHaveProperty('packageSourceSha256');
      expect(readRuntimeDependencyOperationTelemetry(controls).phases).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: 'install', count: 2, outcomes: expect.objectContaining({ completed: 2 }) }),
        expect.objectContaining({ phase: 'publication', count: 2, outcomes: expect.objectContaining({ completed: 2 }) }),
        expect.objectContaining({ phase: 'validation', count: 2, outcomes: expect.objectContaining({ completed: 2 }) })
      ]));
    });
  });

  effectfulTest(test,
    'recovers an installed staging generation only from its durable intent and lifecycle registration',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-stage-intent-', async (
      tempRoot,
      lifecycleOwner
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lifecycleOutcomes: string[] = [];
      let installCalls = 0;
      let rejectFirstDisposal = true;
      const lifecycle = {
        born: lifecycleOwner.born,
        inspect: lifecycleOwner.inspect,
        bind: lifecycleOwner.bind,
        restore: lifecycleOwner.restore,
        retired: lifecycleOwner.retired,
        observeRetirement: lifecycleOwner.observeRetirement,
        disposed: async (
          relativePath: string,
          request: Parameters<typeof lifecycleOwner.disposed>[1]
        ) => {
          lifecycleOutcomes.push(request.outcome);
          if (rejectFirstDisposal) {
            rejectFirstDisposal = false;
            throw new Error('fixture disposal interruption');
          }
          return lifecycleOwner.disposed(relativePath, request);
        }
      };
      const materialize = async (_args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(options.cwd, `intent-generation-${installCalls}`);
        return installCalls === 1
          ? { code: 1, stdout: '', stderr: 'fixture install failure' }
          : { code: 0, stdout: 'ok', stderr: '' };
      };

      const operation = {
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        signal: effectful.operationSignal
      };
      await expect(ensureCompilerDepsReady({ ...operation, materialize, generatedStateLifecycle: lifecycle }, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      const stagedAfterFailure = (await fs.readdir(path.join(tempRoot, '.tmp', 'dependency-installs')))
        .filter((name) => name.startsWith('c.staging-'));
      expect(stagedAfterFailure).toHaveLength(1);
      const foreignResidue = path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        stagedAfterFailure[0]!,
        'foreign-residue'
      );
      await fs.writeFile(foreignResidue, 'foreign\n');
      await expect(ensureCompilerDepsReady({ ...operation, materialize, generatedStateLifecycle: lifecycle }, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(installCalls).toBe(1);
      await fs.rm(foreignResidue);

      const ready = await ensureCompilerDepsReady({ ...operation, materialize, generatedStateLifecycle: lifecycle }, tempRoot);
      expect(ready.source).toBe('installed');
      expect(installCalls).toBe(2);
      expect(lifecycleOutcomes).toContain('generation-staging-recovered');
      expect((await fs.readdir(path.join(tempRoot, '.tmp', 'dependency-installs')))
        .filter((name) => name.startsWith('c.staging-'))).toHaveLength(0);
    });
  });

  effectfulTest(test,
    'recovers a published compiler generation only from its exact producer provenance',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-published-provenance-', async (
      tempRoot,
      lifecycleOwner
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      let nodeModulesBirthAttempts = 0;
      let rejectFirstNodeModulesBirth = true;
      let rejectStageProvenanceBinding = false;
      let stageRelativePath: string | null = null;
      const lifecycle = Object.freeze({
        ...lifecycleOwner,
        born: async (relativePath: string, operationId: string): Promise<void> => {
          if (relativePath === 'node_modules') {
            nodeModulesBirthAttempts += 1;
            if (rejectFirstNodeModulesBirth) {
              rejectFirstNodeModulesBirth = false;
              throw new Error('fixture process loss before active generation provenance birth');
            }
          } else if (stageRelativePath === null) {
            stageRelativePath = relativePath;
          }
          await lifecycleOwner.born(relativePath, operationId);
        },
        bind: async (
          relativePath: string,
          expected?: Parameters<typeof lifecycleOwner.bind>[1]
        ) => {
          if (rejectStageProvenanceBinding && relativePath === stageRelativePath) {
            throw Object.assign(new Error('fixture stage provenance binding is unavailable'), {
              code: 'GENERATED_STATE_PROVENANCE_BLOCKED'
            });
          }
          return lifecycleOwner.bind(relativePath, expected);
        }
      });
      const operation = Object.freeze({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycle,
        signal: effectful.operationSignal
      });
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        if (installCalls !== 1) {
          throw new Error('Published-generation recovery must not install a replacement generation.');
        }
        await installCompilerDependencyFixture(command.cwd, 'published-provenance');
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
        .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(installCalls).toBe(1);
      expect(nodeModulesBirthAttempts).toBe(1);
      expect(stageRelativePath).not.toBeNull();
      await expect(observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      const stageRootPath = path.join(tempRoot, ...stageRelativePath!.split('/'));
      const parkedStageRootPath = `${stageRootPath}.fixture-parked`;
      await fs.rename(stageRootPath, parkedStageRootPath);
      await fs.mkdir(stageRootPath);
      try {
        await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
          .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      } finally {
        await fs.rmdir(stageRootPath);
        await fs.rename(parkedStageRootPath, stageRootPath);
      }
      expect(installCalls).toBe(1);
      await expect(observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      rejectStageProvenanceBinding = true;
      try {
        await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
          .rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      } finally {
        rejectStageProvenanceBinding = false;
      }
      expect(installCalls).toBe(1);
      await expect(observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      const recovered = await ensureCompilerDepsReady({ ...operation, materialize }, tempRoot);
      expect(recovered.source).toBe('existing');
      expect(installCalls).toBe(1);
      const executionAuthority = await observeCompilerDependencyExecutionGenerationAuthority(operation, tempRoot);
      expect(executionAuthority).not.toBeNull();

      const repositoryPhysical = inspectNoFollowDirectoryChain(
        tempRoot,
        'Published generation provenance fixture root'
      ).target;
      const locator = inspectNoFollowLinkEntry(repositoryPhysical, 'node_modules');
      if (locator === null || locator.linkTarget === null) {
        throw new Error('Recovered compiler generation did not publish its canonical locator.');
      }
      const activeRegistration = await lifecycleOwner.bind('node_modules');
      expect(activeRegistration).toMatchObject({
        phase: 'active',
        relativePath: 'node_modules',
        root: {
          device: locator.device,
          inode: locator.inode,
          objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
        }
      });
      expect(installCalls).toBe(1);
      expect(nodeModulesBirthAttempts).toBe(2);
    });
  });

  effectfulTest(test, 'retires only registered legacy staging roots and preserves foreign descendants', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-legacy-stage-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      const lifecycle = operation.generatedStateLifecycle;
      const stagingParent = path.join(tempRoot, '.tmp', 'dependency-installs');
      const createLegacyStage = async (name: string, foreign = false): Promise<string> => {
        const stageRoot = path.join(stagingParent, name);
        await fs.mkdir(path.join(stageRoot, 'node_modules'), { recursive: true });
        await Promise.all([
          fs.writeFile(path.join(stageRoot, 'package.json'), '{}\n'),
          fs.writeFile(path.join(stageRoot, 'bun.lock'), 'legacy\n'),
          fs.writeFile(path.join(stageRoot, 'bunfig.toml'), '[install]\n')
        ]);
        if (foreign) await fs.writeFile(path.join(stageRoot, 'foreign-residue'), 'foreign\n');
        await lifecycle.born(
          path.relative(tempRoot, stageRoot).replaceAll('\\', '/'),
          `legacy-stage:${name}`
        );
        return stageRoot;
      };
      const registeredLegacyStage = await createLegacyStage('c.staging-legacy-registered');
      let installCalls = 0;
      const materialize = async (_args: string[], options: { cwd: string }) => {
        installCalls += 1;
        await installCompilerDependencyFixture(options.cwd, `legacy-retirement-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };

      const ready = await ensureCompilerDepsReady({ ...operation, materialize }, tempRoot);
      expect(ready.source).toBe('installed');
      await expect(fs.stat(registeredLegacyStage)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(installCalls).toBe(1);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      const foreignLegacyStage = await createLegacyStage('c.staging-legacy-foreign', true);
      await expect(ensureCompilerDepsReady({ ...operation, materialize }, tempRoot))
        .rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(installCalls).toBe(1);
      expect(await fs.readFile(path.join(foreignLegacyStage, 'foreign-residue'), 'utf8')).toBe('foreign\n');

      const foreignLegacyStageRelativePath = path.relative(tempRoot, foreignLegacyStage).replaceAll('\\', '/');
      await fs.rm(path.join(foreignLegacyStage, 'foreign-residue'));
      await lifecycle.bind(foreignLegacyStageRelativePath);
      await lifecycle.retired(foreignLegacyStageRelativePath, 'fixture-settlement');
      await lifecycle.disposed(
        foreignLegacyStageRelativePath,
        { outcome: 'fixture-settlement', profile: 'automatic' }
      );
    }));

  });

effectfulTest(test.serial,
    'compiler fixture preserves terminal authority when secondary retirement fails',
    { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
    async effectful => {
      const fixtures: { root: string; lifecycle: IsolatedGeneratedStateLifecycle }[] = [];
      let probeEntered = false;
      let probeFailure: unknown;
      try {
        const failure = await withEffectfulCompilerWorkspace(effectful, 'sec-cdep-terminal-source-', async (root, lifecycle, secondary) => {
          fixtures.push({ root, lifecycle });
          await writeCompilerDependencyRoot(root);
          await ensureCompilerDepsReady({
            deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
            generatedStateLifecycle: lifecycle,
            signal: effectful.operationSignal,
            materialize: async (_args, command) => {
              await installCompilerDependencyFixture(command.cwd, 'terminal-source');
              return { code: 0, stdout: 'ok', stderr: '' };
            }
          }, root);
          {
            const { root: targetRoot, lifecycle: targetLifecycle } = secondary!;
            fixtures.push({ root: targetRoot, lifecycle: targetLifecycle });
            await migrateDependencyTransitionJournal(targetRoot, {
              deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
              generatedStateLifecycle: targetLifecycle, signal: effectful.operationSignal
            });
            await fs.mkdir(path.join(targetRoot, 'node_modules'));
            await fs.writeFile(path.join(targetRoot, 'node_modules', 'unmanaged-fixture.txt'), 'fixture-owned\n');
          }
        }, 'sec-cdep-terminal-target-').then(() => null, error => error);
        expect(failure).not.toBeNull();
        const [source, target] = fixtures;
        expect(await fs.readFile(path.join(target!.root, 'node_modules', 'unmanaged-fixture.txt'), 'utf8'))
          .toBe('fixture-owned\n');
        // The source cleanup still ran despite the target's independent failure.
        await expect(fs.lstat(path.join(source!.root, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
        probeFailure = await settleEffectfulTestCleanup({
          context: effectful, resourceRoot: source!.root,
          settle: async () => {
            probeEntered = true;
            throw new Error('terminal-authority-probe');
          }
        }).then(() => null, error => error);
      } finally {
        const [source, target] = fixtures;
        if (target !== undefined) {
          // Only remove the known unmanaged directory this test created; then
          // ask the dependency owner for its actual terminal readback receipt.
          await fs.rm(path.join(target.root, 'node_modules'), { recursive: true });
        }
        const failures: unknown[] = [];
        let sourceReceipt: Awaited<ReturnType<typeof disposeCompilerDependencyEnvironment>> | undefined;
        const settle = async (outcome: string) => {
          for (const fixture of [...fixtures].reverse()) {
            try {
              const receipt = await disposeCompilerDependencyEnvironment(fixture.root, {
                deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                generatedStateLifecycle: fixture.lifecycle, signal: effectful.cleanupSignal
              }, outcome);
              if (fixture === source) sourceReceipt = receipt;
              else assertCompilerDependencyEnvironmentRetirementReceipt(receipt, fixture.root);
            } catch (error) { failures.push(error); }
          }
          if (sourceReceipt === undefined || failures.length !== 0) {
            throw new AggregateError(failures, 'Terminal-authority counterexample cleanup failed');
          }
          return sourceReceipt;
        };
        if (source !== undefined) {
          if (probeEntered) {
            await settleEffectfulTestCleanup({ context: effectful, resourceRoot: source.root,
              settle: ({ outcome }) => settle(outcome) });
          } else {
            // A regressed fixture already consumed the terminal receipt; still
            // settle its retained target so the negative baseline leaks nothing.
            assertCompilerDependencyEnvironmentRetirementReceipt(
              await settle('terminal-authority-counterexample-cleanup'), source.root
            );
          }
          let duplicateSettlementEntered = false;
          await expect(settleEffectfulTestCleanup({ context: effectful, resourceRoot: source.root,
            settle: async () => {
              duplicateSettlementEntered = true;
              throw new Error('duplicate-terminal-probe');
            }
          })).rejects.toMatchObject({ code: 'EFFECTFUL-TEST-TERMINAL-AUTHORITY-UNRESOLVED' });
          expect(duplicateSettlementEntered).toBeFalse();
        }
        await settleWorkspaceCleanups(fixtures.flatMap(fixture => [
          () => fs.rm(fixture.root, { recursive: true, force: true }),
          async () => {
            if (generatedStateFixtureRoots.has(fixture.lifecycle)) {
              await removeSettledGeneratedStateFixtureRoot(fixture.lifecycle);
            }
          }
        ]));
      }
      expect(probeEntered).toBeTrue();
      expect(probeFailure).toMatchObject({ code: 'EFFECTFUL-TEST-PHYSICAL-RESIDUE' });
    });
