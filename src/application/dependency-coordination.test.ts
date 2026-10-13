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
    async ensureCompilerReady() { throw new Error('must not install'); },
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
    async observeCompilerReady() { throw new Error('must not choose offline'); },
    async ensureCompilerReady() { order.push('ensure'); if (failPreparation) throw new Error('source owner blocked'); return { runtimeMaterialization: binding, nodeModulesPath: source.sourcePath, sourceGeneration: source }; },
    async readSourceGeneration() { order.push('proof'); return source; },
    async verifyIsolatedSource() { throw new Error('must not choose offline'); },
    async publishTarget(prepared: { sourceGeneration: typeof source }) { expect(prepared.sourceGeneration).toBe(source); order.push('target'); }
  };
  await ensureProjectDependencyEnvironment(ports);
  expect(order).toEqual(['paths', 'spec', 'ensure', 'proof', 'target']);
  order.length = 0; failPreparation = true;
  await expect(ensureProjectDependencyEnvironment(ports)).rejects.toThrow('source owner blocked');
  expect(order).toEqual(['paths', 'spec', 'ensure']);
});
test('project source preparation selects online readiness and completes proof before target admission', async () => {
  const order: string[] = [];
  const result = await prepareProjectDependencySource({ isolated: false, manifestHash: binding.manifestHash,
    compilerDependencyRoot: 'compiler', compilerNodeModulesPath: 'compiler-modules',
    async observeCompilerReady() { throw new Error('offline observer is not selected'); },
    async ensureCompilerReady() { order.push('ensure'); return { runtimeMaterialization: binding, nodeModulesPath: 'canonical-source', sourceGeneration: source }; },
    async readSourceGeneration(value, root, sourcePath) { expect(value).toBe(binding); expect(root).toBe(source.ownerRoot); expect(sourcePath).toBe(source.sourcePath); order.push('proof'); return source; },
    async verifyIsolatedSource() { throw new Error('offline verification is not selected'); }
  });
  order.push('target');
  expect(order).toEqual(['ensure', 'proof', 'target']);
  expect(result.sourceGeneration).toBe(source);
});
test('offline project source preparation never installs and refuses an invalid source before target admission', async () => {
  let installs = 0, targets = 0;
  await expect((async () => {
    await prepareProjectDependencySource({ isolated: true, manifestHash: binding.manifestHash,
      compilerDependencyRoot: 'compiler', compilerNodeModulesPath: 'compiler-modules',
      async observeCompilerReady() { return { kind: 'ready', binding: { runtimeMaterialization: binding }, sourceGeneration: source }; },
      async ensureCompilerReady() { installs++; throw new Error('must not install'); },
      async readSourceGeneration() { return source; },
      async verifyIsolatedSource() { return false; }
    });
    targets++;
  })()).rejects.toThrow('unavailable for isolated verification');
  expect(installs).toBe(0);
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
