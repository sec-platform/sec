import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../execution/operation/semantic.ts';
import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { openProcessResourceSession } from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  retainCommandAuxiliaryOrdinaryFiles,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../../runtime-state/physical/runtime/process.ts';
import {
  openContentAddressedWorkspaceCacheSession,
  type ContentAddressedWorkspaceCacheSession
} from '../../runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import {
  createSourceProgramCompilationOperation,
  SourceProgramCompilationInterruptedError
} from './compilation-operation.ts';
import type { SourceProgramFileInput } from './contract.ts';
import {
  createRepositoryCompilationCacheProvider,
  RepositoryCompilationCacheProviderError
} from './repository-compilation-cache-provider.ts';
import { compileRepositorySourceProgramWithCache } from './repository-compilation-cache-session.ts';
import {
  issueRepositoryCompilationGenerationReceipt,
  type RepositoryCompilationCacheHint,
  type RepositoryCompilationGenerationReceipt
} from './repository-compilation-cache.ts';
import {
  compileVirtualRepositorySourceProgramCompilation
} from './repository-compilation.ts';
import { compileVirtualTestImpactProjection } from './test-impact-projection.ts';
import {
  compileTypeScriptSourceProgramFactShard,
  parseTypeScriptSourceProgramFactShard
} from './typescript-fact-shards.ts';
import {
  currentExactReturnProvenances,
  typeScriptCompilerIdentity
} from './typescript.ts';
import {
  acquireExactGitTreeSnapshot,
  compileVirtualSnapshot,
  compileTypeScriptProjectInput
} from './workspace-source-snapshot.ts';

const temporaryRoots: string[] = [];
const cacheSessions: ContentAddressedWorkspaceCacheSession[] = [];
const originalCacheHome = process.env.SEC_CACHE_HOME;
const childMarker = 'SEC_GENERATION_RESULT=';

async function runGenerationChild(
  payloadPath: string,
  mode: 'load' | 'publish'
): Promise<Readonly<{ pid: number; result: ReturnType<RepositoryCompilationCacheHint['loadExact']> }>> {
  const executablePath = path.resolve(process.execPath);
  const workerPath = fileURLToPath(new URL('../../../../tests/fixtures/repository-compilation-cache-worker.ts', import.meta.url));
  const executable = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), 'cache worker executable parent'),
    path.basename(executablePath), undefined, 'cache worker executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'executable'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(process.cwd(), 'cache worker cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'cache worker cwd'
  );
  const [worker] = retainCommandAuxiliaryOrdinaryFiles([{
    expectedParent: inspectNoFollowDirectoryChain(path.dirname(workerPath), 'cache worker parent'),
    name: path.basename(workerPath),
    label: 'cache worker'
  }]);
  const requirementId = 'brownfield.repository-compilation-cache.test-process';
  const contractDigest = sha256({ requirementId }) as OperationDigest;
  const operation = bindSemanticOperation(compileSemanticOperationPlan({
    operation: 'brownfield.repository-compilation-cache.test-process',
    intentDigest: sha256({ payloadPath, mode, workerDigest: worker.digest().byteDigest }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + 30_000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 8 * 1024 * 1024 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: requirementId,
      contractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed']
    }]
  }), [compileCapabilityBinding({
    requirementId,
    contractDigest,
    providerIdentityDigest: sha256({ executable: executable.digest(), worker: worker.digest() }) as OperationDigest
  })]);
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: issueOperationRequirementBindingContext({
      operation,
      requirementId,
      resourceCeilings: [
        { resource: 'duration-ms', maximum: 30_000 },
        { resource: 'input-bytes', maximum: 0 },
        { resource: 'output-bytes', maximum: 8 * 1024 * 1024 },
        { resource: 'processes', maximum: 1 }
      ]
    })
  });
  try {
    const result = await session.run(issueRetainedCommandBoundary({
      executable,
      workingDirectory,
      auxiliaryInputs: [{ capability: worker, kind: 'ordinary-file' }]
    }), ['--no-env-file', worker.childPath], {
      envMode: 'replace',
      env: {
        LANG: 'C', LC_ALL: 'C', TZ: 'UTC',
        SEC_GENERATION_MODE: mode,
        SEC_GENERATION_PAYLOAD: payloadPath,
        ...(process.env.SystemRoot === undefined ? {} : { SystemRoot: process.env.SystemRoot }),
        ...(process.env.WINDIR === undefined ? {} : { WINDIR: process.env.WINDIR }),
        ...(process.env.SEC_CACHE_HOME === undefined ? {} : { SEC_CACHE_HOME: process.env.SEC_CACHE_HOME })
      },
      maxStderrBytes: 1024 * 1024,
      maxStdoutBytes: 7 * 1024 * 1024
    });
    if (result.result.code !== 0) throw new Error(`Generation child failed: ${result.result.stderr}`);
    const stdout = new TextDecoder().decode(result.result.stdout);
    const line = stdout.split(/\r?\n/u).find((value) => value.startsWith(childMarker));
    if (line === undefined) throw new Error('Generation child did not emit a result');
    return JSON.parse(line.slice(childMarker.length)) as Readonly<{
      pid: number;
      result: ReturnType<RepositoryCompilationCacheHint['loadExact']>;
    }>;
  } finally {
    session.close();
    worker.dispose();
    workingDirectory.dispose();
    executable.dispose();
  }
}

