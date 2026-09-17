import { countMatching } from '../../contracts/collections.ts';
import { CI_ARTIFACT_FILES, CI_EXPLAIN_GRAPH_ARTIFACTS } from '../../verification/ci-artifacts/contract/manifest.ts';
import { pathExists } from "../../adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../adapters/workspace-context.ts";
import { platformCommand } from './contract/command.ts';
import type { DemoChecklist, DemoChecklistItem } from './formatters.ts';

export async function buildDemoChecklist(workspaceRoot: string): Promise<DemoChecklist> {
  const explainGraphChecklistPaths: Record<
    (typeof CI_EXPLAIN_GRAPH_ARTIFACTS)[number]['id'],
    string
  > = {
    'explain-graph': resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraph),
    'explain-graph-mermaid': resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphMermaid),
    'explain-graph-dot': resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.explainGraphDot)
  };
  const items: DemoChecklistItem[] = await Promise.all([
    {
      id: 'verification-report',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport),
      artifactPath: CI_ARTIFACT_FILES.verificationReport,
      command: platformCommand('verify', '--lane', 'all')
    },
    {
      id: 'runtime-report',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport),
      artifactPath: CI_ARTIFACT_FILES.runtimeReport,
      command: platformCommand('verify', '--lane', 'all')
    },
    {
      id: 'policy-report',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport),
      artifactPath: CI_ARTIFACT_FILES.policyReport,
      command: platformCommand('verify')
    },
    {
      id: 'acceptance-coverage',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage),
      artifactPath: CI_ARTIFACT_FILES.acceptanceCoverage,
      command: platformCommand('verify')
    },
    {
      id: 'graph-lock',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock),
      artifactPath: CI_ARTIFACT_FILES.graphLock,
      command: platformCommand('lock')
    },
    {
      id: 'provenance-registry',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance),
      artifactPath: CI_ARTIFACT_FILES.provenance,
      command: platformCommand('compose')
    },
    ...CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => ({
      id: artifact.id,
      absolutePath: explainGraphChecklistPaths[artifact.id],
      artifactPath: artifact.path,
      command: platformCommand('explain')
    })),
    {
      id: 'review-summary',
      absolutePath: resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary),
      artifactPath: CI_ARTIFACT_FILES.reviewSummary,
      command: platformCommand('explain')
    }
  ].map(async (item) => ({
    id: item.id,
    status: await pathExists(item.absolutePath) ? 'passed' as const : 'missing' as const,
    artifactPath: item.artifactPath,
    command: item.command
  })));
  const missingCount = countMatching(items, (item) => item.status === 'missing');
  return {
    status: missingCount === 0 ? 'passed' : 'attention',
    itemCount: items.length,
    missingCount,
    items,
    nextCommand: missingCount === 0 ? 'bun run demo:closed-loop' : 'bun run demo:quickstart'
  };
}
