import { expect, test } from 'bun:test';

import { CompilerError } from '../../src/compiler/errors.ts';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { addFact, type FactInput } from '../../src/compiler/ir/ir-fact-store.ts';
import { rawSha256Hex, semanticRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import { summarizeFactAssertions } from '../../src/compiler/projection/semantic-view-utils.ts';
import type { SemanticFact } from '../../src/semantics/engineering-ir/fact-types.ts';
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
  return `sha256:${rawSha256Hex(semanticRevisionPayload(ir.graphId, ir.appId, ir.entities, facts, ir.scenarios))}`;
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