afterEach(() => {
  while (cacheSessions.length > 0) cacheSessions.pop()!.close();
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

test('production cache composition preserves an undefined compiler failure after session settlement', async () => {
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'sec-source-program-cache-composition-'));
  temporaryRoots.push(fixtureRoot);
  process.env.SEC_CACHE_HOME = path.join(fixtureRoot, 'cache');
  await withAuthorityGitReadSession({
    cwd: process.cwd(),
    budget: { deadlineMs: 120_000 }
  }, async (gitSession) => {
    const head = await gitSession.run(['rev-parse', '--verify', 'HEAD^{commit}']);
    if (head.kind !== 'completed' || head.result.code !== 0) {
      throw new Error('Cache composition fixture could not resolve HEAD');
    }
    const commitSha = new TextDecoder('utf-8', { fatal: true }).decode(head.result.stdout).trim();
    const workspaceSnapshot = await acquireExactGitTreeSnapshot({
      commitSha,
      session: gitSession
    });
    const operation = createSourceProgramCompilationOperation({
      deadlineAtUnixMs: Date.now() + 120_000
    });
    const target = {
      workspaceSnapshot,
      operation,
      repositoryRoot: process.cwd(),
      reviewedProcessDispatchers: Object.freeze([] as string[])
    };
    const input = new Proxy(target, {
      get: (selected, property, receiver) => {
        if (property === 'reviewedProcessDispatchers') throw undefined;
        return Reflect.get(selected, property, receiver);
      }
    });
    let failed = false;
    try {
      compileRepositorySourceProgramWithCache(input);
    } catch (error) {
      failed = true;
      expect(error).toBeUndefined();
    }
    expect(failed).toBe(true);
  });
});

function fixture(
  value = 1,
  additionalFiles: readonly Readonly<{ path: string; source: string; contentDigest: `sha256:${string}` }>[] = []
) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-source-program-generation-'));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  process.env.SEC_CACHE_HOME = cacheRoot;
  const descriptorPath = 'src/example/module.json';
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
    }),
    ...additionalFiles
  ]);
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
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
  const workspaceSnapshot = compileVirtualSnapshot(snapshotInput);
  const session = cacheSession(repositoryRoot);
  const cacheProvider = createRepositoryCompilationCacheProvider({ session });
  const input = Object.freeze({
    cacheProvider,
    workspaceSnapshot,
    projectInput: compileTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json'),
    repositoryRoot
  });
  return { cacheProvider, cacheRoot, files, input, moduleMembership, repositoryRoot, snapshotInput };
}

function cacheSession(repositoryRoot: string): ContentAddressedWorkspaceCacheSession {
  const requirementId = 'brownfield.repository-compilation-cache.fixture';
  const contractDigest = sha256({ requirementId }) as OperationDigest;
  const operation = bindSemanticOperation(compileSemanticOperationPlan({
    operation: 'brownfield.repository-compilation-cache.fixture',
    intentDigest: sha256({ repositoryRoot }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: Date.now() + 30_000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'input-bytes', maximum: 1024 * 1024 * 1024 },
      { resource: 'output-bytes', maximum: 1024 * 1024 * 1024 },
      { resource: 'records', maximum: 1024 }
    ],
    requirements: [{
      id: requirementId,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: ['cache.cancelled', 'cache.deadline-exhausted', 'cache.physical-replacement']
    }]
  }), [compileCapabilityBinding({
    requirementId,
    contractDigest,
    providerIdentityDigest: sha256('repository-compilation-cache-test-provider') as OperationDigest
  })]);
  const session = openContentAddressedWorkspaceCacheSession({
    operation,
    requirementId,
    repository: inspectNoFollowDirectoryChain(repositoryRoot, 'repository compilation cache fixture root').target
  });
  cacheSessions.push(session);
  return session;
}

function causalFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-source-program-causal-generation-'));
  temporaryRoots.push(root);
  const repositoryRoot = path.join(root, 'repository');
  const cacheRoot = path.join(root, 'cache');
  mkdirSync(repositoryRoot);
  process.env.SEC_CACHE_HOME = cacheRoot;
  const descriptorPath = 'src/example/module.json';
  const parserSource = [
    'export interface Value { readonly status: string; }',
    'export function parseValue(source: string): Value { return JSON.parse(source) as Value; }'
  ].join('\n');
  const readerSource = [
    "import { parseValue, type Value } from './parser.ts';",
    'export function readValue(source: string): Value { parseValue(source); return source as unknown as Value; }'
  ].join('\n');
  const projectConfigSource = '{"compilerOptions":{"strict":true}}\n';
  const files = Object.freeze([
    Object.freeze({ path: 'src/example/parser.ts', source: parserSource, contentDigest: rawSha256(parserSource) }),
    Object.freeze({ path: 'src/example/reader.ts', source: readerSource, contentDigest: rawSha256(readerSource) }),
    Object.freeze({
      path: 'tsconfig.json',
      source: projectConfigSource,
      contentDigest: rawSha256(projectConfigSource)
    })
  ]);
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map((file) => file.path), descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [],
        preDependencyBootstrap: false,
        causalRelations: [{
          subject: 'example.value',
          relation: 'declares',
          symbol: { path: 'src/example/parser.ts', name: 'Value' },
          operation: null
        }, {
          subject: 'example.value',
          relation: 'parses',
          symbol: { path: 'src/example/parser.ts', name: 'parseValue' },
          operation: null
        }, {
          subject: 'example.value',
          relation: 'reads-back',
          symbol: { path: 'src/example/reader.ts', name: 'readValue' },
          operation: null
        }]
      })
    }]
  });
  const sourceRevision = sha256(files.map(({ path: repositoryPath, contentDigest }) => ({
    repositoryPath,
    contentDigest
  })));
  const snapshotInput = Object.freeze({
    subject: Object.freeze({
      kind: 'virtual-mutation' as const,
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation' as const,
        baseSnapshotDigest: sha256({ repositoryRoot }) as `sha256:${string}`,
        mutationDigest: sourceRevision as `sha256:${string}`
      })
    }),
    sourceRevision,
    files,
    moduleMembership
  });
  const workspaceSnapshot = compileVirtualSnapshot(snapshotInput);
  const cacheProvider = createRepositoryCompilationCacheProvider({
    session: cacheSession(repositoryRoot)
  });
  const projectInput = compileTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json');
  return {
    cacheProvider,
    cacheRoot,
    files,
    input: Object.freeze({ cacheProvider, workspaceSnapshot, projectInput, repositoryRoot }),
    moduleMembership,
    repositoryRoot,
    snapshotInput
  };
}

function compilationInput(
  value: ReturnType<typeof fixture>,
  files: readonly SourceProgramFileInput[],
  sourceRevision: string,
  withCache = true
) {
  const projectConfig = value.files.find(({ path: repositoryPath }) => repositoryPath === 'tsconfig.json');
  if (projectConfig === undefined) throw new Error('Fixture project config is unavailable');
  const exactFiles = files.some(({ path: repositoryPath }) => repositoryPath === projectConfig.path)
    ? files
    : Object.freeze([...files, projectConfig]);
  const workspaceSnapshot = compileVirtualSnapshot({
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
    ...(withCache ? { cacheProvider: value.cacheProvider } : {}),
    workspaceSnapshot,
    projectInput: compileTypeScriptProjectInput(workspaceSnapshot, 'tsconfig.json'),
    repositoryRoot: value.repositoryRoot
  });
}

function generationRoot(cacheRoot: string): string {
  const roots: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name === 'manifest.json') roots.push(directory);
    }
  };
  visit(cacheRoot);
  expect(roots).toHaveLength(1);
  return roots[0]!;
}

