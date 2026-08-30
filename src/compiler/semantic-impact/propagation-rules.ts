import { SEMANTIC_PREDICATES, type SemanticPredicate } from '../../semantic/engineering-ir/contract/fact-types.ts';
import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';
import { CompilerError } from '../errors.ts';
import { PREDICATE_SIGNATURE_REGISTRY } from '../ir/predicate-signatures.ts';

export type ImpactPropagationRule =
  | {
      readonly action: 'edge';
      readonly direction: 'subject-to-object' | 'object-to-subject';
      readonly ruleVariantId: string;
    }
  | { readonly action: 'value-stop' }
  | { readonly action: 'verification' }
  | { readonly action: 'unknown' }
  | { readonly action: 'reserved' };

const impactPropagationRules: Record<SemanticPredicate, ImpactPropagationRule> = {
  CONTAINS: { action: 'unknown' },
  DECLARES: { action: 'unknown' },
  IMPLEMENTS: {
    action: 'edge',
    direction: 'object-to-subject',
    ruleVariantId: 'impact.implements.object-to-subject.v1'
  },
  DEPENDS_ON: {
    action: 'edge',
    direction: 'object-to-subject',
    ruleVariantId: 'impact.depends-on.object-to-subject.v1'
  },
  PROVIDES: { action: 'unknown' },
  ASSUMES: { action: 'reserved' },
  REQUIRES: {
    action: 'edge',
    direction: 'object-to-subject',
    ruleVariantId: 'impact.requires.object-to-subject.v1'
  },
  GUARANTEES: { action: 'value-stop' },
  CONNECTS_TO: { action: 'reserved' },
  INVOKES: { action: 'unknown' },
  PRECEDES: { action: 'unknown' },
  AWAITS: { action: 'unknown' },
  FORKS_TO: { action: 'reserved' },
  JOINS: { action: 'reserved' },
  RETRIES: { action: 'unknown' },
  HANDLES: { action: 'unknown' },
  EMITS: { action: 'unknown' },
  CONSUMES: { action: 'unknown' },
  FLOWS_TO: { action: 'reserved' },
  DERIVES_FROM: { action: 'reserved' },
  TRANSFORMS_TO: { action: 'reserved' },
  VALIDATES: { action: 'reserved' },
  SANITIZES: { action: 'reserved' },
  SERIALIZES_AS: { action: 'reserved' },
  DESERIALIZES_FROM: { action: 'reserved' },
  PERSISTS_AS: { action: 'reserved' },
  OWNS: { action: 'unknown' },
  READS: { action: 'unknown' },
  WRITES: { action: 'unknown' },
  MUTATES: { action: 'unknown' },
  INITIALIZES: { action: 'reserved' },
  DISPOSES: { action: 'reserved' },
  ESCAPES: { action: 'reserved' },
  TRANSITIONS_TO: { action: 'unknown' },
  PERFORMS_EFFECT: { action: 'unknown' },
  REQUIRES_PERMISSION: { action: 'unknown' },
  CROSSES_BOUNDARY: { action: 'reserved' },
  ENFORCES: { action: 'unknown' },
  VERIFIED_BY: { action: 'verification' },
  ORIGINATES_FROM: { action: 'reserved' },
  LOWERS_TO: {
    action: 'edge',
    direction: 'subject-to-object',
    ruleVariantId: 'impact.lowers-to.subject-to-object.v1'
  },
  GENERATES: { action: 'unknown' },
  VIOLATES: { action: 'reserved' }
};

for (const rule of Object.values(impactPropagationRules)) Object.freeze(rule);
export const IMPACT_PROPAGATION_RULES = Object.freeze(impactPropagationRules);

const EXPECTED_ACTION_BY_PREDICATE = {
  CONTAINS: 'unknown',
  DECLARES: 'unknown',
  IMPLEMENTS: 'edge',
  DEPENDS_ON: 'edge',
  PROVIDES: 'unknown',
  ASSUMES: 'reserved',
  REQUIRES: 'edge',
  GUARANTEES: 'value-stop',
  CONNECTS_TO: 'reserved',
  INVOKES: 'unknown',
  PRECEDES: 'unknown',
  AWAITS: 'unknown',
  FORKS_TO: 'reserved',
  JOINS: 'reserved',
  RETRIES: 'unknown',
  HANDLES: 'unknown',
  EMITS: 'unknown',
  CONSUMES: 'unknown',
  FLOWS_TO: 'reserved',
  DERIVES_FROM: 'reserved',
  TRANSFORMS_TO: 'reserved',
  VALIDATES: 'reserved',
  SANITIZES: 'reserved',
  SERIALIZES_AS: 'reserved',
  DESERIALIZES_FROM: 'reserved',
  PERSISTS_AS: 'reserved',
  OWNS: 'unknown',
  READS: 'unknown',
  WRITES: 'unknown',
  MUTATES: 'unknown',
  INITIALIZES: 'reserved',
  DISPOSES: 'reserved',
  ESCAPES: 'reserved',
  TRANSITIONS_TO: 'unknown',
  PERFORMS_EFFECT: 'unknown',
  REQUIRES_PERMISSION: 'unknown',
  CROSSES_BOUNDARY: 'reserved',
  ENFORCES: 'unknown',
  VERIFIED_BY: 'verification',
  ORIGINATES_FROM: 'reserved',
  LOWERS_TO: 'edge',
  GENERATES: 'unknown',
  VIOLATES: 'reserved'
} as const satisfies Readonly<Record<SemanticPredicate, ImpactPropagationRule['action']>>;

