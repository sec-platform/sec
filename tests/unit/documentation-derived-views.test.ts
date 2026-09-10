import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseDocumentationAuthorityRegistry } from '../../src/control/documentation/authority.ts';
import {
  compileDocumentationOperationAdmissionProjection,
  compileDocumentationSemanticGraph,
  compileDocumentationView,
  projectDocumentationClauseSelection,
  unavailableDocumentationAdmissionProjection,
  type DocumentationSemanticGraph,
  type DocumentationViewSelection
} from '../../src/control/documentation/compiler.ts';

const digest = `sha256:${'1'.repeat(64)}` as const;
const stable = '<!-- sec-clause {"blocker":null,"kind":"stable-decision"} -->';
const explanation = '<!-- sec-clause {"blocker":null,"kind":"non-normative-explanation"} -->';
const records = ['alpha', 'beta', 'gamma'].map(id => ({ id, path: `docs/${id}.md`,
  kind: 'authority', domain: id, lifecycle: 'stable', dynamicPolicy: 'forbidden',
  owns: [`${id}.rule`], projects: [] }));
const source = (title: string) => `# ${title}\n${stable}\n## Parent\nparent\n${stable}\n### Child\nchild\n${explanation}\n## Notes\nnotes\n`;
const registrySource = () => JSON.stringify({ documents: records });

function graphFor(input = source('Alpha'), trustedTree = 'tree-a', admitted = true) {
  // Use the real registry decoder and admission/graph issuers. These are pure
  // compilation inputs, not an effect grant or a structural graph stand-in.
  const registry = parseDocumentationAuthorityRegistry(registrySource());
  return compileDocumentationSemanticGraph({ trustedTree, registry,
    sources: [ { documentId: 'alpha', source: input },
      { documentId: 'beta', source: source('Beta') }, { documentId: 'gamma', source: source('Gamma') } ],
    admission: admitted ? compileDocumentationOperationAdmissionProjection({ trustedTree, registry,
      owners: registry.documents, subjectRefs: ['src/example.ts'] }) : unavailableDocumentationAdmissionProjection(trustedTree)
  });
}
function selection(graph: DocumentationSemanticGraph, titles: readonly string[], owners: readonly string[] = []) {
  return { kind: 'compact-agent', clauseIds: graph.clauses.filter(clause =>
    clause.documentId === 'alpha' && titles.includes(clause.headingPath.at(-1)!)).map(clause => clause.id).sort(),
    ownerDocumentIds: owners, decisionQuestionDigest: digest } satisfies DocumentationViewSelection;
}

for (const directive of [
  '{"blocker":null,"kind":"stable-decision","kind":"non-normative-explanation"}',
  '{"blocker":null,"kind":"stable-decision","k\\u0069nd":"stable-decision"}',
  '{"blocker":"denied","blocker":null,"kind":"stable-decision"}',
  '{"blocker":null,"bl\\u006fcker":null,"kind":"stable-decision"}'
]) {
  test(`Clause JSON refuses ambiguous decoded keys: ${directive}`, () => {
    assert.throws(() => graphFor(`<!-- sec-clause ${directive} -->\n# Alpha\n`), /duplicate key/);
  });
}

test('registry JSON rejects root, nested and escaped duplicate declarations before object information is lost', () => {
  const single = JSON.stringify(records[0]);
  for (const raw of [
    `{"documents":[],"documents":[${single}]}`,
    `{"documents":[${single}],"docum\\u0065nts":[${single}]}`,
    `{"documents":[${single.replace('"id":"alpha"', '"id":"discarded","id":"alpha"')}]}`
  ]) {
    assert.throws(() => parseDocumentationAuthorityRegistry(raw), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /not valid JSON/);
      assert.equal((error.cause as { kind?: string }).kind, 'duplicate-key'); return true;
    });
  }
});

test('strict JSON reuse preserves valid field ordering and the original domain constraints', () => {
  assert.deepEqual(parseDocumentationAuthorityRegistry(registrySource()).documents, records);
  const before = graphFor(`${stable}\n# Alpha\n`);
  const reordered = graphFor('<!-- sec-clause {"kind":"stable-decision","blocker":null} -->\n# Alpha\n');
  assert.equal(before.clauses[0]!.id, reordered.clauses[0]!.id);
  for (const raw of ['{"blocker":null}', '{"blocker":null,"kind":"stable-decision","extra":true}',
    '{"blocker":null,"kind":"unknown"}', '{"blocker":"runtime","kind":"stable-decision"}',
    '{"blocker":null,"kind":"temporary-safety-denial"}',
    '{"blocker":"runtime","kind":"non-normative-explanation"}']) {
    assert.throws(() => graphFor(`<!-- sec-clause ${raw} -->\n# Alpha\n`));
  }
  for (const raw of ['{}', '{"documents":[]}', '{"documents":[],"extra":true}', '[]']) {
    assert.throws(() => parseDocumentationAuthorityRegistry(raw));
  }
});

