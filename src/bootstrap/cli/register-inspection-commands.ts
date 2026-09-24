import type { Command } from 'commander';
import type { AcceptanceInspectionProjectionSource } from '../../application/acceptance-inspection.ts';
import type { BlockUsageMapView } from '../../application/block-usage-map.ts';
import type { InstalledManifestEntry } from '../../application/install-manifest.ts';
import type { PostgresContractProjectionSource } from '../../application/postgres-contract.ts';
import type { ProjectOverview } from '../../application/project-overview.ts';
import type { ProvenanceRegistryInspectProjectionSource } from '../../application/provenance-registry-inspect.ts';
import type {
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import type { InspectionContext } from '../../entry/cli/inspection-query.ts';
import {
  acceptanceCoverageInspectionView,
  acceptanceTargetsInspectionView,
  blockUsageInspectionView,
  demoChecklistInspectionView,
  installManifestInspectionView,
  policyReportInspectionView,
  policySourcesInspectionView,
  projectOverviewInspectionView,
  provenanceRegistryInspectionView,
  reviewDiagnosticsInspectionView,
  reviewMatrixInspectionView,
  reviewSummaryInspectionView,
  runtimeReportInspectionView,
  runtimeStepsInspectionView,
  verificationReportInspectionView
} from '../../entry/cli/inspection-views.ts';
import { registerContractInspectionCommand } from '../../entry/cli/register-contract-inspection-command.ts';
import { registerPostgresInspectionCommand } from '../../entry/cli/register-postgres-inspection-command.ts';
import { registerStandardInspectionCommands } from '../../entry/cli/register-standard-inspection-commands.ts';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import { loadProjectOverviewDomain } from './lazy-command-domains.ts';

type ArtifactKey =
  keyof typeof import('../../assurance/verification/ci-artifacts/contract/manifest.ts').CI_ARTIFACT_FILES;

/** Only a locator adapter: the existing reader remains the parsing owner. */
function artifactReader<T>(
  key: ArtifactKey,
  missing: (context: InspectionContext) => string
) {
  return async (context: InspectionContext): Promise<T> => {
    const { CI_ARTIFACT_FILES } =
      await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
    const { resolveWorkspaceArtifactPath } =
      await import('../../adapters/workspace-context.ts');
    const { readRequiredJson } =
      await import('../../adapters/workspace/required-artifact-read.ts');
    return readRequiredJson<T>(
      resolveWorkspaceArtifactPath(
        context.workspaceRoot,
        CI_ARTIFACT_FILES[key]
      ),
      missing(context)
    );
  };
}

export function registerInspectionCommands(program: Command): void {
  registerStandardInspectionCommands(program, {
    policy: {
      read: artifactReader<PolicyReport>(
        'policyReport',
        c => `Policy report not found; run ${c.rootCommand} verify first`
      ),
      view: policyReportInspectionView,
      modes: { sources: policySourcesInspectionView }
    },
    acceptance: {
      read: artifactReader<AcceptanceInspectionProjectionSource>(
        'acceptanceCoverage',
        c => `Acceptance coverage report not found; run ${c.rootCommand} verify first`
      ),
      view: acceptanceCoverageInspectionView,
      modes: { blocks: acceptanceTargetsInspectionView }
    },
    runtime: {
      read: artifactReader<RuntimeVerificationLaneReport>(
        'runtimeReport',
        c => `Runtime report not found; run ${c.rootCommand} verify first`
      ),
      view: runtimeReportInspectionView,
      modes: { steps: runtimeStepsInspectionView }
    },
    verification: {
      read: artifactReader<VerificationReport>(
        'verificationReport',
        () => 'Verification report not found'
      ),
      view: verificationReportInspectionView
    },
    provenance: {
      read: async ({ workspaceRoot }): Promise<ProvenanceRegistryInspectProjectionSource> => {
        const { resolveWorkspaceProvenancePath } =
          await import('../../adapters/workspace-context.ts');
        const { readRequiredJson } =
          await import('../../adapters/workspace/required-artifact-read.ts');
        return readRequiredJson<ProvenanceRegistryInspectProjectionSource>(
          await resolveWorkspaceProvenancePath(workspaceRoot),
          'Provenance registry not found'
        );
      },
      view: provenanceRegistryInspectionView
    },
    review: {
      read: async (c): Promise<ReviewSummary> => {
        const { CI_ARTIFACT_FILES } =
          await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { resolveWorkspaceArtifactPath } =
          await import('../../adapters/workspace-context.ts');
        const { readRequiredReviewSummary } =
          await import('../../adapters/workspace/required-artifact-read.ts');
        return readRequiredReviewSummary(
          resolveWorkspaceArtifactPath(
            c.workspaceRoot,
            CI_ARTIFACT_FILES.reviewSummary
          ),
          `Review summary not found; run ${c.rootCommand} explain first`
        );
      },
      view: reviewSummaryInspectionView,
      modes: {
        matrix: async report => {
          const { buildE2eMatrix } =
            await import('../../assurance/verification/review/matrix.ts');
          return reviewMatrixInspectionView(buildE2eMatrix(report));
        },
        diagnostics: reviewDiagnosticsInspectionView
      }
    },
    demo: {
      read: async ({ workspaceRoot }) => {
        const { buildDemoChecklist } = await import('./demo-checklist.ts');
        return buildDemoChecklist(workspaceRoot);
      },
      view: demoChecklistInspectionView
    },
    overview: {
      read: async (c): Promise<ProjectOverview> => {
        const domain = await loadProjectOverviewDomain();
        return runWithOptionalSpinner(
          'Building project overview',
          c.output,
          async () => domain.buildProjectOverviewFromWorkspace(c.workspaceRoot)
        );
      },
      view: async report => {
        const { CI_ARTIFACT_FILES } =
          await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
        const { platformCommand } =
          await import('../../adapters/verification/platform/command.ts');
        return projectOverviewInspectionView(report, {
          explainCommand: platformCommand('explain'),
          verifyCompactCommand: platformCommand('verify', '--json', '--compact'),
          graphArtifactPath: CI_ARTIFACT_FILES.explainGraph,
          reviewArtifactPath: CI_ARTIFACT_FILES.reviewSummary
        });
      }
    },
    install: {
      read: artifactReader<InstalledManifestEntry[]>(
        'installManifest',
        c => `Install manifest not found; run ${c.rootCommand} compose first`
      ),
      view: installManifestInspectionView
    },
    blocks: {
      read: artifactReader<BlockUsageMapView>(
        'blockUsageMap',
        c => `Block usage map not found; run ${c.rootCommand} compose first`
      ),
      view: blockUsageInspectionView
    }
  });

  registerContractInspectionCommand(program, {
    errors: async () => {
      const { buildErrorProtocolContract } =
        await import('./error-protocol-contract.ts');
      return buildErrorProtocolContract();
    },
    ci: async () => {
      const { buildCiContract } =
        await import('../../adapters/verification/platform/ci/contract/core.ts');
      return buildCiContract();
    }
  });

  registerPostgresInspectionCommand(program, {
    read: async ({ workspaceRoot, missingMessage }) => {
      const { readGeneratedContract } =
        await import('../../adapters/workspace/generated-contract-read.ts');
      return readGeneratedContract<PostgresContractProjectionSource>(
        workspaceRoot,
        missingMessage,
        value => value.provider === 'postgres'
      );
    }
  });
}
