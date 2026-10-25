import { expect, test } from 'bun:test';
import { buildAcceptanceCoverage } from '../../../src/adapters/verification/build-acceptance-coverage.ts';
import type { BlockManifest, LockFile } from '../../../src/compiler/contract.ts';
import { buildAcceptanceCoverageFromSource, buildAcceptanceCoverageReport } from '../../../src/assurance/acceptance/build-coverage.ts';
import { acceptanceCoverageSource } from '../../../src/assurance/acceptance/source.ts';
import { validateAcceptanceCoverageReport } from '../../../src/assurance/verification/acceptance/validation.ts';
import { assertVerificationPublicationArtifactSet } from '../../../src/assurance/verification/artifact/contract/artifact.ts';
import { assertProductVerificationArtifactSubject, buildProductVerificationReport, createSkippedFastLane, createSkippedRuntimeLane, productVerificationSubjectRevision } from '../../../src/assurance/verification/project/report.ts';
import { validateAcceptanceItem } from '../../../src/semantics/acceptance/source.ts';
import { buildPassingReviewReport, buildReviewLock, buildRuntimeVerificationReport } from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';
import { productVerificationObservationsFixture, writeCanonicalVerificationArtifactSetFixture } from '../../helpers/verification-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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

function fast(passed: string[]) {
  const lane = createSkippedFastLane();
  lane.status = 'passed';
  lane.build.status = 'passed';
  lane.unit = { status: 'passed', passed: ['example.test.ts'] };
  lane.acceptance = { status: 'passed', passed, failed: [] };
  return lane;
}

function runtime(passed: string[] = []) {
  return buildRuntimeVerificationReport({
    build: { passed: ['bun run build'] },
    unit: { passed: ['tests/runtime/unit/example.test.ts'] },
    acceptance: { passed }
  });
}

function lock(
  acceptancePlan: string[],
  acceptanceSources: NonNullable<LockFile['acceptanceSources']>,
  blockIds = ['source/block', 'target/block']
): LockFile {
  return buildReviewLock({
    app: { stack: 'typescript-library' },
    resolvedBlocks: blockIds.map((id, index) => ({
      id, version: '0.1.0', kind: 'capability', installOrder: index + 1,
      manifestPath: 'block.manifest.yaml', registrySourceId: 'test', registryKind: 'private',
      registryLocation: 'workspace', registryPath: 'registry'
    })),
    acceptancePlan,
    acceptanceSources,
    installPlan: [...new Set(acceptanceSources.flatMap(entry => entry.acceptance.source?.tests ?? []))].map((to, index) => ({
      stepId: `source:${index}`, blockId: 'source/block', registrySourceId: 'test', registryKind: 'private',
      registryLocation: 'workspace', registryPath: 'registry', sourceRoot: 'files', action: 'copy', from: to, to
    }))
  });
}

function captureAcceptanceSources(acceptance: BlockManifest['acceptance']): NonNullable<LockFile['acceptanceSources']> {
  return acceptance.map(acceptance => ({ declaringBlockId: 'source/block', acceptance }));
}

test('fast and runtime files close every declared semantic acceptance', async () => {
  const captured = captureAcceptanceSources([
    {
      id: 'user_can_login',
      source: { tests: ['tests/acceptance/auth-flow.test.ts'] },
      covers: { blocks: ['source/block'] }
    },
    {
      id: 'user_can_create_customer',
      source: { tests: ['tests/acceptance/customer-flow.test.ts'] },
      dependsOn: ['user_can_login'],
      covers: { blocks: ['source/block'] }
    },
    {
      id: 'customer_can_upload_attachment',
      source: { tests: ['tests/acceptance/customer-attachments-flow.test.ts'] },
      dependsOn: ['user_can_create_customer'],
      covers: { blocks: ['target/block'] }
    }
  ]);

  const coverage = await buildAcceptanceCoverage(
    '.',
    lock([
      'user_can_login',
      'user_can_create_customer',
      'customer_can_upload_attachment'
    ], captured),
    runtime([
      'tests/acceptance/auth-flow.test.ts',
      'tests/acceptance/customer-attachments-flow.test.ts'
    ]),
    fast(['customer-flow.test.ts'])
  );

  expect(coverage.acceptancePassed).toEqual([
    'customer_can_upload_attachment',
    'user_can_create_customer',
    'user_can_login'
  ]);
  expect(coverage.blocks).toEqual([
    {
      id: 'source/block',
      declaredAcceptance: ['user_can_create_customer', 'user_can_login'],
      coveredBy: ['user_can_create_customer', 'user_can_login'],
      uncovered: false
    },
    {
      id: 'target/block',
      declaredAcceptance: ['customer_can_upload_attachment'],
      coveredBy: ['customer_can_upload_attachment'],
      uncovered: false
    }
  ]);
  expect(coverage.uncoveredBlocks).toEqual([]);
});

