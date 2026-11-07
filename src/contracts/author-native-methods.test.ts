import { expect, test } from 'bun:test';

import { AuthorKernelInputDeclarationError } from './author-kernel-verification.ts';
import {
  compileAuthorNativeMethodUnits,
  selectAuthorNativeMethods,
  type AuthorNativeMethodUnit
} from './author-native-methods.ts';
import { rawSha256 } from './canonical.ts';

const crate = 'crates/gift-author-kernel';
const manifestPath = 'schema/author/first-layer/codec-parameters.json';
const rulePath = 'src/contracts/author-native-methods.ts';
const inputRulePath = 'src/contracts/author-kernel-verification.ts';
const executionRulePath = 'src/adapters/self-hosting/development/runner/native-test-runner.ts';
const supportPath = 'src/contracts/native-rule/index.ts';
const absentPath = 'src/contracts/native-rule.ts';
const externalPath = 'independent-native-data/oracle.json';

function manifest() {
  return JSON.stringify({ schema: 'gift.design-codec-parameters/2', scope: 'complete-candidate-structure-only',
    resources: [{ path: 'independent-native-data/grammar.json' }], externals: [{ path: externalPath }], extensions: [] });
}

// Source data for the pure catalog boundary. These bytes and graph observations
// provide no installed toolchain, issued projection or execution qualification.
function fixture() {
  const sources: Record<string, string> = {
    [`${crate}/Cargo.toml`]: '[package]\nname="fixture"\nversion="0.1.0"\n',
    [`${crate}/Cargo.lock`]: 'version = 4\n',
    [`${crate}/build.rs`]: 'fn main() {}\n',
    [`${crate}/src/lib.rs`]: 'pub fn root() {}\n',
    [`${crate}/src/main.rs`]: 'fn main() {}\n',
    [`${crate}/src/model.rs`]: 'pub struct Model;\n',
    [`${crate}/src/typescript.rs`]: 'pub struct Emitter;\n',
    [`${crate}/src/binding.rs`]: 'pub struct Binding;\n',
    [`${crate}/tests/reader.rs`]: '#[test] fn reader() {}\n',
    [`${crate}/fixtures/shared-views.module.json`]: '{"fixture":"shared"}\n',
    [`${crate}/tests/reader-check.ts`]: 'export const reader = true;\n',
    [`${crate}/tests/target-check.ts`]: 'export const target = true;\n',
    [manifestPath]: manifest(),
    'schema/source/binding-lock-1.schema.json': '{"type":"object"}\n',
    'independent-native-data/grammar.json': '{"type":"boolean"}\n',
    [externalPath]: '{"value":"a"}\n',
    'tools/documentation/codec_parameters.py': 'VALUE = 1\n',
    'tools/documentation/source_inventory.py': 'VALUE = 1\n',
    '.bun-version': '1.3.14\n', 'bun.lock': '{}\n', 'bunfig.toml': '', 'package.json': '{}\n',
    'src/bootstrap/cli/cli.ts': 'export const cli = true;\n',
    'src/adapters/toolchain/runtime/package-source-launcher.ts': 'export const launcher = true;\n',
    [rulePath]: "import './native-rule'; export const catalogRule = 1;\n",
    [inputRulePath]: 'export const inputRule = 1;\n',
    [executionRulePath]: 'export const executionRule = 1;\n',
    [supportPath]: 'export const support = 1;\n'
  };
  for (const name of ['codec-cases', 'complete-base-cases', 'schema-cases',
    'developer-surface-cases', 'lexical-boundary-cases']) {
    sources[`examples/第一层作者/names-and-roots/${name}.json`] = '{}\n';
  }
  const moduleGraph: Parameters<typeof compileAuthorNativeMethodUnits>[0]['moduleGraph'] & { unresolvedFiles: string[] } = {
    references: [{ from: rulePath, resolvedTarget: supportPath, candidateTargets: [absentPath, supportPath],
      runtime: { kind: 'module', target: supportPath } }],
    unresolvedFiles: [] as string[]
  };
  return { sources, moduleGraph };
}

function compile(value: ReturnType<typeof fixture>) {
  return compileAuthorNativeMethodUnits({
    files: Object.entries(value.sources).map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) })),
    moduleGraph: value.moduleGraph
  });
}

function unit(units: readonly AuthorNativeMethodUnit[], id: string) {
  const found = units.find(candidate => candidate.id === id);
  if (found === undefined) throw new Error(`Expected method ${id}`);
  return found;
}

function selected(units: readonly AuthorNativeMethodUnit[], paths: string[], scope: 'affected' | 'risk' | 'full') {
  return selectAuthorNativeMethods(units, paths, scope).map(method => method.id);
}

function closedControl() {
  const value = fixture();
  const units = compile(value);
  expect(units.map(method => method.id)).toEqual(['cargo-tests', 'reader-check', 'target-check']);
  for (const method of units) expect(method.unresolvedInputs).toEqual([]);
  return { value, units };
}

