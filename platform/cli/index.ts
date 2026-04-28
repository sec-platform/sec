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
import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../shared/benchmark-contract.ts';
import {
  buildCiContract,
  formatCiContract
} from '../shared/ci-contract.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../shared/contract-freeze-contract.ts';
import { buildErrorProtocol } from '../shared/error-protocol.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../shared/error-protocol-contract.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../shared/test-budget-contract.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../shared/reference-check.ts';
import { buildE2eMatrix, type E2eMatrix } from '../shared/review-matrix.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
  InstallPlanStep,
  PolicyReport,
  ProvenanceFile,
  RepairPlan,
  RuntimeVerificationLaneReport,
  ReviewSummary,
  UpgradeDiagnostics,
  UpgradePlan,
  VerificationLane,
  VerificationReport
} from '../shared/types.ts';

const USAGE = [
  'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|artifacts|install|blocks|doctor|deps|reference|benchmark|test|policy|acceptance|runtime|verification|provenance|review|demo|contract>',
  '',
  'Closed loop: npm run demo:closed-loop',
  'Readiness: platform doctor',
  'Governance paths: platform artifacts --paths --kind governance'
].join('\n');
const INIT_USAGE = 'Usage: platform init [--reset]';
const ADD_USAGE = 'Usage: platform add <block-id>';
const VERIFY_USAGE = 'Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]';
const REPAIR_USAGE = 'Usage: platform repair ([--dry-run] [--json [--compact]]|plan [--json [--compact]])';
const UPGRADE_USAGE = 'Usage: platform upgrade (<block-id> <target-version> [--dry-run]|plan|diagnostics) [--json [--compact]]';
const EXPLAIN_USAGE = 'Usage: platform explain [--json [--compact]]|graph [--json [--compact]]';
const ARTIFACTS_USAGE = 'Usage: platform artifacts (--json [--compact]|manifest [--json [--compact]]|--paths [--json [--compact]] [--kind governance|view|test|contract])';
const INSTALL_USAGE = 'Usage: platform install manifest [--json [--compact]]';
const BLOCKS_USAGE = 'Usage: platform blocks usage [--json [--compact]]';
const DOCTOR_USAGE = 'Usage: platform doctor [--json [--compact]]';
const REFERENCE_USAGE = 'Usage: platform reference check [--json [--compact]]';
const BENCHMARK_USAGE = 'Usage: platform benchmark suite [--json [--compact]]';
const TEST_USAGE = 'Usage: platform test budget [--json [--compact]]';
const POLICY_USAGE = 'Usage: platform policy report [--json [--compact]]';
const ACCEPTANCE_USAGE = 'Usage: platform acceptance coverage [--json [--compact]]';
const RUNTIME_USAGE = 'Usage: platform runtime report [--json [--compact]]';
const VERIFICATION_USAGE = 'Usage: platform verification report [--json [--compact]]';
const PROVENANCE_USAGE = 'Usage: platform provenance registry [--json [--compact]]';
const REVIEW_USAGE = 'Usage: platform review <summary|matrix> [--json [--compact]]';
const DEMO_USAGE = 'Usage: platform demo checklist [--json [--compact]]';
const CONTRACT_USAGE = 'Usage: platform contract <freeze|errors|ci> [--json [--compact]]';
const DEPS_USAGE = [
  'Usage: platform deps <status|warmup|relink|clean>',
  '  platform deps status [--json [--compact]]',
  '  platform deps warmup [--json [--compact]]',
  '  platform deps relink project [--json [--compact]]',
  '  platform deps clean [--project|--shared|--npm-cache]',
  '  platform deps clean --all --force'
].join('\n');

type ArtifactPathKind = 'governance' | 'view' | 'test' | 'contract';

type ArtifactPathUploadGroup = {
  kind: ArtifactPathKind;
  count: number;
  paths: string[];
};

type InstallManifestEntry = InstallPlanStep & { status: 'installed' };

type BlockUsageMap = {
  blocks: Array<{
    id: string;
    installOrder: number;
  }>;
};

type DemoChecklistItem = {
  id: string;
  status: 'passed' | 'missing';
  artifactPath: string;
  command: string;
};

type DemoChecklist = {
  formatVersion: '1';
  status: 'passed' | 'attention';
  itemCount: number;
  missingCount: number;
  items: DemoChecklistItem[];
  nextCommand: string;
};