function generationCount(cacheRoot: string): number {
  let count = 0;
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name === 'manifest.json') count += 1;
    }
  };
  visit(cacheRoot);
  return count;
}

function storeGeneration(
  value: ReturnType<typeof fixture>,
  overrides: Partial<Pick<RepositoryCompilationGenerationReceipt, 'projectConfigDigest' | 'projectInputDigest'>> = {}
): RepositoryCompilationGenerationReceipt {
  const context = value.input.workspaceSnapshot;
  const projectInput = compileTypeScriptProjectInput(context, 'tsconfig.json');
  return issueRepositoryCompilationGenerationReceipt({
    projectInputDigest: overrides.projectInputDigest ?? projectInput.projectInputDigest,
    projectConfigDigest: overrides.projectConfigDigest ?? projectInput.projectConfigDigest,
    workspaceSnapshotIdentityDigest: projectInput.workspaceSnapshotIdentityDigest,
    orderedSourceFactsDigest: projectInput.orderedSourceFactsDigest,
    snapshotDigest: context.snapshotDigest,
    moduleMembershipDigest: context.moduleMembershipDigest,
    moduleGraphDigest: context.moduleGraphDigest,
    compiler: typeScriptCompilerIdentity()
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
  expect(cold.projectGeneration.projectInputDigest).toBe(value.input.projectInput.projectInputDigest);
  expect(warm.projectGeneration).toEqual(cold.projectGeneration);
  expect(cold.cacheReceipt?.generationDigest).toBe(cold.projectGeneration.generationDigest);
  expect(warm.cacheReceipt).toEqual(cold.cacheReceipt);
  expect(files).toHaveLength(2);
  expect(files).toContain('manifest.json');
  expect(files.some((file) => file.endsWith('.pack'))).toBe(true);
  expect(files.some((file) => file.endsWith('.projection'))).toBe(false);
});

test.serial('exact cached facts rebind aliased re-exports by identifier and quoted exported-name spans', () => {
  const source = "export { value, value as renamedValue, value as 'quoted-value' } from './operation.ts';\n";
  const value = fixture(1, [Object.freeze({
    path: 'src/example/reexport.ts',
    source,
    contentDigest: rawSha256(source)
  })]);
  const cold = compileVirtualRepositorySourceProgramCompilation(value.input);
  const warm = compileVirtualRepositorySourceProgramCompilation(value.input);
  const reexportDeclarations = warm.model.declarations.filter(({ path: declarationPath }) => (
    declarationPath === 'src/example/reexport.ts'
  ));
  expect(cold.typeScriptCompilation.mode).toBe('full');
  expect(warm.typeScriptCompilation.mode).toBe('exact');
  expect(reexportDeclarations.map(({ name }) => name).sort()).toEqual(['quoted-value', 'renamedValue']);
  expect(reexportDeclarations.every(({ kind, exported }) => kind === 'ExportSpecifier' && exported)).toBe(true);
});

test.serial('a completed TypeScript generation remains reusable when a later repository projection is interrupted', () => {
  const value = fixture();
  const controller = new AbortController();
  const operation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + 30_000,
    signal: controller.signal,
    observePhase: ({ phase, state }) => {
      if (phase === 'repository-projection' && state === 'start') controller.abort();
    }
  });
  let failure: unknown;
  try {
    compileVirtualRepositorySourceProgramCompilation({ ...value.input, operation });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(SourceProgramCompilationInterruptedError);
  expect(failure).toMatchObject({
    code: 'source-program-compilation-cancelled',
    phase: 'repository-projection'
  });

  const loaded = value.cacheProvider.openContentAddressedHint(storeGeneration(value)).loadExact();
  expect(loaded.status).toBe('hit');
  const resumed = compileVirtualRepositorySourceProgramCompilation(value.input);
  expect(resumed.typeScriptCompilation.mode).toBe('exact');
});

