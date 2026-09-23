import { expect, test } from 'bun:test';

import { secRelativePath, workspaceConfigRelativePath } from "../../src/adapters/workspace-context.ts";
import { validateOverrideManifest } from '../../src/compiler/contract/override-validation.ts';
import { assertCanonicalPortableLogicalPath, isCanonicalPortableLogicalPath, isCanonicalPortableLogicalPathPrefix, portableLogicalPathCollisionKey } from '../../src/contracts/logical-path.ts';

test('portable logical paths accept canonical project-relative POSIX spellings', () => {
  expect(isCanonicalPortableLogicalPath('src/installed/entity/customer-service.ts')).toBe(true);
  expect(isCanonicalPortableLogicalPath('.cache/data.json')).toBe(true);
  expect(assertCanonicalPortableLogicalPath('tests/acceptance/customer-flow.test.ts')).toBe(
    'tests/acceptance/customer-flow.test.ts'
  );
});

test('portable logical directory prefixes preserve an explicit trailing slash', () => {
  expect(isCanonicalPortableLogicalPathPrefix('custom/')).toBe(true);
  expect(isCanonicalPortableLogicalPathPrefix('src/installed/')).toBe(true);
  expect(isCanonicalPortableLogicalPathPrefix('custom')).toBe(false);
  expect(isCanonicalPortableLogicalPathPrefix('custom//')).toBe(false);
  expect(isCanonicalPortableLogicalPathPrefix('../custom/')).toBe(false);
  expect(isCanonicalPortableLogicalPathPrefix('src\\installed\\')).toBe(false);
});

test('portable logical paths reject traversal, alternate separators and noncanonical components', () => {
  for (const candidate of [
    '../secret',
    'src/../secret',
    'src\\secret.ts',
    '/absolute/path',
    'C:/absolute/path',
    'src//double.ts',
    'src/./same.ts',
    'src/trailing./file.ts',
    'src/trailing /file.ts'
  ]) {
    expect(isCanonicalPortableLogicalPath(candidate)).toBe(false);
  }
});

test('portable logical paths reject Windows device aliases and illegal components', () => {
  for (const candidate of [
    'src/con',
    'src/CON.txt',
    'src/com1.json',
    'src/lpt9.log',
    'src/a:b.ts',
    'src/a?.ts',
    'src/a*.ts'
  ]) {
    expect(isCanonicalPortableLogicalPath(candidate)).toBe(false);
  }
});

test('portable logical path identity requires NFC rather than silently normalizing identity', () => {
  const decomposed = `source/${'e\u0301'}.ts`;
  const composed = decomposed.normalize('NFC');
  expect(decomposed).not.toBe(composed);
  expect(isCanonicalPortableLogicalPath(decomposed)).toBe(false);
  expect(isCanonicalPortableLogicalPath(composed)).toBe(true);
});

test('portable publication collision keys conservatively collapse host case aliases', () => {
  expect(portableLogicalPathCollisionKey('generated/Foo.ts')).toBe(
    portableLogicalPathCollisionKey('generated/foo.ts')
  );
  expect(portableLogicalPathCollisionKey('generated/Straße.ts')).toBe(
    portableLogicalPathCollisionKey('generated/STRASSE.ts')
  );
  expect(() => portableLogicalPathCollisionKey('generated/../escape.ts'))
    .toThrow('not one canonical portable logical path');
});

test('override ownership uses the canonical portable target identity', () => {
  expect(() => validateOverrideManifest({
    overrides: [
      {
        id: 'first',
        entry: 'patches/first.patch',
        target: 'src/Foo.ts',
        reason: 'first owner',
        source: 'manual',
        conflictsWith: []
      },
      {
        id: 'second',
        entry: 'patches/second.patch',
        target: 'src/foo.ts',
        reason: 'portable alias',
        source: 'manual',
        conflictsWith: []
      }
    ]
  })).toThrow('multiple owners');
});

test('override ownership rejects canonical workspace authority roots', () => {
  for (const target of [
    workspaceConfigRelativePath,
    `${secRelativePath}/artifacts/state/graph.lock.json`
  ]) {
    expect(() => validateOverrideManifest({
      overrides: [{
        id: 'authority-replacement',
        entry: 'patches/replacement.patch',
        target,
        reason: 'must remain owner-controlled',
        source: 'manual',
        conflictsWith: []
      }]
    })).toThrow('targets a reserved path');
  }
});
