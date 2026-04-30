import type { PolicyReport } from '../../platform/shared/types.ts';

export function emptyPolicyScopeReport(): PolicyReport['project'] {
  return {
    policies: [],
    sources: [],
    violations: []
  };
}
