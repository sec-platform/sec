import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import {
  assertIssuedTestImpactProjection,
  compileVirtualTestImpactProjection,
  encodeTestImpactProjectionReceipt,
  parseTestImpactProjectionReceipt,
  type TestImpactProjectionReceipt
} from './test-impact-projection.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

// This virtual codec fixture owns its descriptor census. An ambient filesystem
// walk would also discover auxiliary worktrees unrelated to these source bytes.
const descriptorPaths = ['src/compiler/module.json', 'src/contracts/module.json',
  'src/adapters/compilation/module.json', 'tests/module.json'];
const membership = compileRepositoryModuleMembershipSnapshot({
  repositoryFiles: descriptorPaths,
  descriptorSources: descriptorPaths.map(descriptorPath => ({ descriptorPath,
    source: JSON.stringify({ importGraph: 'runtime', externalEntrypoints: [] }) }))
});

function fixture(sources: Readonly<Record<string, string>>) {
  const sourceRevision = rawSha256(JSON.stringify(sources));
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('test-impact-projection-base'),
        mutationDigest: sourceRevision
      }
    },
    files: Object.entries(sources).map(([repositoryPath, source]) => ({
      path: repositoryPath,
      source,
      contentDigest: rawSha256(source)
    })),
    moduleMembership: membership
  });
  const repositoryCompilation = compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
  const projection = compileVirtualTestImpactProjection({
    workspaceSnapshot,
    repositoryModel: repositoryCompilation.model,
    typeScriptModel: repositoryCompilation.typeScriptCompilation.model,
    testObservations: repositoryCompilation.testObservations
  });
  return { repositoryCompilation, projection };
}

const nativeCrate = 'crates/gift-author-kernel';
const nativeManifest = 'schema/author/first-layer/codec-parameters.json';
const nativeExternal = 'independent-native-data/oracle.json';

function nativeSources(): Record<string, string> {
  return {
    [`${nativeCrate}/Cargo.toml`]: '[package]\nname="fixture"\nversion="0.1.0"\n',
    [`${nativeCrate}/src/lib.rs`]: 'pub const VALUE: u8 = 1;\n',
    [`${nativeCrate}/tests/reader-check.ts`]: 'export const reader = true;\n',
    [`${nativeCrate}/tests/target-check.ts`]: 'export const target = true;\n',
    [nativeManifest]: JSON.stringify({ schema: 'gift.design-codec-parameters/2',
      scope: 'complete-candidate-structure-only', resources: [{ path: 'independent-native-data/grammar.json' }],
      externals: [{ path: nativeExternal }], extensions: [] }),
    'independent-native-data/grammar.json': '{"type":"boolean"}\n',
    [nativeExternal]: '{"value":"a"}\n',
    'src/contracts/author-native-methods.ts': "import './optional-rule.js'; export const catalogRule = 1;\n",
    'src/contracts/author-kernel-verification.ts': 'export const inputRule = 1;\n',
    'src/adapters/self-hosting/development/runner/native-test-runner.ts': 'export const executionRule = 1;\n',
    'src/contracts/optional-rule.ts': 'export const optionalRule = 1;\n'
  };
}

type MutableProjection = { -readonly [Key in keyof TestImpactProjectionReceipt]: TestImpactProjectionReceipt[Key] };

function mutableReceipt(projection: TestImpactProjectionReceipt): MutableProjection {
  return JSON.parse(encodeTestImpactProjectionReceipt(projection)) as MutableProjection;
}

// Rehash both layers so a rejection must detect the changed contract predicate,
// rather than merely observing that a stored checksum was left stale.
function rehashedReceipt(value: MutableProjection): string {
  for (const method of value.nativeMethods) {
    const { inputClosureDigest: _previous, ...fields } = method;
    method.inputClosureDigest = sha256(fields);
  }
  const { projectionDigest: _previous, ...fields } = value;
  value.projectionDigest = sha256(fields);
  return JSON.stringify(value);
}