test('Clause identity, source offsets and source/content hashes remain independent of the derived indexes', () => {
  const graph = graphFor();
  const child = graph.clauses.find(c => c.documentId === 'alpha' && c.headingPath.at(-1) === 'Child')!;
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  assert.equal(child.id, `clause:${hash('{"documentId":"alpha","headingPath":["Alpha","Parent","Child"]}')}`);
  assert.equal(child.lineStart, 6); assert.equal(child.lineEnd, 8);
  assert.equal(child.content, `### Child\nchild\n${explanation}`);
  assert.equal(child.sourceDigest, `sha256:${hash(source('Alpha'))}`);
  assert.equal(child.contentDigest, `sha256:${hash(child.content)}`);
  const view = compileDocumentationView(graph, selection(graph, ['Child']));
  assert.equal(view.clauses.find(c => c.id === child.id), child);
  assert.equal(graph.semanticGraphDigest, view.semanticGraphDigest);
});

test('compact selections include ancestors exactly once and preserve source order, not hash or request order', () => {
  const graph = graphFor();
  const view = compileDocumentationView(graph, selection(graph, ['Parent', 'Child', 'Notes']));
  assert.deepEqual(view.clauses.map(c => c.headingPath.at(-1)), ['Alpha', 'Parent', 'Child', 'Notes']);
  assert.equal(new Set(view.clauses.map(c => c.id)).size, 4);
  assert.equal(view.clauses[0]!.kind, 'untyped-observation');
});

test('full-human view preserves all original clause/fact order and serializes deterministic bytes', () => {
  const graph = graphFor();
  const query = { kind: 'full-human', clauseIds: [], ownerDocumentIds: [], decisionQuestionDigest: digest } as const;
  const first = compileDocumentationView(graph, query), next = compileDocumentationView(graph, query);
  assert.deepEqual(first.clauses.map(c => [c.documentId, c.headingPath.at(-1)]),
    ['alpha', 'beta', 'gamma'].flatMap((id, i) => [[id, ['Alpha', 'Beta', 'Gamma'][i]], [id, 'Parent'], [id, 'Child'], [id, 'Notes']]));
  assert.deepEqual(first.admissionFacts.map(f => f.ownerDocumentId), ['alpha', 'beta', 'gamma']);
  assert.equal(JSON.stringify(first), JSON.stringify(next));
  assert.equal(first.viewBytesDigest, next.viewBytesDigest);
});

test('owner selection returns canonical fact order and keeps empty/unknown selection behavior', () => {
  const graph = graphFor();
  const query = { kind: 'admission-obligation', clauseIds: [], ownerDocumentIds: ['alpha', 'gamma'], decisionQuestionDigest: digest } as const;
  const view = compileDocumentationView(graph, query);
  assert.deepEqual(view.clauses, []); assert.deepEqual(view.admissionFacts.map(f => f.id), ['operation-owner:alpha', 'operation-owner:gamma']);
  assert.deepEqual(compileDocumentationView(graph, { ...query, ownerDocumentIds: ['absent'] }).admissionFacts, []);
  assert.deepEqual(compileDocumentationView(graph, selection(graph, [])).clauses, []);
  assert.deepEqual(compileDocumentationView(graphFor(undefined, 'unavailable', false), query).admissionFacts, []);
});

test('invalid selections remain invalid after the index is warm', () => {
  const graph = graphFor(); compileDocumentationView(graph, selection(graph, ['Child']));
  const valid = selection(graph, ['Child']);
  for (const query of [
    { ...valid, clauseIds: ['clause:missing'] }, { ...valid, clauseIds: [...valid.clauseIds, ...valid.clauseIds] },
    { ...valid, kind: 'full-human' }, { ...valid, ownerDocumentIds: ['gamma', 'alpha'] },
    { ...valid, kind: 'invalid' }, { ...valid, decisionQuestionDigest: 'bad' }
  ]) assert.throws(() => compileDocumentationView(graph, query as never));
  assert.throws(() => compileDocumentationView(graph, selection(graph, ['Alpha'])), /untyped clause/);
});

