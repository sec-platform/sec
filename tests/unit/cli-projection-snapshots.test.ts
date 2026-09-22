import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { projectCiArtifactManifest } from '../../src/application/ci-artifact-manifest-inspect.ts';
import { formatCiArtifactManifest } from '../../src/entry/cli/ci-artifact-manifest-inspect.ts';
import { projectReviewDiagnostics } from '../../src/application/review-diagnostics-inspect.ts';
import { projectPolicySources } from '../../src/application/policy-source-inspection.ts';
import { projectAcceptanceTargets } from '../../src/application/acceptance-inspection.ts';
import { projectProvenanceRegistryInspect } from '../../src/application/provenance-registry-inspect.ts';
import { projectRuntimeInspection } from '../../src/application/runtime-inspection.ts';
import { formatProvenanceRegistry } from '../../src/entry/cli/provenance-registry-inspect.ts';

type PolicyInput = Parameters<typeof projectPolicySources>[0];
type CoverageInput = {
  formatVersion: string;
  status: string;
  acceptancePassed: string[];
  blocks: Array<{
    id: string;
    declaredAcceptance: string[];
    coveredBy: string[];
    uncovered: boolean;
  }>;
  uncoveredBlocks: string[];
};
type RuntimeInput = Parameters<typeof projectRuntimeInspection>[0];
type ReviewInput = Parameters<typeof projectReviewDiagnostics>[0];
type ProvenanceInput = Parameters<typeof projectProvenanceRegistryInspect>[0];
type ManifestInput = Parameters<typeof projectCiArtifactManifest>[0];
// Focused domain fixtures: these tests exercise projections, not domain parsers.
function policy() {
  return { status: 'passed', official: { sources: [{ path: 'z', policyIds: ['one'] }] },
    project: { sources: [{ path: 'a', policyIds: ['two', 'three'] }] } };
}
function coverage() {
  const value: CoverageInput = { formatVersion: '1', status: 'passed', acceptancePassed: [],
    blocks: [{ id: 'block', uncovered: true, declaredAcceptance: ['declared'], coveredBy: [] }],
    uncoveredBlocks: ['block'] };
  return value;
}
function step() { return { status: 'passed', command: 'test', passed: ['one'], failed: [] as string[] }; }
function runtime() { return { status: 'passed', build: step(), unit: step(), acceptance: step() }; }
function manifest(counts: Partial<ManifestInput['summary']['missingReasonCounts']>): ManifestInput {
  const missingReasonCounts = {
    'declared-generated-missing': 0,
    'fixed-governance-missing': 0,
    'stale-semantic-projection': 0,
    ...counts
  };
  return {
    summary: { artifactStatus: 'passed', artifactCount: 1, missingCount: 1, uploadGroupCount: 0,
      governanceCount: 1, testCount: 0, contractCount: 0, missingReasonCounts },
    uploadGroups: []
  };
}

test('policy projection owns its arrays while preserving source order and counts', () => {
  const source = policy(), projected = projectPolicySources(source as PolicyInput);
  assert.equal(projected.sourceCount, 2); assert.equal(projected.policyCount, 3);
  assert.deepEqual(projected.sources.map(value => value.scope), ['official', 'project']);
  source.official.sources[0]!.policyIds.push('later');
  source.project.sources[0]!.policyIds.length = 0;
  assert.deepEqual(projected.sources.map(value => value.policyIds), [['one'], ['two', 'three']]);
  assert.deepEqual(projected.sources.map(value => value.policyCount), [1, 2]);
});

test('policy list and count use one observation of a provider getter', () => {
  const source = policy(); let reads = 0;
  Object.defineProperty(source.official.sources[0], 'policyIds', { get() { reads++; return reads === 1 ? ['first'] : ['later', 'later']; } });
  const projected = projectPolicySources(source as PolicyInput);
  assert.equal(reads, 1);
  assert.deepEqual(projected.sources[0]!.policyIds, ['first']);
  assert.equal(projected.sources[0]!.policyCount, 1);
});

