import { afterEach, expect, test } from 'bun:test';
import ts from 'typescript';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { resolveSourceProgramCompilationOperation } from './compilation-operation.ts';
import type { SourceProgramFileInput } from './contract.ts';
import { sourceProgramFileSnapshotDigest } from './typescript-input.ts';
import {
  compileExactTypeScriptProgram,
  releaseTypeScriptWorkspace,
  type ExactTypeScriptProgram
} from './typescript-workspace.ts';

afterEach(releaseTypeScriptWorkspace);

function compile(sources: Readonly<Record<string, string>>, missing: readonly string[] = []): ExactTypeScriptProgram {
  const files: SourceProgramFileInput[] = Object.entries(sources).map(([path, source]) => ({
    path, source, contentDigest: rawSha256(source) as `sha256:${string}`
  }));
  const roots = new Map(files.filter((file) => /\.[cm]?tsx?$/u.test(file.path)).map((file) => [file.path, file]));
  const identities = new Map([...roots].map(([path, file]) => [path, {
    file,
    moduleDigest: sha256(null) as `sha256:${string}`,
    rawFileDigest: sourceProgramFileSnapshotDigest(file)
  }]));
  return compileExactTypeScriptProgram(roots, identities, resolveSourceProgramCompilationOperation(), {
    files, membershipPaths: [...Object.keys(sources), ...missing]
  });
}

function occurrence(exact: ExactTypeScriptProgram, sourcePath: string, text: string) {
  const source = exact.sourceFiles.find((file) => exact.repositoryPath(file) === sourcePath)!;
  let literal: ts.StringLiteralLike | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && node.text === text) literal = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (literal === undefined) throw new Error(`Fixture literal is absent: ${sourcePath} ${text}`);
  const retainedLiteral = literal;
  return { source, literal: retainedLiteral, observation: () => exact.moduleResolutionAt(source, retainedLiteral) };
}

function importedTarget(exact: ExactTypeScriptProgram, sourcePath: string): string {
  const source = exact.sourceFiles.find((file) => exact.repositoryPath(file) === sourcePath)!;
  const declaration = source.statements[0] as ts.ImportDeclaration;
  const bindings = declaration.importClause!.namedBindings as ts.NamedImports;
  const alias = exact.checker.getSymbolAtLocation(bindings.elements[0]!.name)!;
  return exact.repositoryPath(exact.checker.getAliasedSymbol(alias).declarations![0]!.getSourceFile());
}

test('the Program resolves relative .js imports to the compiler-selected TypeScript target', () => {
  const exact = compile({
    'package.json': '{"type":"module"}',
    'src/example/main.ts': 'import { value } from "./value.js"; export { value };',
    'src/example/value.ts': 'export const value = 1;',
    'src/example/value.js': 'export const value = 2;'
  });
  const fact = occurrence(exact, 'src/example/main.ts', './value.js').observation();
  expect(fact.status).toBe('resolved');
  expect(fact.resolvedTarget).toBe('src/example/value.ts');
  expect(fact.runtime).toEqual({ kind: 'unresolved' });
  expect(fact.lookupPaths).toContain('package.json');
  expect(fact.missingInputs).toEqual([]);
  expect(Object.isFrozen(fact)).toBe(true);
  expect(Object.isFrozen(fact.lookupPaths)).toBe(true);
  expect(importedTarget(exact, 'src/example/main.ts')).toBe('src/example/value.ts');
});

test('package imports follow captured metadata changes and preserve old Program observations', () => {
  const common = {
    'src/example/main.ts': 'void import("#entry");',
    'src/example/one.ts': 'export const value = 1;',
    'src/example/two.ts': 'export const value = 2;'
  };
  const first = compile({ ...common, 'package.json': '{"type":"module","imports":{"#entry":"./src/example/one.ts"}}' });
  const original = occurrence(first, 'src/example/main.ts', '#entry');
  expect(original.observation().resolvedTarget).toBe('src/example/one.ts');
  expect(original.observation().runtime).toEqual({ kind: 'module', target: 'src/example/one.ts' });
  const second = compile({ ...common, 'package.json': '{"type":"module","imports":{"#entry":"./src/example/two.ts"}}' });
  expect(occurrence(second, 'src/example/main.ts', '#entry').observation().resolvedTarget).toBe('src/example/two.ts');
  expect(occurrence(second, 'src/example/main.ts', '#entry').observation().runtime)
    .toEqual({ kind: 'module', target: 'src/example/two.ts' });
  expect(original.observation().resolvedTarget).toBe('src/example/one.ts');
  const deleted = compile(common);
  expect(occurrence(deleted, 'src/example/main.ts', '#entry').observation().status).toBe('unresolved');
});

