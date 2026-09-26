import { compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import { FailureError as CompilerError } from '../../contracts/failure.ts';
import { type SemanticEntity, type SemanticEntityKind } from './entity-types.ts';
import { SEMANTIC_PREDICATES, type SemanticFact, type SemanticValue } from './fact-types.ts';
import { type PredicateSignatureRegistry, type PredicateSignatureVariant, type PredicateValueSchema } from './predicate-signature-types.ts';

const RESERVED = {
  status: "reserved",
  reason:
    "No current canonical Fact producer has an authoritative shape for this predicate.",
} as const;

export const PREDICATE_SIGNATURE_REGISTRY: PredicateSignatureRegistry = {
  CONTAINS: {
    status: "active",
    variants: [
      {
        id: "app-contains-block",
        subjectKinds: ["app"],
        object: { kind: "entity", entityKinds: ["block"] },
      },
      {
        id: "entity-contains-field",
        subjectKinds: ["entity"],
        object: { kind: "entity", entityKinds: ["field"] },
      },
      {
        id: "scenario-contains-step",
        subjectKinds: ["scenario"],
        object: { kind: "entity", entityKinds: ["scenario-step"] },
      },
      {
        id: "responsibility-contains-binding",
        subjectKinds: ["responsibility"],
        object: { kind: "entity", entityKinds: ["responsibility-binding"] },
      },
    ],
  },
  DECLARES: {
    status: "active",
    variants: [
      {
        id: "block-declares-contract-entity",
        subjectKinds: ["block"],
        object: {
          kind: "entity",
          entityKinds: [
            "entity",
            "field",
            "responsibility",
            "responsibility-binding",
            "operation",
            "event",
            "policy",
            "permission",
            "effect",
            "state",
            "scenario",
            "scenario-step",
            "generator",
          ],
        },
      },
      {
        id: "state-declares-field",
        subjectKinds: ["state"],
        object: { kind: "entity", entityKinds: ["field"] },
      },
    ],
  },
  IMPLEMENTS: {
    status: "active",
    variants: [
      {
        id: "responsibility-implements-operation",
        subjectKinds: ["responsibility"],
        object: { kind: "entity", entityKinds: ["operation"] },
      },
    ],
  },
  DEPENDS_ON: {
    status: "active",
    variants: [
      {
        id: "block-depends-on-capability",
        subjectKinds: ["block"],
        object: { kind: "entity", entityKinds: ["capability"] },
      },
      {
        id: "responsibility-depends-on-responsibility",
        subjectKinds: ["responsibility"],
        object: { kind: "entity", entityKinds: ["responsibility"] },
      },
    ],
  },
  PROVIDES: {
    status: "active",
    variants: [
      {
        id: "block-provides-capability-or-port",
        subjectKinds: ["block"],
        object: { kind: "entity", entityKinds: ["capability", "port"] },
      },
    ],
  },
  ASSUMES: RESERVED,
  REQUIRES: {
    status: "active",
    variants: [
      {
        id: "block-requires-port",
        subjectKinds: ["block"],
        object: { kind: "entity", entityKinds: ["port"] },
      },
      {
        id: "operation-requires-policy",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["policy"] },
      },
    ],
  },
  GUARANTEES: {
    status: "active",
    variants: [
      {
        id: "state-guarantees-value",
        subjectKinds: ["state"],
        object: {
          kind: "value",
          schemaId: "state-value-v1",
          schema: { kind: "string" },
        },
      },
    ],
  },
  CONNECTS_TO: RESERVED,
  INVOKES: {
    status: "active",
    variants: [
      {
        id: "operation-invokes-operation",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["operation"] },
      },
      {
        id: "scenario-invokes-entry-operation",
        subjectKinds: ["scenario"],
        object: { kind: "entity", entityKinds: ["operation"] },
      },
      {
        id: "scenario-step-invokes-operation",
        subjectKinds: ["scenario-step"],
        object: { kind: "entity", entityKinds: ["operation"] },
      },
    ],
  },
  PRECEDES: {
    status: "active",
    variants: [
      {
        id: "scenario-step-precedes-step",
        subjectKinds: ["scenario-step"],
        object: { kind: "entity", entityKinds: ["scenario-step"] },
      },
    ],
  },
  AWAITS: {
    status: "active",
    variants: [
      {
        id: "operation-awaits-operation",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["operation"] },
      },
      {
        id: "scenario-step-awaits-operation",
        subjectKinds: ["scenario-step"],
        object: { kind: "entity", entityKinds: ["operation"] },
      },
    ],
  },
  FORKS_TO: RESERVED,
  JOINS: RESERVED,
  RETRIES: {
    status: "active",
    variants: [
      {
        id: "scenario-step-retries-value",
        subjectKinds: ["scenario-step"],
        object: {
          kind: "value",
          schemaId: "scenario-retry-v1",
          schema: {
            kind: "object",
            additionalFields: false,
            fields: {
              maxAttempts: { kind: "number", integer: true, minimum: 1 },
            },
          },
        },
      },
    ],
  },
  HANDLES: {
    status: "active",
    variants: [
      {
        id: "scenario-step-handles-step",
        subjectKinds: ["scenario-step"],
        object: { kind: "entity", entityKinds: ["scenario-step"] },
      },
    ],
  },
  EMITS: {
    status: "active",
    variants: [
      {
        id: "operation-emits-event",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["event"] },
      },
    ],
  },
  CONSUMES: {
    status: "active",
    variants: [
      {
        id: "generator-consumes-state",
        subjectKinds: ["generator"],
        object: { kind: "entity", entityKinds: ["state"] },
      },
    ],
  },
  FLOWS_TO: {
    status: "active",
    variants: [
      {
        id: "capability-flows-to-source-artifact",
        subjectKinds: ["capability"],
        object: { kind: "entity", entityKinds: ["artifact"] },
      },
    ],
  },
  DERIVES_FROM: RESERVED,
  TRANSFORMS_TO: RESERVED,
  VALIDATES: RESERVED,
  SANITIZES: RESERVED,
  SERIALIZES_AS: RESERVED,
  DESERIALIZES_FROM: RESERVED,
  PERSISTS_AS: RESERVED,
  OWNS: {
    status: "active",
    variants: [
      {
        id: "responsibility-owns-semantic-state",
        subjectKinds: ["responsibility"],
        object: { kind: "entity", entityKinds: ["entity", "field", "state"] },
      },
    ],
  },
  READS: {
    status: "active",
    variants: [
      {
        id: "operation-reads-data",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["entity", "field"] },
      },
    ],
  },
  WRITES: {
    status: "active",
    variants: [
      {
        id: "operation-writes-data",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["entity", "field"] },
      },
    ],
  },
  MUTATES: {
    status: "active",
    variants: [
      {
        id: "operation-mutates-data-or-state",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["entity", "field", "state"] },
      },
    ],
  },
  INITIALIZES: RESERVED,
  DISPOSES: RESERVED,
  ESCAPES: RESERVED,
  TRANSITIONS_TO: {
    status: "active",
    variants: [
      {
        id: "state-transitions-to-value",
        subjectKinds: ["state"],
        object: {
          kind: "value",
          schemaId: "state-transition-v1",
          schema: {
            kind: "object",
            additionalFields: false,
            fields: {
              from: { kind: "string" },
              to: { kind: "string" },
              by: { kind: "entity-reference", entityKinds: ["operation"] },
            },
          },
        },
      },
    ],
  },
  PERFORMS_EFFECT: {
    status: "active",
    variants: [
      {
        id: "operation-performs-effect",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["effect"] },
      },
    ],
  },
  REQUIRES_PERMISSION: {
    status: "active",
    variants: [
      {
        id: "operation-requires-permission",
        subjectKinds: ["operation"],
        object: { kind: "entity", entityKinds: ["permission"] },
      },
    ],
  },
  CROSSES_BOUNDARY: RESERVED,
  ENFORCES: {
    status: "active",
    variants: [
      {
        id: "verification-policy-enforces-semantic-policy",
        subjectKinds: ["policy"],
        object: { kind: "entity", entityKinds: ["policy"] },
      },
    ],
  },
  VERIFIED_BY: {
    status: "active",
    variants: [
      {
        id: "scenario-verified-by-acceptance",
        subjectKinds: ["scenario"],
        object: { kind: "entity", entityKinds: ["acceptance"] },
      },
      {
        id: "semantic-policy-verified-by-verification-policy",
        subjectKinds: ["policy"],
        object: { kind: "entity", entityKinds: ["policy"] },
      },
      {
        id: "artifact-verified-by-acceptance",
        subjectKinds: ["artifact"],
        object: { kind: "entity", entityKinds: ["acceptance"] },
      },
      {
        id: "artifact-verified-by-selector",
        subjectKinds: ["artifact"],
        object: {
          kind: "value",
          schemaId: "artifact-verification-selector-v1",
          schema: {
            kind: "object",
            fields: { selector: { kind: "string" } },
            additionalFields: false,
          },
        },
      },
    ],
  },
  ORIGINATES_FROM: RESERVED,
  LOWERS_TO: {
    status: "active",
    variants: [
      {
        id: "state-lowers-to-artifact",
        subjectKinds: ["state"],
        object: { kind: "entity", entityKinds: ["artifact"] },
      },
    ],
  },
  GENERATES: {
    status: "active",
    variants: [
      {
        id: "generator-generates-artifact",
        subjectKinds: ["generator"],
        object: { kind: "entity", entityKinds: ["artifact"] },
      },
    ],
  },
  VIOLATES: RESERVED,
};

