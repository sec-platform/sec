import fs from 'node:fs/promises';
import { DEFAULT_ACCEPTANCE, PASS_STATUS_PENDING, SUPPORTED_STACK } from './shared/constants.ts';
import { CompilerError } from './shared/errors.ts';
import { pathExists, readJson, removeDir, writeJson } from './shared/fs.ts';
import { getWorkspacePaths, officialRegistryRelativePath, privateRegistryRelativePath } from './shared/paths.ts';
import { ensureProjectBase } from './shared/project-base.ts';
import { writeYaml } from './shared/yaml.ts';
import { alignInterfaces } from './compiler/align/align-interfaces.ts';
import { composeProject } from './compiler/compose/compose-project.ts';
import { writeExplainGraph } from './compiler/emit/write-explain-graph.ts';
import { writeLocalViews } from './compiler/emit/write-local-views.ts';
import { lockProject } from './compiler/emit/lock-project.ts';
import { writeReviewSummary } from './compiler/emit/write-review-summary.ts';
import { loadManifestById } from './compiler/parse/load-manifest.ts';
import { loadPlan } from './compiler/parse/load-plan.ts';
import { applyRepairPlan, buildRepairPlan, previewRepairPlan, writeRepairPlan } from './compiler/repair/build-repair-plan.ts';
import { resolveGraph } from './compiler/resolve/resolve-graph.ts';
import { adaptProject } from './compiler/synthesize/adapt-project.ts';
import { upgradeWorkspace as runUpgradeWorkspace } from './upgrade/upgrade-workspace.ts';
import { validateResolvedTemplates } from './compiler/verify/validate-resolved-templates.ts';
import { verifyProject } from './compiler/verify/verify-project.ts';
import type {
  AcceptanceCoverageReport,
  ExplainGraph,
  LockFile,
  ManifestEntry,
  PlanFile,
  ProvenanceFile,
  RepairPlan,
  ReviewSummary,
  VerificationLane,
  VerificationReport
} from './shared/types.ts';

function defaultPlan(): PlanFile {
  return {
    app: {
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    registry: {
      sources: [
        {
          id: 'official',
          kind: 'official',
          location: 'compiler',
          path: officialRegistryRelativePath.replaceAll('\\', '/')
        },
        {
          id: 'private',
          kind: 'private',
          location: 'workspace',
          path: privateRegistryRelativePath.replaceAll('\\', '/')
        }
      ]
    },
    blocks: [
      { id: 'auth/basic-session', version: '0.1.0' },
      { id: 'tenant/basic-workspace', version: '0.1.0' },
      { id: 'entity/customer-basic', version: '0.1.0' }
    ],
    slots: [
      {
        id: 'customer_normalizer',
        block: 'entity/customer-basic',
        kind: 'adapter',
        target: 'custom/customer_normalizer.ts',
        symbol: 'normalizeCustomerInput',
        description: 'Name required; email lowercased; phone digits only; company defaults to Unknown.'
      }
    ],
    acceptance: [...DEFAULT_ACCEPTANCE]
  };
}

export async function initWorkspace(
  workspaceRoot = process.cwd(),
  options: { reset?: boolean } = {}
): Promise<{ planPath: string; lockPath: string }> {
  const { projectRoot, planPath, lockPath, generatedDir } = getWorkspacePaths(workspaceRoot);
  if (options.reset && (await pathExists(projectRoot))) {
    await removeDir(projectRoot);
  }

  await ensureProjectBase(workspaceRoot);
  await writeYaml(planPath, defaultPlan());
  await writeJson(lockPath, {
    formatVersion: '1',
    app: {
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [
      'generated/routes.ts',
      'generated/block-usage-map.json',
      'generated/install-manifest.json',
      'generated/verification-report.json'
    ],
    acceptancePlan: DEFAULT_ACCEPTANCE.map((entry) => entry.id),
    passStatus: { ...PASS_STATUS_PENDING }
  });
  await writeJson(`${generatedDir}/verification-report.json`, {
    summary: { status: 'pending' }
  });

  return { planPath, lockPath };
}

export async function addBlock(workspaceRoot = process.cwd(), blockId: string): Promise<PlanFile> {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  if (plan.blocks.some((entry) => entry.id === blockId)) {
    return plan;
  }
  const manifestEntry = await loadManifestById(blockId, {
    workspaceRoot,
    registrySources: plan.registry.sources
  });
  plan.blocks.push({ id: blockId, version: manifestEntry.manifest.version });
  const declaredAcceptanceIds = new Set(plan.acceptance.map((entry) => entry.id));
  for (const acceptance of manifestEntry.manifest.acceptance) {
    if (!declaredAcceptanceIds.has(acceptance.id)) {
      plan.acceptance.push({ id: acceptance.id });
      declaredAcceptanceIds.add(acceptance.id);
    }
  }
  await writeYaml(planPath, plan);
  return plan;
}

export async function resolveWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const { planPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const manifestMap = new Map<string, ManifestEntry>();
  for (const block of plan.blocks) {
    manifestMap.set(
      block.id,
      await loadManifestById(block.id, {
        workspaceRoot,
        version: block.version,
        registrySources: plan.registry.sources
      })
    );
  }
  alignInterfaces(plan, manifestMap);
  const lock = await resolveGraph(workspaceRoot, plan);
  await validateResolvedTemplates(workspaceRoot, lock);
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return { plan, lock };
}

export async function composeWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const { planPath, lockPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(lockPath))) {
    throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing');
  }
  const plan = await loadPlan(planPath);
  const lock = await readJson<LockFile>(lockPath);
  await composeProject(workspaceRoot, lock);
  return { plan, lock };
}

