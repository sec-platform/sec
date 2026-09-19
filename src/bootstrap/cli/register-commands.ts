import type { Command } from 'commander';
import { TEXT_BYTE_ANOMALIES, TEXT_BYTE_CLASSIFICATIONS } from '../../adapters/runtime-state/text-byte-census.ts';
import { admitTextByteCensusThreshold, projectTextByteCensusReport, textByteCensusThresholdMatched } from '../../application/text-byte-census.ts';
import { projectWorktreeSettlementReceipt } from '../../application/worktree-settlement.ts';
import { buildBenchmarkTaskCatalog, formatBenchmarkTaskCatalog } from '../../adapters/verification/platform/benchmark/catalog.ts';
import { addJsonFlags, jsonOpts, usageError } from '../../entry/cli/command-options.ts';
import { registerReferenceCommands } from '../../entry/cli/register-reference-commands.ts';
import { registerVerificationToolingCommands } from '../../entry/cli/register-verification-tooling-commands.ts';
import { registerTextCommands } from '../../entry/cli/register-text-commands.ts';
import { registerEnvironmentCommands } from '../../entry/cli/register-environment-commands.ts';
import { registerDependencyCommands } from '../../entry/cli/register-dependency-commands.ts';
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


  registerDependencyCommands(program, {
    doctor: async ({ workspaceRoot, output }) => {
      const domain = await loadDependencyEnvironment();
      const report = await domain.getDoctorReport(workspaceRoot);
      printJsonOrText(report, output, domain.formatDoctorReport);
    },
    status: async ({ workspaceRoot, output }) => {
      const domain = await loadDependencyEnvironment();
      const status = await domain.getDependencyEnvironmentStatus(workspaceRoot);
      printJsonOrText(status, output, domain.formatDependencyEnvironmentStatus);
    },
    freshness: async ({ output }) => {
      const domain = await loadDependencyEnvironment();
      const status = await domain.getDependencyFreshness();
      printJsonOrText(status, output, domain.formatDependencyFreshnessDecision);
    },
    warmup: async ({ workspaceRoot, output }) => {
      const domain = await loadDependencyEnvironment();
      const status = await domain.warmupDependencyEnvironment(workspaceRoot);
      printJsonOrText(status, output, domain.formatDependencyEnvironmentStatus);
    },
    relink: async ({ workspaceRoot, output }) => {
      const domain = await loadDependencyEnvironment();
      const status = await domain.relinkProjectDependencies(workspaceRoot);
      printJsonOrText(status, output, domain.formatDependencyEnvironmentStatus);
    },
    clean: async ({ workspaceRoot, request }) => {
      const domain = await loadDependencyEnvironment();
      const removed = await domain.cleanDependencyEnvironment(workspaceRoot, request);
      console.log(`Cleaned ${removed.length} dependency paths`);
    }
  });

  registerReferenceCommands(program, {
    check: async ({ output }) => {
      const domain = await loadReferenceCheckDomain();
      const report = await domain.buildReferenceCheckReport();
      const command = platformCommand('reference', 'check', '--json');
      printJsonOrText(
        { ...report, command },
        output,
        () => formatReferenceCheck(report, command)
      );
      assertReferenceCheckClean(report);
    }
  });

  registerVerificationToolingCommands(program, {
    benchmarkCatalog: ({ output }) => {
      printJsonOrText(
        buildBenchmarkTaskCatalog(),
        output,
        formatBenchmarkTaskCatalog
      );
    },
    testBudget: async ({ output }) => {
      const domain = await loadTestBudgetDomain();
      const { issueCurrentTestBudgetProjection } =
        await import('../../adapters/self-hosting/development/runner/test-runner.ts');
      const contract = domain.buildTestBudgetContract(
        await issueCurrentTestBudgetProjection()
      );
      printJsonOrText(contract, output, domain.formatTestBudgetContract);
    }
  });
  registerInspectionCommands(program);


  registerTextCommands(program, {
    census: async ({ output, failOn }) => {
      const thresholdAdmission = admitTextByteCensusThreshold(
        failOn,
        TEXT_BYTE_CLASSIFICATIONS
      );
      if (thresholdAdmission.status === 'rejected') {
        throw usageError(
          `Text census --fail-on must be any or one of: ${TEXT_BYTE_CLASSIFICATIONS.join(', ')}`
        );
      }
      const workspaceRoot = process.cwd();
      const report = await runWithOptionalSpinner(
        'Scanning text bytes',
        output,
        () => runCensus(workspaceRoot)
      );
      printJsonOrText(
        report,
        output,
        value => formatTextByteCensus(projectTextByteCensusReport(value, {
          classifications: TEXT_BYTE_CLASSIFICATIONS,
          anomalies: TEXT_BYTE_ANOMALIES
        }))
      );
      const failed = thresholdAdmission.status === 'accepted'
        && textByteCensusThresholdMatched(report, thresholdAdmission.threshold);
      if (failed) {
        throw new Error(
          `Text census --fail-on ${thresholdAdmission.threshold} threshold matched.`
        );
      }
    }
  });

  registerEnvironmentCommands(program, {
    containerEngine: async ({ workspaceRoot, output, start }) => {
      const result = await observeLocalContainerEngineReadiness({
        cwd: workspaceRoot,
        mode: start ? 'ensure-started' : 'observe'
      });
      printJsonOrText(
        result,
        output,
        value => value.status === 'ready'
          ? `Container Engine ready: ${value.endpoint.contextName} (${value.endpoint.daemonId})`
          : `Container Engine unavailable: ${value.reason} (${value.phase})`
      );
      if (result.status !== 'ready') process.exitCode = 1;
    },
    settle: async ({ workspaceRoot, output, fix }) => {
      const receipt = await runWithOptionalSpinner(
        'Settling worktree',
        output,
        () => runSettlement(workspaceRoot, { fix })
      );
      printJsonOrText(
        receipt,
        output,
        value => formatWorktreeSettlement(projectWorktreeSettlementReceipt(value))
      );
      if (receipt.status !== 'settled') {
        throw new Error(`Worktree not settled: ${receipt.status}`);
      }
    }
  });
}
