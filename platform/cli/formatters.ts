import type {
  AcceptanceCoverageEntry,
  AcceptanceCoverageReport
} from '../shared/acceptance-types.ts';
import { buildCiArtifactUploadGroups, CI_ARTIFACT_MANIFEST_PATH } from '../shared/ci-artifact-contract.ts';
import type { CiArtifactKind, CiArtifactManifest, CiArtifactUploadGroup } from '../shared/ci-artifact-types.ts';
import { countMatching, uniqueSorted } from '../shared/collections.ts';
import { CONTRACT_FORMAT_VERSION } from '../shared/constants.ts';
import type { ExplainGraph } from '../shared/explain-types.ts';
import type { InstallPlanStep, LockFile } from '../shared/lock-types.ts';
import { toWorkspaceArtifactPath } from '../shared/paths.ts';
import type { PolicyReport } from '../shared/policy-types.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import type { RepairPlan } from '../shared/repair-types.ts';
import { reviewArtifactMissingReasonTypeCount, reviewArtifactUploadGroupCount } from '../shared/review-artifact.ts';
import { buildE2eMatrix, type E2eMatrix } from '../shared/review-matrix.ts';
import { buildReviewPolicySummary } from '../shared/review-policy.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import { upgradeDiagnosticsAttributionParts } from '../shared/review-upgrade.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../shared/upgrade-types.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../shared/verification-types.ts';
import { formatCounts, formatFields, formatList, formatMergedSummaryEntries, formatSummaryEntries, optionalFields } from './format-utils.ts';

export type ArtifactPathUploadGroup = CiArtifactUploadGroup;

export type ArtifactPathKind = CiArtifactKind;

export type ArtifactUploadPathContract = {
  formatVersion: CiArtifactManifest['formatVersion'];
  root: CiArtifactManifest['root'];
  kind: ArtifactPathKind | 'all';
  artifactStatus: CiArtifactManifest['summary']['artifactStatus'];
  count: number;
  paths: string[];
  byKind: Partial<Record<ArtifactPathKind, number>>;
  uploadGroupCount: number;
  uploadGroups: ArtifactPathUploadGroup[];
  missingCount: number;
  missingReasonTypeCount: number;
  missingReasonCounts: CiArtifactManifest['summary']['missingReasonCounts'];
  missing: CiArtifactManifest['missing'];
};

export type InstallManifestEntry = InstallPlanStep & { status: 'installed' };

export type BlockUsageMap = {
  blocks: Array<{
    id: string;
    installOrder: number;
  }>;
};

export type PostgresContract = {
  formatVersion: string;
  provider: string;
  persistenceMode: string;
  tables: Array<{
    name: string;
    tenantScoped: boolean;
    columns: string[];
  }>;
};

export type RuntimeStepInspect = {
  id: 'build' | 'unit' | 'acceptance';
  status: RuntimeVerificationLaneReport['status'];
  passedCount: number;
  failedCount: number;
  command: string | null;
  passed: string[];
  failed: string[];
};

export type RuntimeStepsInspect = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: RuntimeVerificationLaneReport['status'];
  stepCount: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  steps: RuntimeStepInspect[];
};

export type DemoChecklistItem = {
  id: string;
  status: 'passed' | 'missing';
  artifactPath: string;
  command: string;
};

export type DemoChecklist = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: 'passed' | 'attention';
  itemCount: number;
  missingCount: number;
  items: DemoChecklistItem[];
  nextCommand: string;
};

export function formatCiArtifactManifest(manifest: CiArtifactManifest): string {
  return [
    `Artifact manifest ${manifest.summary.artifactStatus}`,
    formatFields([
      `artifacts=${manifest.summary.artifactCount}`,
      `missing=${manifest.summary.missingCount}`,
      `upload groups=${manifest.summary.uploadGroupCount}`
    ]),
    `Kinds: governance=${manifest.summary.governanceCount}, view=${manifest.summary.viewCount}, test=${manifest.summary.testCount}, contract=${manifest.summary.contractCount}`,
    `Missing reasons: ${formatCounts(Object.entries(manifest.summary.missingReasonCounts).flatMap(([reason, count]) => Array(count).fill(reason)))}`,
    `Upload groups: ${formatList(manifest.uploadGroups.map((group) => `${group.kind}=${group.count}`))}`
  ].join('\n');
}

export function artifactUploadPathSummary(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): {
  paths: string[];
  byKind: Partial<Record<ArtifactPathKind, number>>;
  uploadGroups: ArtifactPathUploadGroup[];
} {
  const contractPaths = new Set(
    manifest.summary.contractPaths.map((artifactPath) => toWorkspaceArtifactPath(artifactPath))
  );
  const artifacts = kind === 'contract'
    ? manifest.artifacts.filter((artifact) => contractPaths.has(toWorkspaceArtifactPath(artifact.path)))
    : kind
      ? manifest.artifacts.filter((artifact) => artifact.kind === kind)
      : manifest.artifacts;
  const includeManifest = kind === undefined || kind === 'governance';
  const entries = [
    ...(includeManifest
      ? [{ path: CI_ARTIFACT_MANIFEST_PATH, kind: 'governance' as const }]
      : []),
    ...artifacts.map((artifact) => ({
      path: toWorkspaceArtifactPath(artifact.path),
      kind: kind === 'contract' ? 'contract' as const : artifact.kind
    }))
  ];
  const kindByPath = new Map(entries.map((entry) => [entry.path, entry.kind]));
  const paths = uniqueSorted([...kindByPath.keys()]);
  const uploadEntries = paths.flatMap((path) => {
    const pathKind = kindByPath.get(path);
    return pathKind ? [{ path, kind: pathKind }] : [];
  });
  const byKind: Partial<Record<ArtifactPathKind, number>> = {};
  for (const entry of uploadEntries) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  const uploadGroups = buildCiArtifactUploadGroups(uploadEntries);

  return { paths, byKind, uploadGroups };
}

