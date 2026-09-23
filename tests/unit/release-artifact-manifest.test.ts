import { expect, test } from 'bun:test';

import { parseReleaseArtifactManifestBytes } from '../../src/adapters/release/release-artifact-manifest.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

function fixture() {
  return {
    schema: 'sec-release-artifact-manifest-v1',
    packageVersion: '0.1.0',
    sourceCommit: 'a'.repeat(40),
    sourceTree: 'b'.repeat(40),
    dependencyLockDigest: `sha256:${'c'.repeat(64)}`,
    builder: {
      schema: 'sec-release-builder-identity-v1', runtime: 'bun', version: '1.4.0',
      executableSha256: `sha256:${'d'.repeat(64)}`, platform: 'linux', architecture: 'x64'
    },
    files: [{ path: 'index.js', bytes: 0, digest: `sha256:${'e'.repeat(64)}`, executable: true }]
  };
}

function document(material: unknown): string {
  return JSON.stringify({ ...(material as Record<string, unknown>), contentDigest: sha256(material) });
}

function decode(source: string) {
  return parseReleaseArtifactManifestBytes(new TextEncoder().encode(source));
}

test('release manifest accepts the canonical record and freezes every returned owned container', () => {
  const result = decode(document(fixture()));
  expect(result.sourceCommit).toBe('a'.repeat(40));
  for (const value of [result, result.builder, result.files, result.files[0]]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
});

test('release manifest rejects repeated keys even when values and the digest would agree', () => {
  const source = document(fixture());
  for (const malformed of [
    source.replace('"schema":', '"schema":"sec-release-artifact-manifest-v1","schema":'),
    source.replace('"runtime":"bun"', '"runtime":"bun","runtime":"bun"'),
    source.replace('"bytes":0', '"bytes":0,"bytes":0'),
    source.replace('"bytes":0', '"by\\u0074es":0,"bytes":0')
  ]) expect(() => decode(malformed)).toThrow('duplicate key');
});

test('release manifest rejects extra root, builder and member fields even with recomputed digests', () => {
  const root = { ...fixture(), injected: true };
  const builder = fixture();
  Object.assign(builder.builder, { injected: true });
  const member = fixture();
  Object.assign(member.files[0]!, { injected: true });
  for (const malformed of [root, builder, member]) {
    expect(() => decode(document(malformed))).toThrow();
  }
});

test('release manifest rejects missing fields and wrong container shapes before physical comparison', () => {
  const material = fixture();
  for (const malformed of [
    { ...material, files: null }, { ...material, files: {} },
    { ...material, files: [null] }, { ...material, builder: [] },
    { ...material, builder: null }, { ...material, files: [{ path: 'index.js' }] }
  ]) expect(() => decode(document(malformed))).toThrow();
  expect(() => decode('[]')).toThrow();
  expect(() => decode(document(material).replace('"packageVersion":"0.1.0",', ''))).toThrow();
});

test('release manifest rejects unsafe bytes, non-boolean permissions and malformed hashes', () => {
  for (const override of [
    { bytes: -1 }, { bytes: 1.5 }, { bytes: Number.MAX_SAFE_INTEGER + 1 },
    { bytes: '0' }, { executable: 1 }, { digest: 'sha256:bad' }
  ]) {
    const material = fixture();
    Object.assign(material.files[0]!, override);
    expect(() => decode(document(material))).toThrow();
  }
  expect(() => decode(document(fixture()).replace('"bytes":0', '"bytes":-0'))).toThrow();
});

test('release manifest rejects traversal, aliases, self-membership and duplicate inventory paths', () => {
  for (const path of ['', '/index.js', './index.js', '../index.js', 'a/../index.js',
    'a//index.js', 'a\\index.js', 'release-artifact-manifest.json', 'bad\0path']) {
    const material = fixture();
    material.files[0]!.path = path;
    expect(() => decode(document(material))).toThrow();
  }
  const duplicate = fixture();
  duplicate.files.push({ ...duplicate.files[0]! });
  expect(() => decode(document(duplicate))).toThrow('unique paths');
});

test('release manifest retains exact Unicode paths and supports one consistent Git object format', () => {
  const material = fixture();
  material.files[0]!.path = '资源/有 空格.js';
  material.sourceCommit = 'a'.repeat(64);
  material.sourceTree = 'b'.repeat(64);
  expect(decode(document(material)).files[0]!.path).toBe('资源/有 空格.js');
  material.sourceTree = 'b'.repeat(40);
  expect(() => decode(document(material))).toThrow('identity');
});

test('release manifest rejects digest changes, invalid UTF-8, BOM and excess structural depth', () => {
  expect(() => decode(document(fixture()).replace('"bytes":0', '"bytes":1'))).toThrow('digest');
  expect(() => parseReleaseArtifactManifestBytes(new Uint8Array([0xc0, 0xaf]))).toThrow();
  expect(() => decode('\ufeff' + document(fixture()))).toThrow();
  const material = fixture();
  Object.assign(material.files[0]!, { extra: { nested: true } });
  expect(() => decode(document(material))).toThrow('depth');
});

test('release manifest preserves producer traversal order while binding that order in the digest', () => {
  const material = fixture();
  material.files = [
    { ...material.files[0]!, path: 'a/child.js' },
    { ...material.files[0]!, path: 'a.js' }
  ];
  expect(decode(document(material)).files.map((file) => file.path)).toEqual(['a/child.js', 'a.js']);
  const signed = JSON.parse(document(material));
  signed.files.reverse();
  expect(() => decode(JSON.stringify(signed))).toThrow('digest');
});
