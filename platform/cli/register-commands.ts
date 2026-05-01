import type { Command } from 'commander';
import { buildCiArtifactManifest } from '../compiler/emit/ci-artifacts.ts';
import { loadManifestById } from '../compiler/parse/load-manifest.ts';
import { loadWorkspacePlan } from '../compiler/parse/load-plan.ts';
import { adaptWorkspace, addBlock, applyWorkbenchMutations, composeWorkspace, explainWorkspace, initWorkspace, lockWorkspace, repairWorkspace, resolveWorkspace, upgradeWorkspace, verifyWorkspace, writeWorkspaceArtifacts } from '../orchestrator.ts';
import type { AcceptanceCoverageReport } from '../shared/acceptance-types.ts';
import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../shared/benchmark-contract.ts';
import {
  CI_ARTIFACT_FILES,
  CI_EXPLAIN_GRAPH_ARTIFACTS
} from '../shared/ci-artifact-contract.ts';
import type { CiArtifactKind } from '../shared/ci-artifact-types.ts';
import {
  buildCiContract,
  formatCiContract
} from '../shared/ci-contract.ts';
import { countMatching } from '../shared/collections.ts';
import { CONTRACT_FORMAT_VERSION } from '../shared/constants.ts';
import {
  buildContractFreezeContract,
  formatContractFreezeContract
} from '../shared/contract-freeze-contract.ts';
import type { DependencyCleanOptions } from '../shared/dependency-environment.ts';
import {
  cleanDependencyEnvironment,
  formatDependencyEnvironmentStatus,
  formatDoctorReport,
  getDependencyEnvironmentStatus,
  getDoctorReport,
  relinkProjectDependencies,
  warmupDependencyEnvironment
} from '../shared/dependency-environment.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../shared/error-protocol-contract.ts';
import { pathExists, readJson } from '../shared/fs.ts';
import type { LockFile } from '../shared/lock-types.ts';
import { getWorkspacePaths, resolveWorkspaceLockPath, resolveWorkspaceProvenancePath } from '../shared/paths.ts';
import { platformCommand } from '../shared/platform-command.ts';
import type { PolicyReport } from '../shared/policy-types.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../shared/reference-check.ts';
import type { RepairPlan } from '../shared/repair-types.ts';
import { buildE2eMatrix } from '../shared/review-matrix.ts';
import { buildReviewPolicySummary } from '../shared/review-policy.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../shared/test-budget-contract.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../shared/upgrade-types.ts';
import type { RuntimeVerificationLaneReport, VerificationLane, VerificationReport } from '../shared/verification-types.ts';
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

type JsonOpts = { json: boolean; compact: boolean };

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

