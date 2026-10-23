import { expect, test } from 'bun:test';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import {
  compileTypeScriptSourceProgramModel,
  observeSourceProgramTypeScriptRename,
  observeSourceProgramTypeScriptSyntax,
  sourceProgramTypeScriptExactFactGenerationReceipt
} from './typescript.ts';

test('exact TypeScript generation receipt excludes private source scope and membership capabilities', () => {
  const source = 'export function run(): void {}\n';
  const sourcePath = 'src/example/run.ts';
  const descriptorPath = 'src/example/module.json';
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [sourcePath, descriptorPath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] })
    }]
  });
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: rawSha256(source),
    files: [{ path: sourcePath, source, contentDigest: rawSha256(source) }],
    moduleMembership: membership
  });
  const receipt = sourceProgramTypeScriptExactFactGenerationReceipt(model);
  expect(Object.keys(receipt ?? {}).sort()).toEqual([
    'apiClosureDigest',
    'observationInputDigest',
    'provenanceDigest',
    'semanticInputDigest'
  ]);
  expect(Object.values(receipt ?? {}).every((value) => typeof value === 'string')).toBe(true);
});

test('TypeScript rename observations expire with their exact compiler generation', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const source = 'export const renamableSymbol = 1;\n';
  const files = [Object.freeze({
    path: 'src/example.ts',
    source,
    contentDigest: rawSha256(source)
  })];
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });
  const position = source.indexOf('renamableSymbol');
  expect(observeSourceProgramTypeScriptRename(model, 'src/example.ts', position)).toEqual(
    expect.objectContaining({ status: 'resolved', canRename: true })
  );

  const changedSource = 'export const renamableSymbol = 2;\n';
  const changedFiles = [Object.freeze({
    path: 'src/example.ts',
    source: changedSource,
    contentDigest: rawSha256(changedSource)
  })];
  compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(changedFiles.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files: changedFiles,
    moduleMembership
  });
  expect(observeSourceProgramTypeScriptRename(model, 'src/example.ts', position)).toEqual(
    expect.objectContaining({ status: 'unresolved', reason: 'generation-stale' })
  );
  expect(observeSourceProgramTypeScriptRename(
    { ...model },
    'src/example.ts',
    position
  )).toEqual(expect.objectContaining({
    status: 'unresolved',
    reason: 'exact-generation-unavailable'
  }));
});

test('TypeScript syntax observations come only from an exact compiler generation', () => {
  const moduleMembership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const source = 'export const = ;\n';
  const files = [Object.freeze({
    path: 'tests/invalid.test.ts',
    source,
    contentDigest: rawSha256(source)
  })];
  const model = compileTypeScriptSourceProgramModel({
    sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
    files,
    moduleMembership
  });

  expect(observeSourceProgramTypeScriptSyntax(model, 'tests/invalid.test.ts')).toEqual(
    expect.objectContaining({ status: 'resolved', syntax: 'invalid' })
  );
  expect(observeSourceProgramTypeScriptSyntax({ ...model }, 'tests/invalid.test.ts')).toEqual(
    expect.objectContaining({
      status: 'unresolved',
      reason: 'exact-generation-unavailable'
    })
  );
});