export async function adaptWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const { planPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const lock = await readJson<LockFile>(lockPath);
  await adaptProject(workspaceRoot, plan, lock);
  return { plan, lock };
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: { lane?: VerificationLane } = {}
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  const report = await verifyProject(workspaceRoot, lock, options.lane ?? 'all');
  return { lock, report };
}

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {}
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  const { planPath, lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const lock = await readJson<LockFile>(lockPath);

  if (lock.passStatus.verify === 'pending') {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair');
  }

  const report = await readJson<VerificationReport>(verificationReportPath);

  try {
    const repairPlan = buildRepairPlan(plan, lock, report);
    if (repairPlan.status === 'pending') {
      if (options.dryRun) {
        await previewRepairPlan(workspaceRoot, plan, lock, repairPlan);
        await writeRepairPlan(workspaceRoot, repairPlan, lock);
        return { lock, repairPlan };
      }
      await applyRepairPlan(workspaceRoot, plan, lock, repairPlan);
      repairPlan.status = 'applied';
      repairPlan.requiresVerification = true;
      lock.passStatus.verify = 'pending';
      lock.passStatus.repair = 'succeeded';
    } else {
      lock.passStatus.repair = 'skipped';
    }
    await writeRepairPlan(workspaceRoot, repairPlan, lock);
    return { lock, repairPlan };
  } catch (error) {
    lock.passStatus.repair = 'failed';
    await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    throw error;
  }
}

export async function lockWorkspace(workspaceRoot = process.cwd()): Promise<LockFile> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  await lockProject(workspaceRoot, lock);
  return lock;
}

export async function explainWorkspace(
  workspaceRoot = process.cwd()
): Promise<{
  lock: LockFile;
  provenance: ProvenanceFile;
  report: VerificationReport;
  graph: ExplainGraph;
  reviewSummary: ReviewSummary;
}> {
  const {
    acceptanceCoveragePath,
    lockPath,
    provenancePath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);

  if (lock.passStatus.lock !== 'succeeded') {
    throw new CompilerError('EXPLAIN-BLOCKED-001', 'lock must succeed before explain');
  }

  const provenance = await readJson<ProvenanceFile>(provenancePath);
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const graph = await writeExplainGraph(workspaceRoot, lock, provenance);
  const refreshedProvenance = await readJson<ProvenanceFile>(provenancePath);
  const reviewSummary = await writeReviewSummary(workspaceRoot, lock, refreshedProvenance, report, coverage);
  await writeLocalViews(workspaceRoot);
  return { lock, provenance: refreshedProvenance, report, graph, reviewSummary };
}

export async function upgradeWorkspace(
  workspaceRoot = process.cwd(),
  blockId: string,
  targetVersion: string,
  options?: { dryRun?: boolean }
): Promise<{ plan: PlanFile; lock: LockFile; upgradePlan: import('./shared/types.ts').UpgradePlan }> {
  return runUpgradeWorkspace(workspaceRoot, blockId, targetVersion, options);
}
