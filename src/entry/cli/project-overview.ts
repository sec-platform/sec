import type { ProjectOverview } from '../../application/project-overview.ts';

export type ProjectOverviewPresentation = Readonly<{
  explainCommand: string;
  verifyCompactCommand: string;
  graphArtifactPath: string;
  reviewArtifactPath: string;
}>;

export function formatProjectOverview(
  overview: ProjectOverview,
  presentation: ProjectOverviewPresentation
): string {
  return [
    `Project overview ${overview.status.overall}`,
    `Workspace: ${overview.workspace.modelRoot}/${overview.workspace.srcRoot}/${overview.workspace.testsRoot}/${overview.workspace.secRoot} ready`,
    `Verification: ${overview.status.verification}; policy: ${overview.status.policy}; coverage: ${overview.status.coverage}; artifacts: ${overview.status.artifacts}`,
    `Graph: ${overview.aiContext.graphNodeCount} nodes / ${overview.aiContext.graphEdgeCount} edges; blocks=${overview.aiContext.blockCount}`,
    `Risks: failures=${overview.risks.failureCount}; regressions=${overview.risks.regressionRiskCount}; conflicts=${overview.risks.conflictHintCount}; missingArtifacts=${overview.risks.missingArtifactCount}`,
    `Machine artifacts: ${presentation.graphArtifactPath} | ${presentation.reviewArtifactPath}`,
    `Next: ${presentation.explainCommand} | ${presentation.verifyCompactCommand}`
  ].join('\n');
}
