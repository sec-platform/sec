import type { Command } from 'commander';
import { TEXT_BYTE_ANOMALIES, TEXT_BYTE_CLASSIFICATIONS } from '../../adapters/runtime-state/text-byte-census.ts';
import { admitTextByteCensusThreshold, projectTextByteCensusReport, textByteCensusThresholdMatched } from '../../application/text-byte-census.ts';
import { projectWorktreeSettlementReceipt } from '../../application/worktree-settlement.ts';
import type { DependencyCleanOptions } from '../../adapters/toolchain/dependencies/environment.ts';
import { buildBenchmarkTaskCatalog, formatBenchmarkTaskCatalog } from '../../adapters/verification/platform/benchmark/catalog.ts';
import { addJsonFlags, commandPath, jsonOpts, usageError } from '../../entry/cli/command-options.ts';
import { platformCommand } from '../../adapters/verification/platform/sec-command.ts';
import { printJsonOrText } from '../../entry/cli/format-utils.ts';
import { formatTextByteCensus } from '../../entry/cli/text-byte-census.ts';
import { formatWorktreeSettlement } from '../../entry/cli/worktree-settlement.ts';
import { loadDependencyEnvironmentDomain, loadReferenceCheckDomain, loadTestBudgetDomain, observeLocalContainerEngineReadiness, runCensus, runSettlement } from './lazy-command-domains.ts';
import { registerInspectionCommands } from './register-inspection-commands.ts';
import { registerWorkspaceCommands } from './register-workspace-commands.ts';
import { assertReferenceCheckClean } from '../../application/reference-check.ts';
import { formatReferenceCheck } from '../../entry/reference-check.ts';
import { runWithOptionalSpinner } from './command-progress.ts';

type DependencyEnvironmentModule = typeof import('../../adapters/toolchain/dependencies/environment.ts');

export type DependencyEnvironmentCommandDomain = Pick<
  DependencyEnvironmentModule,
  | 'cleanDependencyEnvironment'
  | 'formatDependencyEnvironmentStatus'
  | 'formatDependencyFreshnessDecision'
  | 'formatDoctorReport'
  | 'getDependencyEnvironmentStatus'
  | 'getDependencyFreshness'
  | 'getDoctorReport'
  | 'relinkProjectDependencies'
  | 'warmupDependencyEnvironment'
>;

export type CliCommandDomainLoaders = Readonly<{
  loadDependencyEnvironmentDomain?: () => Promise<DependencyEnvironmentCommandDomain>;
}>;

