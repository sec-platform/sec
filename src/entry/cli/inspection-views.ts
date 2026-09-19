import type { AcceptanceInspectionProjectionSource } from '../../application/acceptance-inspection.ts';
import type { BlockUsageMapView } from '../../application/block-usage-map.ts';
import type { InstalledManifestEntry } from '../../application/install-manifest.ts';
import type { PostgresContractProjectionSource } from '../../application/postgres-contract.ts';
import type { ProjectOverview } from '../../application/project-overview.ts';
import type { ProvenanceRegistryInspectProjectionSource } from '../../application/provenance-registry-inspect.ts';
import type { E2eMatrix } from '../../assurance/verification/review/matrix.ts';
import type {
  RuntimeVerificationLaneReport,
  VerificationReport
} from '../../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../../assurance/verification/review/contract/types.ts';
import type { DemoChecklist } from '../../application/demo-checklist.ts';
import type { PolicyReport } from '../../semantics/policies/types.ts';
import type { ErrorProtocolContract } from '../../application/error-protocol-contract.ts';
import type { CiContract } from '../../adapters/verification/platform/ci/contract/core.ts';
import type { ProjectOverviewPresentation } from './project-overview.ts';
import { commandValue, type CommandValue } from './command-value.ts';

export async function policyReportInspectionView(report: PolicyReport): Promise<CommandValue> {
  const { projectPolicyReportInspection } = await import('../../application/policy-report-inspection.ts');
  const { formatPolicyReport } = await import('./policy-report-inspection.ts');
  return commandValue(report, value => formatPolicyReport(projectPolicyReportInspection(value)));
}

export async function policySourcesInspectionView(report: PolicyReport): Promise<CommandValue> {
  const { projectPolicySources } = await import('../../application/policy-source-inspection.ts');
  const { formatPolicySources } = await import('./policy-source-inspection.ts');
  const value = projectPolicySources(report);
  return commandValue(value, formatPolicySources);
}

export async function acceptanceCoverageInspectionView(
  report: AcceptanceInspectionProjectionSource
): Promise<CommandValue> {
  const { projectAcceptanceCoverage } = await import('../../application/acceptance-inspection.ts');
  const { formatAcceptanceCoverage } = await import('./acceptance-inspection.ts');
  return commandValue(
    report,
    value => formatAcceptanceCoverage(projectAcceptanceCoverage(value))
  );
}

export async function acceptanceTargetsInspectionView(
  report: AcceptanceInspectionProjectionSource
): Promise<CommandValue> {
  const { projectAcceptanceTargets } = await import('../../application/acceptance-inspection.ts');
  const { formatAcceptanceTargets } = await import('./acceptance-inspection.ts');
  const value = projectAcceptanceTargets(report);
  return commandValue(value, formatAcceptanceTargets);
}

export async function runtimeReportInspectionView(
  report: RuntimeVerificationLaneReport
): Promise<CommandValue> {
  const { projectRuntimeInspection } = await import('../../application/runtime-inspection.ts');
  const { formatRuntimeReport } = await import('./runtime-inspection.ts');
  return commandValue(report, value => formatRuntimeReport(projectRuntimeInspection(value)));
}

export async function runtimeStepsInspectionView(
  report: RuntimeVerificationLaneReport
): Promise<CommandValue> {
  const { projectRuntimeInspection } = await import('../../application/runtime-inspection.ts');
  const { formatRuntimeStepsInspect } = await import('./runtime-inspection.ts');
  const value = projectRuntimeInspection(report);
  return commandValue(value, formatRuntimeStepsInspect);
}

export async function verificationReportInspectionView(
  report: VerificationReport
): Promise<CommandValue> {
  const { projectVerificationReportInspect } = await import('../../application/verification-report-inspect.ts');
  const { formatVerificationReport } = await import('./verification-report-inspect.ts');
  return commandValue(
    report,
    value => formatVerificationReport(projectVerificationReportInspect(value))
  );
}

export async function provenanceRegistryInspectionView(
  report: ProvenanceRegistryInspectProjectionSource
): Promise<CommandValue> {
  const { projectProvenanceRegistryInspect } = await import('../../application/provenance-registry-inspect.ts');
  const { formatProvenanceRegistry } = await import('./provenance-registry-inspect.ts');
  return commandValue(
    report,
    value => formatProvenanceRegistry(projectProvenanceRegistryInspect(value))
  );
}

export async function reviewSummaryInspectionView(
  report: ReviewSummary
): Promise<CommandValue> {
  const { projectReviewSummary } = await import('../../application/review-summary-inspect.ts');
  const { formatReviewSummary } = await import('./review-summary-inspect.ts');
  return commandValue(report, value => formatReviewSummary(projectReviewSummary(value)));
}

export async function reviewMatrixInspectionView(
  matrix: E2eMatrix
): Promise<CommandValue> {
  const { projectE2eMatrix } = await import('../../application/e2e-matrix-inspect.ts');
  const { formatE2eMatrix } = await import('./e2e-matrix-inspect.ts');
  const value = projectE2eMatrix(matrix);
  return commandValue(value, formatE2eMatrix);
}

export async function reviewDiagnosticsInspectionView(
  report: ReviewSummary
): Promise<CommandValue> {
  const { projectReviewDiagnostics } = await import('../../application/review-diagnostics-inspect.ts');
  const { formatReviewDiagnostics } = await import('./review-diagnostics-inspect.ts');
  const value = projectReviewDiagnostics(report);
  return commandValue(value, formatReviewDiagnostics);
}

export async function demoChecklistInspectionView(
  report: DemoChecklist
): Promise<CommandValue> {
  const { formatDemoChecklist } = await import('./demo-checklist.ts');
  return commandValue(report, formatDemoChecklist);
}

export async function projectOverviewInspectionView(
  report: ProjectOverview,
  presentation: ProjectOverviewPresentation
): Promise<CommandValue> {
  const { formatProjectOverview } = await import('./project-overview.ts');
  return commandValue(report, value => formatProjectOverview(value, presentation));
}

export async function installManifestInspectionView(
  report: InstalledManifestEntry[]
): Promise<CommandValue> {
  const { projectInstallManifest } = await import('../../application/install-manifest.ts');
  const { formatInstallManifest } = await import('./install-manifest.ts');
  const value = projectInstallManifest(report);
  return commandValue(value, formatInstallManifest);
}

export async function blockUsageInspectionView(
  report: BlockUsageMapView
): Promise<CommandValue> {
  const { projectBlockUsageMap } = await import('../../application/block-usage-map.ts');
  const { formatBlockUsageMap } = await import('./block-usage-map.ts');
  const value = projectBlockUsageMap(report);
  return commandValue(value, formatBlockUsageMap);
}

export async function postgresContractInspectionView(
  contract: PostgresContractProjectionSource
): Promise<CommandValue> {
  const { projectPostgresContract } = await import('../../application/postgres-contract.ts');
  const { formatPostgresContract } = await import('./postgres-contract.ts');
  return commandValue(
    contract,
    value => formatPostgresContract(projectPostgresContract(value))
  );
}

export async function errorProtocolContractInspectionView(
  contract: ErrorProtocolContract
): Promise<CommandValue> {
  const { formatErrorProtocolContract } = await import('./error-protocol-contract.ts');
  return commandValue(contract, formatErrorProtocolContract);
}

export async function ciContractInspectionView(
  contract: CiContract
): Promise<CommandValue> {
  const { formatCiContract } =
    await import('../../adapters/verification/platform/ci/contract/core.ts');
  return commandValue(contract, formatCiContract);
}
