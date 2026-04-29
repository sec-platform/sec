import fs from 'node:fs/promises';
import { DEFAULT_ACCEPTANCE, PASS_STATUS_PENDING, SUPPORTED_STACK } from './shared/constants.ts';
import { CompilerError } from './shared/errors.ts';
import { pathExists, readJson, removeDir, writeJson } from './shared/fs.ts';
import {
  getWorkspacePaths,
  officialRegistryRelativePath,
  privateRegistryRelativePath,
  resolveWorkspaceLockPath,
  resolveWorkspacePlanPath,
  resolveWorkspaceProvenancePath,
  sourcePrivateRegistryRelativePath
} from './shared/paths.ts';
import { ensureProjectBase } from './shared/project-base.ts';
import { writeYaml } from './shared/yaml.ts';
import { alignInterfaces } from './compiler/align/align-interfaces.ts';
import { composeProject } from './compiler/compose/compose-project.ts';
import { writeCiArtifactManifest } from './compiler/emit/ci-artifacts.ts';
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
import { applyViewMutations, type ViewMutationReport } from './compiler/workbench/apply-view-mutations.ts';
import { validateResolvedTemplates } from './compiler/verify/validate-resolved-templates.ts';
import { verifyProject } from './compiler/verify/verify-project.ts';
import type { AcceptanceCoverageReport } from './shared/acceptance-types.ts';
import type { ExplainGraph } from './shared/explain-types.ts';
import type { LockFile } from './shared/lock-types.ts';
import type { RepairPlan } from './shared/repair-types.ts';
import type { ReviewSummary } from './shared/review-types.ts';
import type { ManifestEntry, PlanFile } from './shared/plan-manifest-types.ts';
import type { ProvenanceFile } from './shared/provenance-types.ts';
import type { VerificationLane, VerificationReport } from './shared/verification-types.ts';

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
          id: 'source-private',
          kind: 'private',
          location: 'workspace',
          path: sourcePrivateRegistryRelativePath.replaceAll('\\', '/')
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
        sourcePath: 'source/code/slots/customer_normalizer.ts',
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
  const { projectRoot, developerSourceRoot, controlRoot, localStateRoot, planPath, lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  if (options.reset) {
    await Promise.all([projectRoot, developerSourceRoot, controlRoot, localStateRoot].map(async (targetRoot) => {
      if (await pathExists(targetRoot)) {
        await removeDir(targetRoot);
      }
    }));
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
      'control/evidence/block-usage-map.json',
      'control/evidence/install-manifest.json',
      'control/evidence/verification-report.json'
    ],
    acceptancePlan: DEFAULT_ACCEPTANCE.map((entry) => entry.id),
    passStatus: { ...PASS_STATUS_PENDING }
  });
  await writeJson(verificationReportPath, {
    summary: { status: 'pending' }
  });

  return { planPath, lockPath };
}

export async function applyWorkbenchMutations(workspaceRoot = process.cwd()): Promise<ViewMutationReport> {
  return applyViewMutations(workspaceRoot);
}

export async function addBlock(workspaceRoot = process.cwd(), blockId: string): Promise<PlanFile> {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
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
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
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
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(readableLockPath))) {
    throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing');
  }
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
  const lock = await readJson<LockFile>(readableLockPath);
  await composeProject(workspaceRoot, lock);
  return { plan, lock };
}

export async function adaptWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  await adaptProject(workspaceRoot, plan, lock);
  return { plan, lock };
}

export async function verifyWorkspace(
  workspaceRoot = process.cwd(),
  options: { lane?: VerificationLane; emitTiming?: boolean } = {}
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  const report = await verifyProject(workspaceRoot, lock, options.lane ?? 'all', { emitTiming: options.emitTiming });
  return { lock, report };
}

export async function repairWorkspace(
  workspaceRoot = process.cwd(),
  options: { dryRun?: boolean } = {}
): Promise<{ lock: LockFile; repairPlan: RepairPlan }> {
  const { lockPath, verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));

  if (lock.passStatus.verify === 'pending') {
    throw new CompilerError('REPAIR-BLOCKED-002', 'verify must run before repair');
  }

  const report = await readJson<VerificationReport>(verificationReportPath);

  try {
    const repairPlan = buildRepairPlan(plan, lock, report);
    if (repairPlan.status === 'blocked') {
      lock.passStatus.repair = 'failed';
      await writeRepairPlan(workspaceRoot, repairPlan, lock);
      throw new CompilerError(
        'REPAIR-BLOCKED-001',
        repairPlan.blockers?.[0]?.reason ?? 'Repair is blocked for current verification failure',
        { blockers: repairPlan.blockers ?? [] }
      );
    }
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
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  await lockProject(workspaceRoot, lock);
  return lock;
}

async function refreshReviewArtifacts(workspaceRoot: string, lock: LockFile): Promise<ReviewSummary | null> {
  const {
    acceptanceCoveragePath,
    explainGraphPath,
    policyReportPath,
    reviewSummaryPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const readableProvenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  if (
    !(await pathExists(readableProvenancePath)) ||
    !(await pathExists(verificationReportPath)) ||
    !(await pathExists(acceptanceCoveragePath)) ||
    !(await pathExists(policyReportPath)) ||
    !(await pathExists(explainGraphPath)) ||
    !(await pathExists(reviewSummaryPath))
  ) {
    return null;
  }

  const provenance = await readJson<ProvenanceFile>(readableProvenancePath);
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const reviewSummary = await writeReviewSummary(workspaceRoot, lock, provenance, report, coverage);
  await writeLocalViews(workspaceRoot);
  return reviewSummary;
}

export async function writeWorkspaceArtifacts(workspaceRoot = process.cwd()): Promise<{
  manifest: Awaited<ReturnType<typeof writeCiArtifactManifest>>;
  reviewSummary: ReviewSummary | null;
}> {
  const manifest = await writeCiArtifactManifest(workspaceRoot);
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  const reviewSummary = await refreshReviewArtifacts(workspaceRoot, lock);
  return { manifest, reviewSummary };
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
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));

  if (lock.passStatus.lock !== 'succeeded') {
    throw new CompilerError('EXPLAIN-BLOCKED-001', 'lock must succeed before explain');
  }

  const provenance = await readJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot));
  const report = await readJson<VerificationReport>(verificationReportPath);
  const coverage = await readJson<AcceptanceCoverageReport>(acceptanceCoveragePath);
  const graph = await writeExplainGraph(workspaceRoot, lock, provenance);
  const refreshedProvenance = await readJson<ProvenanceFile>(await resolveWorkspaceProvenancePath(workspaceRoot));
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
