import {
  EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS,
  EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
  type GeneratedStateWorktreeRetirementEffectAuthority,
  type IsolatedGeneratedStateLifecycle,
  LINKED_WORKTREE_TEMP_PREFIX,
  POSIX_ROOT_PROCESS,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
  RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
  assertCompilerDependencyEnvironmentRetirementReceipt,
  assertPhysicalGenerationRetirementReceipt,
  compilerDependencyLocatorWorktreeRetirementProvider,
  createCompilerFixtureDependencyOperation,
  createIsolatedGeneratedStateLifecycles,
  dependencyTransitions,
  describe,
  disposeCompilerDependencyEnvironment,
  effectfulTest,
  ensureCompilerDepsReady,
  expect,
  fs,
  fsSync,
  inspectNoFollowDirectoryChain,
  installCompilerDependencyFixture,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  observeCompilerDependencyExecutionGenerationAuthority,
  observeCompilerDependencyLifecycleStateRoot,
  path,
  physicalNoFollow,
  readJson,
  removeSettledGeneratedStateFixtureRoot,
  resolveSecWorkspaceRuntimeRoots,
  retainCompilerDependencyExecutionGeneration,
  retainCompilerDependencyReadGeneration,
  runFixtureGit,
  scanNoFollowDirectoryTreeInventory,
  settleEffectfulTestCleanup,
  settleWorkspaceCallback,
  settleWorkspaceCleanups,
  spyOn,
  test,
  tmpdir,
  withCompilerTestConsumer,
  withCompilerTestWorkspace,
  withEffectfulCompilerWorkspace,
  withLinkedCompilerTestWorkspaces,
  withLinkedWorktreeTempWorkspace,
  withRetainedCompilerContentFixture,
  writeCompilerDependencyRoot
} from './compiler-dependency-installation.ts';

