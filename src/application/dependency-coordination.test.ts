import { expect, test } from 'bun:test';
import path from 'node:path';
import { planCompilerDependencyGeneratedStateSettlement } from '../execution/dependency-generated-state.ts';
import type { GeneratedStateInventory } from '../execution/generated-state/contract.ts';
import { settleCompilerDependencyGeneratedState } from './dependency-generated-state.ts';
import { ensureProjectDependencyEnvironment, prepareProjectDependencySource } from './project-dependency-preparation.ts';

const source = Object.freeze({ ownerRoot: 'canonical-owner', sourcePath: 'canonical-source' });
const binding = Object.freeze({ manifestHash: 'locked-manifest' });
test('complete project use case owns prebound-only routing without source or target effects', async () => {
  const order: string[] = [];
  await ensureProjectDependencyEnvironment({ installMode: 'prebound-only',
    async readPreboundTarget() { order.push('prebound-read'); },
    readCanonicalPaths() { throw new Error('must not prepare'); },
    async readRuntimeSpec() { throw new Error('must not prepare'); },
    async observeCompilerReady() { throw new Error('must not prepare'); },
    async readSourceGeneration() { throw new Error('must not prepare'); },
    async verifyIsolatedSource() { throw new Error('must not prepare'); },
    async publishTarget() { throw new Error('must not publish'); }
  });
  expect(order).toEqual(['prebound-read']);
});
test('complete project use case owns source preparation before target transaction and blocks failed preparation', async () => {
  const order: string[] = [];
  let failPreparation = false;
  const ports = { installMode: 'allow' as const,
    async readPreboundTarget() { throw new Error('must not choose prebound'); },
    readCanonicalPaths() { order.push('paths'); return { compilerDependencyRoot: 'compiler', compilerNodeModulesPath: 'compiler-modules' }; },
    async readRuntimeSpec() { order.push('spec'); return { manifestHash: binding.manifestHash }; },
    async observeCompilerReady() { order.push('observe'); if (failPreparation) throw new Error('source owner blocked'); return { kind: 'ready', binding: { runtimeMaterialization: binding }, sourceGeneration: source }; },
    async readSourceGeneration() { order.push('proof'); return source; },
    async verifyIsolatedSource() { throw new Error('must not choose offline'); },
    async publishTarget(prepared: { sourceGeneration: typeof source }) { expect(prepared.sourceGeneration).toBe(source); order.push('target'); }
  };
  await ensureProjectDependencyEnvironment(ports);
  expect(order).toEqual(['paths', 'spec', 'observe', 'proof', 'target']);
  order.length = 0; failPreparation = true;
  await expect(ensureProjectDependencyEnvironment(ports)).rejects.toThrow('source owner blocked');
  expect(order).toEqual(['paths', 'spec', 'observe']);
});
test('project source preparation only observes prepared readiness and rejects unavailable or foreign sources before target admission', async () => {
  const order: string[] = [];
  const ports = { isolated: false, manifestHash: binding.manifestHash,
    compilerDependencyRoot: 'compiler', compilerNodeModulesPath: 'compiler-modules',
    async observeCompilerReady() { order.push('observe'); return { kind: 'ready', binding: { runtimeMaterialization: binding }, sourceGeneration: source }; },
    async readSourceGeneration(value: Readonly<{ manifestHash: string }>, root: string, sourcePath: string) { expect(value).toBe(binding); expect(root).toBe(source.ownerRoot); expect(sourcePath).toBe(source.sourcePath); order.push('proof'); return source; },
    async verifyIsolatedSource() { throw new Error('offline verification is not selected'); }
  };
  const result = await prepareProjectDependencySource(ports);
  order.push('target');
  expect(order).toEqual(['observe', 'proof', 'target']);
  expect(result.sourceGeneration).toBe(source);
  for (const isolated of [false, true]) {
    for (const ready of [null,
      { kind: 'incompatible-bridge', binding: { runtimeMaterialization: binding } },
      { kind: 'ready', binding: { runtimeMaterialization: null } },
      { kind: 'ready', binding: { runtimeMaterialization: { manifestHash: 'foreign-manifest' } } }]) {
      order.length = 0;
      await expect(prepareProjectDependencySource({ ...ports, isolated,
        async observeCompilerReady() { order.push('observe'); return ready; }
      })).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
      expect(order).toEqual(['observe']);
    }
  }
});
test('offline project source preparation never installs and refuses an invalid source before target admission', async () => {
  let targets = 0;
  await expect((async () => {
    await prepareProjectDependencySource({ isolated: true, manifestHash: binding.manifestHash,
      compilerDependencyRoot: 'compiler', compilerNodeModulesPath: 'compiler-modules',
      async observeCompilerReady() { return { kind: 'ready', binding: { runtimeMaterialization: binding }, sourceGeneration: source }; },
      async readSourceGeneration() { return source; },
      async verifyIsolatedSource() { return false; }
    });
    targets++;
  })()).rejects.toThrow('unavailable for isolated verification');
  expect(targets).toBe(0);
});
test('dependency settlement rejects a stale plan before journal mutation and orders both inventory reads', async () => {
  const root = path.resolve('fixture-repository');
  const physical = { device: '1', inode: '2', objectId: '3' };
  const sha = `sha256:${'a'.repeat(64)}` as const;
  const inventory: GeneratedStateInventory = { schema: 'sec-generated-state-inventory-v1', registryDigest: sha,
    repositoryRoot: root, workspace: physical, workspaceRegistration: 'registered', entries: [], blockers: [], inventoryDigest: sha };
  const plan = planCompilerDependencyGeneratedStateSettlement({ repositoryRoot: root, workspaceRoot: root,
    inventory, workspaceIdentity: physical, profile: 'safe' });
  const order: string[] = [];
  const ports = { async inspect() { order.push('inspect'); return inventory; },
    observeWorkspace() { return physical; }, async migrateJournal() { order.push('migrate'); } };
  await expect(settleCompilerDependencyGeneratedState({ ...plan, inventoryDigest: `sha256:${'b'.repeat(64)}` }, ports)).rejects.toThrow('stale');
  expect(order).toEqual(['inspect']);
  order.length = 0;
  const receipt = await settleCompilerDependencyGeneratedState(plan, ports);
  expect(order).toEqual(['inspect', 'migrate', 'inspect']);
  expect(receipt.terminal).toBe('completed');
});
