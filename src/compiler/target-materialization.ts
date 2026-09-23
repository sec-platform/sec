import { CompilerError } from './errors.ts';

export const OPAQUE_MODULE_MATERIALIZATION_MODES = Object.freeze([
  'workspace-link',
  'build-copy'
] as const);

export type OpaqueModuleMaterializationMode =
  (typeof OPAQUE_MODULE_MATERIALIZATION_MODES)[number];

export type OpaqueModuleMaterializationEnvironment = Readonly<{
  NODE_ENV?: string;
  SEC_BUILD_MODE?: string;
  BUILD_MODE?: string;
}>;

type MaterializationCandidate = Readonly<{
  mode: OpaqueModuleMaterializationMode;
  source: keyof OpaqueModuleMaterializationEnvironment;
}>;

function legacyBooleanCandidate(
  source: 'SEC_BUILD_MODE' | 'BUILD_MODE',
  value: string | undefined
): MaterializationCandidate | null {
  if (value === undefined) return null;
  if (value === 'true') return { source, mode: 'build-copy' };
  if (value === 'false') return { source, mode: 'workspace-link' };
  throw new CompilerError(
    'OPAQUE-MODULE-004',
    `${source} must be exactly "true" or "false" when used as a legacy opaque-module materialization input`,
    { source, value }
  );
}

/**
 * Resolve one semantic materialization mode from explicit input or legacy
 * environment candidates. Explicit typed input owns the decision. Legacy
 * candidates are admitted only at the orchestration boundary and conflicting
 * candidates fail closed instead of being combined with boolean OR.
 */
export function resolveOpaqueModuleMaterializationMode(
  explicitMode: OpaqueModuleMaterializationMode | undefined,
  environment: OpaqueModuleMaterializationEnvironment
): OpaqueModuleMaterializationMode {
  if (explicitMode !== undefined) {
    // TypeScript types do not validate JavaScript/configuration callers.
    if (explicitMode !== 'workspace-link' && explicitMode !== 'build-copy') {
      throw new CompilerError(
        'OPAQUE-MODULE-004',
        'Explicit opaque-module materialization mode is unsupported',
        { value: explicitMode }
      );
    }
    return explicitMode;
  }

  const candidates: MaterializationCandidate[] = [];
  if (environment.NODE_ENV === 'production') {
    candidates.push({ source: 'NODE_ENV', mode: 'build-copy' });
  }
  for (const candidate of [
    legacyBooleanCandidate('SEC_BUILD_MODE', environment.SEC_BUILD_MODE),
    legacyBooleanCandidate('BUILD_MODE', environment.BUILD_MODE)
  ]) {
    if (candidate !== null) candidates.push(candidate);
  }

  const modes = new Set(candidates.map((candidate) => candidate.mode));
  if (modes.size > 1) {
    throw new CompilerError(
      'OPAQUE-MODULE-004',
      'Opaque-module materialization inputs conflict',
      {
        candidates: candidates.map(({ source, mode }) => ({ source, mode }))
      }
    );
  }

  return candidates[0]?.mode ?? 'workspace-link';
}

export function opaqueModuleMaterializationEnvironment(
  environment: NodeJS.ProcessEnv
): OpaqueModuleMaterializationEnvironment {
  return Object.freeze({
    NODE_ENV: environment.NODE_ENV,
    SEC_BUILD_MODE: environment.SEC_BUILD_MODE,
    BUILD_MODE: environment.BUILD_MODE
  });
}