export function buildArtifactUploadPathContract(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): ArtifactUploadPathContract {
  const pathSummary = artifactUploadPathSummary(manifest, kind);
  return {
    formatVersion: manifest.formatVersion,
    root: manifest.root,
    kind: kind ?? 'all',
    artifactStatus: manifest.summary.artifactStatus,
    count: pathSummary.paths.length,
    paths: pathSummary.paths,
    byKind: pathSummary.byKind,
    uploadGroupCount: pathSummary.uploadGroups.length,
    uploadGroups: pathSummary.uploadGroups,
    missingCount: manifest.missing.length,
    missingReasonTypeCount: manifest.summary.missingReasonTypeCount,
    missingReasonCounts: manifest.summary.missingReasonCounts,
    missing: manifest.missing
  };
}

export function formatInstallManifest(manifest: InstallManifestEntry[]): string {
  return [
    `Install manifest ${manifest.length} steps`,
    `Blocks: ${formatList(uniqueSorted(manifest.map((entry) => entry.blockId)))}`,
    `Actions: ${formatCounts(manifest.map((entry) => entry.action))}`,
    `Registry kinds: ${formatCounts(manifest.map((entry) => entry.registryKind))}`,
    `Statuses: ${formatCounts(manifest.map((entry) => entry.status))}`
  ].join('\n');
}

export function formatBlockUsageMap(usageMap: BlockUsageMap): string {
  const blocks = usageMap.blocks
    .slice()
    .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id));
  return [
    `Block usage map ${blocks.length} blocks`,
    `Install order: ${formatList(blocks.map((block) => `${block.installOrder}:${block.id}`))}`
  ].join('\n');
}

export function formatPostgresContract(contract: PostgresContract): string {
  const tenantScopedCount = countMatching(contract.tables, (table) => table.tenantScoped);
  return [
    `Postgres contract ${contract.provider}`,
    formatFields([
      `mode=${contract.persistenceMode}`,
      `tables=${contract.tables.length}`,
      `tenantScoped=${tenantScopedCount}`
    ]),
    `Table list: ${formatList(contract.tables.map((table) => table.name))}`
  ].join('\n');
}

export function formatLockInspect(lock: LockFile): string {
  return [
    `Graph lock ${lock.app.name}`,
    formatFields([
      `stack=${lock.app.stack}`,
      `mode=${lock.app.mode}`,
      `blocks=${lock.resolvedBlocks.length}`,
      `slots=${lock.slotTasks.length}`,
      `generated=${lock.generatedPaths.length}`,
      `acceptance=${lock.acceptancePlan.length}`
    ]),
    `Block order: ${formatList(
      lock.resolvedBlocks
        .slice()
        .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id))
        .map((block) => `${block.installOrder}:${block.id}@${block.version}`)
    )}`,
    `Pass status: ${formatCounts(Object.values(lock.passStatus))}`
  ].join('\n');
}

export function formatExplainGraphInspect(graph: ExplainGraph): string {
  return [
    `Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`,
    `Node types: ${formatCounts(graph.nodes.map((node) => node.type))}`,
    `Edge types: ${formatCounts(graph.edges.map((edge) => edge.type))}`,
    formatFields([
      `Coverage overlay: ${graph.overlays.coverage.blocks.length} blocks`,
      `${graph.overlays.coverage.slots.length} slots`
    ]),
    `Provenance overlay: ${graph.overlays.provenance.length} artifacts`
  ].join('\n');
}

export function formatDemoChecklist(checklist: DemoChecklist): string {
  return [
    formatFields([
      `Demo checklist ${checklist.status}`,
      `items=${checklist.itemCount}`,
      `missing=${checklist.missingCount}`
    ]),
    ...checklist.items.map((item) => formatFields([
      `${item.id}: ${item.status}`,
      item.artifactPath,
      `command=${item.command}`
    ])),
    `Next command: ${checklist.nextCommand}`
  ].join('\n');
}

function formatE2eMatrixRow(row: E2eMatrix['rows'][number], prefix = ''): string {
  return formatFields([`${prefix}${row.stage}: ${row.status}`, row.detail, `evidence=${row.evidence.join(', ') || 'none'}`]);
}

export function formatE2eMatrix(matrix: E2eMatrix): string {
  return [
    `E2E matrix ${matrix.status}; rows=${matrix.rowCount}`,
    ...matrix.rows.map((row) => formatE2eMatrixRow(row))
  ].join('\n');
}

export type ReviewDiagnosticEntry =
  | {
    id: string;
    category: 'failure';
    kind: ReviewSummary['failurePoints'][number]['kind'];
    lane: ReviewSummary['failurePoints'][number]['lane'];
    message: string;
    artifactPath: string;
  }
  | {
    id: string;
    category: 'regression-risk';
    kind: ReviewSummary['regressionRisks'][number]['kind'];
    message: string;
    blockId?: string;
    slotId?: string;
  }
  | {
    id: string;
    category: 'conflict';
    kind: ReviewSummary['conflictHints'][number]['kind'];
    message: string;
    relatedId: string;
  };

