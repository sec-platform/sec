import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { SUPPORTED_STACK } from '../../../src/compiler/contract.ts';
import { normalizePlan, validatePlan } from '../../../src/compiler/contract/plan-validation.ts';
const PLAN_NORMALIZATION_DEFAULTS = Object.freeze({
  officialPath: 'catalog/registry/official',
  privatePath: 'model/blocks/private'
});

const input = () => ({ app: { id: 'app', name: 'Application', stack: SUPPORTED_STACK } });
const normalize = (value: unknown) => normalizePlan(value, PLAN_NORMALIZATION_DEFAULTS);
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('normalization preserves scalar defaults, raw admission and independent output without inventing identity', () => {
  const source = input(), value = normalize(source);
  validatePlan(value);
  assert.deepEqual(value.app, { ...source.app, packageManager: 'pnpm', mode: 'single-tenant' });
  assert.deepEqual(value.blocks, []); assert.deepEqual(value.acceptance, []);
  assert.deepEqual(value.registry.sources, [
    { id: 'official', kind: 'official', location: 'compiler', path: PLAN_NORMALIZATION_DEFAULTS.officialPath },
    { id: 'private', kind: 'private', location: 'workspace', path: PLAN_NORMALIZATION_DEFAULTS.privatePath }
  ]);
  value.app.name = 'Changed'; assert.equal(source.app.name, 'Application');

  const missingIdentity = normalize({
    app: { name: 'legacy-name-only', stack: 'typescript-library', packageManager: 'pnpm', mode: 'single-tenant' },
    registry: { sources: [] }, blocks: [], acceptance: []
  });
  assert.throws(() => validatePlan(missingIdentity), error =>
    error instanceof CodedFailure && error.code === 'PLAN-VALIDATION-014');

  for (const id of [false, 7, {}, []]) {
    assert.throws(() => normalize({ app: { ...input().app, id } }), code('PLAN-VALIDATION-022'));
  }
  // Omitted and null scalar defaults share this owner; null containers do not.
  const plan = normalize({ app: { ...input().app, packageManager: null, mode: null },
    registry: { sources: [{ id: 'custom', kind: null, location: null, path: null }] } });
  assert.equal(plan.app.packageManager, 'pnpm'); assert.equal(plan.app.mode, 'single-tenant');
  assert.equal(plan.registry.sources[0]?.kind, 'private'); assert.equal(plan.registry.sources[0]?.location, 'workspace');
  for (const invalid of [{ app: null }, { registry: null }, { registry: { sources: null } }, { registry: { sources: [null] } }, { blocks: null }, { acceptance: null }]) {
    assert.throws(() => normalize({ ...input(), ...invalid }));
  }
});

test('unsupported package/mode retain their existing diagnostic families', () => {
  assert.throws(() => normalize({ app: { ...input().app, packageManager: 'other' } }), code('PLAN-VALIDATION-015'));
  assert.throws(() => normalize({ app: { ...input().app, mode: 'other' } }), code('PLAN-VALIDATION-016'));
});

test('strict root and existing nested metadata projection are not silently conflated', () => {
  assert.throws(() => normalize({ ...input(), foreignRoot: true }), code('PLAN-VALIDATION-022'));
  const plan = normalize({ app: { ...input().app, titleHint: 'ignored' }, registry: { sources: [] },
    blocks: [{ id: 'block/a', custom: { hint: true } }] });
  assert.deepEqual(plan.registry.sources, []);
  assert.equal('titleHint' in plan.app, false);
  assert.deepEqual((plan.blocks[0] as unknown as { custom: unknown }).custom, { hint: true });
  validatePlan(plan);
});

test('schema validity does not replace path, source permission or uniqueness rules', () => {
  const values = [
    [{ id: 'a', kind: 'private', location: 'compiler', path: 'registry' }],
    [{ id: 'a', kind: 'private', location: 'workspace', path: '../escape' }],
    [{ id: 'a', kind: 'private', location: 'workspace', path: 'a' }, { id: 'a', kind: 'private', location: 'workspace', path: 'b' }]
  ];
  for (const sources of values) assert.throws(() => validatePlan(normalize({ ...input(), registry: { sources } })));
  assert.throws(() => validatePlan(normalize({ ...input(), blocks: [{ id: 'block/a' }, { id: 'block/a' }] })), code('PLAN-VALIDATION-005'));
  assert.throws(() => validatePlan(normalize({ ...input(), blocks: [{ id: '..\\escape/block' }] })), code('PLAN-VALIDATION-004'));
  assert.throws(() => validatePlan(normalize({ ...input(), blocks: [{ id: 'ticket/basic', version: '../1.0.0' }] })), code('PLAN-VALIDATION-019'));
});
