#!/usr/bin/env node
import {
  addBlock,
  adaptWorkspace,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  repairWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace,
  writeWorkspaceArtifacts
} from '../orchestrator.ts';
import type { CiArtifactManifest } from '../compiler/emit/ci-artifacts.ts';
import { loadManifestById } from '../compiler/parse/load-manifest.ts';
import { loadPlan } from '../compiler/parse/load-plan.ts';
import { pathExists, readJson } from '../shared/fs.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import {
  cleanDependencyEnvironment,
  formatDependencyEnvironmentStatus,
  formatDoctorReport,
  getDependencyEnvironmentStatus,
  getDoctorReport,
  relinkProjectDependencies,
  warmupDependencyEnvironment,
  type DependencyCleanOptions
} from '../shared/dependency-environment.ts';
import type {
  ExplainGraph,
  RepairPlan,
  ReviewSummary,
  UpgradePlan,
  VerificationLane
} from '../shared/types.ts';

const USAGE = 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|doctor|deps>';
const INIT_USAGE = 'Usage: platform init [--reset]';
const ADD_USAGE = 'Usage: platform add <block-id>';
const VERIFY_USAGE = 'Usage: platform verify [--lane fast|runtime|all]';
const REPAIR_USAGE = 'Usage: platform repair [--dry-run] [--json]';
const UPGRADE_USAGE = 'Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]';
const EXPLAIN_USAGE = 'Usage: platform explain [--json]';
const ARTIFACTS_USAGE = 'Usage: platform artifacts (--json [--compact]|--paths [--json] [--kind governance|view|test])';
const DEPS_USAGE = [
  'Usage: platform deps <status|warmup|relink|clean>',
  '  platform deps relink project',
  '  platform deps clean [--project|--shared|--npm-cache]',
  '  platform deps clean --all --force'
].join('\n');

type ArtifactPathKind = 'governance' | 'view' | 'test';

function artifactUploadPathSummary(
  manifest: CiArtifactManifest,
  kind?: ArtifactPathKind
): { paths: string[]; byKind: Partial<Record<ArtifactPathKind, number>> } {
  const artifacts = kind
    ? manifest.artifacts.filter((artifact) => artifact.kind === kind)
    : manifest.artifacts;
  const includeManifest = kind === undefined || kind === 'governance';
  const entries = [
    ...(includeManifest
      ? [{ path: 'project/generated/ci-artifacts.json', kind: 'governance' as const }]
      : []),
    ...artifacts.map((artifact) => ({
      path: `project/${artifact.path}`,
      kind: artifact.kind
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
  return { paths, byKind };
}

function assertNoArgs(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(`Usage: platform ${command}`);
  }
}

function parseResetArg(args: string[]): boolean {
  if (args.length === 0) {
    return false;
  }
  if (args.length === 1 && args[0] === '--reset') {
    return true;
  }
  throw new Error(INIT_USAGE);
}

function parseLaneArg(args: string[]): VerificationLane {
  if (args.length === 0) {
    return 'fast';
  }
  if (args.length !== 2 || args[0] !== '--lane') {
    throw new Error(VERIFY_USAGE);
  }

  const value = args[1];
  if (value === 'fast' || value === 'runtime' || value === 'all') {
    return value;
  }

  throw new Error(VERIFY_USAGE);
}

function parseRepairArgs(args: string[]): { dryRun: boolean; json: boolean } {
  let dryRun = false;
  let json = false;
  for (const flag of args) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    throw new Error(REPAIR_USAGE);
  }
  return { dryRun, json };
}

function parseUpgradeArgs(args: string[]): { blockId: string; targetVersion: string; dryRun: boolean; json: boolean } {
  if (args.length < 2) {
    throw new Error(UPGRADE_USAGE);
  }

  const [blockId, targetVersion, ...flags] = args;
  let dryRun = false;
  let json = false;
  for (const flag of flags) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    throw new Error(UPGRADE_USAGE);
  }

  return { blockId, targetVersion, dryRun, json };
}

function parseExplainArgs(args: string[]): { json: boolean } {
  if (args.length === 0) {
    return { json: false };
  }
  if (args.length === 1 && args[0] === '--json') {
    return { json: true };
  }
  throw new Error(EXPLAIN_USAGE);
}

function parseArtifactPathKind(value: string): ArtifactPathKind {
  if (value === 'governance' || value === 'view' || value === 'test') {
    return value;
  }
  throw new Error(ARTIFACTS_USAGE);
}

function parseArtifactsArgs(
  args: string[]
): { mode: 'json'; compact: boolean } | { mode: 'paths'; json: boolean; kind?: ArtifactPathKind } {
  if (args[0] === '--paths') {
    let json = false;
    let kind: ArtifactPathKind | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === '--json' && !json) {
        json = true;
        continue;
      }
      if (flag === '--kind' && !kind && index + 1 < args.length) {
        kind = parseArtifactPathKind(args[index + 1]);
        index += 1;
        continue;
      }
      throw new Error(ARTIFACTS_USAGE);
    }
    return { mode: 'paths', json, ...(kind ? { kind } : {}) };
  }
  if (args[0] !== '--json') {
    throw new Error(ARTIFACTS_USAGE);
  }
  if (args.length === 1) {
    return { mode: 'json', compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { mode: 'json', compact: true };
  }
  throw new Error(ARTIFACTS_USAGE);
}