function assertJsonFlags(opts: Record<string, unknown>, cmd: Command): void {
  if (opts.compact && !opts.json) {
    throw new Error(`Usage: ${commandPath(cmd)} [--json [--compact]]`);
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

function modeCommand(cmd: Command): Command {
  return cmd.allowExcessArguments(true);
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
    formatVersion: CONTRACT_FORMAT_VERSION,
    status: missingCount === 0 ? 'passed' : 'attention',
    itemCount: items.length,
    missingCount,
    items,
    nextCommand: missingCount === 0 ? 'bun run demo:closed-loop' : 'bun run demo:quickstart'
  };
}

export function registerCommands(program: Command): void {
  program.command('init')
    .description('Initialize project workspace')
    .option('--reset', 'Reset workspace')
    .action(async (opts: Record<string, unknown>) => {
      await initWorkspace(process.cwd(), { reset: !!opts.reset });
      console.log('Initialized project workspace');
    });

  program.command('add <block-id>')
    .description('Add a block to the project')
    .action(async (blockId: string) => {
      const cwd = process.cwd();
      await addBlock(cwd, blockId);
      const plan = await loadWorkspacePlan(cwd);
      const entry = await loadManifestById(blockId, {
        workspaceRoot: cwd,
        version: plan.blocks.find((b) => b.id === blockId)?.version,
        registrySources: plan.registry.sources
      });
      console.log(`Added block ${blockId}@${entry.manifest.version} from ${entry.registrySourceId} (${entry.registryKind})`);
    });

  program.command('resolve')
    .description('Resolve block dependencies')
    .action(async () => {
      const { lock } = await resolveWorkspace(process.cwd());
      console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
    });

  program.command('compose')
    .description('Compose project')
    .action(async () => {
      await composeWorkspace(process.cwd());
      console.log('Composed project');
    });

  program.command('adapt')
    .description('Adapt slots')
    .action(async () => {
      await adaptWorkspace(process.cwd());
      console.log('Adapted slots');
    });

  addJsonFlags(program.command('verify'))
    .description('Run verification')
    .option('--lane <lane>', 'Verification lane', 'fast')
    .action(async (opts: Record<string, unknown>) => {
      const lane = opts.lane as VerificationLane;
      if (lane !== 'fast' && lane !== 'runtime' && lane !== 'all') {
        throw new Error('Lane must be fast, runtime, or all');
      }
      const output = jsonOpts(opts);
      const { report } = await verifyWorkspace(process.cwd(), { lane, emitTiming: !output.json });
      printJsonOrText(report, output, (v) => `Verification ${v.summary.status} (${v.summary.requestedLane})`);
    });

  addJsonFlags(modeCommand(program.command('repair')))
    .description('Run repair')
    .option('--dry-run', 'Dry run repair')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const sub = cmd.args[0];
      if (sub === 'plan') {
        const { repairPlanPath } = getWorkspacePaths(process.cwd());
        await printRequiredJson<RepairPlan>(repairPlanPath, 'Repair plan not found; run platform repair --dry-run first', output, (p) => formatRepairSummary(p, true));
        return;
      }
      try {
        const { repairPlan } = await repairWorkspace(process.cwd(), { dryRun: !!opts.dryRun });
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

  addJsonFlags(modeCommand(program.command('upgrade')))
    .description('Run upgrade')
    .option('--dry-run', 'Dry run upgrade')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const args = cmd.args;
      if (args[0] === 'plan') {
        const { upgradePlanPath } = getWorkspacePaths(process.cwd());
        await printRequiredJson<UpgradePlan>(upgradePlanPath, 'Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first', output, (p) => formatUpgradeSummary(p, true));
        return;
      }
      if (args[0] === 'diagnostics') {
        const { upgradeDiagnosticsPath } = getWorkspacePaths(process.cwd());
        await printRequiredJson<UpgradeDiagnostics>(upgradeDiagnosticsPath, 'Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first', output, formatUpgradeDiagnostics);
        return;
      }
      if (args.length < 2) throw new Error('Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json [--compact]]');
      const [blockId, targetVersion] = args;
      const { upgradePlan } = await upgradeWorkspace(process.cwd(), blockId, targetVersion, { dryRun: !!opts.dryRun });
      printJsonOrText(upgradePlan, output, (p) => formatUpgradeSummary(p, !!opts.dryRun));
    });

  addJsonFlags(modeCommand(program.command('lock')))
    .description('Lock project')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (cmd.args[0] === 'inspect') {
        const lockPath = await resolveWorkspaceLockPath(process.cwd());
        await printRequiredJson<LockFile>(lockPath, 'Graph lock not found; run platform lock first', output, formatLockInspect);
        return;
      }
      await lockWorkspace(process.cwd());
      console.log('Locked project');
    });

  addJsonFlags(modeCommand(program.command('explain')))
    .description('Explain project')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (cmd.args[0] === 'graph') {
        await printWorkspaceJson<import('../shared/explain-types.ts').ExplainGraph>(
          process.cwd(), (p) => p.explainGraphPath, 'Explain graph not found; run platform explain first', output, formatExplainGraphInspect
        );
        return;
      }
      const { graph, reviewSummary } = await explainWorkspace(process.cwd());
      printJsonOrText({ graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) }, output, (s) => formatExplainSummary(s.graph, s.reviewSummary));
    });

  addJsonFlags(modeCommand(program.command('artifacts')))
    .description('Manage CI artifacts')
    .option('--paths', 'List artifact paths')
    .option('--kind <kind>', 'Filter by artifact kind')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      if (cmd.args[0] === 'manifest' || opts.manifest) {
        await printWorkspaceJson<import('../shared/ci-artifact-types.ts').CiArtifactManifest>(
          process.cwd(), (p) => p.ciArtifactsPath, 'Artifact manifest not found; run platform artifacts --json first', output, formatCiArtifactManifest
        );
        return;
      }
      if (opts.paths) {
        const manifest = await buildCiArtifactManifest(process.cwd());
        const kind = opts.kind as CiArtifactKind | undefined;
        const contract = buildArtifactUploadPathContract(manifest, kind);
        printJsonOrText(contract, output, (c) => c.paths.join('\n'));
        return;
      }
      const { manifest } = await writeWorkspaceArtifacts(process.cwd());
      console.log(formatJson(manifest, output));
    });

  addJsonFlags(modeCommand(program.command('workbench')))
    .description('Workbench operations')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const report = await applyWorkbenchMutations(process.cwd());
      printJsonOrText(report, output, (r) => {
        const lines = [
          `Workbench mutations ${r.status}; files=${r.mutationFileCount}; applied=${r.appliedCount}; skipped=${r.skippedCount}`,
          `target: ${r.targetPath}`
        ];
        for (const m of r.mutations) lines.push(`Mutation ${m.id}: ${m.kind}; ${m.status}; ${m.detail}`);
        return lines.join('\n');
      });
    });

  addJsonFlags(program.command('doctor'))
    .description('Check environment readiness')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const report = await getDoctorReport(process.cwd());
      printJsonOrText(report, output, formatDoctorReport);
    });

  const deps = program.command('deps').description('Dependency management');
  addJsonFlags(deps.command('status')).action(async (opts: Record<string, unknown>) => {
    const status = await getDependencyEnvironmentStatus(process.cwd());
    printJsonOrText(status, jsonOpts(opts), formatDependencyEnvironmentStatus);
  });
  addJsonFlags(deps.command('warmup')).action(async (opts: Record<string, unknown>) => {
    const status = await warmupDependencyEnvironment(process.cwd());
    printJsonOrText(status, jsonOpts(opts), formatDependencyEnvironmentStatus);
  });
  addJsonFlags(deps.command('relink')).action(async (opts: Record<string, unknown>) => {
    const status = await relinkProjectDependencies(process.cwd());
    printJsonOrText(status, jsonOpts(opts), formatDependencyEnvironmentStatus);
  });
  deps.command('clean')
    .option('--project', 'Clean project deps')
    .option('--shared', 'Clean shared deps')
    .option('--bun-cache', 'Clean Bun cache')
    .option('--all', 'Clean all')
    .option('--force', 'Force clean')
    .action(async (opts: Record<string, unknown>) => {
      const options = opts as DependencyCleanOptions;
      if (options.all && !options.force) throw new Error('Usage: platform deps clean --all --force');
      if (!options.all && options.force) throw new Error('Usage: platform deps clean --all --force');
      const removed = await cleanDependencyEnvironment(process.cwd(), options);
      console.log(`Cleaned ${removed.length} dependency paths`);
    });

  addJsonFlags(program.command('reference')).action(async (opts: Record<string, unknown>, cmd: Command) => {
    const output = jsonOpts(opts);
    const report = await buildReferenceCheckReport();
    printJsonOrText(report, output, formatReferenceCheck);
    assertReferenceCheckClean(report);
  });

  addJsonFlags(modeCommand(program.command('benchmark'))).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    printJsonOrText(buildBenchmarkTaskSuiteContract(), output, formatBenchmarkTaskSuiteContract);
  });

  addJsonFlags(modeCommand(program.command('test'))).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    printJsonOrText(buildTestBudgetContract(), output, formatTestBudgetContract);
  });

  addJsonFlags(modeCommand(program.command('policy')))
    .description('Policy inspection')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const mode = cmd.args[0];
      const { policyReportPath } = getWorkspacePaths(process.cwd());
      const report = await readRequiredJson<PolicyReport>(policyReportPath, 'Policy report not found; run platform verify first');
      if (mode === 'sources') {
        printJsonOrText(buildPolicySourceInspect(report), output, formatPolicySources);
        return;
      }
      printJsonOrText(report, output, (v) => formatPolicyReport(buildReviewPolicySummary(v)));
    });

  addJsonFlags(modeCommand(program.command('acceptance')))
    .description('Acceptance inspection')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const mode = cmd.args[0];
      const { acceptanceCoveragePath } = getWorkspacePaths(process.cwd());
      const report = await readRequiredJson<AcceptanceCoverageReport>(acceptanceCoveragePath, 'Acceptance coverage report not found; run platform verify first');
      if (mode === 'blocks' || mode === 'slots') {
        printJsonOrText(buildAcceptanceTargetInspect(report, mode), output, formatAcceptanceTargets);
        return;
      }
      printJsonOrText(report, output, formatAcceptanceCoverage);
    });

  addJsonFlags(modeCommand(program.command('runtime')))
    .description('Runtime inspection')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const mode = cmd.args[0];
      const { runtimeReportPath } = getWorkspacePaths(process.cwd());
      const report = await readRequiredJson<RuntimeVerificationLaneReport>(runtimeReportPath, 'Runtime report not found; run platform verify first');
      if (mode === 'steps') {
        printJsonOrText(buildRuntimeStepsInspect(report), output, formatRuntimeStepsInspect);
        return;
      }
      printJsonOrText(report, output, formatRuntimeReport);
    });

  addJsonFlags(modeCommand(program.command('verification')))
    .description('Verification inspection')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      await printWorkspaceJson<VerificationReport>(process.cwd(), (p) => p.verificationReportPath, 'Verification report not found', output, formatVerificationReport);
    });

  addJsonFlags(modeCommand(program.command('provenance')))
    .description('Provenance inspection')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const provenancePath = await resolveWorkspaceProvenancePath(process.cwd());
      await printRequiredJson<ProvenanceFile>(provenancePath, 'Provenance registry not found', output, formatProvenanceRegistry);
    });

  addJsonFlags(modeCommand(program.command('review')))
    .description('Review inspection')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const mode = cmd.args[0];
      const { reviewSummaryPath } = getWorkspacePaths(process.cwd());
      const summary = await readRequiredJson<ReviewSummary>(reviewSummaryPath, 'Review summary not found; run platform explain first');
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

  addJsonFlags(modeCommand(program.command('demo'))).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const checklist = await buildDemoChecklist(process.cwd());
    printJsonOrText(checklist, output, formatDemoChecklist);
  });

  addJsonFlags(modeCommand(program.command('contract')))
    .description('Contract inspection')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const output = jsonOpts(opts);
      const kind = cmd.args[0];
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
      throw new Error('Usage: platform contract <freeze|errors|ci> [--json [--compact]]');
    });

  addJsonFlags(modeCommand(program.command('install'))).action(async (opts: Record<string, unknown>) => {
    await printWorkspaceJson<InstallManifestEntry[]>(process.cwd(), (p) => p.installManifestPath, 'Install manifest not found; run platform compose first', jsonOpts(opts), formatInstallManifest);
  });

  addJsonFlags(modeCommand(program.command('blocks'))).action(async (opts: Record<string, unknown>) => {
    await printWorkspaceJson<BlockUsageMap>(process.cwd(), (p) => p.blockUsageMapPath, 'Block usage map not found; run platform compose first', jsonOpts(opts), formatBlockUsageMap);
  });

  addJsonFlags(modeCommand(program.command('postgres'))).action(async (opts: Record<string, unknown>) => {
    await printWorkspaceJson<PostgresContract>(process.cwd(), (p) => p.postgresContractPath, 'Postgres contract not found; run platform compose first', jsonOpts(opts), formatPostgresContract);
  });
}