test('missing, unexecuted or unmapped source evidence cannot close acceptance coverage', async () => {
  {
    const input = fixture();
    expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual(['invoice_total']);
    const empty = fixture(); empty.fast.acceptance.passed = [];
    expect(buildAcceptanceCoverageReport(empty).acceptancePassed).toEqual([]);
    const skipped = fixture(); skipped.fast.acceptance.status = 'skipped';
    expect(buildAcceptanceCoverageReport(skipped).acceptancePassed).toEqual([]);
    const helper = fixture(); helper.lock.installPlan.push({ ...helper.lock.installPlan[0]!, to: 'tests/acceptance/helpers.ts' });
    expect(buildAcceptanceCoverageReport(helper).source.tests).toEqual([{ testPath: first, blockId: 'billing/invoice' }]);
    const absent = fixture(); delete absent.lock.acceptanceSources![0]!.acceptance.source;
    expect(buildAcceptanceCoverageReport(absent).acceptancePassed).toEqual([]);
    const contradictory = fixture(); contradictory.fast.acceptance.failed = [first];
    expect(() => buildAcceptanceCoverageReport(contradictory)).toThrow('both passed and failed');
    const unexecuted = fixture(); unexecuted.fast.status = 'skipped'; unexecuted.runtime.acceptance.status = 'passed';
    unexecuted.runtime.acceptance.passed = [first]; unexecuted.runtime.status = 'passed';
    expect(buildAcceptanceCoverageReport(unexecuted).acceptancePassed).toEqual([]);
  }
  {
    const captured = captureAcceptanceSources([
      {
        id: 'user_can_create_customer',
        source: { tests: ['tests/acceptance/customer-flow.test.ts'] },
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'customer_can_upload_attachment',
        source: { tests: ['tests/acceptance/customer-attachments-flow.test.ts'] },
        dependsOn: ['user_can_create_customer'],
        covers: { blocks: ['target/block'] }
      },
      {
        id: 'unmapped_acceptance',
        covers: { blocks: ['target/block'] }
      }
    ]);
    const currentLock = lock([
      'user_can_create_customer',
      'customer_can_upload_attachment',
      'unmapped_acceptance'
    ], captured);

    const partial = await buildAcceptanceCoverage(
      '.',
      currentLock,
      runtime([
        'tests/acceptance/customer-attachments-flow.test.ts',
        'tests/acceptance/customer-flow.test.ts'
      ]),
      fast([])
    );
    expect(partial.acceptancePassed).toEqual([
      'customer_can_upload_attachment',
      'user_can_create_customer'
    ]);
    expect(partial.blocks.find((entry) => entry.id === 'target/block')).toEqual({
      id: 'target/block',
      declaredAcceptance: [
        'customer_can_upload_attachment',
        'unmapped_acceptance'
      ],
      coveredBy: ['customer_can_upload_attachment'],
      uncovered: true
    });
    expect(partial.uncoveredBlocks).toEqual(['target/block']);

    const empty = await buildAcceptanceCoverage(
      '.',
      currentLock,
      runtime([]),
      fast([])
    );
    expect(empty.acceptancePassed).toEqual([]);
    expect(empty.blocks.every((entry) => entry.uncovered)).toBe(true);
  }
});

test('every declaring source and dependency must be satisfied before a block is covered', () => {
  {
    const input = fixture([first, second]);
    input.fast.acceptance.passed.push(second);
    input.lock.acceptanceSources!.push({ declaringBlockId: 'billing/invoice', acceptance: { id: 'invoice_dependency', source: { tests: [second] } } });
    input.lock.acceptanceSources![0]!.acceptance.dependsOn = ['invoice_dependency'];
    const dependent = buildAcceptanceCoverageReport(input);
    expect(dependent.acceptancePassed).toEqual(['invoice_total']);
    expect(dependent.blocks[0]!.coveredBy).toEqual([]);
  }
  {
    const input = fixture([first, second]);
    input.lock.resolvedBlocks.push({ ...input.lock.resolvedBlocks[0]!, id: 'billing/summary' });
    input.lock.acceptanceSources!.push({ declaringBlockId: 'billing/summary', acceptance: { id: 'invoice_total', source: { tests: [first] } } });
    expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual([]);
    input.fast.acceptance.passed.push(second);
    expect(buildAcceptanceCoverageReport(input).acceptancePassed).toEqual(['invoice_total']);
  }
});

