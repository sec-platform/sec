import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { CompilerError } from '../../src/compiler/errors.ts';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { addFact, type FactInput } from '../../src/compiler/ir/ir-fact-store.ts';
import { normalizeEvidence, normalizeProvenance } from '../../src/compiler/ir/ir-normalization.ts';
import { digest, semanticRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import { summarizeFactAssertions } from '../../src/compiler/projection/semantic-view-utils.ts';
import type { EvidenceReference, FactProvenance, SemanticFact } from '../../src/semantics/engineering-ir/fact-types.ts';
import type { EngineeringIR } from '../../src/semantics/engineering-ir/root-types.ts';

function factInput(overrides: Partial<FactInput> = {}): FactInput {
  return {
    subject: 'responsibility:test:TicketService',
    predicate: 'OWNS',
    object: { kind: 'entity', entityId: 'state:test:TicketState' },
    authority: 'authoritative',
    provenance: [{ kind: 'contract', sourceId: 'contract:ticket' }],
    ...overrides
  };
}

function expectCompilerError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

function withRevision(fact: SemanticFact, revision: string): SemanticFact {
  return {
    ...fact,
    assertions: fact.assertions.map((assertion) => ({ ...assertion, validFromRevision: revision }))
  };
}

function semanticRevisionFor(
  ir: Pick<EngineeringIR, 'graphId' | 'appId' | 'entities' | 'scenarios'>,
  facts: readonly SemanticFact[]
): string {
  return `sha256:${digest(semanticRevisionPayload(ir.graphId, ir.appId, ir.entities, facts, ir.scenarios))}`;
}

function projectionInput(): BuildEngineeringIRInput {
  return {
    app: { id: 'test', name: 'test' },
    resolvedBlocks: [{
      id: 'test/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'registry/test.basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry'
    }],
    manifests: [{
      blockId: 'test/basic',
      manifestPath: 'registry/test.basic/block.manifest.yaml',
      manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
    }],
    acceptanceIds: [],
    policyDeclarations: []
  };
}

test('same triple and normalized assertion identity dedupe idempotently', () => {
  const facts = new Map<string, SemanticFact>();
  const firstId = addFact(facts, factInput({
    provenance: [
      { kind: 'contract', sourceId: 'contract:ticket', sourcePath: 'ticket.yaml' },
      { kind: 'user', sourceId: 'review:1' }
    ]
  }));
  const secondId = addFact(facts, factInput({
    provenance: [
      { kind: 'user', sourceId: 'review:1' },
      { kind: 'contract', sourceId: 'contract:ticket', sourcePath: 'ticket.yaml' }
    ]
  }));

  expect(secondId).toBe(firstId);
  expect(facts.size).toBe(1);
  expect(facts.get(firstId)?.assertions).toHaveLength(1);
});

test('same triple with distinct provenance retains one Fact and two Assertions', () => {
  const facts = new Map<string, SemanticFact>();
  const contractFactId = addFact(facts, factInput());
  const aiFactId = addFact(facts, factInput({
    authority: 'inferred',
    confidence: 0.72,
    provenance: [{ kind: 'ai', sourceId: 'semantic-cluster-v1' }]
  }));

  const fact = facts.get(contractFactId)!;
  expect(aiFactId).toBe(contractFactId);
  expect(facts.size).toBe(1);
  expect(fact.assertions).toHaveLength(2);
  expect(new Set(fact.assertions.map((assertion) => assertion.id)).size).toBe(2);
  expect(fact.assertions.map((assertion) => assertion.authority)).toEqual(expect.arrayContaining([
    'authoritative',
    'inferred'
  ]));
});

test('same assertion identity rejects conflicting confidence instead of strongest-wins merge', () => {
  const facts = new Map<string, SemanticFact>();
  addFact(facts, factInput({ confidence: 0.4 }));

  expectCompilerError(
    () => addFact(facts, factInput({ confidence: 0.9 })),
    'IR-AUTHORITY-003'
  );
});

test('inferred confidence 1 does not overwrite an authoritative assertion', () => {
  const facts = new Map<string, SemanticFact>();
  const factId = addFact(facts, factInput({ confidence: 0.4 }));
  addFact(facts, factInput({
    authority: 'inferred',
    confidence: 1,
    provenance: [{ kind: 'ai', sourceId: 'semantic-cluster-v1' }]
  }));

  const fact = facts.get(factId)!;
  expect(summarizeFactAssertions(fact)).toEqual({
    status: 'mixed',
    authorities: ['authoritative', 'inferred'],
    hasConflict: false,
    hasInferred: true,
    assertionCount: 2,
    confidence: { min: 0.4, max: 1 }
  });
  expect(fact.assertions.find((assertion) => assertion.authority === 'authoritative')?.confidence).toBe(0.4);
  expect(fact.assertions.find((assertion) => assertion.authority === 'inferred')?.confidence).toBe(1);
});

test('projection inferred badge and authority overlay derive from assertion summary', () => {
  const input = projectionInput();
  const base = buildEngineeringIR(input);
  const facts = new Map(base.facts.map((fact) => [fact.id, fact]));
  const contains = base.facts.find((fact) =>
    fact.subject === 'app:test' &&
    fact.predicate === 'CONTAINS' &&
    fact.object.kind === 'entity' &&
    fact.object.entityId === 'block:test/basic'
  )!;
  addFact(facts, {
    subject: contains.subject,
    predicate: contains.predicate,
    object: contains.object,
    authority: 'inferred',
    confidence: 0.7,
    provenance: [{ kind: 'ai', sourceId: 'semantic-cluster-v1' }]
  });

  const pendingFacts = [...facts.values()].sort((left, right) => left.id.localeCompare(right.id));
  const revision = semanticRevisionFor(base, pendingFacts);
  const ir: EngineeringIR = {
    ...base,
    semanticRevision: revision,
    facts: pendingFacts.map((fact) => withRevision(fact, revision))
  };
  const snapshot = validateEngineeringIR(ir, input);

  const view = projectArchitectureView(snapshot, 'app:test');
  const node = view.nodes.find((entry) => entry.entityId === 'app:test');
  const overlay = view.overlays[0]?.entries.find((entry) => entry.targetId === node?.id);

  expect(node?.badges).toContain('inferred');
  expect(overlay).toMatchObject({
    status: 'mixed',
    authorities: ['derived', 'inferred'],
    hasInferred: true,
    hasConflict: false,
    confidence: { min: 0.7, max: 1 }
  });
});

test('assertion runtime validity is the only nested assertion data excluded from semantic revision', () => {
  const facts = new Map<string, SemanticFact>();
  addFact(facts, factInput());
  const irDomain = {
    graphId: 'engineering-ir:assertion-revision-test',
    appId: 'app:test',
    entities: [
      { id: 'app:test', kind: 'app', label: 'test', attributes: [] },
      { id: 'responsibility:test:TicketService', kind: 'responsibility', label: 'TicketService', attributes: [] },
      { id: 'state:test:TicketState', kind: 'state', label: 'TicketState', attributes: [] }
    ],
    scenarios: []
  } satisfies Pick<EngineeringIR, 'graphId' | 'appId' | 'entities' | 'scenarios'>;
  const initialFacts = [...facts.values()].map((fact) => withRevision(fact, 'sha256:initial-validity'));
  const before = {
    inputRevision: 'sha256:stable-input',
    semanticRevision: semanticRevisionFor(irDomain, initialFacts)
  };
  const validityChangedFacts = initialFacts.map((fact) => ({
    ...fact,
    assertions: fact.assertions.map((assertion) => ({
      ...assertion,
      validFromRevision: 'sha256:runtime-rebound',
      validToRevision: 'sha256:runtime-closed'
    }))
  }));
  const afterValidityChange = {
    inputRevision: before.inputRevision,
    semanticRevision: semanticRevisionFor(irDomain, validityChangedFacts)
  };
  const confidenceChangedFacts = initialFacts.map((fact) => ({
    ...fact,
    assertions: fact.assertions.map((assertion) => ({ ...assertion, confidence: 0.5 }))
  }));

  expect(afterValidityChange).toEqual(before);
  expect(semanticRevisionFor(irDomain, confidenceChangedFacts)).not.toBe(before.semanticRevision);
});

test('fact assertion rejects missing provenance and out-of-range confidence', () => {
  expectCompilerError(
    () => addFact(new Map<string, SemanticFact>(), factInput({ provenance: [] })),
    'IR-AUTHORITY-002'
  );
  expectCompilerError(
    () => addFact(new Map<string, SemanticFact>(), factInput({ confidence: -0.01 })),
    'IR-AUTHORITY-001'
  );
  expectCompilerError(
    () => addFact(new Map<string, SemanticFact>(), factInput({ confidence: 1.01 })),
    'IR-AUTHORITY-001'
  );
});


test('provenance key collisions fail before a Fact loses either source', () => {
  const pairs: FactProvenance[][] = [
    [{ kind: 'compiler', sourceId: 'a\0b', sourcePath: 'c' }, { kind: 'compiler', sourceId: 'a', sourcePath: 'b\0c' }],
    [{ kind: 'compiler', sourceId: 'a' }, { kind: 'compiler', sourceId: 'a', sourcePath: '' }],
    [{ kind: 'compiler', sourceId: 'a', revision: 'r' }, { revision: 'r', sourceId: 'a', kind: 'compiler' }]
  ];
  for (const pair of pairs) for (const provenance of [pair, [...pair].reverse()]) {
    const facts = new Map<string, SemanticFact>();
    expect(() => addFact(facts, factInput({ provenance }))).toThrow(expect.objectContaining({ code: 'CANONICAL-KEY-CONFLICT' }));
    expect(facts.size).toBe(0);
  }
});

test('conflicting evidence cannot replace an existing assertion during a merge', () => {
  const competing = [{ kind: 'test', ref: 'a', competing: 'first' }, { kind: 'test', ref: 'a', competing: 'second' }];
  const pairs: EvidenceReference[][] = [
    [{ kind: 'test', ref: 'a\0b', digest: 'c' }, { kind: 'test', ref: 'a', digest: 'b\0c' }],
    [{ kind: 'test', ref: 'a' }, { kind: 'test', ref: 'a', digest: '' }],
    [{ kind: 'test', ref: 'a', digest: 'd' }, { digest: 'd', ref: 'a', kind: 'test' }],
    competing
  ];
  for (const pair of pairs) for (const [first, second] of [pair, [...pair].reverse()]) {
    const facts = new Map<string, SemanticFact>();
    const id = addFact(facts, factInput({ evidence: [first!] }));
    const before = structuredClone(facts.get(id));
    expect(() => addFact(facts, factInput({ evidence: [second!] }))).toThrow(expect.objectContaining({ code: 'CANONICAL-KEY-CONFLICT' }));
    expect(facts.get(id)).toEqual(before);
  }
});

test('metadata deduplication preserves legacy wire identities and optional undefined fields', () => {
  const first: FactProvenance = { revision: undefined, sourceId: 'owner', kind: 'compiler' };
  const last: FactProvenance = { sourceId: 'owner', kind: 'compiler' };
  const normalized = normalizeProvenance([first, { ...first }, last]);
  expect(normalized).toHaveLength(1);
  expect(normalized[0]).toBe(last);
  const facts = new Map<string, SemanticFact>();
  const id = addFact(facts, factInput({ provenance: [first, last] }));
  const wire = '[{"sourceId":"owner","kind":"compiler"}]';
  const expected = createHash('sha256').update(`${id}\0authoritative\0${wire}`).digest('hex').slice(0, 24);
  expect(facts.get(id)!.assertions[0]!.id).toBe(`assertion:${expected}`);
  expect(JSON.stringify(normalized)).toBe(wire);
  const evidence: EvidenceReference = { digest: undefined, kind: 'test', ref: 'case' };
  expect(normalizeEvidence([evidence, { ...evidence }])).toEqual([evidence]);
  expect(normalizeEvidence([{ kind: 'test', ref: 'b' }, { kind: 'test', ref: 'a' }]).map(e => e.ref)).toEqual(['a', 'b']);
});

test('stable metadata duplicates preserve non-enumerable, symbol and JSON extension data', () => {
  for (const digest of [undefined, 'd']) {
    const first: EvidenceReference = { kind: 'test', ref: 'case' };
    const last: EvidenceReference = { kind: 'test', ref: 'case' };
    for (const value of [first, last]) Object.defineProperty(value, 'digest', { value: digest, enumerable: false });
    expect(normalizeEvidence([first, first])[0]).toBe(first);
    expect(normalizeEvidence([first, last])[0]).toBe(last);
  }
  const first = { kind: 'test', ref: 'case', extra: { count: 1, enabled: true, values: [null, 2] } };
  const last = { ...first, extra: structuredClone(first.extra), [Symbol('not-wire')]: 'ignored' };
  let reads = 0;
  Object.defineProperty(last, 'notWire', { get() { reads++; return 'ignored'; }, enumerable: false });
  expect(normalizeEvidence([first, last])[0]).toBe(last);
  expect(reads).toBe(0);
});

test('non-enumerable metadata key fields still reject tuple collisions with equal JSON wire', () => {
  const first: EvidenceReference = { kind: 'test', ref: 'a\0b', digest: 'c' };
  const second: EvidenceReference = { kind: 'test', ref: 'a', digest: 'b\0c' };
  for (const value of [first, second]) for (const key of ['ref', 'digest']) {
    Object.defineProperty(value, key, { enumerable: false });
  }
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  for (const pair of [[first, second], [second, first]]) {
    expect(() => normalizeEvidence(pair)).toThrow(expect.objectContaining({ code: 'CANONICAL-KEY-CONFLICT' }));
  }
});

test('fact assertion rejects non-finite confidence without inserting a Fact', () => {
  for (const confidence of [Number.NaN, Infinity, -Infinity]) {
    const facts = new Map<string, SemanticFact>();
    expectCompilerError(() => addFact(facts, factInput({ confidence })), 'IR-AUTHORITY-001');
    expect(facts.size).toBe(0);
  }
});

test('raw IR validation rejects invalid confidence despite a matching semantic revision', () => {
  const input = projectionInput();
  const base = buildEngineeringIR(input);
  expect(base.facts[0]?.assertions.length).toBeGreaterThan(0);
  for (const confidence of [Number.NaN, Infinity, -Infinity, -0.01, 1.01]) {
    // Only this raw assertion is corrupted; the builder never sees its value.
    const facts = base.facts.map((fact, factIndex) => factIndex === 0 ? {
      ...fact,
      assertions: fact.assertions.map((assertion, assertionIndex) => assertionIndex === 0
        ? { ...assertion, confidence }
        : assertion)
    } : fact);
    const revision = semanticRevisionFor(base, facts);
    const raw: EngineeringIR = {
      ...base,
      semanticRevision: revision,
      facts: facts.map((fact) => withRevision(fact, revision))
    };
    expectCompilerError(() => validateEngineeringIR(raw, input), 'IR-AUTHORITY-001');
  }
});

test('finite confidence boundaries preserve assertion values and canonical revisions', () => {
  const input = projectionInput();
  const base = buildEngineeringIR(input);
  const contains = base.facts.find((fact) =>
    fact.subject === 'app:test' && fact.predicate === 'CONTAINS' &&
    fact.object.kind === 'entity' && fact.object.entityId === 'block:test/basic'
  )!;
  const revisions: string[] = [];
  for (const confidence of [0, -0, 1]) {
    const facts = new Map(base.facts.map((fact) => [fact.id, fact]));
    const factId = addFact(facts, {
      subject: contains.subject,
      predicate: contains.predicate,
      object: contains.object,
      authority: 'inferred',
      confidence,
      provenance: [{ kind: 'ai', sourceId: 'confidence-boundary' }]
    });
    const pendingFacts = [...facts.values()];
    const revision = semanticRevisionFor(base, pendingFacts);
    const snapshot = validateEngineeringIR({
      ...base,
      semanticRevision: revision,
      facts: pendingFacts.map((fact) => withRevision(fact, revision))
    }, input);
    const fact = snapshot.ir.facts.find(({ id }) => id === factId)!;
    const assertion = fact.assertions.find(({ authority }) => authority === 'inferred')!;
    expect(Object.is(assertion.confidence, confidence)).toBe(true);
    expect(summarizeFactAssertions(fact).confidence).toEqual({ min: confidence, max: 1 });
    revisions.push(snapshot.ir.semanticRevision);
  }
  // Existing semantic JSON treats signed zero equally; one remains distinct.
  expect(revisions[0]).toBe(revisions[1]);
  expect(revisions[2]).not.toBe(revisions[0]);
});
