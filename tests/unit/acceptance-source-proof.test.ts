import { expect, test } from 'bun:test';
import { buildAcceptanceCoverageFromSource, buildAcceptanceCoverageReport } from '../../src/assurance/acceptance/build-coverage.ts';
import { acceptanceCoverageSource } from '../../src/assurance/acceptance/source.ts';
import { validateAcceptanceCoverageReport } from '../../src/assurance/verification/acceptance/validation.ts';
import { assertVerificationPublicationArtifactSet } from '../../src/assurance/verification/artifact/contract/artifact.ts';
import { assertProductVerificationArtifactSubject, buildProductVerificationReport, createSkippedFastLane, createSkippedRuntimeLane, productVerificationSubjectRevision } from '../../src/assurance/verification/project/report.ts';
import { validateAcceptanceItem } from '../../src/semantics/acceptance/source.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';
import { productVerificationObservationsFixture } from '../helpers/verification-fixtures.ts';

const first = 'tests/acceptance/invoice.test.ts';
const second = 'tests/acceptance/tax.test.ts';
function fixture(required = [first]) {
  const lock = buildReviewLock({
    semanticLoweringTasks: [], semanticViews: buildSemanticViewFixture(),
    resolvedBlocks: [{ id: 'billing/invoice', version: '0.1.0', kind: 'capability', installOrder: 1,
      manifestPath: 'invoice.yaml', registrySourceId: 'private', registryKind: 'private', registryLocation: 'workspace', registryPath: 'invoice' }],
    acceptancePlan: ['invoice_total'],
    acceptanceSources: [{ declaringBlockId: 'billing/invoice', acceptance: { id: 'invoice_total', source: { tests: required } } }],
    installPlan: required.map((to, index) => ({ stepId: `invoice:${index}`, blockId: 'billing/invoice', registrySourceId: 'private',
      registryKind: 'private', registryLocation: 'workspace', registryPath: 'invoice', sourceRoot: 'files', action: 'copy', from: to, to }))
  });
  const fast = createSkippedFastLane();
  fast.status = 'passed'; fast.build.status = 'passed'; fast.unit.status = 'passed';
  fast.acceptance = { status: 'passed', passed: [first], failed: [] };
  const runtime = createSkippedRuntimeLane();
  return { lock, fast, runtime };
}

test('a non-built-in manifest source proves only installed and actually passed tests', () => {
  const input = fixture();
  expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual(['invoice_total']);
  const empty = fixture(); empty.fast.acceptance.passed = [];
  expect(buildAcceptanceCoverageReport(empty).acceptancePassed).toEqual([]);
  const skipped = fixture(); skipped.fast.acceptance.status = 'skipped';
  expect(buildAcceptanceCoverageReport(skipped).acceptancePassed).toEqual([]);
  const missing = fixture(); missing.lock.installPlan = [];
  expect(buildAcceptanceCoverageReport(missing).acceptancePassed).toEqual([]);
  const helper = fixture(); helper.lock.installPlan.push({ ...helper.lock.installPlan[0]!, to: 'tests/acceptance/helpers.ts' });
  expect(buildAcceptanceCoverageReport(helper).source.tests).toEqual([{ testPath: first, blockId: 'billing/invoice' }]);
  const absent = fixture(); delete absent.lock.acceptanceSources![0]!.acceptance.source;
  expect(buildAcceptanceCoverageReport(absent).acceptancePassed).toEqual([]);
  const contradictory = fixture(); contradictory.fast.acceptance.failed = [first];
  expect(() => buildAcceptanceCoverageReport(contradictory)).toThrow('both passed and failed');
  const unexecuted = fixture(); unexecuted.fast.status = 'skipped'; unexecuted.runtime.acceptance.status = 'passed';
  unexecuted.runtime.acceptance.passed = [first]; unexecuted.runtime.status = 'passed';
  expect(buildAcceptanceCoverageReport(unexecuted).acceptancePassed).toEqual([]);
});

test('all required tests and repeated declarations form all-of proof obligations', () => {
  const input = fixture([first, second]);
  expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual([]);
  input.fast.acceptance.passed.push(second);
  expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual(['invoice_total']);
  input.lock.acceptanceSources!.push({ declaringBlockId: 'billing/invoice', acceptance: { id: 'invoice_dependency', source: { tests: [second] } } });
  input.lock.acceptanceSources![0]!.acceptance.dependsOn = ['invoice_dependency'];
  const dependent = buildAcceptanceCoverageReport(input);
  expect(dependent.acceptancePassed).toEqual(['invoice_total']);
  expect(dependent.blocks[0]!.coveredBy).toEqual([]);
});

