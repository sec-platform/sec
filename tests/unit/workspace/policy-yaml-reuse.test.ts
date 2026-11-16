import { settleWorkspaceCallbackSync } from '../../testkit/workspace-cleanup.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { YamlInputLimitError, YamlSyntaxError } from '../../../src/adapters/formats/yaml.ts';
import { getWorkspacePaths } from "../../../src/adapters/workspace-context.ts";
import { loadPolicyDeclarations, POLICY_YAML_MAX_INPUT_BYTES } from '../../../src/adapters/workspace/sources/load-policy-declarations.ts';
import { buildLoadedPolicyScope, mergeLoadedPolicyDeclarations } from '../../../src/semantics/policies/declarations.ts';
import { POLICY_RULE_IDS } from '../../../src/semantics/policies/rules.ts';
import type { PolicyRule } from '../../../src/semantics/policies/types.ts';

// Keep actual YAML/Zod, physical source inventory and retained readers in native
// runs. Do not mark these passed using a JSON or schema substitute. The bundled
// official policy root is only read; each fixture owns its project policy root.
function fixture(run: (f: { root: string; write(name: string, source: string | Uint8Array): void }) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-policy-yaml-'));
  settleWorkspaceCallbackSync(() => {
    const policies = getWorkspacePaths(root).policiesRoot;
    mkdirSync(policies, { recursive: true });
    const write = (name: string, source: string | Uint8Array) => writeFileSync(path.join(policies, name), source);
    run({ root, write });
  }, () => rmSync(root, { recursive: true, force: true }));
}
const row = () => ({ id: 'policy-reuse-fixture', severity: 'warn' as const, appliesTo: ['block/a'], rule: POLICY_RULE_IDS[0] });

test('cross-scope policy attribution cannot hide differing canonical values', () => {
  const original: PolicyRule = { ...row(), severity: 'blocker' };
  // Physical project-source conflicts below cover within-scope accumulation.
  // Crossing scopes must reject whole-value differences, not apply precedence.
  for (const changed of [{ ...original, severity: 'info' as const }, { ...original, appliesTo: ['block/b'] }]) {
    for (const [first, second] of [[original, changed], [changed, original]]) {
      const official = buildLoadedPolicyScope('official', [
        { sourcePath: 'catalog/policies/official/a.yaml', spec: { policies: [first!] } }
      ]);
      const project = buildLoadedPolicyScope('project', [
        { sourcePath: 'model/policies/a.yaml', spec: { policies: [second!] } }
      ]);
      assert.throws(() => mergeLoadedPolicyDeclarations(official, project), /Conflicting policy declarations/);
    }
  }
});

test('policy merge coalesces equal sources and preserves distinct IDs and deterministic attribution', () => {
  const official = [
    { sourcePath: 'catalog/policies/official/a.yaml', spec: { policies: [row()] } },
    { sourcePath: 'catalog/policies/official/z.yaml', spec: { policies: [row()] } }
  ];
  const project = [
    { sourcePath: 'model/policies/a.yaml', spec: { policies: [row(), { ...row(), id: 'another-policy', severity: 'error' as const }] } },
    { sourcePath: 'model/policies/z.yaml', spec: { policies: [row()] } }
  ];
  const merge = (reversed: boolean) => mergeLoadedPolicyDeclarations(
    buildLoadedPolicyScope('official', reversed ? [...official].reverse() : official),
    buildLoadedPolicyScope('project', reversed ? [...project].reverse() : project)
  );
  const result = merge(false);
  assert.deepEqual(result, merge(true));
  assert.deepEqual(result.policyIds, ['another-policy', row().id]);
  assert.deepEqual(result.policies, [{ ...row(), id: 'another-policy', severity: 'error' }, row()]);
  assert.equal(result.definitions.get(row().id)?.sourcePath, 'model/policies/z.yaml');
  assert.equal(result.definitions.get(row().id)?.sourceScope, 'project');
  assert.deepEqual(result.official.sources, [
    { path: 'catalog/policies/official/a.yaml', policyIds: [row().id] },
    { path: 'catalog/policies/official/z.yaml', policyIds: [row().id] }
  ]);
  assert.deepEqual(result.project.sources, [
    { path: 'model/policies/a.yaml', policyIds: ['another-policy', row().id] },
    { path: 'model/policies/z.yaml', policyIds: [row().id] }
  ]);
  assert.deepEqual(official[0]!.spec.policies, [row()]);
});

