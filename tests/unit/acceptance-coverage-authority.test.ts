import { expect, test } from 'bun:test';

import { validateAcceptanceCoverageReportV1 } from '../../platform/shared/acceptance-coverage-authority.ts';

function canonicalCoverage() {
  return {
    formatVersion: '1',
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

test('Acceptance Coverage authority accepts canonical derived coverage', () => {
  const coverage = validateAcceptanceCoverageReportV1(canonicalCoverage());

  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toEqual([]);
  expect(Object.isFrozen(coverage)).toBe(true);
});

test('Acceptance Coverage authority rejects covered acceptance not declared by target', () => {
  const candidate = structuredClone(canonicalCoverage()) as any;
  candidate.blocks[0].coveredBy = ['acceptance_other'];

  expect(() => validateAcceptanceCoverageReportV1(candidate))
    .toThrow('undeclared Acceptance ID');
});

test('Acceptance Coverage authority rejects forged uncovered projection', () => {
  const candidate = structuredClone(canonicalCoverage()) as any;
  candidate.blocks[0].uncovered = true;
  candidate.uncoveredBlocks = ['auth/basic-session'];

  expect(() => validateAcceptanceCoverageReportV1(candidate))
    .toThrow('.uncovered differs');
});

test('Acceptance Coverage authority rejects uncovered list that differs from entries', () => {
  const candidate = structuredClone(canonicalCoverage()) as any;
  candidate.uncoveredBlocks = ['auth/basic-session'];

  expect(() => validateAcceptanceCoverageReportV1(candidate))
    .toThrow('differ from coverage entries');
});

test('Acceptance Coverage authority rejects duplicate or noncanonical Acceptance identities', () => {
  const duplicate = structuredClone(canonicalCoverage()) as any;
  duplicate.acceptancePassed = ['acceptance_login', 'acceptance_login'];
  expect(() => validateAcceptanceCoverageReportV1(duplicate))
    .toThrow('unique and canonically ordered');

  const noncanonical = structuredClone(canonicalCoverage()) as any;
  noncanonical.acceptancePassed = ['Acceptance Login'];
  expect(() => validateAcceptanceCoverageReportV1(noncanonical))
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
  expect(() => validateAcceptanceCoverageReportV1(blockOrder))
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
  expect(() => validateAcceptanceCoverageReportV1(slotOrder))
    .toThrow('slots must be canonically ordered');
});
