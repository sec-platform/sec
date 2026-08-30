import { Argument, type Command } from 'commander';
import type { UpgradeDiagnostics, UpgradePlan } from '../../change-management/upgrade/contract/types.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { PolicyReport } from '../../compiler/policies/contract/types.ts';
import type { TextByteCensusReport, TextByteClassification } from '../../runtime-state/text-byte-census.ts';
import type { WorktreeSettlementReceipt } from '../../runtime-state/worktree-settlement.ts';
import type { AcceptanceCoverageReport } from '../../semantic/acceptance/contract/types.ts';
import type { ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import type { RepairPlan } from '../../semantic/repair/contract/types.ts';
import { countMatching } from '../../system-architecture/foundation/runtime/collections.ts';
import type { DependencyCleanOptions } from '../../toolchain/dependencies/environment.ts';
import { buildBenchmarkTaskSuiteContract, formatBenchmarkTaskSuiteContract } from '../../verification/benchmark/contract.ts';
import { CI_ARTIFACT_FILES, CI_EXPLAIN_GRAPH_ARTIFACTS } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactKind } from '../../verification/ci-artifacts/contract/types.ts';
import { buildCiContract, formatCiContract } from '../../verification/ci/contract/core.ts';
import type { RuntimeVerificationLaneReport, VerificationLane, VerificationReport } from '../../verification/contract/types.ts';
import { buildContractFreezeContract, formatContractFreezeContract } from '../../verification/freeze.ts';
import { buildReviewPolicySummary } from '../../verification/review/contract/policy.ts';
import type { ReviewSummary } from '../../verification/review/contract/types.ts';
import { buildE2eMatrix } from '../../verification/review/runtime/matrix.ts';
import { pathExists, readJson } from '../../workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath, resolveWorkspaceProvenancePath } from '../../workspace/paths.ts';
import type { ProjectOverview } from '../../workspace/project.ts';
import { platformCommand } from './contract.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from './error-protocol-contract.ts';
import { formatJson, printJsonOrText } from './format-utils.ts';
import {
  buildAcceptanceTargetInspect,
  buildArtifactUploadPathContract,
  buildPolicySourceInspect,
  buildReviewDiagnosticsInspect,
  buildRuntimeStepsInspect,
  formatAcceptanceCoverage,
  formatAcceptanceTargets,
  formatBlockUsageMap,
  formatCiArtifactManifest,
  formatDemoChecklist,
  formatE2eMatrix,
  formatExplainGraphInspect,
  formatExplainSummary,
  formatInstallManifest,
  formatLockInspect,
  formatPolicyReport,
  formatPolicySources,
  formatPostgresContract,
  formatProvenanceRegistry,
  formatRepairSummary,
  formatReviewDiagnosticsInspect,
  formatReviewSummaryContract,
  formatRuntimeReport,
  formatRuntimeStepsInspect,
  formatUpgradeDiagnostics,
  formatUpgradeSummary,
  formatVerificationReport,
  type BlockUsageMap,
  type DemoChecklist,
  type DemoChecklistItem,
  type InstallManifestEntry,
  type PostgresContract
} from './formatters.ts';
import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  loadDependencyEnvironmentDomain,
  loadProjectOverviewDomain,
  loadReferenceCheckDomain,
  loadTestBudgetDomain,
  lockWorkspace,
  observeWorkspaceArtifacts,
  repairWorkspace,
  resolveWorkspace,
  runCensus,
  runSettlement,
  upgradeWorkspace,
  verifyWorkspace,
  writeWorkspaceArtifacts
} from './lazy-command-domains.ts';
import { withSpinner } from './runtime/spinner.ts';

type JsonOpts = { json: boolean; compact: boolean };

type DependencyEnvironmentModule = typeof import('../../toolchain/dependencies/environment.ts');

export type DependencyEnvironmentCommandDomain = Pick<
  DependencyEnvironmentModule,
  | 'cleanDependencyEnvironment'
  | 'formatDependencyEnvironmentStatus'
  | 'formatDoctorReport'
  | 'getDependencyEnvironmentStatus'
  | 'getDoctorReport'
  | 'relinkProjectDependencies'
  | 'warmupDependencyEnvironment'
>;