function intersects<Value extends string>(
  left: readonly Value[],
  right: readonly Value[],
): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function valueSchemasOverlap(
  left: PredicateValueSchema,
  right: PredicateValueSchema,
): boolean {
  if (left.kind === "entity-reference" && right.kind === "string") return true;
  if (left.kind === "string" && right.kind === "entity-reference") return true;
  return left.kind === right.kind;
}

function variantsOverlap(
  left: PredicateSignatureVariant,
  right: PredicateSignatureVariant,
): boolean {
  if (
    !intersects(left.subjectKinds, right.subjectKinds) ||
    left.object.kind !== right.object.kind
  )
    return false;
  if (left.object.kind === "entity" && right.object.kind === "entity") {
    return intersects(left.object.entityKinds, right.object.entityKinds);
  }
  if (left.object.kind === "value" && right.object.kind === "value") {
    return valueSchemasOverlap(left.object.schema, right.object.schema);
  }
  return false;
}

export function assertPredicateSignatureRegistry(): void {
  for (const predicate of SEMANTIC_PREDICATES) {
    const signature = PREDICATE_SIGNATURE_REGISTRY[predicate];
    if (signature.status === "reserved") continue;
    if (signature.variants.length === 0) {
      throw new CompilerError(
        "IR-PREDICATE-006",
        `Predicate "${predicate}" has no active signature variants`,
        { predicate },
      );
    }

    const variantIds = new Set<string>();
    for (const [index, variant] of signature.variants.entries()) {
      if (
        variantIds.has(variant.id) ||
        variant.subjectKinds.length === 0 ||
        (variant.object.kind === "entity" &&
          variant.object.entityKinds.length === 0)
      ) {
        throw new CompilerError(
          "IR-PREDICATE-006",
          `Predicate "${predicate}" has an invalid signature variant "${variant.id}"`,
          {
            predicate,
            variantId: variant.id,
          },
        );
      }
      variantIds.add(variant.id);

      for (const candidate of signature.variants.slice(index + 1)) {
        if (variantsOverlap(variant, candidate)) {
          throw new CompilerError(
            "IR-PREDICATE-006",
            `Predicate "${predicate}" has ambiguous signature variants "${variant.id}" and "${candidate.id}"`,
            {
              predicate,
              variantIds: [variant.id, candidate.id].sort(),
            },
          );
        }
      }
    }
  }
}

