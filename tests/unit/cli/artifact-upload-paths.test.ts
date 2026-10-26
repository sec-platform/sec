import { describe, expect, test } from 'bun:test';

import { buildArtifactUploadPathContract } from '../../../src/application/artifact-upload-paths.ts';
import {
  CI_ARTIFACT_FILES,
  ciArtifactUploadName,
  emptyCiArtifactManifest
} from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../../../src/assurance/verification/ci-artifacts/contract/types.ts';
import { formatArtifactUploadPaths } from '../../../src/entry/cli/artifact-upload-paths.ts';

function fixture(): CiArtifactManifest {
  const manifest = emptyCiArtifactManifest();
  manifest.artifacts = [
    { path: CI_ARTIFACT_FILES.reviewSummary, kind: 'governance', uploadName: 'review', exists: true },
    { path: '.sec/artifacts/test-results/unit.xml', kind: 'test', uploadName: 'unit', exists: true },
    // Contract membership comes from the declared paths, not this entry's kind.
    { path: '.sec/artifacts/generated/customer-contract.json', kind: 'governance', uploadName: 'contract', exists: true },
    { path: CI_ARTIFACT_FILES.reviewSummary, kind: 'governance', uploadName: 'duplicate', exists: true }
  ];
  manifest.summary.contractPaths = ['.sec/artifacts/generated/customer-contract.json'];
  manifest.summary.artifactStatus = 'attention';
  manifest.missing = [{
    path: CI_ARTIFACT_FILES.graphLock,
    reason: 'fixed-governance-missing',
    declaredBy: 'artifact-manifest'
  }];
  manifest.summary.missingReasonCounts['fixed-governance-missing'] = 1;
  manifest.summary.missingReasonTypeCount = 1;
  return manifest;
}

describe('artifact upload paths application and presentation boundary', () => {
  test('all and filtered upload paths preserve canonical membership, grouping and diagnostics', () => {
    const source = fixture();
    const result = buildArtifactUploadPathContract(source);
    expect(result.paths).toEqual([
      CI_ARTIFACT_FILES.artifactManifest,
      CI_ARTIFACT_FILES.reviewSummary,
      '.sec/artifacts/generated/customer-contract.json',
      '.sec/artifacts/test-results/unit.xml'
    ]);
    expect(result).toMatchObject({
      formatVersion: '2', root: 'workspace', kind: 'all', artifactStatus: 'attention',
      count: 4, byKind: { governance: 3, test: 1 }, uploadGroupCount: 2,
      missingCount: 1, missingReasonTypeCount: 1
    });
    expect(result.uploadGroups).toEqual([
      { kind: 'governance', count: 3, paths: result.paths.slice(0, 3) },
      { kind: 'test', count: 1, paths: [result.paths[3]] }
    ]);
    expect(formatArtifactUploadPaths(result)).toBe(result.paths.join('\n'));

    const contract = buildArtifactUploadPathContract(source, 'contract');
    expect(contract.paths).toEqual(['.sec/artifacts/generated/customer-contract.json']);
    expect(contract.byKind).toEqual({ contract: 1 });
    expect(contract.uploadGroups).toEqual([{ kind: 'contract', count: 1, paths: contract.paths }]);
    expect(contract.missingCount).toBe(1);
    expect(contract.missing[0]?.path).toBe(CI_ARTIFACT_FILES.graphLock);
    expect(buildArtifactUploadPathContract(source, 'governance').paths).toContain(
      CI_ARTIFACT_FILES.artifactManifest
    );
    const tests = buildArtifactUploadPathContract(source, 'test');
    expect(tests.paths).toEqual(['.sec/artifacts/test-results/unit.xml']);
    expect(tests.missing[0]?.path).toBe(CI_ARTIFACT_FILES.graphLock);
    expect(tests.missingReasonCounts['fixed-governance-missing']).toBe(1);

    const empty = emptyCiArtifactManifest();
    expect(formatArtifactUploadPaths(buildArtifactUploadPathContract(empty, 'test'))).toBe('');
    expect(buildArtifactUploadPathContract(empty).paths).toEqual([CI_ARTIFACT_FILES.artifactManifest]);
  });

  test('invalid identities fail instead of being normalized into upload authority', () => {
    const source = emptyCiArtifactManifest();
    for (const invalid of [
      '../outside.json', '/tmp/private.json', '.sec/artifacts/../outside.json',
      '.sec\\artifacts\\report.json', '.sec/artifacts//report.json'
    ]) {
      source.artifacts = [{ path: invalid, kind: 'test', uploadName: ciArtifactUploadName(invalid), exists: true }];
      expect(() => buildArtifactUploadPathContract(source)).toThrow('canonical .sec/artifacts path');
    }
    source.artifacts = [];
    source.summary.contractPaths = ['../outside.json'];
    expect(() => buildArtifactUploadPathContract(source, 'test')).toThrow('canonical .sec/artifacts path');
  });
});