export type CliCommandDomainLoaders = Readonly<{
  loadDependencyEnvironmentDomain?: () => Promise<DependencyEnvironmentCommandDomain>;
}>;

function jsonOpts(opts: Record<string, unknown>): JsonOpts {
  return { json: !!opts.json, compact: !!opts.compact };
}

function commandPath(cmd: Command): string {
  const names: string[] = [];
  let current: Command | null = cmd;
  while (current) {
    const name = current.name();
    if (name) names.push(name);
    current = current.parent ?? null;
  }
  return names.reverse().join(' ');
}

function commandFromRoot(cmd: Command, ...segments: readonly string[]): string {
  let root = cmd;
  while (root.parent) root = root.parent;
  return [root.name(), ...segments].filter((segment) => segment.length > 0).join(' ');
}

function usageError(message: string): CompilerError {
  return new CompilerError('CLI-USAGE-001', message);
}

function assertJsonFlags(opts: Record<string, unknown>, cmd: Command): void {
  if (opts.compact && !opts.json) {
    throw usageError(`Usage: ${commandPath(cmd)} [--json [--compact]]`);
  }
}

async function readRequiredJson<T>(filePath: string, missingMessage: string): Promise<T> {
  if (!(await pathExists(filePath))) throw new Error(missingMessage);
  return readJson<T>(filePath);
}

async function printRequiredJson<T>(
  filePath: string, missingMessage: string, output: JsonOpts, formatText: (v: T) => string
): Promise<void> {
  const value = await readRequiredJson<T>(filePath, missingMessage);
  printJsonOrText(value, output, formatText);
}

async function printWorkspaceJson<T>(
  cwd: string, selectPath: (p: ReturnType<typeof getWorkspacePaths>) => string,
  missingMessage: string, output: JsonOpts, formatText: (v: T) => string
): Promise<void> {
  await printRequiredJson<T>(selectPath(getWorkspacePaths(cwd)), missingMessage, output, formatText);
}

function addJsonFlags(cmd: Command): Command {
  return cmd
    .option('--json', 'Output as JSON')
    .option('--compact', 'Compact JSON output')
    .hook('preAction', (_thisCommand, actionCommand) => {
      assertJsonFlags(actionCommand.opts(), actionCommand);
    });
}

function optionalModeCommand(
  cmd: Command,
  name: string,
  choices: readonly string[]
): Command {
  return cmd.addArgument(new Argument(`[${name}]`).choices([...choices]));
}

function runWithOptionalSpinner<T>(text: string, output: JsonOpts, fn: () => Promise<T>): Promise<T> {
  return output.json ? fn() : withSpinner(text, fn);
}

function formatTextCensusReport(report: TextByteCensusReport): string {
  const lines: string[] = [];
  lines.push('Text Byte Census');
  lines.push(`  totalFiles: ${report.totalFiles}`);
  lines.push(`  failClosed: ${report.failClosed}`);
  lines.push('  classifications:');
  const classifications: TextByteClassification[] = ['canonical-lf', 'explicit-crlf', 'binary', 'preserve-external', 'unknown'];
  for (const c of classifications) {
    if (report.classificationCounts[c] > 0) {
      lines.push(`    ${c}: ${report.classificationCounts[c]}`);
    }
  }
  lines.push('  anomalies:');
  let anyAnomaly = false;
  for (const [a, count] of Object.entries(report.anomalyCounts)) {
    if (count > 0) {
      lines.push(`    ${a}: ${count}`);
      anyAnomaly = true;
    }
  }
  if (!anyAnomaly) lines.push('    (none)');
  if (report.flaggedEntries.length > 0) {
    lines.push(`  flagged: ${report.flaggedEntries.length} file(s)`);
    const maxShow = Math.min(report.flaggedEntries.length, 20);
    for (let i = 0; i < maxShow; i += 1) {
      const e = report.flaggedEntries[i]!;
      lines.push(`    ${e.path} [${e.classification}] ${e.anomalies.length === 0 ? '(none)' : e.anomalies.join(', ')}`);
    }
    if (report.flaggedEntries.length > maxShow) {
      lines.push(`    ... and ${report.flaggedEntries.length - maxShow} more`);
    }
  }
  return lines.join('\n');
}