test('the nearest package boundary and its absence are actual resolution inputs', () => {
  const sources = {
    'package.json': '{"type":"module","imports":{"#entry":"./src/example/one.ts"}}',
    'src/example/main.ts': 'import "#entry";',
    'src/example/one.ts': 'export {};',
    'src/example/two.ts': 'export {};'
  };
  const root = compile(sources);
  const before = occurrence(root, 'src/example/main.ts', '#entry').observation();
  expect(before.resolvedTarget).toBe('src/example/one.ts');
  expect(before.lookupPaths).toContain('src/example/package.json');
  const nested = compile({ ...sources, 'src/example/package.json': '{"type":"module","imports":{"#entry":"./two.ts"}}' });
  expect(occurrence(nested, 'src/example/main.ts', '#entry').observation().resolvedTarget).toBe('src/example/two.ts');
  const restored = compile(sources);
  expect(occurrence(restored, 'src/example/main.ts', '#entry').observation().resolvedTarget).toBe('src/example/one.ts');
});

test('host repository bytes cannot fill a sealed snapshot absence', () => {
  const exact = compile({
    'src/example/main.ts': 'import "../contracts/canonical.ts"; import "unmaterialized-package";'
  });
  const local = occurrence(exact, 'src/example/main.ts', '../contracts/canonical.ts').observation();
  expect(local.status).toBe('unresolved');
  expect(local.resolvedTarget).toBeNull();
  expect(local.lookupPaths).toContain('src/contracts/canonical.ts');
  expect(occurrence(exact, 'src/example/main.ts', 'unmaterialized-package').observation().status).toBe('external');
});

test('present unread metadata suspends resolution instead of falling through to an ancestor', () => {
  const exact = compile({
    'package.json': '{"type":"module","imports":{"#entry":"./src/example/value.ts"}}',
    'src/example/main.ts': 'import "#entry";',
    'src/example/value.ts': 'export {};'
  }, ['src/example/package.json']);
  const fact = occurrence(exact, 'src/example/main.ts', '#entry').observation();
  expect(fact.status).toBe('unresolved');
  expect(fact.resolvedTarget).toBeNull();
  expect(fact.missingInputs).toEqual(['src/example/package.json']);
  expect(fact.runtime).toEqual({ kind: 'unresolved' });
});

test('present unread target bytes remain missing inputs and become resolved in the next generation', () => {
  const main = { 'src/example/main.ts': 'import "./missing.ts";' };
  const before = compile(main, ['src/example/missing.ts']);
  const fact = occurrence(before, 'src/example/main.ts', './missing.ts').observation();
  expect(fact.status).toBe('unresolved');
  expect(fact.missingInputs).toContain('src/example/missing.ts');
  const after = compile({ ...main, 'src/example/missing.ts': 'export {};' });
  expect(occurrence(after, 'src/example/main.ts', './missing.ts').observation().resolvedTarget).toBe('src/example/missing.ts');
});

test('on-demand loader occurrences use the same retained resolver and usage mode', () => {
  const sources = {
    'package.json': '{"type":"module","imports":{"#entry":{"import":"./src/example/esm.ts","require":"./src/example/cjs.cts"}}}',
    'src/example/main.ts': 'declare const load: (s: string) => unknown; load(("#entry" as string));',
    'src/example/esm.ts': 'export {};',
    'src/example/cjs.cts': 'export {};'
  };
  const first = compile(sources);
  const original = occurrence(first, 'src/example/main.ts', '#entry');
  // Delay the read until a different generation is active.
  const second = compile({ ...sources, 'package.json': '{"type":"module","imports":{"#entry":"./src/example/esm.ts"}}' });
  expect(occurrence(second, 'src/example/main.ts', '#entry').observation().resolvedTarget).toBe('src/example/esm.ts');
  expect(original.observation().resolvedTarget).toBe('src/example/cjs.cts');
  expect(original.observation().runtime).toEqual({ kind: 'unresolved' });
  const foreign = occurrence(second, 'src/example/main.ts', '#entry');
  expect(first.moduleResolutionAt(original.source, foreign.literal).status).toBe('unresolved');
});

