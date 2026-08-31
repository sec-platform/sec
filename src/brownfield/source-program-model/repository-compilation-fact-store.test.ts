import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import type { SourceProgramFileInput } from './contract.ts';
import {
  createRepositoryCompilationFactStore,
  RepositoryCompilationFactStoreError,
  type RepositoryCompilationFactStore,
  type RepositoryCompilationFactStoreIdentity
} from './repository-compilation-fact-store.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { compileVirtualTestImpactProjection } from './test-impact-projection.ts';
import { parseTypeScriptSourceProgramFactShard } from './typescript-fact-shards.ts';
import { sourceProgramTypeScriptCompilerIdentity } from './typescript.ts';
import {
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput
} from './workspace-source-snapshot.ts';

const temporaryRoots: string[] = [];
const originalCacheHome = process.env.SEC_CACHE_HOME;
const childMarker = 'SEC_GENERATION_RESULT=';
const childSource = `
import { readFileSync } from 'node:fs';
import { createRepositoryCompilationFactStore } from './src/brownfield/source-program-model/repository-compilation-fact-store.ts';
import { sourceProgramTypeScriptCompilerIdentity } from './src/brownfield/source-program-model/typescript.ts';
const payload = JSON.parse(readFileSync(process.env.SEC_GENERATION_PAYLOAD, 'utf8'));
const store = createRepositoryCompilationFactStore({
  repositoryRoot: payload.repositoryRoot,
  identity: Object.freeze({ ...payload.identity, compiler: sourceProgramTypeScriptCompilerIdentity() })
});
const result = process.env.SEC_GENERATION_MODE === 'publish'
  ? store.publish(payload.shards)
  : store.load();
console.log('${childMarker}' + JSON.stringify({ pid: process.pid, result }));
`;

function runGenerationChild(
  payloadPath: string,
  mode: 'load' | 'publish'
): Readonly<{ pid: number; result: ReturnType<RepositoryCompilationFactStore['load']> }> {
  const child = spawnSync(process.execPath, ['-e', childSource], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SEC_GENERATION_MODE: mode,
      SEC_GENERATION_PAYLOAD: payloadPath
    },
    encoding: 'utf8'
  });
  if (child.status !== 0) {
    throw new Error(`Generation child failed: ${child.stderr || child.stdout}`);
  }
  const line = child.stdout.split(/\r?\n/u).find((value) => value.startsWith(childMarker));
  if (line === undefined) throw new Error('Generation child did not emit a result');
  return JSON.parse(line.slice(childMarker.length)) as Readonly<{
    pid: number;
    result: ReturnType<RepositoryCompilationFactStore['load']>;
  }>;
}

afterEach(() => {
  if (originalCacheHome === undefined) delete process.env.SEC_CACHE_HOME;
  else process.env.SEC_CACHE_HOME = originalCacheHome;
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()!;
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      throw new Error('Refusing to remove a non-temporary fact-store fixture');
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(value = 1) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-source-program-generation-'));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  process.env.SEC_CACHE_HOME = cacheRoot;
  const descriptorPath = 'src/example/sec.module.json';
  const source = `export const value = ${value};\n`;
  const secondSource = 'export const SECOND = true;\n';
  const projectConfigSource = '{"compilerOptions":{"strict":true}}\n';
  const files = Object.freeze([
    Object.freeze({ path: 'src/example/operation.ts', source, contentDigest: rawSha256(source) }),
    Object.freeze({ path: 'src/example/second.ts', source: secondSource, contentDigest: rawSha256(secondSource) }),
    Object.freeze({
      path: 'tsconfig.json',
      source: projectConfigSource,
      contentDigest: rawSha256(projectConfigSource)
    })
  ]);
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map((file) => file.path), descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [],
        preDependencyBootstrap: false
      })
    }]
  });
  const sourceRevision = sha256(files.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const subject = Object.freeze({
    kind: 'virtual-mutation' as const,
    provenance: Object.freeze({
      kind: 'source-program-virtual-mutation' as const,
      baseSnapshotDigest: sha256({ repositoryRoot }) as `sha256:${string}`,
      mutationDigest: sourceRevision as `sha256:${string}`
    })
  });
  const snapshotInput = Object.freeze({ subject, sourceRevision, files, moduleMembership });
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot(snapshotInput);
  const input = Object.freeze({
    workspaceSnapshot,
    projectInput: compileWorkspaceTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json'),
    repositoryRoot
  });
  return { cacheRoot, files, input, moduleMembership, repositoryRoot, snapshotInput };
}

