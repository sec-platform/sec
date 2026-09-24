import { platformCommand } from '../../adapters/verification/platform/command.ts';
import { getWorkspacePaths } from '../../adapters/workspace-context.ts';
import { readProjectOverviewArtifacts } from '../../adapters/workspace/project-overview-read.ts';
import type { BuildProjectOverviewInput as ApplicationOverviewInput, ProjectOverview, ProjectOverviewWorkspace } from '../../application/project-overview.ts';
import { buildProjectOverview as buildApplicationProjectOverview } from '../../application/project-overview.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';

export type {
  ProjectOverview,
  ProjectOverviewAiContext,
  ProjectOverviewArtifactId,
  ProjectOverviewNavigation,
  ProjectOverviewPriorityFile,
  ProjectOverviewRisks,
  ProjectOverviewStatus,
  ProjectOverviewStatusValue,
  ProjectOverviewWorkspace
} from '../../application/project-overview.ts';

export type BuildProjectOverviewInput = Omit<ApplicationOverviewInput, 'workspace' | 'generatedAt'> & {
  workspaceRoot: string;
  generatedAt?: string;
};

function buildWorkspaceSummary(workspaceRoot: string): ProjectOverviewWorkspace {
  const paths = getWorkspacePaths(workspaceRoot);
  return {
    root: '.',
    modelRoot: relativePosixPath(paths.workspaceRoot, paths.modelRoot),
    srcRoot: relativePosixPath(paths.workspaceRoot, paths.srcRoot),
    testsRoot: relativePosixPath(paths.workspaceRoot, paths.testsRoot),
    prismaRoot: relativePosixPath(paths.workspaceRoot, paths.prismaRoot),
    secRoot: relativePosixPath(paths.workspaceRoot, paths.secRoot),
    artifactsRoot: relativePosixPath(paths.workspaceRoot, paths.artifactsRoot)
  };
}

export function buildProjectOverview(input: BuildProjectOverviewInput): ProjectOverview {
  return buildApplicationProjectOverview({
    workspace: buildWorkspaceSummary(input.workspaceRoot),
    lock: input.lock,
    explainGraph: input.explainGraph,
    provenance: input.provenance,
    verification: input.verification,
    acceptanceCoverage: input.acceptanceCoverage,
    policy: input.policy,
    reviewSummary: input.reviewSummary,
    artifactManifest: input.artifactManifest,
    generatedAt: input.generatedAt ?? new Date().toISOString()
  });
}

export function buildProjectOverviewFromWorkspace(workspaceRoot = process.cwd()): ProjectOverview {
  return buildProjectOverview(readProjectOverviewArtifacts(workspaceRoot, platformCommand('explain')));
}
