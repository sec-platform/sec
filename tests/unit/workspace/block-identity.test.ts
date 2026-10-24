import { expect, test } from 'bun:test';

import { loadManifestById, resolveRegistrySources } from '../../../src/adapters/workspace/sources/load-manifest.ts';
import { isCanonicalRegistryVersion } from '../../../src/semantics/identity/block.ts';

test('canonical registry version is one exact lowercase SemVer path segment', () => {
  for (const value of ['0.1.0', '1.2.3', '1.2.3-rc.1', '1.2.3+build.7', '1.2.3-alpha.0+build.01']) {
    expect(isCanonicalRegistryVersion(value)).toBe(true);
  }
  for (const value of [
    '',
    '../1.0.0',
    '1.0',
    '01.0.0',
    '1.0.0/next',
    '1.0.0-RC1',
    '1.0.0-01',
    '1.0.0-alpha..1',
    '1.0.0+'
  ]) {
    expect(isCanonicalRegistryVersion(value)).toBe(false);
  }
});

test('manifest loader rejects unsafe locator bytes before registry filesystem resolution', async () => {
  expect(() => loadManifestById('..\\escape/block', { workspaceRoot: '/path/that/need/not/exist' }))
    .toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-015' }));
  expect(() => loadManifestById('ticket/basic', {
    workspaceRoot: '/path/that/need/not/exist',
    version: '../1.0.0'
  })).toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-015' }));
});

test('direct registry source callers cannot bypass Plan enum and path validation', () => {
  expect(() => resolveRegistrySources('/tmp/workspace', [{
    id: 'bad',
    kind: 'private',
    location: 'compiler',
    path: 'src/compiler/registry/private'
  }])).toThrow();

  expect(() => resolveRegistrySources('/tmp/workspace', [{
    id: 'bad',
    kind: 'private',
    location: 'workspace',
    path: '../escape'
  }])).toThrow();
});
