import { expect, test } from 'bun:test';

import { ACCEPTANCE_COVERAGE_FORMAT_VERSION } from '../../../src/assurance/acceptance/coverage.ts';
import { validateAcceptanceCoverageReport } from '../../../src/assurance/verification/acceptance/validation.ts';

function canonicalCoverage() {
  return {
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    status: 'passed',
    source: {
      resolvedBlockIds: ['auth/basic-session'], acceptancePlan: ['acceptance_login'],
      declarations: [{ declaringBlockId: 'auth/basic-session', acceptance: { id: 'acceptance_login', source: { tests: ['tests/acceptance/auth.test.ts'] } } }],
      tests: [{ testPath: 'tests/acceptance/auth.test.ts', blockId: 'auth/basic-session' }]
    },
    acceptancePassed: ['acceptance_login'],
    blocks: [{
      id: 'auth/basic-session',
      declaredAcceptance: ['acceptance_login'],
      coveredBy: ['acceptance_login'],
      uncovered: false
    }],
    uncoveredBlocks: []
  } as const;
}

test('Acceptance Coverage authority accepts canonical derived coverage and rejects an unknown schema', () => {
  const coverage = validateAcceptanceCoverageReport(canonicalCoverage());

  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(() => validateAcceptanceCoverageReport({
    ...canonicalCoverage(),
    formatVersion: 'future'
  })).toThrow('unsupported formatVersion');
});

test('Acceptance Coverage authority rejects covered acceptance not declared by target', () => {
  const candidate = canonicalCoverage() as any;
  candidate.blocks[0].coveredBy = ['acceptance_other'];

  expect(() => validateAcceptanceCoverageReport(candidate))
    .toThrow('undeclared Acceptance ID');
});

test('Acceptance Coverage authority rejects forged uncovered projection', () => {
  const candidate = canonicalCoverage() as any;
  candidate.blocks[0].uncovered = true;
  candidate.uncoveredBlocks = ['auth/basic-session'];

  expect(() => validateAcceptanceCoverageReport(candidate))
    .toThrow('.uncovered differs');
});

test('Acceptance Coverage authority rejects uncovered list that differs from entries', () => {
  const candidate = canonicalCoverage() as any;
  candidate.uncoveredBlocks = ['auth/basic-session'];

  expect(() => validateAcceptanceCoverageReport(candidate))
    .toThrow('differ from coverage entries');
});

test('Acceptance Coverage authority rejects duplicate or noncanonical Acceptance identities', () => {
  const duplicate = canonicalCoverage() as any;
  duplicate.acceptancePassed = ['acceptance_login', 'acceptance_login'];
  expect(() => validateAcceptanceCoverageReport(duplicate))
    .toThrow('unique and canonically ordered');

  const noncanonical = canonicalCoverage() as any;
  noncanonical.acceptancePassed = ['Acceptance Login'];
  expect(() => validateAcceptanceCoverageReport(noncanonical))
    .toThrow('canonical Acceptance IDs');
});

test('Acceptance Coverage authority rejects noncanonical block ordering', () => {
  const blockOrder = canonicalCoverage() as any;
  blockOrder.source.resolvedBlockIds.push('billing/basic-plan');
  blockOrder.source.acceptancePlan.unshift('acceptance_billing');
  blockOrder.source.declarations.push({
    declaringBlockId: 'billing/basic-plan',
    acceptance: { id: 'acceptance_billing', source: { tests: ['tests/acceptance/billing.test.ts'] } }
  });
  blockOrder.source.tests.push({ testPath: 'tests/acceptance/billing.test.ts', blockId: 'billing/basic-plan' });
  blockOrder.acceptancePassed.unshift('acceptance_billing');
  blockOrder.blocks.push({
    id: 'billing/basic-plan',
    declaredAcceptance: ['acceptance_billing'],
    coveredBy: ['acceptance_billing'],
    uncovered: false
  });
  expect(() => validateAcceptanceCoverageReport(blockOrder)).not.toThrow();
  blockOrder.blocks.reverse();
  expect(() => validateAcceptanceCoverageReport(blockOrder))
    .toThrow('blocks must be canonically ordered');
});
