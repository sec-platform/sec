import { expect, test } from "bun:test";

import { CompilerError } from "../../src/compiler/errors.ts";
import {
  PREDICATE_SIGNATURE_REGISTRY,
  assertEngineeringIRPredicateSignatures,
  assertPredicateSignatureRegistry,
} from "../../src/compiler/ir/predicate-signatures.ts";
import { TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE, policySemanticRule } from '../../src/compiler/policies/contract/rules.ts';
import { type SemanticEntity, type SemanticEntityKind } from '../../src/semantic/engineering-ir/contract/entity-types.ts';
import { SEMANTIC_PREDICATES, type SemanticFact, type SemanticFactObject, type SemanticPredicate } from '../../src/semantic/engineering-ir/contract/fact-types.ts';

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

function expectCompilerError(run: () => unknown, code: string): CompilerError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return error as CompilerError;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

test("predicate registry owns every SemanticPredicate with a valid signature", () => {
  expect(Object.keys(PREDICATE_SIGNATURE_REGISTRY).sort()).toEqual(
    [...SEMANTIC_PREDICATES].sort(),
  );
  expect(() => assertPredicateSignatureRegistry()).not.toThrow();
});

test("the policy predicate accepts only capability-to-artifact facts", () => {
  const predicate = policySemanticRule(TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE).requiredPredicate;
  const capability = entity('capability:tenant/context', 'capability');
  const artifact = entity('artifact:customer-service', 'artifact');
  expect(() => assertEngineeringIRPredicateSignatures(
    [capability, artifact],
    [fact('fact:tenant-flow', capability.id, predicate, { kind: 'entity', entityId: artifact.id })]
  )).not.toThrow();
  expectCompilerError(
    () => assertEngineeringIRPredicateSignatures(
      [entity('block:tenant', 'block'), artifact],
      [fact('fact:invalid-tenant-flow', 'block:tenant', predicate, { kind: 'entity', entityId: artifact.id })]
    ),
    'IR-PREDICATE-002'
  );
});

test("controlled multi-variant predicates are statically unambiguous", () => {
  expect(() => assertPredicateSignatureRegistry()).not.toThrow();
  const dependsOn = PREDICATE_SIGNATURE_REGISTRY.DEPENDS_ON;
  expect(dependsOn.status).toBe("active");
  if (dependsOn.status !== "active")
    throw new Error("DEPENDS_ON must be active");
  expect(dependsOn.variants.map((variant) => variant.id)).toEqual([
    "block-depends-on-capability",
    "responsibility-depends-on-responsibility",
  ]);

  const entities = [
    entity("block:ticket", "block"),
    entity("capability:auth", "capability"),
    entity("responsibility:ticket:api", "responsibility"),
    entity("responsibility:ticket:storage", "responsibility"),
  ];
  expect(() =>
    assertEngineeringIRPredicateSignatures(entities, [
      fact("fact:block-dependency", "block:ticket", "DEPENDS_ON", {
        kind: "entity",
        entityId: "capability:auth",
      }),
      fact(
        "fact:responsibility-dependency",
        "responsibility:ticket:api",
        "DEPENDS_ON",
        { kind: "entity", entityId: "responsibility:ticket:storage" },
      ),
    ]),
  ).not.toThrow();
});

test("entity-object signatures accept legal kinds and reject illegal kinds deterministically", () => {
  const entities = [
    entity("app:ticket", "app"),
    entity("block:ticket", "block"),
    entity("operation:ticket:create", "operation"),
  ];
  expect(() =>
    assertEngineeringIRPredicateSignatures(entities, [
      fact("fact:contains-block", "app:ticket", "CONTAINS", {
        kind: "entity",
        entityId: "block:ticket",
      }),
    ]),
  ).not.toThrow();

  const invalidA = fact("fact:a", "app:ticket", "CONTAINS", {
    kind: "entity",
    entityId: "operation:ticket:create",
  });
  const invalidZ = fact("fact:z", "app:ticket", "CONTAINS", {
    kind: "entity",
    entityId: "operation:ticket:create",
  });
  const first = expectCompilerError(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [invalidZ, invalidA]),
    "IR-PREDICATE-004",
  );
  const second = expectCompilerError(
    () =>
      assertEngineeringIRPredicateSignatures(entities, [invalidA, invalidZ]),
    "IR-PREDICATE-004",
  );

  expect(first.message).toBe(
    'Fact "fact:a" predicate "CONTAINS" rejects entity object "operation:ticket:create"',
  );
  expect(second.message).toBe(first.message);
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
  const secondStepId = `${scenarioId}#step:second`;
  const entities = [
    entity(scenarioId, "scenario"),
    entity(firstStepId, "scenario-step"),
    entity(secondStepId, "scenario-step"),
    entity("operation:flow:run", "operation"),
    entity("acceptance:flow_runs", "acceptance"),
  ];

  expect(() =>
    assertEngineeringIRPredicateSignatures(entities, [
      fact("fact:contains-step", scenarioId, "CONTAINS", {
        kind: "entity",
        entityId: firstStepId,
      }),
      fact("fact:entry", scenarioId, "INVOKES", {
        kind: "entity",
        entityId: "operation:flow:run",
      }),
      fact("fact:step-operation", firstStepId, "INVOKES", {
        kind: "entity",
        entityId: "operation:flow:run",
      }),
      fact("fact:await", firstStepId, "AWAITS", {
        kind: "entity",
        entityId: "operation:flow:run",
      }),
      fact("fact:precedes", firstStepId, "PRECEDES", {
        kind: "entity",
        entityId: secondStepId,
      }),
      fact("fact:handles", secondStepId, "HANDLES", {
        kind: "entity",
        entityId: firstStepId,
      }),
      fact("fact:retry", firstStepId, "RETRIES", {
        kind: "value",
        value: { maxAttempts: 2 },
      }),
      fact("fact:verified", scenarioId, "VERIFIED_BY", {
        kind: "entity",
        entityId: "acceptance:flow_runs",
      }),
    ]),
  ).not.toThrow();

  const invalidRetry = expectCompilerError(
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
  expect(() =>
    assertEngineeringIRPredicateSignatures(entities, [
      fact("fact:guarantee", "state:ticket:status", "GUARANTEES", {
        kind: "value",
        value: "closed",
      }),
      fact("fact:transition", "state:ticket:status", "TRANSITIONS_TO", {
        kind: "value",
        value: { from: "open", to: "closed", by: "operation:ticket:close" },
      }),
    ]),
  ).not.toThrow();

  const wrongReferenceKind = expectCompilerError(
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

  const extraField = expectCompilerError(
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
  const reserved = expectCompilerError(
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

  expect(reserved.message).toBe(
    'Fact "fact:reserved" uses reserved predicate "FORKS_TO"',
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