test('compact TestImpact projection binds the exact compilation purpose without copying full facts', () => {
  const { repositoryCompilation, projection } = fixture({
    'src/compiler/projection-fixture.ts': 'export const fixture = true;',
    'tests/unit/projection-fixture.test.ts': [
      "import { fixture } from '../../src/compiler/projection-fixture.ts';",
      'if (!fixture) throw new Error();'
    ].join('\n')
  });
  expect(() => assertIssuedTestImpactProjection(projection)).toThrow('owner-issued');
  expect(projection.purpose).toBe('test-impact-selection');
  expect(projection.subjectDigest).toBe(repositoryCompilation.subjectDigest);
  expect(projection.workspaceSnapshotIdentityDigest)
    .toBe(repositoryCompilation.workspaceSnapshotIdentityDigest);
  expect(projection.moduleGraphDigest).toBe(repositoryCompilation.moduleGraphDigest);
  expect(projection.testObservationDigest).toBe(repositoryCompilation.testObservations.observationDigest);
  expect(projection.files.every((file) => !('source' in file))).toBeTrue();
  expect(projection.moduleOwners).toContainEqual({
    moduleId: 'compiler',
    root: 'src/compiler'
  });
  expect('registrations' in projection).toBeFalse();
  const fullConsumerPayloadBytes = Buffer.byteLength(JSON.stringify({
    model: repositoryCompilation.typeScriptCompilation.model,
    testObservations: repositoryCompilation.testObservations,
    moduleGraph: repositoryCompilation.workspaceSnapshot.moduleGraph,
    moduleMembership: repositoryCompilation.workspaceSnapshot.moduleMembership.descriptors
  }));
  expect(Buffer.byteLength(encodeTestImpactProjectionReceipt(projection), 'utf8'))
    .toBeLessThan(fullConsumerPayloadBytes);
});

test('compact projection retains compiler-observed test consumers as canonical observation edges', () => {
  const { projection } = fixture({
    'src/compiler/observed-fixture.ts': 'export const observed = true;',
    'tests/unit/observed-fixture.test.ts': [
      "import { readFileSync } from 'node:fs';",
      "readFileSync('src/compiler/observed-fixture.ts', 'utf8');"
    ].join('\n'),
    'tests/unit/program-fixture.test.ts': [
      "import { spawnSync } from 'node:child_process';",
      "import { test } from 'bun:test';",
      "import path from 'node:path';",
      "test.skipIf(process.platform !== 'win32')('program', () => {",
      "  const program = path.resolve(import.meta.dir, '../../src/compiler/observed-fixture.ts');",
      "  spawnSync(process.execPath, [program]);",
      "});"
    ].join('\n')
  });
  expect(projection.observedTestConsumers).toEqual([{
    targetPath: 'src/compiler/observed-fixture.ts',
    testPath: 'tests/unit/observed-fixture.test.ts'
  }, {
    targetPath: 'src/compiler/observed-fixture.ts',
    testPath: 'tests/unit/program-fixture.test.ts'
  }]);

  const encoded = encodeTestImpactProjectionReceipt(projection);
  const outsideSnapshot = JSON.parse(encoded) as Record<string, unknown>;
  outsideSnapshot.observedTestConsumers = [{
    targetPath: 'src/compiler/absent.ts',
    testPath: 'tests/unit/observed-fixture.test.ts'
  }];
  const { projectionDigest: _discarded, ...unsigned } = outsideSnapshot;
  outsideSnapshot.projectionDigest = sha256(unsigned);
  expect(() => parseTestImpactProjectionReceipt(JSON.stringify(outsideSnapshot)))
    .toThrow('within its snapshot');
});

test('strict projection codec rejects ambiguity and parsed data cannot acquire process authority', () => {
  const { projection } = fixture({
    'src/compiler/codec-fixture.ts': 'export const codec = true;',
    'tests/unit/codec-fixture.test.ts': "import '../../src/compiler/codec-fixture.ts';"
  });
  const encoded = encodeTestImpactProjectionReceipt(projection);
  const parsed = parseTestImpactProjectionReceipt(encoded);
  expect(parsed).toEqual(projection);
  expect(() => assertIssuedTestImpactProjection(parsed)).toThrow('owner-issued');
  expect(() => parseTestImpactProjectionReceipt(
    encoded.replace('"schema":', '"schema":"duplicate","schema":')
  )).toThrow('duplicate key');

  const forged = JSON.parse(encoded) as Record<string, unknown>;
  forged.testObservationDigest = rawSha256('foreign-observation');
  const { projectionDigest: _discarded, ...unsigned } = forged;
  forged.projectionDigest = sha256(unsigned);
  const selfConsistentBytes = JSON.stringify(forged);
  const decodedForgery = parseTestImpactProjectionReceipt(selfConsistentBytes);
  expect(() => assertIssuedTestImpactProjection(decodedForgery)).toThrow('owner-issued');

  const unknown = JSON.parse(encoded) as Record<string, unknown>;
  unknown.unexpected = true;
  expect(() => parseTestImpactProjectionReceipt(JSON.stringify(unknown))).toThrow();
});