export function registerCommands(
  program: Command,
  domainLoaders: CliCommandDomainLoaders = {}
): void {
  const loadDependencyEnvironment = domainLoaders.loadDependencyEnvironmentDomain
      ?? loadDependencyEnvironmentDomain;
  registerWorkspaceCommands(program);


  addJsonFlags(program.command('doctor'))
    .description('Check environment readiness')
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const output = jsonOpts(opts);
      const domain = await loadDependencyEnvironment();
      const report = await domain.getDoctorReport(workspaceRoot);
      printJsonOrText(report, output, domain.formatDoctorReport);
    });

  const deps = program.command('deps').description('Dependency management');
  addJsonFlags(deps.command('status')).action(async (opts: Record<string, unknown>) => {
    const workspaceRoot = process.cwd();
    const output = jsonOpts(opts);
    const domain = await loadDependencyEnvironment();
    const status = await domain.getDependencyEnvironmentStatus(workspaceRoot);
    printJsonOrText(status, output, domain.formatDependencyEnvironmentStatus);
  });
  addJsonFlags(deps.command('freshness')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const domain = await loadDependencyEnvironment();
    const status = await domain.getDependencyFreshness();
    printJsonOrText(status, output, domain.formatDependencyFreshnessDecision);
  });
  addJsonFlags(deps.command('warmup')).action(async (opts: Record<string, unknown>) => {
    const workspaceRoot = process.cwd();
    const output = jsonOpts(opts);
    const domain = await loadDependencyEnvironment();
    const status = await domain.warmupDependencyEnvironment(workspaceRoot);
    printJsonOrText(status, output, domain.formatDependencyEnvironmentStatus);
  });
  addJsonFlags(deps.command('relink')).action(async (opts: Record<string, unknown>) => {
    const workspaceRoot = process.cwd();
    const output = jsonOpts(opts);
    const domain = await loadDependencyEnvironment();
    const status = await domain.relinkProjectDependencies(workspaceRoot);
    printJsonOrText(status, output, domain.formatDependencyEnvironmentStatus);
  });
  deps.command('clean')
    .option('--project', 'Clean project deps')
    .option('--shared', 'Clean shared deps')
    .option('--bun-cache', 'Clean Bun cache')
    .option('--all', 'Clean all')
    .option('--force', 'Force clean')
    .action(async (opts: Record<string, unknown>, cmd: Command) => {
      const options: DependencyCleanOptions = Object.freeze({
        project: opts.project as boolean | undefined, shared: opts.shared as boolean | undefined,
        bunCache: opts.bunCache as boolean | undefined, all: opts.all as boolean | undefined,
        force: opts.force as boolean | undefined
      });
      if (options.all && !options.force) throw usageError(`Usage: ${commandPath(cmd)} --all --force`);
      if (!options.all && options.force) throw usageError(`Usage: ${commandPath(cmd)} --all --force`);
      const workspaceRoot = process.cwd();
      const domain = await loadDependencyEnvironment();
      const removed = await domain.cleanDependencyEnvironment(workspaceRoot, options);
      console.log(`Cleaned ${removed.length} dependency paths`);
    });

  const referenceCmd = program.command('reference').description('Reference workspace operations');
  addJsonFlags(referenceCmd.command('check')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const domain = await loadReferenceCheckDomain();
    const report = await domain.buildReferenceCheckReport();
    const command = platformCommand('reference', 'check', '--json');
    printJsonOrText({ ...report, command }, output, () => formatReferenceCheck(report, command));
    assertReferenceCheckClean(report);
  });

  const benchmarkCmd = program.command('benchmark');
  addJsonFlags(benchmarkCmd.command('catalog')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    printJsonOrText(buildBenchmarkTaskCatalog(), output, formatBenchmarkTaskCatalog);
  });

  addJsonFlags(program.command('test').command('budget')).action(async (opts: Record<string, unknown>) => {
    const output = jsonOpts(opts);
    const domain = await loadTestBudgetDomain();
    const { issueCurrentTestBudgetProjection } = await import('../../adapters/self-hosting/development/runner/test-runner.ts');
    const contract = domain.buildTestBudgetContract(await issueCurrentTestBudgetProjection());
    printJsonOrText(contract, output, domain.formatTestBudgetContract);
  });
  registerInspectionCommands(program);


  const textCmd = program.command('text').description('Text byte policy inspection');
  addJsonFlags(textCmd.command('census'))
    .description('Scan tracked Git blobs and classify by .gitattributes policy')
    .option('--fail-on <threshold>', 'Exit non-zero for any fail-closed result or one classification')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const thresholdAdmission = admitTextByteCensusThreshold(
        opts.failOn as string | undefined,
        TEXT_BYTE_CLASSIFICATIONS
      );
      if (thresholdAdmission.status === 'rejected') {
        throw usageError(`Text census --fail-on must be any or one of: ${TEXT_BYTE_CLASSIFICATIONS.join(', ')}`);
      }
      const workspaceRoot = process.cwd();
      const report = await runWithOptionalSpinner('Scanning text bytes', output, () => runCensus(workspaceRoot));
      printJsonOrText(report, output, (value) => formatTextByteCensus(projectTextByteCensusReport(value, {
        classifications: TEXT_BYTE_CLASSIFICATIONS,
        anomalies: TEXT_BYTE_ANOMALIES
      })));
      const failed = thresholdAdmission.status === 'accepted'
        && textByteCensusThresholdMatched(report, thresholdAdmission.threshold);
      if (failed) throw new Error(`Text census --fail-on ${thresholdAdmission.threshold} threshold matched.`);
    });

  const envCmd = program.command('environment').description('Environment settlement inspection');
  addJsonFlags(envCmd.command('container-engine'))
    .description('Observe the retained local Container Engine, optionally starting Docker Desktop')
    .option('--start', 'Issue one bounded Docker Desktop start intent when the endpoint is unavailable')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const result = await observeLocalContainerEngineReadiness({
        cwd: process.cwd(),
        mode: opts.start ? 'ensure-started' : 'observe'
      });
      printJsonOrText(
        result,
        output,
        (value) => value.status === 'ready'
          ? `Container Engine ready: ${value.endpoint.contextName} (${value.endpoint.daemonId})`
          : `Container Engine unavailable: ${value.reason} (${value.phase})`
      );
      if (result.status !== 'ready') process.exitCode = 1;
    });
  addJsonFlags(envCmd.command('settle'))
    .description('Non-destructive worktree settlement preflight')
    .option('--fix', 'Re-checkout governed text files to enforce canonical LF materialization')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const workspaceRoot = process.cwd();
      const fix = !!opts.fix;
      const receipt = await runWithOptionalSpinner('Settling worktree', output, () => runSettlement(workspaceRoot, { fix }));
      printJsonOrText(receipt, output, (value) => formatWorktreeSettlement(projectWorktreeSettlementReceipt(value)));
      if (receipt.status !== 'settled') {
        throw new Error(`Worktree not settled: ${receipt.status}`);
      }
    });
}
