import {
  isCanonicalBlockId,
  isCanonicalRegistryVersion
} from '../../shared/block-identity.ts';
import { SUPPORTED_STACK } from '../../shared/constants.ts';
import { CompilerError } from '../../shared/errors.ts';
import {
  isSafeRelativePath,
  officialRegistryRelativePath,
  posixPath,
  privateRegistryRelativePath,
  resolveWorkspacePlanPath,
  sourcePrivateRegistryRelativePath
} from '../../shared/paths.ts';
import type { PlanFile, PlanRegistry, PlanRegistrySource } from '../../shared/plan-manifest-types.ts';
import { readYaml } from '../../shared/yaml.ts';

function defaultRegistry(): PlanRegistry {
  return {
    sources: [
      {
        id: 'official',
        kind: 'official',
        location: 'compiler',
        path: posixPath(officialRegistryRelativePath)
      },
      {
        id: 'source-private',
        kind: 'private',
        location: 'workspace',
        path: posixPath(sourcePrivateRegistryRelativePath)
      },
      {
        id: 'private',
        kind: 'private',
        location: 'workspace',
        path: posixPath(privateRegistryRelativePath)
      }
    ]
  };
}

function normalizeRegistrySource(source: Partial<PlanRegistrySource>): PlanRegistrySource {
  const kind = source.kind ?? 'private';
  const defaultPrivatePath = source.id === 'source-private'
    ? posixPath(sourcePrivateRegistryRelativePath)
    : posixPath(privateRegistryRelativePath);
  return {
    id: source.id ?? '',
    kind,
    location: source.location ?? (kind === 'official' ? 'compiler' : 'workspace'),
    path: source.path ?? (kind === 'official' ? posixPath(officialRegistryRelativePath) : defaultPrivatePath)
  };
}

export function normalizePlan(plan: PlanFile): PlanFile {
  const normalized = structuredClone((plan ?? {}) as Partial<PlanFile>);
  return {
    app: {
      id: normalized.app?.id ?? '',
      name: normalized.app?.name ?? '',
      stack: normalized.app?.stack ?? '',
      packageManager: normalized.app?.packageManager ?? 'pnpm',
      mode: normalized.app?.mode ?? 'single-tenant'
    },
    registry: {
      sources: (normalized.registry?.sources ?? defaultRegistry().sources).map((source) => normalizeRegistrySource(source))
    },
    blocks: normalized.blocks ?? [],
    slots: normalized.slots ?? [],
    acceptance: normalized.acceptance ?? []
  };
}

