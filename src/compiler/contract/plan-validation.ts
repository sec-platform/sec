import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { posixPath } from '../../contracts/relative-path.ts';
import { isCanonicalAcceptanceId } from '../../semantics/acceptance/identity.ts';
import {
  isCanonicalBlockId,
  isCanonicalRegistryVersion
} from '../../semantics/identity/block.ts';
import { CompilerError } from '../errors.ts';
import type { PlanFile, PlanRegistry, PlanRegistrySource } from './plan-manifest.ts';
import {
  AppModeSchema,
  PackageManagerSchema,
  PlanInputSchema,
  PlanRegistrySourceSchema,
  type PlanRegistrySourceInput
} from './plan-schema.ts';
import { SUPPORTED_STACK } from './target.ts';

export interface PlanNormalizationRegistryDefaults {
  readonly officialPath: string;
  readonly privatePath: string;
}

function defaultRegistry(
  defaults: PlanNormalizationRegistryDefaults
): PlanRegistry {
  return {
    sources: [
      {
        id: 'official',
        kind: 'official',
        location: 'compiler',
        path: posixPath(defaults.officialPath)
      },
      {
        id: 'private',
        kind: 'private',
        location: 'workspace',
        path: posixPath(defaults.privatePath)
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
  throw new CompilerError(
    code,
    `Plan structure is invalid at ${issue.path.join('.') || '<root>'}: ${issue.message}`,
    {},
    { cause: parsed.error }
  );
}

function normalizeRegistrySource(
  source: PlanRegistrySourceInput,
  defaults: PlanNormalizationRegistryDefaults
): PlanRegistrySource {
  const kind = source.kind ?? 'private';
  return {
    id: source.id ?? '',
    kind,
    location: source.location ?? (kind === 'official' ? 'compiler' : 'workspace'),
    path: source.path ?? posixPath(
      kind === 'official' ? defaults.officialPath : defaults.privatePath
    )
  };
}

/** Normalize one decoded Plan value without knowing any host/runtime layout. */
export function normalizePlan(
  plan: unknown,
  defaults: PlanNormalizationRegistryDefaults
): PlanFile {
  if (defaults === null || typeof defaults !== 'object' ||
      typeof defaults.officialPath !== 'string' ||
      typeof defaults.privatePath !== 'string') {
    throw new TypeError('Plan normalization registry defaults must provide string paths');
  }
  const officialPath = posixPath(defaults.officialPath);
  const privatePath = posixPath(defaults.privatePath);
  if (!isCanonicalPortableLogicalPath(officialPath) ||
      !isCanonicalPortableLogicalPath(privatePath)) {
    throw new TypeError('Plan normalization registry defaults must be canonical portable paths');
  }
  const effectiveDefaults = Object.freeze({ officialPath, privatePath });
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
      sources: (normalized.registry?.sources ?? defaultRegistry(effectiveDefaults).sources)
        .map(source => normalizeRegistrySource(source, effectiveDefaults))
    },
    blocks: normalized.blocks ?? [],
    acceptance: (normalized.acceptance ?? []) as PlanFile['acceptance']
  };
}

/** Validate one normalized Plan against compiler-level identities and invariants. */
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
      throw new CompilerError(
        field === 'kind' ? 'PLAN-VALIDATION-017'
          : field === 'location' ? 'PLAN-VALIDATION-018' : 'PLAN-VALIDATION-009',
        'Registry source requires string id/path and a supported kind/location',
        {},
        { cause: decoded.error }
      );
    }
    const source = decoded.data;
    if (!source.id || !source.path) {
      throw new CompilerError(
        'PLAN-VALIDATION-009',
        'Every registry source requires id/kind/location/path'
      );
    }
    if (registryIds.has(source.id)) {
      throw new CompilerError(
        'PLAN-VALIDATION-010',
        `Duplicate registry source id "${source.id}"`
      );
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
      throw new CompilerError(
        'PLAN-VALIDATION-005',
        `Duplicate block id "${block.id}"`
      );
    }
    blockIds.add(block.id);
  }

  if (!Array.isArray(plan.acceptance)) {
    throw new CompilerError('PLAN-VALIDATION-021', 'acceptance must be an array');
  }
  const acceptanceIds = new Set<string>();
  for (const acceptance of plan.acceptance) {
    if (!acceptance || typeof acceptance !== 'object' ||
        !isCanonicalAcceptanceId(acceptance.id)) {
      throw new CompilerError(
        'PLAN-VALIDATION-025',
        `Acceptance id "${String(acceptance?.id)}" is not one canonical lowercase logical identity`
      );
    }
    if (acceptanceIds.has(acceptance.id)) {
      throw new CompilerError(
        'PLAN-VALIDATION-026',
        `Duplicate Acceptance id "${acceptance.id}"`
      );
    }
    acceptanceIds.add(acceptance.id);
  }
}
