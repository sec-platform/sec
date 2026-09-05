import { runWithOptionalSpinner } from './command-progress.ts';
import { Argument, type Command } from 'commander';
import type { PolicyReport } from '../../compiler/policies/contract/types.ts';
import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../../verification/contract/types.ts';
import { printJsonOrText } from './format-utils.ts';
import type { BlockUsageMap, InstallManifestEntry, PostgresContract } from './formatters.ts';
import { loadProjectOverviewDomain } from './lazy-command-domains.ts';
import type { ProjectOverview } from './project-overview.ts';
import { jsonOpts, commandPath, commandFromRoot, usageError, addJsonFlags, optionalModeCommand } from './command-options.ts';

export function registerInspectionCommands(program: Command): void {

  addJsonFlags(optionalModeCommand(program.command('policy'), 'mode', ['sources']))
    .description('Policy inspection')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { buildPolicySourceInspect, formatPolicyReport, formatPolicySources } = await import('./formatters.ts');
      const { readRequiredJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      const policyReportPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.policyReport);
      const report = await readRequiredJson<PolicyReport>(policyReportPath, `Policy report not found; run ${commandFromRoot(cmd, 'verify')} first`);
      if (mode === 'sources') {
        printJsonOrText(buildPolicySourceInspect(report), output, formatPolicySources);
        return;
      }
      const { buildReviewPolicySummary } = await import('../../verification/review/contract/policy.ts');
      printJsonOrText(report, output, (v) => formatPolicyReport(buildReviewPolicySummary(v)));
    });

  addJsonFlags(optionalModeCommand(program.command('acceptance'), 'mode', ['blocks']))
    .description('Acceptance inspection')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { buildAcceptanceTargetInspect, formatAcceptanceCoverage, formatAcceptanceTargets } = await import('./formatters.ts');
      const { readRequiredJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      const acceptanceCoveragePath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.acceptanceCoverage);
      const report = await readRequiredJson<AcceptanceCoverageReport>(acceptanceCoveragePath, `Acceptance coverage report not found; run ${commandFromRoot(cmd, 'verify')} first`);
      if (mode === 'blocks') {
        printJsonOrText(buildAcceptanceTargetInspect(report), output, formatAcceptanceTargets);
        return;
      }
      printJsonOrText(report, output, formatAcceptanceCoverage);
    });

  addJsonFlags(optionalModeCommand(program.command('runtime'), 'mode', ['steps']))
    .description('Runtime inspection')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { buildRuntimeStepsInspect, formatRuntimeReport, formatRuntimeStepsInspect } = await import('./formatters.ts');
      const { readRequiredJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      const runtimeReportPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.runtimeReport);
      const report = await readRequiredJson<RuntimeVerificationLaneReport>(runtimeReportPath, `Runtime report not found; run ${commandFromRoot(cmd, 'verify')} first`);
      if (mode === 'steps') {
        printJsonOrText(buildRuntimeStepsInspect(report), output, formatRuntimeStepsInspect);
        return;
      }
      printJsonOrText(report, output, formatRuntimeReport);
    });

  addJsonFlags(program.command('verification'))
    .description('Verification inspection')
    .action(async (rawOptions: Record<string, unknown>) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { formatVerificationReport } = await import('./formatters.ts');
      const { printWorkspaceJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      await printWorkspaceJson<VerificationReport>(cwd, (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.verificationReport), 'Verification report not found', output, formatVerificationReport);
    });

  addJsonFlags(program.command('provenance'))
    .description('Provenance inspection')
    .action(async (rawOptions: Record<string, unknown>) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { resolveWorkspaceProvenancePath } = await import('../../workspace/runtime/paths.ts');
      const { formatProvenanceRegistry } = await import('./formatters.ts');
      const { printRequiredJson } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      const provenancePath = await resolveWorkspaceProvenancePath(cwd);
      await printRequiredJson<ProvenanceFile>(provenancePath, 'Provenance registry not found', output, formatProvenanceRegistry);
    });

  addJsonFlags(optionalModeCommand(program.command('review'), 'mode', ['matrix', 'diagnostics']))
    .description('Review inspection')
    .action(async (mode: string | undefined, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { buildReviewDiagnosticsInspect, formatE2eMatrix, formatReviewDiagnosticsInspect, formatReviewSummaryContract } = await import('./formatters.ts');
      const { readRequiredReviewSummary } = await import('./artifact-command-read.ts');
      const output = jsonOpts(opts);
      const reviewSummaryPath = resolveWorkspaceArtifactPath(cwd, CI_ARTIFACT_FILES.reviewSummary);
      const summary = readRequiredReviewSummary(
        reviewSummaryPath,
        `Review summary not found; run ${commandFromRoot(cmd, 'explain')} first`
      );
      if (mode === 'matrix') {
        const { buildE2eMatrix } = await import('../../verification/review/runtime/matrix.ts');
        printJsonOrText(buildE2eMatrix(summary), output, formatE2eMatrix);
        return;
      }
      if (mode === 'diagnostics') {
        printJsonOrText(buildReviewDiagnosticsInspect(summary), output, formatReviewDiagnosticsInspect);
        return;
      }
      printJsonOrText(summary, output, formatReviewSummaryContract);
    });

  addJsonFlags(program.command('demo')).action(async (rawOptions: Record<string, unknown>) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { formatDemoChecklist } = await import('./formatters.ts');
      const { buildDemoChecklist } = await import('./demo-checklist.ts');
    const output = jsonOpts(opts);
    const checklist = await buildDemoChecklist(cwd);
    printJsonOrText(checklist, output, formatDemoChecklist);
  });

  addJsonFlags(program.command('overview'))
    .description('Project overview')
    .action(async (rawOptions: Record<string, unknown>) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const output = jsonOpts(opts);
      const domain = await loadProjectOverviewDomain();
      const overview = await runWithOptionalSpinner(
        'Building project overview',
        output,
        async () => domain.buildProjectOverviewFromWorkspace(cwd)
      );
      printJsonOrText<ProjectOverview>(overview, output, domain.formatProjectOverview);
    });

  addJsonFlags(program.command('contract')
    .addArgument(new Argument('<kind>').choices(['freeze', 'errors', 'ci'])))
    .description('Contract inspection')
    .action(async (kind: string, rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const output = jsonOpts(opts);
      if (kind === 'freeze') {
        const { buildContractFreezeContract, formatContractFreezeContract } = await import('../../verification/freeze.ts');
        printJsonOrText(buildContractFreezeContract(), output, formatContractFreezeContract);
        return;
      }
      if (kind === 'ci') {
        const { buildCiContract, formatCiContract } = await import('../../verification/ci/contract/core.ts');
        printJsonOrText(buildCiContract(), output, formatCiContract);
        return;
      }
      if (kind === 'errors') {
        const { buildErrorProtocolContract, formatErrorProtocolContract } = await import('./error-protocol-contract.ts');
        printJsonOrText(buildErrorProtocolContract(), output, formatErrorProtocolContract);
        return;
      }
      throw usageError(`Usage: ${commandPath(cmd)} <freeze|errors|ci> [--json [--compact]]`);
    });

  addJsonFlags(program.command('install')).action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { formatInstallManifest } = await import('./formatters.ts');
      const { printWorkspaceJson } = await import('./artifact-command-read.ts');
    await printWorkspaceJson<InstallManifestEntry[]>(cwd, (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.installManifest), `Install manifest not found; run ${commandFromRoot(cmd, 'compose')} first`, jsonOpts(opts), formatInstallManifest);
  });

  addJsonFlags(program.command('blocks')).action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { formatBlockUsageMap } = await import('./formatters.ts');
      const { printWorkspaceJson } = await import('./artifact-command-read.ts');
    await printWorkspaceJson<BlockUsageMap>(cwd, (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.blockUsageMap), `Block usage map not found; run ${commandFromRoot(cmd, 'compose')} first`, jsonOpts(opts), formatBlockUsageMap);
  });

  addJsonFlags(program.command('postgres')).action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
      const opts = Object.freeze({ ...rawOptions });
      const cwd = process.cwd();
      const { formatPostgresContract } = await import('./formatters.ts');
      const { printGeneratedContract } = await import('./artifact-command-read.ts');
    await printGeneratedContract<PostgresContract>(
      cwd,
      `Postgres contract not found; run ${commandFromRoot(cmd, 'compose')} first`,
      jsonOpts(opts),
      formatPostgresContract,
      (contract) => contract.provider === 'postgres'
    );
  });
}