function parseDepsCleanArgs(args: string[]): DependencyCleanOptions {
  if (args.length === 0) {
    throw new Error(DEPS_USAGE);
  }

  const options: DependencyCleanOptions = {};
  for (const flag of args) {
    if (flag === '--project') {
      options.project = true;
      continue;
    }
    if (flag === '--shared') {
      options.shared = true;
      continue;
    }
    if (flag === '--npm-cache') {
      options.npmCache = true;
      continue;
    }
    if (flag === '--all') {
      options.all = true;
      continue;
    }
    if (flag === '--force') {
      options.force = true;
      continue;
    }
    throw new Error(DEPS_USAGE);
  }

  if (options.all && options.force !== true) {
    throw new Error(DEPS_USAGE);
  }
  if (!options.all && options.force) {
    throw new Error(DEPS_USAGE);
  }

  return options;
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

function formatRepairFailurePoint(failure: RepairPlan['tasks'][number]['failurePoints'][number]): string {
  return [
    `Failure ${failure.lane}/${failure.kind}`,
    `issue=${failure.issueType}`,
    `repairable=${failure.repairable}`,
    failure.message
  ].join('; ');
}

function formatRepairSummary(repairPlan: RepairPlan, dryRun: boolean): string {
  const suffix = repairPlan.status === 'applied' ? '; verify pending' : dryRun ? ' (dry-run)' : '';
  const lines = [
    `Repair ${repairPlan.status} (${repairPlan.tasks.length} tasks, ${repairPlan.blockers?.length ?? 0} blockers)${suffix}`,
    `Source verification: ${repairPlan.sourceVerificationStatus}; requires verification: ${repairPlan.requiresVerification}`
  ];
  for (const task of repairPlan.tasks.slice(0, 3)) {
    lines.push(`Task ${task.taskId}: ${task.targetBlock} -> ${task.targetFile}`);
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

function formatUpgradeSummary(upgradePlan: UpgradePlan, dryRun: boolean): string {
  const suffix = dryRun ? ' (dry-run)' : '';
  const migrationKinds = Object.entries(upgradePlan.migrationKindCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `${kind}=${count}`);
  const requiresVerificationCount = upgradePlan.migrationSummaries.filter(
    (migration) => migration.requiresVerification
  ).length;
  const lines = [
    `Upgrade ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}${suffix}`,
    [
      `Status: ${upgradePlan.status}`,
      `migrations: ${upgradePlan.migrations.length}`,
      `preflight checks: ${upgradePlan.preflightChecks.length}`
    ].join('; '),
    `Migration kinds: ${formatList(migrationKinds)}`,
    `Impacts: ${formatList(upgradePlan.impacts)}`,
    `Requires verification: ${requiresVerificationCount > 0} (${requiresVerificationCount} migrations)`
  ];
  for (const migration of upgradePlan.migrationSummaries.slice(0, 3)) {
    lines.push(
      [
        `Migration ${migration.id}: ${migration.kind}`,
        `target=${migration.target}`,
        `requiresVerification=${migration.requiresVerification}`
      ].join('; ')
    );
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

function formatExplainSummary(graph: ExplainGraph, reviewSummary: ReviewSummary): string {
  const { artifactSummary, ciSummary } = reviewSummary;
  const uncoveredBlocks = graph.overlays.coverage.blocks.filter(
    (block) => block.coveredBy.length === 0
  ).length;
  const uncoveredSlots = graph.overlays.coverage.slots.filter(
    (slot) => slot.coveredBy.length === 0
  ).length;
  const lines = [
    `Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`,
    `Node types: ${formatCounts(graph.nodes.map((node) => node.type))}`,
    `Edge types: ${formatCounts(graph.edges.map((edge) => edge.type))}`,
    [
      `Coverage: ${graph.overlays.coverage.blocks.length} blocks`,
      `${graph.overlays.coverage.slots.length} slots`,
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
      `Impacted: ${ciSummary.impactedBlockCount} blocks`,
      `${ciSummary.impactedSlotCount} slots`,
      `${ciSummary.runtimeEntryCount} runtime entries`
    ].join(', ')
  ];

  if (artifactSummary) {
    const uploadGroups = artifactSummary.uploadGroups?.map(
      (group) => `${group.kind}=${group.count}`
    ) ?? [];
    lines.push(
      [
        `Artifacts: ${artifactSummary.artifactStatus ?? 'passed'}`,
        `total: ${artifactSummary.artifactCount}`,
        `missing: ${artifactSummary.missingCount}`
      ].join('; '),
      `Upload groups: ${formatList(uploadGroups)}`
    );
  }

  return lines.join('\n');
}

async function readWrittenRepairPlan(workspaceRoot: string): Promise<RepairPlan | null> {
  const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(repairPlanPath))) {
    return null;
  }
  return readJson<RepairPlan>(repairPlanPath);
}

async function runDepsCommand(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;
  switch (subcommand) {
    case 'status': {
      assertNoArgs('deps status', subArgs);
      const status = await getDependencyEnvironmentStatus(process.cwd());
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'warmup': {
      assertNoArgs('deps warmup', subArgs);
      const status = await warmupDependencyEnvironment(process.cwd());
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'relink': {
      if (subArgs.length !== 1 || subArgs[0] !== 'project') {
        throw new Error(DEPS_USAGE);
      }
      const status = await relinkProjectDependencies(process.cwd());
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'clean': {
      const cleanOptions = parseDepsCleanArgs(subArgs);
      const removed = await cleanDependencyEnvironment(process.cwd(), cleanOptions);
      console.log(`Cleaned ${removed.length} dependency paths`);
      return;
    }
    default:
      throw new Error(DEPS_USAGE);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case 'init':
      await initWorkspace(process.cwd(), { reset: parseResetArg(args) });
      console.log('Initialized project workspace');
      return;
    case 'add': {
      if (args.length !== 1) {
        throw new Error(ADD_USAGE);
      }
      await addBlock(process.cwd(), args[0]);
      const { planPath } = getWorkspacePaths(process.cwd());
      const plan = await loadPlan(planPath);
      const manifestEntry = await loadManifestById(args[0], {
        workspaceRoot: process.cwd(),
        version: plan.blocks.find((block) => block.id === args[0])?.version,
        registrySources: plan.registry.sources
      });
      console.log(`Added block ${args[0]}@${manifestEntry.manifest.version} from ${manifestEntry.registrySourceId} (${manifestEntry.registryKind})`);
      return;
    }
    case 'resolve': {
      assertNoArgs('resolve', args);
      const { lock } = await resolveWorkspace(process.cwd());
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
      return;
    }
    case 'compose':
      assertNoArgs('compose', args);
      await composeWorkspace(process.cwd());
      console.log('Composed project');
      return;
    case 'adapt':
      assertNoArgs('adapt', args);
      await adaptWorkspace(process.cwd());
      console.log('Adapted slots');
      return;
    case 'verify': {
      const { report } = await verifyWorkspace(process.cwd(), { lane: parseLaneArg(args) });
      console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
      return;
    }
    case 'repair': {
      const repairArgs = parseRepairArgs(args);
      try {
        const { repairPlan } = await repairWorkspace(process.cwd(), { dryRun: repairArgs.dryRun });
        if (repairArgs.json) {
          console.log(JSON.stringify(repairPlan, null, 2));
          return;
        }
        console.log(formatRepairSummary(repairPlan, repairArgs.dryRun));
        return;
      } catch (error) {
        const repairPlan = await readWrittenRepairPlan(process.cwd());
        if (repairPlan) {
          if (repairArgs.json) {
            console.log(JSON.stringify(repairPlan, null, 2));
          } else {
            console.log(formatRepairSummary(repairPlan, repairArgs.dryRun));
          }
        }
        throw error;
      }
    }
    case 'upgrade': {
      const upgradeArgs = parseUpgradeArgs(args);
      const { upgradePlan } = await upgradeWorkspace(process.cwd(), upgradeArgs.blockId, upgradeArgs.targetVersion, {
        dryRun: upgradeArgs.dryRun
      });
      if (upgradeArgs.json) {
        console.log(JSON.stringify(upgradePlan, null, 2));
        return;
      }
      console.log(formatUpgradeSummary(upgradePlan, upgradeArgs.dryRun));
      return;
    }
    case 'lock':
      assertNoArgs('lock', args);
      await lockWorkspace(process.cwd());
      console.log('Locked project');
      return;
    case 'explain': {
      const explainArgs = parseExplainArgs(args);
      const { graph, reviewSummary } = await explainWorkspace(process.cwd());
      if (explainArgs.json) {
        console.log(JSON.stringify({ graph, reviewSummary }, null, 2));
        return;
      }
      console.log(formatExplainSummary(graph, reviewSummary));
      return;
    }
    case 'artifacts': {
      const artifactsArgs = parseArtifactsArgs(args);
      const { manifest } = await writeWorkspaceArtifacts(process.cwd());
      if (artifactsArgs.mode === 'paths') {
        const pathSummary = artifactUploadPathSummary(manifest, artifactsArgs.kind);
        if (artifactsArgs.json) {
          console.log(JSON.stringify({
            count: pathSummary.paths.length,
            paths: pathSummary.paths,
            byKind: pathSummary.byKind,
            missingCount: manifest.missing.length,
            missing: manifest.missing
          }, null, 2));
          return;
        }
        console.log(pathSummary.paths.join('\n'));
        return;
      }
      console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
      return;
    }
    case 'doctor': {
      assertNoArgs('doctor', args);
      const report = await getDoctorReport(process.cwd());
      console.log(formatDoctorReport(report));
      return;
    }
    case 'deps':
      await runDepsCommand(args);
      return;
    default:
      console.log(USAGE);
  }
}

main().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string; details?: unknown };
  console.error(failure.code ?? 'UNEXPECTED', failure.message ?? String(error));
  if (failure.details) {
    console.error(JSON.stringify(failure.details, null, 2));
  }
  process.exit(1);
});
