import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect } from 'vitest';

import { compilerRoot } from '../../platform/shared/paths.ts';
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
} from '../../platform/cli/commands.ts';
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
} from '../../platform/orchestrator.ts';
import { parseArtifactsArgs, parseDoctorArgs, parseExplainArgs, parseLockArgs, parseRepairArgs, parseResetArg, parseUpgradeArgs, parseVerifyArgs } from '../../platform/cli/args.ts';
import { loadManifestById } from '../../platform/compiler/parse/load-manifest.ts';
import { loadPlan } from '../../platform/compiler/parse/load-plan.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { pathExists, readJson } from '../../platform/shared/fs.ts';
import {
  artifactUploadPathSummary,
  formatCiArtifactManifest,
  formatExplainGraphInspect,
  formatExplainSummary,
  formatLockInspect,
  formatRepairSummary,
  formatUpgradeDiagnostics,
  formatUpgradeSummary
} from '../../platform/cli/formatters.ts';
import { buildErrorProtocol } from '../../platform/shared/error-protocol.ts';
import { buildE2eMatrix } from '../../platform/shared/review-matrix.ts';
import type { CiArtifactManifest } from '../../platform/compiler/emit/ci-artifacts.ts';
import type { ExplainGraph } from '../../platform/shared/explain-types.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import type { RepairPlan } from '../../platform/shared/repair-types.ts';
import type { UpgradeDiagnostics, UpgradePlan } from '../../platform/shared/upgrade-types.ts';
import { ADD_USAGE, USAGE } from '../../platform/cli/usage.ts';

const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
const deferredCleanupDirs = new Set<string>();

afterAll(async () => {
  for (const directory of deferredCleanupDirs) {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {}
  }
}, 120000);

export async function createWorkspace(prefix = 'engineering-compiler-test-'): Promise<string> {
  await fs.mkdir(workspaceParent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(workspaceParent, prefix));
  deferredCleanupDirs.add(directory);
  return directory;
}

export async function withTempWorkspace<T>(
  callback: (workspaceRoot: string) => Promise<T>,
  prefix = 'engineering-compiler-test-'
): Promise<T> {
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, prefix));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

const compilerFileCache = new Map<string, string>();

export async function readCompilerFile(relativePath: string): Promise<string> {
  const cached = compilerFileCache.get(relativePath);
  if (cached !== undefined) return cached;

  const absolutePath = path.join(compilerRoot, relativePath);
  const content = await fs.readFile(absolutePath, 'utf8');
  compilerFileCache.set(relativePath, content);
  return content;
}

interface CompilerPackage {
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

let cachedRootPackage: CompilerPackage | null = null;

export async function readCompilerPackageJson(): Promise<CompilerPackage> {
  if (cachedRootPackage) return cachedRootPackage;
  const raw = await readCompilerFile('package.json');
  cachedRootPackage = JSON.parse(raw) as CompilerPackage;
  return cachedRootPackage;
}

export function expectContainsAll(haystack: string, needles: readonly string[]): void {
  const missing = needles.filter((n) => !haystack.includes(n));
  expect(missing, `Missing ${missing.length} marker(s): ${missing.map((m) => JSON.stringify(m)).join(', ')}`).toEqual([]);
}

export function expectContainsNone(haystack: string, needles: readonly string[]): void {
  const found = needles.filter((n) => haystack.includes(n));
  expect(found, `Unexpectedly found ${found.length} marker(s): ${found.map((f) => JSON.stringify(f)).join(', ')}`).toEqual([]);
}

export async function installRuntimeDeps(cwd: string): Promise<void> {
  const nextPackagePath = path.join(cwd, 'node_modules', 'next', 'package.json');
  await fs.mkdir(path.dirname(nextPackagePath), { recursive: true });
  await fs.writeFile(nextPackagePath, '{\n  "name": "next"\n}\n', 'utf8');
}

export type CliResult = { code: number; stdout: string; stderr: string };

function assertNoArgs(command: string, args: string[]): void {
  if (args.length > 0) {
    throw new Error(`Usage: platform ${command}`);
  }
}

export async function runCliInProcess(workspaceRoot: string, args: string[]): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  console.log = (...chunks: unknown[]) => { stdoutChunks.push(`${chunks.map(String).join(' ')}\n`); };
  console.error = (...chunks: unknown[]) => { stderrChunks.push(`${chunks.map(String).join(' ')}\n`); };
  console.warn = (...chunks: unknown[]) => { stderrChunks.push(`${chunks.map(String).join(' ')}\n`); };