for (const copy of ['spread', 'serialized', 'structured'] as const) {
  test(`${copy} graph cannot acquire a view or document projection using copied public identity fields`, () => {
    const graph = graphFor();
    const forged = copy === 'spread' ? { ...graph } : copy === 'serialized'
      ? JSON.parse(JSON.stringify(graph)) : structuredClone(graph);
    assert.throws(() => compileDocumentationView(forged, selection(graph, ['Child'])), /not issued/);
    assert.throws(() => projectDocumentationClauseSelection(forged, 'alpha'), /not issued/);
  });
}

test('unissued graph rejection precedes hostile graph properties and selection getters', () => {
  const forged = new Proxy({} as DocumentationSemanticGraph, { get() { assert.fail('graph read'); } });
  const query = new Proxy({} as DocumentationViewSelection, { get() { assert.fail('selection read'); } });
  assert.throws(() => compileDocumentationView(forged, query), /not issued/);
  assert.throws(() => projectDocumentationClauseSelection(forged, 'alpha'), /not issued/);
});

test('per-document projection is immutable and reused only for the exact issued graph and document', () => {
  const graph = graphFor();
  const first = projectDocumentationClauseSelection(graph, 'alpha');
  assert.equal(projectDocumentationClauseSelection(graph, 'alpha'), first);
  assert.deepEqual(first.clauses.map(c => [c.lineStart, c.lineEnd]), [[3, 5], [6, 8], [9, 11]]);
  assert.ok(Object.isFrozen(first)); assert.ok(Object.isFrozen(first.clauses)); assert.ok(Object.isFrozen(first.clauses[0]));
  assert.notEqual(projectDocumentationClauseSelection(graph, 'beta'), first);
  const separate = projectDocumentationClauseSelection(graphFor(), 'alpha');
  assert.notEqual(separate, first); assert.deepEqual(separate, first);
});

test('a newly compiled source or trusted tree cannot reuse a stale document reference', () => {
  const previous = projectDocumentationClauseSelection(graphFor(), 'alpha');
  const changed = projectDocumentationClauseSelection(graphFor(source('Alpha').replace('child\n', 'changed\n')), 'alpha');
  assert.notEqual(changed.sourceDigest, previous.sourceDigest); assert.notEqual(changed.selectionDigest, previous.selectionDigest);
  const anotherTree = projectDocumentationClauseSelection(graphFor(undefined, 'tree-b'), 'alpha');
  assert.equal(anotherTree.sourceDigest, previous.sourceDigest); assert.notEqual(anotherTree.compilerInputDigest, previous.compilerInputDigest);
});

test('invalid or untyped-only document lookups do not poison later valid projections', () => {
  const graph = graphFor('# Alpha\nplain\n');
  for (const name of ['alpha', 'absent', '', 'alpha ', 'constructor', '__proto__']) {
    assert.throws(() => projectDocumentationClauseSelection(graph, name));
  }
  const beta = projectDocumentationClauseSelection(graph, 'beta');
  assert.equal(projectDocumentationClauseSelection(graph, 'beta'), beta);
});

test('exact canonical source order rejects missing, duplicate, extra and reordered inputs', () => {
  const registry = parseDocumentationAuthorityRegistry(registrySource());
  const sources = registry.documents.map(r => ({ documentId: r.id, source: source(r.id) }));
  const admission = unavailableDocumentationAdmissionProjection('tree');
  for (const input of [[...sources].reverse(), sources.slice(1), [...sources, sources[0]!],
    sources.map((r, i) => i === 0 ? { ...r, documentId: 'extra' } : r)]) {
    assert.throws(() => compileDocumentationSemanticGraph({ registry, sources: input, admission, trustedTree: 'tree' }), /sources must exactly match/);
  }
  assert.equal(compileDocumentationSemanticGraph({ registry, sources, admission, trustedTree: 'tree' }).clauses.length, 12);
});

test('line-ending normalization, Markdown subset and directive adjacency semantics are unchanged', () => {
  const lf = graphFor(), crlf = graphFor(source('Alpha').replaceAll('\n', '\r\n'));
  assert.deepEqual(lf, crlf);
  assert.throws(() => graphFor(`${stable}\n\n# Alpha\n`), /immediately precede/);
  assert.throws(() => graphFor('# Alpha\n```\nunfinished\n'), /unterminated fenced/);
  assert.throws(() => graphFor('# Alpha\n' + stable), /orphan clause/);
  const fenced = graphFor('# Alpha\n```\n# not a clause\n```\n' + stable + '\n## Kept\n');
  assert.deepEqual(fenced.clauses.filter(c => c.documentId === 'alpha').map(c => c.headingPath.at(-1)), ['Alpha', 'Kept']);
});
