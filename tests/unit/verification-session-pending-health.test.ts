import { expect, test } from 'bun:test';

import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import {
  assertVerificationSessionLocalPreparationCurrent,
  assertVerificationSessionLocalPreparationInputsCurrent,
  createVerificationSessionLocalPreparationRequest,
  createVerificationSessionPendingHealthLocalPreparationRequest,
  parseVerificationSessionHostedRequest,
  parseVerificationSessionLocalPreparationRequest
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';

const D = (n: string) => `sha256:${n.repeat(64)}` as const;
const PINS = Object.freeze({
  prNumber: 123, expectedBaseSha: '1'.repeat(40), expectedBaseTreeSha: '2'.repeat(40),
  expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
  manifestPath: 'work-packages/local.json', manifestDigest: D('1'), profile: 'quick',
  expectedScopeProposalDigest: D('2'), expectedActionPlanDigest: D('3'),
  expectedSessionProposalDigest: D('4'), reviewPolicyDigest: D('5')
});
const PENDING = createVerificationSessionPendingHealthLocalPreparationRequest(PINS);
const { expectedSessionProposalDigest: PROPOSAL, ...COMMON_PINS } = PINS;
const BOUND: VerificationSessionHostedRequest = Object.freeze({
  ...COMMON_PINS, schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
  expectedSessionRevision: D('6'), requestOperationId: D('7')
});
const LEGACY = createVerificationSessionLocalPreparationRequest(BOUND);

// The public persisted protocol is the oracle: a pending plan has no Session,
// operation or health proof; strict old requests retain all their original pins.
test('pending MainHealth preparation persists only the exact unbound plan', () => {
  expect(JSON.parse(JSON.stringify(PENDING))).toEqual({
    schema: 'sec-verification-session-local-preparation-v2', executionPlacement: 'local',
    authorityStage: 'preparation-only', healthBinding: 'pending-main-health', request: PINS
  });
  expect(parseVerificationSessionLocalPreparationRequest(JSON.stringify(PENDING))).toEqual(PENDING);
  expect(Object.isFrozen(PENDING.request)).toBe(true);
  expect(() => parseVerificationSessionHostedRequest(JSON.stringify(PENDING)))
    .toThrow('cannot be consumed by a hosted operation');
});

test('pending and bound envelope discriminants cannot downgrade or grant authority', () => {
  for (const invalid of [
    { ...PENDING, schema: LEGACY.schema }, { ...LEGACY, schema: PENDING.schema },
    { ...PENDING, executionPlacement: 'hosted' }, { ...PENDING, authorityStage: 'verification' },
    { ...PENDING, healthBinding: 'healthy' }, { ...PENDING, ledger: {} },
    { ...PENDING, request: BOUND }, { ...PENDING, request: null },
    { ...PENDING, request: { ...PINS, expectedSessionRevision: D('6') } },
    { ...PENDING, request: { ...PINS, requestOperationId: D('7') } },
    { ...PENDING, request: { ...PINS, expectedHeadSha: 'not-a-sha' } },
    { ...PENDING, request: { ...PINS, expectedSessionProposalDigest: 'not-a-digest' } },
    { ...PENDING, request: { ...PINS, prNumber: 0 } }
  ]) expect(() => parseVerificationSessionLocalPreparationRequest(JSON.stringify(invalid))).toThrow();
  for (const key of Object.keys(PINS)) {
    const missing = { ...PINS } as Record<string, unknown>;
    delete missing[key];
    expect(() => parseVerificationSessionLocalPreparationRequest(JSON.stringify({ ...PENDING, request: missing })))
      .toThrow();
  }
});

test('every pending plan pin is checked both before health and at real Session binding', () => {
  expect(() => assertVerificationSessionLocalPreparationInputsCurrent(PENDING, PENDING)).not.toThrow();
  expect(() => assertVerificationSessionLocalPreparationCurrent(PENDING, BOUND, PROPOSAL)).not.toThrow();
  expect(() => assertVerificationSessionLocalPreparationCurrent(PENDING, BOUND))
    .toThrow('requires the current original Session proposal digest');
  for (const key of Object.keys(PINS) as (keyof typeof PINS)[]) {
    const value = PINS[key];
    const changed = typeof value === 'number' ? value + 1
      : value.startsWith('sha256:') ? D('f')
      : /^[0-9a-f]{40}$/u.test(value) ? 'f'.repeat(40) : `${value}-changed`;
    const saved = createVerificationSessionPendingHealthLocalPreparationRequest({ ...PINS, [key]: changed });
    expect(() => assertVerificationSessionLocalPreparationInputsCurrent(saved, PENDING))
      .toThrow('differs from current exact candidate, Session or Action environment');
    expect(() => assertVerificationSessionLocalPreparationCurrent(saved, BOUND, PROPOSAL))
      .toThrow('differs from current exact candidate, Session or Action environment');
  }
});

test('legacy plans retain full Session and operation checks after common preflight pins', () => {
  expect(parseVerificationSessionLocalPreparationRequest(JSON.stringify(LEGACY))).toEqual(LEGACY);
  expect(() => assertVerificationSessionLocalPreparationInputsCurrent(LEGACY, PENDING)).not.toThrow();
  expect(() => assertVerificationSessionLocalPreparationCurrent(LEGACY, BOUND)).not.toThrow();
  for (const key of Object.keys(BOUND) as (keyof VerificationSessionHostedRequest)[]) {
    if (key === 'schema') continue;
    const value = BOUND[key];
    const changed = typeof value === 'number' ? value + 1
      : value.startsWith('sha256:') ? D('f')
      : /^[0-9a-f]{40}$/u.test(value) ? 'f'.repeat(40) : `${value}-changed`;
    const saved = createVerificationSessionLocalPreparationRequest({ ...BOUND, [key]: changed });
    if (key === 'expectedSessionRevision' || key === 'requestOperationId') {
      expect(() => assertVerificationSessionLocalPreparationInputsCurrent(saved, PENDING)).not.toThrow();
    } else {
      expect(() => assertVerificationSessionLocalPreparationInputsCurrent(saved, PENDING)).toThrow();
    }
    expect(() => assertVerificationSessionLocalPreparationCurrent(saved, BOUND, PROPOSAL)).toThrow();
  }
});