test.serial('a forged cached return hint cannot suppress the current Program owner-bypass finding', () => {
  const value = causalFixture();
  const clean = compileVirtualRepositorySourceProgramCompilation(Object.freeze({
    workspaceSnapshot: value.input.workspaceSnapshot,
    projectInput: value.input.projectInput,
    repositoryRoot: value.repositoryRoot
  }));
  const parser = clean.typeScriptCompilation.model.declarations.find(
    ({ name }) => name === 'parseValue'
  )!;
  const reader = clean.typeScriptCompilation.model.declarations.find(
    ({ name }) => name === 'readValue'
  )!;
  const forgedShards = clean.typeScriptCompilation.state.factShards.map((shard) => {
    if (shard.path !== reader.path) return shard;
    return compileTypeScriptSourceProgramFactShard({
      compilerRevision: shard.compilerRevision,
      providerRevision: shard.providerRevision,
      rawFileDigest: shard.rawFileDigest,
      moduleDigest: shard.moduleDigest,
      semanticDependencyScope: shard.semanticDependencyScope,
      facts: Object.freeze({
        path: shard.path,
        file: shard.file,
        declarations: shard.declarations,
        references: shard.references,
        returnProvenances: Object.freeze([Object.freeze({
          path: reader.path,
          declarationObservationId: reader.observationId,
          normalReturns: Object.freeze([Object.freeze({
            kind: 'call-result' as const,
            targetObservationId: parser.observationId,
            arguments: Object.freeze([Object.freeze([
              Object.freeze({ kind: 'parameter' as const, index: 0 })
            ])])
          })])
        })]),
        literals: shard.literals,
        entrypoints: shard.entrypoints,
        capabilities: shard.capabilities,
        unknowns: shard.unknowns
      })
    });
  });
  const context = value.input.workspaceSnapshot;
  const projectInput = value.input.projectInput;
  const generation = issueRepositoryCompilationGenerationReceipt({
    projectInputDigest: projectInput.projectInputDigest,
    projectConfigDigest: projectInput.projectConfigDigest,
    workspaceSnapshotIdentityDigest: context.identityDigest,
    orderedSourceFactsDigest: projectInput.orderedSourceFactsDigest,
    snapshotDigest: context.snapshotDigest,
    moduleMembershipDigest: context.moduleMembershipDigest,
    moduleGraphDigest: context.moduleGraphDigest,
    compiler: typeScriptCompilerIdentity()
  });
  const published = value.cacheProvider.openContentAddressedHint(generation).publish(forgedShards);
  expect(published.status).toBe('hit');

  const restored = compileVirtualRepositorySourceProgramCompilation(value.input);
  const persistedHint = restored.typeScriptCompilation.model.returnProvenances.find(
    ({ declarationObservationId }) => declarationObservationId === reader.observationId
  );
  const currentExact = currentExactReturnProvenances(
    restored.typeScriptCompilation.model
  )?.find(({ declarationObservationId }) => declarationObservationId === reader.observationId);
  expect(restored.typeScriptCompilation.mode).toBe('exact');
  expect(persistedHint?.normalReturns[0]?.kind).toBe('call-result');
  expect(currentExact?.normalReturns).toEqual([Object.freeze({ kind: 'opaque' })]);
  expect(currentExact).not.toEqual(persistedHint);
  expect(restored.model.candidates).toContainEqual(expect.objectContaining({
    code: 'causal-relation-owner-bypass',
    subject: 'example.value:parser/readback'
  }));
});

