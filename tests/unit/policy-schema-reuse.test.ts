import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { buildLoadedPolicyScope, mergeLoadedPolicyDeclarations } from '../../src/semantics/policies/declarations.ts';
import { POLICY_RULE_IDS } from '../../src/semantics/policies/rules.ts';
import { PolicyRuleSchema, PolicySeveritySchema, PolicySpecSchema } from '../../src/semantics/policies/source-schema.ts';
import type { PolicyRule, PolicySeverity, PolicySpec } from '../../src/semantics/policies/types.ts';

const policy = () => ({ id: 'policy-reuse', severity: 'warn' as const,
  appliesTo: ['block/a', 'block/b'], rule: POLICY_RULE_IDS[0] });

test('schema output keeps the public rule and spec types without a second shape', () => {
  const rule: PolicyRule = PolicyRuleSchema.parse(policy());
  const spec: PolicySpec = PolicySpecSchema.parse({ policies: [rule] });
  const severity: PolicySeverity = PolicySeveritySchema.parse('warn');
  assert.deepEqual(rule, policy()); assert.deepEqual(spec, { policies: [policy()] });
  assert.equal(severity, 'warn');
});

test('all existing severities and rule identities remain accepted', () => {
  for (const severity of ['info', 'warn', 'error', 'blocker']) for (const rule of POLICY_RULE_IDS) {
    assert.equal(PolicyRuleSchema.safeParse({ ...policy(), severity, rule }).success, true);
  }
});

for (const fields of [
  { id: '' }, { id: 'Upper' }, { id: 'with space' }, { severity: 'fatal' },
  { rule: 'not-a-rule' }, { appliesTo: [] }, { appliesTo: ['Upper/Block'] },
  { appliesTo: ['block/b', 'block/a'] }, { appliesTo: ['block/a', 'block/a'] },
  { appliesTo: [1] }, { unknownField: true }
]) {
  test(`original policy declaration constraints remain strict: ${JSON.stringify(fields)}`, () => {
    assert.equal(PolicyRuleSchema.safeParse({ ...policy(), ...fields }).success, false);
  });
}

test('canonical-equal duplicate declarations remain legal inputs, not conflicts', () => {
  const repeated = policy();
  const input = { policies: [repeated, structuredClone(repeated)] };
  const decoded = PolicySpecSchema.parse(input);
  assert.equal(decoded.policies.length, 2);
  assert.deepEqual(decoded, input);
});

test('one source cannot choose between conflicting duplicates by encounter order', () => {
  const first = policy(), changed = { ...policy(), severity: 'error' };
  for (const policies of [[first, changed], [changed, first]]) {
    const result = PolicySpecSchema.safeParse({ policies });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error.issues[0]!.message, /Conflicting duplicate/);
  }
});

test('schema parsing owns output arrays while leaving caller declarations unchanged', () => {
  const source = { policies: [policy()] };
  const first = PolicySpecSchema.parse(source), second = PolicySpecSchema.parse(source);
  first.policies[0]!.appliesTo.pop();
  assert.deepEqual(source.policies[0]!.appliesTo, ['block/a', 'block/b']);
  assert.deepEqual(second.policies[0]!.appliesTo, ['block/a', 'block/b']);
  assert.notEqual(first.policies[0], source.policies[0]);
});

test('empty declared policy set stays legal but omitted or null containers are not invented', () => {
  assert.deepEqual(PolicySpecSchema.parse({ policies: [] }), { policies: [] });
  for (const input of [{}, null, [], { policies: null }, { policies: [], authority: true }]) {
    assert.equal(PolicySpecSchema.safeParse(input).success, false);
  }
});

test('equal cross-scope policies preserve every source and project attribution', () => {
  const official = buildLoadedPolicyScope('official', [{ sourcePath: 'official.yaml', spec: { policies: [policy()] } }]);
  const project = buildLoadedPolicyScope('project', [{ sourcePath: 'project.yaml', spec: { policies: [policy()] } }]);
  const result = mergeLoadedPolicyDeclarations(official, project);
  assert.deepEqual(result.policies, [policy()]);
  assert.equal(result.definitions.get(policy().id)?.sourceScope, 'project');
  assert.deepEqual(result.official.sources, [{ path: 'official.yaml', policyIds: [policy().id] }]);
  assert.deepEqual(result.project.sources, [{ path: 'project.yaml', policyIds: [policy().id] }]);
});

for (const change of [{ severity: 'info' as const }, { appliesTo: ['block/a'] }]) {
  test(`source precedence cannot weaken the same policy: ${JSON.stringify(change)}`, () => {
    const original = policy(), changed = { ...policy(), ...change };
    for (const [first, second] of [[original, changed], [changed, original]]) {
      const official = buildLoadedPolicyScope('official', [{ sourcePath: 'official.yaml', spec: { policies: [first!] } }]);
      const project = buildLoadedPolicyScope('project', [{ sourcePath: 'project.yaml', spec: { policies: [second!] } }]);
      assert.throws(() => mergeLoadedPolicyDeclarations(official, project), /Conflicting policy declarations/);
    }
  });
}

test('different policy identities still coexist with independent scopes', () => {
  const official = buildLoadedPolicyScope('official', [{ sourcePath: 'official.yaml', spec: { policies: [policy()] } }]);
  const different = { ...policy(), id: 'another-policy', severity: 'error' as const };
  const project = buildLoadedPolicyScope('project', [{ sourcePath: 'project.yaml', spec: { policies: [different] } }]);
  assert.deepEqual(mergeLoadedPolicyDeclarations(official, project).policyIds, ['another-policy', 'policy-reuse']);
});
