import { CI_ARTIFACT_FILES, CI_EXPLAIN_GRAPH_ARTIFACTS } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import { countMatching } from '../contracts/collections.ts';

export type DemoChecklistItemPlan = {
  id: string;
  artifactPath: string;
  command: string;
};

export type DemoChecklistItem = DemoChecklistItemPlan & {
  status: 'passed' | 'missing';
};

export type DemoChecklist = {
  status: 'passed' | 'attention';
  itemCount: number;
  missingCount: number;
  items: DemoChecklistItem[];
  nextCommand: string;
};

export type DemoChecklistCommands = Readonly<{
  verifyAll: string;
  verify: string;
  lock: string;
  compose: string;
  explain: string;
  passedNext: string;
  missingNext: string;
}>;

export type DemoChecklistPlan = Readonly<{
  items: readonly DemoChecklistItemPlan[];
  passedNextCommand: string;
  missingNextCommand: string;
}>;

export function createDemoChecklistPlan(commands: DemoChecklistCommands): DemoChecklistPlan {
  return {
    items: [
      {
        id: 'verification-report',
        artifactPath: CI_ARTIFACT_FILES.verificationReport,
        command: commands.verifyAll
      },
      {
        id: 'runtime-report',
        artifactPath: CI_ARTIFACT_FILES.runtimeReport,
        command: commands.verifyAll
      },
      {
        id: 'policy-report',
        artifactPath: CI_ARTIFACT_FILES.policyReport,
        command: commands.verify
      },
      {
        id: 'acceptance-coverage',
        artifactPath: CI_ARTIFACT_FILES.acceptanceCoverage,
        command: commands.verify
      },
      {
        id: 'graph-lock',
        artifactPath: CI_ARTIFACT_FILES.graphLock,
        command: commands.lock
      },
      {
        id: 'provenance-registry',
        artifactPath: CI_ARTIFACT_FILES.provenance,
        command: commands.compose
      },
      ...CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => ({
        id: artifact.id,
        artifactPath: artifact.path,
        command: commands.explain
      })),
      {
        id: 'review-summary',
        artifactPath: CI_ARTIFACT_FILES.reviewSummary,
        command: commands.explain
      }
    ],
    passedNextCommand: commands.passedNext,
    missingNextCommand: commands.missingNext
  };
}

export function buildDemoChecklist(
  plan: DemoChecklistPlan,
  presentArtifactPaths: ReadonlySet<string>
): DemoChecklist {
  const items = plan.items.map((item): DemoChecklistItem => ({
    ...item,
    status: presentArtifactPaths.has(item.artifactPath) ? 'passed' : 'missing'
  }));
  const missingCount = countMatching(items, (item) => item.status === 'missing');
  return {
    status: missingCount === 0 ? 'passed' : 'attention',
    itemCount: items.length,
    missingCount,
    items,
    nextCommand: missingCount === 0 ? plan.passedNextCommand : plan.missingNextCommand
  };
}
