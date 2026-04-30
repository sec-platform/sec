import type { AcceptanceCoverageReport } from '../shared/acceptance-types.ts';
import {
  buildBenchmarkTaskSuiteContract,
  formatBenchmarkTaskSuiteContract
} from '../shared/benchmark-contract.ts';
import { CI_ARTIFACT_FILES } from '../shared/ci-artifact-contract.ts';
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
import {
  cleanDependencyEnvironment,
  formatDependencyEnvironmentStatus,
  getDependencyEnvironmentStatus,
  relinkProjectDependencies,
  warmupDependencyEnvironment
} from '../shared/dependency-environment.ts';
import {
  buildErrorProtocolContract,
  formatErrorProtocolContract
} from '../shared/error-protocol-contract.ts';
import { pathExists } from '../shared/fs.ts';
import { getWorkspacePaths, resolveWorkspaceProvenancePath } from '../shared/paths.ts';
import { platformCommand } from '../shared/platform-command.ts';
import type { PolicyReport } from '../shared/policy-types.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import {
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../shared/reference-check.ts';
import { buildE2eMatrix } from '../shared/review-matrix.ts';
import type { ReviewSummary } from '../shared/review-types.ts';
import {
  buildTestBudgetContract,
  formatTestBudgetContract
} from '../shared/test-budget-contract.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../shared/verification-types.ts';
import {
  parseAcceptanceArgs,
  parseBenchmarkOutputArgs,
  parseBlocksOutputArgs,
  parseContractOutputArgs,
  parseDemoOutputArgs,
  parseDepsCleanArgs,
  parseDepsOutputArgs,
  parseInstallOutputArgs,
  parsePolicyArgs,
  parsePostgresOutputArgs,
  parseProvenanceOutputArgs,
  parseReferenceOutputArgs,
  parseReviewArgs,
  parseRuntimeOutputArgs,
  parseTestOutputArgs,
  parseVerificationOutputArgs
} from './args.ts';
import { printRequiredJson, printRequiredWorkspaceJson, readRequiredJson, requireSubcommand } from './command-utils.ts';
import { printJsonOrText } from './format-utils.ts';
import {
  buildAcceptanceTargetInspect,
  buildPolicySourceInspect,
  buildPolicySummary,
  buildReviewDiagnosticsInspect,
  buildRuntimeStepsInspect,
  formatAcceptanceCoverage,
  formatAcceptanceTargets,
  formatBlockUsageMap,
  formatDemoChecklist,
  formatE2eMatrix,
  formatInstallManifest,
  formatPolicyReport,
  formatPolicySources,
  formatPostgresContract,
  formatProvenanceRegistry,
  formatReviewDiagnosticsInspect,
  formatReviewSummaryContract,
  formatRuntimeReport,
  formatRuntimeStepsInspect,
  formatVerificationReport,
  type BlockUsageMap,
  type DemoChecklist,
  type DemoChecklistItem,
  type InstallManifestEntry,
  type PostgresContract
} from './formatters.ts';
import {
  BENCHMARK_USAGE,
  BLOCKS_USAGE,
  CONTRACT_USAGE,
  DEMO_USAGE,
  DEPS_USAGE,
  INSTALL_USAGE,
  POSTGRES_USAGE,
  PROVENANCE_USAGE,
  REFERENCE_USAGE,
  TEST_USAGE,
  VERIFICATION_USAGE
} from './usage.ts';