function validateValue(
  value: SemanticValue,
  schema: PredicateValueSchema,
  entityById: ReadonlyMap<string, SemanticEntity>,
  path = "$",
): string | undefined {
  switch (schema.kind) {
    case "string":
      return typeof value === "string" ? undefined : `${path} must be a string`;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        return `${path} must be a finite number`;
      if (schema.integer && !Number.isInteger(value))
        return `${path} must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum)
        return `${path} must be at least ${schema.minimum}`;
      return undefined;
    case "boolean":
      return typeof value === "boolean"
        ? undefined
        : `${path} must be a boolean`;
    case "null":
      return value === null ? undefined : `${path} must be null`;
    case "entity-reference": {
      if (typeof value !== "string")
        return `${path} must be an entity reference string`;
      const entity = entityById.get(value);
      if (!entity) return `${path} references missing entity "${value}"`;
      return schema.entityKinds.includes(entity.kind)
        ? undefined
        : `${path} references entity kind "${entity.kind}"; expected ${uniqueSorted(schema.entityKinds).join("|")}`;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value))
        return `${path} must be an object`;
      const valueObject = value as Record<string, SemanticValue>;
      const expectedKeys = Object.keys(schema.fields).sort((left, right) =>
        compareCodeUnits(left, right),
      );
      const actualKeys = Object.keys(valueObject).sort((left, right) =>
        compareCodeUnits(left, right),
      );
      for (const key of expectedKeys) {
        if (!Object.hasOwn(valueObject, key))
          return `${path}.${key} is required`;
        const failure = validateValue(
          valueObject[key]!,
          schema.fields[key]!,
          entityById,
          `${path}.${key}`,
        );
        if (failure) return failure;
      }
      if (!schema.additionalFields) {
        const additionalKey = actualKeys.find(
          (key) => !Object.hasOwn(schema.fields, key),
        );
        if (additionalKey) return `${path}.${additionalKey} is not allowed`;
      }
      return undefined;
    }
  }
}

function factContext(fact: SemanticFact): Record<string, unknown> {
  return {
    factId: fact.id,
    predicate: fact.predicate,
    subject: fact.subject,
    object: fact.object,
  };
}

function subjectKindOf(
  entityById: ReadonlyMap<string, SemanticEntity>,
  fact: SemanticFact,
): SemanticEntityKind | undefined {
  return entityById.get(fact.subject)?.kind;
}

export function assertEngineeringIRPredicateSignatures(
  entities: readonly SemanticEntity[],
  facts: readonly SemanticFact[],
): void {
  assertPredicateSignatureRegistry();
  const entityById = new Map(
    entities.map((entity) => [entity.id, entity] as const),
  );

  for (const fact of [...facts].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  )) {
    const signature = PREDICATE_SIGNATURE_REGISTRY[fact.predicate];
    if (signature.status === "reserved") {
      throw new CompilerError(
        "IR-PREDICATE-001",
        `Fact "${fact.id}" uses reserved predicate "${fact.predicate}"`,
        {
          ...factContext(fact),
          reason: signature.reason,
        },
      );
    }

    const subjectKind = subjectKindOf(entityById, fact);
    const subjectVariants = signature.variants.filter(
      (variant) =>
        subjectKind !== undefined && variant.subjectKinds.includes(subjectKind),
    );
    if (subjectVariants.length === 0) {
      throw new CompilerError(
        "IR-PREDICATE-002",
        `Fact "${fact.id}" predicate "${fact.predicate}" rejects subject "${fact.subject}"`,
        {
          ...factContext(fact),
          actualSubjectKind: subjectKind ?? null,
          expectedSubjectKinds: uniqueSorted(
            signature.variants.flatMap((variant) => variant.subjectKinds),
          ),
        },
      );
    }

    const objectVariants = subjectVariants.filter(
      (variant) => variant.object.kind === fact.object.kind,
    );
    if (objectVariants.length === 0) {
      throw new CompilerError(
        "IR-PREDICATE-003",
        `Fact "${fact.id}" predicate "${fact.predicate}" rejects object kind "${fact.object.kind}"`,
        {
          ...factContext(fact),
          actualSubjectKind: subjectKind,
          expectedObjectKinds: uniqueSorted(
            subjectVariants.map((variant) => variant.object.kind),
          ),
        },
      );
    }

    if (fact.object.kind === "entity") {
      const objectEntityKind = entityById.get(fact.object.entityId)?.kind;
      const matchingVariants = objectVariants.filter(
        (variant) =>
          variant.object.kind === "entity" &&
          objectEntityKind !== undefined &&
          variant.object.entityKinds.includes(objectEntityKind),
      );
      if (matchingVariants.length === 0) {
        const expectedEntityKinds = objectVariants.flatMap((variant) =>
          variant.object.kind === "entity" ? variant.object.entityKinds : [],
        );
        throw new CompilerError(
          "IR-PREDICATE-004",
          `Fact "${fact.id}" predicate "${fact.predicate}" rejects entity object "${fact.object.entityId}"`,
          {
            ...factContext(fact),
            actualSubjectKind: subjectKind,
            actualEntityObjectKind: objectEntityKind ?? null,
            expectedEntityObjectKinds: uniqueSorted(expectedEntityKinds),
          },
        );
      }
      if (matchingVariants.length > 1) {
        throw new CompilerError(
          "IR-PREDICATE-006",
          `Fact "${fact.id}" predicate "${fact.predicate}" matches ambiguous signature variants`,
          {
            ...factContext(fact),
            variantIds: matchingVariants.map((variant) => variant.id).sort(),
          },
        );
      }
      continue;
    }

    const factValue = fact.object.value;
    const failures: { schemaId: string; failure: string }[] = [];
    const matchingVariants = objectVariants.filter((variant) => {
      if (variant.object.kind !== "value") return false;
      const failure = validateValue(
        factValue,
        variant.object.schema,
        entityById,
      );
      if (failure)
        failures.push({ schemaId: variant.object.schemaId, failure });
      return failure === undefined;
    });
    if (matchingVariants.length === 0) {
      throw new CompilerError(
        "IR-PREDICATE-005",
        `Fact "${fact.id}" predicate "${fact.predicate}" rejects value object`,
        {
          ...factContext(fact),
          actualSubjectKind: subjectKind,
          schemaFailures: failures.sort((left, right) =>
            compareCodeUnits(left.schemaId, right.schemaId),
          ),
        },
      );
    }
    if (matchingVariants.length > 1) {
      throw new CompilerError(
        "IR-PREDICATE-006",
        `Fact "${fact.id}" predicate "${fact.predicate}" matches ambiguous signature variants`,
        {
          ...factContext(fact),
          variantIds: matchingVariants.map((variant) => variant.id).sort(),
        },
      );
    }
  }
}