function compilationInput(
  value: ReturnType<typeof fixture>,
  files: readonly SourceProgramFileInput[],
  sourceRevision: string,
  withRepositoryRoot = true
) {
  const projectConfig = value.files.find(({ path: repositoryPath }) => repositoryPath === 'tsconfig.json');
  if (projectConfig === undefined) throw new Error('Fixture project config is unavailable');
  const exactFiles = files.some(({ path: repositoryPath }) => repositoryPath === projectConfig.path)
    ? files
    : Object.freeze([...files, projectConfig]);
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    ...value.snapshotInput,
    files: exactFiles,
    subject: Object.freeze({
      kind: 'virtual-mutation' as const,
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation' as const,
        baseSnapshotDigest: value.input.workspaceSnapshot.snapshotDigest,
        mutationDigest: sha256({ sourceRevision }) as `sha256:${string}`
      })
    })
  });
  return Object.freeze({
    workspaceSnapshot,
    projectInput: compileWorkspaceTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json'),
    ...(withRepositoryRoot ? { repositoryRoot: value.repositoryRoot } : {})
  });
}

function generationRoot(cacheRoot: string): string {
  const schemaRoot = path.join(cacheRoot, 'source-program', 'repository-compilations');
  const schemas = readdirSync(schemaRoot);
  expect(schemas).toHaveLength(1);
  const namespace = path.join(schemaRoot, schemas[0]!);
  const generations = readdirSync(namespace, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(generations).toHaveLength(1);
  return path.join(namespace, generations[0]!);
}

function generationCount(cacheRoot: string): number {
  const schemaRoot = path.join(cacheRoot, 'source-program', 'repository-compilations');
  const schemas = readdirSync(schemaRoot);
  expect(schemas).toHaveLength(1);
  return readdirSync(path.join(schemaRoot, schemas[0]!), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
}

function storeIdentity(value: ReturnType<typeof fixture>): RepositoryCompilationFactStoreIdentity {
  const context = value.input.workspaceSnapshot;
  const projectInput = compileWorkspaceTypeScriptProjectInput(context, 'tsconfig.json');
  return Object.freeze({
    projectInputDigest: projectInput.projectInputDigest,
    projectConfigDigest: projectInput.projectConfigDigest,
    workspaceSnapshotIdentityDigest: projectInput.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: projectInput.orderedSourceFactsDigest,
    snapshotDigest: context.snapshotDigest,
    moduleMembershipDigest: context.moduleMembershipDigest,
    moduleGraphDigest: context.moduleGraphDigest,
    compiler: sourceProgramTypeScriptCompilerIdentity()
  });
}

test.serial('one immutable generation stores TypeScript facts while current contexts rebuild semantic projections', () => {
  const value = fixture();
  const cold = compileVirtualRepositorySourceProgramCompilation(value.input);
  const warm = compileVirtualRepositorySourceProgramCompilation(value.input);
  const files = readdirSync(generationRoot(value.cacheRoot)).sort();

  expect(cold.typeScriptCompilation.mode).toBe('full');
  expect(warm.typeScriptCompilation.mode).toBe('exact');
  expect(warm.workspaceSnapshot).toBe(cold.workspaceSnapshot);
  expect(warm.model).toEqual(cold.model);
  expect(cold.projectGeneration?.projectInputDigest).toBe(value.input.projectInput.projectInputDigest);
  expect(warm.projectGeneration).toEqual(cold.projectGeneration);
  expect(files).toHaveLength(2);
  expect(files).toContain('manifest.json');
  expect(files.some((file) => file.endsWith('.pack'))).toBe(true);
  expect(files.some((file) => file.endsWith('.projection'))).toBe(false);
});

test.serial('a published project generation is strictly revalidated by a fresh process', () => {
  const value = fixture();
  const cleanInput = Object.freeze({
    workspaceSnapshot: value.input.workspaceSnapshot,
    projectInput: value.input.projectInput
  });
  const compiled = compileVirtualRepositorySourceProgramCompilation(cleanInput);
  const { compiler: _compiler, ...serializableIdentity } = storeIdentity(value);
  const payloadPath = path.join(path.dirname(value.repositoryRoot), 'generation-payload.json');
  const writePayload = (identity: typeof serializableIdentity): void => {
    writeFileSync(payloadPath, JSON.stringify({
      repositoryRoot: value.repositoryRoot,
      identity,
      shards: compiled.typeScriptCompilation.state.factShards
    }));
  };

  writePayload(serializableIdentity);
  const publisher = runGenerationChild(payloadPath, 'publish');
  const reader = runGenerationChild(payloadPath, 'load');
  expect(publisher.pid).not.toBe(reader.pid);
  expect(publisher.result.status).toBe('hit');
  if (reader.result.status !== 'hit') throw new Error('Fresh process did not read the published generation');
  if (publisher.result.status !== 'hit') throw new Error('Fresh process did not publish the generation');
  expect(reader.result.generation).toEqual(publisher.result.generation);
  expect(reader.result.shards).toEqual(publisher.result.shards);
  expect(reader.result.generation.projectInputDigest).toBe(serializableIdentity.projectInputDigest);
  expect(reader.result.generation.workspaceSnapshotIdentityDigest)
    .toBe(serializableIdentity.workspaceSnapshotIdentityDigest);
  const projection = compileVirtualTestImpactProjection({
    workspaceSnapshot: compiled.workspaceSnapshot,
    typeScriptModel: compiled.typeScriptCompilation.model,
    testObservations: compiled.testObservations,
    projectGeneration: reader.result.generation
  });
  expect(projection.projectGenerationDigest).toBe(reader.result.generation.generationDigest);
  expect(projection.projectGenerationReceiptDigest).toBe(reader.result.generation.receiptDigest);
  expect(() => compileVirtualTestImpactProjection({
    workspaceSnapshot: compiled.workspaceSnapshot,
    typeScriptModel: compiled.typeScriptCompilation.model,
    testObservations: compiled.testObservations,
    projectGeneration: Object.freeze({
      ...reader.result.generation,
      projectInputDigest: sha256('foreign-project-input') as `sha256:${string}`
    })
  })).toThrow('not digest-bound');

  const changedIdentity = Object.freeze({
    ...serializableIdentity,
    projectConfigDigest: sha256('changed project config') as `sha256:${string}`,
    projectInputDigest: sha256({
      previous: serializableIdentity.projectInputDigest,
      projectConfigDigest: sha256('changed project config')
    }) as `sha256:${string}`
  });
  writePayload(changedIdentity);
  expect(runGenerationChild(payloadPath, 'load').result.status).toBe('miss');
  const changedPublisher = runGenerationChild(payloadPath, 'publish');
  const changedReader = runGenerationChild(payloadPath, 'load');
  if (changedReader.result.status !== 'hit') throw new Error('Changed project generation was not published');
  if (changedPublisher.result.status !== 'hit') throw new Error('Changed project generation publication failed');
  expect(changedReader.result.generation).toEqual(changedPublisher.result.generation);
  expect(changedReader.result.shards).toEqual(changedPublisher.result.shards);
  expect(changedReader.result.generation.generationDigest)
    .not.toBe(reader.result.generation.generationDigest);
  expect(generationCount(value.cacheRoot)).toBe(2);
});

test.serial('a different workspace snapshot identity creates a different project generation', () => {
  const value = fixture();
  const first = compileVirtualRepositorySourceProgramCompilation(value.input);
  const otherRevision = sha256('another caller provenance');
  const second = compileVirtualRepositorySourceProgramCompilation(compilationInput(
    value,
    value.files,
    otherRevision
  ));

  expect(first.typeScriptCompilation.mode).toBe('full');
  expect(second.typeScriptCompilation.mode).toBe('exact');
  expect(second.sourceRevision).toBe(first.sourceRevision);
  expect(first.projectGeneration?.generationDigest).not.toBe(second.projectGeneration?.generationDigest);
  expect(generationCount(value.cacheRoot)).toBe(2);
});

test.serial('one validated predecessor enables bounded incremental reuse and remains clean-compile equivalent', () => {
  const value = fixture();
  compileVirtualRepositorySourceProgramCompilation(value.input);
  const changedSource = 'export const value = 2;\n';
  const changedFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: changedSource, contentDigest: rawSha256(changedSource) }),
    value.files[1]!
  ]);
  const sourceRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const changedInput = compilationInput(value, changedFiles, sourceRevision);
  const changedContext = changedInput.workspaceSnapshot;
  const predecessor = createRepositoryCompilationFactStore({
    repositoryRoot: value.repositoryRoot,
    identity: Object.freeze({
      projectInputDigest: changedInput.projectInput.projectInputDigest,
      projectConfigDigest: changedInput.projectInput.projectConfigDigest,
      workspaceSnapshotIdentityDigest: changedInput.projectInput.workspaceSnapshotIdentityDigest,
      orderedSourceFactsDigest: changedInput.projectInput.orderedSourceFactsDigest,
      snapshotDigest: changedContext.snapshotDigest,
      moduleMembershipDigest: changedContext.moduleMembershipDigest,
      moduleGraphDigest: changedContext.moduleGraphDigest,
      compiler: sourceProgramTypeScriptCompilerIdentity()
    })
  }).loadPredecessor();
  expect(predecessor.status).toBe('hit');
  const cached = compileVirtualRepositorySourceProgramCompilation(changedInput);
  const clean = compileVirtualRepositorySourceProgramCompilation(compilationInput(
    value, changedFiles, sourceRevision, false
  ));

  expect(cached.typeScriptCompilation.mode).toBe('incremental');
  expect(cached.typeScriptCompilation.model).toEqual(clean.typeScriptCompilation.model);
  expect(cached.model).toEqual(clean.model);
});