function formatCiArtifactManifest(manifest: CiArtifactManifest): string {
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

function artifactUploadPathSummary(
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

function formatInstallManifest(manifest: InstallManifestEntry[]): string {
  return [
    `Install manifest ${manifest.length} steps`,
    `Blocks: ${formatList([...new Set(manifest.map((entry) => entry.blockId))].sort((left, right) => left.localeCompare(right)))}`,
    `Actions: ${formatCounts(manifest.map((entry) => entry.action))}`,
    `Registry kinds: ${formatCounts(manifest.map((entry) => entry.registryKind))}`,
    `Statuses: ${formatCounts(manifest.map((entry) => entry.status))}`
  ].join('\n');
}

function formatBlockUsageMap(usageMap: BlockUsageMap): string {
  const blocks = usageMap.blocks
    .slice()
    .sort((left, right) => left.installOrder - right.installOrder || left.id.localeCompare(right.id));
  return [
    `Block usage map ${blocks.length} blocks`,
    `Install order: ${formatList(blocks.map((block) => `${block.installOrder}:${block.id}`))}`
  ].join('\n');
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

function parseLaneValue(value: string): VerificationLane {
  if (value === 'fast' || value === 'runtime' || value === 'all') {
    return value;
  }
  throw new Error(VERIFY_USAGE);
}

function parseVerifyArgs(args: string[]): { lane: VerificationLane; json: boolean; compact: boolean } {
  let lane: VerificationLane = 'fast';
  let json = false;
  let compact = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--lane' && index + 1 < args.length) {
      lane = parseLaneValue(args[index + 1]);
      index += 1;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(VERIFY_USAGE);
  }
  return { lane, json, compact };
}

type ParsedRepairArgs =
  | { mode: 'run'; dryRun: boolean; json: boolean; compact: boolean }
  | { mode: 'plan'; json: boolean; compact: boolean };

function parseRepairOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(REPAIR_USAGE);
  }
  return { json, compact };
}

function parseRepairArgs(args: string[]): ParsedRepairArgs {
  if (args[0] === 'plan') {
    return { mode: 'plan', ...parseRepairOutputArgs(args.slice(1)) };
  }

  let dryRun = false;
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(REPAIR_USAGE);
  }
  return { mode: 'run', dryRun, json, compact };
}

type ParsedUpgradeArgs =
  | { mode: 'run'; blockId: string; targetVersion: string; dryRun: boolean; json: boolean; compact: boolean }
  | { mode: 'plan'; json: boolean; compact: boolean }
  | { mode: 'diagnostics'; json: boolean; compact: boolean };

function parseUpgradeOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(UPGRADE_USAGE);
  }
  return { json, compact };
}

function parseUpgradeArgs(args: string[]): ParsedUpgradeArgs {
  if (args[0] === 'plan') {
    return { mode: 'plan', ...parseUpgradeOutputArgs(args.slice(1)) };
  }
  if (args[0] === 'diagnostics') {
    return { mode: 'diagnostics', ...parseUpgradeOutputArgs(args.slice(1)) };
  }
  if (args.length < 2) {
    throw new Error(UPGRADE_USAGE);
  }

  const [blockId, targetVersion, ...flags] = args;
  let dryRun = false;
  let json = false;
  let compact = false;
  for (const flag of flags) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(UPGRADE_USAGE);
  }

  return { mode: 'run', blockId, targetVersion, dryRun, json, compact };
}

function parseExplainOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(EXPLAIN_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(EXPLAIN_USAGE);
}

function parseExplainArgs(
  args: string[]
): { mode: 'run'; json: boolean; compact: boolean } | { mode: 'graph'; json: boolean; compact: boolean } {
  if (args[0] === 'graph') {
    return { mode: 'graph', ...parseExplainOutputArgs(args.slice(1)) };
  }
  return { mode: 'run', ...parseExplainOutputArgs(args) };
}

function parseArtifactPathKind(value: string): ArtifactPathKind {
  if (value === 'governance' || value === 'view' || value === 'test' || value === 'contract') {
    return value;
  }
  throw new Error(ARTIFACTS_USAGE);
}

function parseArtifactOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  let json = false;
  let compact = false;
  for (const flag of args) {
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    if (flag === '--compact' && json && !compact) {
      compact = true;
      continue;
    }
    throw new Error(ARTIFACTS_USAGE);
  }
  return { json, compact };
}

