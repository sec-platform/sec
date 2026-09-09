import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  getWorkspacePaths,
  isPathInside,
  isSafeRelativePath,
  resolvePathInside,
  resolveRegistryRoot,
  resolveWorkspaceArtifactPath
} from '../../src/workspace/runtime/paths.ts';

const root = path.resolve('containment-fixture');

test('lexical containment admits dot-prefixed children without confusing them with parent segments', () => {
  for (const relative of ['..cache', '...cache', '.hidden', '..cache/child', 'nested/..cache']) {
    const target = path.join(root, relative);
    assert.equal(isPathInside(root, target), true, relative);
    assert.equal(resolvePathInside(root, relative), target, relative);
  }
});

test('lexical containment still rejects actual parent and sibling paths', () => {
  for (const target of [path.dirname(root), path.resolve(root, '..', 'outside'), `${root}-sibling`]) {
    assert.equal(isPathInside(root, target), false, target);
  }
  assert.equal(isPathInside(root, path.resolve(root, 'nested', '..', '..')), false);
});

test('safe relative input rejects traversal before native normalization', () => {
  for (const relative of ['..', '../outside', '..\\outside', 'a/../b', 'a\\..\\b', 'C:outside', '//server/share', '\0bad']) {
    assert.equal(isSafeRelativePath(relative), false, relative);
    assert.equal(resolvePathInside(root, relative), null, relative);
  }
});

test('root equality and the explicit empty-input option retain their distinct meanings', () => {
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, path.join(root, '.')), true);
  assert.equal(resolvePathInside(root, ''), null);
  assert.equal(resolvePathInside(root, '', { allowEmpty: true }), root);
  assert.equal(resolvePathInside(root, '.'), root);
});

test('artifact and registry consumers accept canonical dot-prefixed directories', () => {
  const paths = getWorkspacePaths(root);
  assert.equal(resolveWorkspaceArtifactPath(root, '.sec/artifacts/..cache/report.json'),
    path.join(paths.artifactsRoot, '..cache', 'report.json'));
  assert.equal(resolveRegistryRoot(root, 'workspace', '..registry'), path.join(root, '..registry'));
  assert.throws(() => resolveWorkspaceArtifactPath(root, '.sec/artifacts/../report.json'));
  assert.throws(() => resolveRegistryRoot(root, 'workspace', '../registry'));
});

test('native path semantics do not treat POSIX backslash characters as parent separators', () => {
  if (path.sep === '/') {
    assert.equal(isPathInside(root, path.join(root, '..\\literal')), true);
  } else {
    assert.equal(isPathInside(root, path.resolve(root, '..\\outside')), false);
  }
});