test('an unrelated repository has no native catalog while either surviving host consumer retains deleted crate obligations', () => {
  expect(compileAuthorNativeMethodUnits({ files: [{ path: 'src/unrelated.ts', source: 'export {};',
    contentDigest: rawSha256('export {};') }], moduleGraph: { references: [], unresolvedFiles: [] } })).toEqual([]);
  const { value } = closedControl();
  for (const host of ['src/adapters/compilation/author-kernel.ts', 'src/adapters/compilation/author-analysis-transport.ts']) {
    const sources = Object.fromEntries(Object.entries(value.sources).filter(([path]) => !path.startsWith(`${crate}/`)));
    sources[host] = 'export const consumer = true;\n';
    const units = compile({ ...value, sources });
    expect(units.map(method => method.id)).toEqual(['cargo-tests', 'reader-check', 'target-check']);
    for (const method of units) {
      expect(method.inputs).toContainEqual({ path: `${crate}/Cargo.toml`, contentDigest: null });
      expect(method.unresolvedInputs).toContain(`${crate}/src/lib.rs`);
    }
    expect(unit(units, 'reader-check').unresolvedInputs).toContain(`${crate}/tests/reader-check.ts`);
    expect(unit(units, 'target-check').unresolvedInputs).toContain(`${crate}/tests/target-check.ts`);
  }
});

test('quick, risk and full selection preserve frontend and legacy target responsibilities without duplicate execution identities', () => {
  const { units } = closedControl();
  for (const path of [`${crate}/src/binding.rs`, `${crate}/Cargo.lock`, externalPath]) {
    expect(selected(units, [path, path], 'affected')).toEqual(['cargo-tests', 'reader-check']);
  }
  expect(selected(units, [`${crate}/tests/reader.rs`], 'affected')).toEqual(['cargo-tests']);
  expect(selected(units, [`${crate}/src/binding.rs`], 'risk')).toEqual([]);
  expect(selected(units, [externalPath], 'risk')).toEqual([]);
  for (const path of [`${crate}/src/typescript.rs`, `${crate}/Cargo.lock`, `${crate}/fixtures/shared-views.module.json`,
    `${crate}/tests/target-check.ts`, 'src/bootstrap/cli/cli.ts', supportPath]) {
    expect(selected(units, [path], 'risk')).toEqual(['target-check']);
  }
  expect(selected(units, [`${crate}/tests/target-check.ts`], 'affected')).toEqual([]);
  expect(selected(units, ['independent-native-data/adjacent.json'], 'affected')).toEqual([]);
  expect(selected(units, [], 'full')).toEqual(['cargo-tests', 'reader-check', 'target-check']);
});

test('source and transitive rule bytes invalidate evidence even when the target risk trigger remains narrow', () => {
  const { value, units } = closedControl();
  for (const changedPath of [`${crate}/src/binding.rs`, externalPath, rulePath, inputRulePath, executionRulePath, supportPath]) {
    const changed = fixture();
    const previous = changed.sources[changedPath]!;
    changed.sources[changedPath] = previous.replace('1', '2');
    if (changed.sources[changedPath] === previous) changed.sources[changedPath] = previous.replace('a', 'b');
    if (changed.sources[changedPath] === previous) changed.sources[changedPath] = `${previous} `;
    expect(changed.sources[changedPath]).not.toBe(previous);
    const result = compile(changed);
    for (const method of units) {
      const next = unit(result, method.id);
      expect(next.inputs).toContainEqual({ path: changedPath, contentDigest: rawSha256(changed.sources[changedPath]!) });
      expect(next.inputClosureDigest).not.toBe(method.inputClosureDigest);
    }
  }
  const reordered = compileAuthorNativeMethodUnits({
    files: Object.entries(value.sources).reverse().map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) })),
    moduleGraph: value.moduleGraph
  });
  expect(reordered.map(method => method.inputClosureDigest)).toEqual(units.map(method => method.inputClosureDigest));
});

test('known absent lookup candidates select their consumers without pretending required bytes are missing', () => {
  const { units } = closedControl();
  for (const method of units) {
    expect(method.absentLookupPaths).toContain(absentPath);
    expect(method.selectionPaths).toContain(absentPath);
    expect(method.inputs.some(input => input.path === absentPath)).toBe(false);
    expect(method.unresolvedInputs).not.toContain(absentPath);
  }
  expect(selected(units, [absentPath], 'affected')).toEqual(['cargo-tests', 'reader-check']);
  expect(selected(units, [absentPath], 'risk')).toEqual(['target-check']);
  const changed = fixture();
  changed.sources[absentPath] = 'export const newlyPresent = true;\n';
  const present = compile(changed);
  for (const method of units) {
    const next = unit(present, method.id);
    expect(next.absentLookupPaths).not.toContain(absentPath);
    expect(next.inputs).toContainEqual({ path: absentPath, contentDigest: rawSha256(changed.sources[absentPath]!) });
    expect(next.inputClosureDigest).not.toBe(method.inputClosureDigest);
  }
});