test.serial('a published project generation is strictly revalidated by a fresh process', async () => {
  const value = fixture();
  const cleanInput = Object.freeze({
    workspaceSnapshot: value.input.workspaceSnapshot,
    projectInput: value.input.projectInput
  });
  const compiled = compileVirtualRepositorySourceProgramCompilation(cleanInput);
  const generation = storeGeneration(value);
  const payloadPath = path.join(path.dirname(value.repositoryRoot), 'generation-payload.json');
  const writePayload = (projectGeneration: RepositoryCompilationGenerationReceipt): void => {
    writeFileSync(payloadPath, JSON.stringify({
      repositoryRoot: value.repositoryRoot,
      generation: projectGeneration,
      shards: compiled.typeScriptCompilation.state.factShards
    }));
  };

  writePayload(generation);
  const publisher = await runGenerationChild(payloadPath, 'publish');
  const reader = await runGenerationChild(payloadPath, 'load');
  expect(publisher.pid).not.toBe(reader.pid);
  expect(publisher.result.status).toBe('hit');
  if (reader.result.status !== 'hit') throw new Error('Fresh process did not read the published generation');
  if (publisher.result.status !== 'hit') throw new Error('Fresh process did not publish the generation');
  const readerGeneration = reader.result.generation;
  expect(readerGeneration).toEqual(publisher.result.generation);
  expect(reader.result.shards).toEqual(publisher.result.shards);
  expect(readerGeneration.projectInputDigest).toBe(generation.projectInputDigest);
  expect(readerGeneration.workspaceSnapshotIdentityDigest)
    .toBe(generation.workspaceSnapshotIdentityDigest);
  const projection = compileVirtualTestImpactProjection({
    workspaceSnapshot: cleanInput.workspaceSnapshot,
    repositoryModel: compiled.model,
    typeScriptModel: compiled.typeScriptCompilation.model,
    testObservations: compiled.testObservations,
    projectGeneration: readerGeneration
  });
  expect(projection.projectGenerationDigest).toBe(readerGeneration.generationDigest);
  expect(projection.projectGenerationReceiptDigest).toBe(readerGeneration.receiptDigest);
  expect(() => compileVirtualTestImpactProjection({
    workspaceSnapshot: cleanInput.workspaceSnapshot,
    repositoryModel: compiled.model,
    typeScriptModel: compiled.typeScriptCompilation.model,
    testObservations: compiled.testObservations,
    projectGeneration: Object.freeze({
      ...readerGeneration,
      projectInputDigest: sha256('foreign-project-input') as `sha256:${string}`
    })
  })).toThrow('not digest-bound');

  const changedGeneration = storeGeneration(value, {
    projectConfigDigest: sha256('changed project config') as `sha256:${string}`,
    projectInputDigest: sha256({
      previous: generation.projectInputDigest,
      projectConfigDigest: sha256('changed project config')
    }) as `sha256:${string}`
  });
  writePayload(changedGeneration);
  expect((await runGenerationChild(payloadPath, 'load')).result.status).toBe('miss');
  const changedPublisher = await runGenerationChild(payloadPath, 'publish');
  const changedReader = await runGenerationChild(payloadPath, 'load');
  if (changedReader.result.status !== 'hit') throw new Error('Changed project generation was not published');
  if (changedPublisher.result.status !== 'hit') throw new Error('Changed project generation publication failed');
  expect(changedReader.result.generation).toEqual(changedPublisher.result.generation);
  expect(changedReader.result.shards).toEqual(changedPublisher.result.shards);
  expect(changedReader.result.generation.generationDigest)
    .not.toBe(reader.result.generation.generationDigest);
  expect(generationCount(value.cacheRoot)).toBe(2);
}, 30_000);

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
  expect(first.projectGeneration.generationDigest).not.toBe(second.projectGeneration.generationDigest);
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
  const predecessorGeneration = issueRepositoryCompilationGenerationReceipt({
      projectInputDigest: changedInput.projectInput.projectInputDigest,
      projectConfigDigest: changedInput.projectInput.projectConfigDigest,
      workspaceSnapshotIdentityDigest: changedInput.projectInput.workspaceSnapshotIdentityDigest,
      orderedSourceFactsDigest: changedInput.projectInput.orderedSourceFactsDigest,
      snapshotDigest: changedContext.snapshotDigest,
      moduleMembershipDigest: changedContext.moduleMembershipDigest,
      moduleGraphDigest: changedContext.moduleGraphDigest,
      compiler: typeScriptCompilerIdentity()
    });
  const predecessor = value.cacheProvider.openContentAddressedHint(predecessorGeneration).loadPredecessor();
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

  const directStore = value.cacheProvider.openContentAddressedHint(storeGeneration(value));
  expect(() => directStore.loadExact()).toThrow(RepositoryCompilationCacheProviderError);

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
  const generation = storeGeneration(value);
  const left = value.cacheProvider.openContentAddressedHint(generation);
  const right = value.cacheProvider.openContentAddressedHint(generation);
  expect(left.publish(cold.typeScriptCompilation.state.factShards).status).toBe('hit');
  expect(right.publish(cold.typeScriptCompilation.state.factShards).status).toBe('hit');

  const root = generationRoot(value.cacheRoot);
  renameSync(root, `${root}-displaced`);
  mkdirSync(root);
  try {
    left.publish(cold.typeScriptCompilation.state.factShards);
    throw new Error('Expected physical replacement to block publication');
  } catch (error) {
    expect(error).toBeInstanceOf(RepositoryCompilationCacheProviderError);
    expect((error as RepositoryCompilationCacheProviderError).kind).toBe('physical-replacement');
  }
});
