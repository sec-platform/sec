import path from 'node:path';
import { countMatching } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, listFilesRecursive, pathExists, readJson, writeJson } from '../../shared/fs.ts';
import { getWorkspacePaths, workspaceRelativePath } from '../../shared/paths.ts';
import type { AppMode, PlanFile } from '../../shared/plan-manifest-types.ts';
import { writeYaml } from '../../shared/yaml.ts';
import { loadPlan } from '../parse/load-plan.ts';

export type ViewMutationKind = 'set-app-name' | 'set-app-mode' | 'add-acceptance' | 'set-slot-description' | 'set-slot-source-path';

export type ViewMutation =
  | {
      id: string;
      kind: 'set-app-name';
      value: string;
    }
  | {
      id: string;
      kind: 'set-app-mode';
      value: AppMode;
    }
  | {
      id: string;
      kind: 'add-acceptance';
      acceptanceId: string;
    }
  | {
      id: string;
      kind: 'set-slot-description';
      slotId: string;
      description: string;
    }
  | {
      id: string;
      kind: 'set-slot-source-path';
      slotId: string;
      sourcePath: string;
    };

export interface ViewMutationFile {
  formatVersion: '1';
  mutations: ViewMutation[];
}

export interface ViewMutationResult {
  id: string;
  kind: ViewMutationKind;
  sourcePath: string;
  status: 'applied' | 'skipped';
  targetPath: 'source/app.yaml';
  detail: string;
}

export interface ViewMutationReport {
  formatVersion: '1';
  status: 'applied' | 'skipped';
  sourceRoot: 'source/views/mutations';
  targetPath: 'source/app.yaml';
  mutationFileCount: number;
  mutationCount: number;
  appliedCount: number;
  skippedCount: number;
  mutations: ViewMutationResult[];
}

