import { expect, test } from 'bun:test';
import path from 'node:path';
import { planCompilerDependencyGeneratedStateSettlement } from '../execution/dependency-generated-state.ts';
import type { GeneratedStateInventory } from '../execution/generated-state/contract.ts';
import { settleCompilerDependencyGeneratedState } from './dependency-generated-state.ts';
import { ensureProjectDependencyEnvironment } from './project-dependency-preparation.ts';

const source = Object.freeze({ ownerRoot: 'canonical-owner', sourcePath: 'canonical-source' });
const binding = Object.freeze({ manifestHash: 'locked-manifest' });
test('complete project use case owns prebound-only routing without source or target effects', async () => {
  const order: string[] = [];
  await ensureProjectDependencyEnvironment({ installMode: 'prebound-only',
    async readPreboundTarget() { order.push('prebound-read'); },
    readCanonicalPaths() { throw new Error('must not prepare'); },
    async readRuntimeSpec() { throw new Error('must not prepare'); },
    async observeCompilerReady() { throw new Error('must not prepare'); },
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
    async verifyIsolatedSource() { throw new Error('must not choose offline'); },
    async publishTarget(prepared: { sourceGeneration: typeof source }) { expect(prepared.sourceGeneration).toBe(source); order.push('target'); }
  };
  await ensureProjectDependencyEnvironment(ports);
  expect(order).toEqual(['paths', 'spec', 'observe', 'target']);
  order.length = 0; failPreparation = true;
  await expect(ensureProjectDependencyEnvironment(ports)).rejects.toThrow('source owner blocked');
  expect(order).toEqual(['paths', 'spec', 'observe']);
  for (const [installMode, ready] of [
    ['allow', null],
    ['offline-copy-only', { kind: 'ready', binding: { runtimeMaterialization: { manifestHash: 'foreign-manifest' } }, sourceGeneration: source }]
  ] as const) {
    order.length = 0;
    await expect(ensureProjectDependencyEnvironment({ ...ports, installMode,
      async observeCompilerReady() { order.push('observe'); return ready; }
    })).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });
    expect(order).toEqual(['paths', 'spec', 'observe']);
  }
});
test('offline project source preparation refuses an invalid isolated source before target admission', async () => {
  await expect(ensureProjectDependencyEnvironment({ installMode: 'offline-copy-only',
    async readPreboundTarget() { throw new Error('must not choose prebound'); },
    readCanonicalPaths() { return { compilerDependencyRoot: 'compiler', compilerNodeModulesPath: 'compiler-modules' }; },
    async readRuntimeSpec() { return { manifestHash: binding.manifestHash }; },
    async observeCompilerReady() { return { kind: 'ready', binding: { runtimeMaterialization: binding }, sourceGeneration: source }; },
    async verifyIsolatedSource(observedBinding, sourcePath) {
      expect(observedBinding).toBe(binding); expect(sourcePath).toBe('canonical-source'); return false;
    },
    async publishTarget() { throw new Error('invalid isolated source reached target'); }
  })).rejects.toThrow('unavailable for isolated verification');
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
