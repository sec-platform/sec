import { expect, test } from 'bun:test';

import { addFact, type FactInput } from '../../platform/compiler/ir/ir-fact-store.ts';
import { projectArchitectureView } from '../../platform/compiler/projection/project-architecture-view.ts';
import { summarizeFactAssertions } from '../../platform/compiler/projection/semantic-view-utils.ts';
import type { EngineeringIR, SemanticFact } from '../../platform/shared/engineering-ir-types.ts';
import { CompilerError } from '../../platform/shared/errors.ts';

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
    highestAuthority: 'authoritative',
    authorities: ['authoritative', 'inferred'],
    hasConflict: false,
    hasInferred: true,
    assertionCount: 2
  });
  expect(fact.assertions.find((assertion) => assertion.authority === 'authoritative')?.confidence).toBe(0.4);
  expect(fact.assertions.find((assertion) => assertion.authority === 'inferred')?.confidence).toBe(1);
});

test('projection inferred badge and authority overlay derive from assertion summary', () => {
  const facts = new Map<string, SemanticFact>();
  addFact(facts, factInput({
    object: { kind: 'entity', entityId: 'app:test' },
    confidence: 0.4
  }));
  addFact(facts, factInput({
    object: { kind: 'entity', entityId: 'app:test' },
    authority: 'inferred',
    confidence: 1,
    provenance: [{ kind: 'ai', sourceId: 'semantic-cluster-v1' }]
  }));

  const revision = 'sha256:assertion-test';
  const ir: EngineeringIR = {
    formatVersion: '1',
    graphId: 'engineering-ir:assertion-test',
    revision,
    appId: 'app:test',
    entities: [
      { id: 'app:test', kind: 'app', label: 'test', attributes: [] },
      { id: 'responsibility:test:TicketService', kind: 'responsibility', label: 'TicketService', attributes: [] }
    ],
    facts: [...facts.values()].map((fact) => withRevision(fact, revision)),
    scenarios: []
  };

  const view = projectArchitectureView(ir, 'responsibility:test:TicketService');
  const node = view.nodes.find((entry) => entry.entityId === 'responsibility:test:TicketService');
  const overlay = view.overlays[0]?.entries.find((entry) => entry.targetId === node?.id);

  expect(node?.badges).toEqual(expect.arrayContaining(['inferred', 'stateful']));
  expect(overlay?.authority).toBe('authoritative');
  expect(overlay?.confidence).toBe(0.4);
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
