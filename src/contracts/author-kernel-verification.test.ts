import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  AUTHOR_KERNEL_GRAMMAR_MANIFEST,
  AuthorKernelInputDeclarationError,
  authorKernelDeclaredInputPaths,
  isAuthorKernelVerificationProgram,
  isAuthorKernelVerificationRootInput
} from './author-kernel-verification.ts';
import { isSecRepositoryTestModulePath } from './repository-test-path.ts';

test('native verification roots admit canonical source inputs without derived artifacts or adjacent packages', () => {
  const roots = [
    'Cargo.toml', 'Cargo.lock', '.cargo/config', '.cargo/config.toml',
    'rust-toolchain', 'rust-toolchain.toml', 'crates/Cargo.toml',
    'crates/gift-author-kernel/Cargo.toml', 'crates/gift-author-kernel/Cargo.lock',
    'crates/gift-author-kernel/.cargo/config.toml', 'crates/gift-author-kernel/rust-toolchain.toml',
    'crates/gift-author-kernel/build.rs', 'crates/gift-author-kernel/src/nested/形成.rs',
    'crates/gift-author-kernel/tests/reader.rs', 'crates/gift-author-kernel/benches/reader.rs',
    'crates/gift-author-kernel/examples/reader.rs', 'crates/gift-author-kernel/fixtures/source.json',
    AUTHOR_KERNEL_GRAMMAR_MANIFEST, 'schema/source/binding-lock-1.schema.json',
    'tools/documentation/codec_parameters.py', 'tools/documentation/source_inventory.py',
    'examples/第一层作者/names-and-roots/local.json'
  ];
  for (const path of roots) expect(isAuthorKernelVerificationRootInput(path)).toBe(true);
  for (const path of [
    'crates/other/src/lib.rs', 'src/unrelated.rs', 'crates/gift-author-kernel/target/debug/kernel.exe',
    'crates/gift-author-kernel/target/src/generated.rs', 'crates/gift-author-kernel/src/reader.rs.bak',
    'crates/gift-author-kernel/notes.json', 'schema/unreferenced.json',
    'tools/documentation/other.py', 'examples/第一层作者/names-and-roots/nested/local.json',
    './crates/gift-author-kernel/src/lib.rs', 'crates//gift-author-kernel/src/lib.rs',
    'crates/gift-author-kernel/src/../lib.rs', '/crates/gift-author-kernel/src/lib.rs',
    'C:/crates/gift-author-kernel/src/lib.rs', 'crates\\gift-author-kernel\\src\\lib.rs',
    'crates/gift-author-kernel/src/e\u{301}.rs', 'crates/gift-author-kernel/src/\0.rs'
  ]) expect(isAuthorKernelVerificationRootInput(path)).toBe(false);
});

test('standalone native oracle programs remain outside the Bun test module inventory', () => {
  for (const path of ['crates/gift-author-kernel/tests/reader-check.ts',
    'crates/gift-author-kernel/tests/target-check.ts']) {
    expect(isAuthorKernelVerificationRootInput(path)).toBe(true);
    expect(isAuthorKernelVerificationProgram(path)).toBe(true);
    expect(isSecRepositoryTestModulePath(path)).toBe(false);
  }
  for (const path of ['crates/gift-author-kernel/tests/other.ts',
    'tests/unit/reader-check.test.ts', './crates/gift-author-kernel/tests/reader-check.ts']) {
    expect(isAuthorKernelVerificationProgram(path)).toBe(false);
  }
  expect(isSecRepositoryTestModulePath('tests/unit/reader-check.test.ts')).toBe(true);
});

test('declared native resource paths follow the actual manifest fields rather than a copied schema table', () => {
  const source = readFileSync(new URL('../../schema/author/first-layer/codec-parameters.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(source) as {
    resources: Array<{ path: string }>;
    externals: Array<{ path: string }>;
  };
  const expected = [...new Set([AUTHOR_KERNEL_GRAMMAR_MANIFEST,
    ...manifest.resources.map(({ path }) => path), ...manifest.externals.map(({ path }) => path)])].sort();
  expect(authorKernelDeclaredInputPaths(source)).toEqual(expected);
  const added = 'independent-native-inputs/new-resource.fixture';
  manifest.resources.reverse();
  manifest.externals.push({ path: added });
  manifest.resources.push({ path: added });
  expect(authorKernelDeclaredInputPaths(JSON.stringify(manifest))).toEqual([...expected, added].sort());
  expect(isAuthorKernelVerificationRootInput(added)).toBe(false);
});

test('native input declaration errors preserve ambiguity and unsafe paths as typed failures', () => {
  const valid = {
    schema: 'gift.design-codec-parameters/2', scope: 'complete-candidate-structure-only',
    resources: [{ path: 'a.json' }], externals: [], extensions: []
  };
  const validSource = JSON.stringify(valid);
  expect(authorKernelDeclaredInputPaths(validSource)).toEqual(['a.json', AUTHOR_KERNEL_GRAMMAR_MANIFEST]);
  const declaration = (path: unknown) => JSON.stringify({ ...valid, resources: [{ path }] });
  for (const source of [
    validSource.slice(0, -1),
    '{"schema":"gift.design-codec-parameters/2","schema":"gift.design-codec-parameters/2","scope":"complete-candidate-structure-only","resources":[{"path":"a.json"}],"externals":[],"extensions":[]}',
    '{"schema":"gift.design-codec-parameters/2","scope":"complete-candidate-structure-only","resources":[{"path":"a.json","path":"b.json"}],"externals":[],"extensions":[]}',
    JSON.stringify({ ...valid, schema: 'unknown' }),
    JSON.stringify({ ...valid, scope: 'unknown' }),
    JSON.stringify({ ...valid, resources: {} }),
    JSON.stringify({ ...valid, externals: null }),
    ...['', '../outside.json', './input.json', 'a/../input.json', 'a//input.json',
      '/input.json', 'C:/input.json', 'a\\input.json', 'e\u{301}.json', 'a\0.json', null, 1].map(declaration)
  ]) expect(() => authorKernelDeclaredInputPaths(source)).toThrow(AuthorKernelInputDeclarationError);
});

test('native input declarations reject a missing required manifest field independently', () => {
  const valid = { schema: 'gift.design-codec-parameters/2', scope: 'complete-candidate-structure-only',
    resources: [], externals: [], extensions: [] };
  expect(authorKernelDeclaredInputPaths(JSON.stringify(valid))).toEqual([AUTHOR_KERNEL_GRAMMAR_MANIFEST]);
  for (const field of ['schema', 'scope', 'resources', 'externals', 'extensions']) {
    const missing: Record<string, unknown> = { ...valid };
    delete missing[field];
    expect(() => authorKernelDeclaredInputPaths(JSON.stringify(missing))).toThrow(AuthorKernelInputDeclarationError);
  }
});
