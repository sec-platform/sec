import { createGeneratedStateRegistrationMutationBackend } from '../../src/adapters/runtime-state/generated-state/registration-store.ts';
import { generatedStateDigest } from '../../src/execution/generated-state/contract.ts';
import {
  CodedFailure,
  EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS,
  EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  advanceDependencyTransition,
  beginDependencyTransition,
  compilerFixtureGeneratedStateEnvironment,
  compilerTransitionBackupPath,
  dependencyTransitionNamespacePaths,
  describe,
  effectfulTest,
  ensureCompilerDepsReady,
  expect,
  fs,
  installCompilerDependencyFixture,
  loadRuntimeDependencySpec,
  markDependencyTransitionFailure,
  observeDependencyTransitionSlot,
  path,
  readDependencyTransition,
  readJson,
  runtimeDependencyOperationOptions,
  runtimeDependencySourceGeneration,
  settleAbandonedLegacyProjection,
  test,
  tmpdir,
  transitionAbsentSlot,
  transitionRecordName,
  withCompilerTestWorkspace,
  withLinkedCompilerTestWorkspaces,
  withTempWorkspace,
  writeCompilerDependencyRoot
} from './compiler-dependency-installation.ts';

for (const scenario of ['retired', 'disposed', 'foreign', 'preimage', 'cancel', 'unknown-lease'] as const) {
  effectfulTest(test, `recovers exact published locator predecessor: ${scenario}`, {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, effectful => withLinkedCompilerTestWorkspaces(effectful, async ({ consumerOperation, consumerRoot, ownerRoot }) => {
    if (consumerOperation === undefined) throw new Error('Fixture requires its original consumer operation');
    const lifecycle = consumerOperation.generatedStateLifecycle;
    if (lifecycle === undefined) throw new Error('Fixture requires its original generated-state lifecycle');
    const { bind, born, retired: retire, settleRetired, observeRetirement } = lifecycle;
    if (bind === undefined || born === undefined || retire === undefined || settleRetired === undefined || observeRetirement === undefined) {
      throw new Error('Fixture requires its original complete producer methods');
    }
    const activePath = path.join(consumerRoot, 'node_modules');
    const sourcePath = await fs.realpath(path.join(ownerRoot, 'node_modules'));
    const options = runtimeDependencyOperationOptions(consumerOperation);
    await bind.call(lifecycle, 'node_modules');
    await retire.call(lifecycle, 'node_modules', 'fixture-original-locator-retirement');
    expect(await settleRetired.call(lifecycle, 'node_modules')).toBe(true);
    // A real owned directory preimage and the genuine immutable source are
    // independent. Every receipt below comes from the production owners.
    await fs.cp(sourcePath, activePath, { recursive: true });
    await born.call(lifecycle, 'node_modules', 'fixture-directory-preimage');
    await bind.call(lifecycle, 'node_modules');
    const binding = await readJson<unknown>(path.join(sourcePath, '.sec-compiler-deps-binding-v5.json'));
    const sourceGeneration = await runtimeDependencySourceGeneration({ binding, options, ownerRoot, sourcePath });
    const backupPath = compilerTransitionBackupPath(consumerRoot, 'locator-preimage', sourceGeneration);
    let transition = await beginDependencyTransition({
      kind: 'compiler-locator', ownerRoot: consumerRoot, destinationPath: activePath,
      stagePath: null, backupPath, sourceGeneration, bindingDigest: generatedStateDigest(binding),
      preimageBindingDigest: generatedStateDigest(binding), options
    });
    const retired = await retire.call(lifecycle, 'node_modules', 'fixture-interrupted-directory-retirement');
    expect(retired).toBeDefined();
    await fs.rename(activePath, backupPath);
    if (scenario === 'disposed') expect(await settleRetired.call(lifecycle, 'node_modules')).toBe(true);
    await fs.symlink(sourcePath, activePath, process.platform === 'win32' ? 'junction' : 'dir');
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(activePath),
      backup: await observeDependencyTransitionSlot(backupPath), phase: 'published', durability: 'known', failure: null
    }, options);
    const published = await observeDependencyTransitionSlot(activePath);
    const sourceBytes = await fs.readFile(path.join(sourcePath, 'typescript', 'lib', 'typescript.js'), 'utf8');
    const oldBytes = await fs.readFile(path.join(backupPath, 'typescript', 'lib', 'typescript.js'), 'utf8');
    const controller = new AbortController();
    let rejectAtFence = false;
    let predecessorCaptured = false;
    let held: Awaited<ReturnType<ReturnType<typeof createGeneratedStateRegistrationMutationBackend>['acquireMutation']>> | undefined;
    const mutation = createGeneratedStateRegistrationMutationBackend();
    const beforeCommit = async () => {
      if (!predecessorCaptured || rejectAtFence || scenario === 'retired' || scenario === 'disposed' || scenario === 'foreign') return;
      const current = await readDependencyTransition(consumerRoot, options);
      if (current?.recordDigest !== transition.recordDigest) return;
      rejectAtFence = true;
      if (scenario === 'cancel') controller.abort();
      if (scenario === 'preimage') {
        // Publish through the genuine immutable owner; the original recovery
        // receipt must fail freshness rather than accept a caller projection.
        transition = await advanceDependencyTransition(transition, { phase: 'binding-validated' }, options);
      }
      if (scenario === 'unknown-lease') {
        held = await mutation.acquireMutation({ workspaceRoot: consumerRoot,
          environment: compilerFixtureGeneratedStateEnvironment(lifecycle) });
      }
    };
    const displaced = `${activePath}.fixture-published`;
    if (scenario === 'foreign') {
      await fs.rename(activePath, displaced);
      await fs.symlink(sourcePath, activePath, process.platform === 'win32' ? 'junction' : 'dir');
      expect((await observeDependencyTransitionSlot(activePath)).physical).not.toEqual(published.physical);
    }
    const beforeRecovery = await observeDependencyTransitionSlot(activePath);
    let installs = 0;
    const run = () => ensureCompilerDepsReady({
      ...consumerOperation, signal: controller.signal, beforeCommit,
      generatedStateLifecycle: { ...lifecycle, observeRetirement: async (relativePath, expected) => {
        const result = await observeRetirement.call(lifecycle, relativePath, expected);
        if (relativePath === 'node_modules' && expected?.physical !== undefined && transition.preimage.physical !== null &&
            expected.physical.device === transition.preimage.physical.device && expected.physical.inode === transition.preimage.physical.inode &&
            expected.physical.objectId === transition.preimage.physical.objectId) predecessorCaptured = true;
        return result;
      } },
      materialize: async () => { installs += 1; throw new Error('Recovery must retain the original source without installation'); }
    }, consumerRoot);
    try {
      if (scenario === 'retired' || scenario === 'disposed') {
        await expect(run()).resolves.toMatchObject({ source: 'existing' });
        expect((await readDependencyTransition(consumerRoot, options))?.phase).toBe('complete');
        expect((await bind.call(lifecycle, 'node_modules')).phase).toBe('active');
      } else {
        await expect(run()).rejects.toBeDefined();
        if (scenario !== 'unknown-lease') expect((await observeDependencyTransitionSlot(activePath)).physical).toEqual(beforeRecovery.physical);
        else {
          expect(held).toBeDefined();
          expect((await observeDependencyTransitionSlot(activePath)).kind).toBe('absent');
          const observation = mutation.readRegistrationCensus(held!).observations.get('node_modules');
          const retiredDigest = retired && 'registrationDigest' in retired ? retired.registrationDigest : null;
          if (retiredDigest === null) throw new Error('Fixture requires the original retired registration digest');
          expect(observation?.registration?.registrationDigest).toBe(retiredDigest);
          expect(observation?.registration?.phase).toBe('retired');
        }
      }
      expect(installs).toBe(0);
      expect(await fs.readFile(path.join(sourcePath, 'typescript', 'lib', 'typescript.js'), 'utf8')).toBe(sourceBytes);
      expect(await fs.readFile(path.join(backupPath, 'typescript', 'lib', 'typescript.js'), 'utf8')).toBe(oldBytes);
    } finally {
      if (held !== undefined) await mutation.settleMutation(held);
      if (scenario === 'foreign') { await fs.unlink(activePath); await fs.rename(displaced, activePath); }
      await ensureCompilerDepsReady({ ...consumerOperation, materialize: async () => { throw new Error('Fixture terminal recovery must not install'); } }, consumerRoot);
    }
  }));
}