test('a second declaring block cannot weaken an existing required test set', () => {
  const input = fixture([first, second]);
  input.lock.resolvedBlocks.push({ ...input.lock.resolvedBlocks[0]!, id: 'billing/summary' });
  input.lock.acceptanceSources!.push({ declaringBlockId: 'billing/summary', acceptance: { id: 'invoice_total', source: { tests: [first] } } });
  expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual([]);
  input.fast.acceptance.passed.push(second);
  expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual(['invoice_total']);
});

test('unknown coverage and test owners are refused; missing execution never selects another block', () => {
  const input = fixture(); input.lock.acceptanceSources![0]!.acceptance.covers = { blocks: ['missing/block'] };
  expect(() => buildAcceptanceCoverageReport(input)).toThrow('unknown resolved block');
  const owner = fixture(); owner.lock.installPlan[0]!.blockId = 'missing/block';
  expect(() => buildAcceptanceCoverageReport(owner)).toThrow('unknown test owner');
  const duplicate = fixture(); duplicate.lock.installPlan.push({ ...duplicate.lock.installPlan[0]! });
  expect(() => buildAcceptanceCoverageReport(duplicate)).toThrow('ownership must be unique');
  const missing = fixture(); missing.lock.installPlan = [];
  const before = structuredClone(missing.lock);
  expect(buildAcceptanceCoverageReport(missing).blocks[0]!.uncovered).toBe(true);
  expect(missing.lock).toEqual(before);
});

test('offline recomputation and the current Lock refuse forged source or coveredBy', () => {
  const input = fixture();
  const coverage = buildAcceptanceCoverageReport(input);
  const report = buildProductVerificationReport({ lane: 'fast', fast: input.fast, runtime: input.runtime, runtimeMode: 'service',
    policyReport: input.fast.policyReport!, acceptanceCoverage: coverage,
    observations: productVerificationObservationsFixture('fast', 'service', productVerificationSubjectRevision(input.lock)) });
  const artifacts = { verificationReport: report, runtimeReport: input.runtime, policyReport: input.fast.policyReport!, acceptanceCoverage: coverage };
  expect(() => assertVerificationPublicationArtifactSet(artifacts)).not.toThrow();
  assertProductVerificationArtifactSubject(input.lock, artifacts);
  const forged = structuredClone(coverage); forged.source.tests = [];
  expect(() => assertProductVerificationArtifactSubject(input.lock, { ...artifacts, acceptanceCoverage: forged })).toThrow('current Lock');
  expect(() => assertVerificationPublicationArtifactSet({ ...artifacts, acceptanceCoverage: forged })).toThrow();
  const missing = structuredClone(coverage); missing.blocks[0]!.coveredBy = []; missing.blocks[0]!.uncovered = true; missing.uncoveredBlocks = ['billing/invoice'];
  expect(buildAcceptanceCoverageFromSource(missing.source, input.fast, input.runtime)).toEqual(coverage);
  expect(() => assertVerificationPublicationArtifactSet({ ...artifacts, acceptanceCoverage: missing })).toThrow();
  const changed = fixture(); changed.lock.acceptanceSources![0]!.acceptance.source!.tests = [second];
  expect(productVerificationSubjectRevision(changed.lock)).not.toBe(productVerificationSubjectRevision(input.lock));
});

test('historical Lock and v1 coverage require reconstruction before verification', () => {
  const input = fixture(); delete input.lock.acceptanceSources;
  expect(() => acceptanceCoverageSource(input.lock)).toThrow('resolve the current manifests');
  expect(() => productVerificationSubjectRevision(input.lock)).toThrow('resolve the current manifests');
  expect(() => validateAcceptanceCoverageReport({ formatVersion: '1' })).toThrow('rebuild coverage');
});

test('manifest source tests reject empty, repeated, unordered and noncanonical paths', () => {
  expect(validateAcceptanceItem({ id: 'invoice_total', source: { tests: [first] } }).source?.tests).toEqual([first]);
  for (const tests of [[], [first, first], [second, first], ['../invoice.test.ts']]) {
    expect(() => validateAcceptanceItem({ id: 'invoice_total', source: { tests } })).toThrow();
  }
});
