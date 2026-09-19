import type { Command } from 'commander';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import type { AcceptanceInspectionProjectionSource } from '../../application/acceptance-inspection.ts';
import type { ProvenanceRegistryInspectProjectionSource } from '../../application/provenance-registry-inspect.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import type { BlockUsageMapView } from '../../application/block-usage-map.ts';
import type { InstalledManifestEntry } from '../../application/install-manifest.ts';
import type { PostgresContractProjectionSource } from '../../application/postgres-contract.ts';
import { inspectionValue, type InspectionContext } from '../../entry/cli/inspection-query.ts';
import { registerStandardInspectionCommands } from '../../entry/cli/register-standard-inspection-commands.ts';
import { loadProjectOverviewDomain } from './lazy-command-domains.ts';
import { registerContractInspectionCommand } from '../../entry/cli/register-contract-inspection-command.ts';
import { registerPostgresInspectionCommand } from '../../entry/cli/register-postgres-inspection-command.ts';
import type { ProjectOverview } from './project-overview.ts';

type ArtifactKey = keyof typeof import('../../assurance/verification/ci-artifacts/contract/manifest.ts').CI_ARTIFACT_FILES;

/** Only a locator adapter: the existing reader remains the parsing owner. */
function artifactReader<T>(key: ArtifactKey, missing: (context: InspectionContext) => string) {
  return async (context: InspectionContext): Promise<T> => {
    const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
    const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
    const { readRequiredJson } = await import('../../adapters/workspace/required-artifact-read.ts');
    return readRequiredJson<T>(resolveWorkspaceArtifactPath(context.workspaceRoot, CI_ARTIFACT_FILES[key]), missing(context));
  };
}