export type ReviewDiagnosticsInspect = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: ReviewSummary['ciSummary']['status'];
  diagnosticCount: number;
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  artifactPathCount: number;
  artifactPaths: string[];
  blockCount: number;
  blocks: string[];
  slotCount: number;
  slots: string[];
  diagnostics: ReviewDiagnosticEntry[];
};

export function buildReviewDiagnosticsInspect(summary: ReviewSummary): ReviewDiagnosticsInspect {
  const diagnostics: ReviewDiagnosticEntry[] = [
    ...summary.failurePoints.map((point, index) => ({
      id: `failure:${index}`,
      category: 'failure' as const,
      kind: point.kind,
      lane: point.lane,
      message: point.message,
      artifactPath: point.artifactPath
    })),
    ...summary.regressionRisks.map((risk, index) => ({
      id: `regression-risk:${index}`,
      category: 'regression-risk' as const,
      kind: risk.kind,
      message: risk.message,
      ...(risk.blockId ? { blockId: risk.blockId } : {}),
      ...(risk.slotId ? { slotId: risk.slotId } : {})
    })),
    ...summary.conflictHints.map((hint, index) => ({
      id: `conflict:${index}`,
      category: 'conflict' as const,
      kind: hint.kind,
      message: hint.message,
      relatedId: hint.relatedId
    }))
  ];
  const artifactPaths = uniqueSorted(summary.failurePoints.map((point) => point.artifactPath));
  const blocks = uniqueSorted(summary.regressionRisks.map((risk) => risk.blockId ?? ''));
  const slots = uniqueSorted(summary.regressionRisks.map((risk) => risk.slotId ?? ''));

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: summary.ciSummary.status,
    diagnosticCount: diagnostics.length,
    failureCount: summary.failurePoints.length,
    regressionRiskCount: summary.regressionRisks.length,
    conflictHintCount: summary.conflictHints.length,
    artifactPathCount: artifactPaths.length,
    artifactPaths,
    blockCount: blocks.length,
    blocks,
    slotCount: slots.length,
    slots,
    diagnostics
  };
}

function formatReviewDiagnostic(entry: ReviewDiagnosticEntry): string {
  const fields: string[] = [`Diagnostic ${entry.id}`, `kind=${entry.kind}`];
  if (entry.category === 'failure') fields.push(`lane=${entry.lane}`, `artifact=${entry.artifactPath}`);
  else if (entry.category === 'regression-risk') fields.push(`block=${entry.blockId ?? 'none'}`, `slot=${entry.slotId ?? 'none'}`);
  else fields.push(`related=${entry.relatedId}`);
  fields.push(entry.message);
  return formatFields(fields);
}

export function formatReviewDiagnosticsInspect(inspect: ReviewDiagnosticsInspect): string {
  return [
    formatFields([
      `Review diagnostics ${inspect.status}`,
      `diagnostics=${inspect.diagnosticCount}`,
      `failures=${inspect.failureCount}`,
      `risks=${inspect.regressionRiskCount}`,
      `conflicts=${inspect.conflictHintCount}`
    ]),
    `Artifacts: ${formatList(inspect.artifactPaths)}`,
    `Blocks: ${formatList(inspect.blocks)}`,
    `Slots: ${formatList(inspect.slots)}`,
    ...inspect.diagnostics.slice(0, 10).map((entry) => formatReviewDiagnostic(entry))
  ].join('\n');
}

export function formatUpgradeDiagnosticsDetails(details: unknown): string {
  return formatList(upgradeDiagnosticsAttributionParts(details));
}

function repairTaskReview(task: RepairPlan['tasks'][number]): NonNullable<RepairPlan['tasks'][number]['review']> {
  const failureTargets = uniqueSorted(task.failurePoints.flatMap((point) => point.targetIds ?? []));
  return task.review ?? {
    allowedPathCount: task.allowedPaths.length,
    requiredSymbolCount: task.requiredSymbols.length,
    forbiddenOperationCount: task.forbiddenOperations.length,
    testCount: task.testsToPass.length,
    failureTargetCount: failureTargets.length,
    writeBounds: [...task.allowedPaths],
    requiredSymbols: [...task.requiredSymbols],
    forbiddenOperations: [...task.forbiddenOperations],
    testsToPass: [...task.testsToPass],
    failureTargets
  };
}

function formatRepairFailurePoint(failure: RepairPlan['tasks'][number]['failurePoints'][number]): string {
  return formatFields([
    `Failure ${failure.lane}/${failure.kind}`,
    `issue=${failure.issueType}`,
    `repairable=${failure.repairable}`,
    failure.message
  ]);
}