test('invalid acceptance plans, ownership and dependency graphs are refused', async () => {
  {
    const input = fixture(); input.lock.acceptanceSources![0]!.acceptance.covers = { blocks: ['missing/block'] };
    expect(() => buildAcceptanceCoverageReport(input)).toThrow('unknown resolved block');
    const owner = fixture(); owner.lock.installPlan[0]!.blockId = 'missing/block';
    expect(() => buildAcceptanceCoverageReport(owner)).toThrow('unknown test owner');
    const duplicate = fixture(); duplicate.lock.installPlan.push({ ...duplicate.lock.installPlan[0]! });
    expect(() => buildAcceptanceCoverageReport(duplicate)).toThrow('ownership must be unique');
    const missing = fixture(); missing.lock.installPlan = [];
    const before = structuredClone(missing.lock);
    const missingCoverage = buildAcceptanceCoverageReport(missing);
    expect(missingCoverage.acceptancePassed).toEqual([]);
    expect(missingCoverage.blocks[0]!.uncovered).toBe(true);
    expect(missing.lock).toEqual(before);
  }
  {
    const captured = captureAcceptanceSources([]);
    await expect(buildAcceptanceCoverage(
      '.',
      lock(['missing_acceptance'], captured),
      runtime([]),
      fast([])
    )).rejects.toThrow(/undeclared acceptance ID missing_acceptance/);
  }
  {
    const captured = captureAcceptanceSources([{
      id: 'orphan_acceptance',
      covers: { blocks: [] }
    }]);
    await expect(buildAcceptanceCoverage(
      '.',
      lock(['orphan_acceptance'], captured, ['source/block']),
      runtime(),
      fast([])
    )).rejects.toThrow('covers no resolved block');
  }
  {
    const captured = captureAcceptanceSources([
      {
        id: 'acceptance_a',
        dependsOn: ['acceptance_b'],
        covers: { blocks: ['source/block'] }
      },
      {
        id: 'acceptance_b',
        dependsOn: ['acceptance_a'],
        covers: { blocks: ['source/block'] }
      }
    ]);
    await expect(buildAcceptanceCoverage(
      '.',
      lock(['acceptance_a', 'acceptance_b'], captured, ['source/block']),
      runtime(),
      fast([])
    )).rejects.toThrow('Acceptance dependency cycle detected');
  }
});

test('offline recomputation and the current Lock refuse forged source or coveredBy', () => {
  const input = fixture();
  const coverage = buildAcceptanceCoverageReport(input);
  const report = buildProductVerificationReport({ lane: 'fast', fast: input.fast, runtime: input.runtime, runtimeMode: 'service',
    policyReport: input.fast.policyReport!, acceptanceCoverage: coverage,
    observations: productVerificationObservationsFixture('fast', 'service', productVerificationSubjectRevision(input.lock)) });
  expect(report.acceptance).toEqual({ status: 'passed', passed: [first], failed: [] });
  expect(report.summary).toMatchObject({ status: 'passed', requestedLane: 'fast', failedLanes: [] });
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

test('coverage readback restores fast acceptance from the matching canonical report', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const captured = captureAcceptanceSources([{
      id: 'user_can_create_customer',
      source: { tests: ['tests/acceptance/customer-flow.test.ts'] },
      covers: { blocks: ['source/block'] }
    }]);
    const fastLane = fast(['customer-flow.test.ts']);
    const runtimeLane = runtime();
    const report = buildPassingReviewReport({
      fast: fastLane,
      runtime: runtimeLane
    });
    await writeCanonicalVerificationArtifactSetFixture(workspaceRoot, report, {
      policyReport: fastLane.policyReport,
      acceptanceCoverage: {
        formatVersion: '2',
        status: 'passed',
        source: { resolvedBlockIds: ['source/block'], acceptancePlan: ['user_can_create_customer'], declarations: captured,
          tests: [{ testPath: 'tests/acceptance/customer-flow.test.ts', blockId: 'source/block' }] },
        acceptancePassed: ['user_can_create_customer'],
        blocks: [{
          id: 'source/block',
          declaredAcceptance: ['user_can_create_customer'],
          coveredBy: ['user_can_create_customer'],
          uncovered: false
        }],
        uncoveredBlocks: []
      }
    });

    const coverage = await buildAcceptanceCoverage(
      workspaceRoot,
      lock(['user_can_create_customer'], captured, ['source/block']),
      runtimeLane
    );
    expect(coverage.acceptancePassed).toEqual(['user_can_create_customer']);
    expect(coverage.uncoveredBlocks).toEqual([]);
  });
});