function parseArtifactsArgs(
  args: string[]
):
  | { mode: 'json'; compact: boolean }
  | { mode: 'manifest'; json: boolean; compact: boolean }
  | { mode: 'paths'; json: boolean; compact: boolean; kind?: ArtifactPathKind } {
  if (args[0] === 'manifest') {
    return { mode: 'manifest', ...parseArtifactOutputArgs(args.slice(1)) };
  }
  if (args[0] === '--paths') {
    let json = false;
    let compact = false;
    let kind: ArtifactPathKind | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index];
      if (flag === '--json' && !json) {
        json = true;
        continue;
      }
      if (flag === '--compact' && json && !compact) {
        compact = true;
        continue;
      }
      if (flag === '--kind' && !kind && index + 1 < args.length) {
        kind = parseArtifactPathKind(args[index + 1]);
        index += 1;
        continue;
      }
      throw new Error(ARTIFACTS_USAGE);
    }
    return { mode: 'paths', json, compact, ...(kind ? { kind } : {}) };
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

function parseDoctorArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(DOCTOR_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(DOCTOR_USAGE);
}

function parseReferenceOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(REFERENCE_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(REFERENCE_USAGE);
}

function parseBenchmarkOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(BENCHMARK_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(BENCHMARK_USAGE);
}

function parseTestOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(TEST_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(TEST_USAGE);
}

function parseContractOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(CONTRACT_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(CONTRACT_USAGE);
}

function parsePolicyOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(POLICY_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(POLICY_USAGE);
}

function parseAcceptanceOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(ACCEPTANCE_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(ACCEPTANCE_USAGE);
}

function parseRuntimeOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(RUNTIME_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(RUNTIME_USAGE);
}

function parseInstallOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(INSTALL_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(INSTALL_USAGE);
}

function parseBlocksOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(BLOCKS_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(BLOCKS_USAGE);
}

function parseVerificationOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(VERIFICATION_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(VERIFICATION_USAGE);
}

function parseProvenanceOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(PROVENANCE_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(PROVENANCE_USAGE);
}

function parseReviewOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(REVIEW_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(REVIEW_USAGE);
}

function parseDemoOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(DEMO_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(DEMO_USAGE);
}

