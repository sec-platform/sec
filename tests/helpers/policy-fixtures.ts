import type { PolicyReport } from '../../src/compiler/policies/contract/types.ts';

export function emptyPolicyScopeReport(): PolicyReport['project'] {
  return {
    policies: [],
    sources: [],
    violations: []
  };
}
