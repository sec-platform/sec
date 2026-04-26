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
  verifyWorkspace
} from '../orchestrator.ts';
import { loadManifestById } from '../compiler/parse/load-manifest.ts';
import { loadPlan } from '../compiler/parse/load-plan.ts';
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
import type { VerificationLane } from '../shared/types.ts';

const USAGE = 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|doctor|deps>';
const INIT_USAGE = 'Usage: platform init [--reset]';
const ADD_USAGE = 'Usage: platform add <block-id>';
const VERIFY_USAGE = 'Usage: platform verify [--lane fast|runtime|all]';
const REPAIR_USAGE = 'Usage: platform repair [--dry-run]';
const UPGRADE_USAGE = 'Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]';
const DEPS_USAGE = [
  'Usage: platform deps <status|warmup|relink|clean>',
  '  platform deps relink project',
  '  platform deps clean [--project|--shared|--npm-cache]',
  '  platform deps clean --all --force'
].join('\n');

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

function parseLaneArg(args: string[]): VerificationLane {
  if (args.length === 0) {
    return 'fast';
  }
  if (args.length !== 2 || args[0] !== '--lane') {
    throw new Error(VERIFY_USAGE);
  }

  const value = args[1];
  if (value === 'fast' || value === 'runtime' || value === 'all') {
    return value;
  }

  throw new Error(VERIFY_USAGE);
}

function parseRepairArgs(args: string[]): { dryRun: boolean } {
  if (args.length === 0) {
    return { dryRun: false };
  }
  if (args.length === 1 && args[0] === '--dry-run') {
    return { dryRun: true };
  }
  throw new Error(REPAIR_USAGE);
}

function parseUpgradeArgs(args: string[]): { blockId: string; targetVersion: string; dryRun: boolean; json: boolean } {
  if (args.length < 2) {
    throw new Error(UPGRADE_USAGE);
  }

  const [blockId, targetVersion, ...flags] = args;
  let dryRun = false;
  let json = false;
  for (const flag of flags) {
    if (flag === '--dry-run' && !dryRun) {
      dryRun = true;
      continue;
    }
    if (flag === '--json' && !json) {
      json = true;
      continue;
    }
    throw new Error(UPGRADE_USAGE);
  }

  return { blockId, targetVersion, dryRun, json };
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

async function runDepsCommand(args: string[]): Promise<void> {
  const [subcommand, ...subArgs] = args;
  switch (subcommand) {
    case 'status': {
      assertNoArgs('deps status', subArgs);
      const status = await getDependencyEnvironmentStatus(process.cwd());
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'warmup': {
      assertNoArgs('deps warmup', subArgs);
      const status = await warmupDependencyEnvironment(process.cwd());
      console.log(formatDependencyEnvironmentStatus(status));
      return;
    }
    case 'relink': {
      if (subArgs.length !== 1 || subArgs[0] !== 'project') {
        throw new Error(DEPS_USAGE);
      }
      const status = await relinkProjectDependencies(process.cwd());
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
      const { report } = await verifyWorkspace(process.cwd(), { lane: parseLaneArg(args) });
      console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
      return;
    }
    case 'repair': {
      const repairArgs = parseRepairArgs(args);
      const { repairPlan } = await repairWorkspace(process.cwd(), { dryRun: repairArgs.dryRun });
      const suffix = repairPlan.status === 'applied' ? '; verify pending' : repairArgs.dryRun ? ' (dry-run)' : '';
      console.log(`Repair ${repairPlan.status} (${repairPlan.tasks.length} tasks)${suffix}`);
      return;
    }
    case 'upgrade': {
      const upgradeArgs = parseUpgradeArgs(args);
      const { upgradePlan } = await upgradeWorkspace(process.cwd(), upgradeArgs.blockId, upgradeArgs.targetVersion, {
        dryRun: upgradeArgs.dryRun
      });
      if (upgradeArgs.json) {
        console.log(JSON.stringify(upgradePlan, null, 2));
        return;
      }
      const suffix = upgradeArgs.dryRun ? ' (dry-run)' : '';
      console.log(`Upgrade ${upgradePlan.blockId} ${upgradePlan.fromVersion} -> ${upgradePlan.toVersion}${suffix}`);
      return;
    }
    case 'lock':
      assertNoArgs('lock', args);
      await lockWorkspace(process.cwd());
      console.log('Locked project');
      return;
    case 'explain': {
      assertNoArgs('explain', args);
      const { graph } = await explainWorkspace(process.cwd());
      console.log(`Explain graph ${graph.nodes.length} nodes ${graph.edges.length} edges`);
      return;
    }
    case 'doctor': {
      assertNoArgs('doctor', args);
      const report = await getDoctorReport(process.cwd());
      console.log(formatDoctorReport(report));
      return;
    }
    case 'deps':
      await runDepsCommand(args);
      return;
    default:
      console.log(USAGE);
  }
}

main().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string; details?: unknown };
  console.error(failure.code ?? 'UNEXPECTED', failure.message ?? String(error));
  if (failure.details) {
    console.error(JSON.stringify(failure.details, null, 2));
  }
  process.exit(1);
});