export function registerInspectionCommands(program: Command): void {
  registerStandardInspectionCommands(program, {
  policy: {
    read: artifactReader<PolicyReport>('policyReport', (c) => `Policy report not found; run ${c.rootCommand} verify first`),
    view: async (report) => {
      const { projectPolicyReportInspection } = await import('../../application/policy-report-inspection.ts');
      const { formatPolicyReport } = await import('../../entry/cli/policy-report-inspection.ts');
      return inspectionValue(
        report,
        (value) => formatPolicyReport(projectPolicyReportInspection(value))
      );
    },
    modes: { sources: async (report) => {
      const { projectPolicySources } = await import('../../application/policy-source-inspection.ts');
      const { formatPolicySources } = await import('../../entry/cli/policy-source-inspection.ts');
      return inspectionValue(projectPolicySources(report), formatPolicySources);
    } }
  },
  acceptance: {
    read: artifactReader<AcceptanceInspectionProjectionSource>(
      'acceptanceCoverage',
      (c) => `Acceptance coverage report not found; run ${c.rootCommand} verify first`
    ),
    view: async (report) => {
      const { projectAcceptanceCoverage } = await import('../../application/acceptance-inspection.ts');
      const { formatAcceptanceCoverage } = await import('../../entry/cli/acceptance-inspection.ts');
      return inspectionValue(
        report,
        (value) => formatAcceptanceCoverage(projectAcceptanceCoverage(value))
      );
    },
    modes: { blocks: async (report) => {
      const { projectAcceptanceTargets } = await import('../../application/acceptance-inspection.ts');
      const { formatAcceptanceTargets } = await import('../../entry/cli/acceptance-inspection.ts');
      return inspectionValue(
        projectAcceptanceTargets(report),
        formatAcceptanceTargets
      );
    } }
  },
  runtime: {
    read: artifactReader<RuntimeVerificationLaneReport>('runtimeReport', (c) => `Runtime report not found; run ${c.rootCommand} verify first`),
    view: async (report) => {
      const { projectRuntimeInspection } = await import('../../application/runtime-inspection.ts');
      const { formatRuntimeReport } = await import('../../entry/cli/runtime-inspection.ts');
      return inspectionValue(report, (value) => formatRuntimeReport(projectRuntimeInspection(value)));
    },
    modes: { steps: async (report) => {
      const { projectRuntimeInspection } = await import('../../application/runtime-inspection.ts');
      const { formatRuntimeStepsInspect } = await import('../../entry/cli/runtime-inspection.ts');
      return inspectionValue(projectRuntimeInspection(report), formatRuntimeStepsInspect);
    } }
  },
  verification: {
    read: artifactReader<VerificationReport>('verificationReport', () => 'Verification report not found'),
    view: async (report) => {
      const { projectVerificationReportInspect } = await import('../../application/verification-report-inspect.ts');
      const { formatVerificationReport } = await import('../../entry/cli/verification-report-inspect.ts');
      return inspectionValue(
        report,
        (value) => formatVerificationReport(projectVerificationReportInspect(value))
      );
    }
  },
  provenance: {
    read: async ({ workspaceRoot }): Promise<ProvenanceRegistryInspectProjectionSource> => {
      const { resolveWorkspaceProvenancePath } = await import('../../adapters/workspace-context.ts');
      const { readRequiredJson } = await import('../../adapters/workspace/required-artifact-read.ts');
      return readRequiredJson<ProvenanceRegistryInspectProjectionSource>(
        await resolveWorkspaceProvenancePath(workspaceRoot),
        'Provenance registry not found'
      );
    },
    view: async (report) => {
      const { projectProvenanceRegistryInspect } = await import('../../application/provenance-registry-inspect.ts');
      const { formatProvenanceRegistry } = await import('../../entry/cli/provenance-registry-inspect.ts');
      return inspectionValue(
        report,
        (value) => formatProvenanceRegistry(projectProvenanceRegistryInspect(value))
      );
    }
  },
  review: {
    read: async (c): Promise<ReviewSummary> => {
      const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
      const { readRequiredReviewSummary } = await import('../../adapters/workspace/required-artifact-read.ts');
      return readRequiredReviewSummary(resolveWorkspaceArtifactPath(c.workspaceRoot, CI_ARTIFACT_FILES.reviewSummary),
        `Review summary not found; run ${c.rootCommand} explain first`);
    },
    view: async (report) => {
      const { projectReviewSummary } = await import('../../application/review-summary-inspect.ts');
      const { formatReviewSummary } = await import('../../entry/cli/review-summary-inspect.ts');
      return inspectionValue(
        report,
        (value) => formatReviewSummary(projectReviewSummary(value))
      );
    },
    modes: {
      matrix: async (report) => {
        const { buildE2eMatrix } = await import('../../assurance/verification/review/matrix.ts');
        const { projectE2eMatrix } = await import('../../application/e2e-matrix-inspect.ts');
        const { formatE2eMatrix } = await import('../../entry/cli/e2e-matrix-inspect.ts');
        return inspectionValue(projectE2eMatrix(buildE2eMatrix(report)), formatE2eMatrix);
      },
      diagnostics: async (report) => {
        const { projectReviewDiagnostics } = await import('../../application/review-diagnostics-inspect.ts');
        const { formatReviewDiagnostics } = await import('../../entry/cli/review-diagnostics-inspect.ts');
        return inspectionValue(projectReviewDiagnostics(report), formatReviewDiagnostics);
      }
    }
  },
  demo: {
    read: async ({ workspaceRoot }) => {
      const { buildDemoChecklist } = await import('./demo-checklist.ts');
      return buildDemoChecklist(workspaceRoot);
    },
    view: async (report) => {
      const { formatDemoChecklist } = await import('../../entry/cli/demo-checklist.ts');
      return inspectionValue(report, formatDemoChecklist);
    }
  },
  overview: {
    read: async (c): Promise<ProjectOverview> => {
      const domain = await loadProjectOverviewDomain();
      return runWithOptionalSpinner('Building project overview', c.output,
        async () => domain.buildProjectOverviewFromWorkspace(c.workspaceRoot));
    },
    view: async (report) => {
      const domain = await loadProjectOverviewDomain();
      return inspectionValue(report, domain.formatProjectOverview);
    }
  },
  install: {
    read: artifactReader<InstalledManifestEntry[]>('installManifest', (c) => `Install manifest not found; run ${c.rootCommand} compose first`),
    view: async (report) => {
      const { projectInstallManifest } = await import('../../application/install-manifest.ts');
      const { formatInstallManifest } = await import('../../entry/cli/install-manifest.ts');
      return inspectionValue(projectInstallManifest(report), formatInstallManifest);
    }
  },
  blocks: {
    read: artifactReader<BlockUsageMapView>('blockUsageMap', (c) => `Block usage map not found; run ${c.rootCommand} compose first`),
    view: async (report) => {
      const { projectBlockUsageMap } = await import('../../application/block-usage-map.ts');
      const { formatBlockUsageMap } = await import('../../entry/cli/block-usage-map.ts');
      return inspectionValue(projectBlockUsageMap(report), formatBlockUsageMap);
    }
  },
  });

  registerContractInspectionCommand(program, {
    errors: async () => {
      const { buildErrorProtocolContract, formatErrorProtocolContract } =
        await import('./error-protocol-contract.ts');
      return inspectionValue(
        buildErrorProtocolContract(),
        formatErrorProtocolContract
      );
    },
    ci: async () => {
      const { buildCiContract, formatCiContract } =
        await import('../../adapters/verification/platform/ci/contract/core.ts');
      return inspectionValue(buildCiContract(), formatCiContract);
    }
  });

  registerPostgresInspectionCommand(
    program,
    async ({ workspaceRoot, output, missingMessage }) => {
      const { projectPostgresContract } =
        await import('../../application/postgres-contract.ts');
      const { formatPostgresContract } =
        await import('../../entry/cli/postgres-contract.ts');
      const { printGeneratedContract } =
        await import('./artifact-command-read.ts');
      await printGeneratedContract<PostgresContractProjectionSource>(
        workspaceRoot,
        missingMessage,
        output,
        contract => formatPostgresContract(projectPostgresContract(contract)),
        contract => contract.provider === 'postgres'
      );
    }
  );
}