export function validatePlan(plan: PlanFile): void {
  if (!plan?.app?.id?.trim()) {
    throw new CompilerError('PLAN-VALIDATION-014', 'Missing app.id');
  }

  if (!plan?.app?.name) {
    throw new CompilerError('PLAN-VALIDATION-001', 'Missing app.name');
  }

  if (!plan?.app?.stack) {
    throw new CompilerError('PLAN-VALIDATION-002', 'Missing app.stack');
  }

  if (plan.app.stack !== SUPPORTED_STACK) {
    throw new CompilerError(
      'PLAN-VALIDATION-003',
      `Unsupported stack "${plan.app.stack}", expected "${SUPPORTED_STACK}"`
    );
  }

  if (!['pnpm', 'npm', 'yarn'].includes(plan.app.packageManager)) {
    throw new CompilerError(
      'PLAN-VALIDATION-015',
      `Unsupported packageManager "${String(plan.app.packageManager)}"`
    );
  }
  if (plan.app.mode !== 'single-tenant' && plan.app.mode !== 'multi-tenant') {
    throw new CompilerError(
      'PLAN-VALIDATION-016',
      `Unsupported app mode "${String(plan.app.mode)}"`
    );
  }

  if (!Array.isArray(plan.registry?.sources)) {
    throw new CompilerError('PLAN-VALIDATION-009', 'registry.sources must be an array');
  }
  const registryIds = new Set<string>();
  for (const source of plan.registry.sources) {
    if (!source || typeof source !== 'object' || !source.id || !source.kind || !source.location || !source.path) {
      throw new CompilerError('PLAN-VALIDATION-009', 'Every registry source requires id/kind/location/path');
    }
    if (source.kind !== 'official' && source.kind !== 'private' && source.kind !== 'community') {
      throw new CompilerError(
        'PLAN-VALIDATION-017',
        `Registry source "${source.id}" has unsupported kind "${String(source.kind)}"`
      );
    }
    if (source.location !== 'compiler' && source.location !== 'workspace') {
      throw new CompilerError(
        'PLAN-VALIDATION-018',
        `Registry source "${source.id}" has unsupported location "${String(source.location)}"`
      );
    }
    if (registryIds.has(source.id)) {
      throw new CompilerError('PLAN-VALIDATION-010', `Duplicate registry source id "${source.id}"`);
    }
    if (source.location === 'compiler' && source.kind !== 'official') {
      throw new CompilerError(
        'PLAN-VALIDATION-011',
        `Registry source "${source.id}" cannot use compiler location unless it is official`
      );
    }
    if (!isSafeRelativePath(source.path)) {
      throw new CompilerError(
        'PLAN-VALIDATION-012',
        `Registry source "${source.id}" must not traverse outside the configured base root`
      );
    }
    registryIds.add(source.id);
  }

  if (!Array.isArray(plan.blocks)) {
    throw new CompilerError('PLAN-VALIDATION-004', 'blocks must be an array');
  }
  const blockIds = new Set<string>();
  for (const block of plan.blocks) {
    if (!block || typeof block !== 'object' || !isCanonicalBlockId(block.id)) {
      throw new CompilerError(
        'PLAN-VALIDATION-004',
        `Every block entry requires one canonical lowercase namespace/name id; received "${String(block?.id)}"`
      );
    }
    if (block.version !== undefined && !isCanonicalRegistryVersion(block.version)) {
      throw new CompilerError(
        'PLAN-VALIDATION-019',
        `Block "${block.id}" has non-canonical version "${String(block.version)}"`
      );
    }
    if (blockIds.has(block.id)) {
      throw new CompilerError('PLAN-VALIDATION-005', `Duplicate block id "${block.id}"`);
    }
    blockIds.add(block.id);
  }

  if (!Array.isArray(plan.slots)) {
    throw new CompilerError('PLAN-VALIDATION-006', 'slots must be an array');
  }
  const slotIds = new Set<string>();
  for (const slot of plan.slots) {
    if (!slot || typeof slot !== 'object' || !slot.id || !slot.block || !slot.kind || !slot.target || !slot.symbol) {
      throw new CompilerError('PLAN-VALIDATION-006', `Slot "${slot?.id ?? '<unknown>'}" is incomplete`);
    }
    if (!isCanonicalBlockId(slot.block)) {
      throw new CompilerError(
        'PLAN-VALIDATION-006',
        `Slot "${slot.id}" references a non-canonical block id "${String(slot.block)}"`
      );
    }
    if (slot.kind !== 'adapter' && slot.kind !== 'policy' && slot.kind !== 'ux' && slot.kind !== 'repair') {
      throw new CompilerError(
        'PLAN-VALIDATION-020',
        `Slot "${slot.id}" has unsupported kind "${String(slot.kind)}"`
      );
    }
    if (slotIds.has(slot.id)) {
      throw new CompilerError('PLAN-VALIDATION-007', `Duplicate slot id "${slot.id}"`);
    }
    if (!blockIds.has(slot.block)) {
      throw new CompilerError('PLAN-REFERENCE-002', `Slot "${slot.id}" references unknown block "${slot.block}"`);
    }
    if (!isSafeRelativePath(slot.target) || !slot.target.startsWith('custom/')) {
      throw new CompilerError('PLAN-VALIDATION-008', `Slot "${slot.id}" must target custom/ in v0.1`);
    }
    if (
      slot.sourcePath &&
      (!isSafeRelativePath(slot.sourcePath) ||
        (!slot.sourcePath.startsWith('source/code/slots/') && !slot.sourcePath.startsWith('source/slots/')))
    ) {
      throw new CompilerError('PLAN-VALIDATION-013', `Slot "${slot.id}" sourcePath must target source/code/slots/`);
    }
    slotIds.add(slot.id);
  }

  if (!Array.isArray(plan.acceptance)) {
    throw new CompilerError('PLAN-VALIDATION-021', 'acceptance must be an array');
  }
}

export async function loadPlan(planPath: string): Promise<PlanFile> {
  const plan = normalizePlan(await readYaml<PlanFile>(planPath));
  validatePlan(plan);
  return plan;
}

export async function loadWorkspacePlan(workspaceRoot: string): Promise<PlanFile> {
  return loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
}