describe('compiler dependency installation', () => {
  effectfulTest(test,
    'retained dependency content is requalified through the public owner without an installer',
    { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
    effectful => withCompilerTestWorkspace(effectful, 'sec-cdep-content-target-', async (consumerRoot, operation) => {
      await writeCompilerDependencyRoot(consumerRoot);
      const target = createCompilerFixtureDependencyOperation(consumerRoot, operation.generatedStateLifecycle);
      const request = { deadlineAtUnixMs: operation.deadlineAtUnixMs,
        signal: operation.signal, installMode: 'prebound-only' as const };
      await withRetainedCompilerContentFixture(operation.deadlineAtUnixMs, async (content, contentRoot) => {
        const ready = await target.ensureCompilerDepsReadyFromRetainedContent(content, request);
        expect(ready.source).toBe('existing');
        expect(ready.requiresFreshProcess).toBeTrue();
        expect(await fs.realpath(ready.nodeModulesPath)).not.toBe(path.join(contentRoot, 'node_modules'));
        expect(await fs.readFile(path.join(ready.nodeModulesPath, 'typescript', 'lib', 'typescript.js'), 'utf8'))
          .toBe('transported-content:typescript\n');
        const binding = await readJson<Record<string, unknown>>(
          path.join(ready.nodeModulesPath, '.sec-compiler-deps-binding-v5.json'));
        expect(binding.formatVersion).toBe('compiler-deps-binding-v5');
        expect(binding.bunExecutablePath).toBe(await fs.realpath(process.execPath));
        expect(binding.manifestHash).toBe(ready.manifestHash);
        expect(binding.untrusted).toBeUndefined();
        const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
        expect(inventory.entries[0]!.registrationState).toBe('active');
        const observed = await observeCompilerDependencyExecutionGenerationAuthority(request, consumerRoot);
        expect(observed?.generationDigest).toBe(ready.executionGenerationAuthority.generationDigest);
        content.assertCurrent();
        await content.assertAuthorityCurrent();
        await expect(target.ensureCompilerDepsReadyFromRetainedContent(content, request))
          .rejects.toThrow('absent consumer locator');
      });
    }));

  effectfulTest(test,
    'retained dependency content rejects forged expired disposed retired incompatible and overlapping inputs before effects',
    { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
    effectful => withCompilerTestWorkspace(effectful, 'sec-cdep-content-reject-', async (consumerRoot, operation) => {
      await writeCompilerDependencyRoot(consumerRoot);
      const target = createCompilerFixtureDependencyOperation(consumerRoot, operation.generatedStateLifecycle);
      const request = { deadlineAtUnixMs: operation.deadlineAtUnixMs,
        signal: operation.signal, installMode: 'prebound-only' as const };
      await withRetainedCompilerContentFixture(operation.deadlineAtUnixMs, async (content, contentRoot) => {
        await expect(target.ensureCompilerDepsReadyFromRetainedContent({ ...content }, request))
          .rejects.toThrow('physical');
        await expect(Promise.resolve().then(() => target.ensureCompilerDepsReadyFromRetainedContent(content,
          { ...request, deadlineAtUnixMs: Date.now() - 1 }))).rejects.toThrow();
        await expect(target.ensureCompilerDepsReadyFromRetainedContent(content, request, contentRoot))
          .rejects.toThrow('physically disjoint');
        await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'different-transport-lock\n');
        await expect(target.ensureCompilerDepsReadyFromRetainedContent(content, request))
          .rejects.toThrow('content input differs: bun.lock');
        await writeCompilerDependencyRoot(consumerRoot);
        content.dispose();
        await expect(target.ensureCompilerDepsReadyFromRetainedContent(content, request)).rejects.toThrow('disposed');
        assertPhysicalGenerationRetirementReceipt(await content.retire());
        await expect(target.ensureCompilerDepsReadyFromRetainedContent(content, request)).rejects.toThrow();
        await expect(fs.lstat(path.join(consumerRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.lstat(path.join(consumerRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
      });
    }));

  effectfulTest(test,
    'explicit public generation reuse registers a foreign compiler target with its canonical owner',
    { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
    effectful => withCompilerTestWorkspace(effectful, 'sec-cdep-explicit-owner-', async (ownerRoot, ownerOperation) => {
      await writeCompilerDependencyRoot(ownerRoot);
      let installs = 0;
      const source = await ensureCompilerDepsReady({ ...ownerOperation, materialize: async (_args, command) => {
        installs++;
        await installCompilerDependencyFixture(command.cwd, 'explicit-source');
        return { code: 0, stdout: 'ok', stderr: '' };
      } }, ownerRoot);
      await withCompilerTestConsumer(effectful, 'sec-cdep-explicit-target-', async (consumerRoot, operation) => {
        await writeCompilerDependencyRoot(consumerRoot);
        const target = createCompilerFixtureDependencyOperation(consumerRoot, operation.generatedStateLifecycle);
        const publicOptions = { deadlineAtUnixMs: operation.deadlineAtUnixMs,
          installMode: 'prebound-only' as const, signal: operation.signal };
        Object.defineProperty(publicOptions, 'generatedStateLifecycle', {
          enumerable: true,
          get() { throw new Error('Public generation reuse must not read a caller lifecycle'); }
        });
        const ready = await target.ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, publicOptions);
        expect(ready.source).toBe('existing');
        expect(ready.requiresFreshProcess).toBeTrue();
        expect(ready.executionGenerationAuthority.generationDigest)
          .toBe(source.executionGenerationAuthority.generationDigest);
        expect(await fs.realpath(ready.nodeModulesPath)).toBe(await fs.realpath(source.nodeModulesPath));
        const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
        expect(inventory.entries[0]).toMatchObject({ owner: 'compiler-dependency-runtime',
          ruleId: 'compiler-node-modules', registrationState: 'active' });
        expect(inventory.entries[0]!.registrationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        const repeated = await target.ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, publicOptions);
        expect(repeated.requiresFreshProcess).toBeFalse();
        expect(repeated.executionGenerationAuthority.generationDigest)
          .toBe(source.executionGenerationAuthority.generationDigest);
        expect(installs).toBe(1);
      });
    }));

  effectfulTest(test,
    'explicit public generation reuse rejects forged and incompatible sources before target publication',
    { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
    effectful => withCompilerTestWorkspace(effectful, 'sec-cdep-explicit-owner-reject-', async (ownerRoot, ownerOperation) => {
      await writeCompilerDependencyRoot(ownerRoot);
      const source = await ensureCompilerDepsReady({ ...ownerOperation, materialize: async (_args, command) => {
        await installCompilerDependencyFixture(command.cwd, 'explicit-source-rejection');
        return { code: 0, stdout: 'ok', stderr: '' };
      } }, ownerRoot);
      await withCompilerTestConsumer(effectful, 'sec-cdep-explicit-target-reject-', async (consumerRoot, operation) => {
        await writeCompilerDependencyRoot(consumerRoot, 'different-lock\n');
        const target = createCompilerFixtureDependencyOperation(consumerRoot, operation.generatedStateLifecycle);
        const request = { deadlineAtUnixMs: operation.deadlineAtUnixMs,
          installMode: 'prebound-only' as const, signal: operation.signal };
        await expect(target.ensureCompilerDepsReadyFromGeneration({ ...source.executionGenerationAuthority }, request))
          .rejects.toThrow();
        await expect(target.ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, request))
          .rejects.toThrow('incompatible canonical inputs');
        await expect(fs.lstat(path.join(consumerRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.lstat(path.join(consumerRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
        const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
        expect(inventory.entries[0]!.registrationDigest).toBeNull();
      });
    }));

  for (const interference of ['same-byte-directory', 'directory-alias'] as const) {
    effectfulTest(test,
      `explicit generation reuse rejects ${interference} target replacement across source observation`,
      { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
        cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
      effectful => withCompilerTestWorkspace(effectful, 'sec-cdep-pin-owner-', async (ownerRoot, ownerOperation) => {
        await writeCompilerDependencyRoot(ownerRoot);
        const source = await ensureCompilerDepsReady({ ...ownerOperation, materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'pinned-source');
          return { code: 0, stdout: 'ok', stderr: '' };
        } }, ownerRoot);
        await withCompilerTestConsumer(effectful, 'sec-cdep-pin-target-', async (consumerRoot, operation) => {
          await writeCompilerDependencyRoot(consumerRoot);
          const target = createCompilerFixtureDependencyOperation(consumerRoot, operation.generatedStateLifecycle);
          const inputNames = ['package.json', 'bun.lock', '.bun-version'] as const;
          const inputs = await Promise.all(inputNames.map(name => fs.readFile(path.join(consumerRoot, name))));
          const originalIdentity = await fs.lstat(consumerRoot, { bigint: true });
          const parkedRoot = `${consumerRoot}.admitted`;
          const replacementRoot = interference === 'directory-alias' ? `${consumerRoot}.replacement` : consumerRoot;
          let parked = false;
          let replacementReady = false;
          await settleWorkspaceCallback(async () => {
            await expect(target.ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, {
              deadlineAtUnixMs: operation.deadlineAtUnixMs,
              installMode: 'prebound-only', signal: operation.signal,
              // This original public fence is awaited by source observation,
              // after target input bytes have been admitted, before publication.
              beforeCommit: async () => {
                if (parked) return;
                await fs.rename(consumerRoot, parkedRoot);
                parked = true;
                await fs.mkdir(replacementRoot);
                await Promise.all(inputNames.map((name, index) =>
                  fs.writeFile(path.join(replacementRoot, name), inputs[index]!)));
                if (interference === 'directory-alias') {
                  await fs.symlink(replacementRoot, consumerRoot, process.platform === 'win32' ? 'junction' : 'dir');
                }
                replacementReady = true;
              }
            })).rejects.toMatchObject({ code: interference === 'same-byte-directory'
              ? 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' : 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' });
            expect(replacementReady).toBeTrue();
            const replacementIdentity = await fs.lstat(replacementRoot, { bigint: true });
            expect(replacementIdentity.dev).toBe(originalIdentity.dev);
            expect(replacementIdentity.ino).not.toBe(originalIdentity.ino);
            for (let index = 0; index < inputNames.length; index++) {
              expect(await fs.readFile(path.join(replacementRoot, inputNames[index]!))).toEqual(inputs[index]!);
            }
            await expect(fs.lstat(path.join(replacementRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(fs.lstat(path.join(replacementRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
          }, async () => {
            if (!parked) return;
            if (interference === 'directory-alias') {
              const link = await fs.lstat(consumerRoot).catch(error => {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
                throw error;
              });
              if (link !== null) {
                expect(link.isSymbolicLink()).toBeTrue();
                await fs.unlink(consumerRoot);
              }
            } else if (replacementReady) {
              // Even a regressed implementation's published locator must go
              // through its original owner before the fixture root is restored.
              const receipt = await target.disposeCompilerDependencyEnvironment(consumerRoot, {
                deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs, signal: effectful.cleanupSignal
              });
              assertCompilerDependencyEnvironmentRetirementReceipt(receipt, consumerRoot);
            }
            await fs.rm(replacementRoot, { recursive: true, force: true });
            await fs.rename(parkedRoot, consumerRoot);
          });
        });
        // The original outer fixture must acquire its retirement receipt. A
        // leaked generation borrow would prevent that terminal cleanup.
      }));
  }

  for (const cut of ['after-publication', 'during-source-retirement'] as const) {
    // These module observers are scoped by the original Effectful fixture and
    // serial registrar. Every call forwards to its owner, even outside this root.
    effectfulTest(test.serial,
      `explicit generation reuse refuses target drift ${cut} and preserves owner recovery`,
      { operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
        cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS },
      effectful => withCompilerTestWorkspace(effectful, 'sec-cdep-late-owner-', async (ownerRoot, ownerOperation) => {
        await writeCompilerDependencyRoot(ownerRoot);
        const source = await ensureCompilerDepsReady({ ...ownerOperation, materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'late-cut-source');
          return { code: 0, stdout: 'ok', stderr: '' };
        } }, ownerRoot);
        const sourcePath = await fs.realpath(source.nodeModulesPath);
        const stateRoot = observeCompilerDependencyLifecycleStateRoot(ownerRoot);
        expect(stateRoot).not.toBeNull();
        const roots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: ownerRoot,
          environment: { ...process.env, SEC_STATE_HOME: stateRoot! } });
        const consumers = path.join(roots.workspaceStateRoot, 'compiler-dependency-coordination', 'v1', 'consumers');
        type ConsumerRecord = { leaseId: string; recordDigest: string; generationDigest: string; phase: string };
        type ConsumerZeroReceipt = { terminal: string; purpose: string; generationDigest: string;
          terminalRecords: { acquired: ConsumerRecord; released: ConsumerRecord & { previousRecordDigest: string } }[] };
        await withCompilerTestConsumer(effectful, 'sec-cdep-late-target-', async (consumerRoot, operation) => {
          await writeCompilerDependencyRoot(consumerRoot);
          const target = createCompilerFixtureDependencyOperation(consumerRoot, operation.generatedStateLifecycle);
          const request = { deadlineAtUnixMs: operation.deadlineAtUnixMs,
            installMode: 'prebound-only' as const, signal: operation.signal };
          const inputNames = ['package.json', 'bun.lock', '.bun-version'] as const;
          const inputs = await Promise.all(inputNames.map(name => fs.readFile(path.join(consumerRoot, name))));
          const originalIdentity = await fs.lstat(consumerRoot, { bigint: true });
          const parkedRoot = `${consumerRoot}.published`;
          const readLedger = dependencyTransitions.readDependencyTransitionLedger;
          const assertReceipt = physicalNoFollow.assertPhysicalGenerationRetirementReceipt;
          const publishDurable = physicalNoFollow.publishExclusiveDurableCanonicalFile;
          let ledgerObserver: ReturnType<typeof spyOn> | undefined;
          let retirementObserver: ReturnType<typeof spyOn> | undefined;
          let settlementObserver: ReturnType<typeof spyOn> | undefined;
          let parked = false;
          let replacementIdentity: { dev: bigint; ino: bigint } | undefined;
          let publication: { recordDigest: `sha256:${string}`; registrationDigest: `sha256:${string}`; locatorInode: bigint;
            acquired: ConsumerRecord } | undefined;
          let physicalRetirementObserved = false;
          let sourceSettlementObserved = false;
          // Synchronous substitution is needed inside the real synchronous
          // receipt validator; it cannot return an unawaited mutation promise.
          const replaceTarget = () => {
            expect(fsSync.lstatSync(consumerRoot, { bigint: true }).ino).toBe(originalIdentity.ino);
            fsSync.renameSync(consumerRoot, parkedRoot);
            parked = true;
            fsSync.mkdirSync(consumerRoot);
            replacementIdentity = fsSync.lstatSync(consumerRoot, { bigint: true });
            inputNames.forEach((name, index) => fsSync.writeFileSync(path.join(consumerRoot, name), inputs[index]!));
            const replacement = fsSync.lstatSync(consumerRoot, { bigint: true });
            expect(replacement.dev).toBe(originalIdentity.dev);
            expect(replacement.ino).not.toBe(originalIdentity.ino);
          };
          const restoreTarget = async () => {
            if (!parked) return;
            // Only the new, fixture-owned empty target may be removed. Preserve
            // the parked locator and registration until their original owner runs.
            expect(await fs.lstat(parkedRoot, { bigint: true })).toMatchObject({
              dev: originalIdentity.dev, ino: originalIdentity.ino });
            if (replacementIdentity !== undefined) {
              expect(await fs.lstat(consumerRoot, { bigint: true })).toMatchObject({
                dev: replacementIdentity.dev, ino: replacementIdentity.ino });
            }
            await expect(fs.lstat(path.join(consumerRoot, 'node_modules'))).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(fs.lstat(path.join(consumerRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
            await fs.rm(consumerRoot, { recursive: true, force: true });
            await fs.rename(parkedRoot, consumerRoot);
            parked = false;
          };
          await settleWorkspaceCallback(async () => {
            try {
              ledgerObserver = spyOn(dependencyTransitions, 'readDependencyTransitionLedger')
                .mockImplementation(async (...args) => {
                  const result = await Reflect.apply(readLedger, dependencyTransitions, args);
                  if (path.resolve(args[0]) !== ownerRoot || publication !== undefined) return result;
                  const targetLedger = await Reflect.apply(readLedger, dependencyTransitions, [consumerRoot, args[1]]);
                  if (targetLedger?.tip?.phase !== 'complete') return result;
                  expect(targetLedger.tip.kind).toBe('compiler-locator');
                  expect(result?.tip?.phase).toBe('complete');
                  const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
                  expect(inventory.entries[0]).toMatchObject({ owner: 'compiler-dependency-runtime',
                    ruleId: 'compiler-node-modules', registrationState: 'active' });
                  expect(inventory.entries[0]!.registrationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
                  const locator = await fs.lstat(path.join(consumerRoot, 'node_modules'), { bigint: true });
                  expect(locator.isSymbolicLink()).toBeTrue();
                  expect(await fs.realpath(path.join(consumerRoot, 'node_modules'))).toBe(sourcePath);
                  const acquiredNames = (await fs.readdir(consumers)).filter(name => name.endsWith('-acquired.json'));
                  expect(acquiredNames).toHaveLength(1);
                  const acquired = await readJson<ConsumerRecord>(path.join(consumers, acquiredNames[0]!));
                  expect(acquired).toMatchObject({ phase: 'acquired', generationDigest: source.executionGenerationAuthority.generationDigest });
                  publication = { recordDigest: targetLedger.tip.recordDigest,
                    registrationDigest: inventory.entries[0]!.registrationDigest!, locatorInode: locator.ino, acquired };
                  // This is the outer source-terminal read after the actual
                  // complete publication, not a beforeCommit inside its writer.
                  if (cut === 'after-publication') replaceTarget();
                  return result;
                });
              retirementObserver = spyOn(physicalNoFollow, 'assertPhysicalGenerationRetirementReceipt')
                .mockImplementation((receipt) => {
                  Reflect.apply(assertReceipt, physicalNoFollow, [receipt]);
                  if (publication === undefined || physicalRetirementObserved || receipt.root.path !== sourcePath) return;
                  expect(receipt.terminal).toBe('released');
                  physicalRetirementObserved = true;
                  // The original physical retire promise has resolved. The
                  // retained source owner must still release its durable borrow
                  // and return its own receipt before the final target fence.
                  if (cut === 'during-source-retirement') replaceTarget();
                });
              settlementObserver = spyOn(physicalNoFollow, 'publishExclusiveDurableCanonicalFile')
                .mockImplementation((...args) => {
                  const result = Reflect.apply(publishDurable, physicalNoFollow, args);
                  const input = args[0];
                  if (publication === undefined || input.parent.path !== consumers || !input.name.startsWith('zero-')) return result;
                  // Observe the real durable receipt before original compaction
                  // removes it. Never substitute caller bytes or its authority.
                  const receipt = JSON.parse(fsSync.readFileSync(path.join(consumers, input.name), 'utf8')) as ConsumerZeroReceipt;
                  if (receipt.purpose !== 'terminal-compaction') return result;
                  expect(receipt.terminal).toBe('consumer-zero');
                  expect(receipt.generationDigest).toBe(source.executionGenerationAuthority.generationDigest);
                  expect(receipt.terminalRecords.some(record => record.acquired.recordDigest === publication!.acquired.recordDigest
                    && record.released.leaseId === publication!.acquired.leaseId
                    && record.released.previousRecordDigest === publication!.acquired.recordDigest
                    && record.released.phase === 'released')).toBeTrue();
                  sourceSettlementObserved = true;
                  return result;
                });
              await expect(target.ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, request))
                .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED',
                  message: expect.stringContaining(cut === 'after-publication'
                    ? 'generation consumer after publication' : 'generation consumer after source settlement') });
            } finally {
              settlementObserver?.mockRestore();
              retirementObserver?.mockRestore();
              ledgerObserver?.mockRestore();
            }
            expect(publication).toBeDefined();
            expect(parked).toBeTrue();
            expect(physicalRetirementObserved).toBeTrue();
            expect(sourceSettlementObserved).toBeTrue();
            for (let index = 0; index < inputNames.length; index++) {
              expect(await fs.readFile(path.join(consumerRoot, inputNames[index]!))).toEqual(inputs[index]!);
            }
            // The genuine source owner has also finished durable compaction;
            // its acquisition and release records must no longer be live.
            const names = await fs.readdir(consumers);
            expect(names.filter(name => name.endsWith('-acquired.json') || name.endsWith('-released.json'))).toEqual([]);
            await restoreTarget();
            expect((await fs.lstat(path.join(consumerRoot, 'node_modules'), { bigint: true })).ino)
              .toBe(publication!.locatorInode);
            const recoveredLedger = await readLedger(consumerRoot, operation);
            expect(recoveredLedger?.tip?.recordDigest).toBe(publication!.recordDigest);
            const inventory = await operation.generatedStateLifecycle.inspect!(['node_modules']);
            expect(inventory.entries[0]!.registrationDigest).toBe(publication!.registrationDigest);
            const recovered = await target.ensureCompilerDepsReadyFromGeneration(source.executionGenerationAuthority, request);
            expect(recovered.requiresFreshProcess).toBeFalse();
            expect(recovered.executionGenerationAuthority.generationDigest).toBe(source.executionGenerationAuthority.generationDigest);
            expect(await fs.realpath(recovered.nodeModulesPath)).toBe(sourcePath);
            const receipt = await target.disposeCompilerDependencyEnvironment(consumerRoot, {
              deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs, signal: effectful.cleanupSignal
            });
            assertCompilerDependencyEnvironmentRetirementReceipt(receipt, consumerRoot);
            expect(receipt).toMatchObject({ locatorRetirement: 'retired', nodeModulesReadback: 'absent',
              generationCollection: 'complete', terminal: 'retired' });
            expect(await fs.readFile(path.join(sourcePath, 'typescript', 'lib', 'typescript.js'), 'utf8'))
              .toBe('late-cut-source:typescript\n');
          }, restoreTarget);
        });
        // Original outer cleanup also requires its genuine environment receipt;
        // any leaked source borrow prevents source generation collection.
      }));
  }

  effectfulTest(test,
    'reuses a compatible external physical generation without giving its bridge mutation ownership',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
      const tempRoot = await fs.mkdtemp(path.join(tmpdir(), LINKED_WORKTREE_TEMP_PREFIX));
      const ownerRoot = path.join(tempRoot, 'owner');
      const consumerRoot = path.join(tempRoot, 'consumer');
      const noConfigOwnerRoot = path.join(tempRoot, 'no-config-owner');
      const testOnlyConsumerRoot = path.join(tempRoot, 'test-only-consumer');
      let ownerLifecycle: IsolatedGeneratedStateLifecycle;
      let consumerLifecycle: IsolatedGeneratedStateLifecycle;
      let noConfigOwnerLifecycle: IsolatedGeneratedStateLifecycle;
      let testOnlyConsumerLifecycle: IsolatedGeneratedStateLifecycle;
      try {
        await Promise.all([
          fs.mkdir(ownerRoot),
          fs.mkdir(consumerRoot),
          fs.mkdir(noConfigOwnerRoot),
          fs.mkdir(testOnlyConsumerRoot)
        ]);
        const lifecycles = await createIsolatedGeneratedStateLifecycles([
          ownerRoot,
          consumerRoot,
          noConfigOwnerRoot,
          testOnlyConsumerRoot
        ], effectful.cleanupDeadlineAtUnixMs);
        ownerLifecycle = lifecycles[0]!;
        consumerLifecycle = lifecycles[1]!;
        noConfigOwnerLifecycle = lifecycles[2]!;
        testOnlyConsumerLifecycle = lifecycles[3]!;
      } catch (error) {
        try {
          await fs.rm(tempRoot, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'External compiler fixture setup and cleanup both failed');
        }
        throw error;
      }
      const operation = (generatedStateLifecycle: typeof ownerLifecycle) => Object.freeze({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle,
        signal: effectful.operationSignal
      });
      const ownerOperation = operation(ownerLifecycle);
      const consumerOperation = operation(consumerLifecycle);
      const noConfigOwnerOperation = operation(noConfigOwnerLifecycle);
      const testOnlyConsumerOperation = operation(testOnlyConsumerLifecycle);
      const startedRoots: Array<readonly [string, typeof ownerLifecycle]> = [];
      const cleanupFailures: unknown[] = [];
      let primaryFailure: { error: unknown } | undefined;
      try {
        await Promise.all([
          writeCompilerDependencyRoot(ownerRoot),
          writeCompilerDependencyRoot(consumerRoot)
        ]);
        await Promise.all([
        fs.writeFile(
          path.join(ownerRoot, 'bunfig.toml'),
          '[install]\r\nauto = "disable"\r\n\r\n[test]\r\npreload = ["owner.ts"]\r\n'
        ),
        fs.writeFile(
          path.join(consumerRoot, 'bunfig.toml'),
          '[install]\nauto = "disable"\n\n[test]\npreload = ["consumer.ts"]\n'
        )
        ]);
      let installCalls = 0;
      startedRoots.push([ownerRoot, ownerLifecycle]);
      let ownerReady = await ensureCompilerDepsReady({
        ...ownerOperation,
        materialize: async (_args, command) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'shared-owner');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, ownerRoot);
      const bridgePath = path.join(consumerRoot, 'node_modules');
      const generationPath = path.join(ownerRoot, 'node_modules');
      const ownerProofRoot = path.join(
        ownerRoot,
        '.tmp',
        'dependency-installs',
        'compiler-backups',
        'read-only-generations'
      );
      const ownerProofNames = await fs.readdir(ownerProofRoot);
      expect(ownerProofNames).toHaveLength(1);
      const ownerProofPath = path.join(ownerProofRoot, ownerProofNames[0]!);
      const generationPhysicalPath = await fs.realpath(generationPath);
      if (process.platform === 'win32') {
        const proofBefore = await fs.readFile(ownerProofPath);
        const sourceGeneration = ownerReady.sourceGeneration!;
        const physicalRoot = inspectNoFollowDirectoryChain(
          generationPhysicalPath,
          'Stale owner proof fixture generation root'
        ).target;
        const inventory = scanNoFollowDirectoryTreeInventory(physicalRoot, {
          deadlineAtMs: performance.now() + 30_000,
          maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
          maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES
        });
        const identityBefore = await fs.lstat(generationPhysicalPath, { bigint: true });
        const competing = await materializeRetainedNoFollowProvenDirectoryGeneration({
          binding: {
            generationDigest: sourceGeneration.epoch,
            treeDigest: sourceGeneration.treeDigest,
            treeEntryCount: sourceGeneration.treeEntryCount
          },
          deadlineAtUnixMs: Date.now() + 30_000,
          inventory,
          proofText: null,
          root: physicalRoot
        });
        await competing.generation.retire();
        expect((await fs.lstat(generationPhysicalPath, { bigint: true })).ctimeNs)
          .not.toBe(identityBefore.ctimeNs);
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          ownerOperation,
          ownerRoot
        )).toBeNull();
        ownerReady = await ensureCompilerDepsReady({
          ...ownerOperation,
          materialize: async () => {
            throw new Error('Stale owner proof recovery must not install.');
          }
        }, ownerRoot);
        expect(await fs.readFile(ownerProofPath)).not.toEqual(proofBefore);
        const recovered = await retainCompilerDependencyExecutionGeneration(
          ownerReady.executionGenerationAuthority,
          { deadlineAtUnixMs: Date.now() + 30_000 }
        );
        try {
          await recovered.physicalGeneration.assertAuthorityCurrent();
        } finally {
          await recovered.retire();
        }
      }
      const ownerProofBefore = await fs.readFile(ownerProofPath);
      const generationBefore = await fs.lstat(generationPhysicalPath, { bigint: true });
      await fs.symlink(generationPath, bridgePath, process.platform === 'win32' ? 'junction' : 'dir');
      startedRoots.push([consumerRoot, consumerLifecycle]);
      await consumerLifecycle.born(
        'node_modules',
        `compiler-dependency-bridge-fixture:${effectful.operationId}`
      );

      const parkedOwnerProofPath = `${ownerProofPath}.missing`;
      await fs.rename(ownerProofPath, parkedOwnerProofPath);
      try {
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          ownerOperation,
          ownerRoot
        )).toBeNull();
        await expect(observeCompilerDependencyExecutionGenerationAuthority(
          consumerOperation,
          consumerRoot
        )).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
        await expect(ensureCompilerDepsReady({
          ...consumerOperation,
          materialize: async () => {
            throw new Error('A consumer cannot replace its source owner proof.');
          }
        }, consumerRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
        expect((await fs.lstat(generationPhysicalPath, { bigint: true })).ctimeNs)
          .toBe(generationBefore.ctimeNs);
        await expect(fs.lstat(path.join(
          consumerRoot,
          '.tmp',
          'dependency-installs',
          'compiler-backups',
          'read-only-generations'
        ))).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await fs.rename(parkedOwnerProofPath, ownerProofPath);
      }

      const reused = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Compatible dependency bridge must not install.');
        }
      }, consumerRoot);
      expect(reused).toMatchObject({
        nodeModulesPath: bridgePath,
        root: consumerRoot,
        source: 'existing'
      });
      expect(installCalls).toBe(1);
      expect(await fs.realpath(bridgePath)).toBe(await fs.realpath(generationPath));
      const generationAfter = await fs.lstat(generationPhysicalPath, { bigint: true });
      expect(generationAfter.ctimeNs).toBe(generationBefore.ctimeNs);
      expect(await fs.readFile(ownerProofPath)).toEqual(ownerProofBefore);
      const consumerAuthority = await observeCompilerDependencyExecutionGenerationAuthority(
        consumerOperation,
        consumerRoot
      );
      expect(consumerAuthority).not.toBeNull();
      const consumerGeneration = await retainCompilerDependencyReadGeneration(
        consumerAuthority!,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      try {
        await consumerGeneration.assertAuthorityCurrent();
      } finally {
        await consumerGeneration.retire();
      }
      if (process.platform === 'win32') {
        const sourceGeneration = ownerReady.sourceGeneration!;
        const physicalRoot = inspectNoFollowDirectoryChain(
          generationPhysicalPath,
          'Stale consumer proof fixture generation root'
        ).target;
        const inventory = scanNoFollowDirectoryTreeInventory(physicalRoot, {
          deadlineAtMs: performance.now() + 30_000,
          maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
          maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES
        });
        const proofBefore = await fs.readFile(ownerProofPath);
        const competing = await materializeRetainedNoFollowProvenDirectoryGeneration({
          binding: {
            generationDigest: sourceGeneration.epoch,
            treeDigest: sourceGeneration.treeDigest,
            treeEntryCount: sourceGeneration.treeEntryCount
          },
          deadlineAtUnixMs: Date.now() + 30_000,
          inventory,
          proofText: null,
          root: physicalRoot
        });
        await competing.generation.retire();
        await expect(observeCompilerDependencyExecutionGenerationAuthority(
          consumerOperation,
          consumerRoot
        )).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          ownerOperation,
          ownerRoot
        )).toBeNull();
        ownerReady = await ensureCompilerDepsReady({
          ...ownerOperation,
          materialize: async () => {
            throw new Error('Stale consumer-visible owner proof recovery must not install.');
          }
        }, ownerRoot);
        expect(await fs.readFile(ownerProofPath)).not.toEqual(proofBefore);
        expect(await observeCompilerDependencyExecutionGenerationAuthority(
          consumerOperation,
          consumerRoot
        )).not.toBeNull();
      }

      const parkedBridgePath = path.join(consumerRoot, 'node_modules.validated');
      const replacementGenerationPath = path.join(tempRoot, 'replacement', 'node_modules');
      await fs.mkdir(replacementGenerationPath, { recursive: true });
      await expect(ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'binding-observed') return;
          await fs.rename(bridgePath, parkedBridgePath);
          await fs.symlink(
            replacementGenerationPath,
            bridgePath,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
        }
      }, consumerRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(await fs.realpath(parkedBridgePath)).toBe(await fs.realpath(generationPath));
      expect(await fs.realpath(bridgePath)).toBe(await fs.realpath(replacementGenerationPath));
      await fs.unlink(bridgePath);
      await fs.rename(parkedBridgePath, bridgePath);

      const originalConsumerLock = await fs.readFile(path.join(consumerRoot, 'bun.lock'));
      await expect(ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'final-binding-observed') return;
          await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'consumer-drift-during-admission\n');
        }
      }, consumerRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), originalConsumerLock);

      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), 'incompatible-lock\n');
      let incompatibleConsumerInstalls = 0;
      const incompatibleReady = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async (_args, command) => {
          incompatibleConsumerInstalls += 1;
          await installCompilerDependencyFixture(command.cwd, 'incompatible-consumer');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, consumerRoot);
      expect(incompatibleReady.source).toBe('installed');
      expect(incompatibleConsumerInstalls).toBe(1);
      expect(await fs.realpath(bridgePath)).not.toBe(await fs.realpath(generationPath));
      expect(await fs.readFile(
        path.join(generationPath, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('shared-owner:typescript\n');
      await fs.writeFile(path.join(consumerRoot, 'bun.lock'), originalConsumerLock);

      await Promise.all([
        writeCompilerDependencyRoot(noConfigOwnerRoot),
        writeCompilerDependencyRoot(testOnlyConsumerRoot),
        fs.writeFile(
          path.join(testOnlyConsumerRoot, 'bunfig.toml'),
          '[test]\npreload = ["consumer.ts"]\n'
        )
      ]);
      startedRoots.push([noConfigOwnerRoot, noConfigOwnerLifecycle]);
      await ensureCompilerDepsReady({
        ...noConfigOwnerOperation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'no-install-config');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, noConfigOwnerRoot);
      const testOnlyBridgePath = path.join(testOnlyConsumerRoot, 'node_modules');
      await fs.symlink(
        path.join(noConfigOwnerRoot, 'node_modules'),
        testOnlyBridgePath,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      startedRoots.push([testOnlyConsumerRoot, testOnlyConsumerLifecycle]);
      await testOnlyConsumerLifecycle.born(
        'node_modules',
        `compiler-dependency-test-only-bridge-fixture:${effectful.operationId}`
      );
      expect((await ensureCompilerDepsReady({
        ...testOnlyConsumerOperation,
        materialize: async () => {
          throw new Error('Absent and non-install-only config must share one identity.');
        }
      }, testOnlyConsumerRoot)).source).toBe('existing');
      } catch (error) {
        primaryFailure = { error };
      }
      let cleanupFailure: { error: unknown } | undefined;
      try {
        if (startedRoots.length !== 0) {
          await settleEffectfulTestCleanup({
            context: effectful,
            resourceRoot: ownerRoot,
            settle: async ({ outcome }) => {
              for (const [root, generatedStateLifecycle] of startedRoots.slice(1).reverse()) {
                try {
                  const receipt = await disposeCompilerDependencyEnvironment(root, {
                    deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                    generatedStateLifecycle,
                    signal: effectful.cleanupSignal
                  }, outcome);
                  assertCompilerDependencyEnvironmentRetirementReceipt(receipt, root);
                } catch (error) {
                  cleanupFailures.push(error);
                }
              }
              let ownerReceipt: Awaited<ReturnType<typeof disposeCompilerDependencyEnvironment>> | null = null;
              try {
                ownerReceipt = await disposeCompilerDependencyEnvironment(ownerRoot, {
                  deadlineAtUnixMs: effectful.cleanupDeadlineAtUnixMs,
                  generatedStateLifecycle: ownerLifecycle,
                  signal: effectful.cleanupSignal
                }, outcome);
              } catch (error) {
                cleanupFailures.push(error);
              }
              if (ownerReceipt === null || cleanupFailures.length !== 0) {
                throw new AggregateError(
                  cleanupFailures,
                  'Compiler dependency fixture retirement failed before terminal receipt consumption'
                );
              }
              return ownerReceipt;
            }
          });
        }
        if (cleanupFailures.length !== 0) {
          throw new AggregateError(
            cleanupFailures,
            'Compiler dependency fixture secondary retirement failed'
          );
        }
        await settleWorkspaceCleanups([
          () => fs.rm(tempRoot, { recursive: true, force: true }),
          ...[
            testOnlyConsumerLifecycle,
            noConfigOwnerLifecycle,
            consumerLifecycle,
            ownerLifecycle
          ].map(lifecycle => () => removeSettledGeneratedStateFixtureRoot(lifecycle))
        ]);
      } catch (error) {
        cleanupFailure = { error };
      }
      if (primaryFailure !== undefined && cleanupFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure.error, cleanupFailure.error],
          'Compiler dependency fixture operation and cleanup both failed'
        );
      }
      if (primaryFailure !== undefined) throw primaryFailure.error;
      if (cleanupFailure !== undefined) throw cleanupFailure.error;
  });

  effectfulTest(test.skipIf(process.platform !== 'linux'),
    'rejects a sealed generation content mutation before publishing its proof',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
    await withEffectfulCompilerWorkspace(effectful, 'engineering-compiler-sealed-mutation-', async (
      tempRoot,
      lifecycle
    ) => {
      await writeCompilerDependencyRoot(tempRoot);
      let mutated = false;
      let mutatedPath: string | null = null;
      await expect(ensureCompilerDepsReady({
        deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
        generatedStateLifecycle: lifecycle,
        signal: effectful.operationSignal,
        beforeCommit: async () => {
          if (mutated) return;
          const backupRoot = path.join(
            tempRoot,
            '.tmp',
            'dependency-installs',
            'compiler-backups'
          );
          let names: string[];
          try {
            names = await fs.readdir(backupRoot);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          const generationName = names.find((name) => name.startsWith('generation-'));
          if (generationName === undefined) return;
          const target = path.join(
            backupRoot,
            generationName,
            'typescript',
            'lib',
            'typescript.js'
          );
          let metadata: Awaited<ReturnType<typeof fs.lstat>>;
          try {
            metadata = await fs.lstat(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
          }
          const sealedMode = metadata.mode & 0o777;
          if ((sealedMode & 0o222) !== 0) return;
          await fs.chmod(target, 0o600);
          try {
            await fs.writeFile(target, 'mutated-after-seal\n');
          } finally {
            await fs.chmod(target, sealedMode);
          }
          mutated = true;
          mutatedPath = target;
        },
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'post-seal-mutation');
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(mutated).toBeTrue();
      expect(mutatedPath).not.toBeNull();
      expect((await fs.lstat(mutatedPath!)).mode & 0o222).not.toBe(0);
      await expect(fs.readdir(path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        'compiler-backups',
        'read-only-generations'
      ))).resolves.toEqual([]);
    });
  });

  effectfulTest(test.skipIf(process.platform !== 'linux' || POSIX_ROOT_PROCESS),
    'restores owner write authority when sealed generation proof publication is denied',
    {
      operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
      cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
    },
    async (effectful) => {
      await withEffectfulCompilerWorkspace(
        effectful,
        'engineering-compiler-proof-publication-denied-',
        async (tempRoot, lifecycle) => {
          await writeCompilerDependencyRoot(tempRoot);
          const proofRoot = path.join(
            tempRoot,
            '.tmp',
            'dependency-installs',
            'compiler-backups',
            'read-only-generations'
          );
          let denied = false;
          let proofRootMode: number | undefined;
          let sealedPayloadPath: string | undefined;
          const failure = await ensureCompilerDepsReady({
            deadlineAtUnixMs: effectful.operationDeadlineAtUnixMs,
            generatedStateLifecycle: lifecycle,
            signal: effectful.operationSignal,
            beforeCommit: async () => {
              if (denied) return;
              let proofEntries: string[];
              let generationEntries: string[];
              try {
                [proofEntries, generationEntries] = await Promise.all([
                  fs.readdir(proofRoot),
                  fs.readdir(path.dirname(proofRoot))
                ]);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                throw error;
              }
              if (proofEntries.length !== 0) return;
              const generationName = generationEntries.find(name => name.startsWith('generation-'));
              if (generationName === undefined) return;
              const payloadPath = path.join(
                path.dirname(proofRoot),
                generationName,
                'typescript',
                'lib',
                'typescript.js'
              );
              let payload: Awaited<ReturnType<typeof fs.lstat>>;
              try {
                payload = await fs.lstat(payloadPath);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                throw error;
              }
              if ((payload.mode & 0o222) !== 0) return;
              proofRootMode = (await fs.lstat(proofRoot)).mode & 0o777;
              await fs.chmod(proofRoot, proofRootMode & ~0o222);
              sealedPayloadPath = payloadPath;
              denied = true;
            },
            materialize: async (_args, command) => {
              await installCompilerDependencyFixture(command.cwd, 'proof-publication-denied');
              return { code: 0, stdout: 'ok', stderr: '' };
            }
          }, tempRoot).then(
            () => null,
            (error: unknown) => error
          );
          try {
            expect(failure).not.toBeNull();
            expect(denied).toBeTrue();
            expect(sealedPayloadPath).toBeDefined();
            expect((await fs.lstat(sealedPayloadPath!)).mode & 0o200).not.toBe(0);
            await expect(fs.readdir(proofRoot)).resolves.toEqual([]);
          } finally {
            if (proofRootMode !== undefined) await fs.chmod(proofRoot, proofRootMode);
          }
        }
      );
    });

  test('rejects a forged compiler locator retirement authority without touching its generation', async () => {
    await withLinkedWorktreeTempWorkspace(async (tempRoot) => {
      const ownerRoot = path.join(tempRoot, 'repository');
      const consumerRoot = path.join(tempRoot, 'candidate');
      await fs.mkdir(ownerRoot);
      await runFixtureGit(ownerRoot, ['init', '-b', 'main']);
      await writeCompilerDependencyRoot(ownerRoot);
      await fs.writeFile(path.join(ownerRoot, '.gitignore'), 'node_modules/\n.tmp/\n');
      await runFixtureGit(ownerRoot, ['add', '.gitignore', '.bun-version', 'bun.lock', 'package.json']);
      await runFixtureGit(ownerRoot, [
        '-c', 'user.email=sec@example.invalid',
        '-c', 'user.name=SEC Test',
        '-c', 'core.autocrlf=false',
        'commit', '-m', 'fixture'
      ]);
      await runFixtureGit(ownerRoot, ['config', 'core.autocrlf', 'false']);
      await installCompilerDependencyFixture(ownerRoot, 'primary-generation');
      await runFixtureGit(ownerRoot, ['worktree', 'add', '-b', 'candidate', consumerRoot]);
      await fs.symlink(
        path.join(ownerRoot, 'node_modules'),
        path.join(consumerRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      await expect(compilerDependencyLocatorWorktreeRetirementProvider.retire(Object.freeze({
        schema: 'sec-generated-state-worktree-retirement-effect-authority-v1'
      }) as GeneratedStateWorktreeRetirementEffectAuthority)).rejects.toThrow('forged, stale, replayed');
      expect((await fs.lstat(path.join(consumerRoot, 'node_modules'))).isSymbolicLink()).toBeTrue();
      expect(await fs.readFile(
        path.join(ownerRoot, 'node_modules', 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation:typescript\n');
    });
  });

  effectfulTest(test, 'retires one exact stale worktree generation before publishing a shared locator', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withLinkedCompilerTestWorkspaces(effectfulContext, async ({ consumerOperation, consumerRoot, ownerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const ready = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Exact external generation reuse must not install.');
        }
      }, consumerRoot);

      expect(ready).toMatchObject({
        requiresFreshProcess: true,
        root: consumerRoot,
        source: 'existing',
        transitionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
      });
      expect(await fs.realpath(consumerNodeModules)).toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      const backupsRoot = path.join(consumerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
      const backups = (await fs.readdir(backupsRoot)).filter((name) => name.startsWith('locator-preimage-'));
      expect(backups).toEqual([]);

      const admittedByFreshProcess = await ensureCompilerDepsReady(consumerOperation, consumerRoot);
      expect(admittedByFreshProcess.requiresFreshProcess).toBeFalse();
      expect(admittedByFreshProcess.transitionDigest).not.toBe(ready.transitionDigest);
    }));

  });
