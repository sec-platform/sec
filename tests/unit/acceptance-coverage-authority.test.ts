import { expect, test } from 'bun:test';

import { ACCEPTANCE_COVERAGE_FORMAT_VERSION } from '../../src/semantic/acceptance/contract/types.ts';
import { validateAcceptanceCoverageReport } from '../../src/verification/acceptance/runtime/coverage-authority.ts';

function canonicalCoverage() {
  return {
    formatVersion: ACCEPTANCE_COVERAGE_FORMAT_VERSION,
    status: 'passed',
    acceptancePassed: ['acceptance_login'],
    blocks: [{
      id: 'auth/basic-session',
      declaredAcceptance: ['acceptance_login'],
      coveredBy: ['acceptance_login'],
      uncovered: false
    }],
    slots: [{
      id: 'session_adapter',
      declaredAcceptance: ['acceptance_login'],
      coveredBy: ['acceptance_login'],
      uncovered: false
    }],
    uncoveredBlocks: [],
    uncoveredSlots: []
  } as const;
}

test('Acceptance Coverage authority accepts canonical derived coverage and rejects an unknown schema', () => {
  const coverage = validateAcceptanceCoverageReport(canonicalCoverage());

  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(Object.isFrozen(coverage)).toBe(true);
  expect(() => validateAcceptanceCoverageReport({
    ...canonicalCoverage(),
    formatVersion: 'future'
  })).toThrow('unsupported formatVersion');
});

test('Acceptance Coverage authority rejects covered acceptance not declared by target', () => {
  const candidate = structuredClone(canonicalCoverage()) as any;
  candidate.blocks[0].coveredBy = ['acceptance_other'];

  expect(() => validateAcceptanceCoverageReport(candidate))
    .toThrow('undeclared Acceptance ID');
});

test('Acceptance Coverage authority rejects forged uncovered projection', () => {
  const candidate = structuredClone(canonicalCoverage()) as any;
  candidate.blocks[0].uncovered = true;
  candidate.uncoveredBlocks = ['auth/basic-session'];

  expect(() => validateAcceptanceCoverageReport(candidate))
    .toThrow('.uncovered differs');
});

test('Acceptance Coverage authority rejects uncovered list that differs from entries', () => {
  const candidate = structuredClone(canonicalCoverage()) as any;
  candidate.uncoveredBlocks = ['auth/basic-session'];

  expect(() => validateAcceptanceCoverageReport(candidate))
    .toThrow('differ from coverage entries');
});

test('Acceptance Coverage authority rejects duplicate or noncanonical Acceptance identities', () => {
  const duplicate = structuredClone(canonicalCoverage()) as any;
  duplicate.acceptancePassed = ['acceptance_login', 'acceptance_login'];
  expect(() => validateAcceptanceCoverageReport(duplicate))
    .toThrow('unique and canonically ordered');

  const noncanonical = structuredClone(canonicalCoverage()) as any;
  noncanonical.acceptancePassed = ['Acceptance Login'];
  expect(() => validateAcceptanceCoverageReport(noncanonical))
    .toThrow('canonical Acceptance IDs');
});

test('Acceptance Coverage authority rejects noncanonical block and slot ordering', () => {
  const blockOrder = structuredClone(canonicalCoverage()) as any;
  blockOrder.blocks = [
    {
      id: 'billing/basic-plan',
      declaredAcceptance: ['acceptance_login'],
      coveredBy: ['acceptance_login'],
      uncovered: false
    },
    ...blockOrder.blocks
  ];
  expect(() => validateAcceptanceCoverageReport(blockOrder))
    .toThrow('blocks must be canonically ordered');

  const slotOrder = structuredClone(canonicalCoverage()) as any;
  slotOrder.slots = [
    {
      id: 'token_adapter',
      declaredAcceptance: ['acceptance_login'],
      coveredBy: ['acceptance_login'],
      uncovered: false
    },
    ...slotOrder.slots
  ];
  expect(() => validateAcceptanceCoverageReport(slotOrder))
    .toThrow('slots must be canonically ordered');
});