export function formatRepairSummary(repairPlan: RepairPlan, dryRun: boolean): string {
  const suffix = repairPlan.status === 'applied' ? '; verify pending' : dryRun ? ' (dry-run)' : '';
  const lines = [
    `Repair ${repairPlan.status} (${repairPlan.tasks.length} tasks, ${repairPlan.blockers?.length ?? 0} blockers)${suffix}`,
    `Source verification: ${repairPlan.sourceVerificationStatus}; requires verification: ${repairPlan.requiresVerification}`
  ];
  for (const task of repairPlan.tasks.slice(0, 3)) {
    const review = repairTaskReview(task);
    lines.push(`Task ${task.taskId}: ${task.targetBlock} -> ${task.targetFile}`);
    lines.push(
      formatFields([
        `Review ${task.taskId}: writeBounds=${formatList(review.writeBounds)}`,
        `symbols=${formatList(review.requiredSymbols)}`,
        `tests=${formatList(review.testsToPass)}`,
        `forbidden=${formatList(review.forbiddenOperations)}`,
        `failureTargets=${formatList(review.failureTargets)}`
      ])
    );
    if (task.preview) {
      lines.push(
        formatFields([
          `Preview ${task.taskId}: changed=${task.preview.changed}`,
          `+${task.preview.addedLines}`,
          `-${task.preview.removedLines}`,
          `${task.preview.beforeLines}->${task.preview.afterLines} lines`
        ])
      );
    }
    for (const failure of task.failurePoints.slice(0, 2)) {
      lines.push(formatRepairFailurePoint(failure));
    }
  }
  for (const blocker of repairPlan.blockers?.slice(0, 3) ?? []) {
    lines.push(`Blocker ${blocker.blockerId}: ${blocker.boundary}; ${blocker.reason}`);
    for (const failure of blocker.failurePoints.slice(0, 2)) {
      lines.push(formatRepairFailurePoint(failure));
    }
  }
  return lines.join('\n');
}

function formatUpgradeMigrationDetails(
  migration: UpgradePlan['migrationSummaries'][number],
  operation: UpgradePlan['migrationOperations'][number] | undefined
): string[] {
  return [
    `Migration ${migration.id}: ${migration.kind}`,
    `target=${migration.target}`,
    ...optionalFields([
      [migration.source, `source=${migration.source}`],
      [migration.slotId, `slot=${migration.slotId}`],
      [operation?.role, `role=${operation?.role}`],
      [operation?.inputType, `input=${operation?.inputType}`],
      [operation?.outputType, `output=${operation?.outputType}`],
      [operation?.writableZones, `writableZones=${operation?.writableZones?.join(',')}`],
      [operation?.path, `path=${operation?.path?.join('.')}`],
      [operation?.updateCount, `updates=${operation?.updateCount}`],
      [operation?.itemCount, `items=${operation?.itemCount}`],
      [operation?.valueKeyCount, `valueKeys=${operation?.valueKeyCount}`],
      [operation?.contentLength, `contentLength=${operation?.contentLength}`],
      [operation?.searchLength, `searchLength=${operation?.searchLength}`],
      [operation?.replacementLength, `replacementLength=${operation?.replacementLength}`],
      [operation?.pattern, `pattern=${operation?.pattern}`],
      [operation?.flags, `flags=${operation?.flags}`]
    ]),
    `requiresVerification=${migration.requiresVerification}`
  ];
}

export type PolicySourceInspect = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: PolicyReport['status'];
  sourceCount: number;
  policyCount: number;
  sources: Array<{
    scope: 'official' | 'project';
    path: string;
    policyCount: number;
    policyIds: string[];
  }>;
};

export function buildPolicySourceInspect(report: PolicyReport): PolicySourceInspect {
  const sources = [
    ...report.official.sources.map((source) => ({
      scope: 'official' as const,
      path: source.path,
      policyCount: source.policyIds.length,
      policyIds: source.policyIds
    })),
    ...report.project.sources.map((source) => ({
      scope: 'project' as const,
      path: source.path,
      policyCount: source.policyIds.length,
      policyIds: source.policyIds
    }))
  ].sort((left, right) => left.scope.localeCompare(right.scope) || left.path.localeCompare(right.path));
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: report.status,
    sourceCount: sources.length,
    policyCount: sources.reduce((count, source) => count + source.policyCount, 0),
    sources
  };
}

export function buildPolicySummary(report: PolicyReport): NonNullable<ReviewSummary['policySummary']> {
  return buildReviewPolicySummary(report);
}

export function formatPolicySources(report: PolicySourceInspect): string {
  const lines = [
    `Policy sources ${report.status}`,
    formatFields([`sources=${report.sourceCount}`, `policies=${report.policyCount}`])
  ];
  for (const source of report.sources.slice(0, 5)) {
    lines.push(
      formatFields([
        `Source ${source.scope}`,
        `path=${source.path}`,
        `policies=${formatList(source.policyIds)}`
      ])
    );
  }
  return lines.join('\n');
}

export function formatPolicyReport(report: NonNullable<ReviewSummary['policySummary']>): string {
  const severity = Object.entries(report.severityCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([level, count]) => `${level}=${count}`);
  const lines = [
    formatFields([
      `Policy report ${report.status}`,
      `official=${report.officialPolicyCount}`,
      `project=${report.projectPolicyCount}`,
      `merged=${report.mergedPolicyCount}`,
      `violations=${report.violationCount}`
    ]),
    `Sources: ${report.sourceCount}`,
    `Severity: ${formatList(severity)}`
  ];
  for (const policy of report.mergedSummaries.slice(0, 3)) {
    lines.push(
      formatFields([
        `Policy ${policy.id}`,
        `scope=${policy.sourceScope}`,
        `source=${policy.sourcePath}`,
        `targets=${formatList(policy.targets)}`
      ])
    );
  }
  for (const violation of report.violationSummaries.slice(0, 3)) {
    lines.push(
      formatFields([
        `Violation ${violation.id}`,
        `severity=${violation.severity}`,
        `files=${formatList(violation.files)}`,
        violation.message
      ])
    );
  }
  return lines.join('\n');
}

