import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { loadPolicyDeclarations, POLICY_YAML_MAX_INPUT_BYTES } from '../../src/compiler/parse/load-policy-declarations.ts';
import { POLICY_RULE_IDS } from '../../src/compiler/policies/contract/rules.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';
import { YamlSyntaxError, YamlInputLimitError } from '../../src/system-architecture/foundation/runtime/yaml.ts';

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
const row = () => ({ id: 'policy-reuse-fixture', severity: 'warn', appliesTo: ['block/a'], rule: POLICY_RULE_IDS[0] });

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

test('project source precedence remains lexical and every source is still reported', () => {
  const f = fixture();
  try {
    f.write('a.yaml', JSON.stringify({ policies: [row()] }));
    f.write('z.yml', JSON.stringify({ policies: [{ ...row(), severity: 'error' }] }));
    const result = loadPolicyDeclarations(f.root);
    assert.equal(result.definitions.get(row().id)?.policy.severity, 'error');
    assert.equal(result.project.definitions.length, 2);
    assert.equal(result.project.sources.length, 2);
    assert.deepEqual(result.project.policies, [row().id]);
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
