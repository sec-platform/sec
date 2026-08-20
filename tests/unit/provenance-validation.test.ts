import { expect, test } from 'bun:test';

import {
  readOptionalProvenanceFileV1,
  validateProvenanceFileV1
} from '../../platform/shared/provenance-authority.ts';

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

test('Provenance V1 validates canonical unique artifact records and deep-freezes output', () => {
  const value = validateProvenanceFileV1({
    formatVersion: '1',
    artifacts: [validArtifact()]
  });
  expect(value.formatVersion).toBe('1');
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(value.artifacts)).toBe(true);
  expect(Object.isFrozen(value.artifacts[0])).toBe(true);
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
    expect(() => validateProvenanceFileV1(malformed)).toThrow();
  }
});

test('Provenance V1 rejects duplicate verification evidence identities', () => {
  expect(() => validateProvenanceFileV1({
    formatVersion: '1',
    artifacts: [{
      ...validArtifact(),
      verifiedBy: ['tests/unit/a.test.ts', 'tests/unit/a.test.ts']
    }]
  })).toThrow(/must not contain duplicates/);
});

test('Provenance V1 rejects noncanonical artifact and verification evidence ordering', () => {
  expect(() => validateProvenanceFileV1({
    formatVersion: '1',
    artifacts: [validArtifact('src/z.ts'), validArtifact('src/a.ts')]
  })).toThrow(/canonically ordered by path/);

  expect(() => validateProvenanceFileV1({
    formatVersion: '1',
    artifacts: [{
      ...validArtifact(),
      verifiedBy: ['tests/unit/z.test.ts', 'tests/unit/a.test.ts']
    }]
  })).toThrow(/verifiedBy must be canonically ordered/);
});

test('canonical Provenance reader maps only physical absence to null', () => {
  expect(readOptionalProvenanceFileV1(
    '/this/path/should/not/exist/sec-provenance-authority.json',
    'test Provenance'
  )).toBeNull();
});