test('ordinary leaf edits preserve unrelated SourceFiles while metadata changes rebind actual checker targets', () => {
  const sources = {
    'package.json': '{"type":"module","imports":{"#entry":"./src/example/one.ts"}}',
    'src/example/main.ts': 'import { value } from "#entry"; export { value };',
    'src/example/one.ts': 'export const value = 1;',
    'src/example/two.ts': 'export const value = 2;',
    'src/example/idle.ts': 'export const idle = 0;'
  };
  const first = compile(sources);
  const originalIdle = first.sourceFiles.find((file) => first.repositoryPath(file) === 'src/example/idle.ts')!;
  const originalMain = first.sourceFiles.find((file) => first.repositoryPath(file) === 'src/example/main.ts')!;
  const leaf = compile({ ...sources, 'src/example/one.ts': 'export const value = 3;' });
  expect(leaf.sourceFiles.find((file) => leaf.repositoryPath(file) === 'src/example/idle.ts')).toBe(originalIdle);
  expect(leaf.sourceFiles.find((file) => leaf.repositoryPath(file) === 'src/example/main.ts')).toBe(originalMain);
  expect(importedTarget(leaf, 'src/example/main.ts')).toBe('src/example/one.ts');
  const metadata = compile({ ...sources, 'package.json': '{"type":"module","imports":{"#entry":"./src/example/two.ts"}}' });
  expect(importedTarget(metadata, 'src/example/main.ts')).toBe('src/example/two.ts');
  expect(occurrence(metadata, 'src/example/main.ts', '#entry').observation().resolvedTarget).toBe('src/example/two.ts');
  const { 'src/example/idle.ts': removed, ...remaining } = sources;
  expect(removed).toContain('idle');
  compile(remaining);
  expect(first.repositoryPath(originalIdle)).toBe('src/example/idle.ts');
  expect(first.repositoryPath(originalMain)).toBe('src/example/main.ts');
  expect(importedTarget(first, 'src/example/main.ts')).toBe('src/example/one.ts');
});

test('runtime target equality requires an explicit executable source address', () => {
  const exact = compile({
    'src/example/main.ts': 'import "./value.ts"; import "../shared.ts"; import "./other"; import "./contract.d.ts"; import "external-package";',
    'src/shared.ts': 'export {};',
    'src/example/value.ts': 'export {};',
    'src/example/other.ts': 'export {};',
    'src/example/contract.d.ts': 'export declare const value: number;'
  });
  expect(occurrence(exact, 'src/example/main.ts', './value.ts').observation().runtime)
    .toEqual({ kind: 'module', target: 'src/example/value.ts' });
  expect(occurrence(exact, 'src/example/main.ts', '../shared.ts').observation().runtime)
    .toEqual({ kind: 'module', target: 'src/shared.ts' });
  const implicit = occurrence(exact, 'src/example/main.ts', './other').observation();
  expect(implicit.resolvedTarget).toBe('src/example/other.ts');
  expect(implicit.runtime).toEqual({ kind: 'unresolved' });
  const declaration = occurrence(exact, 'src/example/main.ts', './contract.d.ts').observation();
  expect(declaration.resolvedTarget).toBe('src/example/contract.d.ts');
  expect(declaration.runtime).toEqual({ kind: 'unresolved' });
  expect(occurrence(exact, 'src/example/main.ts', 'external-package').observation().runtime).toEqual({ kind: 'external' });
});

test('conditions arrays and wildcard package mappings retain compiler facts without runtime target proof', () => {
  const variants = [
    { '#entry': { types: './src/example/type-view.ts', bun: './src/example/value.ts', default: './src/example/value.ts' } },
    { '#entry': ['./src/example/type-view.ts'] },
    { '#*': './src/example/type-view.ts' }
  ];
  for (const imports of variants) {
    const exact = compile({
      'package.json': JSON.stringify({ type: 'module', imports }),
      'src/example/main.ts': 'void import("#entry");',
      'src/example/value.ts': 'export {};',
      'src/example/type-view.ts': 'export {};'
    });
    const fact = occurrence(exact, 'src/example/main.ts', '#entry').observation();
    expect(fact.status).toBe('resolved');
    expect(fact.resolvedTarget).toBe('src/example/type-view.ts');
    expect(fact.runtime).toEqual({ kind: 'unresolved' });
    expect(fact.lookupPaths).toContain('package.json');
  }
});