async function buildDemoChecklist(workspaceRoot: string): Promise<DemoChecklist> {
  const paths = getWorkspacePaths(workspaceRoot);
  const items: DemoChecklistItem[] = await Promise.all([
    {
      id: 'verification-report',
      artifactPath: CI_ARTIFACT_FILES.verificationReport,
      absolutePath: paths.verificationReportPath,
      command: platformCommand('verify', '--lane', 'all')
    },
    {
      id: 'runtime-report',
      artifactPath: CI_ARTIFACT_FILES.runtimeReport,
      absolutePath: paths.runtimeReportPath,
      command: platformCommand('verify', '--lane', 'all')
    },
    {
      id: 'policy-report',
      artifactPath: CI_ARTIFACT_FILES.policyReport,
      absolutePath: paths.policyReportPath,
      command: platformCommand('verify')
    },
    {
      id: 'acceptance-coverage',
      artifactPath: CI_ARTIFACT_FILES.acceptanceCoverage,
      absolutePath: paths.acceptanceCoveragePath,
      command: platformCommand('verify')
    },
    {
      id: 'graph-lock',
      artifactPath: CI_ARTIFACT_FILES.graphLock,
      absolutePath: paths.lockPath,
      command: platformCommand('lock')
    },
    {
      id: 'provenance-registry',
      artifactPath: CI_ARTIFACT_FILES.provenance,
      absolutePath: paths.provenancePath,
      command: platformCommand('adapt')
    },
    {
      id: 'explain-graph',
      artifactPath: CI_ARTIFACT_FILES.explainGraph,
      absolutePath: paths.explainGraphPath,
      command: platformCommand('explain')
    },
    {
      id: 'review-summary',
      artifactPath: CI_ARTIFACT_FILES.reviewSummary,
      absolutePath: paths.reviewSummaryPath,
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
    nextCommand: missingCount === 0 ? 'npm run demo:closed-loop' : 'npm run demo:quickstart'
  };
}

export async function runDepsCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const [subcommand, ...subArgs] = args;
  switch (subcommand) {
    case 'status': {
      const outputArgs = parseDepsOutputArgs(subArgs);
      const status = await getDependencyEnvironmentStatus(cwd);
      printJsonOrText(status, outputArgs, formatDependencyEnvironmentStatus);
      return;
    }
    case 'warmup': {
      const outputArgs = parseDepsOutputArgs(subArgs);
      const status = await warmupDependencyEnvironment(cwd);
      printJsonOrText(status, outputArgs, formatDependencyEnvironmentStatus);
      return;
    }
    case 'relink': {
      if (subArgs[0] !== 'project') {
        throw new Error(DEPS_USAGE);
      }
      const outputArgs = parseDepsOutputArgs(subArgs.slice(1));
      const status = await relinkProjectDependencies(cwd);
      printJsonOrText(status, outputArgs, formatDependencyEnvironmentStatus);
      return;
    }
    case 'clean': {
      const cleanOptions = parseDepsCleanArgs(subArgs);
      const removed = await cleanDependencyEnvironment(cwd, cleanOptions);
      console.log(`Cleaned ${removed.length} dependency paths`);
      return;
    }
    default:
      throw new Error(DEPS_USAGE);
  }
}

export async function runReferenceCommand(args: string[]): Promise<void> {
  const outputArgs = parseReferenceOutputArgs(requireSubcommand(args, 'check', REFERENCE_USAGE));
  const report = await buildReferenceCheckReport();

  printJsonOrText(report, outputArgs, formatReferenceCheck);

  assertReferenceCheckClean(report);
}

export async function runBenchmarkCommand(args: string[]): Promise<void> {
  const outputArgs = parseBenchmarkOutputArgs(requireSubcommand(args, 'suite', BENCHMARK_USAGE));
  const contract = buildBenchmarkTaskSuiteContract();
  printJsonOrText(contract, outputArgs, formatBenchmarkTaskSuiteContract);
}

export async function runTestCommand(args: string[]): Promise<void> {
  const outputArgs = parseTestOutputArgs(requireSubcommand(args, 'budget', TEST_USAGE));
  const contract = buildTestBudgetContract();
  printJsonOrText(contract, outputArgs, formatTestBudgetContract);
}

export async function runPolicyCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const policyArgs = parsePolicyArgs(args);
  const { policyReportPath } = getWorkspacePaths(cwd);
  const report = await readRequiredJson<PolicyReport>(policyReportPath, 'Policy report not found; run platform verify first');
  if (policyArgs.mode === 'sources') {
    const sourceInspect = buildPolicySourceInspect(report);
    printJsonOrText(sourceInspect, policyArgs, formatPolicySources);
    return;
  }

  printJsonOrText(report, policyArgs, (value) => formatPolicyReport(buildPolicySummary(value)));
}

export async function runAcceptanceCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const acceptanceArgs = parseAcceptanceArgs(args);
  const { acceptanceCoveragePath } = getWorkspacePaths(cwd);
  const report = await readRequiredJson<AcceptanceCoverageReport>(
    acceptanceCoveragePath,
    'Acceptance coverage report not found; run platform verify first'
  );
  if (acceptanceArgs.mode === 'blocks' || acceptanceArgs.mode === 'slots') {
    const targetInspect = buildAcceptanceTargetInspect(report, acceptanceArgs.mode);
    printJsonOrText(targetInspect, acceptanceArgs, formatAcceptanceTargets);
    return;
  }

  printJsonOrText(report, acceptanceArgs, formatAcceptanceCoverage);
}

