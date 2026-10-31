import { expect, test } from "bun:test";

import { CodedFailure } from '../../../src/contracts/failure.ts';
import { type SemanticEntity, type SemanticEntityKind } from '../../../src/semantics/engineering-ir/entity-types.ts';
import { type SemanticFact, type SemanticFactObject, type SemanticPredicate } from '../../../src/semantics/engineering-ir/fact-types.ts';
import {
  assertEngineeringIRPredicateSignatures,
} from "../../../src/semantics/engineering-ir/predicate-signatures.ts";
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../../src/semantics/policies/rules.ts';

function entity(id: string, kind: SemanticEntityKind): SemanticEntity {
  return { id, kind, label: id, attributes: [] };
}

function fact(
  id: string,
  subject: string,
  predicate: SemanticPredicate,
  object: SemanticFactObject,
): SemanticFact {
  return {
    id,
    subject,
    predicate,
    object,
    assertions: [
      {
        id: `assertion:${id}`,
        authority: "authoritative",
        confidence: 1,
        provenance: [
          { kind: "compiler", sourceId: "predicate-signature-test" },
        ],
        evidence: [],
        validFromRevision: "test",
      },
    ],
  };
}

function expectCodedFailure(run: () => unknown, code: string): CodedFailure {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CodedFailure);
    expect((error as CodedFailure).code).toBe(code);
    return error as CodedFailure;
  }
  throw new Error(`Expected CodedFailure ${code}`);
}

test("the policy predicate accepts only capability-to-artifact facts", () => {
  const predicate = policySemanticRule(TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE).requiredPredicate;
  const capability = entity('capability:tenant/context', 'capability');
  const artifact = entity('artifact:customer-service', 'artifact');
  expect(() => assertEngineeringIRPredicateSignatures(
    [capability, artifact],
    [fact('fact:tenant-flow', capability.id, predicate, { kind: 'entity', entityId: artifact.id })]
  )).not.toThrow();
  expectCodedFailure(
    () => assertEngineeringIRPredicateSignatures(
      [entity('block:tenant', 'block'), artifact],
      [fact('fact:invalid-tenant-flow', 'block:tenant', predicate, { kind: 'entity', entityId: artifact.id })]
    ),
    'IR-PREDICATE-002'
  );
});

test("entity-object signatures accept legal kinds and reject illegal kinds deterministically", () => {
  const entities = [
    entity("app:ticket", "app"),
    entity("operation:ticket:create", "operation"),
  ];
  const invalidA = fact("fact:a", "app:ticket", "CONTAINS", {
    kind: "entity",
    entityId: "operation:ticket:create",
  });
  const invalidZ = fact("fact:z", "app:ticket", "CONTAINS", {
    kind: "entity",
    entityId: "operation:ticket:create",
  });
  const first = expectCodedFailure(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [invalidZ, invalidA]),
    "IR-PREDICATE-004",
  );
  const second = expectCodedFailure(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [invalidA, invalidZ]),
    "IR-PREDICATE-004",
  );

  expect(second.details).toEqual(first.details);
  expect(first.details).toEqual({
    factId: "fact:a",
    predicate: "CONTAINS",
    subject: "app:ticket",
    object: { kind: "entity", entityId: "operation:ticket:create" },
    actualSubjectKind: "app",
    actualEntityObjectKind: "operation",
    expectedEntityObjectKinds: ["block"],
  });
});

test("Scenario predicate variants authorize only the canonical step graph shapes", () => {
  const scenarioId = "scenario:flow:run";
  const firstStepId = `${scenarioId}#step:first`;
  const entities = [
    entity(firstStepId, "scenario-step"),
  ];

  const invalidRetry = expectCodedFailure(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [
        fact("fact:retry", firstStepId, "RETRIES", {
          kind: "value",
          value: { maxAttempts: 0 },
        }),
      ]),
    "IR-PREDICATE-005",
  );
  expect(
    (invalidRetry.details as { schemaFailures: unknown }).schemaFailures,
  ).toEqual([
    {
      schemaId: "scenario-retry-v1",
      failure: "$.maxAttempts must be at least 1",
    },
  ]);
});

test("value-object signatures enforce exact schema and embedded entity-reference kind", () => {
  const entities = [
    entity("state:ticket:status", "state"),
    entity("operation:ticket:close", "operation"),
    entity("policy:ticket:close", "policy"),
  ];
  const wrongReferenceKind = expectCodedFailure(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [
        fact("fact:transition", "state:ticket:status", "TRANSITIONS_TO", {
          kind: "value",
          value: { from: "open", to: "closed", by: "policy:ticket:close" },
        }),
      ]),
    "IR-PREDICATE-005",
  );
  expect(wrongReferenceKind.details).toEqual({
    factId: "fact:transition",
    predicate: "TRANSITIONS_TO",
    subject: "state:ticket:status",
    object: {
      kind: "value",
      value: { from: "open", to: "closed", by: "policy:ticket:close" },
    },
    actualSubjectKind: "state",
    schemaFailures: [
      {
        schemaId: "state-transition-v1",
        failure: '$.by references entity kind "policy"; expected operation',
      },
    ],
  });

  const extraField = expectCodedFailure(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [
        fact("fact:transition", "state:ticket:status", "TRANSITIONS_TO", {
          kind: "value",
          value: {
            from: "open",
            to: "closed",
            by: "operation:ticket:close",
            opaque: true,
          },
        }),
      ]),
    "IR-PREDICATE-005",
  );
  expect(
    (extraField.details as { schemaFailures: unknown }).schemaFailures,
  ).toEqual([
    {
      schemaId: "state-transition-v1",
      failure: "$.opaque is not allowed",
    },
  ]);
});

test("reserved predicates hard fail with stable fact context", () => {
  const reserved = expectCodedFailure(
    () =>
      assertEngineeringIRPredicateSignatures(
        [
          entity("operation:ticket:first", "operation"),
          entity("operation:ticket:second", "operation"),
        ],
        [
          fact("fact:reserved", "operation:ticket:first", "FORKS_TO", {
            kind: "entity",
            entityId: "operation:ticket:second",
          }),
        ],
      ),
    "IR-PREDICATE-001",
  );

  expect(reserved.details).toEqual({
    factId: "fact:reserved",
    predicate: "FORKS_TO",
    subject: "operation:ticket:first",
    object: { kind: "entity", entityId: "operation:ticket:second" },
    reason:
      "No current canonical Fact producer has an authoritative shape for this predicate.",
  });
});
