import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { SUPPORTED_STACK, type PlanFile } from '../../src/compiler/contract.ts';
import { AppModeSchema, PackageManagerSchema, PlanAppSchema, PlanRegistrySourceSchema } from '../../src/compiler/contract/plan-schema.ts';
import { normalizePlan, validatePlan } from '../../src/compiler/parse/load-plan.ts';
import { REGISTRY_KINDS, REGISTRY_LOCATIONS } from '../../src/contracts/registry-source.ts';

const input = () => ({ app: { id: 'app', name: 'Application', stack: SUPPORTED_STACK } });
const normalize = (value: unknown) => normalizePlan(value as PlanFile);
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

test('normalization keeps default location/package/mode decisions and independent output', () => {
  const source = input(), value = normalize(source);
  validatePlan(value);
  assert.deepEqual(value.app, { ...source.app, packageManager: 'pnpm', mode: 'single-tenant' });
  assert.deepEqual(value.blocks, []); assert.deepEqual(value.acceptance, []);
  assert.equal(value.registry.sources.length, 2);
  value.app.name = 'Changed'; assert.equal(source.app.name, 'Application');
});

test('explicit empty registries stay empty rather than acquiring default providers', () => {
  const plan = normalize({ ...input(), registry: { sources: [] } });
  assert.deepEqual(plan.registry.sources, []); validatePlan(plan);
});

test('null scalar defaults remain distinct from null containers', () => {
  const plan = normalize({ app: { ...input().app, packageManager: null, mode: null },
    registry: { sources: [{ id: 'custom', kind: null, location: null, path: null }] } });
  assert.equal(plan.app.packageManager, 'pnpm'); assert.equal(plan.app.mode, 'single-tenant');
  assert.equal(plan.registry.sources[0]?.kind, 'private'); assert.equal(plan.registry.sources[0]?.location, 'workspace');
  for (const invalid of [{ app: null }, { registry: null }, { registry: { sources: null } }, { blocks: null }, { acceptance: null }]) {
    assert.throws(() => normalize({ ...input(), ...invalid }));
  }
});

test('one structural source defines accepted package/mode and registry values', () => {
  for (const packageManager of PackageManagerSchema.options) for (const mode of AppModeSchema.options) {
    const plan = normalize({ app: { ...input().app, packageManager, mode } });
    assert.deepEqual(PlanAppSchema.parse(plan.app), plan.app); validatePlan(plan);
  }
  for (const kind of REGISTRY_KINDS) for (const location of REGISTRY_LOCATIONS) {
    assert.equal(PlanRegistrySourceSchema.safeParse({ id: 'registry', kind, location, path: 'registry' }).success, true);
  }
});

for (const value of [false, 7, {}, []]) {
  test(`non-string app identity ${JSON.stringify(value)} is a typed plan rejection`, () => {
    assert.throws(() => normalize({ app: { ...input().app, id: value } }), code('PLAN-VALIDATION-022'));
    const plan = normalize(input()); (plan.app as unknown as { id: unknown }).id = value;
    assert.throws(() => validatePlan(plan), code('PLAN-VALIDATION-014'));
  });
}

test('unsupported package/mode retain their existing diagnostic families', () => {
  assert.throws(() => normalize({ app: { ...input().app, packageManager: 'other' } }), code('PLAN-VALIDATION-015'));
  assert.throws(() => normalize({ app: { ...input().app, mode: 'other' } }), code('PLAN-VALIDATION-016'));
});

test('strict root and existing nested metadata projection are not silently conflated', () => {
  assert.throws(() => normalize({ ...input(), foreignRoot: true }), code('PLAN-VALIDATION-022'));
  const plan = normalize({ app: { ...input().app, titleHint: 'ignored' }, blocks: [{ id: 'block/a', custom: { hint: true } }] });
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
});

test('uncloneable caller data remains refused, including ignored metadata', () => {
  assert.throws(() => normalize({ app: { ...input().app, unused() {} } }));
});