function formatSettlementReceipt(r: WorktreeSettlementReceipt): string {
  const lines: string[] = [];
  lines.push('Worktree Settlement');
  lines.push(`  status: ${r.status}`);
  lines.push(`  totalFiles: ${r.totalFiles}`);
  lines.push(`  dirty: ${r.dirtyCount}, untracked: ${r.untrackedCount}, drift: ${r.driftEntries.length}`);
  lines.push(`  core.autocrlf: ${r.coreAutocrlf}, core.eol: ${r.coreEol}`);
  lines.push(`  summary: ${r.summary}`);
  if (r.driftEntries.length > 0) {
    lines.push('  drift:');
    const maxShow = Math.min(r.driftEntries.length, 20);
    for (let i = 0; i < maxShow; i += 1) {
      const e = r.driftEntries[i]!;
      lines.push(`    ${e.path} [declared=${e.declared} blob=${e.blobLineEnding} worktree=${e.worktreeLineEnding}]`);
    }
    if (r.driftEntries.length > maxShow) {
      lines.push(`    ... and ${r.driftEntries.length - maxShow} more`);
    }
  }
  return lines.join('\n');
}

async function buildDemoChecklist(workspaceRoot: string): Promise<DemoChecklist> {
  const paths = getWorkspacePaths(workspaceRoot);
  const explainGraphChecklistPaths: Record<
    (typeof CI_EXPLAIN_GRAPH_ARTIFACTS)[number]['id'],
    string
  > = {
    'explain-graph': paths.explainGraphPath,
    'explain-graph-mermaid': paths.explainGraphMermaidPath,
    'explain-graph-dot': paths.explainGraphDotPath
  };
  const items: DemoChecklistItem[] = await Promise.all([
    {
      id: 'verification-report',
      absolutePath: paths.verificationReportPath,
      artifactPath: CI_ARTIFACT_FILES.verificationReport,
      command: platformCommand('verify', '--lane', 'all')
    },
    {
      id: 'runtime-report',
      absolutePath: paths.runtimeReportPath,
      artifactPath: CI_ARTIFACT_FILES.runtimeReport,
      command: platformCommand('verify', '--lane', 'all')
    },
    {
      id: 'policy-report',
      absolutePath: paths.policyReportPath,
      artifactPath: CI_ARTIFACT_FILES.policyReport,
      command: platformCommand('verify')
    },
    {
      id: 'acceptance-coverage',
      absolutePath: paths.acceptanceCoveragePath,
      artifactPath: CI_ARTIFACT_FILES.acceptanceCoverage,
      command: platformCommand('verify')
    },
    {
      id: 'graph-lock',
      absolutePath: paths.lockPath,
      artifactPath: CI_ARTIFACT_FILES.graphLock,
      command: platformCommand('lock')
    },
    {
      id: 'provenance-registry',
      absolutePath: paths.provenancePath,
      artifactPath: CI_ARTIFACT_FILES.provenance,
      command: platformCommand('adapt')
    },
    ...CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => ({
      id: artifact.id,
      absolutePath: explainGraphChecklistPaths[artifact.id],
      artifactPath: artifact.path,
      command: platformCommand('explain')
    })),
    {
      id: 'review-summary',
      absolutePath: paths.reviewSummaryPath,
      artifactPath: CI_ARTIFACT_FILES.reviewSummary,
      command: platformCommand('explain')
    }
  ].map(async (item) => ({
    id: item.id,
    status: await pathExists(item.absolutePath) ? 'passed' as const : 'missing' as const,
    artifactPath: item.artifactPath,
    command: item.command
  })));
  const missingCount = countMatching(items, (item) => item.status === 'missing');
  return {
    status: missingCount === 0 ? 'passed' : 'attention',
    itemCount: items.length,
    missingCount,
    items,
    nextCommand: missingCount === 0 ? 'bun run demo:closed-loop' : 'bun run demo:quickstart'
  };
}

