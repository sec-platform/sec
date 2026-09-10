import { z } from 'zod';
import { isCanonicalBlockId } from '../../../semantic/identity/contract/block.ts';
import { canonicalEquals, uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { isCanonicalPolicyId } from './identity.ts';
import { POLICY_RULE_IDS } from './rules.ts';

// One source-declaration contract; its validity is neither a write grant nor
// proof that an evaluator established a semantic Policy claim. The existing
// identity/rule owners and evaluator assurance remain separate.
export const PolicySeveritySchema = z.enum(['info', 'warn', 'error', 'blocker']);

export const PolicyRuleSchema = z.object({
  id: z.string().refine(isCanonicalPolicyId, 'Policy id must be one canonical lowercase token'),
  severity: PolicySeveritySchema,
  appliesTo: z.array(z.string()).min(1),
  rule: z.enum(POLICY_RULE_IDS)
}).strict().superRefine((policy, context) => {
  for (let index = 0; index < policy.appliesTo.length; index += 1) {
    const blockId = policy.appliesTo[index]!;
    if (!isCanonicalBlockId(blockId)) {
      context.addIssue({
        code: 'custom',
        path: ['appliesTo', index],
        message: 'Policy appliesTo entries must be canonical Block IDs'
      });
    }
  }
  if (!canonicalEquals(policy.appliesTo, uniqueSorted(policy.appliesTo))) {
    context.addIssue({
      code: 'custom',
      path: ['appliesTo'],
      message: 'Policy appliesTo entries must be unique and canonically ordered'
    });
  }
});

function canonicalPolicyValue(policy: z.output<typeof PolicyRuleSchema>): string {
  return JSON.stringify({
    id: policy.id,
    severity: policy.severity,
    appliesTo: policy.appliesTo,
    rule: policy.rule
  });
}

export const PolicySpecSchema = z.object({
  policies: z.array(PolicyRuleSchema)
}).strict().superRefine((spec, context) => {
  // Canonical-equal duplicate declarations carry no additional semantics; only
  // conflicting duplicates (same id with a differing canonical value) are rejected.
  const seen = new Map<string, string>();
  for (let index = 0; index < spec.policies.length; index += 1) {
    const policy = spec.policies[index]!;
    const canonical = canonicalPolicyValue(policy);
    const previous = seen.get(policy.id);
    if (previous !== undefined && previous !== canonical) {
      context.addIssue({
        code: 'custom',
        path: ['policies', index, 'id'],
        message: `Conflicting duplicate policy id in one source: ${policy.id}`
      });
    }
    seen.set(policy.id, canonical);
  }
});


export type PolicySeverity = z.infer<typeof PolicySeveritySchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type PolicySpec = z.infer<typeof PolicySpecSchema>;
