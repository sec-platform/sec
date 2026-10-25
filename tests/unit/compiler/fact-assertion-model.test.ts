import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { addFact, type FactInput } from '../../../src/compiler/ir/ir-fact-store.ts';
import { digest, semanticRevisionPayload } from '../../../src/compiler/ir/ir-revision.ts';
import { validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../../src/compiler/projection/project-architecture-view.ts';
import { summarizeFactAssertions } from '../../../src/compiler/projection/semantic-view-utils.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import type { EvidenceReference, FactProvenance, SemanticFact } from '../../../src/semantics/engineering-ir/fact-types.ts';
import type { EngineeringIR } from '../../../src/semantics/engineering-ir/root-types.ts';

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

function expectCodedFailure(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CodedFailure);
    expect((error as CodedFailure).code).toBe(code);
    return;
  }
  throw new Error(`Expected CodedFailure ${code}`);
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

test('same assertion identity rejects conflicting confidence instead of strongest-wins merge', () => {
  const facts = new Map<string, SemanticFact>();
  addFact(facts, factInput({ confidence: 0.4 }));

  expectCodedFailure(
    () => addFact(facts, factInput({ confidence: 0.9 })),
    'IR-AUTHORITY-003'
  );
});

test('inferred confidence 1 does not overwrite an authoritative assertion', () => {
  const facts = new Map<string, SemanticFact>();
  const factId = addFact(facts, factInput({ confidence: 0.4 }));
  const inferredFactId = addFact(facts, factInput({
    authority: 'inferred',
    confidence: 1,
    provenance: [{ kind: 'ai', sourceId: 'semantic-cluster-v1' }]
  }));

  const fact = facts.get(factId)!;
  expect(inferredFactId).toBe(factId);
  expect(facts.size).toBe(1);
  expect(new Set(fact.assertions.map((assertion) => assertion.id)).size).toBe(2);
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

test('projection preserves finite confidence boundaries, inferred badges and canonical revisions', () => {
  const input = projectionInput();
  const base = buildEngineeringIR(input);
  const contains = base.facts.find((fact) =>
    fact.subject === 'app:test' &&
    fact.predicate === 'CONTAINS' &&
    fact.object.kind === 'entity' &&
    fact.object.entityId === 'block:test/basic'
  )!;
  const revisions: string[] = [];
  for (const confidence of [0, -0, 0.7, 1]) {
    const facts = new Map(base.facts.map((fact) => [fact.id, fact]));
    addFact(facts, {
      subject: contains.subject,
      predicate: contains.predicate,
      object: contains.object,
      authority: 'inferred',
      confidence,
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

    const projectedFact = snapshot.ir.facts.find((fact) => fact.id === contains.id)!;
    const inferred = projectedFact.assertions.find((assertion) => assertion.authority === 'inferred')!;
    expect(summarizeFactAssertions(projectedFact).confidence).toEqual({ min: confidence, max: 1 });
    expect(Object.is(inferred.confidence, confidence)).toBe(true);
    revisions.push(snapshot.ir.semanticRevision);
    const view = projectArchitectureView(snapshot, 'app:test');
    const node = view.nodes.find((entry) => entry.entityId === 'app:test');
    const overlay = view.overlays[0]?.entries.find((entry) => entry.targetId === node?.id);

    expect(node?.badges).toContain('inferred');
    expect(overlay).toMatchObject({
      status: 'mixed',
      authorities: ['derived', 'inferred'],
      hasInferred: true,
      hasConflict: false,
      confidence: { min: confidence, max: 1 }
    });
  }
  expect(revisions[0]).toBe(revisions[1]);
  expect(revisions[3]).not.toBe(revisions[0]);
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
  expectCodedFailure(
    () => addFact(new Map<string, SemanticFact>(), factInput({ provenance: [] })),
    'IR-AUTHORITY-002'
  );
  for (const confidence of [-0.01, 1.01, Number.NaN, Infinity, -Infinity]) {
    const facts = new Map<string, SemanticFact>();
    expectCodedFailure(() => addFact(facts, factInput({ confidence })), 'IR-AUTHORITY-001');
    expect(facts.size).toBe(0);
  }
});


test('distinct provenance tuples survive fact construction without choosing an ambiguous wire order', () => {
  const pairs: FactProvenance[][] = [
    [{ kind: 'compiler', sourceId: 'a', sourcePath: 'b\0c' }, { kind: 'compiler', sourceId: 'a\0b', sourcePath: 'c' }],
    [{ kind: 'compiler', sourceId: 'a' }, { kind: 'compiler', sourceId: 'a', sourcePath: '' }]
  ];
  for (const pair of pairs) for (const provenance of [pair, [...pair].reverse()]) {
    const facts = new Map<string, SemanticFact>();
    const id = addFact(facts, factInput({ provenance }));
    expect(facts.get(id)!.assertions[0]!.provenance).toEqual(pair);
  }
  const first: FactProvenance = { kind: 'compiler', sourceId: 'a', revision: 'r' };
  const reordered: FactProvenance = { revision: 'r', sourceId: 'a', kind: 'compiler' };
  for (const provenance of [[first, reordered], [reordered, first]]) {
    const facts = new Map<string, SemanticFact>();
    expect(() => addFact(facts, factInput({ provenance }))).toThrow(expect.objectContaining({ code: 'CANONICAL-KEY-CONFLICT' }));
    expect(facts.size).toBe(0);
  }
});

test('evidence merge retains distinct references and rejects ambiguous wire order without replacing the assertion', () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const distinct: EvidenceReference[][] = [
    [{ kind: 'test', ref: 'a' }, { kind: 'test', ref: 'a', digest }],
    [{ kind: 'test', ref: 'a', digest }, { kind: 'test', ref: 'b', digest }]
  ];
  for (const pair of distinct) for (const [first, second] of [pair, [...pair].reverse()]) {
    const facts = new Map<string, SemanticFact>();
    const id = addFact(facts, factInput({ evidence: [first!] }));
    expect(addFact(facts, factInput({ evidence: [second!] }))).toBe(id);
    expect(facts.get(id)!.assertions).toHaveLength(1);
    expect(facts.get(id)!.assertions[0]!.evidence).toEqual(pair);
  }
  const conflicting: EvidenceReference[][] = [
    [{ kind: 'test', ref: 'a', digest }, { digest, ref: 'a', kind: 'test' }]
  ];
  for (const pair of conflicting) for (const [first, second] of [pair, [...pair].reverse()]) {
    const facts = new Map<string, SemanticFact>();
    const id = addFact(facts, factInput({ evidence: [first!] }));
    const before = structuredClone(facts.get(id));
    expect(() => addFact(facts, factInput({ evidence: [second!] }))).toThrow(expect.objectContaining({ code: 'CANONICAL-KEY-CONFLICT' }));
    expect(facts.get(id)).toEqual(before);
  }
});

test('fact construction preserves the legacy assertion wire identity when optional fields are absent', () => {
  const provenance: FactProvenance = { sourceId: 'owner', kind: 'compiler' };
  const evidence: EvidenceReference = { kind: 'test', ref: 'case' };
  const facts = new Map<string, SemanticFact>();
  const id = addFact(facts, factInput({ provenance: [provenance, { ...provenance }], evidence: [evidence, { ...evidence }] }));
  const wire = '[{"sourceId":"owner","kind":"compiler"}]';
  const expected = createHash('sha256').update(`${id}\0authoritative\0${wire}`).digest('hex').slice(0, 24);
  const assertion = facts.get(id)!.assertions[0]!;
  expect(assertion.id).toBe(`assertion:${expected}`);
  expect(JSON.stringify(assertion.provenance)).toBe(wire);
  expect(assertion.evidence).toEqual([{ kind: 'test', ref: 'case' }]);
});

test('equal JSON wire cannot hide non-enumerable evidence identities from raw IR validation', () => {
  const first: EvidenceReference = { kind: 'test', ref: 'case-a', digest: `sha256:${'a'.repeat(64)}` };
  const second: EvidenceReference = { kind: 'test', ref: 'case-b', digest: `sha256:${'b'.repeat(64)}` };
  for (const value of [first, second]) for (const key of ['ref', 'digest']) {
    Object.defineProperty(value, key, { enumerable: false });
  }
  expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  const input = projectionInput();
  const base = buildEngineeringIR(input);
  for (const evidence of [[first, second], [second, first]]) {
    const raw = structuredClone(base);
    raw.facts[0]!.assertions[0]!.evidence = evidence;
    expectCodedFailure(() => validateEngineeringIR(raw, input), 'IR-VALIDATION-008');
  }
});
