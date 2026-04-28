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
  formatDoctorReport,
  getDoctorReport
} from '../shared/dependency-environment.ts';
import { buildErrorProtocol } from '../shared/error-protocol.ts';
import {
  ADD_USAGE,
  USAGE
} from './usage.ts';
import {
  parseArtifactsArgs,
  parseDoctorArgs,
  parseExplainArgs,
  parseLockArgs,
  parseRepairArgs,
  parseResetArg,
  parseUpgradeArgs,
  parseVerifyArgs
} from './args.ts';
import {
  artifactUploadPathSummary,
  formatCiArtifactManifest,
  formatExplainGraphInspect,
  formatExplainSummary,
  formatLockInspect,
  formatRepairSummary,
  formatUpgradeDiagnostics,
  formatUpgradeSummary
} from './formatters.ts';
import {
  runAcceptanceCommand,
  runBenchmarkCommand,
  runBlocksCommand,
  runContractCommand,
  runDemoCommand,
  runDepsCommand,
  runInstallCommand,
  runPolicyCommand,
  runPostgresCommand,
  runProvenanceCommand,
  runReferenceCommand,
  runReviewCommand,
  runRuntimeCommand,
  runTestCommand,
  runVerificationCommand
} from './commands.ts';
import { buildE2eMatrix } from '../shared/review-matrix.ts';
import type {
  ExplainGraph,
  LockFile,
  RepairPlan,
  UpgradeDiagnostics,
  UpgradePlan
} from '../shared/types.ts';

function assertNoArgs(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(`Usage: platform ${command}`);
  }
}

async function readWrittenRepairPlan(workspaceRoot: string): Promise<RepairPlan | null> {
  const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(repairPlanPath))) {
    return null;
  }
  return readJson<RepairPlan>(repairPlanPath);
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
