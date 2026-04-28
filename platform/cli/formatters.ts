import type { CiArtifactManifest } from '../compiler/emit/ci-artifacts.ts';
import { buildE2eMatrix, type E2eMatrix } from '../shared/review-matrix.ts';
import type {
  AcceptanceCoverageEntry,
  AcceptanceCoverageReport,
  ExplainGraph,
  InstallPlanStep,
  LockFile,
  PolicyReport,
  ProvenanceFile,
  RepairPlan,
  RuntimeVerificationLaneReport,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationReport
} from '../shared/types.ts';
import type { ArtifactPathKind } from './args.ts';

export type ArtifactPathUploadGroup = {
  kind: ArtifactPathKind;
  count: number;
  paths: string[];
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

export type DemoChecklistItem = {
  id: string;
  status: 'passed' | 'missing';
  artifactPath: string;
  command: string;
};

export type DemoChecklist = {
  formatVersion: '1';
  status: 'passed' | 'attention';
  itemCount: number;
  missingCount: number;
  items: DemoChecklistItem[];
  nextCommand: string;
};

export function formatCiArtifactManifest(manifest: CiArtifactManifest): string {
  return [
    `Artifact manifest ${manifest.summary.artifactStatus}`,
    [
      `artifacts=${manifest.summary.artifactCount}`,
      `missing=${manifest.summary.missingCount}`,
      `upload groups=${manifest.summary.uploadGroupCount}`
    ].join('; '),
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
    manifest.summary.contractPaths.map((artifactPath) => `project/${artifactPath}`)
  );
  const artifacts = kind === 'contract'
    ? manifest.artifacts.filter((artifact) => contractPaths.has(`project/${artifact.path}`))
    : kind
      ? manifest.artifacts.filter((artifact) => artifact.kind === kind)
      : manifest.artifacts;
  const includeManifest = kind === undefined || kind === 'governance';
  const entries = [
    ...(includeManifest
      ? [{ path: 'project/generated/ci-artifacts.json', kind: 'governance' as const }]
      : []),
    ...artifacts.map((artifact) => ({
      path: `project/${artifact.path}`,
      kind: kind === 'contract' ? 'contract' as const : artifact.kind
    }))
  ];
  const kindByPath = new Map(entries.map((entry) => [entry.path, entry.kind]));
  const paths = [...kindByPath.keys()].sort((left, right) => left.localeCompare(right));
  const byKind: Partial<Record<ArtifactPathKind, number>> = {};
  for (const path of paths) {
    const pathKind = kindByPath.get(path);
    if (pathKind) {
      byKind[pathKind] = (byKind[pathKind] ?? 0) + 1;
    }
  }

  const uploadGroups = (['governance', 'view', 'test', 'contract'] as const)
    .map((groupKind) => ({
      kind: groupKind,
      count: paths.filter((path) => kindByPath.get(path) === groupKind).length,
      paths: paths.filter((path) => kindByPath.get(path) === groupKind)
    }))
    .filter((group) => group.count > 0);

  return { paths, byKind, uploadGroups };
}

export function formatInstallManifest(manifest: InstallManifestEntry[]): string {
  return [
    `Install manifest ${manifest.length} steps`,
    `Blocks: ${formatList([...new Set(manifest.map((entry) => entry.blockId))].sort((left, right) => left.localeCompare(right)))}`,
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
  const tenantScopedCount = contract.tables.filter((table) => table.tenantScoped).length;
  return [
    `Postgres contract ${contract.provider}`,
    [
      `mode=${contract.persistenceMode}`,
      `tables=${contract.tables.length}`,
      `tenantScoped=${tenantScopedCount}`
    ].join('; '),
    `Table list: ${formatList(contract.tables.map((table) => table.name))}`
  ].join('\n');
}

function formatList(values: string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

function formatCounts(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return formatList(
    [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([value, count]) => `${value}=${count}`)
  );
}

export function formatLockInspect(lock: LockFile): string {
  return [
    `Graph lock ${lock.app.name}`,
    [
      `stack=${lock.app.stack}`,
      `mode=${lock.app.mode}`,
      `blocks=${lock.resolvedBlocks.length}`,
      `slots=${lock.slotTasks.length}`,
      `generated=${lock.generatedPaths.length}`,
      `acceptance=${lock.acceptancePlan.length}`
    ].join('; '),
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
    [
      `Coverage overlay: ${graph.overlays.coverage.blocks.length} blocks`,
      `${graph.overlays.coverage.slots.length} slots`
    ].join('; '),
    `Provenance overlay: ${graph.overlays.provenance.length} artifacts`
  ].join('\n');
}

export function formatDemoChecklist(checklist: DemoChecklist): string {
  return [
    [
      `Demo checklist ${checklist.status}`,
      `items=${checklist.itemCount}`,
      `missing=${checklist.missingCount}`
    ].join('; '),
    ...checklist.items.map((item) => [
      `${item.id}: ${item.status}`,
      item.artifactPath,
      `command=${item.command}`
    ].join('; ')),
    `Next command: ${checklist.nextCommand}`
  ].join('\n');
}

export function formatE2eMatrix(matrix: E2eMatrix): string {
  return [
    `E2E matrix ${matrix.status}; rows=${matrix.rowCount}`,
    ...matrix.rows.map((row) => [
      `${row.stage}: ${row.status}`,
      row.detail,
      `evidence=${row.evidence.join(', ') || 'none'}`
    ].join('; '))
  ].join('\n');
}

function formatSummaryEntries(entries: Array<{ id: string; count: number }>): string {
  return entries.length > 0
    ? entries.map((entry) => `${entry.id}=${entry.count}`).join(', ')
    : 'none';
}

function summarizeById(
  entries: Array<{ id: string; count: number }>
): Array<{ id: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + entry.count);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function readObjectString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

export function formatUpgradeDiagnosticsDetails(details: unknown): string {
  const migrationId = readObjectString(details, 'migrationId');
  if (!migrationId) {
    return 'none';
  }

  const role = readObjectString(details, 'role');
  const path = readObjectString(details, 'path');
  const migrationKind = readObjectString(details, 'migrationKind');
  const target = readObjectString(details, 'target') ?? (role === 'target' ? path : null);
  const source = readObjectString(details, 'source') ?? (role === 'source' ? path : null);
  const slotId = readObjectString(details, 'slotId');
  const entry = readObjectString(details, 'entry');
  const entryId = readObjectString(details, 'entryId');
  const entryKind = readObjectString(details, 'entryKind');
  const rollbackStatus = readObjectString(details, 'rollbackStatus');
  return formatList([
    `migration=${migrationId}`,
    migrationKind ? `kind=${migrationKind}` : '',
    entry ? `entry=${entry}` : '',
    entryId ? `entryId=${entryId}` : '',
    entryKind ? `entryKind=${entryKind}` : '',
    target ? `target=${target}` : '',
    source ? `source=${source}` : '',
    slotId ? `slot=${slotId}` : '',
    rollbackStatus ? `rollback=${rollbackStatus}` : ''
  ].filter((part) => part.length > 0));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
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
  return [
    `Failure ${failure.lane}/${failure.kind}`,
    `issue=${failure.issueType}`,
    `repairable=${failure.repairable}`,
    failure.message
  ].join('; ');
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
      [
        `Review ${task.taskId}: writeBounds=${formatList(review.writeBounds)}`,
        `symbols=${formatList(review.requiredSymbols)}`,
        `tests=${formatList(review.testsToPass)}`,
        `forbidden=${formatList(review.forbiddenOperations)}`,
        `failureTargets=${formatList(review.failureTargets)}`
      ].join('; ')
    );
    if (task.preview) {
      lines.push(
        [
          `Preview ${task.taskId}: changed=${task.preview.changed}`,
          `+${task.preview.addedLines}`,
          `-${task.preview.removedLines}`,
          `${task.preview.beforeLines}->${task.preview.afterLines} lines`
        ].join('; ')
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
    ...(migration.source ? [`source=${migration.source}`] : []),
    ...(migration.slotId ? [`slot=${migration.slotId}`] : []),
    ...(operation ? [`role=${operation.role}`] : []),
    ...(operation?.inputType ? [`input=${operation.inputType}`] : []),
    ...(operation?.outputType ? [`output=${operation.outputType}`] : []),
    ...(operation?.writableZones ? [`writableZones=${operation.writableZones.join(',')}`] : []),
    ...(operation?.path ? [`path=${operation.path.join('.')}`] : []),
    ...(operation?.updateCount !== undefined ? [`updates=${operation.updateCount}`] : []),
    ...(operation?.itemCount !== undefined ? [`items=${operation.itemCount}`] : []),
    ...(operation?.valueKeyCount !== undefined ? [`valueKeys=${operation.valueKeyCount}`] : []),
    ...(operation?.contentLength !== undefined ? [`contentLength=${operation.contentLength}`] : []),
    ...(operation?.searchLength !== undefined ? [`searchLength=${operation.searchLength}`] : []),
    ...(operation?.replacementLength !== undefined ? [`replacementLength=${operation.replacementLength}`] : []),
    ...(operation?.pattern ? [`pattern=${operation.pattern}`] : []),
    ...(operation?.flags ? [`flags=${operation.flags}`] : []),
    `requiresVerification=${migration.requiresVerification}`
  ];
}

export type PolicySourceInspect = {
  formatVersion: '1';
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
    formatVersion: '1',
    status: report.status,
    sourceCount: sources.length,
    policyCount: sources.reduce((count, source) => count + source.policyCount, 0),
    sources
  };
}

export function buildPolicySummary(report: PolicyReport): NonNullable<ReviewSummary['policySummary']> {
  const sourceInspect = buildPolicySourceInspect(report);
  return {
    status: report.status,
    officialPolicyCount: report.official.policies.length,
    projectPolicyCount: report.project.policies.length,
    mergedPolicyCount: report.merged.policies.length,
    sourceCount: sourceInspect.sourceCount,
    violationCount: report.violations.length,
    severityCounts: report.violations.reduce<Record<string, number>>((counts, violation) => {
      counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
      return counts;
    }, {}),
    sourceSummaries: sourceInspect.sources.map((source) => ({
      scope: source.scope,
      path: source.path,
      policyIds: source.policyIds
    })),
    mergedSummaries: report.merged.policies.map((policy) => ({
      id: policy.id,
      sourceScope: policy.sourceScope,
      sourcePath: policy.sourcePath,
      targetCount: policy.targets.length,
      targets: policy.targets
    })),
    violationSummaries: report.violations.map((violation) => ({
      id: violation.id,
      severity: violation.severity,
      rule: violation.rule,
      fileCount: violation.files.length,
      files: violation.files,
      appliesTo: violation.appliesTo,
      message: violation.message,
      sourceScope: violation.sourceScope,
      sourcePath: violation.sourcePath
    }))
  };
}

export function formatPolicySources(report: PolicySourceInspect): string {
  const lines = [
    `Policy sources ${report.status}`,
    [`sources=${report.sourceCount}`, `policies=${report.policyCount}`].join('; ')
  ];
  for (const source of report.sources.slice(0, 5)) {
    lines.push(
      [
        `Source ${source.scope}`,
        `path=${source.path}`,
        `policies=${formatList(source.policyIds)}`
      ].join('; ')
    );
  }
  return lines.join('\n');
}

export function formatPolicyReport(report: NonNullable<ReviewSummary['policySummary']>): string {
  const severity = Object.entries(report.severityCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([level, count]) => `${level}=${count}`);
  const lines = [
    [
      `Policy report ${report.status}`,
      `official=${report.officialPolicyCount}`,
      `project=${report.projectPolicyCount}`,
      `merged=${report.mergedPolicyCount}`,
      `violations=${report.violationCount}`
    ].join('; '),
    `Sources: ${report.sourceCount}`,
    `Severity: ${formatList(severity)}`
  ];
  for (const policy of report.mergedSummaries.slice(0, 3)) {
    lines.push(
      [
        `Policy ${policy.id}`,
        `scope=${policy.sourceScope}`,
        `source=${policy.sourcePath}`,
        `targets=${formatList(policy.targets)}`
      ].join('; ')
    );
  }
  for (const violation of report.violationSummaries.slice(0, 3)) {
    lines.push(
      [
        `Violation ${violation.id}`,
        `severity=${violation.severity}`,
        `files=${formatList(violation.files)}`,
        violation.message
      ].join('; ')
    );
  }
  return lines.join('\n');
}

export type AcceptanceTargetInspect = {
  formatVersion: '1';
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
    formatVersion: '1',
    status: report.status,
    targetKind,
    targetCount: entries.length,
    coveredCount: entries.filter((entry) => !entry.uncovered).length,
    uncoveredCount: uncoveredIds.length,
    uncoveredIds,
    targets: entries.map((entry) => ({
      ...entry,
      declaredAcceptanceCount: entry.declaredAcceptance.length,
      coveredByCount: entry.coveredBy.length
    }))
  };
}

export function formatAcceptanceTargets(report: AcceptanceTargetInspect): string {
  const label = report.targetKind === 'blocks' ? 'Acceptance coverage blocks' : 'Acceptance coverage slots';
  const lines = [
    `${label} ${report.status}`,
    [
      `targets=${report.targetCount}`,
      `covered=${report.coveredCount}`,
      `uncovered=${report.uncoveredCount}`
    ].join('; '),
    `Uncovered: ${formatList(report.uncoveredIds)}`
  ];
  for (const target of report.targets.slice(0, 5)) {
    lines.push(
      [
        `Target ${target.id}`,
        `declared=${target.declaredAcceptanceCount}`,
        `coveredBy=${formatList(target.coveredBy)}`,
        `uncovered=${target.uncovered}`
      ].join('; ')
    );
  }
  return lines.join('\n');
}

export function formatAcceptanceCoverage(report: AcceptanceCoverageReport): string {
  const coveredBlockCount = report.blocks.filter((block) => !block.uncovered).length;
  const coveredSlotCount = report.slots.filter((slot) => !slot.uncovered).length;
  const lines = [
    [
      `Acceptance coverage ${report.status}`,
      `acceptancePassed=${report.acceptancePassed.length}`,
      `blocks=${coveredBlockCount}/${report.blocks.length}`,
      `slots=${coveredSlotCount}/${report.slots.length}`,
      `uncoveredBlocks=${report.uncoveredBlocks.length}`,
      `uncoveredSlots=${report.uncoveredSlots.length}`
    ].join('; '),
    `Uncovered blocks: ${formatList(report.uncoveredBlocks)}`,
    `Uncovered slots: ${formatList(report.uncoveredSlots)}`
  ];
  for (const block of report.blocks.slice(0, 3)) {
    lines.push(
      [
        `Block ${block.id}`,
        `declared=${block.declaredAcceptance.length}`,
        `coveredBy=${formatList(block.coveredBy)}`,
        `uncovered=${block.uncovered}`
      ].join('; ')
    );
  }
  for (const slot of report.slots.slice(0, 3)) {
    lines.push(
      [
        `Slot ${slot.id}`,
        `declared=${slot.declaredAcceptance.length}`,
        `coveredBy=${formatList(slot.coveredBy)}`,
        `uncovered=${slot.uncovered}`
      ].join('; ')
    );
  }
  return lines.join('\n');
}

function formatRuntimeStep(
  label: string,
  step: RuntimeVerificationLaneReport['build']
): string {
  return [
    `${label}: ${step.status}`,
    `passed=${step.passed.length}`,
    `failed=${step.failed.length}`,
    `command=${step.command ?? 'none'}`
  ].join('; ');
}

export function formatRuntimeReport(report: RuntimeVerificationLaneReport): string {
  return [
    `Runtime report ${report.status}`,
    formatRuntimeStep('Build', report.build),
    formatRuntimeStep('Unit', report.unit),
    formatRuntimeStep('Acceptance', report.acceptance)
  ].join('\n');
}

export function formatVerificationReport(report: VerificationReport): string {
  return [
    [
      `Verification report ${report.summary.status}`,
      `requestedLane=${report.summary.requestedLane}`,
      `failedLanes=${formatList(report.summary.failedLanes)}`
    ].join('; '),
    [
      `Fast: ${report.fast.status}`,
      `build=${report.fast.build.status}`,
      `unit=${report.fast.unit.status}`,
      `acceptance=${report.fast.acceptance.status}`,
      `policy=${report.fast.policy.status}`
    ].join('; '),
    [
      `Runtime: ${report.runtime.status}`,
      `build=${report.runtime.build.status}`,
      `unit=${report.runtime.unit.status}`,
      `acceptance=${report.runtime.acceptance.status}`
    ].join('; ')
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
    [
      'Provenance registry',
      `artifacts=${provenance.artifacts.length}`,
      `registry=${registryArtifacts.length}`,
      `overrides=${overrideArtifacts.length}`,
      `unverified=${unverifiedArtifacts.length}`
    ].join('; '),
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
      [
        `Artifact ${artifact.path}`,
        `origin=${artifact.originType}:${artifact.originId}`,
        `registry=${artifact.registrySourceId ?? 'none'}`,
        `verifiedBy=${formatList(artifact.verifiedBy)}`,
        `override=${artifact.overrideStatus}`
      ].join('; ')
    );
  }
  return lines.join('\n');
}

