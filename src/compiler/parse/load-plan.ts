import path from 'node:path';
import YAML from 'yaml';

import { isCanonicalAcceptanceId } from '../../semantic/acceptance/contract/identity.ts';
import { isCanonicalBlockId, isCanonicalRegistryVersion } from '../../semantic/identity/contract/block.ts';
import { isCanonicalSlotId } from '../../semantic/identity/contract/slot.ts';
import { isCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { getWorkspacePaths, officialRegistryRelativePath, posixPath, privateRegistryRelativePath } from '../../workspace/paths.ts';
import type { PlanFile, PlanRegistry, PlanRegistrySource } from '../contract.ts';
import { SUPPORTED_STACK } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { readOptionalAuthorityBytes } from './read-authority-source.ts';

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
        id: 'private',
        kind: 'private',
        location: 'workspace',
        path: posixPath(privateRegistryRelativePath)
      }
    ]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertRawPlanShape(value: unknown): asserts value is Partial<PlanFile> {
  if (!isRecord(value)) {
    throw new CompilerError('PLAN-VALIDATION-022', 'Plan root must be one object');
  }
  if (value.app !== undefined && !isRecord(value.app)) {
    throw new CompilerError('PLAN-VALIDATION-022', 'app must be one object');
  }
  if (value.registry !== undefined) {
    if (!isRecord(value.registry)) {
      throw new CompilerError('PLAN-VALIDATION-009', 'registry must be one object');
    }
    if (value.registry.sources !== undefined) {
      if (!Array.isArray(value.registry.sources)) {
        throw new CompilerError('PLAN-VALIDATION-009', 'registry.sources must be an array');
      }
      if (value.registry.sources.some((source) => !isRecord(source))) {
        throw new CompilerError('PLAN-VALIDATION-009', 'Every registry source must be one object');
      }
    }
  }
  for (const [field, code] of [
    ['blocks', 'PLAN-VALIDATION-004'],
    ['slots', 'PLAN-VALIDATION-006'],
    ['acceptance', 'PLAN-VALIDATION-021']
  ] as const) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new CompilerError(code, `${field} must be an array`);
    }
  }
}

function normalizeRegistrySource(source: Partial<PlanRegistrySource>): PlanRegistrySource {
  const kind = source.kind ?? 'private';
  return {
    id: source.id ?? '',
    kind,
    location: source.location ?? (kind === 'official' ? 'compiler' : 'workspace'),
    path: source.path ?? (kind === 'official' ? posixPath(officialRegistryRelativePath) : posixPath(privateRegistryRelativePath))
  };
}

export function normalizePlan(plan: PlanFile): PlanFile {
  assertRawPlanShape(plan as unknown);
  const normalized = structuredClone(plan as Partial<PlanFile>);
  return {
    app: {
      id: normalized.app?.id ?? '',
      name: normalized.app?.name ?? '',
      stack: normalized.app?.stack ?? '',
      packageManager: normalized.app?.packageManager ?? 'pnpm',
      mode: normalized.app?.mode ?? 'single-tenant'
    },
    registry: {
      sources: (normalized.registry?.sources ?? defaultRegistry().sources)
        .map((source) => normalizeRegistrySource(source))
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
    if (!isCanonicalPortableLogicalPath(source.path)) {
      throw new CompilerError(
        'PLAN-VALIDATION-012',
        `Registry source "${source.id}" must use one canonical portable relative path`
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
    if (!slot || typeof slot !== 'object' || !slot.block || !slot.kind || !slot.target || !slot.symbol) {
      throw new CompilerError('PLAN-VALIDATION-006', `Slot "${slot?.id ?? '<unknown>'}" is incomplete`);
    }
    if (!isCanonicalSlotId(slot.id)) {
      throw new CompilerError(
        'PLAN-VALIDATION-024',
        `Slot id "${String(slot.id)}" is not one canonical lowercase logical identity`
      );
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
    if (!isCanonicalPortableLogicalPath(slot.target) || !slot.target.startsWith('custom/')) {
      throw new CompilerError('PLAN-VALIDATION-008', `Slot "${slot.id}" must target canonical custom/ path in v0.1`);
    }
    if (
      slot.sourcePath &&
      (!isCanonicalPortableLogicalPath(slot.sourcePath) ||
        (!slot.sourcePath.startsWith('source/code/slots/') && !slot.sourcePath.startsWith('source/slots/')))
    ) {
      throw new CompilerError('PLAN-VALIDATION-013', `Slot "${slot.id}" sourcePath must target canonical source/code/slots/ path`);
    }
    slotIds.add(slot.id);
  }

  if (!Array.isArray(plan.acceptance)) {
    throw new CompilerError('PLAN-VALIDATION-021', 'acceptance must be an array');
  }
  const acceptanceIds = new Set<string>();
  for (const acceptance of plan.acceptance) {
    if (!acceptance || typeof acceptance !== 'object' || !isCanonicalAcceptanceId(acceptance.id)) {
      throw new CompilerError(
        'PLAN-VALIDATION-025',
        `Acceptance id "${String(acceptance?.id)}" is not one canonical lowercase logical identity`
      );
    }
    if (acceptanceIds.has(acceptance.id)) {
      throw new CompilerError('PLAN-VALIDATION-026', `Duplicate Acceptance id "${acceptance.id}"`);
    }
    acceptanceIds.add(acceptance.id);
  }
}

function decodePlanUtf8(bytes: Uint8Array, planPath: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new CompilerError(
      'PLAN-VALIDATION-023',
      `Plan at "${planPath}" is not exact UTF-8`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

function readPlanSourceNoFollow(planPath: string): string | null {
  const bytes = readOptionalAuthorityBytes(planPath, 'Plan');
  return bytes === null ? null : decodePlanUtf8(bytes, path.resolve(planPath));
}

function parsePlanSource(raw: string): PlanFile {
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw) as unknown;
  } catch (error) {
    throw new CompilerError(
      'PLAN-VALIDATION-022',
      `Plan YAML is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const plan = normalizePlan(parsed as PlanFile);
  validatePlan(plan);
  return plan;
}

function missingPlanError(planPath: string): NodeJS.ErrnoException {
  const error = new Error(`Plan file not found: ${path.resolve(planPath)}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  error.path = path.resolve(planPath);
  return error;
}

/** Retained Plan authority observation/parse is synchronous. */
export function loadPlan(planPath: string): PlanFile {
  const raw = readPlanSourceNoFollow(planPath);
  if (raw === null) throw missingPlanError(planPath);
  return parsePlanSource(raw);
}

export function loadWorkspacePlan(workspaceRoot: string): PlanFile {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const canonicalRaw = readPlanSourceNoFollow(planPath);
  if (canonicalRaw !== null) return parsePlanSource(canonicalRaw);
  throw missingPlanError(planPath);
}
