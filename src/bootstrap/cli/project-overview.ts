import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import { getWorkspacePaths } from '../../adapters/workspace-context.ts';
import { readProjectOverviewArtifacts } from '../../adapters/workspace/project-overview-read.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import { platformCommand } from '../../adapters/verification/platform/sec-command.ts';
import { buildProjectOverview as buildApplicationProjectOverview } from '../../application/project-overview.ts';
import type { BuildProjectOverviewInput as ApplicationOverviewInput, ProjectOverview, ProjectOverviewWorkspace } from '../../application/project-overview.ts';
import { formatProjectOverview as formatEntryProjectOverview } from '../../entry/cli/project-overview.ts';

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

export function formatProjectOverview(overview: ProjectOverview): string {
  return formatEntryProjectOverview(overview, {
    explainCommand: platformCommand('explain'),
    verifyCompactCommand: platformCommand('verify', '--json', '--compact'),
    graphArtifactPath: CI_ARTIFACT_FILES.explainGraph,
    reviewArtifactPath: CI_ARTIFACT_FILES.reviewSummary
  });
}
