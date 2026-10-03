import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlInputLimitError, YamlSyntaxError } from '../../src/adapters/formats/yaml.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { loadPolicyDeclarations, POLICY_YAML_MAX_INPUT_BYTES } from '../../src/adapters/workspace/sources/load-policy-declarations.ts';
import { buildLoadedPolicyScope, mergeLoadedPolicyDeclarations } from '../../src/semantics/policies/declarations.ts';
import { POLICY_RULE_IDS } from '../../src/semantics/policies/rules.ts';
import type { PolicyRule, PolicySourceScope } from '../../src/semantics/policies/types.ts';

// Keep actual YAML/Zod, physical source inventory and retained readers in native
// runs. Do not mark these passed using a JSON or schema substitute. The bundled
// official policy root is only read; each fixture owns its project policy root.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-policy-yaml-'));
  const policies = getWorkspacePaths(root).policiesRoot;
  mkdirSync(policies, { recursive: true });
  const write = (name: string, source: string | Uint8Array) => writeFileSync(path.join(policies, name), source);
  return { root, write, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}
const row = () => ({ id: 'policy-reuse-fixture', severity: 'warn' as const, appliesTo: ['block/a'], rule: POLICY_RULE_IDS[0] });

test('policy merge rejects differing values across every source scope and input permutation', () => {
  const original: PolicyRule = { ...row(), severity: 'blocker' };
  for (const changed of [{ ...original, severity: 'info' as const }, { ...original, appliesTo: ['block/b'] }]) {
    for (const scopes of [['official', 'official'], ['project', 'project'], ['official', 'project']] as const) {
      const sources = scopes.map((scope, index) => ({ scope,
        sourcePath: `${scope === 'official' ? 'catalog/policies/official' : 'model/policies'}/${index}.yaml`,
        spec: { policies: [index === 0 ? original : changed] } }));
      for (const ordered of [sources, [...sources].reverse()]) {
        const scope = (name: PolicySourceScope) => buildLoadedPolicyScope(name, ordered.filter(source => source.scope === name));
        assert.throws(() => mergeLoadedPolicyDeclarations(scope('official'), scope('project')), /Conflicting policy declarations/);
      }
    }
  }
});

test('policy merge coalesces equal sources and preserves distinct IDs and deterministic attribution', () => {
  const official = [
    { sourcePath: 'catalog/policies/official/a.yaml', spec: { policies: [row()] } },
    { sourcePath: 'catalog/policies/official/z.yaml', spec: { policies: [row()] } }
  ];
  const project = [
    { sourcePath: 'model/policies/a.yaml', spec: { policies: [row(), { ...row(), id: 'another-policy' }] } },
    { sourcePath: 'model/policies/z.yaml', spec: { policies: [row()] } }
  ];
  const merge = (reversed: boolean) => mergeLoadedPolicyDeclarations(
    buildLoadedPolicyScope('official', reversed ? [...official].reverse() : official),
    buildLoadedPolicyScope('project', reversed ? [...project].reverse() : project)
  );
  const result = merge(false);
  assert.deepEqual(result, merge(true));
  assert.deepEqual(result.policyIds, ['another-policy', row().id]);
  assert.deepEqual(result.policies, [{ ...row(), id: 'another-policy' }, row()]);
  assert.equal(result.definitions.get(row().id)?.sourcePath, 'model/policies/z.yaml');
  assert.equal(result.official.sources.length, 2); assert.equal(result.project.sources.length, 2);
  assert.deepEqual(official[0]!.spec.policies, [row()]);
});

for (const source of [
  'policies: []\npolicies: []\n',
  'policies: !unknown []\n',
  'policies: []\n---\npolicies: []\n',
  '? [policies]\n: []\n'
]) {
  test(`policy source uses the shared strict YAML rejection: ${JSON.stringify(source)}`, () => {
    const f = fixture();
    try {
      f.write('fixture.yaml', source);
      assert.throws(() => loadPolicyDeclarations(f.root), error =>
        error instanceof Error && error.cause instanceof YamlSyntaxError);
    } finally { f.cleanup(); }
  });
}

