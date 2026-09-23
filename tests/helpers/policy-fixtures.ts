import type { PolicyReport } from '../../src/semantics/policies/types.ts';

export function emptyPolicyScopeReport(): PolicyReport['project'] {
  return {
    policies: [],
    sources: [],
    violations: []
  };
}