function parseDepsOutputArgs(args: string[]): { json: boolean; compact: boolean } {
  if (args.length === 0) {
    return { json: false, compact: false };
  }
  if (args[0] !== '--json') {
    throw new Error(DEPS_USAGE);
  }
  if (args.length === 1) {
    return { json: true, compact: false };
  }
  if (args.length === 2 && args[1] === '--compact') {
    return { json: true, compact: true };
  }
  throw new Error(DEPS_USAGE);
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

function formatExplainGraphInspect(graph: ExplainGraph): string {
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

async function buildDemoChecklist(workspaceRoot: string): Promise<DemoChecklist> {
  const paths = getWorkspacePaths(workspaceRoot);
  const items = await Promise.all([
    {
      id: 'verification-report',
      artifactPath: 'project/generated/verification-report.json',
      absolutePath: paths.verificationReportPath,
      command: 'npm run platform -- verify --lane all'
    },
    {
      id: 'runtime-report',
      artifactPath: 'project/generated/runtime-report.json',
      absolutePath: paths.runtimeReportPath,
      command: 'npm run platform -- verify --lane all'
    },
    {
      id: 'policy-report',
      artifactPath: 'project/generated/policy-report.json',
      absolutePath: paths.policyReportPath,
      command: 'npm run platform -- verify'
    },
    {
      id: 'acceptance-coverage',
      artifactPath: 'project/generated/acceptance-coverage.json',
      absolutePath: paths.acceptanceCoveragePath,
      command: 'npm run platform -- verify'
    },
    {
      id: 'graph-lock',
      artifactPath: 'project/graph.lock.json',
      absolutePath: paths.lockPath,
      command: 'npm run platform -- lock'
    },
    {
      id: 'provenance-registry',
      artifactPath: 'project/provenance.json',
      absolutePath: paths.provenancePath,
      command: 'npm run platform -- adapt'
    },
    {
      id: 'explain-graph',
      artifactPath: 'project/generated/explain-graph.json',
      absolutePath: paths.explainGraphPath,
      command: 'npm run platform -- explain'
    },
    {
      id: 'review-summary',
      artifactPath: 'project/generated/review-summary.json',
      absolutePath: paths.reviewSummaryPath,
      command: 'npm run platform -- explain'
    }
  ].map(async (item) => ({
    id: item.id,
    status: await pathExists(item.absolutePath) ? 'passed' as const : 'missing' as const,
    artifactPath: item.artifactPath,
    command: item.command
  })));
  const missingCount = items.filter((item) => item.status === 'missing').length;
  return {
    formatVersion: '1',
    status: missingCount === 0 ? 'passed' : 'attention',
    itemCount: items.length,
    missingCount,
    items,
    nextCommand: missingCount === 0 ? 'npm run demo:closed-loop' : 'npm run demo:quickstart'
  };
}

function formatDemoChecklist(checklist: DemoChecklist): string {
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

function formatE2eMatrix(matrix: E2eMatrix): string {
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

function formatUpgradeDiagnosticsDetails(details: unknown): string {
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

function formatRepairSummary(repairPlan: RepairPlan, dryRun: boolean): string {
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

function formatPolicyReport(report: NonNullable<ReviewSummary['policySummary']>): string {
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

function formatAcceptanceCoverage(report: AcceptanceCoverageReport): string {
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

function formatRuntimeReport(report: RuntimeVerificationLaneReport): string {
  return [
    `Runtime report ${report.status}`,
    formatRuntimeStep('Build', report.build),
    formatRuntimeStep('Unit', report.unit),
    formatRuntimeStep('Acceptance', report.acceptance)
  ].join('\n');
}

function formatVerificationReport(report: VerificationReport): string {
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

function formatProvenanceRegistry(provenance: ProvenanceFile): string {
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

function formatReviewSummaryContract(summary: ReviewSummary): string {
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

function formatUpgradeDiagnostics(diagnostics: UpgradeDiagnostics): string {
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

function formatUpgradeSummary(upgradePlan: UpgradePlan, dryRun: boolean): string {
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

function formatExplainSummary(graph: ExplainGraph, reviewSummary: ReviewSummary): string {
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
      const outputArgs = parseDepsOutputArgs(subArgs);
      const status = await getDependencyEnvironmentStatus(process.cwd());
      if (outputArgs.json) {
        console.log(JSON.stringify(status, null, outputArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'warmup': {
      const outputArgs = parseDepsOutputArgs(subArgs);
      const status = await warmupDependencyEnvironment(process.cwd());
      if (outputArgs.json) {
        console.log(JSON.stringify(status, null, outputArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'relink': {
      if (subArgs[0] !== 'project') {
        throw new Error(DEPS_USAGE);
      }
      const outputArgs = parseDepsOutputArgs(subArgs.slice(1));
      const status = await relinkProjectDependencies(process.cwd());
      if (outputArgs.json) {
        console.log(JSON.stringify(status, null, outputArgs.compact ? 0 : 2));
        return;
      }
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

async function runReferenceCommand(args: string[]): Promise<void> {
  if (args[0] !== 'check') {
    throw new Error(REFERENCE_USAGE);
  }

  const outputArgs = parseReferenceOutputArgs(args.slice(1));
  const report = await buildReferenceCheckReport();

  if (outputArgs.json) {
    console.log(JSON.stringify(report, null, outputArgs.compact ? 0 : 2));
  } else {
    console.log(formatReferenceCheck(report));
  }

  assertReferenceCheckClean(report);
}

async function runBenchmarkCommand(args: string[]): Promise<void> {
  if (args[0] !== 'suite') {
    throw new Error(BENCHMARK_USAGE);
  }

  const outputArgs = parseBenchmarkOutputArgs(args.slice(1));
  const contract = buildBenchmarkTaskSuiteContract();
  if (outputArgs.json) {
    console.log(JSON.stringify(contract, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatBenchmarkTaskSuiteContract(contract));
}

async function runTestCommand(args: string[]): Promise<void> {
  if (args[0] !== 'budget') {
    throw new Error(TEST_USAGE);
  }

  const outputArgs = parseTestOutputArgs(args.slice(1));
  const contract = buildTestBudgetContract();
  if (outputArgs.json) {
    console.log(JSON.stringify(contract, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatTestBudgetContract(contract));
}

async function runPolicyCommand(args: string[]): Promise<void> {
  if (args[0] !== 'report') {
    throw new Error(POLICY_USAGE);
  }

  const outputArgs = parsePolicyOutputArgs(args.slice(1));
  const { policyReportPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(policyReportPath))) {
    throw new Error('Policy report not found; run platform verify first');
  }

  const report = await readJson<PolicyReport>(policyReportPath);
  if (outputArgs.json) {
    console.log(JSON.stringify(report, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatPolicyReport({
    status: report.status,
    officialPolicyCount: report.official.policies.length,
    projectPolicyCount: report.project.policies.length,
    mergedPolicyCount: report.merged.policies.length,
    sourceCount: report.official.sources.length + report.project.sources.length,
    violationCount: report.violations.length,
    severityCounts: report.violations.reduce<Record<string, number>>((counts, violation) => {
      counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
      return counts;
    }, {}),
    sourceSummaries: [],
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
  }));
}

async function runAcceptanceCommand(args: string[]): Promise<void> {
  if (args[0] !== 'coverage') {
    throw new Error(ACCEPTANCE_USAGE);
  }

  const outputArgs = parseAcceptanceOutputArgs(args.slice(1));
  const { acceptanceCoveragePath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(acceptanceCoveragePath))) {
    throw new Error('Acceptance coverage report not found; run platform verify first');
  }

  const report = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  if (outputArgs.json) {
    console.log(JSON.stringify(report, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatAcceptanceCoverage(report));
}

async function runRuntimeCommand(args: string[]): Promise<void> {
  if (args[0] !== 'report') {
    throw new Error(RUNTIME_USAGE);
  }

  const outputArgs = parseRuntimeOutputArgs(args.slice(1));
  const { runtimeReportPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(runtimeReportPath))) {
    throw new Error('Runtime report not found; run platform verify first');
  }

  const report = await readJson<RuntimeVerificationLaneReport>(runtimeReportPath);
  if (outputArgs.json) {
    console.log(JSON.stringify(report, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatRuntimeReport(report));
}

async function runInstallCommand(args: string[]): Promise<void> {
  if (args[0] !== 'manifest') {
    throw new Error(INSTALL_USAGE);
  }

  const outputArgs = parseInstallOutputArgs(args.slice(1));
  const { installManifestPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(installManifestPath))) {
    throw new Error('Install manifest not found; run platform compose first');
  }

  const manifest = await readJson<InstallManifestEntry[]>(installManifestPath);
  if (outputArgs.json) {
    console.log(JSON.stringify(manifest, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatInstallManifest(manifest));
}

async function runBlocksCommand(args: string[]): Promise<void> {
  if (args[0] !== 'usage') {
    throw new Error(BLOCKS_USAGE);
  }

  const outputArgs = parseBlocksOutputArgs(args.slice(1));
  const { blockUsageMapPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(blockUsageMapPath))) {
    throw new Error('Block usage map not found; run platform compose first');
  }

  const usageMap = await readJson<BlockUsageMap>(blockUsageMapPath);
  if (outputArgs.json) {
    console.log(JSON.stringify(usageMap, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatBlockUsageMap(usageMap));
}

async function runVerificationCommand(args: string[]): Promise<void> {
  if (args[0] !== 'report') {
    throw new Error(VERIFICATION_USAGE);
  }

  const outputArgs = parseVerificationOutputArgs(args.slice(1));
  const { verificationReportPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(verificationReportPath))) {
    throw new Error('Verification report not found; run platform verify first');
  }

  const report = await readJson<VerificationReport>(verificationReportPath);
  if (outputArgs.json) {
    console.log(JSON.stringify(report, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatVerificationReport(report));
}

async function runProvenanceCommand(args: string[]): Promise<void> {
  if (args[0] !== 'registry') {
    throw new Error(PROVENANCE_USAGE);
  }

  const outputArgs = parseProvenanceOutputArgs(args.slice(1));
  const { provenancePath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(provenancePath))) {
    throw new Error('Provenance registry not found; run platform adapt or lock first');
  }

  const provenance = await readJson<ProvenanceFile>(provenancePath);
  if (outputArgs.json) {
    console.log(JSON.stringify(provenance, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatProvenanceRegistry(provenance));
}

async function runReviewCommand(args: string[]): Promise<void> {
  if (args[0] !== 'summary' && args[0] !== 'matrix') {
    throw new Error(REVIEW_USAGE);
  }

  const outputArgs = parseReviewOutputArgs(args.slice(1));
  const { reviewSummaryPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(reviewSummaryPath))) {
    throw new Error('Review summary not found; run platform explain first');
  }

  const summary = await readJson<ReviewSummary>(reviewSummaryPath);
  if (args[0] === 'matrix') {
    const matrix = buildE2eMatrix(summary);
    if (outputArgs.json) {
      console.log(JSON.stringify(matrix, null, outputArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatE2eMatrix(matrix));
    return;
  }

  if (outputArgs.json) {
    console.log(JSON.stringify(summary, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatReviewSummaryContract(summary));
}

async function runDemoCommand(args: string[]): Promise<void> {
  if (args[0] !== 'checklist') {
    throw new Error(DEMO_USAGE);
  }

  const outputArgs = parseDemoOutputArgs(args.slice(1));
  const checklist = await buildDemoChecklist(process.cwd());
  if (outputArgs.json) {
    console.log(JSON.stringify(checklist, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatDemoChecklist(checklist));
}

async function runContractCommand(args: string[]): Promise<void> {
  const [contractKind, ...outputRawArgs] = args;
  if (contractKind !== 'freeze' && contractKind !== 'errors' && contractKind !== 'ci') {
    throw new Error(CONTRACT_USAGE);
  }

  const outputArgs = parseContractOutputArgs(outputRawArgs);
  if (contractKind === 'freeze') {
    const contract = buildContractFreezeContract();
    if (outputArgs.json) {
      console.log(JSON.stringify(contract, null, outputArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatContractFreezeContract(contract));
    return;
  }

  if (contractKind === 'ci') {
    const contract = buildCiContract();
    if (outputArgs.json) {
      console.log(JSON.stringify(contract, null, outputArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatCiContract(contract));
    return;
  }

  const contract = buildErrorProtocolContract();
  if (outputArgs.json) {
    console.log(JSON.stringify(contract, null, outputArgs.compact ? 0 : 2));
    return;
  }
  console.log(formatErrorProtocolContract(contract));
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
      const verifyArgs = parseVerifyArgs(args);
      const { report } = await verifyWorkspace(process.cwd(), {
        lane: verifyArgs.lane,
        emitTiming: !verifyArgs.json
      });
      if (verifyArgs.json) {
        console.log(JSON.stringify(report, null, verifyArgs.compact ? 0 : 2));
        return;
      }
      console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
      return;
    }
    case 'repair': {
      const repairArgs = parseRepairArgs(args);
      if (repairArgs.mode === 'plan') {
        const { repairPlanPath } = getWorkspacePaths(process.cwd());
        if (!(await pathExists(repairPlanPath))) {
          throw new Error('Repair plan not found; run platform repair --dry-run first');
        }
        const repairPlan = await readJson<RepairPlan>(repairPlanPath);
        if (repairArgs.json) {
          console.log(JSON.stringify(repairPlan, null, repairArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatRepairSummary(repairPlan, true));
        return;
      }
      try {
        const { repairPlan } = await repairWorkspace(process.cwd(), { dryRun: repairArgs.dryRun });
        if (repairArgs.json) {
          console.log(JSON.stringify(repairPlan, null, repairArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatRepairSummary(repairPlan, repairArgs.dryRun));
        return;
      } catch (error) {
        const repairPlan = await readWrittenRepairPlan(process.cwd());
        if (repairPlan) {
          if (repairArgs.json) {
            console.log(JSON.stringify(repairPlan, null, repairArgs.compact ? 0 : 2));
          } else {
            console.log(formatRepairSummary(repairPlan, repairArgs.dryRun));
          }
        }
        throw error;
      }
    }
    case 'upgrade': {
      const upgradeArgs = parseUpgradeArgs(args);
      if (upgradeArgs.mode === 'plan') {
        const { upgradePlanPath } = getWorkspacePaths(process.cwd());
        if (!(await pathExists(upgradePlanPath))) {
          throw new Error('Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first');
        }
        const upgradePlan = await readJson<UpgradePlan>(upgradePlanPath);
        if (upgradeArgs.json) {
          console.log(JSON.stringify(upgradePlan, null, upgradeArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatUpgradeSummary(upgradePlan, upgradePlan.status === 'planned'));
        return;
      }
      if (upgradeArgs.mode === 'diagnostics') {
        const { upgradeDiagnosticsPath } = getWorkspacePaths(process.cwd());
        if (!(await pathExists(upgradeDiagnosticsPath))) {
          throw new Error('Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first');
        }
        const diagnostics = await readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);
        if (upgradeArgs.json) {
          console.log(JSON.stringify(diagnostics, null, upgradeArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatUpgradeDiagnostics(diagnostics));
        return;
      }
      const { upgradePlan } = await upgradeWorkspace(process.cwd(), upgradeArgs.blockId, upgradeArgs.targetVersion, {
        dryRun: upgradeArgs.dryRun
      });
      if (upgradeArgs.json) {
        console.log(JSON.stringify(upgradePlan, null, upgradeArgs.compact ? 0 : 2));
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
      if (explainArgs.mode === 'graph') {
        const { explainGraphPath } = getWorkspacePaths(process.cwd());
        if (!(await pathExists(explainGraphPath))) {
          throw new Error('Explain graph not found; run platform explain first');
        }
        const graph = await readJson<ExplainGraph>(explainGraphPath);
        if (explainArgs.json) {
          console.log(JSON.stringify(graph, null, explainArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatExplainGraphInspect(graph));
        return;
      }
      const { graph, reviewSummary } = await explainWorkspace(process.cwd());
      if (explainArgs.json) {
        console.log(JSON.stringify(
          { graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) },
          null,
          explainArgs.compact ? 0 : 2
        ));
        return;
      }
      console.log(formatExplainSummary(graph, reviewSummary));
      return;
    }
    case 'artifacts': {
      const artifactsArgs = parseArtifactsArgs(args);
      if (artifactsArgs.mode === 'manifest') {
        const { ciArtifactsPath } = getWorkspacePaths(process.cwd());
        if (!(await pathExists(ciArtifactsPath))) {
          throw new Error('Artifact manifest not found; run platform artifacts --json first');
        }
        const manifest = await readJson<CiArtifactManifest>(ciArtifactsPath);
        if (artifactsArgs.json) {
          console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatCiArtifactManifest(manifest));
        return;
      }
      const { manifest } = await writeWorkspaceArtifacts(process.cwd());
      if (artifactsArgs.mode === 'paths') {
        const pathSummary = artifactUploadPathSummary(manifest, artifactsArgs.kind);
        if (artifactsArgs.json) {
          console.log(JSON.stringify({
            formatVersion: manifest.formatVersion,
            root: manifest.root,
            kind: artifactsArgs.kind ?? 'all',
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
          }, null, artifactsArgs.compact ? 0 : 2));
          return;
        }
        console.log(pathSummary.paths.join('\n'));
        return;
      }
      console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
      return;
    }
    case 'doctor': {
      const doctorArgs = parseDoctorArgs(args);
      const report = await getDoctorReport(process.cwd());
      if (doctorArgs.json) {
        console.log(JSON.stringify(report, null, doctorArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatDoctorReport(report));
      return;
    }
    case 'deps':
      await runDepsCommand(args);
      return;
    case 'reference':
      await runReferenceCommand(args);
      return;
    case 'benchmark':
      await runBenchmarkCommand(args);
      return;
    case 'test':
      await runTestCommand(args);
      return;
    case 'policy':
      await runPolicyCommand(args);
      return;
    case 'acceptance':
      await runAcceptanceCommand(args);
      return;
    case 'runtime':
      await runRuntimeCommand(args);
      return;
    case 'install':
      await runInstallCommand(args);
      return;
    case 'blocks':
      await runBlocksCommand(args);
      return;
    case 'verification':
      await runVerificationCommand(args);
      return;
    case 'provenance':
      await runProvenanceCommand(args);
      return;
    case 'review':
      await runReviewCommand(args);
      return;
    case 'demo':
      await runDemoCommand(args);
      return;
    case 'contract':
      await runContractCommand(args);
      return;
    default:
      console.log(USAGE);
  }
}

main().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string; details?: unknown };
  const protocol = buildErrorProtocol(failure);
  console.error(protocol.code, protocol.message);
  console.error(JSON.stringify({
    code: protocol.code,
    message: protocol.message,
    recoverable: protocol.recoverable,
    issueType: protocol.issueType,
    suggestedActions: protocol.suggestedActions,
    artifactPaths: protocol.artifactPaths
  }));
  if (protocol.details) {
    console.error(JSON.stringify(protocol.details, null, 2));
  }
  process.exit(1);
});