test('aliased project declarations coalesce, isolate callers and retain every source report', () => {
  fixture(f => {
    f.write('a.yaml', `policies:\n  - &p\n    id: policy-reuse-fixture\n    severity: warn\n    appliesTo: [block/a]\n    rule: ${POLICY_RULE_IDS[0]}\n  - *p\n`);
    const first = loadPolicyDeclarations(f.root);
    assert.deepEqual(first.project.policies, [row().id]);
    assert.equal(first.project.definitions.length, 1);
    assert.equal(first.project.sources.length, 1);
    assert.deepEqual(first.project.sources[0]!.policyIds, [row().id]);
    assert.deepEqual(first.definitions.get(row().id)?.policy, row());
    assert.equal(first.definitions.get(row().id)?.sourceScope, 'project');
    assert.deepEqual(first.project.definitions.map(value => value.policy), [row()]);
    assert.equal('evaluation' in first, false);

    const second = loadPolicyDeclarations(f.root);
    first.project.definitions[0]!.policy.appliesTo.push('block/b');
    assert.deepEqual(second.project.definitions[0]!.policy.appliesTo, ['block/a']);
    assert.deepEqual(loadPolicyDeclarations(f.root).project.definitions[0]!.policy.appliesTo, ['block/a']);

    f.write('z.yml', JSON.stringify({ policies: [row()] }));
    const combined = loadPolicyDeclarations(f.root);
    assert.equal(combined.definitions.get(row().id)?.sourcePath, 'model/policies/z.yml');
    assert.equal(combined.project.definitions.length, 2);
    assert.equal(combined.project.sources.length, 2);
    assert.deepEqual(combined.project.policies, [row().id]);
  });
});

test('physical policy loading rejects malformed, conflicting and unbounded sources across successive reads', () => {
  fixture(f => {
    // Each next input overwrites the previous failure before the retained reader
    // runs again. Later checks cannot pass from an earlier YAML or decoding error.
    f.write('a.yaml', '? [policies]\n: []\n');
    assert.throws(() => loadPolicyDeclarations(f.root), error =>
      error instanceof Error && error.cause instanceof YamlSyntaxError);

    f.write('a.yaml', ' '.repeat(POLICY_YAML_MAX_INPUT_BYTES + 1));
    assert.throws(() => loadPolicyDeclarations(f.root), error =>
      error instanceof Error && error.cause instanceof YamlInputLimitError);

    f.write('a.yaml', Uint8Array.of(0xff));
    assert.throws(() => loadPolicyDeclarations(f.root), error =>
      error instanceof Error && /\bUTF-8\b/u.test(error.message)
      && error.message.includes('a.yaml') && error.cause instanceof TypeError);

    for (const [first, second] of [
      [row(), { ...row(), severity: 'error' }],
      [{ ...row(), severity: 'error' }, row()]
    ]) {
      f.write('a.yaml', JSON.stringify({ policies: [first] }));
      f.write('z.yml', JSON.stringify({ policies: [second] }));
      assert.throws(() => loadPolicyDeclarations(f.root), /Conflicting policy declarations/);
    }

    // Both files are valid before the next distinct invalid lower-precedence input.
    f.write('a.yaml', JSON.stringify({ policies: [{ ...row(), severity: 'invalid' }] }));
    f.write('z.yml', JSON.stringify({ policies: [row()] }));
    assert.throws(() => loadPolicyDeclarations(f.root), error =>
      error instanceof Error && /exact schema/.test(error.message) && error.cause !== undefined);
  });
});