describe('compiler dependency installation', () => {
  for (const slot of ['present', 'absent'] as const) effectfulTest(test, `recovers the durable stage locator after birth interruption: ${slot}`, {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, effectful => withCompilerTestWorkspace(effectful, 'compiler-stage-locator-birth-', async (root, operation) => {
    await writeCompilerDependencyRoot(root);
    const lifecycle = operation.generatedStateLifecycle;
    let births = 0;
    let installs = 0;
    const options = {
      ...operation,
      generatedStateLifecycle: { ...lifecycle, born: async (relativePath: string, operationId: string) => {
        if (relativePath === 'node_modules' && ++births === 1) throw new Error('fixture process loss before original birth');
        await lifecycle.born(relativePath, operationId);
      } },
      materialize: async (_args: string[], command: { cwd: string }) => {
        installs += 1;
        if (installs !== 1) throw new Error('Published stage locator recovery must retain its original generation');
        await installCompilerDependencyFixture(command.cwd, 'stage-locator-birth');
        return { code: 0, stdout: 'fixture', stderr: '' };
      }
    };
    await expect(ensureCompilerDepsReady(options, root)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
    const controls = runtimeDependencyOperationOptions(operation);
    const interrupted = await readDependencyTransition(root, controls);
    if (interrupted === null) throw new Error('Original publication has no durable transition');
    const locator = await observeDependencyTransitionSlot(path.join(root, 'node_modules'));
    expect(interrupted.kind).toBe('compiler-local-locator');
    expect(interrupted.destination.kind).toBe('link');
    expect(interrupted.destination.physical).toEqual(locator.physical);
    const sourceBytes = await fs.readFile(path.join(interrupted.sourceGeneration.sourcePath, 'typescript', 'lib', 'typescript.js'), 'utf8');
    if (slot === 'absent') await fs.unlink(path.join(root, 'node_modules'));
    expect((await ensureCompilerDepsReady(options, root)).source).toBe('existing');
    const recoveredLocator = await observeDependencyTransitionSlot(path.join(root, 'node_modules'));
    if (slot === 'present') expect(recoveredLocator.physical).toEqual(locator.physical);
    else {
      expect(recoveredLocator.kind).toBe('link');
      expect((await readDependencyTransition(root, controls))?.destination.physical).toEqual(recoveredLocator.physical);
    }
    expect(await fs.readFile(path.join(interrupted.sourceGeneration.sourcePath, 'typescript', 'lib', 'typescript.js'), 'utf8')).toBe(sourceBytes);
    expect((await readDependencyTransition(root, controls))?.phase).toBe('complete');
    expect((await lifecycle.bind('node_modules')).phase).toBe('active');
    expect(installs).toBe(1);
    expect(births).toBe(2);
  }));
  effectfulTest(test, 'settles a fully absent unpublished foreign project attempt without trusting its source', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-project-orphan-owner-', async (ownerRoot, operation) => {
      await writeCompilerDependencyRoot(ownerRoot);
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'project-orphan-owner');
          return { code: 0, stdout: 'fixture', stderr: '' };
        }
      }, ownerRoot);
      const options = runtimeDependencyOperationOptions(operation);
      const sourcePath = ready.sourceGeneration!.sourcePath;
      const sourceBinding = await readJson<unknown>(
        path.join(sourcePath, '.sec-compiler-deps-binding-v5.json')
      );
      const sourceGeneration = await runtimeDependencySourceGeneration({
        binding: sourceBinding,
        options,
        ownerRoot,
        sourcePath
      });
      const canonicalTarget = path.join(ownerRoot, 'current-project', 'node_modules');
      let abandoned: Awaited<ReturnType<typeof beginDependencyTransition>> | undefined;
      await withTempWorkspace(async (fixtureRoot) => {
        const target = path.join(fixtureRoot, 'node_modules');
        const stageRoot = path.join(fixtureRoot, '.tmp', 'project.staging-abandoned');
        const stage = path.join(stageRoot, 'node_modules');
        await fs.mkdir(stage, { recursive: true });
        abandoned = await beginDependencyTransition({
          kind: 'project-projection', ownerRoot, destinationPath: target,
          stagePath: stage, stageRootPath: stageRoot, backupPath: null,
          sourceGeneration, bindingDigest: sourceGeneration.bindingDigest, options
        });
        abandoned = await markDependencyTransitionFailure(abandoned,
          new CodedFailure('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path'), options);
        await expect(settleAbandonedLegacyProjection(abandoned, ownerRoot, canonicalTarget, options))
          .rejects.toThrow('physical residue');
        expect((await fs.lstat(stage)).isDirectory()).toBe(true);
      }, 'engineering-project-orphan-fixture-');
      expect(await settleAbandonedLegacyProjection(abandoned!, ownerRoot, canonicalTarget, options)).toBe(true);
      expect((await readDependencyTransition(ownerRoot, options))?.phase).toBe('rolled-back');

      await withTempWorkspace(async (fixtureRoot) => {
        const target = path.join(fixtureRoot, 'node_modules');
        const stageRoot = path.join(fixtureRoot, '.tmp', 'project.staging-published');
        const stage = path.join(stageRoot, 'node_modules');
        await fs.mkdir(stage, { recursive: true });
        let published = await beginDependencyTransition({
          kind: 'project-projection', ownerRoot, destinationPath: target,
          stagePath: stage, stageRootPath: stageRoot, backupPath: null,
          sourceGeneration, bindingDigest: sourceGeneration.bindingDigest, options
        });
        await fs.rename(stage, target);
        published = await advanceDependencyTransition(published, {
          destination: await observeDependencyTransitionSlot(target, sourceGeneration.bindingDigest),
          stage: transitionAbsentSlot(stage),
          phase: 'published'
        }, options);
        published = await markDependencyTransitionFailure(published,
          new CodedFailure('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path'), options);
        abandoned = published;
      }, 'engineering-project-published-fixture-');
      await expect(settleAbandonedLegacyProjection(abandoned!, ownerRoot, canonicalTarget, options))
        .rejects.toThrow('source binding is not exact');
      await advanceDependencyTransition(abandoned!, {
        destination: transitionAbsentSlot(abandoned!.destination.path),
        stage: transitionAbsentSlot(abandoned!.stage!.path),
        stageRoot: transitionAbsentSlot(abandoned!.stageRoot!.path),
        phase: 'rolled-back',
        durability: 'known'
      }, options);
    }));
  effectfulTest(test, 'settles only an abandoned legacy runtime projection after residue and tamper checks', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-legacy-projection-', async (root, operation) => {
      await writeCompilerDependencyRoot(root);
      const runtimeSpec = await loadRuntimeDependencySpec();
      await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
        packageManager: `bun@${process.versions.bun}`,
        dependencies: runtimeSpec.dependencies,
        devDependencies: runtimeSpec.devDependencies
      })}\n`);
      const ready = await ensureCompilerDepsReady({
        ...operation,
        materialize: async (_args, command) => {
          await installCompilerDependencyFixture(command.cwd, 'legacy-runtime-source');
          for (const name of RUNTIME_DEPENDENCY_PACKAGE_NAMES) {
            const packageRoot = path.join(command.cwd, 'node_modules', ...name.split('/'));
            const request = runtimeSpec.dependencies[name] ?? runtimeSpec.devDependencies[name]!;
            const alias = /^npm:(@[^/\s]+\/[^@\s]+|[^@\s]+)@(.+)$/u.exec(request);
            const manifestName = alias?.[1] ?? name;
            const version = alias?.[2] ?? request;
            await fs.mkdir(packageRoot, { recursive: true });
            await fs.writeFile(path.join(packageRoot, 'package.json'), `${JSON.stringify({
              name: manifestName,
              version,
              ...(name === 'typescript' ? { main: './lib/typescript.js' } : {})
            })}\n`);
          }
          return { code: 0, stdout: 'fixture', stderr: '' };
        }
      }, root);
      expect(ready.runtimeMaterialization).not.toBeNull();
      const options = runtimeDependencyOperationOptions(operation);
      const source = await runtimeDependencySourceGeneration({
        binding: ready.runtimeMaterialization!,
        options,
        ownerRoot: root,
        sourcePath: ready.sourceGeneration!.sourcePath
      });
      const legacyFixture = await fs.mkdtemp(path.join(tmpdir(), 'sec-legacy-projection-'));
      try {
        const sharedRoot = path.join(legacyFixture, '.shared-deps');
        const stageRoot = path.join(sharedRoot, '.runtime-generation-abc123');
        const stagePath = path.join(stageRoot, 'node_modules');
        const activePath = path.join(sharedRoot, 'node_modules');
        await fs.mkdir(stagePath, { recursive: true });
        let transition = await beginDependencyTransition({
          kind: 'runtime-projection', ownerRoot: root, destinationPath: activePath,
          stagePath, stageRootPath: stageRoot,
          backupPath: compilerTransitionBackupPath(root, 'runtime', source),
          sourceGeneration: source, bindingDigest: source.bindingDigest, options
        });
        await fs.rename(stagePath, activePath);
        transition = await advanceDependencyTransition(transition, {
          destination: await observeDependencyTransitionSlot(activePath, source.bindingDigest),
          stage: transitionAbsentSlot(stagePath),
          phase: 'published'
        }, options);
        transition = await markDependencyTransitionFailure(transition,
          new CodedFailure('IMPORT-AUTHORITY-004', 'Compiler transition journal targets a foreign canonical path'),
          options);
        await expect(ensureCompilerDepsReady(operation, root)).rejects.toMatchObject({
          code: 'IMPORT-AUTHORITY-004',
          details: { cause: 'Abandoned projection still has physical residue' }
        });
        expect((await fs.lstat(activePath)).isDirectory()).toBeTrue();
        await fs.rm(legacyFixture, { recursive: true });
        const blocked = (await readDependencyTransition(root, options))!;
        const recordPath = path.join(dependencyTransitionNamespacePaths(root).recordsRoot,
          transitionRecordName(blocked.recordDigest));
        const originalBytes = await fs.readFile(recordPath);
        try {
          await fs.writeFile(recordPath, Buffer.from(originalBytes.toString('utf8').replace('runtime-projection', 'untime-projection')));
          await expect(ensureCompilerDepsReady(operation, root)).rejects.toBeDefined();
        } finally {
          await fs.writeFile(recordPath, originalBytes);
        }
        const settled = await ensureCompilerDepsReady(operation, root);
        expect(settled.source).toBe('existing');
        expect((await readDependencyTransition(root, options))?.phase).toBe('rolled-back');
        await expect(fs.lstat(activePath)).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        await fs.rm(legacyFixture, { recursive: true, force: true });
      }
    }));
  effectfulTest(test, 'preserves an unknown physical worktree dependency directory instead of claiming it', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withLinkedCompilerTestWorkspaces(effectfulContext, async ({ consumerOperation, consumerRoot }) => {
      const ownedGeneration = path.join(consumerRoot, 'node_modules.owned-fixture');
      const unknownGeneration = path.join(consumerRoot, 'node_modules');
      const ownedTarget = await fs.realpath(unknownGeneration);
      await fs.rename(unknownGeneration, ownedGeneration);
      try {
        await fs.mkdir(unknownGeneration);
        await fs.writeFile(path.join(unknownGeneration, 'user-sentinel.txt'), 'preserve-me\n');

        await expect(ensureCompilerDepsReady({
          ...consumerOperation,
          materialize: async () => {
            throw new Error('Unknown physical state must not trigger install.');
          }
        }, consumerRoot)).rejects.toMatchObject({
          code: 'IMPORT-AUTHORITY-004',
          message: expect.stringContaining('not an owned compiler dependency generation')
        });
        expect((await fs.lstat(unknownGeneration)).isDirectory()).toBeTrue();
        expect(await fs.readFile(path.join(unknownGeneration, 'user-sentinel.txt'), 'utf8')).toBe('preserve-me\n');
        expect((await fs.lstat(ownedGeneration)).isSymbolicLink()).toBeTrue();
        expect(await fs.realpath(ownedGeneration)).toBe(ownedTarget);
      } finally {
        await fs.rm(unknownGeneration, { recursive: true, force: true });
        await fs.rename(ownedGeneration, unknownGeneration);
      }
    }));

  effectfulTest(test, 'recovers a retired stale locator after validation fails before ownership binding', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withLinkedCompilerTestWorkspaces(effectfulContext, async ({ consumerOperation, consumerRoot, ownerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');

      await expect(ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage === 'binding-observed') throw new Error('injected locator validation failure');
        }
      }, consumerRoot)).rejects.toMatchObject({
        code: 'IMPORT-AUTHORITY-004',
        details: { cause: 'injected locator validation failure' },
        message: 'Compiler dependency consumer bridge is incompatible'
      });
      await expect(fs.lstat(consumerNodeModules)).rejects.toMatchObject({ code: 'ENOENT' });
      const recovered = await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Retired locator recovery must reuse its physical owner.');
        }
      }, consumerRoot);
      expect(recovered.source).toBe('existing');
      expect(await fs.realpath(consumerNodeModules))
        .toBe(await fs.realpath(path.join(ownerRoot, 'node_modules')));
      expect(await fs.readFile(
        path.join(consumerNodeModules, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation-v2:typescript\n');
    }));

  effectfulTest(test, 'preserves an external replacement and emits recovery evidence when locator rollback loses CAS', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withLinkedCompilerTestWorkspaces(effectfulContext, async ({ consumerOperation, consumerRoot }) => {
      const consumerNodeModules = path.join(consumerRoot, 'node_modules');
      const displacedLocator = path.join(consumerRoot, 'node_modules.displaced-locator');
      let replacementCreated = false;

      const failure = await ensureCompilerDepsReady({
        ...consumerOperation,
        testCompilerBridgeValidationHook: async (stage) => {
          if (stage !== 'binding-observed' || replacementCreated) return;
          replacementCreated = true;
          await fs.rename(consumerNodeModules, displacedLocator);
          await fs.mkdir(consumerNodeModules);
          await fs.writeFile(path.join(consumerNodeModules, 'external-sentinel.txt'), 'external-owner\n');
          throw new Error('injected external replacement');
        }
      }, consumerRoot).then(
        () => null,
        (error: unknown) => error
      );

      const typedFailure = failure as {
        code: string;
        details: {
          cause: string;
          causeDetails: { cause: string };
          recoveryBackup: string | null;
          rollbackFailure: string;
        };
      };
      expect(typedFailure.code).toBe('IMPORT-AUTHORITY-004');
      expect(typedFailure.details.recoveryBackup).toBeNull();
      expect(typedFailure.details).toMatchObject({
        cause: 'Compiler dependency consumer bridge is incompatible',
        causeDetails: { cause: 'injected external replacement' },
        rollbackFailure: expect.stringContaining('changed before')
      });
      expect(await fs.readFile(path.join(consumerNodeModules, 'external-sentinel.txt'), 'utf8'))
        .toBe('external-owner\n');
      expect((await fs.lstat(displacedLocator)).isSymbolicLink()).toBeTrue();
      expect(await fs.readFile(
        path.join(displacedLocator, 'typescript', 'lib', 'typescript.js'),
        'utf8'
      )).toBe('primary-generation-v2:typescript\n');
      await fs.rm(consumerNodeModules, { recursive: true });
      await fs.rename(displacedLocator, consumerNodeModules);
      expect((await ensureCompilerDepsReady({
        ...consumerOperation,
        materialize: async () => {
          throw new Error('Recovered locator must reuse the physical owner.');
        }
      }, consumerRoot)).source).toBe('existing');
    }));

  effectfulTest(test, 'protects sealed compiler entries and repairs mutable corruption before developer commands', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-corruption-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const options = {
        ...operation,
        materialize: async (_args: string[], command: { cwd: string }) => {
          installCalls += 1;
          await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
          return { code: 0, stdout: 'ok', stderr: '' };
        }
      };
      await ensureCompilerDepsReady(options, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');
      if (process.platform === 'win32') {
        await expect(fs.writeFile(entryPath, 'corrupt\n')).rejects.toMatchObject({ code: 'EPERM' });
        expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('existing');
        expect(installCalls).toBe(1);
        expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-1:typescript\n');
      } else {
        await fs.writeFile(entryPath, 'corrupt\n');
        expect((await ensureCompilerDepsReady(options, tempRoot)).source).toBe('installed');
        expect(installCalls).toBe(2);
        expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:typescript\n');
      }
    }));

  effectfulTest(test, 'does not publish failed compiler materialization and allows a fresh exact retry', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-rollback-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      const stagingRoots: string[] = [];
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        stagingRoots.push(command.cwd);
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = { ...operation, materialize };
      await ensureCompilerDepsReady(baseOptions, tempRoot);
      const entryPath = path.join(tempRoot, 'node_modules', 'typescript', 'lib', 'typescript.js');

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      let failedInstallRoot: string | null = null;
      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async (_args, command) => {
          failedInstallRoot = command.cwd;
          return { code: 1, stdout: '', stderr: 'injected install failure' };
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-002' });
      expect(failedInstallRoot).not.toBeNull();
      await expect(fs.stat(failedInstallRoot!)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.lstat(path.join(tempRoot, 'node_modules')))
        .rejects.toMatchObject({ code: 'ENOENT' });

      expect((await ensureCompilerDepsReady(baseOptions, tempRoot)).source).toBe('installed');
      await expect(fs.stat(stagingRoots.at(-1)!)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(entryPath, 'utf8')).toBe('generation-2:typescript\n');
    }));

  effectfulTest(test, 'rejects a prepared historical transition when its stage lifecycle provenance is absent', {
    operationTimeoutMs: EFFECTFUL_COMPILER_OPERATION_TIMEOUT_MS,
    cleanupSettlementMarginMs: EFFECTFUL_COMPILER_CLEANUP_MARGIN_MS
  }, (effectfulContext) =>
    withCompilerTestWorkspace(effectfulContext, 'engineering-compiler-dev-deps-prepared-stage-absent-', async (tempRoot, operation) => {
      await writeCompilerDependencyRoot(tempRoot);
      let installCalls = 0;
      let stagedRoot: string | null = null;
      const materialize = async (_args: string[], command: { cwd: string }) => {
        installCalls += 1;
        stagedRoot = command.cwd;
        await installCompilerDependencyFixture(command.cwd, `generation-${installCalls}`);
        return { code: 0, stdout: 'ok', stderr: '' };
      };
      const baseOptions = {
        ...operation,
        materialize,
      };
      await ensureCompilerDepsReady(baseOptions, tempRoot);

      await fs.writeFile(path.join(tempRoot, 'bun.lock'), 'lock-v2\n');
      await expect(ensureCompilerDepsReady({
        ...baseOptions,
        testCompilerRename: async (source, target) => {
          if (stagedRoot !== null && path.resolve(source) === path.join(stagedRoot, 'node_modules')) {
            const interruption = new Error('historical process loss before preimage move') as NodeJS.ErrnoException;
            interruption.code = 'ENOTEMPTY';
            throw interruption;
          }
          await fs.rename(source, target);
        }
      }, tempRoot)).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect(installCalls).toBe(2);
      expect(stagedRoot).not.toBeNull();
      await expect(fs.stat(stagedRoot!)).resolves.toBeTruthy();

      // Remove the independent stage/lifecycle owner while leaving the
      // compiler-generation journal prepared. The unchanged preimage is not
      // enough to manufacture a rollback receipt from journal bytes alone.
      const stageIntentsPath = path.join(
        tempRoot,
        '.tmp',
        'dependency-installs',
        '.compiler-stage-intents-v1'
      );
      const parkedStageIntentsPath = `${stageIntentsPath}.fixture-parked`;
      await fs.rename(stageIntentsPath, parkedStageIntentsPath);
      let recoveryInstalls = 0;
      let recoveryError: unknown;
      try {
        await ensureCompilerDepsReady({
          ...baseOptions,
          materialize: async () => {
            recoveryInstalls += 1;
            throw new Error('provenance rejection must not install');
          }
        }, tempRoot);
      } catch (error) {
        recoveryError = error;
      } finally {
        await fs.rename(parkedStageIntentsPath, stageIntentsPath);
      }
      expect(recoveryError).toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
      expect((recoveryError as { details?: { cause?: string } }).details?.cause)
        .toMatch(/lifecycle|disposal authority|provenance|settlement intent/u);
      expect(recoveryInstalls).toBe(0);
      await ensureCompilerDepsReady({
        ...baseOptions,
        materialize: async () => {
          throw new Error('Restored stage provenance recovery must not reinstall.');
        }
      }, tempRoot);
    }));

  });