test('changed exact source bytes produce a different TestImpact projection identity', () => {
  const first = fixture({
    'src/compiler/change-fixture.ts': 'export const changed = 1;',
    'tests/unit/change-fixture.test.ts': "import '../../src/compiler/change-fixture.ts';"
  }).projection;
  const second = fixture({
    'src/compiler/change-fixture.ts': 'export const changed = 2;',
    'tests/unit/change-fixture.test.ts': "import '../../src/compiler/change-fixture.ts';"
  }).projection;
  expect(second.sourceRevision).not.toBe(first.sourceRevision);
  expect(second.snapshotDigest).not.toBe(first.snapshotDigest);
  expect(second.projectionDigest).not.toBe(first.projectionDigest);
});

test('v6 native projection retains source digests and declared resource paths without claiming an issued capability', () => {
  const sources = nativeSources();
  const { projection } = fixture(sources);
  expect(projection.schema).toBe('sec-source-program-test-impact-projection-v6');
  expect(projection.nativeMethods.map(method => method.id)).toEqual(['cargo-tests', 'reader-check', 'target-check']);
  expect(projection.nativeDeclarationPaths).toEqual([
    'independent-native-data/grammar.json', nativeExternal, nativeManifest
  ].sort());
  for (const [path, source] of Object.entries(sources)) {
    expect(projection.files.find(file => file.path === path)?.contentDigest).toBe(rawSha256(source));
  }
  for (const script of [`${nativeCrate}/tests/reader-check.ts`, `${nativeCrate}/tests/target-check.ts`]) {
    expect(projection.testFiles).not.toContain(script);
  }
  // A minimal source snapshot may describe incomplete native methods. Their
  // required absent bytes remain visible instead of becoming execution proof.
  for (const method of projection.nativeMethods) {
    expect(method.inputs).toContainEqual({ path: `${nativeCrate}/Cargo.lock`, contentDigest: null });
    expect(method.unresolvedInputs).toContain(`${nativeCrate}/Cargo.lock`);
    // The compiler probes nearest package boundaries. It selects the .ts view
    // without probing the requested .js; that runtime address stays unproved.
    expect(method.absentLookupPaths).toContain('src/contracts/package.json');
    expect(method.unresolvedInputs).not.toContain('src/contracts/package.json');
    expect(method.unresolvedInputs).toContain('src/contracts/author-native-methods.ts');
  }
  const parsed = parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(projection));
  expect(parsed).toEqual(projection);
  expect(() => assertIssuedTestImpactProjection(parsed)).toThrow('owner-issued');
  const selfConsistent = mutableReceipt(projection);
  selfConsistent.testObservationDigest = rawSha256('foreign native observation');
  expect(() => assertIssuedTestImpactProjection(parseTestImpactProjectionReceipt(rehashedReceipt(selfConsistent))))
    .toThrow('owner-issued');
});

test('native source and external resource byte changes propagate into method and projection identities', () => {
  const sources = nativeSources();
  const first = fixture(sources).projection;
  expect(parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(first))).toEqual(first);
  for (const [path, replacement] of [[`${nativeCrate}/src/lib.rs`, 'pub const VALUE: u8 = 2;\n'],
    [nativeExternal, '{"value":"b"}\n']] as const) {
    expect(Buffer.byteLength(replacement)).toBe(Buffer.byteLength(sources[path]!));
    const changed = fixture({ ...sources, [path]: replacement }).projection;
    expect(changed.sourceRevision).not.toBe(first.sourceRevision);
    expect(changed.snapshotDigest).not.toBe(first.snapshotDigest);
    expect(changed.projectionDigest).not.toBe(first.projectionDigest);
    for (const method of first.nativeMethods) {
      const next = changed.nativeMethods.find(candidate => candidate.id === method.id)!;
      expect(next.inputs).toContainEqual({ path, contentDigest: rawSha256(replacement) });
      expect(next.inputClosureDigest).not.toBe(method.inputClosureDigest);
    }
  }
});

test('v6 codec rejects a dropped catalog for either crate or surviving host evidence', () => {
  for (const sources of [nativeSources(), { 'src/adapters/compilation/author-analysis-transport.ts': 'export const host = true;\n' }]) {
    const { projection } = fixture(sources);
    expect(parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(projection))).toEqual(projection);
    expect(projection.nativeMethods).toHaveLength(3);
    const dropped = mutableReceipt(projection);
    dropped.nativeMethods = [];
    expect(() => parseTestImpactProjectionReceipt(rehashedReceipt(dropped))).toThrow();
  }
});