export function formatReviewSummaryContract(summary: ReviewSummary): string {
  const coverage = summary.coverageSummary;
  const provenance = summary.provenanceSummary;
  const artifacts = summary.artifactSummary;
  const lines = [
    [
      `Review summary ${summary.chainSummary.status}`,
      `format=${summary.formatVersion}`,
      `stages=${summary.chainSummary.passedStageCount}/${summary.chainSummary.stageCount}`,
      `attention=${summary.chainSummary.attentionStageCount}`,
      `failed=${summary.chainSummary.failedStageCount}`
    ].join('; '),
    [
      `CI ${summary.ciSummary.status}`,
      `failures=${summary.ciSummary.failureCount}`,
      `risks=${summary.ciSummary.regressionRiskCount}`,
      `conflicts=${summary.ciSummary.conflictHintCount}`
    ].join('; '),
    [
      `Impact blocks=${summary.impactedBlocks.length}`,
      `slots=${summary.impactedSlots.length}`,
      `runtime=${summary.runtimeEntryCount}`,
      `changeSources=${summary.changeSourceCount}`,
      `installImpacts=${summary.installImpactCount}`
    ].join('; '),
    [
      `Coverage ${coverage?.status ?? 'missing'}`,
      `blocks=${coverage ? `${coverage.coveredBlockCount}/${coverage.blockCount}` : 'missing'}`,
      `slots=${coverage ? `${coverage.coveredSlotCount}/${coverage.slotCount}` : 'missing'}`
    ].join('; '),
    [
      `Provenance artifacts=${provenance?.artifactCount ?? 0}`,
      `registry=${provenance?.registryArtifactCount ?? 0}`,
      `generated=${provenance?.generatedArtifactCount ?? 0}`,
      `unverified=${provenance?.unverifiedArtifactCount ?? 0}`
    ].join('; '),
    [
      `Artifacts ${artifacts?.artifactStatus ?? 'missing'}`,
      `total=${artifacts?.artifactCount ?? 0}`,
      `missing=${artifacts?.missingCount ?? 0}`,
      `missingReasonTypes=${artifacts?.missingReasonTypeCount ?? 0}`,
      `contracts=${artifacts?.contractCount ?? 0}`,
      `uploadGroups=${artifacts?.uploadGroupCount ?? artifacts?.uploadGroups?.length ?? 0}`
    ].join('; '),
    `Stages: ${summary.chainSummary.stageSummaries
      .map((stage) => `${stage.id}=${stage.status}`)
      .join(', ') || 'none'}`
  ];

  const upgrade = summary.upgradeSummary;
  if (upgrade) {
    lines.push(
      [
        `Upgrade ${upgrade.status}`,
        `${upgrade.blockId} ${upgrade.fromVersion ? `${upgrade.fromVersion} -> ${upgrade.toVersion}` : `target ${upgrade.toVersion}`}`,
        `migrations=${upgrade.migrationCount}`,
        `impacts=${upgrade.impactCount}`,
        `requiresVerification=${upgrade.requiresVerification}`
      ].join('; ')
    );
    if (upgrade.diagnostics) {
      lines.push(
        [
          `Upgrade diagnostics ${upgrade.diagnostics.phase}`,
          upgrade.diagnostics.failedCheck,
          upgrade.diagnostics.errorCode,
          upgrade.diagnostics.message,
          `attribution=${formatUpgradeDiagnosticsDetails(upgrade.diagnostics.details)}`
        ].join('; ')
      );
    }
  }

  return lines.join('\n');
}

