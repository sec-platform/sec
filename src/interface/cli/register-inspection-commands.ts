import type { Command } from 'commander';
import type { PolicyReport } from '../../compiler/policies/contract/types.ts';
import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../verification/contract/types.ts';
import type { ReviewSummary } from '../../verification/review/contract/types.ts';
import { addJsonFlags, commandFromRoot, jsonOpts } from './command-options.ts';
import { runWithOptionalSpinner } from './command-progress.ts';
import type { BlockUsageMap, InstallManifestEntry, PostgresContract } from './formatters.ts';
import { inspectionValue, registerInspectionQuery, type InspectionContext } from './inspection-query.ts';
import { captureJsonOutputInput } from './json-output-options.ts';
import { loadProjectOverviewDomain } from './lazy-command-domains.ts';
import { registerNamedInspectionQuery } from './named-inspection-query.ts';
import type { ProjectOverview } from './project-overview.ts';

type ArtifactKey = keyof typeof import('../../verification/ci-artifacts/contract/manifest.ts').CI_ARTIFACT_FILES;

/** Only a locator adapter: the existing reader remains the parsing owner. */
function artifactReader<T>(key: ArtifactKey, missing: (context: InspectionContext) => string) {
  return async (context: InspectionContext): Promise<T> => {
    const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
    const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
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
      const { buildReviewPolicySummary } = await import('../../verification/review/contract/policy.ts');
      return inspectionValue(report, (value) => formatPolicyReport(buildReviewPolicySummary(value)));
    },
    modes: { sources: async (report) => {
      const { buildPolicySourceInspect, formatPolicySources } = await import('./formatters.ts');
      return inspectionValue(buildPolicySourceInspect(report), formatPolicySources);
    } }
  });

  registerInspectionQuery(program.command('acceptance'), {
    description: 'Acceptance inspection',
    read: artifactReader<AcceptanceCoverageReport>('acceptanceCoverage', (c) => `Acceptance coverage report not found; run ${c.rootCommand} verify first`),
    view: async (report) => {
      const { formatAcceptanceCoverage } = await import('./formatters.ts');
      return inspectionValue(report, formatAcceptanceCoverage);
    },
    modes: { blocks: async (report) => {
      const { buildAcceptanceTargetInspect, formatAcceptanceTargets } = await import('./formatters.ts');
      return inspectionValue(buildAcceptanceTargetInspect(report), formatAcceptanceTargets);
    } }
  });

  registerInspectionQuery(program.command('runtime'), {
    description: 'Runtime inspection',
    read: artifactReader<RuntimeVerificationLaneReport>('runtimeReport', (c) => `Runtime report not found; run ${c.rootCommand} verify first`),
    view: async (report) => {
      const { formatRuntimeReport } = await import('./formatters.ts');
      return inspectionValue(report, formatRuntimeReport);
    },
    modes: { steps: async (report) => {
      const { buildRuntimeStepsInspect, formatRuntimeStepsInspect } = await import('./formatters.ts');
      return inspectionValue(buildRuntimeStepsInspect(report), formatRuntimeStepsInspect);
    } }
  });

  registerInspectionQuery(program.command('verification'), {
    description: 'Verification inspection',
    read: artifactReader<VerificationReport>('verificationReport', () => 'Verification report not found'),
    view: async (report) => {
      const { formatVerificationReport } = await import('./formatters.ts');
      return inspectionValue(report, formatVerificationReport);
    }
  });

  registerInspectionQuery(program.command('provenance'), {
    description: 'Provenance inspection',
    read: async ({ workspaceRoot }): Promise<ProvenanceFile> => {
      const { resolveWorkspaceProvenancePath } = await import('../../workspace/runtime/paths.ts');
      const { readRequiredJson } = await import('./artifact-command-read.ts');
      return readRequiredJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot), 'Provenance registry not found');
    },
    view: async (report) => {
      const { formatProvenanceRegistry } = await import('./formatters.ts');
      return inspectionValue(report, formatProvenanceRegistry);
    }
  });

  registerInspectionQuery(program.command('review'), {
    description: 'Review inspection',
    read: async (c): Promise<ReviewSummary> => {
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
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
        const { buildE2eMatrix } = await import('../../verification/review/runtime/matrix.ts');
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
    freeze: async () => {
      const { buildContractFreezeContract, formatContractFreezeContract } = await import('../../verification/freeze.ts');
      return inspectionValue(buildContractFreezeContract(), formatContractFreezeContract);
    },
    errors: async () => {
      const { buildErrorProtocolContract, formatErrorProtocolContract } = await import('./error-protocol-contract.ts');
      return inspectionValue(buildErrorProtocolContract(), formatErrorProtocolContract);
    },
    ci: async () => {
      const { buildCiContract, formatCiContract } = await import('../../verification/ci/contract/core.ts');
      return inspectionValue(buildCiContract(), formatCiContract);
    }
  }).description('Contract inspection');

  registerInspectionQuery(program.command('install'), {
    read: artifactReader<InstallManifestEntry[]>('installManifest', (c) => `Install manifest not found; run ${c.rootCommand} compose first`),
    view: async (report) => {
      const { formatInstallManifest } = await import('./formatters.ts');
      return inspectionValue(report, formatInstallManifest);
    }
  });

  registerInspectionQuery(program.command('blocks'), {
    read: artifactReader<BlockUsageMap>('blockUsageMap', (c) => `Block usage map not found; run ${c.rootCommand} compose first`),
    view: async (report) => {
      const { formatBlockUsageMap } = await import('./formatters.ts');
      return inspectionValue(report, formatBlockUsageMap);
    }
  });

  addJsonFlags(program.command('postgres')).action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
      const cwd = process.cwd();
      const output = jsonOpts(captureJsonOutputInput(rawOptions, 'own-enumerable'));
      const missingMessage = `Postgres contract not found; run ${commandFromRoot(cmd, 'compose')} first`;
      const { formatPostgresContract } = await import('./formatters.ts');
      const { printGeneratedContract } = await import('./artifact-command-read.ts');
    await printGeneratedContract<PostgresContract>(
      cwd,
      missingMessage,
      output,
      formatPostgresContract,
      (contract) => contract.provider === 'postgres'
    );
  });
}