export type AcceptanceTargetInspect = {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  status: AcceptanceCoverageReport['status'];
  targetKind: 'blocks' | 'slots';
  targetCount: number;
  coveredCount: number;
  uncoveredCount: number;
  uncoveredIds: string[];
  targets: Array<AcceptanceCoverageEntry & { declaredAcceptanceCount: number; coveredByCount: number }>;
};

export function buildAcceptanceTargetInspect(
  report: AcceptanceCoverageReport,
  targetKind: 'blocks' | 'slots'
): AcceptanceTargetInspect {
  const entries = targetKind === 'blocks' ? report.blocks : report.slots;
  const uncoveredIds = targetKind === 'blocks' ? report.uncoveredBlocks : report.uncoveredSlots;
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: report.status,
    targetKind,
    targetCount: entries.length,
    coveredCount: countMatching(entries, (entry) => !entry.uncovered),
    uncoveredCount: uncoveredIds.length,
    uncoveredIds,
    targets: entries.map((entry) => ({
      ...entry,
      declaredAcceptanceCount: entry.declaredAcceptance.length,
      coveredByCount: entry.coveredBy.length
    }))
  };
}

function formatAcceptanceTarget(
  label: 'Target' | 'Block' | 'Slot',
  target: AcceptanceTargetInspect['targets'][number]
): string {
  return formatFields([
    `${label} ${target.id}`,
    `declared=${target.declaredAcceptanceCount}`,
    `coveredBy=${formatList(target.coveredBy)}`,
    `uncovered=${target.uncovered}`
  ]);
}

export function formatAcceptanceTargets(report: AcceptanceTargetInspect): string {
  const label = report.targetKind === 'blocks' ? 'Acceptance coverage blocks' : 'Acceptance coverage slots';
  return [
    `${label} ${report.status}`,
    formatFields([
      `targets=${report.targetCount}`,
      `covered=${report.coveredCount}`,
      `uncovered=${report.uncoveredCount}`
    ]),
    `Uncovered: ${formatList(report.uncoveredIds)}`,
    ...report.targets.slice(0, 5).map((target) => formatAcceptanceTarget('Target', target))
  ].join('\n');
}

export function formatAcceptanceCoverage(report: AcceptanceCoverageReport): string {
  const blockTargets = buildAcceptanceTargetInspect(report, 'blocks');
  const slotTargets = buildAcceptanceTargetInspect(report, 'slots');
  return [
    formatFields([
      `Acceptance coverage ${report.status}`,
      `acceptancePassed=${report.acceptancePassed.length}`,
      `blocks=${blockTargets.coveredCount}/${blockTargets.targetCount}`,
      `slots=${slotTargets.coveredCount}/${slotTargets.targetCount}`,
      `uncoveredBlocks=${blockTargets.uncoveredCount}`,
      `uncoveredSlots=${slotTargets.uncoveredCount}`
    ]),
    `Uncovered blocks: ${formatList(blockTargets.uncoveredIds)}`,
    `Uncovered slots: ${formatList(slotTargets.uncoveredIds)}`,
    ...blockTargets.targets.slice(0, 3).map((target) => formatAcceptanceTarget('Block', target)),
    ...slotTargets.targets.slice(0, 3).map((target) => formatAcceptanceTarget('Slot', target))
  ].join('\n');
}

function buildRuntimeStepInspect(
  id: RuntimeStepInspect['id'],
  step: RuntimeVerificationLaneReport['build']
): RuntimeStepInspect {
  return {
    id,
    status: step.status,
    passedCount: step.passed.length,
    failedCount: step.failed.length,
    command: step.command,
    passed: step.passed,
    failed: step.failed
  };
}

export function buildRuntimeStepsInspect(report: RuntimeVerificationLaneReport): RuntimeStepsInspect {
  const steps = [
    buildRuntimeStepInspect('build', report.build),
    buildRuntimeStepInspect('unit', report.unit),
    buildRuntimeStepInspect('acceptance', report.acceptance)
  ];
  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: report.status,
    stepCount: steps.length,
    passedCount: countMatching(steps, (step) => step.status === 'passed'),
    failedCount: countMatching(steps, (step) => step.status === 'failed'),
    skippedCount: countMatching(steps, (step) => step.status === 'skipped'),
    steps
  };
}

function formatRuntimeStep(step: RuntimeStepInspect, label: string = step.id): string {
  return formatFields([
    `${label}: ${step.status}`,
    `passed=${step.passedCount}`,
    `failed=${step.failedCount}`,
    `command=${step.command ?? 'none'}`
  ]);
}

export function formatRuntimeStepsInspect(inspect: RuntimeStepsInspect): string {
  return [
    formatFields([
      `Runtime steps ${inspect.status}`,
      `steps=${inspect.stepCount}`,
      `passed=${inspect.passedCount}`,
      `failed=${inspect.failedCount}`,
      `skipped=${inspect.skippedCount}`
    ]),
    ...inspect.steps.map((step) => formatRuntimeStep(step))
  ].join('\n');
}

export function formatRuntimeReport(report: RuntimeVerificationLaneReport): string {
  const inspect = buildRuntimeStepsInspect(report);
  const labels: Record<RuntimeStepInspect['id'], string> = {
    build: 'Build',
    unit: 'Unit',
    acceptance: 'Acceptance'
  };
  return [
    `Runtime report ${report.status}`,
    ...inspect.steps.map((step) => formatRuntimeStep(step, labels[step.id]))
  ].join('\n');
}

