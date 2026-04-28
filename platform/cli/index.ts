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
  ACCEPTANCE_USAGE,
  ADD_USAGE,
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
  USAGE,
  VERIFICATION_USAGE
} from './usage.ts';
import {
  parseAcceptanceArgs,
  parseArtifactsArgs,
  parseBenchmarkOutputArgs,
  parseBlocksOutputArgs,
  parseContractOutputArgs,
  parseDemoOutputArgs,
  parseDepsCleanArgs,
  parseDepsOutputArgs,
  parseDoctorArgs,
  parseExplainArgs,
  parseInstallOutputArgs,
  parseLockArgs,
  parsePolicyArgs,
  parsePostgresOutputArgs,
  parseProvenanceOutputArgs,
  parseReferenceOutputArgs,
  parseRepairArgs,
  parseResetArg,
  parseReviewOutputArgs,
  parseRuntimeOutputArgs,
  parseTestOutputArgs,
  parseUpgradeArgs,
  parseVerificationOutputArgs,
  parseVerifyArgs
} from './args.ts';
import {
  artifactUploadPathSummary,
  buildAcceptanceTargetInspect,
  buildPolicySourceInspect,
  buildPolicySummary,
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
  formatReviewSummaryContract,
  formatRuntimeReport,
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
  assertReferenceCheckClean,
  buildReferenceCheckReport,
  formatReferenceCheck
} from '../shared/reference-check.ts';
import { buildE2eMatrix } from '../shared/review-matrix.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
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

function assertNoArgs(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(`Usage: platform ${command}`);
  }
}

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

async function runAcceptanceCommand(args: string[]): Promise<void> {
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

async function runPostgresCommand(args: string[]): Promise<void> {
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
    case 'lock': {
      const lockArgs = parseLockArgs(args);
      if (lockArgs.mode === 'inspect') {
        const { lockPath } = getWorkspacePaths(process.cwd());
        if (!(await pathExists(lockPath))) {
          throw new Error('Graph lock not found; run platform lock first');
        }
        const lock = await readJson<LockFile>(lockPath);
        if (lockArgs.json) {
          console.log(JSON.stringify(lock, null, lockArgs.compact ? 0 : 2));
          return;
        }
        console.log(formatLockInspect(lock));
        return;
      }
      await lockWorkspace(process.cwd());
      console.log('Locked project');
      return;
    }
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
    case 'postgres':
      await runPostgresCommand(args);
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
