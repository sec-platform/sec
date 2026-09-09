import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  parseDocumentationAuthorityRegistry,
  type DocumentationAuthorityRecord
} from '../../src/control/documentation/authority.ts';

function record(id: string, projects: string[] = []): DocumentationAuthorityRecord {
  return { id, path: `docs/${id}.md`, kind: 'authority', domain: id, lifecycle: 'stable',
    dynamicPolicy: 'forbidden', owns: [`${id}.rule`], projects };
}
function generated(id: string, from: string, projects: string[] = []): DocumentationAuthorityRecord {
  return { ...record(id, projects), kind: 'navigation', owns: [], generatedFrom: `docs/${from}.md` };
}
function proposal(id: string, target: string, projects: string[] = []): DocumentationAuthorityRecord {
  return { ...record(id, projects), kind: 'proposal', lifecycle: 'draft', owns: [],
    proposal: { disposition: 'adopt', canonicalTargets: [target], activationTrigger: 'approved',
      retirementTarget: `docs/archive/${id}.md`, evidenceRequirement: 'reviewed', reversalCondition: null } };
}
const parse = (documents: readonly DocumentationAuthorityRecord[]) =>
  parseDocumentationAuthorityRegistry(JSON.stringify({ documents }));
const exactCycle = (chain: string) => (error: unknown) =>
  error instanceof Error && error.message === `Documentation dependency cycle: ${chain}.`;

// All cases exercise the real registry decoder, closure rules and graph walk.
// Expected graphs and cycle paths are declared independently of the traversal.
test('a deep valid registry does not depend on the JavaScript call-stack ceiling', () => {
  const id = (i: number) => `d${String(i).padStart(5, '0')}`;
  const documents = Array.from({ length: 8000 }, (_, i) => record(id(i), i < 7999 ? [id(i + 1)] : []));
  assert.deepEqual(parse(documents).documents, documents);
});

test('a deep cycle returns the domain diagnostic, not a native stack-overflow exception', () => {
  const id = (i: number) => `d${String(i).padStart(5, '0')}`;
  const documents = Array.from({ length: 8000 }, (_, i) => record(id(i), [id(i < 7999 ? i + 1 : 7998)]));
  assert.throws(() => parse(documents), error => error instanceof Error && !(error instanceof RangeError)
    && error.message.startsWith('Documentation dependency cycle: d00000 -> d00001 -> ')
    && error.message.endsWith('d07998 -> d07999 -> d07998.'));
});

test('shared descendants and disconnected roots remain valid and preserve declaration order', () => {
  const documents = [record('a', ['b', 'c']), record('b', ['d']), record('c', ['d']), record('d'), record('other')];
  assert.deepEqual(parse(documents).documents, documents);
  assert.deepEqual(parse([...documents].reverse()).documents, [...documents].reverse());
});

test('first-cycle reporting preserves depth-first project order and its entire prefix', () => {
  const documents = [record('a', ['b', 'c']), record('b', ['d']), record('c', ['a']), record('d', ['b'])];
  assert.throws(() => parse(documents), exactCycle('a -> b -> d -> b'));
});

test('generation dependencies participate in the same cycle detection', () => {
  assert.throws(() => parse([record('owner', ['view']), generated('view', 'owner')]),
    exactCycle('owner -> view -> owner'));
  const valid = [record('owner'), generated('view', 'owner')];
  assert.deepEqual(parse(valid).documents, valid);
});

test('proposal canonical targets participate without becoming independent owning records', () => {
  assert.throws(() => parse([record('owner', ['plan']), proposal('plan', 'owner')]),
    exactCycle('owner -> plan -> owner'));
  const valid = [record('owner'), proposal('plan', 'owner')];
  assert.deepEqual(parse(valid).documents, valid);
});

test('project edges are traversed before a later generated-from edge', () => {
  const documents = [record('a', ['view']), generated('view', 'a', ['branch']), record('branch', ['view'])];
  assert.throws(() => parse(documents), exactCycle('a -> view -> branch -> view'));
});

test('a shared target reached through distinct dependency kinds is not a cycle', () => {
  const documents = [generated('view', 'owner', ['owner']), proposal('plan', 'owner', ['owner']), record('owner')];
  assert.deepEqual(parse(documents).documents, documents);
});

test('all closure checks still precede graph-cycle analysis', () => {
  const cyclic = [record('a', ['b']), record('b', ['a'])];
  assert.throws(() => parse([...cyclic, record('other', ['missing'])]), /projects unknown document missing/);
  assert.throws(() => parse([...cyclic, generated('view', 'missing')]), /generated from unregistered path/);
  assert.throws(() => parse([...cyclic, record('a')]), /Duplicate document id a/);
});

test('identity, ownership and retirement collisions retain their rejection paths', () => {
  assert.throws(() => parse([record('a'), { ...record('b'), path: 'docs/a.md' }]), /Duplicate document path/);
  assert.throws(() => parse([record('a'), { ...record('b'), owns: ['a.rule'] }]), /Canonical ownership.*duplicated/);
  const p = proposal('plan', 'a');
  assert.throws(() => parse([record('a'), p, { ...record('occupied'), path: p.proposal!.retirementTarget }]), /is occupied/);
});

test('one parse never leaves visiting or lookup state in the next parse', () => {
  assert.throws(() => parse([record('a', ['b']), record('b', ['a'])]), /dependency cycle/);
  const next = [record('a', ['b']), record('b')];
  assert.deepEqual(parse(next).documents, next);
  assert.throws(() => parse([record('a', ['b']), record('b', ['a'])]), exactCycle('a -> b -> a'));
});

test('returned registry mutability and independent later parses are unchanged', () => {
  const input = [record('a'), record('b')], first = parse(input);
  (first.documents as DocumentationAuthorityRecord[]).reverse();
  assert.deepEqual(parse(input).documents, input);
  assert.deepEqual(first.documents, [input[1], input[0]]);
});
