import type { Command } from 'commander';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import type { AcceptanceInspectionProjectionSource } from '../../application/acceptance-inspection.ts';
import type { ProvenanceRegistryInspectProjectionSource } from '../../application/provenance-registry-inspect.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import { addJsonFlags, commandFromRoot, jsonOpts } from '../../entry/cli/command-options.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import type { BlockUsageMapView } from '../../application/block-usage-map.ts';
import type { InstalledManifestEntry } from '../../application/install-manifest.ts';
import type { PostgresContractProjectionSource } from '../../application/postgres-contract.ts';
import { inspectionValue, registerInspectionQuery, type InspectionContext } from '../../entry/cli/inspection-query.ts';
import { captureJsonOutputInput } from '../../entry/cli/json-output-options.ts';
import { loadProjectOverviewDomain } from './lazy-command-domains.ts';
import { registerNamedInspectionQuery } from '../../entry/cli/named-inspection-query.ts';
import type { ProjectOverview } from './project-overview.ts';

type ArtifactKey = keyof typeof import('../../assurance/verification/ci-artifacts/contract/manifest.ts').CI_ARTIFACT_FILES;

/** Only a locator adapter: the existing reader remains the parsing owner. */
function artifactReader<T>(key: ArtifactKey, missing: (context: InspectionContext) => string) {
  return async (context: InspectionContext): Promise<T> => {
    const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
    const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
    const { readRequiredJson } = await import('./artifact-command-read.ts');
    return readRequiredJson<T>(resolveWorkspaceArtifactPath(context.workspaceRoot, CI_ARTIFACT_FILES[key]), missing(context));
  };
}

