import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readOptionalProvenanceFile } from '../../../src/adapters/workspace/provenance-reader.ts';
import { validateProvenanceFile } from '../../../src/semantics/provenance/authority.ts';

function validArtifact(path = 'src/generated.ts') {
  return {
    path,
    originType: 'generated',
    originId: 'generator:test',
    generatedByPass: 'compose',
    verifiedBy: [],
    overrideStatus: 'none',
    hash: 'a'.repeat(64)
  };
}

test('Provenance V1 preserves validated records as an isolated immutable snapshot', () => {
  const artifact = { ...validArtifact(), verifiedBy: ['tests/unit/a.test.ts'] };
  const input = { formatVersion: '1', artifacts: [artifact] };
  const expected = {
    formatVersion: '1',
    artifacts: [{ ...validArtifact(), verifiedBy: ['tests/unit/a.test.ts'] }]
  };
  const value = validateProvenanceFile(input);
  expect(value).toEqual(expected);

  artifact.path = 'src/changed.ts';
  artifact.verifiedBy.push('tests/unit/b.test.ts');
  input.artifacts.length = 0;
  expect(value).toEqual(expected);

  Reflect.set(value, 'formatVersion', '2');
  Reflect.set(value.artifacts, 'length', 0);
  Reflect.set(value.artifacts[0]!, 'originId', 'substituted');
  Reflect.set(value.artifacts[0]!.verifiedBy, '0', 'tests/unit/substituted.test.ts');
  expect(value).toEqual(expected);
});

test('Provenance V1 rejects identity normalization, duplicate authority and unknown shape', () => {
  for (const malformed of [
    { formatVersion: '2', artifacts: [] },
    { formatVersion: '1', artifacts: [validArtifact('src\\generated.ts')] },
    { formatVersion: '1', artifacts: [validArtifact('../escape.ts')] },
    { formatVersion: '1', artifacts: [validArtifact('NUL/file.ts')] },
    { formatVersion: '1', artifacts: [validArtifact(), validArtifact()] },
    { formatVersion: '1', artifacts: [{ ...validArtifact(), hash: 'not-a-hash' }] },
    { formatVersion: '1', artifacts: [{ ...validArtifact(), surprise: true }] }
  ]) {
    expect(() => validateProvenanceFile(malformed)).toThrow();
  }
});

test('Provenance V1 rejects duplicate verification evidence identities', () => {
  expect(() => validateProvenanceFile({
    formatVersion: '1',
    artifacts: [{
      ...validArtifact(),
      verifiedBy: ['tests/unit/a.test.ts', 'tests/unit/a.test.ts']
    }]
  })).toThrow(/must not contain duplicates/);
});

test('Provenance V1 rejects noncanonical artifact and verification evidence ordering', () => {
  expect(() => validateProvenanceFile({
    formatVersion: '1',
    artifacts: [validArtifact('src/z.ts'), validArtifact('src/a.ts')]
  })).toThrow(/canonically ordered by path/);

  expect(() => validateProvenanceFile({
    formatVersion: '1',
    artifacts: [{
      ...validArtifact(),
      verifiedBy: ['tests/unit/z.test.ts', 'tests/unit/a.test.ts']
    }]
  })).toThrow(/verifiedBy must be canonically ordered/);
});

test('canonical Provenance reader returns null for physical absence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-provenance-reader-'));
  try {
    expect(readOptionalProvenanceFile(path.join(root, 'absent.json'), 'test Provenance')).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