const EXPECTED_EDGE_RULES = {
  DEPENDS_ON: {
    direction: 'object-to-subject',
    ruleVariantId: 'impact.depends-on.object-to-subject.v1'
  },
  IMPLEMENTS: {
    direction: 'object-to-subject',
    ruleVariantId: 'impact.implements.object-to-subject.v1'
  },
  LOWERS_TO: {
    direction: 'subject-to-object',
    ruleVariantId: 'impact.lowers-to.subject-to-object.v1'
  },
  REQUIRES: {
    direction: 'object-to-subject',
    ruleVariantId: 'impact.requires.object-to-subject.v1'
  }
} as const;

function fail(message: string, details: Record<string, unknown>): never {
  throw new CompilerError('IMPACT-003', message, details);
}

export function assertImpactPropagationRuleRegistry(
  registry: Readonly<Record<SemanticPredicate, ImpactPropagationRule>> = IMPACT_PROPAGATION_RULES
): void {
  const keys = Object.keys(registry).sort(compareCodeUnits);
  const predicates = [...SEMANTIC_PREDICATES].sort(compareCodeUnits);
  if (JSON.stringify(keys) !== JSON.stringify(predicates)) {
    fail('Impact propagation registry must cover every Semantic Predicate exactly once', {
      expected: predicates,
      actual: keys
    });
  }

  const variantIds = new Set<string>();
  for (const predicate of SEMANTIC_PREDICATES) {
    const rule = registry[predicate];
    const signature = PREDICATE_SIGNATURE_REGISTRY[predicate];
    const expectedAction = EXPECTED_ACTION_BY_PREDICATE[predicate];
    if (rule.action !== expectedAction) {
      fail(`Impact rule "${predicate}" must retain its frozen v1 action`, {
        predicate,
        expectedAction,
        actualAction: rule.action
      });
    }
    if (signature.status === 'reserved' && rule.action !== 'reserved') {
      fail(`Reserved predicate "${predicate}" cannot have an executable Impact rule`, {
        predicate,
        action: rule.action
      });
    }
    if (signature.status === 'active' && rule.action === 'reserved') {
      fail(`Active predicate "${predicate}" needs an explicit Impact action`, {
        predicate,
        action: rule.action
      });
    }
    if (rule.action !== 'edge') continue;
    if (!rule.ruleVariantId.trim() || variantIds.has(rule.ruleVariantId)) {
      fail(`Impact edge rule "${predicate}" has an invalid or duplicate variant ID`, {
        predicate,
        ruleVariantId: rule.ruleVariantId
      });
    }
    variantIds.add(rule.ruleVariantId);
  }

  for (const [predicate, expected] of Object.entries(EXPECTED_EDGE_RULES) as Array<
    [keyof typeof EXPECTED_EDGE_RULES, (typeof EXPECTED_EDGE_RULES)[keyof typeof EXPECTED_EDGE_RULES]]
  >) {
    const rule = registry[predicate];
    if (
      rule.action !== 'edge' ||
      rule.direction !== expected.direction ||
      rule.ruleVariantId !== expected.ruleVariantId
    ) {
      fail(`Impact edge rule "${predicate}" must match the frozen v1 tuple`, {
        predicate,
        expected,
        actual: rule
      });
    }
  }
  const unexpectedEdge = SEMANTIC_PREDICATES.find((predicate) =>
    registry[predicate].action === 'edge' && !(predicate in EXPECTED_EDGE_RULES)
  );
  if (unexpectedEdge) {
    fail(`Impact v1 registry contains unexpected executable edge "${unexpectedEdge}"`, {
      predicate: unexpectedEdge,
      rule: registry[unexpectedEdge]
    });
  }
}