const SUPPORTED_APP_MODES = new Set<AppMode>(['single-tenant', 'multi-tenant']);

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CompilerError('WORKBENCH-MUTATION-001', `${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CompilerError('WORKBENCH-MUTATION-001', `${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertSlotSourcePath(value: unknown, label: string): string {
  const sourcePath = assertNonEmptyString(value, label).replaceAll('\\', '/');
  const normalized = path.posix.normalize(sourcePath);
  if (
    normalized !== sourcePath ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    path.posix.isAbsolute(normalized) ||
    !normalized.startsWith('source/code/slots/')
  ) {
    throw new CompilerError('WORKBENCH-MUTATION-002', `${label} must stay under source/code/slots/**`);
  }
  return normalized;
}

function parseMutation(raw: unknown, sourcePath: string): ViewMutation {
  assertObject(raw, `Mutation in ${sourcePath}`);
  const id = assertNonEmptyString(raw.id, `Mutation id in ${sourcePath}`);
  const kind = assertNonEmptyString(raw.kind, `Mutation kind in ${sourcePath}`);

  if (kind === 'set-app-name') {
    return { id, kind, value: assertNonEmptyString(raw.value, `${id}.value`) };
  }
  if (kind === 'set-app-mode') {
    const value = assertNonEmptyString(raw.value, `${id}.value`);
    if (!SUPPORTED_APP_MODES.has(value as AppMode)) {
      throw new CompilerError('WORKBENCH-MUTATION-003', `${id}.value must be single-tenant or multi-tenant`);
    }
    return { id, kind, value: value as AppMode };
  }
  if (kind === 'add-acceptance') {
    return { id, kind, acceptanceId: assertNonEmptyString(raw.acceptanceId, `${id}.acceptanceId`) };
  }
  if (kind === 'set-slot-description') {
    return {
      id,
      kind,
      slotId: assertNonEmptyString(raw.slotId, `${id}.slotId`),
      description: assertNonEmptyString(raw.description, `${id}.description`)
    };
  }
  if (kind === 'set-slot-source-path') {
    return {
      id,
      kind,
      slotId: assertNonEmptyString(raw.slotId, `${id}.slotId`),
      sourcePath: assertSlotSourcePath(raw.sourcePath, `${id}.sourcePath`)
    };
  }

  throw new CompilerError('WORKBENCH-MUTATION-004', `Unsupported Workbench mutation kind "${kind}"`);
}

function parseMutationFile(raw: unknown, sourcePath: string): ViewMutationFile {
  assertObject(raw, sourcePath);
  if (raw.formatVersion !== '1') {
    throw new CompilerError('WORKBENCH-MUTATION-005', `${sourcePath} must use formatVersion "1"`);
  }
  if (!Array.isArray(raw.mutations)) {
    throw new CompilerError('WORKBENCH-MUTATION-001', `${sourcePath}.mutations must be an array`);
  }
  return {
    formatVersion: '1',
    mutations: raw.mutations.map((mutation) => parseMutation(mutation, sourcePath))
  };
}

function result(
  mutation: ViewMutation,
  sourcePath: string,
  status: ViewMutationResult['status'],
  detail: string
): ViewMutationResult {
  return {
    id: mutation.id,
    kind: mutation.kind,
    sourcePath,
    status,
    targetPath: 'source/app.yaml',
    detail
  };
}

function applyMutation(plan: PlanFile, mutation: ViewMutation, sourcePath: string): ViewMutationResult {
  if (mutation.kind === 'set-app-name') {
    if (plan.app.name === mutation.value) {
      return result(mutation, sourcePath, 'skipped', 'app name already matches');
    }
    plan.app.name = mutation.value;
    return result(mutation, sourcePath, 'applied', `set app.name to ${mutation.value}`);
  }

  if (mutation.kind === 'set-app-mode') {
    if (plan.app.mode === mutation.value) {
      return result(mutation, sourcePath, 'skipped', 'app mode already matches');
    }
    plan.app.mode = mutation.value;
    return result(mutation, sourcePath, 'applied', `set app.mode to ${mutation.value}`);
  }

  if (mutation.kind === 'add-acceptance') {
    if (plan.acceptance.some((entry) => entry.id === mutation.acceptanceId)) {
      return result(mutation, sourcePath, 'skipped', 'acceptance already exists');
    }
    plan.acceptance.push({ id: mutation.acceptanceId });
    return result(mutation, sourcePath, 'applied', `added acceptance ${mutation.acceptanceId}`);
  }

  const slot = plan.slots.find((entry) => entry.id === mutation.slotId);
  if (!slot) {
    throw new CompilerError('WORKBENCH-MUTATION-006', `Slot "${mutation.slotId}" does not exist in source/app.yaml`);
  }

  if (mutation.kind === 'set-slot-description') {
    if (slot.description === mutation.description) {
      return result(mutation, sourcePath, 'skipped', 'slot description already matches');
    }
    slot.description = mutation.description;
    return result(mutation, sourcePath, 'applied', `set ${mutation.slotId}.description`);
  }

  if (slot.sourcePath === mutation.sourcePath) {
    return result(mutation, sourcePath, 'skipped', 'slot sourcePath already matches');
  }
  slot.sourcePath = mutation.sourcePath;
  return result(mutation, sourcePath, 'applied', `set ${mutation.slotId}.sourcePath to ${mutation.sourcePath}`);
}

async function loadMutationFiles(workspaceRoot: string): Promise<Array<{ sourcePath: string; file: ViewMutationFile }>> {
  const { sourceViewMutationsRoot } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(sourceViewMutationsRoot))) {
    return [];
  }

  const files = (await listFilesRecursive(sourceViewMutationsRoot))
    .filter((file) => file.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right));
  const loaded: Array<{ sourcePath: string; file: ViewMutationFile }> = [];
  for (const file of files) {
    const sourcePath = workspaceRelativePath(workspaceRoot, file);
    loaded.push({ sourcePath, file: parseMutationFile(await readJson<unknown>(file), sourcePath) });
  }
  return loaded;
}

export async function applyViewMutations(workspaceRoot: string): Promise<ViewMutationReport> {
  const { planPath, viewMutationReportPath, sourceViewMutationsRoot } = getWorkspacePaths(workspaceRoot);
  await ensureDir(sourceViewMutationsRoot);
  const plan = await loadPlan(planPath);
  const mutationFiles = await loadMutationFiles(workspaceRoot);
  const mutations = mutationFiles.flatMap((entry) =>
    entry.file.mutations.map((mutation) => ({ mutation, sourcePath: entry.sourcePath }))
  );
  const results = mutations.map((entry) => applyMutation(plan, entry.mutation, entry.sourcePath));
  const appliedCount = countMatching(results, (entry) => entry.status === 'applied');
  const report: ViewMutationReport = {
    formatVersion: '1',
    status: appliedCount > 0 ? 'applied' : 'skipped',
    sourceRoot: 'source/views/mutations',
    targetPath: 'source/app.yaml',
    mutationFileCount: mutationFiles.length,
    mutationCount: results.length,
    appliedCount,
    skippedCount: results.length - appliedCount,
    mutations: results
  };

  if (appliedCount > 0) {
    await writeYaml(planPath, plan);
  }
  await writeJson(viewMutationReportPath, report);
  return report;
}
