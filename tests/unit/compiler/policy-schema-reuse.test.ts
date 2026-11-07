import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { POLICY_RULE_IDS } from '../../../src/semantics/policies/rules.ts';
import { PolicyRuleSchema, PolicySpecSchema } from '../../../src/semantics/policies/source-schema.ts';
import type { PolicyRule, PolicySeverity } from '../../../src/semantics/policies/types.ts';

const policy = () => ({ id: 'policy-reuse', severity: 'warn' as const,
  appliesTo: ['block/a', 'block/b'], rule: 'tenant_context_must_flow_to_query' as const });

test('decoding preserves every supported severity and rule identity', () => {
  // This is the currently accepted independent semantic policy rule. A
  // dynamically shortened production rule catalog must not vacuously PASS.
  assert.ok(POLICY_RULE_IDS.includes('tenant_context_must_flow_to_query'));
  for (const severity of ['info', 'warn', 'error', 'blocker'] as const) for (const rule of POLICY_RULE_IDS) {
    const input = { ...policy(), severity, rule };
    const decoded: PolicyRule = PolicyRuleSchema.parse(input);
    const decodedSeverity: PolicySeverity = decoded.severity;
    assert.deepEqual(decoded, input);
    assert.equal(decodedSeverity, severity);
  }
});

test('one source cannot choose between conflicting duplicates by encounter order', () => {
  const first = policy(), changed = { ...policy(), severity: 'error' };
  for (const policies of [[first, changed], [changed, first]]) {
    const result = PolicySpecSchema.safeParse({ policies });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error.issues[0]!.message, /Conflicting duplicate/);
  }
});

test('policy fields and containers remain strict while an empty declared set stays legal', () => {
  for (const fields of [
  { id: '' }, { id: 'Upper' }, { id: 'with space' }, { severity: 'fatal' },
  { rule: 'not-a-rule' }, { appliesTo: [] }, { appliesTo: ['Upper/Block'] },
  { appliesTo: ['block/b', 'block/a'] }, { appliesTo: ['block/a', 'block/a'] },
  { appliesTo: [1] }, { unknownField: true }
]) {
    assert.equal(PolicyRuleSchema.safeParse({ ...policy(), ...fields }).success, false);
  }

  assert.deepEqual(PolicySpecSchema.parse({ policies: [] }), { policies: [] });
  for (const input of [{}, null, [], { policies: null }, { policies: [], authority: true }]) {
    assert.equal(PolicySpecSchema.safeParse(input).success, false);
  }
});