  try {
    const [command, ...commandArgs] = args;

    switch (command) {
      case 'init':
        await initWorkspace(workspaceRoot, { reset: parseResetArg(commandArgs) });
        console.log('Initialized project workspace');
        break;
      case 'add': {
        if (commandArgs.length !== 1) throw new Error(ADD_USAGE);
        await addBlock(workspaceRoot, commandArgs[0]);
        const { planPath } = getWorkspacePaths(workspaceRoot);
        const plan = await loadPlan(planPath);
        const manifestEntry = await loadManifestById(commandArgs[0], {
          workspaceRoot,
          version: plan.blocks.find((b) => b.id === commandArgs[0])?.version,
          registrySources: plan.registry.sources
        });
        console.log(`Added block ${commandArgs[0]}@${manifestEntry.manifest.version} from ${manifestEntry.registrySourceId} (${manifestEntry.registryKind})`);
        break;
      }
      case 'resolve': {
        assertNoArgs('resolve', commandArgs);
        const { lock } = await resolveWorkspace(workspaceRoot);
        console.log(`Resolved ${lock.resolvedBlocks.length} blocks`);
        break;
      }
      case 'compose':
        assertNoArgs('compose', commandArgs);
        await composeWorkspace(workspaceRoot);
        console.log('Composed project');
        break;
      case 'adapt':
        assertNoArgs('adapt', commandArgs);
        await adaptWorkspace(workspaceRoot);
        console.log('Adapted slots');
        break;
      case 'verify': {
        const verifyArgs = parseVerifyArgs(commandArgs);
        const { report } = await verifyWorkspace(workspaceRoot, { lane: verifyArgs.lane, emitTiming: !verifyArgs.json });
        if (verifyArgs.json) {
          console.log(JSON.stringify(report, null, verifyArgs.compact ? 0 : 2));
        } else {
          console.log(`Verification ${report.summary.status} (${report.summary.requestedLane})`);
        }
        break;
      }
      case 'repair': {
        const repairArgs = parseRepairArgs(commandArgs);
        if (repairArgs.mode === 'plan') {
          await runRepairPlanRead(workspaceRoot, repairArgs.json, repairArgs.compact);
        } else {
          await runRepairExecution(workspaceRoot, repairArgs.dryRun, repairArgs.json, repairArgs.compact);
        }
        break;
      }
      case 'upgrade': {
        const upgradeArgs = parseUpgradeArgs(commandArgs);
        if (upgradeArgs.mode === 'plan') {
          await runUpgradePlanRead(workspaceRoot, upgradeArgs.json, upgradeArgs.compact);
        } else if (upgradeArgs.mode === 'diagnostics') {
          await runUpgradeDiagnosticsRead(workspaceRoot, upgradeArgs.json, upgradeArgs.compact);
        } else {
          const { upgradePlan } = await upgradeWorkspace(workspaceRoot, upgradeArgs.blockId, upgradeArgs.targetVersion, { dryRun: upgradeArgs.dryRun });
          if (upgradeArgs.json) {
            console.log(JSON.stringify(upgradePlan, null, upgradeArgs.compact ? 0 : 2));
          } else {
            console.log(formatUpgradeSummary(upgradePlan, upgradeArgs.dryRun));
          }
        }
        break;
      }
      case 'lock': {
        const lockArgs = parseLockArgs(commandArgs);
        if (lockArgs.mode === 'inspect') {
          await runLockInspect(workspaceRoot, lockArgs.json, lockArgs.compact);
        } else {
          await lockWorkspace(workspaceRoot);
          console.log('Locked project');
        }
        break;
      }
      case 'explain': {
        const explainArgs = parseExplainArgs(commandArgs);
        if (explainArgs.mode === 'graph') {
          const { explainGraphPath } = getWorkspacePaths(workspaceRoot);
          if (!(await pathExists(explainGraphPath))) throw new Error('Explain graph not found; run platform explain first');
          const graph = await readJson<ExplainGraph>(explainGraphPath);
          if (explainArgs.json) {
            console.log(JSON.stringify(graph, null, explainArgs.compact ? 0 : 2));
          } else {
            console.log(formatExplainGraphInspect(graph));
          }
        } else {
          const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
          if (explainArgs.json) {
            console.log(JSON.stringify({ graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) }, null, explainArgs.compact ? 0 : 2));
          } else {
            console.log(formatExplainSummary(graph, reviewSummary));
          }
        }
        break;
      }
      case 'artifacts': {
        const artifactsArgs = parseArtifactsArgs(commandArgs);
        if (artifactsArgs.mode === 'manifest') {
          const { ciArtifactsPath } = getWorkspacePaths(workspaceRoot);
          if (!(await pathExists(ciArtifactsPath))) throw new Error('Artifact manifest not found; run platform artifacts --json first');
          const manifest = await readJson<CiArtifactManifest>(ciArtifactsPath);
          if (artifactsArgs.json) {
            console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
          } else {
            console.log(formatCiArtifactManifest(manifest));
          }
        } else {
          const { manifest } = await writeWorkspaceArtifacts(workspaceRoot);
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
            } else {
              console.log(pathSummary.paths.join('\n'));
            }
          } else {
            console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
          }
        }
        break;
      }
      case 'doctor':
        await runDoctorCommand(workspaceRoot, commandArgs);
        break;
      case 'deps':
        await runDepsCommand(commandArgs, workspaceRoot);
        break;
      case 'reference':
        await runReferenceCommand(commandArgs);
        break;
      case 'benchmark':
        await runBenchmarkCommand(commandArgs);
        break;
      case 'test':
        await runTestCommand(commandArgs);
        break;
      case 'policy':
        await runPolicyCommand(commandArgs, workspaceRoot);
        break;
      case 'acceptance':
        await runAcceptanceCommand(commandArgs, workspaceRoot);
        break;
      case 'runtime':
        await runRuntimeCommand(commandArgs, workspaceRoot);
        break;
      case 'verification':
        await runVerificationCommand(commandArgs, workspaceRoot);
        break;
      case 'provenance':
        await runProvenanceCommand(commandArgs, workspaceRoot);
        break;
      case 'review':
        await runReviewCommand(commandArgs, workspaceRoot);
        break;
      case 'demo':
        await runDemoCommand(commandArgs, workspaceRoot);
        break;
      case 'contract':
        await runContractCommand(commandArgs);
        break;
      case 'install':
        await runInstallCommand(commandArgs, workspaceRoot);
        break;
      case 'blocks':
        await runBlocksCommand(commandArgs, workspaceRoot);
        break;
      case 'postgres':
        await runPostgresCommand(commandArgs, workspaceRoot);
        break;
      default:
        console.log(USAGE);
        break;
    }

    return { code: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } catch (error: unknown) {
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
    return { code: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  }
}

