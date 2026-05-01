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

  const registryIds = new Set<string>();
  for (const source of plan.registry.sources) {
    if (!source.id || !source.kind || !source.location || !source.path) {
      throw new CompilerError('PLAN-VALIDATION-009', 'Every registry source requires id/kind/location/path');
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

  const blockIds = new Set<string>();
  for (const block of plan.blocks) {
    if (!block?.id) {
      throw new CompilerError('PLAN-VALIDATION-004', 'Every block entry requires id');
    }
    if (blockIds.has(block.id)) {
      throw new CompilerError('PLAN-VALIDATION-005', `Duplicate block id "${block.id}"`);
    }
    blockIds.add(block.id);
  }

  const slotIds = new Set<string>();
  for (const slot of plan.slots) {
    if (!slot?.id || !slot?.block || !slot?.kind || !slot?.target || !slot?.symbol) {
      throw new CompilerError('PLAN-VALIDATION-006', `Slot "${slot?.id ?? '<unknown>'}" is incomplete`);
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
}

export async function loadPlan(planPath: string): Promise<PlanFile> {
  const plan = normalizePlan(await readYaml<PlanFile>(planPath));
  validatePlan(plan);
  return plan;
}

export async function loadWorkspacePlan(workspaceRoot: string): Promise<PlanFile> {
  return loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
}