test('direct package mapping must preserve the compiler target and the actual nearest manifest', () => {
  const exact = compile({
    'package.json': '{"type":"module","imports":{"#entry":"./src/example/value.ts"}}',
    'src/example/package.json': '{"type":"module","imports":{"#entry":"./other.js"}}',
    'src/example/main.ts': 'void import("#entry");',
    'src/example/value.ts': 'export {};',
    'src/example/other.ts': 'export {};',
    'src/example/other.js': 'export {};'
  });
  const fact = occurrence(exact, 'src/example/main.ts', '#entry').observation();
  expect(fact.resolvedTarget).toBe('src/example/other.ts');
  expect(fact.runtime).toEqual({ kind: 'unresolved' });
  expect(fact.lookupPaths).toContain('src/example/package.json');
  const direct = compile({
    'package.json': '{"type":"module","imports":{"#entry":"./src/example/value.ts"}}',
    'src/example/package.json': '{"type":"module","imports":{"#entry":"./other.ts"}}',
    'src/example/main.mts': 'void import("#entry");',
    'src/example/value.ts': 'export {};',
    'src/example/other.ts': 'export {};'
  });
  const directFact = occurrence(direct, 'src/example/main.mts', '#entry').observation();
  expect(directFact.runtime).toEqual({ kind: 'module', target: 'src/example/other.ts' });
});

test('noncanonical encoded and fragment-bearing package addresses cannot prove runtime equality', () => {
  for (const target of ['./src/example/./value.ts', './src/example/%76alue.ts', './src/example/value.ts#fragment']) {
    const exact = compile({
      'package.json': JSON.stringify({ type: 'module', imports: { '#entry': target } }),
      'src/example/main.ts': 'void import("#entry");',
      'src/example/value.ts': 'export {};'
    });
    expect(occurrence(exact, 'src/example/main.ts', '#entry').observation().runtime).toEqual({ kind: 'unresolved' });
  }
});

test('explicit JSON addresses and direct package JSON mappings preserve the compiler target', () => {
  const exact = compile({
    'package.json': '{"type":"module","imports":{"#values":"./src/example/values.json"}}',
    'src/example/main.ts': 'import direct from "./values.json"; import mapped from "#values"; export { direct, mapped };',
    'src/example/values.json': '{"ready":true}'
  });
  for (const specifier of ['./values.json', '#values']) {
    const fact = occurrence(exact, 'src/example/main.ts', specifier).observation();
    expect(fact.status).toBe('resolved');
    expect(fact.resolvedTarget).toBe('src/example/values.json');
    expect(fact.runtime).toEqual({ kind: 'module', target: 'src/example/values.json' });
    expect(fact.missingInputs).toEqual([]);
  }
});

test('on-demand facts invalidate when captured source availability changes within fixed membership', () => {
  const main = { 'src/example/main.ts': 'declare const load: (s: string) => unknown; load("./missing.ts");' };
  const missingPath = 'src/example/missing.ts';
  const absent = compile(main, [missingPath]);
  const before = occurrence(absent, 'src/example/main.ts', './missing.ts');
  expect(before.observation().status).toBe('unresolved');
  expect(before.observation().missingInputs).toEqual([missingPath]);

  const present = compile({ ...main, [missingPath]: 'export {};' });
  const during = occurrence(present, 'src/example/main.ts', './missing.ts');
  expect(during.observation().status).toBe('resolved');
  expect(during.observation().runtime).toEqual({ kind: 'module', target: missingPath });
  expect(during.observation().missingInputs).toEqual([]);

  const withdrawn = compile(main, [missingPath]);
  const after = occurrence(withdrawn, 'src/example/main.ts', './missing.ts');
  expect(after.observation().status).toBe('unresolved');
  expect(after.observation().runtime).toEqual({ kind: 'unresolved' });
  expect(after.observation().missingInputs).toEqual([missingPath]);
  expect(before.observation().status).toBe('unresolved');
  expect(during.observation().status).toBe('resolved');
});

test('on-demand resolved facts invalidate when source bytes are withdrawn before any missing generation', () => {
  const main = { 'src/example/main.ts': 'declare const load: (s: string) => unknown; load("./missing.ts");' };
  const missingPath = 'src/example/missing.ts';
  const present = compile({ ...main, [missingPath]: 'export {};' });
  expect(occurrence(present, 'src/example/main.ts', './missing.ts').observation().status).toBe('resolved');
  const withdrawn = compile(main, [missingPath]);
  const fact = occurrence(withdrawn, 'src/example/main.ts', './missing.ts').observation();
  expect(fact.status).toBe('unresolved');
  expect(fact.resolvedTarget).toBeNull();
  expect(fact.missingInputs).toEqual([missingPath]);
});