test.serial('a validated predecessor accepts source membership drift and remains clean-compile equivalent', () => {
  const value = fixture();
  compileVirtualRepositorySourceProgramCompilation(value.input);
  const changedFiles = Object.freeze([value.files[0]!]);
  const sourceRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({
    repositoryPath,
    contentDigest
  })));
  const changedInput = compilationInput(value, changedFiles, sourceRevision);
  const cached = compileVirtualRepositorySourceProgramCompilation(changedInput);
  const clean = compileVirtualRepositorySourceProgramCompilation(compilationInput(
    value, changedFiles, sourceRevision, false
  ));

  expect(cached.typeScriptCompilation.mode).toBe('full');
  expect(cached.typeScriptCompilation.model.files.map(({ path: repositoryPath }) => repositoryPath))
    .not.toContain(value.files[1]!.path);
  expect(cached.typeScriptCompilation.model).toEqual(clean.typeScriptCompilation.model);
  expect(cached.model).toEqual(clean.model);
});

test.serial('an invalid predecessor hint is a disposable miss and cannot block clean compilation', () => {
  const value = fixture();
  compileVirtualRepositorySourceProgramCompilation(value.input);
  const namespace = path.dirname(generationRoot(value.cacheRoot));
  writeFileSync(path.join(namespace, 'predecessor.json'), '{}');
  const changedSource = 'export const value = 3;\n';
  const changedFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: changedSource, contentDigest: rawSha256(changedSource) }),
    value.files[1]!
  ]);
  const sourceRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const changedInput = compilationInput(value, changedFiles, sourceRevision);
  const recovered = compileVirtualRepositorySourceProgramCompilation(changedInput);
  const clean = compileVirtualRepositorySourceProgramCompilation(compilationInput(
    value, changedFiles, sourceRevision, false
  ));

  expect(recovered.typeScriptCompilation.mode).toBe('full');
  expect(recovered.model).toEqual(clean.model);
});

