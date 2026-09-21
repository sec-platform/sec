import { describe, expect, test } from 'bun:test';

import { buildArtifactUploadPathContract } from '../../src/application/artifact-upload-paths.ts';
import { formatArtifactUploadPaths } from '../../src/entry/cli/artifact-upload-paths.ts';
import {
  CI_ARTIFACT_FILES,
  ciArtifactUploadName,
  emptyCiArtifactManifest
} from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactManifest } from '../../src/assurance/verification/ci-artifacts/contract/types.ts';

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
  test('all paths include the manifest, deduplicate and group canonical identities without changing the source', () => {
    const source = fixture();
    const before = structuredClone(source);
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
    expect(source).toEqual(before);
  });

  test('contract filtering follows declared membership and relabels only the selected output', () => {
    const result = buildArtifactUploadPathContract(fixture(), 'contract');
    expect(result.paths).toEqual(['.sec/artifacts/generated/customer-contract.json']);
    expect(result.byKind).toEqual({ contract: 1 });
    expect(result.uploadGroups).toEqual([{ kind: 'contract', count: 1, paths: result.paths }]);
    expect(result.missingCount).toBe(1);
    expect(result.missing[0]?.path).toBe(CI_ARTIFACT_FILES.graphLock);
    expect(buildArtifactUploadPathContract(fixture(), 'test').paths).toEqual([
      '.sec/artifacts/test-results/unit.xml'
    ]);
    expect(buildArtifactUploadPathContract(fixture(), 'governance').paths).toContain(
      CI_ARTIFACT_FILES.artifactManifest
    );
  });

  test('empty selected paths remain empty, and missing diagnostics are detached from their input', () => {
    expect(formatArtifactUploadPaths(buildArtifactUploadPathContract(emptyCiArtifactManifest(), 'test'))).toBe('');
    expect(buildArtifactUploadPathContract(emptyCiArtifactManifest()).paths).toEqual([CI_ARTIFACT_FILES.artifactManifest]);
    const source = fixture();
    const result = buildArtifactUploadPathContract(source, 'test');
    source.missing[0]!.path = CI_ARTIFACT_FILES.runtimeReport;
    source.summary.missingReasonCounts['fixed-governance-missing'] = 9;
    expect(result.missing[0]?.path).toBe(CI_ARTIFACT_FILES.graphLock);
    expect(result.missingReasonCounts['fixed-governance-missing']).toBe(1);
  });

  test('invalid identities fail instead of being normalized into upload authority', () => {
    for (const invalid of [
      '../outside.json', '/tmp/private.json', '.sec/artifacts/../outside.json',
      '.sec\\artifacts\\report.json', '.sec/artifacts//report.json'
    ]) {
      const source = emptyCiArtifactManifest();
      source.artifacts = [{ path: invalid, kind: 'test', uploadName: ciArtifactUploadName(invalid), exists: true }];
      expect(() => buildArtifactUploadPathContract(source)).toThrow('canonical .sec/artifacts path');
      source.artifacts = [];
      source.summary.contractPaths = [invalid];
      expect(() => buildArtifactUploadPathContract(source, 'test')).toThrow('canonical .sec/artifacts path');
    }
  });
});