export function formatVerificationReport(report: VerificationReport): string {
  return [
    formatFields([
      `Verification report ${report.summary.status}`,
      `requestedLane=${report.summary.requestedLane}`,
      `failedLanes=${formatList(report.summary.failedLanes)}`
    ]),
    formatFields([
      `Fast: ${report.fast.status}`,
      `build=${report.fast.build.status}`,
      `unit=${report.fast.unit.status}`,
      `acceptance=${report.fast.acceptance.status}`,
      `policy=${report.fast.policy.status}`
    ]),
    formatFields([
      `Runtime: ${report.runtime.status}`,
      `build=${report.runtime.build.status}`,
      `unit=${report.runtime.unit.status}`,
      `acceptance=${report.runtime.acceptance.status}`
    ])
  ].join('\n');
}

export function formatProvenanceRegistry(provenance: ProvenanceFile): string {
  const registryArtifacts = provenance.artifacts.filter((artifact) => artifact.registrySourceId);
  const unverifiedArtifacts = provenance.artifacts.filter((artifact) => artifact.verifiedBy.length === 0);
  const overrideArtifacts = provenance.artifacts.filter((artifact) => artifact.overrideStatus !== 'none');
  const generatedPasses = uniqueSorted(
    provenance.artifacts.map((artifact) => artifact.generatedByPass ?? '')
  );
  const lines = [
    formatFields([
      'Provenance registry',
      `artifacts=${provenance.artifacts.length}`,
      `registry=${registryArtifacts.length}`,
      `overrides=${overrideArtifacts.length}`,
      `unverified=${unverifiedArtifacts.length}`
    ]),
    `Origins: ${formatCounts(provenance.artifacts.map((artifact) => artifact.originType))}`,
    `Registry sources: ${formatCounts(registryArtifacts.map((artifact) => artifact.registrySourceId ?? 'unknown'))}`,
    `Generated passes: ${formatList(generatedPasses)}`
  ];
  const sampleArtifacts = [
    ...provenance.artifacts.filter((artifact) => artifact.originType === 'block').slice(0, 2),
    ...provenance.artifacts.filter((artifact) => artifact.originType === 'slot').slice(0, 2),
    ...provenance.artifacts.filter((artifact) => artifact.originType === 'override').slice(0, 2),
    ...provenance.artifacts.filter((artifact) => artifact.originType === 'generated').slice(0, 2)
  ].slice(0, 5);
  for (const artifact of sampleArtifacts) {
    lines.push(
      formatFields([
        `Artifact ${artifact.path}`,
        `origin=${artifact.originType}:${artifact.originId}`,
        `registry=${artifact.registrySourceId ?? 'none'}`,
        `verifiedBy=${formatList(artifact.verifiedBy)}`,
        `override=${artifact.overrideStatus}`
      ])
    );
  }
  return lines.join('\n');
}

export function formatReviewSummaryContract(summary: ReviewSummary): string {
  const coverage = summary.coverageSummary;
  const provenance = summary.provenanceSummary;
  const artifacts = summary.artifactSummary;
  const lines = [
    formatFields([
      `Review summary ${summary.chainSummary.status}`,
      `format=${summary.formatVersion}`,
      `stages=${summary.chainSummary.passedStageCount}/${summary.chainSummary.stageCount}`,
      `attention=${summary.chainSummary.attentionStageCount}`,
      `failed=${summary.chainSummary.failedStageCount}`
    ]),
    formatFields([
      `CI ${summary.ciSummary.status}`,
      `failures=${summary.ciSummary.failureCount}`,
      `risks=${summary.ciSummary.regressionRiskCount}`,
      `conflicts=${summary.ciSummary.conflictHintCount}`
    ]),
    formatFields([
      `Impact blocks=${summary.impactedBlocks.length}`,
      `slots=${summary.impactedSlots.length}`,
      `runtime=${summary.runtimeEntryCount}`,
      `changeSources=${summary.changeSourceCount}`,
      `installImpacts=${summary.installImpactCount}`
    ]),
    formatFields([
      `Coverage ${coverage?.status ?? 'missing'}`,
      `blocks=${coverage ? `${coverage.coveredBlockCount}/${coverage.blockCount}` : 'missing'}`,
      `slots=${coverage ? `${coverage.coveredSlotCount}/${coverage.slotCount}` : 'missing'}`
    ]),
    formatFields([
      `Provenance artifacts=${provenance?.artifactCount ?? 0}`,
      `registry=${provenance?.registryArtifactCount ?? 0}`,
      `generated=${provenance?.generatedArtifactCount ?? 0}`,
      `unverified=${provenance?.unverifiedArtifactCount ?? 0}`
    ]),
    formatFields([
      `Artifacts ${artifacts?.artifactStatus ?? 'missing'}`,
      `total=${artifacts?.artifactCount ?? 0}`,
      `missing=${artifacts?.missingCount ?? 0}`,
      `missingReasonTypes=${reviewArtifactMissingReasonTypeCount(artifacts)}`,
      `contracts=${artifacts?.contractCount ?? 0}`,
      `uploadGroups=${reviewArtifactUploadGroupCount(artifacts)}`
    ]),
    `Stages: ${summary.chainSummary.stageSummaries
      .map((stage) => `${stage.id}=${stage.status}`)
      .join(', ') || 'none'}`
  ];

  const upgrade = summary.upgradeSummary;
  if (upgrade) {
    lines.push(
      formatFields([
        `Upgrade ${upgrade.status}`,
        `${upgrade.blockId} ${upgrade.fromVersion ? `${upgrade.fromVersion} -> ${upgrade.toVersion}` : `target ${upgrade.toVersion}`}`,
        `migrations=${upgrade.migrationCount}`,
        `impacts=${upgrade.impactCount}`,
        `requiresVerification=${upgrade.requiresVerification}`
      ])
    );
    if (upgrade.diagnostics) {
      lines.push(
        formatFields([
          `Upgrade diagnostics ${upgrade.diagnostics.phase}`,
          upgrade.diagnostics.failedCheck,
          upgrade.diagnostics.errorCode,
          upgrade.diagnostics.message,
          `attribution=${formatUpgradeDiagnosticsDetails(upgrade.diagnostics.details)}`
        ])
      );
    }
  }

  return lines.join('\n');
}