export async function runRuntimeCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parseRuntimeOutputArgs(args);
  const { runtimeReportPath } = getWorkspacePaths(cwd);
  const report = await readRequiredJson<RuntimeVerificationLaneReport>(runtimeReportPath, 'Runtime report not found; run platform verify first');
  if (outputArgs.mode === 'steps') {
    const inspect = buildRuntimeStepsInspect(report);
    printJsonOrText(inspect, outputArgs, formatRuntimeStepsInspect);
    return;
  }

  printJsonOrText(report, outputArgs, formatRuntimeReport);
}

export async function runInstallCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parseInstallOutputArgs(requireSubcommand(args, 'manifest', INSTALL_USAGE));
  await printRequiredWorkspaceJson<InstallManifestEntry[]>(
    cwd,
    (paths) => paths.installManifestPath,
    'Install manifest not found; run platform compose first',
    outputArgs,
    formatInstallManifest
  );
}

export async function runBlocksCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parseBlocksOutputArgs(requireSubcommand(args, 'usage', BLOCKS_USAGE));
  await printRequiredWorkspaceJson<BlockUsageMap>(
    cwd,
    (paths) => paths.blockUsageMapPath,
    'Block usage map not found; run platform compose first',
    outputArgs,
    formatBlockUsageMap
  );
}

export async function runPostgresCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parsePostgresOutputArgs(requireSubcommand(args, 'contract', POSTGRES_USAGE));
  await printRequiredWorkspaceJson<PostgresContract>(
    cwd,
    (paths) => paths.postgresContractPath,
    'Postgres contract not found; run platform compose first',
    outputArgs,
    formatPostgresContract
  );
}

export async function runVerificationCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parseVerificationOutputArgs(requireSubcommand(args, 'report', VERIFICATION_USAGE));
  await printRequiredWorkspaceJson<VerificationReport>(
    cwd,
    (paths) => paths.verificationReportPath,
    'Verification report not found; run platform verify first',
    outputArgs,
    formatVerificationReport
  );
}

export async function runProvenanceCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parseProvenanceOutputArgs(requireSubcommand(args, 'registry', PROVENANCE_USAGE));
  const readableProvenancePath = await resolveWorkspaceProvenancePath(cwd);
  await printRequiredJson<ProvenanceFile>(
    readableProvenancePath,
    'Provenance registry not found; run platform adapt or lock first',
    outputArgs,
    formatProvenanceRegistry
  );
}

export async function runReviewCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const reviewArgs = parseReviewArgs(args);
  const { reviewSummaryPath } = getWorkspacePaths(cwd);
  const summary = await readRequiredJson<ReviewSummary>(reviewSummaryPath, 'Review summary not found; run platform explain first');
  if (reviewArgs.mode === 'matrix') {
    const matrix = buildE2eMatrix(summary);
    printJsonOrText(matrix, reviewArgs, formatE2eMatrix);
    return;
  }

  if (reviewArgs.mode === 'diagnostics') {
    const diagnostics = buildReviewDiagnosticsInspect(summary);
    printJsonOrText(diagnostics, reviewArgs, formatReviewDiagnosticsInspect);
    return;
  }

  printJsonOrText(summary, reviewArgs, formatReviewSummaryContract);
}

export async function runDemoCommand(args: string[], cwd = process.cwd()): Promise<void> {
  const outputArgs = parseDemoOutputArgs(requireSubcommand(args, 'checklist', DEMO_USAGE));
  const checklist = await buildDemoChecklist(cwd);
  printJsonOrText(checklist, outputArgs, formatDemoChecklist);
}

export async function runContractCommand(args: string[]): Promise<void> {
  const [contractKind, ...outputRawArgs] = args;
  if (contractKind !== 'freeze' && contractKind !== 'errors' && contractKind !== 'ci') {
    throw new Error(CONTRACT_USAGE);
  }

  const outputArgs = parseContractOutputArgs(outputRawArgs);
  if (contractKind === 'freeze') {
    const contract = buildContractFreezeContract();
    printJsonOrText(contract, outputArgs, formatContractFreezeContract);
    return;
  }

  if (contractKind === 'ci') {
    const contract = buildCiContract();
    printJsonOrText(contract, outputArgs, formatCiContract);
    return;
  }

  const contract = buildErrorProtocolContract();
  printJsonOrText(contract, outputArgs, formatErrorProtocolContract);
}