test('project declarations retain the existing report shape and coalesce equal duplicates', () => {
  const f = fixture();
  try {
    f.write('fixture.yaml', JSON.stringify({ policies: [row(), row()] }));
    const result = loadPolicyDeclarations(f.root);
    assert.deepEqual(result.project.policies, [row().id]);
    assert.equal(result.project.definitions.length, 1);
    assert.equal(result.project.sources.length, 1);
    assert.deepEqual(result.project.sources[0]!.policyIds, [row().id]);
    assert.deepEqual(result.definitions.get(row().id)?.policy, row());
    assert.equal(result.definitions.get(row().id)?.sourceScope, 'project');
  } finally { f.cleanup(); }
});

test('project source order cannot authorize different values for the same policy ID', () => {
  const f = fixture();
  try {
    f.write('a.yaml', JSON.stringify({ policies: [row()] }));
    f.write('z.yml', JSON.stringify({ policies: [{ ...row(), severity: 'error' }] }));
    assert.throws(() => loadPolicyDeclarations(f.root), error => error instanceof Error
      && /Conflicting policy declarations/.test(error.message)
      && error.message.includes('model/policies/a.yaml') && error.message.includes('model/policies/z.yml'));
  } finally { f.cleanup(); }
});

test('a higher precedence source cannot hide invalid lower precedence declarations', () => {
  const f = fixture();
  try {
    f.write('a.yaml', JSON.stringify({ policies: [{ ...row(), severity: 'invalid' }] }));
    f.write('z.yaml', JSON.stringify({ policies: [row()] }));
    assert.throws(() => loadPolicyDeclarations(f.root), error =>
      error instanceof Error && /exact schema/.test(error.message) && error.cause !== undefined);
  } finally { f.cleanup(); }
});

test('declared aliases retain normal YAML meaning and no consumer gains semantic assurance from parsing', () => {
  const f = fixture();
  try {
    f.write('fixture.yaml', `policies:\n  - &p\n    id: policy-reuse-fixture\n    severity: warn\n    appliesTo: [block/a]\n    rule: ${POLICY_RULE_IDS[0]}\n  - *p\n`);
    const result = loadPolicyDeclarations(f.root);
    assert.deepEqual(result.project.definitions.map(value => value.policy), [row()]);
    assert.equal('evaluation' in result, false);
  } finally { f.cleanup(); }
});

test('per-source parsing budget rejects oversized text without changing inventory capacity', () => {
  const f = fixture();
  try {
    f.write('fixture.yaml', ' '.repeat(POLICY_YAML_MAX_INPUT_BYTES + 1));
    assert.throws(() => loadPolicyDeclarations(f.root), error =>
      error instanceof Error && error.cause instanceof YamlInputLimitError);
  } finally { f.cleanup(); }
});

test('invalid byte encoding remains a retained decoding failure rather than an empty policy set', () => {
  const f = fixture();
  try {
    f.write('fixture.yaml', Uint8Array.of(0xff));
    assert.throws(() => loadPolicyDeclarations(f.root));
  } finally { f.cleanup(); }
});

test('each invocation returns independent policy arrays after removing redundant field copies', () => {
  const f = fixture();
  try {
    f.write('fixture.yaml', JSON.stringify({ policies: [row()] }));
    const first = loadPolicyDeclarations(f.root), second = loadPolicyDeclarations(f.root);
    first.project.definitions[0]!.policy.appliesTo.push('block/b');
    assert.deepEqual(second.project.definitions[0]!.policy.appliesTo, ['block/a']);
    assert.deepEqual(loadPolicyDeclarations(f.root).project.definitions[0]!.policy.appliesTo, ['block/a']);
  } finally { f.cleanup(); }
});