test('editing a policy projection never changes the domain result', () => {
  const source = policy(), projected = projectPolicySources(source as PolicyInput);
  projected.sources[0]!.policyIds.push('projection-only');
  assert.deepEqual(source.official.sources[0]!.policyIds, ['one']);
});

test('coverage copies declared, covered and uncovered arrays in both directions', () => {
  const source = coverage(), projected = projectAcceptanceTargets(source);
  source.blocks[0]!.declaredAcceptance.push('later'); source.uncoveredBlocks.length = 0;
  projected.targets[0]!.coveredBy.push('projection-only');
  assert.deepEqual(projected.targets[0]!.declaredAcceptance, ['declared']);
  assert.deepEqual(projected.uncoveredIds, ['block']); assert.equal(projected.uncoveredCount, 1);
  assert.equal(projected.targets[0]!.declaredAcceptanceCount, 1);
  assert.deepEqual(source.blocks[0]!.coveredBy, []);
});

test('coverage summary and target fields use the same captured observations', () => {
  const source = coverage(); let declaredReads = 0, coveredReads = 0, uncoveredReads = 0;
  Object.defineProperties(source.blocks[0], {
    declaredAcceptance: { enumerable: true, get() { declaredReads++; return ['declaration']; } },
    coveredBy: { enumerable: true, get() { coveredReads++; return ['coverage']; } },
    uncovered: { enumerable: true, get() { uncoveredReads++; return false; } }
  });
  const projected = projectAcceptanceTargets(source);
  assert.deepEqual([declaredReads, coveredReads, uncoveredReads], [1, 1, 1]);
  assert.equal(projected.coveredCount, 1); assert.equal(projected.targets[0]!.uncovered, false);
  assert.equal(projected.targets[0]!.declaredAcceptanceCount, projected.targets[0]!.declaredAcceptance.length);
  assert.equal(projected.targets[0]!.coveredByCount, projected.targets[0]!.coveredBy.length);
});

test('coverage projection does not acquire later-added targets', () => {
  const source = coverage(), projected = projectAcceptanceTargets(source);
  source.blocks.push({ ...source.blocks[0]!, id: 'later' });
  assert.equal(projected.targetCount, 1); assert.deepEqual(projected.targets.map(v => v.id), ['block']);
});

test('all runtime step details are copied, without freezing the provider result', () => {
  const source = runtime(), projected = projectRuntimeInspection(source as RuntimeInput);
  for (const key of ['build', 'unit', 'acceptance'] as const) {
    source[key].passed.push('later'); source[key].failed.push('later');
  }
  assert.deepEqual(projected.steps.map(v => v.passed), [['one'], ['one'], ['one']]);
  assert.deepEqual(projected.steps.map(v => [v.passedCount, v.failedCount]), [[1, 0], [1, 0], [1, 0]]);
  projected.steps[0]!.failed.push('projection');
  assert.deepEqual(source.build.failed, ['later']);
});

test('runtime getters are read once for each count/list pair', () => {
  const source = runtime(); let passed = 0, failed = 0;
  Object.defineProperties(source.build, {
    passed: { get() { passed++; return passed === 1 ? ['one'] : []; } },
    failed: { get() { failed++; return failed === 1 ? ['failure'] : []; } }
  });
  const projected = projectRuntimeInspection(source as RuntimeInput).steps[0]!;
  assert.deepEqual([passed, failed], [1, 1]);
  assert.equal(projected.passedCount, projected.passed.length);
  assert.equal(projected.failedCount, projected.failed.length);
});