test('a file-loader occurrence retains its sidecar type view and distinct captured asset', () => {
  const exact = compile({
    'package.json': '{"type":"module"}',
    'src/example/main.ts': 'import worker from "./worker.mjs" with { type: "file" }; export { worker };',
    'src/example/worker.d.mts': 'declare const worker: string; export default worker;',
    'src/example/worker.mjs': 'void import(computedWorkerDependency);'
  });
  const fact = occurrence(exact, 'src/example/main.ts', './worker.mjs').observation();
  expect(fact).toMatchObject({
    status: 'resolved', resolvedTarget: 'src/example/worker.d.mts',
    runtime: { kind: 'asset', target: 'src/example/worker.mjs' }
  });
  expect(fact.lookupPaths).toContain('src/example/worker.mjs');
});

test('the same specifier has independent module and file roles at separate occurrences', () => {
  const exact = compile({
    'package.json': '{"type":"module"}',
    'src/example/main.ts': 'import normal from "./worker.mjs"; import asset from "./worker.mjs" with { type: "file" };',
    'src/example/worker.d.mts': 'declare const worker: string; export default worker;',
    'src/example/worker.mjs': 'export default 1;'
  });
  const source = exact.sourceFiles.find((file) => exact.repositoryPath(file) === 'src/example/main.ts')!;
  const imports = source.statements.filter(ts.isImportDeclaration);
  const normal = exact.moduleResolutionAt(source, imports[0]!.moduleSpecifier as ts.StringLiteral);
  const asset = exact.moduleResolutionAt(source, imports[1]!.moduleSpecifier as ts.StringLiteral);
  expect(normal.resolvedTarget).toBe('src/example/worker.d.mts');
  expect(normal.runtime).toEqual({ kind: 'unresolved' });
  expect(asset.resolvedTarget).toBe(normal.resolvedTarget);
  expect(asset.runtime).toEqual({ kind: 'asset', target: 'src/example/worker.mjs' });
});

test('file assets use direct package input addresses without signing a missing compiler view', () => {
  const exact = compile({
    'package.json': '{"type":"module","imports":{"#asset":"./src/example/data.txt"}}',
    'src/example/main.ts': 'void import("#asset", { with: { type: "file" } });',
    'src/example/data.txt': 'not a module source'
  });
  const fact = occurrence(exact, 'src/example/main.ts', '#asset').observation();
  expect(fact.status).toBe('unresolved');
  expect(fact.resolvedTarget).toBeNull();
  expect(fact.runtime).toEqual({ kind: 'asset', target: 'src/example/data.txt' });
  expect(fact.lookupPaths).toContain('src/example/data.txt');
});

test('unknown file attributes preserve compiler inputs without producing an asset relation', () => {
  const exact = compile({
    'package.json': '{"type":"module"}',
    'src/example/main.ts': 'void import("./worker.mjs", { with: { type: "file", extra: "unknown" } });',
    'src/example/worker.d.mts': 'declare const worker: string; export default worker;',
    'src/example/worker.mjs': 'export default 1;'
  });
  const fact = occurrence(exact, 'src/example/main.ts', './worker.mjs').observation();
  expect(fact.status).toBe('resolved');
  expect(fact.resolvedTarget).toBe('src/example/worker.d.mts');
  expect(fact.runtime).toEqual({ kind: 'unresolved' });
});

test('asset availability and old-generation results remain independent of captured sidecar availability', () => {
  const main = {
    'package.json': '{"type":"module"}',
    'src/example/main.ts': 'void import("./worker.mjs", { with: { type: "file" } });',
    'src/example/worker.d.mts': 'declare const worker: string; export default worker;'
  };
  const assetPath = 'src/example/worker.mjs';
  const before = compile(main, [assetPath]);
  const absent = occurrence(before, 'src/example/main.ts', './worker.mjs');
  expect(absent.observation().status).toBe('resolved');
  expect(absent.observation().runtime).toEqual({ kind: 'unresolved' });
  expect(absent.observation().missingInputs).toContain(assetPath);
  const after = compile({ ...main, [assetPath]: 'export default 1;' });
  const present = occurrence(after, 'src/example/main.ts', './worker.mjs');
  expect(present.observation().runtime).toEqual({ kind: 'asset', target: assetPath });
  const withdrawn = compile(main, [assetPath]);
  expect(occurrence(withdrawn, 'src/example/main.ts', './worker.mjs').observation().runtime).toEqual({ kind: 'unresolved' });
  expect(absent.observation().runtime).toEqual({ kind: 'unresolved' });
  expect(present.observation().runtime).toEqual({ kind: 'asset', target: assetPath });
});