export function formatUpgradeDiagnostics(diagnostics: UpgradeDiagnostics): string {
  return [
    `Upgrade diagnostics ${diagnostics.phase}`,
    formatFields([
      `Block: ${diagnostics.blockId}`,
      `target: ${diagnostics.targetVersion}`,
      `status: ${diagnostics.status}`
    ]),
    formatFields([
      `Failed check: ${diagnostics.failedCheck}`,
      `code: ${diagnostics.errorCode}`
    ]),
    `Message: ${diagnostics.message}`,
    `Attribution: ${formatUpgradeDiagnosticsDetails(diagnostics.details)}`
  ].join('\n');
}

export function formatUpgradeSummary(upgradePlan: UpgradePlan, dryRun: boolean): string {
  const suffix = dryRun ? ' (dry-run)' : '';
  const migrationKinds = Object.entries(upgradePlan.migrationKindCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}=${count}`);
  const requiresVerificationCount = countMatching(
    upgradePlan.migrationSummaries,
    (migration) => migration.requiresVerification
  );
  const preflightEvidenceCount = upgradePlan.preflightChecks.reduce(
    (count, check) => count + check.evidence.length,
    0
  );
  const lines = [
    `Upgrade ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}${suffix}`,
    formatFields([
      `Status: ${upgradePlan.status}`,
      `migrations: ${upgradePlan.migrations.length}`,
      `preflight checks: ${upgradePlan.preflightChecks.length}`
    ]),
    `Migration kinds: ${formatList(migrationKinds)}`,
    `Operation roles: ${formatCounts(upgradePlan.migrationOperations.map((operation) => operation.role))}`,
    `Impacts: ${formatList(upgradePlan.impacts)}`,
    `Preflight evidence: ${preflightEvidenceCount}`,
    `Requires verification: ${requiresVerificationCount > 0} (${requiresVerificationCount} migrations)`
  ];
  const operationsById = new Map(upgradePlan.migrationOperations.map((operation) => [operation.id, operation]));
  for (const migration of upgradePlan.migrationSummaries.slice(0, 3)) {
    lines.push(formatFields(formatUpgradeMigrationDetails(migration, operationsById.get(migration.id))));
  }
  for (const check of upgradePlan.preflightChecks.slice(0, 3)) {
    lines.push(
      formatFields([
        `Preflight ${check.id}: ${check.status}`,
        `evidence=${check.evidence.length}`
      ])
    );
  }
  return lines.join('\n');
}

export function formatExplainSummary(graph: ExplainGraph, reviewSummary: ReviewSummary): string {
  const {
    artifactSummary,
    chainSummary,
    ciSummary,
    coverageSummary,
    installImpactSummary,
    provenanceSummary
  } = reviewSummary;
  const uncoveredBlocks = coverageSummary?.uncoveredBlockCount ?? countMatching(
    graph.overlays.coverage.blocks,
    (block) => block.coveredBy.length === 0
  );
  const uncoveredSlots = coverageSummary?.uncoveredSlotCount ?? countMatching(
    graph.overlays.coverage.slots,
    (slot) => slot.coveredBy.length === 0
  );
  const blockCount = coverageSummary?.blockCount ?? graph.overlays.coverage.blocks.length;
  const slotCount = coverageSummary?.slotCount ?? graph.overlays.coverage.slots.length;
  const e2eMatrix = buildE2eMatrix(reviewSummary);
  const lines = [
    `Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`,
    `Node types: ${formatCounts(graph.nodes.map((node) => node.type))}`,
    `Edge types: ${formatCounts(graph.edges.map((edge) => edge.type))}`,
    formatFields([
      `Coverage: ${blockCount} blocks`,
      `${slotCount} slots`,
      `uncovered blocks=${uncoveredBlocks}`,
      `uncovered slots=${uncoveredSlots}`
    ]),
    `Provenance origins: ${formatCounts(
      graph.overlays.provenance.map((artifact) => artifact.originType)
    )}`,
    formatFields([
      `CI status: ${ciSummary.status}`,
      `failures: ${ciSummary.failureCount}`,
      `regression risks: ${ciSummary.regressionRiskCount}`,
      `conflict hints: ${ciSummary.conflictHintCount}`
    ]),
    formatFields([
      `Chain: ${chainSummary.status}`,
      `stages: ${chainSummary.passedStageCount}/${chainSummary.stageCount}`,
      `attention: ${chainSummary.attentionStageCount}`,
      `failed: ${chainSummary.failedStageCount}`
    ]),
    ...e2eMatrix.rows.map((row) => formatE2eMatrixRow(row, 'E2E ')),
    [
      `Impacted: ${ciSummary.impactedBlockCount} blocks`,
      `${ciSummary.impactedSlotCount} slots`,
      `${ciSummary.runtimeEntryCount} runtime entries`
    ].join(', ')
  ];

  if (coverageSummary) {
    lines.push(
      formatFields([
        `Coverage detail: ${coverageSummary.status}`,
        `acceptance passed: ${coverageSummary.acceptancePassedCount}`,
        `covered blocks: ${coverageSummary.coveredBlockCount}/${coverageSummary.blockCount}`,
        `covered slots: ${coverageSummary.coveredSlotCount}/${coverageSummary.slotCount}`
      ])
    );
  }

  lines.push(
    formatFields([
      `Install impact: ${installImpactSummary.impactCount} impacts`,
      `groups: ${installImpactSummary.groupCount}`,
      `actions: ${installImpactSummary.actionKinds.join(', ') || 'none'}`,
      `runtime entries: ${installImpactSummary.runtimeEntryCount}`,
      `targets: ${installImpactSummary.targetPathCount}`
    ])
  );

  if (provenanceSummary) {
    lines.push(
      formatFields([
        `Provenance detail: artifacts: ${provenanceSummary.artifactCount}`,
        `overrides: ${provenanceSummary.overrideArtifactCount}`,
        `registry: ${provenanceSummary.registryArtifactCount}`,
        `unverified: ${provenanceSummary.unverifiedArtifactCount}`
      ])
    );
  }

  if (artifactSummary) {
    const uploadGroups = artifactSummary.uploadGroups?.map(
      (group) => `${group.kind}=${group.count}`
    ) ?? [];
    lines.push(
      formatFields([
        `Artifacts: ${artifactSummary.artifactStatus ?? 'passed'}`,
        `total: ${artifactSummary.artifactCount}`,
        `missing: ${artifactSummary.missingCount}`,
        `missing reason types: ${reviewArtifactMissingReasonTypeCount(artifactSummary)}`,
        `contracts: ${artifactSummary.contractCount ?? 0}`,
        `upload groups: ${reviewArtifactUploadGroupCount(artifactSummary)}`
      ]),
      `Upload groups: ${formatList(uploadGroups)}`
    );
  }

  if (reviewSummary.policySummary) {
    const policy = reviewSummary.policySummary;
    lines.push(
      formatFields([
        `Policy: ${policy.status}`,
        `official: ${policy.officialPolicyCount}`,
        `project: ${policy.projectPolicyCount}`,
        `merged: ${policy.mergedPolicyCount}`,
        `violations: ${policy.violationCount}`
      ])
    );
  }

  if (reviewSummary.repairSummary) {
    const repair = reviewSummary.repairSummary;
    lines.push(
      formatFields([
        `Repair: ${repair.status}`,
        `tasks: ${repair.taskCount}`,
        `blockers: ${repair.blockerCount}`,
        `changed previews: ${repair.changedPreviewCount}`,
        `requires verification: ${repair.requiresVerification}`,
        `trace: ${repair.verificationTrace.pendingReason}->${repair.verificationTrace.nextAction}`,
        `categories: ${formatSummaryEntries(repair.taskCategorySummaries)}`,
        `issues: ${formatSummaryEntries(repair.failureTaxonomy.issueTypeSummaries)}`,
        `targets: ${formatMergedSummaryEntries(
          repair.targetSummaries.map((target) => ({
            id: target.targetType,
            count: target.count
          }))
        )}`,
        `repairability: ${formatSummaryEntries(repair.failureTaxonomy.repairabilitySummaries)}`
      ])
    );
  }

  if (reviewSummary.upgradeSummary) {
    const upgrade = reviewSummary.upgradeSummary;
    const versionRange = upgrade.fromVersion
      ? `${upgrade.fromVersion} -> ${upgrade.toVersion}`
      : `target ${upgrade.toVersion}`;
    lines.push(
      formatFields([
        `Upgrade: ${upgrade.status}`,
        `${upgrade.blockId} ${versionRange}`,
        `migrations: ${upgrade.migrationCount}`,
        `preflight checks: ${upgrade.preflightCheckCount}`,
        `preflight evidence: ${upgrade.preflightEvidenceCount}`,
        `impacts: ${upgrade.impactCount}`,
        `operations: ${upgrade.migrationOperationCount}`,
        `operation roles: ${formatMergedSummaryEntries(
          upgrade.migrationOperationSummaries.map((operation) => ({ id: operation.role, count: 1 }))
        )}`,
        `sources: ${upgrade.sourceMigrationCount}`,
        `slots: ${upgrade.slotMigrationCount}`,
        `requires verification: ${upgrade.requiresVerification}`,
        `verification: ${formatSummaryEntries(upgrade.verificationSummaries)}`
      ])
    );
    if (upgrade.diagnostics) {
      lines.push(
        formatFields([
          `Upgrade diagnostics: ${upgrade.diagnostics.phase}`,
          upgrade.diagnostics.failedCheck,
          upgrade.diagnostics.errorCode,
          upgrade.diagnostics.message,
          `attribution: ${formatUpgradeDiagnosticsDetails(upgrade.diagnostics.details)}`
        ])
      );
    }
  }

  return lines.join('\n');
}