async function runRepairPlanRead(workspaceRoot: string, json: boolean, compact: boolean): Promise<void> {
  const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(repairPlanPath))) throw new Error('Repair plan not found; run platform repair --dry-run first');
  const repairPlan = await readJson<RepairPlan>(repairPlanPath);
  if (json) {
    console.log(JSON.stringify(repairPlan, null, compact ? 0 : 2));
  } else {
    console.log(formatRepairSummary(repairPlan, true));
  }
}

async function runRepairExecution(workspaceRoot: string, dryRun: boolean, json: boolean, compact: boolean): Promise<void> {
  try {
    const { repairPlan } = await repairWorkspace(workspaceRoot, { dryRun });
    if (json) {
      console.log(JSON.stringify(repairPlan, null, compact ? 0 : 2));
    } else {
      console.log(formatRepairSummary(repairPlan, dryRun));
    }
  } catch (error) {
    const { repairPlanPath } = getWorkspacePaths(workspaceRoot);
    if (await pathExists(repairPlanPath)) {
      const repairPlan = await readJson<RepairPlan>(repairPlanPath);
      if (json) {
        console.log(JSON.stringify(repairPlan, null, compact ? 0 : 2));
      } else {
        console.log(formatRepairSummary(repairPlan, dryRun));
      }
    }
    throw error;
  }
}

async function runUpgradePlanRead(workspaceRoot: string, json: boolean, compact: boolean): Promise<void> {
  const { upgradePlanPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(upgradePlanPath))) throw new Error('Upgrade plan not found; run platform upgrade <block-id> <target-version> --dry-run first');
  const upgradePlan = await readJson<UpgradePlan>(upgradePlanPath);
  if (json) {
    console.log(JSON.stringify(upgradePlan, null, compact ? 0 : 2));
  } else {
    console.log(formatUpgradeSummary(upgradePlan, upgradePlan.status === 'planned'));
  }
}

async function runUpgradeDiagnosticsRead(workspaceRoot: string, json: boolean, compact: boolean): Promise<void> {
  const { upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(upgradeDiagnosticsPath))) throw new Error('Upgrade diagnostics not found; run platform upgrade <block-id> <target-version> --dry-run first');
  const diagnostics = await readJson<UpgradeDiagnostics>(upgradeDiagnosticsPath);
  if (json) {
    console.log(JSON.stringify(diagnostics, null, compact ? 0 : 2));
  } else {
    console.log(formatUpgradeDiagnostics(diagnostics));
  }
}

async function runLockInspect(workspaceRoot: string, json: boolean, compact: boolean): Promise<void> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(lockPath))) throw new Error('Graph lock not found; run platform lock first');
  const lock = await readJson<LockFile>(lockPath);
  if (json) {
    console.log(JSON.stringify(lock, null, compact ? 0 : 2));
  } else {
    console.log(formatLockInspect(lock));
  }
}

async function runDoctorCommand(workspaceRoot: string, args: string[]): Promise<void> {
  const doctorArgs = parseDoctorArgs(args);
  const { formatDoctorReport, getDoctorReport } = await import('../../platform/shared/dependency-environment.ts');
  const report = await getDoctorReport(workspaceRoot);
  if (doctorArgs.json) {
    console.log(JSON.stringify(report, null, doctorArgs.compact ? 0 : 2));
  } else {
    console.log(formatDoctorReport(report));
  }
}