test('missing block identities do not manufacture an empty block', () => {
  const source = { ciSummary: { status: 'passed' }, failurePoints: [], conflictHints: [], regressionRisks: [
    { kind: 'fixture', message: 'unbound' }, { kind: 'fixture', message: 'empty', blockId: '' },
    { kind: 'fixture', message: 'bound', blockId: 'valid' }, { kind: 'fixture', message: 'duplicate', blockId: 'valid' }
  ] };
  const projected = projectReviewDiagnostics(source as unknown as ReviewInput);
  assert.deepEqual(projected.blocks, ['valid']); assert.equal(projected.blockCount, 1);
  assert.equal(projected.diagnosticCount, 4); // No diagnostic is removed with its absent identity.
});

test('block index derives from the emitted diagnostic rather than re-reading raw risks', () => {
  const risk = { kind: 'fixture', message: 'bound', get blockId() { return ++reads === 1 ? 'initial' : reads === 2 ? 'emitted' : 'different'; } };
  let reads = 0;
  const projected = projectReviewDiagnostics({ ciSummary: { status: 'passed' }, failurePoints: [], conflictHints: [], regressionRisks: [risk] } as unknown as ReviewInput);
  assert.deepEqual(projected.blocks, ['emitted']); assert.equal(reads, 2);
  assert.equal((projected.diagnostics[0] as {blockId?: string}).blockId, 'emitted');
});

test('an absent generating pass displays none, not an empty string identity', () => {
  const artifact = { path: 'a', originType: 'generated', originId: 'fixture', verifiedBy: [], overrideStatus: 'none' };
  const absent = formatProvenanceRegistry(projectProvenanceRegistryInspect({ artifacts: [artifact] } as unknown as ProvenanceInput));
  assert.ok(absent.includes('Generated passes: none'));
  const mixed = formatProvenanceRegistry(projectProvenanceRegistryInspect({ artifacts: [artifact, { ...artifact, path: 'b', generatedByPass: 'emit' }] } as unknown as ProvenanceInput));
  assert.ok(mixed.includes('Generated passes: emit')); assert.ok(!mixed.includes('Generated passes: ,'));
});

test('manifest formatter consumes large aggregate counts without occurrence expansion', () => {
  const output = formatCiArtifactManifest(projectCiArtifactManifest(manifest({ 'fixed-governance-missing': Number.MAX_SAFE_INTEGER,
    'declared-generated-missing': 2 ** 40 })));
  assert.ok(output.includes(`Missing reasons: declared-generated-missing=${2 ** 40}, fixed-governance-missing=${Number.MAX_SAFE_INTEGER}`));
});

test('manifest zero/ordinary count presentation preserves existing sorted wording', () => {
  assert.ok(formatCiArtifactManifest(projectCiArtifactManifest(manifest({ 'fixed-governance-missing': 2, 'declared-generated-missing': 1 })))
    .includes('Missing reasons: declared-generated-missing=1, fixed-governance-missing=2'));
  assert.ok(formatCiArtifactManifest(projectCiArtifactManifest(manifest({}))).includes('Missing reasons: none'));
});

test('manifest invalid aggregate counts fail explicitly instead of expanding malformed data', () => {
  for (const count of [-1, 0.5, Infinity, NaN]) {
    assert.throws(() => formatCiArtifactManifest(projectCiArtifactManifest(manifest({ 'declared-generated-missing': count }))), RangeError);
  }
});

test('coverage preserves existing JSON field order while detaching source arrays', () => {
  const entry = { coveredBy: ['coverage'], id: 'block', declaredAcceptance: ['declared'], uncovered: false };
  const source: CoverageInput = { formatVersion: '1', status: 'passed', acceptancePassed: [], blocks: [entry], uncoveredBlocks: [] };
  const projected = projectAcceptanceTargets(source).targets[0]!;
  const expected = { ...entry, declaredAcceptanceCount: 1, coveredByCount: 1 };
  assert.equal(JSON.stringify(projected), JSON.stringify(expected));
  assert.notEqual(projected.coveredBy, entry.coveredBy);
  assert.notEqual(projected.declaredAcceptance, entry.declaredAcceptance);
});