export function registerInspectionCommands(program: Command): void {
  registerInspectionQuery(program.command('policy'), {
    description: 'Policy inspection',
    read: artifactReader<PolicyReport>('policyReport', (c) => `Policy report not found; run ${c.rootCommand} verify first`),
    view: async (report) => {
      const { formatPolicyReport } = await import('./formatters.ts');
      const { buildReviewPolicySummary } = await import('../../assurance/verification/review/contract/policy.ts');
      return inspectionValue(report, (value) => formatPolicyReport(buildReviewPolicySummary(value)));
    },
    modes: { sources: async (report) => {
      const { projectPolicySources } = await import('../../application/policy-source-inspection.ts');
      const { formatPolicySources } = await import('../../entry/cli/policy-source-inspection.ts');
      return inspectionValue(projectPolicySources(report), formatPolicySources);
    } }
  });

  registerInspectionQuery(program.command('acceptance'), {
    description: 'Acceptance inspection',
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
  });

  registerInspectionQuery(program.command('runtime'), {
    description: 'Runtime inspection',
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
  });

  registerInspectionQuery(program.command('verification'), {
    description: 'Verification inspection',
    read: artifactReader<VerificationReport>('verificationReport', () => 'Verification report not found'),
    view: async (report) => {
      const { projectVerificationReportInspect } = await import('../../application/verification-report-inspect.ts');
      const { formatVerificationReport } = await import('../../entry/cli/verification-report-inspect.ts');
      return inspectionValue(
        report,
        (value) => formatVerificationReport(projectVerificationReportInspect(value))
      );
    }
  });

  registerInspectionQuery(program.command('provenance'), {
    description: 'Provenance inspection',
    read: async ({ workspaceRoot }): Promise<ProvenanceRegistryInspectProjectionSource> => {
      const { resolveWorkspaceProvenancePath } = await import('../../adapters/workspace-context.ts');
      const { readRequiredJson } = await import('./artifact-command-read.ts');
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
  });

  registerInspectionQuery(program.command('review'), {
    description: 'Review inspection',
    read: async (c): Promise<ReviewSummary> => {
      const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
      const { readRequiredReviewSummary } = await import('./artifact-command-read.ts');
      return readRequiredReviewSummary(resolveWorkspaceArtifactPath(c.workspaceRoot, CI_ARTIFACT_FILES.reviewSummary),
        `Review summary not found; run ${c.rootCommand} explain first`);
    },
    view: async (report) => {
      const { formatReviewSummaryContract } = await import('./formatters.ts');
      return inspectionValue(report, formatReviewSummaryContract);
    },
    modes: {
      matrix: async (report) => {
        const { buildE2eMatrix } = await import('../../adapters/verification/platform/review/runtime/matrix.ts');
        const { formatE2eMatrix } = await import('./formatters.ts');
        return inspectionValue(buildE2eMatrix(report), formatE2eMatrix);
      },
      diagnostics: async (report) => {
        const { buildReviewDiagnosticsInspect, formatReviewDiagnosticsInspect } = await import('./formatters.ts');
        return inspectionValue(buildReviewDiagnosticsInspect(report), formatReviewDiagnosticsInspect);
      }
    }
  });

  registerInspectionQuery(program.command('demo'), {
    read: async ({ workspaceRoot }) => {
      const { buildDemoChecklist } = await import('./demo-checklist.ts');
      return buildDemoChecklist(workspaceRoot);
    },
    view: async (report) => {
      const { formatDemoChecklist } = await import('./formatters.ts');
      return inspectionValue(report, formatDemoChecklist);
    }
  });

  registerInspectionQuery(program.command('overview'), {
    description: 'Project overview',
    read: async (c): Promise<ProjectOverview> => {
      const domain = await loadProjectOverviewDomain();
      return runWithOptionalSpinner('Building project overview', c.output,
        async () => domain.buildProjectOverviewFromWorkspace(c.workspaceRoot));
    },
    view: async (report) => {
      const domain = await loadProjectOverviewDomain();
      return inspectionValue(report, domain.formatProjectOverview);
    }
  });

  registerNamedInspectionQuery(program.command('contract'), {
    errors: async () => {
      const { buildErrorProtocolContract, formatErrorProtocolContract } = await import('./error-protocol-contract.ts');
      return inspectionValue(buildErrorProtocolContract(), formatErrorProtocolContract);
    },
    ci: async () => {
      const { buildCiContract, formatCiContract } = await import('../../adapters/verification/platform/ci/contract/core.ts');
      return inspectionValue(buildCiContract(), formatCiContract);
    }
  }).description('Contract inspection');

  registerInspectionQuery(program.command('install'), {
    read: artifactReader<InstalledManifestEntry[]>('installManifest', (c) => `Install manifest not found; run ${c.rootCommand} compose first`),
    view: async (report) => {
      const { projectInstallManifest } = await import('../../application/install-manifest.ts');
      const { formatInstallManifest } = await import('../../entry/cli/install-manifest.ts');
      return inspectionValue(projectInstallManifest(report), formatInstallManifest);
    }
  });

  registerInspectionQuery(program.command('blocks'), {
    read: artifactReader<BlockUsageMapView>('blockUsageMap', (c) => `Block usage map not found; run ${c.rootCommand} compose first`),
    view: async (report) => {
      const { projectBlockUsageMap } = await import('../../application/block-usage-map.ts');
      const { formatBlockUsageMap } = await import('../../entry/cli/block-usage-map.ts');
      return inspectionValue(projectBlockUsageMap(report), formatBlockUsageMap);
    }
  });

  addJsonFlags(program.command('postgres')).action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
    const cwd = process.cwd();
    const output = jsonOpts(captureJsonOutputInput(rawOptions, 'own-enumerable'));
    const missingMessage = `Postgres contract not found; run ${commandFromRoot(cmd, 'compose')} first`;
    const { projectPostgresContract } = await import('../../application/postgres-contract.ts');
    const { formatPostgresContract } = await import('../../entry/cli/postgres-contract.ts');
    const { printGeneratedContract } = await import('./artifact-command-read.ts');
    await printGeneratedContract<PostgresContractProjectionSource>(
      cwd,
      missingMessage,
      output,
      (contract) => formatPostgresContract(projectPostgresContract(contract)),
      (contract) => contract.provider === 'postgres'
    );
  });
}
