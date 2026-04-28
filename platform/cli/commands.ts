import {
  cleanDependencyEnvironment,
  formatDependencyEnvironmentStatus,
  getDependencyEnvironmentStatus,
  relinkProjectDependencies,
  warmupDependencyEnvironment
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
import { pathExists, readJson } from '../shared/fs.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { buildE2eMatrix } from '../shared/review-matrix.ts';
import type {
  AcceptanceCoverageReport,
  ProvenanceFile,
  ReviewSummary
} from '../shared/types.ts';
import type { PolicyReport } from '../shared/policy-types.ts';
import type { RuntimeVerificationLaneReport, VerificationReport } from '../shared/verification-types.ts';
import {
  ACCEPTANCE_USAGE,
  BENCHMARK_USAGE,
  BLOCKS_USAGE,
  CONTRACT_USAGE,
  DEMO_USAGE,
  DEPS_USAGE,
  INSTALL_USAGE,
  POLICY_USAGE,
  POSTGRES_USAGE,
  PROVENANCE_USAGE,
  REFERENCE_USAGE,
  REVIEW_USAGE,
  RUNTIME_USAGE,
  TEST_USAGE,
  VERIFICATION_USAGE
} from './usage.ts';
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
  parseReviewOutputArgs,
  parseRuntimeOutputArgs,
  parseTestOutputArgs,
  parseVerificationOutputArgs
} from './args.ts';
import {
  buildAcceptanceTargetInspect,
  buildPolicySourceInspect,
  buildPolicySummary,
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

async function buildDemoChecklist(workspaceRoot: string): Promise<DemoChecklist> {
  const paths = getWorkspacePaths(workspaceRoot);
  const items: DemoChecklistItem[] = await Promise.all([
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

export async function runDepsCommand(args: string[]): Promise<void> {
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

export async function runReferenceCommand(args: string[]): Promise<void> {
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

export async function runBenchmarkCommand(args: string[]): Promise<void> {
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

export async function runTestCommand(args: string[]): Promise<void> {
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

export async function runPolicyCommand(args: string[]): Promise<void> {
  const policyArgs = parsePolicyArgs(args);
  const { policyReportPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(policyReportPath))) {
    throw new Error('Policy report not found; run platform verify first');
  }

  const report = await readJson<PolicyReport>(policyReportPath);
  if (policyArgs.mode === 'sources') {
    const sourceInspect = buildPolicySourceInspect(report);
    if (policyArgs.json) {
      console.log(JSON.stringify(sourceInspect, null, policyArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatPolicySources(sourceInspect));
    return;
  }

  if (policyArgs.json) {
    console.log(JSON.stringify(report, null, policyArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatPolicyReport(buildPolicySummary(report)));
}

export async function runAcceptanceCommand(args: string[]): Promise<void> {
  const acceptanceArgs = parseAcceptanceArgs(args);
  const { acceptanceCoveragePath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(acceptanceCoveragePath))) {
    throw new Error('Acceptance coverage report not found; run platform verify first');
  }

  const report = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  if (acceptanceArgs.mode === 'blocks' || acceptanceArgs.mode === 'slots') {
    const targetInspect = buildAcceptanceTargetInspect(report, acceptanceArgs.mode);
    if (acceptanceArgs.json) {
      console.log(JSON.stringify(targetInspect, null, acceptanceArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatAcceptanceTargets(targetInspect));
    return;
  }

  if (acceptanceArgs.json) {
    console.log(JSON.stringify(report, null, acceptanceArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatAcceptanceCoverage(report));
}

export async function runRuntimeCommand(args: string[]): Promise<void> {
  const outputArgs = parseRuntimeOutputArgs(args);
  const { runtimeReportPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(runtimeReportPath))) {
    throw new Error('Runtime report not found; run platform verify first');
  }

  const report = await readJson<RuntimeVerificationLaneReport>(runtimeReportPath);
  if (outputArgs.mode === 'steps') {
    const inspect = buildRuntimeStepsInspect(report);
    if (outputArgs.json) {
      console.log(JSON.stringify(inspect, null, outputArgs.compact ? 0 : 2));
      return;
    }
    console.log(formatRuntimeStepsInspect(inspect));
    return;
  }

  if (outputArgs.json) {
    console.log(JSON.stringify(report, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatRuntimeReport(report));
}

export async function runInstallCommand(args: string[]): Promise<void> {
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

export async function runBlocksCommand(args: string[]): Promise<void> {
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

export async function runPostgresCommand(args: string[]): Promise<void> {
  if (args[0] !== 'contract') {
    throw new Error(POSTGRES_USAGE);
  }

  const outputArgs = parsePostgresOutputArgs(args.slice(1));
  const { postgresContractPath } = getWorkspacePaths(process.cwd());
  if (!(await pathExists(postgresContractPath))) {
    throw new Error('Postgres contract not found; run platform compose first');
  }

  const contract = await readJson<PostgresContract>(postgresContractPath);
  if (outputArgs.json) {
    console.log(JSON.stringify(contract, null, outputArgs.compact ? 0 : 2));
    return;
  }

  console.log(formatPostgresContract(contract));
}

export async function runVerificationCommand(args: string[]): Promise<void> {
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

export async function runProvenanceCommand(args: string[]): Promise<void> {
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

export async function runReviewCommand(args: string[]): Promise<void> {
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

export async function runDemoCommand(args: string[]): Promise<void> {
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

export async function runContractCommand(args: string[]): Promise<void> {
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

