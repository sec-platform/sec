import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { canonicalJson, rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import { issueRepositoryCompilationContext } from './repository-compilation-context.ts';
import {
  createRepositoryCompilationFactStore,
  RepositoryCompilationFactStoreError,
  type RepositoryCompilationFactStoreIdentity
} from './repository-compilation-fact-store.ts';
import { compileRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { parseTypeScriptSourceProgramFactShard } from './typescript-fact-shards.ts';
import {
  sourceProgramTypeScriptCompilerIdentity,
  typeScriptSourceProgramCompilerImplementationDigest
} from './typescript.ts';

const temporaryRoots: string[] = [];
const originalCacheHome = process.env.SEC_CACHE_HOME;

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
  const compilerFixtureSource = 'export const SOURCE_PROGRAM_COMPILER_FIXTURE = true;\n';
  const files = Object.freeze([
    Object.freeze({ path: 'src/example/operation.ts', source, contentDigest: rawSha256(source) }),
    Object.freeze({ path: 'src/example/second.ts', source: secondSource, contentDigest: rawSha256(secondSource) }),
    Object.freeze({
      path: 'src/brownfield/source-program-model/typescript.ts',
      source: compilerFixtureSource,
      contentDigest: rawSha256(compilerFixtureSource)
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
    kind: 'physical-repository' as const,
    provenance: Object.freeze({
      kind: 'working-tree-observation' as const,
      identityDigest: sha256({ repositoryRoot, sourceRevision }) as `sha256:${string}`
    })
  });
  const input = Object.freeze({ subject, sourceRevision, files, moduleMembership, repositoryRoot });
  return { cacheRoot, files, input, moduleMembership, repositoryRoot };
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
  return readdirSync(path.dirname(generationRoot(cacheRoot)), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;
}

function storeIdentity(value: ReturnType<typeof fixture>): RepositoryCompilationFactStoreIdentity {
  const context = issueRepositoryCompilationContext(value.input);
  const compilerImplementationDigest = typeScriptSourceProgramCompilerImplementationDigest(value.input, context);
  if (compilerImplementationDigest === null) throw new Error('Fixture compiler implementation is unavailable');
  return Object.freeze({
    snapshotDigest: context.snapshotDigest,
    moduleMembershipDigest: context.moduleMembershipDigest,
    moduleGraphDigest: context.moduleGraphDigest,
    compilerImplementationDigest,
    compiler: sourceProgramTypeScriptCompilerIdentity()
  });
}

test.serial('one immutable generation stores TypeScript facts while current contexts rebuild semantic projections', () => {
  const value = fixture();
  const cold = compileRepositorySourceProgramCompilation(value.input);
  const warm = compileRepositorySourceProgramCompilation(value.input);
  const files = readdirSync(generationRoot(value.cacheRoot)).sort();

  expect(cold.typeScriptCompilation.mode).toBe('full');
  expect(warm.typeScriptCompilation.mode).toBe('exact');
  expect(warm.context).not.toBe(cold.context);
  expect(warm.model).toEqual(cold.model);
  expect(files).toHaveLength(2);
  expect(files).toContain('manifest.json');
  expect(files.some((file) => file.endsWith('.pack'))).toBe(true);
  expect(files.some((file) => file.endsWith('.projection'))).toBe(false);
});

test.serial('caller provenance does not create a second semantic fact generation', () => {
  const value = fixture();
  const first = compileRepositorySourceProgramCompilation(value.input);
  const otherRevision = sha256('another caller provenance');
  const second = compileRepositorySourceProgramCompilation(Object.freeze({
    ...value.input,
    sourceRevision: otherRevision,
    subject: Object.freeze({
      kind: 'physical-repository' as const,
      provenance: Object.freeze({
        kind: 'working-tree-observation' as const,
        identityDigest: sha256({ otherRevision }) as `sha256:${string}`
      })
    })
  }));

  expect(first.typeScriptCompilation.mode).toBe('full');
  expect(second.typeScriptCompilation.mode).toBe('exact');
  expect(second.sourceRevision).toBe(otherRevision);
  expect(generationCount(value.cacheRoot)).toBe(1);
});

test.serial('one validated predecessor enables bounded incremental reuse and remains clean-compile equivalent', () => {
  const value = fixture();
  compileRepositorySourceProgramCompilation(value.input);
  const changedSource = 'export const value = 2;\n';
  const changedFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: changedSource, contentDigest: rawSha256(changedSource) }),
    value.files[1]!,
    value.files[2]!
  ]);
  const sourceRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const changedInput = Object.freeze({
    ...value.input,
    files: changedFiles,
    sourceRevision,
    subject: Object.freeze({
      kind: 'physical-repository' as const,
      provenance: Object.freeze({
        kind: 'working-tree-observation' as const,
        identityDigest: sha256({ sourceRevision }) as `sha256:${string}`
      })
    })
  });
  const changedContext = issueRepositoryCompilationContext(changedInput);
  const changedCompilerImplementationDigest = typeScriptSourceProgramCompilerImplementationDigest(
    changedInput,
    changedContext
  );
  if (changedCompilerImplementationDigest === null) throw new Error('Fixture compiler implementation is unavailable');
  const predecessor = createRepositoryCompilationFactStore({
    repositoryRoot: value.repositoryRoot,
    identity: Object.freeze({
      snapshotDigest: changedContext.snapshotDigest,
      moduleMembershipDigest: changedContext.moduleMembershipDigest,
      moduleGraphDigest: changedContext.moduleGraphDigest,
      compilerImplementationDigest: changedCompilerImplementationDigest,
      compiler: sourceProgramTypeScriptCompilerIdentity()
    })
  }).loadPredecessor();
  expect(predecessor.status).toBe('hit');
  const cached = compileRepositorySourceProgramCompilation(changedInput);
  const clean = compileRepositorySourceProgramCompilation(Object.freeze({ ...changedInput, repositoryRoot: undefined }));

  expect(cached.typeScriptCompilation.mode).toBe('incremental');
  expect(cached.typeScriptCompilation.model).toEqual(clean.typeScriptCompilation.model);
  expect(cached.model).toEqual(clean.model);
});