test('reachable unresolved graph and missing required bytes remain obligations while unrelated graph unknowns stay outside the closure', () => {
  closedControl();
  const unresolved = fixture();
  unresolved.moduleGraph.unresolvedFiles.push(supportPath);
  for (const method of compile(unresolved)) expect(method.unresolvedInputs).toContain(supportPath);
  const missing = fixture();
  delete missing.sources[supportPath];
  for (const method of compile(missing)) {
    expect(method.inputs).toContainEqual({ path: supportPath, contentDigest: null });
    expect(method.unresolvedInputs).toContain(supportPath);
    expect(method.absentLookupPaths).not.toContain(supportPath);
  }
  const unrelated = fixture();
  unrelated.sources['src/unrelated.ts'] = 'export {};\n';
  unrelated.moduleGraph.unresolvedFiles.push('src/unrelated.ts');
  for (const method of compile(unrelated)) expect(method.unresolvedInputs).toEqual([]);
});

test('native closures retain file bytes without evaluating them and still visit the same file through a real module edge', () => {
  const value = fixture();
  const assetGraph = {
    ...value.moduleGraph,
    references: value.moduleGraph.references.map(reference => ({ ...reference,
      runtime: { kind: 'asset' as const, target: supportPath } })),
    unresolvedFiles: [supportPath]
  };
  const assets = compile({ ...value, moduleGraph: assetGraph });
  for (const method of assets) {
    expect(method.inputs).toContainEqual({ path: supportPath, contentDigest: rawSha256(value.sources[supportPath]!) });
    expect(method.unresolvedInputs).toEqual([]);
  }
  const changed = compile({ ...value, sources: { ...value.sources, [supportPath]: 'changed asset bytes' }, moduleGraph: assetGraph });
  for (const method of assets) expect(unit(changed, method.id).inputClosureDigest).not.toBe(method.inputClosureDigest);
  const both = compile({ ...value, moduleGraph: { ...assetGraph, references: [
    ...assetGraph.references,
    { from: inputRulePath, resolvedTarget: supportPath, candidateTargets: [supportPath],
      runtime: { kind: 'module', target: supportPath } }
  ] } });
  for (const method of both) expect(method.unresolvedInputs).toEqual([supportPath]);
  const unresolved = compile({ ...value, moduleGraph: { ...value.moduleGraph, references: [
    { from: rulePath, resolvedTarget: null, candidateTargets: [], runtime: { kind: 'unresolved' } }
  ] } });
  for (const method of unresolved) expect(method.unresolvedInputs).toEqual([rulePath]);
});

test('duplicate source paths, mismatched byte digests and invalid manifest declarations fail against a valid catalog control', () => {
  const { value } = closedControl();
  const files = Object.entries(value.sources).map(([path, source]) => ({ path, source, contentDigest: rawSha256(source) }));
  expect(() => compileAuthorNativeMethodUnits({ files: [...files, { ...files[0]! }], moduleGraph: value.moduleGraph }))
    .toThrow(AuthorKernelInputDeclarationError);
  expect(() => compileAuthorNativeMethodUnits({ files: [{ ...files[0]!, contentDigest: rawSha256('wrong bytes') }, ...files.slice(1)],
    moduleGraph: value.moduleGraph })).toThrow(AuthorKernelInputDeclarationError);
  for (const source of [manifest().replace(externalPath, '../outside.json'),
    manifest().replace('"extensions":[]', '"extensions":[],"extensions":[]')]) {
    const invalid = fixture();
    invalid.sources[manifestPath] = source;
    expect(() => compile(invalid)).toThrow(AuthorKernelInputDeclarationError);
  }
});

test('selector validates every identity, owner and phase before selection and rejects exact duplicate units', () => {
  const { units } = closedControl();
  const cargo = unit(units, 'cargo-tests');
  for (const invalid of [{ ...cargo, id: 'unknown' }, { ...cargo, owner: 'foreign-owner' },
    { ...cargo, phase: 'risk' }, { ...unit(units, 'target-check'), phase: 'quick' }]) {
    for (const scope of ['affected', 'risk', 'full'] as const) {
      expect(() => selectAuthorNativeMethods([invalid as AuthorNativeMethodUnit], [], scope))
        .toThrow(AuthorKernelInputDeclarationError);
    }
  }
  expect(() => selectAuthorNativeMethods([...units, cargo], [], 'full')).toThrow(AuthorKernelInputDeclarationError);
  expect(() => selectAuthorNativeMethods([...units, { ...cargo }], [], 'affected')).toThrow(AuthorKernelInputDeclarationError);
});
