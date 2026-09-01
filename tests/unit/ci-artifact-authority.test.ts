import { expect, test } from 'bun:test';

import {
  CI_ARTIFACT_FILES,
  ciArtifactUploadName,
  emptyCiArtifactManifest
} from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { validateCiArtifactManifest } from '../../src/verification/ci-artifacts/runtime/authority.ts';

test('CI artifact authority accepts canonical derived empty manifest', () => {
  const manifest = validateCiArtifactManifest(emptyCiArtifactManifest());

  expect(manifest.summary.artifactCount).toBe(0);
  expect(manifest.summary.artifactStatus).toBe('passed');
  expect(Object.isFrozen(manifest)).toBe(true);
  expect(Object.isFrozen(manifest.summary)).toBe(true);
});

test('CI artifact authority rejects summary values that do not derive from artifact state', () => {
  const candidate = emptyCiArtifactManifest();
  candidate.summary.artifactCount = 1;

  expect(() => validateCiArtifactManifest(candidate))
    .toThrow('summary differs from canonical artifacts/missing derivation');
});

test('CI artifact authority rejects unknown fields instead of re-signing them', () => {
  const candidate = {
    ...emptyCiArtifactManifest(),
    hiddenAuthority: true
  };

  expect(() => validateCiArtifactManifest(candidate))
    .toThrow('unsupported field');
});

test('CI artifact authority rejects non-portable and normalized-on-read path spellings', () => {
  const base = emptyCiArtifactManifest();
  const candidate = {
    ...base,
    artifacts: [{
      path: CI_ARTIFACT_FILES.verificationReport.replaceAll('/', '\\'),
      kind: 'governance',
      uploadName: 'noncanonical-upload-name',
      exists: true
    }],
    summary: {
      ...base.summary,
      artifactCount: 1,
      governanceCount: 1,
      uploadGroupCount: 1
    },
    uploadGroups: [{
      kind: 'governance',
      count: 1,
      paths: ['control\\evidence\\verification-report.json']
    }]
  };

  expect(() => validateCiArtifactManifest(candidate))
    .toThrow('canonical CI artifact path');
});

test('CI artifact authority rejects workspace source paths as governed artifacts', () => {
  const base = emptyCiArtifactManifest();
  const candidate = {
    ...base,
    artifacts: [{
      path: 'package.json',
      kind: 'governance',
      uploadName: ciArtifactUploadName('package.json'),
      exists: true
    }],
    summary: {
      ...base.summary,
      artifactCount: 1,
      governanceCount: 1,
      uploadGroupCount: 1
    },
    uploadGroups: [{
      kind: 'governance',
      count: 1,
      paths: ['package.json']
    }]
  };

  expect(() => validateCiArtifactManifest(candidate))
    .toThrow('canonical CI artifact path below .sec/artifacts');
});

test('CI artifact authority rejects one path being both present and missing', () => {
  const base = emptyCiArtifactManifest();
  const path = CI_ARTIFACT_FILES.verificationReport;
  const candidate = {
    ...base,
    artifacts: [{
      path,
      kind: 'governance',
      uploadName: ciArtifactUploadName(path),
      exists: true
    }],
    uploadGroups: [{ kind: 'governance', count: 1, paths: [path] }],
    missing: [{
      path,
      reason: 'fixed-governance-missing',
      declaredBy: 'artifact-manifest'
    }],
    summary: {
      ...base.summary,
      artifactStatus: 'attention',
      artifactCount: 1,
      governanceCount: 1,
      uploadGroupCount: 1,
      missingCount: 1,
      missingReasonTypeCount: 1,
      missingReasonCounts: {
        ...base.summary.missingReasonCounts,
        'fixed-governance-missing': 1
      }
    }
  };

  expect(() => validateCiArtifactManifest(candidate))
    .toThrow('both present and missing');
});