test.serial('an invalid predecessor hint is a disposable miss and cannot block clean compilation', () => {
  const value = fixture();
  compileRepositorySourceProgramCompilation(value.input);
  const namespace = path.dirname(generationRoot(value.cacheRoot));
  writeFileSync(path.join(namespace, 'predecessor.json'), '{}');
  const changedSource = 'export const value = 3;\n';
  const changedFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: changedSource, contentDigest: rawSha256(changedSource) }),
    value.files[1]!,
    value.files[2]!
  ]);
  const sourceRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const changedInput = Object.freeze({
    ...value.input,
    files: changedFiles,
    sourceRevision,
    subject: Object.freeze({
      kind: 'physical-repository' as const,
      provenance: Object.freeze({
        kind: 'working-tree-observation' as const,
        identityDigest: sha256({ sourceRevision }) as `sha256:${string}`
      })
    })
  });
  const recovered = compileRepositorySourceProgramCompilation(changedInput);
  const clean = compileRepositorySourceProgramCompilation(Object.freeze({ ...changedInput, repositoryRoot: undefined }));

  expect(recovered.typeScriptCompilation.mode).toBe('full');
  expect(recovered.model).toEqual(clean.model);
});

test.serial('a validated predecessor never narrows ambient TypeScript invalidation', () => {
  const value = fixture();
  const initialSource = 'export {};\ndeclare global { interface Window { value: 1 } }\n';
  const initialFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: initialSource, contentDigest: rawSha256(initialSource) }),
    value.files[1]!,
    value.files[2]!
  ]);
  const initialRevision = sha256(initialFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const initialInput = Object.freeze({
    ...value.input,
    files: initialFiles,
    sourceRevision: initialRevision,
    subject: Object.freeze({
      kind: 'physical-repository' as const,
      provenance: Object.freeze({
        kind: 'working-tree-observation' as const,
        identityDigest: sha256({ initialRevision }) as `sha256:${string}`
      })
    })
  });
  compileRepositorySourceProgramCompilation(initialInput);
  const changedSource = 'export {};\ndeclare global { interface Window { value: 2 } }\n';
  const changedFiles = Object.freeze([
    Object.freeze({ path: value.files[0]!.path, source: changedSource, contentDigest: rawSha256(changedSource) }),
    value.files[1]!,
    value.files[2]!
  ]);
  const changedRevision = sha256(changedFiles.map(({ path: repositoryPath, contentDigest }) => ({ repositoryPath, contentDigest })));
  const changedInput = Object.freeze({
    ...initialInput,
    files: changedFiles,
    sourceRevision: changedRevision,
    subject: Object.freeze({
      kind: 'physical-repository' as const,
      provenance: Object.freeze({
        kind: 'working-tree-observation' as const,
        identityDigest: sha256({ changedRevision }) as `sha256:${string}`
      })
    })
  });
  const changed = compileRepositorySourceProgramCompilation(changedInput);
  const clean = compileRepositorySourceProgramCompilation(Object.freeze({ ...changedInput, repositoryRoot: undefined }));

  expect(changed.typeScriptCompilation.mode).toBe('full');
  expect(changed.model).toEqual(clean.model);
});

test.serial('cache corruption is a disposable miss and cannot block or authorize canonical compilation', () => {
  const value = fixture();
  const cold = compileRepositorySourceProgramCompilation(value.input);
  const root = generationRoot(value.cacheRoot);
  const manifestPath = path.join(root, 'manifest.json');
  const manifest = readFileSync(manifestPath, 'utf8');
  writeFileSync(manifestPath, manifest.replace('"snapshotDigest"', '"foreign"'));

  const directStore = createRepositoryCompilationFactStore({
    repositoryRoot: value.repositoryRoot,
    identity: storeIdentity(value)
  });
  expect(() => directStore.load()).toThrow(RepositoryCompilationFactStoreError);

  const recovered = compileRepositorySourceProgramCompilation(value.input);
  expect(recovered.typeScriptCompilation.mode).toBe('full');
  expect(recovered.model).toEqual(cold.model);
});

test.serial('fact-pack grammar rejects duplicate, trailing, unknown and self-inconsistent bytes', () => {
  const value = fixture();
  const cold = compileRepositorySourceProgramCompilation(value.input);
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
  const cold = compileRepositorySourceProgramCompilation(value.input);
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