test.serial('a validated predecessor never narrows ambient TypeScript invalidation', () => {
  const value = fixture();
  const initialSource = 'export {};\ndeclare global { interface Window { value: 1 } }\n';
  const initialFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: initialSource, contentDigest: rawSha256(initialSource) }),
    value.files[1]!
  ]);
  const initialRevision = sha256(initialFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const initialInput = compilationInput(value, initialFiles, initialRevision);
  compileVirtualRepositorySourceProgramCompilation(initialInput);
  const changedSource = 'export {};\ndeclare global { interface Window { value: 2 } }\n';
  const changedFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: changedSource, contentDigest: rawSha256(changedSource) }),
    value.files[1]!
  ]);
  const changedRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const changedInput = compilationInput(value, changedFiles, changedRevision);
  const changed = compileVirtualRepositorySourceProgramCompilation(changedInput);
  const clean = compileVirtualRepositorySourceProgramCompilation(compilationInput(
    value, changedFiles, changedRevision, false
  ));

  expect(changed.typeScriptCompilation.mode).toBe('full');
  expect(changed.model).toEqual(clean.model);
});

test.serial('cache corruption is a disposable miss and cannot block or authorize canonical compilation', () => {
  const value = fixture();
  const cold = compileVirtualRepositorySourceProgramCompilation(value.input);
  const root = generationRoot(value.cacheRoot);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = readFileSync(manifestPath, 'utf8');
  writeFileSync(manifestPath, manifest.replace('"snapshotDigest"', '"foreign"'));

  const directStore = createRepositoryCompilationFactStore({
    repositoryRoot: value.repositoryRoot,
    identity: storeIdentity(value)
  });
  expect(() => directStore.load()).toThrow(RepositoryCompilationFactStoreError);

  const recovered = compileVirtualRepositorySourceProgramCompilation(value.input);
  expect(recovered.typeScriptCompilation.mode).toBe('full');
  expect(recovered.model).toEqual(cold.model);
});

