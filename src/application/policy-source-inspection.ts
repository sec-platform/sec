import { compareCodeUnits } from '../contracts/canonical.ts';

export type PolicySourceInspectionSource = Readonly<{
  status: string;
  official: Readonly<{
    sources: readonly Readonly<{ path: string; policyIds: readonly string[] }>[];
  }>;
  project: Readonly<{
    sources: readonly Readonly<{ path: string; policyIds: readonly string[] }>[];
  }>;
}>;

export type PolicySourceInspect = Readonly<{
  status: string;
  sourceCount: number;
  policyCount: number;
  sources: Array<{
    scope: 'official' | 'project';
    path: string;
    policyCount: number;
    policyIds: string[];
  }>;
}>;

export function projectPolicySources(report: PolicySourceInspectionSource): PolicySourceInspect {
  const snapshot = (
    source: Readonly<{ path: string; policyIds: readonly string[] }>,
    scope: 'official' | 'project'
  ) => {
    const policyIds = [...source.policyIds];
    return { scope, path: source.path, policyCount: policyIds.length, policyIds };
  };

  const sources = [
    ...report.official.sources.map((source) => snapshot(source, 'official')),
    ...report.project.sources.map((source) => snapshot(source, 'project'))
  ].sort((left, right) =>
    compareCodeUnits(left.scope, right.scope) || compareCodeUnits(left.path, right.path)
  );

  return {
    status: report.status,
    sourceCount: sources.length,
    policyCount: sources.reduce((count, source) => count + source.policyCount, 0),
    sources
  };
}