export function formatUpgradeDiagnostics(diagnostics: UpgradeDiagnostics): string {
  return [
    `Upgrade diagnostics ${diagnostics.phase}`,
    [
      `Block: ${diagnostics.blockId}`,
      `target: ${diagnostics.targetVersion}`,
      `status: ${diagnostics.status}`
    ].join('; '),
    [
      `Failed check: ${diagnostics.failedCheck}`,
      `code: ${diagnostics.errorCode}`
    ].join('; '),
    `Message: ${diagnostics.message}`,
    `Attribution: ${formatUpgradeDiagnosticsDetails(diagnostics.details)}`
  ].join('\n');
}

export function formatUpgradeSummary(upgradePlan: UpgradePlan, dryRun: boolean): string {
  const suffix = dryRun ? ' (dry-run)' : '';
  const migrationKinds = Object.entries(upgradePlan.migrationKindCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}=${count}`);
  const requiresVerificationCount = upgradePlan.migrationSummaries.filter(
    (migration) => migration.requiresVerification
  ).length;
  const preflightEvidenceCount = upgradePlan.preflightChecks.reduce(
    (count, check) => count + check.evidence.length,
    0
  );
  const lines = [
    `Upgrade ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}${suffix}`,
    [
      `Status: ${upgradePlan.status}`,
      `migrations: ${upgradePlan.migrations.length}`,
      `preflight checks: ${upgradePlan.preflightChecks.length}`
    ].join('; '),
    `Migration kinds: ${formatList(migrationKinds)}`,
    `Operation roles: ${formatCounts(upgradePlan.migrationOperations.map((operation) => operation.role))}`,
    `Impacts: ${formatList(upgradePlan.impacts)}`,
    `Preflight evidence: ${preflightEvidenceCount}`,
    `Requires verification: ${requiresVerificationCount > 0} (${requiresVerificationCount} migrations)`
  ];
  const operationsById = new Map(upgradePlan.migrationOperations.map((operation) => [operation.id, operation]));
  for (const migration of upgradePlan.migrationSummaries.slice(0, 3)) {
    lines.push(formatUpgradeMigrationDetails(migration, operationsById.get(migration.id)).join('; '));
  }
  for (const check of upgradePlan.preflightChecks.slice(0, 3)) {
    lines.push(
      [
        `Preflight ${check.id}: ${check.status}`,
        `evidence=${check.evidence.length}`
      ].join('; ')
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
  const uncoveredBlocks = coverageSummary?.uncoveredBlockCount ?? graph.overlays.coverage.blocks.filter(
    (block) => block.coveredBy.length === 0
  ).length;
  const uncoveredSlots = coverageSummary?.uncoveredSlotCount ?? graph.overlays.coverage.slots.filter(
    (slot) => slot.coveredBy.length === 0
  ).length;
  const blockCount = coverageSummary?.blockCount ?? graph.overlays.coverage.blocks.length;
  const slotCount = coverageSummary?.slotCount ?? graph.overlays.coverage.slots.length;
  const e2eMatrix = buildE2eMatrix(reviewSummary);
  const lines = [
    `Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`,
    `Node types: ${formatCounts(graph.nodes.map((node) => node.type))}`,
    `Edge types: ${formatCounts(graph.edges.map((edge) => edge.type))}`,
    [
      `Coverage: ${blockCount} blocks`,
      `${slotCount} slots`,
      `uncovered blocks=${uncoveredBlocks}`,
      `uncovered slots=${uncoveredSlots}`
    ].join('; '),
    `Provenance origins: ${formatCounts(
      graph.overlays.provenance.map((artifact) => artifact.originType)
    )}`,
    [
      `CI status: ${ciSummary.status}`,
      `failures: ${ciSummary.failureCount}`,
      `regression risks: ${ciSummary.regressionRiskCount}`,
      `conflict hints: ${ciSummary.conflictHintCount}`
    ].join('; '),
    [
      `Chain: ${chainSummary.status}`,
      `stages: ${chainSummary.passedStageCount}/${chainSummary.stageCount}`,
      `attention: ${chainSummary.attentionStageCount}`,
      `failed: ${chainSummary.failedStageCount}`
    ].join('; '),
    ...e2eMatrix.rows.map(
      (row) => `E2E ${row.stage}: ${row.status}; ${row.detail}; evidence=${row.evidence.join(', ') || 'none'}`
    ),
    [
      `Impacted: ${ciSummary.impactedBlockCount} blocks`,
      `${ciSummary.impactedSlotCount} slots`,
      `${ciSummary.runtimeEntryCount} runtime entries`
    ].join(', ')
  ];

  if (coverageSummary) {
    lines.push(
      [
        `Coverage detail: ${coverageSummary.status}`,
        `acceptance passed: ${coverageSummary.acceptancePassedCount}`,
        `covered blocks: ${coverageSummary.coveredBlockCount}/${coverageSummary.blockCount}`,
        `covered slots: ${coverageSummary.coveredSlotCount}/${coverageSummary.slotCount}`
      ].join('; ')
    );
  }

  lines.push(
    [
      `Install impact: ${installImpactSummary.impactCount} impacts`,
      `groups: ${installImpactSummary.groupCount}`,
      `actions: ${installImpactSummary.actionKinds.join(', ') || 'none'}`,
      `runtime entries: ${installImpactSummary.runtimeEntryCount}`,
      `targets: ${installImpactSummary.targetPathCount}`
    ].join('; ')
  );

  if (provenanceSummary) {
    lines.push(
      [
        `Provenance detail: artifacts: ${provenanceSummary.artifactCount}`,
        `overrides: ${provenanceSummary.overrideArtifactCount}`,
        `registry: ${provenanceSummary.registryArtifactCount}`,
        `unverified: ${provenanceSummary.unverifiedArtifactCount}`
      ].join('; ')
    );
  }

  if (artifactSummary) {
    const uploadGroups = artifactSummary.uploadGroups?.map(
      (group) => `${group.kind}=${group.count}`
    ) ?? [];
    lines.push(
      [
        `Artifacts: ${artifactSummary.artifactStatus ?? 'passed'}`,
        `total: ${artifactSummary.artifactCount}`,
        `missing: ${artifactSummary.missingCount}`,
        `missing reason types: ${artifactSummary.missingReasonTypeCount ?? 0}`,
        `contracts: ${artifactSummary.contractCount ?? 0}`,
        `upload groups: ${artifactSummary.uploadGroupCount ?? artifactSummary.uploadGroups?.length ?? 0}`
      ].join('; '),
      `Upload groups: ${formatList(uploadGroups)}`
    );
  }

  if (reviewSummary.policySummary) {
    const policy = reviewSummary.policySummary;
    lines.push(
      [
        `Policy: ${policy.status}`,
        `official: ${policy.officialPolicyCount}`,
        `project: ${policy.projectPolicyCount}`,
        `merged: ${policy.mergedPolicyCount}`,
        `violations: ${policy.violationCount}`
      ].join('; ')
    );
  }

  if (reviewSummary.repairSummary) {
    const repair = reviewSummary.repairSummary;
    lines.push(
      [
        `Repair: ${repair.status}`,
        `tasks: ${repair.taskCount}`,
        `blockers: ${repair.blockerCount}`,
        `changed previews: ${repair.changedPreviewCount}`,
        `requires verification: ${repair.requiresVerification}`,
        `trace: ${repair.verificationTrace.pendingReason}->${repair.verificationTrace.nextAction}`,
        `categories: ${formatSummaryEntries(repair.taskCategorySummaries)}`,
        `issues: ${formatSummaryEntries(repair.failureTaxonomy.issueTypeSummaries)}`,
        `targets: ${formatSummaryEntries(
          summarizeById(
            repair.targetSummaries.map((target) => ({
              id: target.targetType,
              count: target.count
            }))
          )
        )}`,
        `repairability: ${formatSummaryEntries(repair.failureTaxonomy.repairabilitySummaries)}`
      ].join('; ')
    );
  }

  if (reviewSummary.upgradeSummary) {
    const upgrade = reviewSummary.upgradeSummary;
    const versionRange = upgrade.fromVersion
      ? `${upgrade.fromVersion} -> ${upgrade.toVersion}`
      : `target ${upgrade.toVersion}`;
    lines.push(
      [
        `Upgrade: ${upgrade.status}`,
        `${upgrade.blockId} ${versionRange}`,
        `migrations: ${upgrade.migrationCount}`,
        `preflight checks: ${upgrade.preflightCheckCount}`,
        `preflight evidence: ${upgrade.preflightEvidenceCount}`,
        `impacts: ${upgrade.impactCount}`,
        `operations: ${upgrade.migrationOperationCount}`,
        `operation roles: ${formatSummaryEntries(summarizeById(upgrade.migrationOperationSummaries.map((operation) => ({ id: operation.role, count: 1 }))))}`,
        `sources: ${upgrade.sourceMigrationCount}`,
        `slots: ${upgrade.slotMigrationCount}`,
        `requires verification: ${upgrade.requiresVerification}`,
        `verification: ${formatSummaryEntries(upgrade.verificationSummaries)}`
      ].join('; ')
    );
    if (upgrade.diagnostics) {
      lines.push(
        [
          `Upgrade diagnostics: ${upgrade.diagnostics.phase}`,
          upgrade.diagnostics.failedCheck,
          upgrade.diagnostics.errorCode,
          upgrade.diagnostics.message,
          `attribution: ${formatUpgradeDiagnosticsDetails(upgrade.diagnostics.details)}`
        ].join('; ')
      );
    }
  }

  return lines.join('\n');
}

