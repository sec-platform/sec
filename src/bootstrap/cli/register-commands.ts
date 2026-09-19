import type { Command } from 'commander';
import { TEXT_BYTE_ANOMALIES, TEXT_BYTE_CLASSIFICATIONS } from '../../adapters/runtime-state/text-byte-census.ts';
import { admitTextByteCensusThreshold, projectTextByteCensusReport, textByteCensusThresholdMatched } from '../../application/text-byte-census.ts';
import { projectWorktreeSettlementReceipt } from '../../application/worktree-settlement.ts';
import { buildBenchmarkTaskCatalog, formatBenchmarkTaskCatalog } from '../../adapters/verification/platform/benchmark/catalog.ts';
import {
  bindReferenceCommandHandlers,
  registerReferenceCommands
} from '../../entry/cli/register-reference-commands.ts';
import {
  bindVerificationToolingCommandHandlers,
  registerVerificationToolingCommands
} from '../../entry/cli/register-verification-tooling-commands.ts';
import {
  bindTextCommandHandlers,
  registerTextCommands
} from '../../entry/cli/register-text-commands.ts';
import {
  bindEnvironmentCommandHandlers,
  registerEnvironmentCommands
} from '../../entry/cli/register-environment-commands.ts';
import {
  bindDependencyCommandHandlers,
  registerDependencyCommands
} from '../../entry/cli/register-dependency-commands.ts';
import { platformCommand } from '../../adapters/verification/platform/sec-command.ts';
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


  registerDependencyCommands(program, bindDependencyCommandHandlers({
    doctor: async workspaceRoot => {
      const domain = await loadDependencyEnvironment();
      const value = await domain.getDoctorReport(workspaceRoot);
      return { value, text: domain.formatDoctorReport(value) };
    },
    status: async workspaceRoot => {
      const domain = await loadDependencyEnvironment();
      const value = await domain.getDependencyEnvironmentStatus(workspaceRoot);
      return { value, text: domain.formatDependencyEnvironmentStatus(value) };
    },
    freshness: async () => {
      const domain = await loadDependencyEnvironment();
      const value = await domain.getDependencyFreshness();
      return { value, text: domain.formatDependencyFreshnessDecision(value) };
    },
    warmup: async workspaceRoot => {
      const domain = await loadDependencyEnvironment();
      const value = await domain.warmupDependencyEnvironment(workspaceRoot);
      return { value, text: domain.formatDependencyEnvironmentStatus(value) };
    },
    relink: async workspaceRoot => {
      const domain = await loadDependencyEnvironment();
      const value = await domain.relinkProjectDependencies(workspaceRoot);
      return { value, text: domain.formatDependencyEnvironmentStatus(value) };
    },
    clean: async (workspaceRoot, request) => {
      const domain = await loadDependencyEnvironment();
      const removed = await domain.cleanDependencyEnvironment(workspaceRoot, request);
      return { removedCount: removed.length };
    }
  }));

  registerReferenceCommands(program, bindReferenceCommandHandlers({
    check: async () => {
      const domain = await loadReferenceCheckDomain();
      const report = await domain.buildReferenceCheckReport();
      const command = platformCommand('reference', 'check', '--json');
      return {
        value: { ...report, command },
        text: formatReferenceCheck(report, command),
        assertAccepted: () => assertReferenceCheckClean(report)
      };
    }
  }));

  registerVerificationToolingCommands(
    program,
    bindVerificationToolingCommandHandlers({
      benchmarkCatalog: () => {
        const value = buildBenchmarkTaskCatalog();
        return { value, text: formatBenchmarkTaskCatalog(value) };
      },
      testBudget: async () => {
        const domain = await loadTestBudgetDomain();
        const { issueCurrentTestBudgetProjection } =
          await import('../../adapters/self-hosting/development/runner/test-runner.ts');
        const value = domain.buildTestBudgetContract(
          await issueCurrentTestBudgetProjection()
        );
        return { value, text: domain.formatTestBudgetContract(value) };
      }
    })
  );
  registerInspectionCommands(program);


  registerTextCommands(program, bindTextCommandHandlers({
    admitThreshold: failOn => {
      const admission = admitTextByteCensusThreshold(
        failOn,
        TEXT_BYTE_CLASSIFICATIONS
      );
      return admission.status === 'rejected'
        ? { status: 'rejected' as const, expected: TEXT_BYTE_CLASSIFICATIONS }
        : { status: 'accepted' as const, threshold: admission.threshold };
    },
    runCensus: async (workspaceRoot, threshold) => {
      const value = await runCensus(workspaceRoot);
      return {
        value,
        text: formatTextByteCensus(projectTextByteCensusReport(value, {
          classifications: TEXT_BYTE_CLASSIFICATIONS,
          anomalies: TEXT_BYTE_ANOMALIES
        })),
        thresholdMatched: threshold === undefined
          ? false
          : textByteCensusThresholdMatched(value, threshold)
      };
    },
    progress: runWithOptionalSpinner
  }));

  registerEnvironmentCommands(program, bindEnvironmentCommandHandlers({
    containerEngine: async ({ workspaceRoot, start }) => {
      const value = await observeLocalContainerEngineReadiness({
        cwd: workspaceRoot,
        mode: start ? 'ensure-started' : 'observe'
      });
      return {
        value,
        text: value.status === 'ready'
          ? `Container Engine ready: ${value.endpoint.contextName} (${value.endpoint.daemonId})`
          : `Container Engine unavailable: ${value.reason} (${value.phase})`,
        status: value.status,
        successful: value.status === 'ready'
      };
    },
    settle: async ({ workspaceRoot, fix }) => {
      const value = await runSettlement(workspaceRoot, { fix });
      return {
        value,
        text: formatWorktreeSettlement(projectWorktreeSettlementReceipt(value)),
        status: value.status,
        successful: value.status === 'settled'
      };
    }
  }));
}
