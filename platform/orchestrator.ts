import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ACCEPTANCE, PASS_STATUS_PENDING, SUPPORTED_STACK } from './shared/constants.ts';
import { CompilerError } from './shared/errors.ts';
import { ensureDir, pathExists, readJson, removeDir, writeJson, writeText } from './shared/fs.ts';
import { getWorkspacePaths } from './shared/paths.ts';
import { ensureProjectBase } from './shared/project-base.ts';
import { writeYaml } from './shared/yaml.ts';
import { alignInterfaces } from './compiler/align/align-interfaces.ts';
import { composeProject } from './compiler/compose/compose-project.ts';
import { lockProject } from './compiler/emit/lock-project.ts';
import { loadManifestById } from './compiler/parse/load-manifest.ts';
import { loadPlan } from './compiler/parse/load-plan.ts';
import { resolveGraph } from './compiler/resolve/resolve-graph.ts';
import { adaptProject } from './compiler/synthesize/adapt-project.ts';
import { validateResolvedTemplates } from './compiler/verify/validate-resolved-templates.ts';
import { verifyProject } from './compiler/verify/verify-project.ts';
import type { LockFile, ManifestEntry, PlanFile, VerificationReport } from './shared/types.ts';

function defaultPlan(): PlanFile {
  return {
    app: {
      name: 'customer-admin',
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
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
      'generated/install-manifest.json'
    ],
    acceptancePlan: DEFAULT_ACCEPTANCE.map((entry) => entry.id),
    passStatus: { ...PASS_STATUS_PENDING }
  });
  await writeJson(path.join(generatedDir, 'verification-report.json'), {
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
  await loadManifestById(blockId);
  plan.blocks.push({ id: blockId, version: '0.1.0' });
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
    manifestMap.set(block.id, await loadManifestById(block.id));
  }
  alignInterfaces(plan, manifestMap);
  const lock = await resolveGraph(plan);
  await validateResolvedTemplates(lock);
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
  workspaceRoot = process.cwd()
): Promise<{ lock: LockFile; report: VerificationReport }> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  const report = await verifyProject(workspaceRoot, lock);
  return { lock, report };
}

export async function lockWorkspace(workspaceRoot = process.cwd()): Promise<LockFile> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  await lockProject(workspaceRoot, lock);
  return lock;
}