test('v6 codec rejects duplicate identities, foreign method contracts and a prior projection schema after rehashing', () => {
  const { projection } = fixture(nativeSources());
  expect(parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(projection))).toEqual(projection);
  const mutations: Array<(value: MutableProjection) => void> = [
    value => { value.nativeMethods.push({ ...value.nativeMethods[0]! }); },
    value => { Object.assign(value.nativeMethods[0]!, { id: 'unknown-method' }); },
    value => { value.nativeMethods[0]!.id = 'reader-check'; },
    value => { value.nativeMethods[0]!.phase = 'risk'; },
    value => { Object.assign(value.nativeMethods[0]!, { owner: 'foreign-owner' }); },
    value => { Object.assign(value, { schema: 'sec-source-program-test-impact-projection-v5' }); }
  ];
  for (const mutate of mutations) {
    const value = mutableReceipt(projection);
    mutate(value);
    expect(() => parseTestImpactProjectionReceipt(rehashedReceipt(value))).toThrow();
  }
});

test('v6 codec cross-checks native byte digests, required absence and observed negative lookups after both hashes are recomputed', () => {
  const { projection } = fixture(nativeSources());
  expect(parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(projection))).toEqual(projection);
  const mutations: Array<(value: MutableProjection) => void> = [
    value => {
      const input = value.nativeMethods[0]!.inputs.find(input => input.path === `${nativeCrate}/src/lib.rs`)!;
      input.contentDigest = rawSha256('different source bytes');
    },
    value => {
      const method = value.nativeMethods[0]!;
      method.inputs.find(input => input.path === `${nativeCrate}/src/lib.rs`)!.contentDigest = null;
      method.unresolvedInputs = [...method.unresolvedInputs, `${nativeCrate}/src/lib.rs`].sort();
    },
    value => {
      value.nativeMethods[0]!.inputs.find(input => input.path === `${nativeCrate}/Cargo.lock`)!.contentDigest = rawSha256('imagined lock bytes');
    },
    value => {
      const method = value.nativeMethods[0]!;
      const forged = 'src/contracts/unobserved-lookup.ts';
      method.absentLookupPaths = [...method.absentLookupPaths, forged].sort();
      method.selectionPaths = [...new Set([...method.selectionPaths, forged])].sort();
    }
  ];
  for (const mutate of mutations) {
    const value = mutableReceipt(projection);
    mutate(value);
    expect(() => parseTestImpactProjectionReceipt(rehashedReceipt(value))).toThrow();
  }
});

test('native codec retains asset bytes while checking only the actual module frontier for unresolved code', () => {
  const rule = 'src/contracts/author-native-methods.ts';
  const asset = 'src/contracts/asset.ts';
  const sources = { ...nativeSources(),
    [rule]: 'import asset from "./asset.ts" with { type: "file" }; export const path = asset;',
    [asset]: 'const target = "./not-fixed.ts"; void import(target); export default "bytes";'
  };
  const { projection } = fixture(sources);
  expect(projection.moduleGraph.unresolvedFiles).toContain(asset);
  for (const method of projection.nativeMethods) {
    expect(method.inputs).toContainEqual({ path: asset, contentDigest: rawSha256(sources[asset]) });
    expect(method.unresolvedInputs).not.toContain(asset);
  }
  expect(parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(projection))).toEqual(projection);
  const mutations: Array<(value: MutableProjection) => void> = [
    value => { value.nativeMethods[0]!.inputs = value.nativeMethods[0]!.inputs.filter(input => input.path !== asset); },
    value => { value.nativeMethods[0]!.unresolvedInputs = [...value.nativeMethods[0]!.unresolvedInputs, asset].sort(); },
    value => { value.nativeMethods[0]!.absentLookupPaths = []; }
  ];
  expect(projection.nativeMethods[0]!.absentLookupPaths.length).toBeGreaterThan(0);
  for (const mutate of mutations) {
    const changed = mutableReceipt(projection);
    mutate(changed);
    expect(() => parseTestImpactProjectionReceipt(rehashedReceipt(changed))).toThrow();
  }
  const ordinary = fixture({ ...sources, [rule]: `${sources[rule]} import "./asset.ts";` }).projection;
  for (const method of ordinary.nativeMethods) expect(method.unresolvedInputs).toContain(asset);
  expect(parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(ordinary))).toEqual(ordinary);
  const suppressed = mutableReceipt(ordinary);
  suppressed.nativeMethods[0]!.unresolvedInputs = suppressed.nativeMethods[0]!.unresolvedInputs.filter(path => path !== asset);
  expect(() => parseTestImpactProjectionReceipt(rehashedReceipt(suppressed))).toThrow();
});
