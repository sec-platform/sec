import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { sourceProgramSurfaceForPath } from '../../src/adapters/repository/source-program-model/contract.ts';
import { compileSourceProgramRepositoryModuleGraph } from '../../src/adapters/repository/source-program-model/source-program-module-graph.ts';
import { acquireWorkingTreeWorkspaceSourceSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../src/adapters/self-hosting/development/tooling/git/git-read.ts';
import { executeSemanticQuery, prepareSemanticQuery } from '../../src/application/semantic-query.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');

test('observed physical hash package imports belong to the declared content-hash capability owner', async () => {
  const snapshot = await withAuthorityGitReadSession({
    cwd: REPOSITORY_ROOT,
    budget: GIT_READ_OPERATION_BUDGET
  }, (session) => acquireWorkingTreeWorkspaceSourceSnapshot({ session }));
  const owners = snapshot.moduleMembership.descriptors.filter((descriptor) => (
    descriptor.capabilityProviders.some(({ capability }) => capability === 'content-hash-computation')
  ));
  assert.equal(owners.length, 1, 'content hashing requires one declared capability owner');
  const owner = owners[0]!;
  const sources = new Map(snapshot.files
    .filter(({ path: sourcePath }) => sourcePath.startsWith('src/')
      && sourceProgramSurfaceForPath(sourcePath) === 'production')
    .map(({ path: sourcePath, source }) => [sourcePath, source]));
  const graph = compileSourceProgramRepositoryModuleGraph({
    files: [...sources.keys()],
    readSource: (sourcePath) => sources.get(sourcePath) ?? null
  });
  // This assertion covers compiler-observed imports, including export/require
  // and dynamic literal loads. graph.unresolvedFiles remains unknown: computed
  // targets are not a proof of complete package reachability or runtime loading.
  const packageImports = graph.references.filter(({ specifier }) => (
    specifier === '@awasm/noble' || specifier.startsWith('@awasm/noble/')
  ));
  assert.ok(packageImports.length > 0, 'the declared physical provider must consume its hash package');
  for (const reference of packageImports) {
    assert.equal(snapshot.moduleMembership.moduleForPath(reference.from)?.moduleId, owner.moduleId,
      `${reference.from} consumes ${reference.specifier} outside the content-hash capability owner`);
    assert.equal(reference.specifier === '@awasm/noble/wasm_threads'
      || reference.specifier.startsWith('@awasm/noble/wasm_threads.')
      || reference.specifier.startsWith('@awasm/noble/wasm_threads/'), false,
    'the retained hash provider does not select the threaded package entrypoint');
  }
});

test('semantic application analysis avoids target loaders and generation requests both loaders', async () => {
  const input = {
    engineeringIRInput: {
      app: { id: 'loader-branch', name: 'loader-branch' },
      resolvedBlocks: [],
      manifests: [],
      acceptanceIds: [],
      policyDeclarations: []
    },
    generatorDeclarations: []
  };
  const calls: string[] = [];
  const unavailable = new Error('test target loader unavailable');
  const operations = {
    async loadGenerator(): Promise<never> { calls.push('generator'); throw unavailable; },
    async loadArtifactIdentity(): Promise<never> { calls.push('identity'); throw unavailable; }
  };
  const analyzed = await executeSemanticQuery(prepareSemanticQuery({ purpose: 'analyze', input }), operations);
  assert.equal(analyzed.purpose, 'analyze');
  assert.deepEqual(calls, []);

  await assert.rejects(
    executeSemanticQuery(prepareSemanticQuery({ purpose: 'generate', input }), operations),
    (error: unknown) => error === unavailable
  );
  assert.deepEqual(calls.sort(), ['generator', 'identity']);
});
