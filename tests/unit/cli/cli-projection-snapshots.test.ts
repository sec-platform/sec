import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { projectAcceptanceTargets } from '../../../src/application/acceptance-inspection.ts';
import { projectPolicySources } from '../../../src/application/policy-source-inspection.ts';
import { projectProvenanceRegistryInspect } from '../../../src/application/provenance-registry-inspect.ts';
import { projectReviewDiagnostics } from '../../../src/application/review-diagnostics-inspect.ts';
import { projectRuntimeInspection } from '../../../src/application/runtime-inspection.ts';
import { formatProvenanceRegistry } from '../../../src/entry/cli/provenance-registry-inspect.ts';

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
test('policy list and count use one observation of a provider getter', () => {
  const source = policy(); let reads = 0;
  Object.defineProperty(source.official.sources[0], 'policyIds', { get() { reads++; return reads === 1 ? ['first'] : ['later', 'later']; } });
  const projected = projectPolicySources(source as PolicyInput);
  assert.equal(reads, 1);
  assert.deepEqual(projected.sources[0]!.policyIds, ['first']);
  assert.equal(projected.sources[0]!.policyCount, 1);
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

test('runtime getters are read once for each count/list pair', () => {
  const source = runtime(); let passed = 0, failed = 0;
  Object.defineProperties(source.build, {
    passed: { get() { passed++; return passed === 1 ? ['one'] : []; } },
    failed: { get() { failed++; return failed === 1 ? ['failure'] : []; } }
  });
  const projected = projectRuntimeInspection(source as RuntimeInput).steps[0]!;
  assert.deepEqual([passed, failed], [1, 1]);
  assert.deepEqual(projected.passed, ['one']);
  assert.deepEqual(projected.failed, ['failure']);
  assert.equal(projected.passedCount, 1);
  assert.equal(projected.failedCount, 1);
});

test('block index derives from the emitted diagnostic rather than re-reading raw risks', () => {
  const risk = { kind: 'fixture', message: 'bound', get blockId() { return ++reads === 1 ? 'initial' : reads === 2 ? 'emitted' : 'different'; } };
  let reads = 0;
  const projected = projectReviewDiagnostics({ ciSummary: { status: 'passed' }, failurePoints: [], conflictHints: [], regressionRisks: [risk] } as unknown as ReviewInput);
  const emittedBlock = (projected.diagnostics[0] as { blockId?: string }).blockId;
  assert.ok(['initial', 'emitted', 'different'].includes(emittedBlock ?? ''));
  assert.deepEqual(projected.blocks, [emittedBlock]);
  assert.equal(projected.blockCount, 1);
});

test('an absent generating pass displays none, not an empty string identity', () => {
  const artifact = { path: 'a', originType: 'generated', originId: 'fixture', verifiedBy: [], overrideStatus: 'none' };
  const absent = formatProvenanceRegistry(projectProvenanceRegistryInspect({ artifacts: [artifact] } as unknown as ProvenanceInput));
  assert.ok(absent.includes('Generated passes: none'));
  const mixed = formatProvenanceRegistry(projectProvenanceRegistryInspect({ artifacts: [artifact, { ...artifact, path: 'b', generatedByPass: 'emit' }] } as unknown as ProvenanceInput));
  assert.ok(mixed.includes('Generated passes: emit')); assert.ok(!mixed.includes('Generated passes: ,'));
});
