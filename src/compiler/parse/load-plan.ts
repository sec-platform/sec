import path from 'node:path';
import { parseYamlValue } from '../../system-architecture/foundation/runtime/yaml.ts';
import { failureMessage } from '../../system-architecture/foundation/runtime/failure-inspection.ts';
import { AppModeSchema, PackageManagerSchema, PlanInputSchema, PlanRegistrySourceSchema, type PlanRegistrySourceInput } from '../contract/plan-schema.ts';

import { isCanonicalAcceptanceId } from '../../semantic/acceptance/contract/identity.ts';
import { isCanonicalBlockId, isCanonicalRegistryVersion } from '../../semantic/identity/contract/block.ts';
import { isCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { getWorkspacePaths, officialRegistryRelativePath, posixPath, privateRegistryRelativePath } from '../../workspace/runtime/paths.ts';
import type { PlanFile, PlanRegistry, PlanRegistrySource } from '../contract.ts';
import { SUPPORTED_STACK } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { readOptionalAuthorityBytes } from './read-authority-source.ts';

// Independent domain admission limits; do not couple a plan's policy to the
// current semantic-contract or manifest limit merely because their values match.
export const PLAN_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const PLAN_YAML_MAX_ALIAS_COUNT = 100;

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

function parsePlanInput(value: unknown) {
  const parsed = PlanInputSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0]!;
  const [root, field] = issue.path;
  const code = root === 'registry'
    ? issue.path.at(-1) === 'kind' ? 'PLAN-VALIDATION-017'
      : issue.path.at(-1) === 'location' ? 'PLAN-VALIDATION-018' : 'PLAN-VALIDATION-009'
    : root === 'blocks' ? issue.path.at(-1) === 'version' ? 'PLAN-VALIDATION-019' : 'PLAN-VALIDATION-004'
    : root === 'acceptance' ? 'PLAN-VALIDATION-021'
    : root === 'app' && field === 'packageManager' ? 'PLAN-VALIDATION-015'
    : root === 'app' && field === 'mode' ? 'PLAN-VALIDATION-016'
    : 'PLAN-VALIDATION-022';
  throw new CompilerError(code,
    `Plan structure is invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`,
    {}, { cause: parsed.error });
}

function normalizeRegistrySource(source: PlanRegistrySourceInput): PlanRegistrySource {
  const kind = source.kind ?? 'private';
  return {
    id: source.id ?? '',
    kind,
    location: source.location ?? (kind === 'official' ? 'compiler' : 'workspace'),
    path: source.path ?? (kind === 'official' ? posixPath(officialRegistryRelativePath) : posixPath(privateRegistryRelativePath))
  };
}

export function normalizePlan(plan: unknown): PlanFile {
  const normalized = parsePlanInput(structuredClone(plan));
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
    acceptance: (normalized.acceptance ?? []) as PlanFile['acceptance']
  };
}

export function validatePlan(plan: PlanFile): void {
  if (typeof plan?.app?.id !== 'string' || !plan.app.id.trim()) {
    throw new CompilerError('PLAN-VALIDATION-014', 'Missing app.id');
  }
  if (typeof plan?.app?.name !== 'string' || !plan.app.name) {
    throw new CompilerError('PLAN-VALIDATION-001', 'Missing app.name');
  }
  if (typeof plan?.app?.stack !== 'string' || !plan.app.stack) {
    throw new CompilerError('PLAN-VALIDATION-002', 'Missing app.stack');
  }
  if (plan.app.stack !== SUPPORTED_STACK) {
    throw new CompilerError(
      'PLAN-VALIDATION-003',
      `Unsupported stack "${plan.app.stack}", expected "${SUPPORTED_STACK}"`
    );
  }
  if (!PackageManagerSchema.safeParse(plan.app.packageManager).success) {
    throw new CompilerError(
      'PLAN-VALIDATION-015',
      `Unsupported packageManager "${String(plan.app.packageManager)}"`
    );
  }
  if (!AppModeSchema.safeParse(plan.app.mode).success) {
    throw new CompilerError(
      'PLAN-VALIDATION-016',
      `Unsupported app mode "${String(plan.app.mode)}"`
    );
  }

  if (!Array.isArray(plan.registry?.sources)) {
    throw new CompilerError('PLAN-VALIDATION-009', 'registry.sources must be an array');
  }
  const registryIds = new Set<string>();
  for (const candidate of plan.registry.sources) {
    const decoded = PlanRegistrySourceSchema.safeParse(candidate);
    if (!decoded.success) {
      const field = decoded.error.issues[0]?.path[0];
      throw new CompilerError(field === 'kind' ? 'PLAN-VALIDATION-017'
        : field === 'location' ? 'PLAN-VALIDATION-018' : 'PLAN-VALIDATION-009',
        'Registry source requires string id/path and a supported kind/location', {}, { cause: decoded.error });
    }
    const source = decoded.data;
    if (!source.id || !source.path) {
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
      { cause: failureMessage(error) },
      { cause: error }
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
    parsed = parseYamlValue(raw, { label: 'Plan',
      maximumInputBytes: PLAN_YAML_MAX_INPUT_BYTES,
      stringKeys: true, maximumAliasCount: PLAN_YAML_MAX_ALIAS_COUNT });
  } catch (error) {
    throw new CompilerError(
      'PLAN-VALIDATION-022',
      `Plan YAML is invalid: ${failureMessage(error)}`, {}, { cause: error }
    );
  }
  const plan = normalizePlan(parsed);
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
  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const canonicalRaw = readPlanSourceNoFollow(workspaceConfigPath);
  if (canonicalRaw !== null) return parsePlanSource(canonicalRaw);
  throw missingPlanError(workspaceConfigPath);
}
