import type { SemanticPredicate } from '../../../semantic/engineering-ir/contract/fact-types.ts';

export const TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE =
  'tenant_context_must_flow_to_query' as const;

export const POLICY_RULE_IDS = [TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE] as const;

export type PolicyRuleId = (typeof POLICY_RULE_IDS)[number];

export interface PolicySemanticRuleDefinition {
  readonly requiredPredicate: SemanticPredicate;
  readonly sourceCapability: string;
  readonly targetProperty: string;
}

const POLICY_SEMANTIC_RULES: Readonly<Record<PolicyRuleId, PolicySemanticRuleDefinition>> =
  Object.freeze({
    [TENANT_CONTEXT_MUST_FLOW_TO_QUERY_RULE]: Object.freeze({
      requiredPredicate: 'FLOWS_TO',
      sourceCapability: 'tenant/context',
      targetProperty: 'tenantId'
    })
  });

export function isPolicyRuleId(value: unknown): value is PolicyRuleId {
  return typeof value === 'string' && POLICY_RULE_IDS.includes(value as PolicyRuleId);
}

export function policySemanticRule(rule: PolicyRuleId): PolicySemanticRuleDefinition {
  return POLICY_SEMANTIC_RULES[rule];
}
