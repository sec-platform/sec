import { expect, test } from 'bun:test';

import { createReleaseSetManifest } from '../../src/adapters/release/release-set.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;

function manifest() {
  return createReleaseSetManifest({
    packageVersion: '1.2.3',
    sourceCommit: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    runtimeManifestDigest: DIGEST_A,
    runtimeFileCount: 7,
    documentationManifestDigest: DIGEST_B,
    documentationFileCount: 11
  });
}

test('release set binds runtime and documentation as one exact revision with separate licenses', () => {
  const value = manifest();
  expect(value).toMatchObject({
    schema: 'sec.release-set/1',
    packageVersion: '1.2.3',
    sourceCommit: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    members: {
      runtime: {
        path: 'runtime',
        manifestPath: 'runtime/release-artifact-manifest.json',
        manifestDigest: DIGEST_A,
        fileCount: 7,
        license: 'MPL-2.0'
      },
      documentation: {
        path: 'documentation',
        manifestPath: 'documentation/documentation-artifact-manifest.json',
        manifestDigest: DIGEST_B,
        fileCount: 11,
        license: 'CC-BY-4.0'
      }
    }
  });
  expect(value.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(createReleaseSetManifest({
    packageVersion: '1.2.3',
    sourceCommit: 'c'.repeat(40),
    sourceTree: 'd'.repeat(40),
    runtimeManifestDigest: DIGEST_A,
    runtimeFileCount: 7,
    documentationManifestDigest: DIGEST_B,
    documentationFileCount: 12
  }).contentDigest).not.toBe(value.contentDigest);
});