test.serial('fact-pack grammar rejects duplicate, trailing, unknown and self-inconsistent bytes', () => {
  const value = fixture();
  const cold = compileVirtualRepositorySourceProgramCompilation(value.input);
  const shard = cold.typeScriptCompilation.state.factShards[0]!;
  const canonical = JSON.stringify(canonicalJson(shard));

  expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
    canonical.replace('{', '{"path":"foreign.ts",')
  ))).toThrow();
  expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(`${canonical}\n{}`))).toThrow();
  expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
    canonical.replace('{', '{"foreign":true,')
  ))).toThrow();
  const changed = JSON.parse(canonical) as Record<string, unknown>;
  changed.rawFileDigest = sha256('foreign');
  expect(() => parseTypeScriptSourceProgramFactShard(new TextEncoder().encode(
    JSON.stringify(canonicalJson(changed))
  ))).toThrow('digest-bound');
});

test.serial('retained generation authority rejects directory replacement and publishers converge on identical bytes', () => {
  const value = fixture();
  const cold = compileVirtualRepositorySourceProgramCompilation(value.input);
  const identity = storeIdentity(value);
  const left = createRepositoryCompilationFactStore({ repositoryRoot: value.repositoryRoot, identity });
  const right = createRepositoryCompilationFactStore({ repositoryRoot: value.repositoryRoot, identity });
  expect(left.publish(cold.typeScriptCompilation.state.factShards).status).toBe('hit');
  expect(right.publish(cold.typeScriptCompilation.state.factShards).status).toBe('hit');

  const root = generationRoot(value.cacheRoot);
  renameSync(root, `${root}-displaced`);
  mkdirSync(root);
  try {
    left.publish(cold.typeScriptCompilation.state.factShards);
    throw new Error('Expected physical replacement to block publication');
  } catch (error) {
    expect(error).toBeInstanceOf(RepositoryCompilationFactStoreError);
    expect((error as RepositoryCompilationFactStoreError).kind).toBe('physical-replacement');
  }
});