export function registerCommands(
  program: Command,
  domainLoaders: CliCommandDomainLoaders = {}
): void {
  const loadDependencyEnvironment = domainLoaders.loadDependencyEnvironmentDomain
    ?? loadDependencyEnvironmentDomain;
  program.command('init')
    .description('Initialize project workspace')
    .action(async () => {
      await initWorkspace(process.cwd());
      console.log('Initialized project workspace');
    });

  program.command('add <block-id>')
    .description('Add a block to the project')
    .action(async (blockId: string) => {
      const cwd = process.cwd();
      const result = await addBlock(cwd, blockId);
      const selected = result.selectedBlock;
      console.log(`${result.changed ? 'Added' : 'Selected'} block ${selected.id}@${selected.version} from ${selected.registrySourceId} (${selected.registryKind})`);
    });

  program.command('resolve')
    .description('Resolve block dependencies')
    .action(async () => {
      const { lock } = await withSpinner('Resolving block dependencies', () => resolveWorkspace(process.cwd()));
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
    });

  program.command('compose')
    .description('Compose project')
    .option('--lock', 'Lock project files as read-only')
    .action(async (opts: Record<string, unknown>) => {
      await withSpinner('Composing project', () => composeWorkspace(process.cwd(), { lock: !!opts.lock }));
      console.log('Composed project');
    });

  program.command('adapt')
    .description('Adapt slots')
    .action(async () => {
      await withSpinner('Adapting slots', () => adaptWorkspace(process.cwd()));
      console.log('Adapted slots');
    });

  addJsonFlags(program.command('verify'))
    .description('Run verification')
    .option('--lane <lane>', 'Verification lane', 'fast')
    .action(async (opts: Record<string, unknown>) => {
      const lane = opts.lane as VerificationLane;
      if (lane !== 'fast' && lane !== 'runtime' && lane !== 'all') {
        throw usageError('Lane must be fast, runtime, or all');
      }
      const output = jsonOpts(opts);
      const { report } = await runWithOptionalSpinner('Running verification', output, () => verifyWorkspace(process.cwd(), { lane, emitTiming: !output.json }));
      printJsonOrText(report, output, (v) => `Verification ${v.summary.status} (${v.summary.requestedLane})`);
    });

  addJsonFlags(optionalModeCommand(program.command('repair'), 'mode', ['plan']))
    .description('Run repair')
    .option('--dry-run', 'Dry run repair')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (mode === 'plan') {
        const { repairPlanPath } = getWorkspacePaths(process.cwd());
        await printRequiredJson<RepairPlan>(repairPlanPath, `Repair plan not found; run ${commandPath(cmd)} --dry-run first`, output, (p) => formatRepairSummary(p, true));
        return;
      }
      try {
        const { repairPlan } = await runWithOptionalSpinner(
          opts.dryRun ? 'Previewing repair' : 'Running repair',
          output,
          () => repairWorkspace(process.cwd(), { dryRun: !!opts.dryRun })
        );
        printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, !!opts.dryRun));
      } catch (error) {
        const { repairPlanPath } = getWorkspacePaths(process.cwd());
        if (await pathExists(repairPlanPath)) {
          const repairPlan = await readJson<RepairPlan>(repairPlanPath);
          printJsonOrText(repairPlan, output, (p) => formatRepairSummary(p, !!opts.dryRun));
        }
        throw error;
      }
    });

  addJsonFlags(program.command('upgrade')
    .argument('[subject]')
    .argument('[target-version]'))
    .description('Run upgrade')
    .option('--dry-run', 'Dry run upgrade')
    .action(async (
      subject: string | undefined,
      targetVersion: string | undefined,
      opts: Record<string, unknown>,
      cmd: Command
    ) => {
      const output = jsonOpts(opts);
      if (subject === 'plan' && targetVersion === undefined) {
        const { upgradePlanPath } = getWorkspacePaths(process.cwd());
        await printRequiredJson<UpgradePlan>(upgradePlanPath, `Upgrade plan not found; run ${commandPath(cmd)} <block-id> <target-version> --dry-run first`, output, (p) => formatUpgradeSummary(p, true));
        return;
      }
      if (subject === 'diagnostics' && targetVersion === undefined) {
        const { upgradeDiagnosticsPath } = getWorkspacePaths(process.cwd());
        await printRequiredJson<UpgradeDiagnostics>(upgradeDiagnosticsPath, `Upgrade diagnostics not found; run ${commandPath(cmd)} <block-id> <target-version> --dry-run first`, output, formatUpgradeDiagnostics);
        return;
      }
      if (subject === undefined || targetVersion === undefined) {
        throw usageError(`Usage: ${commandPath(cmd)} <block-id> <target-version> [--dry-run] [--json [--compact]]`);
      }
      const { upgradePlan } = await runWithOptionalSpinner(
        opts.dryRun ? 'Previewing upgrade' : 'Running upgrade',
        output,
        () => upgradeWorkspace(process.cwd(), subject, targetVersion, { dryRun: !!opts.dryRun })
      );
      printJsonOrText(upgradePlan, output, (p) => formatUpgradeSummary(p, !!opts.dryRun));
    });

  addJsonFlags(optionalModeCommand(program.command('lock'), 'mode', ['inspect']))
    .description('Lock project')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (mode === 'inspect') {
        const lockPath = await resolveWorkspaceLockPath(process.cwd());
        await printRequiredJson<LockFile>(lockPath, `Graph lock not found; run ${commandPath(cmd)} first`, output, formatLockInspect);
        return;
      }
      await runWithOptionalSpinner('Locking project', output, () => lockWorkspace(process.cwd()));
      console.log('Locked project');
    });

  addJsonFlags(optionalModeCommand(program.command('explain'), 'mode', ['graph']))
    .description('Explain project')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (mode === 'graph') {
        await printWorkspaceJson<import('../../semantic/projection/contract/explain.ts').ExplainGraph>(
          process.cwd(), (p) => p.explainGraphPath, `Explain graph not found; run ${commandPath(cmd)} first`, output, formatExplainGraphInspect
        );
        return;
      }
      const { graph, reviewSummary } = await runWithOptionalSpinner('Explaining project', output, () => explainWorkspace(process.cwd()));
      printJsonOrText({ graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) }, output, (s) => formatExplainSummary(s.graph, s.reviewSummary));
    });

  addJsonFlags(optionalModeCommand(program.command('artifacts'), 'mode', ['manifest']))
    .description('Manage CI artifacts')
    .option('--paths', 'List artifact paths')
    .option('--kind <kind>', 'Filter by artifact kind')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (mode === 'manifest') {
        await printWorkspaceJson<import('../../verification/ci-artifacts/contract/types.ts').CiArtifactManifest>(
          process.cwd(), (p) => p.ciArtifactsPath, `Artifact manifest not found; run ${commandPath(cmd)} --json first`, output, formatCiArtifactManifest
        );
        return;
      }
      if (opts.paths) {
        const manifest = await observeWorkspaceArtifacts(process.cwd());
        const kind = opts.kind as CiArtifactKind | undefined;
        const contract = buildArtifactUploadPathContract(manifest, kind);
        printJsonOrText(contract, output, (c) => c.paths.join('\n'));
        return;
      }
      const { manifest } = await writeWorkspaceArtifacts(process.cwd());
      console.log(formatJson(manifest, output));
    });

  addJsonFlags(program.command('doctor'))
    .description('Check environment readiness')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const domain = await loadDependencyEnvironment();
      const report = await domain.getDoctorReport(process.cwd());
      printJsonOrText(report, output, domain.formatDoctorReport);
    });

  const deps = program.command('deps').description('Dependency management');
  addJsonFlags(deps.command('status')).action(async (opts: Record<string, unknown>) => {
    const domain = await loadDependencyEnvironment();
    const status = await domain.getDependencyEnvironmentStatus(process.cwd());
    printJsonOrText(status, jsonOpts(opts), domain.formatDependencyEnvironmentStatus);
  });
  addJsonFlags(deps.command('warmup')).action(async (opts: Record<string, unknown>) => {
    const domain = await loadDependencyEnvironment();
    const status = await domain.warmupDependencyEnvironment(process.cwd());
    printJsonOrText(status, jsonOpts(opts), domain.formatDependencyEnvironmentStatus);
  });
  addJsonFlags(deps.command('relink')).action(async (opts: Record<string, unknown>) => {
    const domain = await loadDependencyEnvironment();
    const status = await domain.relinkProjectDependencies(process.cwd());
    printJsonOrText(status, jsonOpts(opts), domain.formatDependencyEnvironmentStatus);
  });
  deps.command('clean')
    .option('--project', 'Clean project deps')
    .option('--shared', 'Clean shared deps')
    .option('--bun-cache', 'Clean Bun cache')
    .option('--all', 'Clean all')
    .option('--force', 'Force clean')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const options = opts as DependencyCleanOptions;
      if (options.all && !options.force) throw usageError(`Usage: ${commandPath(cmd)} --all --force`);
      if (!options.all && options.force) throw usageError(`Usage: ${commandPath(cmd)} --all --force`);
      const domain = await loadDependencyEnvironment();
      const removed = await domain.cleanDependencyEnvironment(process.cwd(), options);
      console.log(`Cleaned ${removed.length} dependency paths`);
    });

  const referenceCmd = program.command('reference').description('Reference workspace operations');
  addJsonFlags(referenceCmd.command('check')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const domain = await loadReferenceCheckDomain();
    const report = await domain.buildReferenceCheckReport();
    printJsonOrText(report, output, domain.formatReferenceCheck);
    domain.assertReferenceCheckClean(report);
  });

  addJsonFlags(program.command('benchmark')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    printJsonOrText(buildBenchmarkTaskSuiteContract(), output, formatBenchmarkTaskSuiteContract);
  });

  addJsonFlags(program.command('test')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const domain = await loadTestBudgetDomain();
    printJsonOrText(await domain.buildTestBudgetContract(), output, domain.formatTestBudgetContract);
  });

  addJsonFlags(optionalModeCommand(program.command('policy'), 'mode', ['sources']))
    .description('Policy inspection')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const { policyReportPath } = getWorkspacePaths(process.cwd());
      const report = await readRequiredJson<PolicyReport>(policyReportPath, `Policy report not found; run ${commandFromRoot(cmd, 'verify')} first`);
      if (mode === 'sources') {
        printJsonOrText(buildPolicySourceInspect(report), output, formatPolicySources);
        return;
      }
      printJsonOrText(report, output, (v) => formatPolicyReport(buildReviewPolicySummary(v)));
    });

  addJsonFlags(optionalModeCommand(program.command('acceptance'), 'mode', ['blocks', 'slots']))
    .description('Acceptance inspection')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const { acceptanceCoveragePath } = getWorkspacePaths(process.cwd());
      const report = await readRequiredJson<AcceptanceCoverageReport>(acceptanceCoveragePath, `Acceptance coverage report not found; run ${commandFromRoot(cmd, 'verify')} first`);
      if (mode === 'blocks' || mode === 'slots') {
        printJsonOrText(buildAcceptanceTargetInspect(report, mode), output, formatAcceptanceTargets);
        return;
      }
      printJsonOrText(report, output, formatAcceptanceCoverage);
    });

  addJsonFlags(optionalModeCommand(program.command('runtime'), 'mode', ['steps']))
    .description('Runtime inspection')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const { runtimeReportPath } = getWorkspacePaths(process.cwd());
      const report = await readRequiredJson<RuntimeVerificationLaneReport>(runtimeReportPath, `Runtime report not found; run ${commandFromRoot(cmd, 'verify')} first`);
      if (mode === 'steps') {
        printJsonOrText(buildRuntimeStepsInspect(report), output, formatRuntimeStepsInspect);
        return;
      }
      printJsonOrText(report, output, formatRuntimeReport);
    });

  addJsonFlags(program.command('verification'))
    .description('Verification inspection')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      await printWorkspaceJson<VerificationReport>(process.cwd(), (p) => p.verificationReportPath, 'Verification report not found', output, formatVerificationReport);
    });

  addJsonFlags(program.command('provenance'))
    .description('Provenance inspection')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const provenancePath = await resolveWorkspaceProvenancePath(process.cwd());
      await printRequiredJson<ProvenanceFile>(provenancePath, 'Provenance registry not found', output, formatProvenanceRegistry);
    });

  addJsonFlags(optionalModeCommand(program.command('review'), 'mode', ['matrix', 'diagnostics']))
    .description('Review inspection')
    .action(async (mode: string | undefined, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const { reviewSummaryPath } = getWorkspacePaths(process.cwd());
      const summary = await readRequiredJson<ReviewSummary>(reviewSummaryPath, `Review summary not found; run ${commandFromRoot(cmd, 'explain')} first`);
      if (mode === 'matrix') {
        printJsonOrText(buildE2eMatrix(summary), output, formatE2eMatrix);
        return;
      }
      if (mode === 'diagnostics') {
        printJsonOrText(buildReviewDiagnosticsInspect(summary), output, formatReviewDiagnosticsInspect);
        return;
      }
      printJsonOrText(summary, output, formatReviewSummaryContract);
    });

  addJsonFlags(program.command('demo')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const checklist = await buildDemoChecklist(process.cwd());
    printJsonOrText(checklist, output, formatDemoChecklist);
  });

  addJsonFlags(program.command('overview'))
    .description('Project overview')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const domain = await loadProjectOverviewDomain();
      const overview = await runWithOptionalSpinner(
        'Building project overview',
        output,
        async () => domain.buildProjectOverviewFromWorkspace(process.cwd())
      );
      printJsonOrText<ProjectOverview>(overview, output, domain.formatProjectOverview);
    });

  addJsonFlags(program.command('contract')
    .addArgument(new Argument('<kind>').choices(['freeze', 'errors', 'ci'])))
    .description('Contract inspection')
    .action(async (kind: string, opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (kind === 'freeze') {
        printJsonOrText(buildContractFreezeContract(), output, formatContractFreezeContract);
        return;
      }
      if (kind === 'ci') {
        printJsonOrText(buildCiContract(), output, formatCiContract);
        return;
      }
      if (kind === 'errors') {
        printJsonOrText(buildErrorProtocolContract(), output, formatErrorProtocolContract);
        return;
      }
      throw usageError(`Usage: ${commandPath(cmd)} <freeze|errors|ci> [--json [--compact]]`);
    });

  addJsonFlags(program.command('install')).action(async (opts: Record<string, unknown>, cmd: Command) => {
    await printWorkspaceJson<InstallManifestEntry[]>(process.cwd(), (p) => p.installManifestPath, `Install manifest not found; run ${commandFromRoot(cmd, 'compose')} first`, jsonOpts(opts), formatInstallManifest);
  });

  addJsonFlags(program.command('blocks')).action(async (opts: Record<string, unknown>, cmd: Command) => {
    await printWorkspaceJson<BlockUsageMap>(process.cwd(), (p) => p.blockUsageMapPath, `Block usage map not found; run ${commandFromRoot(cmd, 'compose')} first`, jsonOpts(opts), formatBlockUsageMap);
  });

  addJsonFlags(program.command('postgres')).action(async (opts: Record<string, unknown>, cmd: Command) => {
    await printWorkspaceJson<PostgresContract>(process.cwd(), (p) => p.postgresContractPath, `Postgres contract not found; run ${commandFromRoot(cmd, 'compose')} first`, jsonOpts(opts), formatPostgresContract);
  });

  const textCmd = program.command('text').description('Text byte policy inspection');
  addJsonFlags(textCmd.command('census'))
    .description('Scan tracked Git blobs and classify by .gitattributes policy')
    .option('--fail-on <threshold>', 'Exit non-zero for any fail-closed result or one classification')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const failOn = opts.failOn as string | undefined;
      const classifications: readonly TextByteClassification[] = [
        'canonical-lf', 'explicit-crlf', 'binary', 'preserve-external', 'unknown'
      ];
      if (failOn !== undefined && failOn !== 'any'
        && !classifications.includes(failOn as TextByteClassification)) {
        throw usageError(`Text census --fail-on must be any or one of: ${classifications.join(', ')}`);
      }
      const report = await runWithOptionalSpinner('Scanning text bytes', output, () => runCensus(process.cwd()));
      printJsonOrText(report, output, formatTextCensusReport);
      const failed = failOn === 'any'
        ? report.failClosed
        : failOn !== undefined && report.classificationCounts[failOn as TextByteClassification] > 0;
      if (failed) throw new Error(`Text census --fail-on ${failOn} threshold matched.`);
    });

  const envCmd = program.command('environment').description('Environment settlement inspection');
  addJsonFlags(envCmd.command('settle'))
    .description('Non-destructive worktree settlement preflight')
    .option('--fix', 'Re-checkout governed text files to enforce canonical LF materialization')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const receipt = await runWithOptionalSpinner('Settling worktree', output, () => runSettlement(process.cwd(), { fix: !!opts.fix }));
      printJsonOrText(receipt, output, formatSettlementReceipt);
      if (receipt.status !== 'settled') {
        throw new Error(`Worktree not settled: ${receipt.status}`);
      }
    });
}
