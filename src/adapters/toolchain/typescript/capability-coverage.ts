import { compareCodeUnits, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../contracts/exact-json.ts';
import {
  assertTypeScriptRequiredApiClosure,
  type TypeScriptRequiredApiClosure
} from '../../repository/source-program-model/typescript.ts';
import {
  assertTypeScriptNativeChecker,
  type InstalledTypeScriptNativeChecker
} from './checker.ts';

export interface TypeScriptDependencyBinding {
  readonly declaredName: string;
  readonly packageName: string;
  readonly resolvedVersion: string;
}

type TypeScriptCapabilityCoverageReason =
  | 'authoring-api-unused'
  | 'authoring-api-unresolved'
  | 'authoring-dependency-mismatch'
  | 'native-dependency-mismatch'
  | 'native-manifest-digest-mismatch'
  | 'native-manifest-invalid';

const typeScriptCapabilityCoverageBrand: unique symbol = Symbol('typescript-capability-coverage');
const issuedTypeScriptCapabilityCoverage = new WeakSet<object>();

interface TypeScriptCapabilityCoverageBase {
  readonly [typeScriptCapabilityCoverageBrand]: true;
  readonly authoringDependency: TypeScriptDependencyBinding;
  readonly coverageDigest: `sha256:${string}`;
  readonly nativeDependency: TypeScriptDependencyBinding;
  readonly requiredApiClosureDigest: `sha256:${string}`;
}

export type TypeScriptCapabilityCoverageDecision = Readonly<
  | TypeScriptCapabilityCoverageBase & {
    readonly status: 'intentional-pair';
    readonly authoringApiRequirementCount: number;
    readonly nativeCapability: 'typescript-project-typecheck';
    readonly nativeProviderBindingDigest: `sha256:${string}`;
    readonly exitCondition: Readonly<{
      readonly status: 'blocked';
      readonly reason: 'stable-authoring-api-coverage-unproven';
      readonly observedStableModuleEntrypoints: readonly string[];
      readonly requiredApiClosureDigest: `sha256:${string}`;
    }>;
  }
  | TypeScriptCapabilityCoverageBase & {
    readonly status: 'unresolved';
    readonly reason: TypeScriptCapabilityCoverageReason;
  }
>;

export function assertTypeScriptCapabilityCoverageDecision(
  decision: TypeScriptCapabilityCoverageDecision
): void {
  if (!issuedTypeScriptCapabilityCoverage.has(decision)) {
    throw new Error('TypeScript capability coverage decision is not TypeScript-owner issued');
  }
}

function exactVersion(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u.test(value);
}

function stableModuleEntrypoints(exportsValue: unknown): readonly string[] {
  const keys = typeof exportsValue === 'string'
    ? ['.']
    : exportsValue !== null && typeof exportsValue === 'object' && !Array.isArray(exportsValue)
      ? Object.keys(exportsValue)
      : [];
  return Object.freeze(keys.filter((key) => (
    key === '.'
    || (key.startsWith('./') && !key.split('/').includes('unstable'))
  )).sort(compareCodeUnits));
}

function issueUnresolved(
  reason: TypeScriptCapabilityCoverageReason,
  authoringDependency: TypeScriptDependencyBinding,
  nativeDependency: TypeScriptDependencyBinding,
  requiredApiClosureDigest: `sha256:${string}`
): TypeScriptCapabilityCoverageDecision {
  const projection = Object.freeze({
    authoringDependency: Object.freeze({ ...authoringDependency }),
    nativeDependency: Object.freeze({ ...nativeDependency }),
    reason,
    requiredApiClosureDigest,
    status: 'unresolved' as const
  });
  const decision = Object.freeze({
    [typeScriptCapabilityCoverageBrand]: true as const,
    ...projection,
    coverageDigest: sha256(projection) as `sha256:${string}`
  });
  issuedTypeScriptCapabilityCoverage.add(decision);
  return decision;
}

/**
 * Compile the reason the current two TypeScript generations both exist.
 * Source Program owns the exact stable authoring API uses. The native checker
 * owns only project checking. A future single-generation exit remains blocked
 * until a stable authoring provider proves the same closure; unstable exports
 * are deliberately excluded from that projection.
 */
export function compileTypeScriptCapabilityCoverage(input: Readonly<{
  readonly authoringDependency: TypeScriptDependencyBinding;
  readonly nativeChecker: InstalledTypeScriptNativeChecker;
  readonly nativeDependency: TypeScriptDependencyBinding;
  readonly nativePackageManifestBytes: Uint8Array;
  readonly requiredApiClosure: TypeScriptRequiredApiClosure;
}>): TypeScriptCapabilityCoverageDecision {
  assertTypeScriptRequiredApiClosure(input.requiredApiClosure);
  assertTypeScriptNativeChecker(input.nativeChecker);
  const requiredApiClosureDigest = input.requiredApiClosure.closureDigest;
  if (input.requiredApiClosure.unknowns.length > 0) {
    return issueUnresolved(
      'authoring-api-unresolved',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  if (input.requiredApiClosure.requirements.length === 0) {
    return issueUnresolved(
      'authoring-api-unused',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  if (input.authoringDependency.packageName !== input.requiredApiClosure.authoringPackageName
      || input.authoringDependency.resolvedVersion
        !== input.requiredApiClosure.authoringProviderRevision) {
    return issueUnresolved(
      'authoring-dependency-mismatch',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  const provider = input.nativeChecker.provider;
  if (input.nativeDependency.declaredName !== provider.packageAlias
      || input.nativeDependency.packageName !== provider.packageName) {
    return issueUnresolved(
      'native-dependency-mismatch',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  if (rawSha256(input.nativePackageManifestBytes) !== provider.packageManifestDigest) {
    return issueUnresolved(
      'native-manifest-digest-mismatch',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  let manifest: unknown;
  try {
    manifest = parseExactJsonBytes(
      input.nativePackageManifestBytes,
      'TypeScript native capability manifest',
      { maximumInputBytes: 1_048_576, maximumDepth: 32 }
    );
  } catch {
    return issueUnresolved(
      'native-manifest-invalid',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return issueUnresolved(
      'native-manifest-invalid',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  const fields = manifest as Record<string, unknown>;
  if (fields.name !== provider.packageName
      || !exactVersion(fields.version)
      || fields.version !== input.nativeDependency.resolvedVersion
      || Bun.semver.order(
        input.nativeDependency.resolvedVersion,
        input.authoringDependency.resolvedVersion
      ) <= 0) {
    return issueUnresolved(
      'native-dependency-mismatch',
      input.authoringDependency,
      input.nativeDependency,
      requiredApiClosureDigest
    );
  }
  const observedStableModuleEntrypoints = stableModuleEntrypoints(fields.exports);
  const projection = Object.freeze({
    authoringApiRequirementCount: input.requiredApiClosure.requirements.length,
    authoringDependency: Object.freeze({ ...input.authoringDependency }),
    exitCondition: Object.freeze({
      status: 'blocked' as const,
      reason: 'stable-authoring-api-coverage-unproven' as const,
      observedStableModuleEntrypoints,
      requiredApiClosureDigest
    }),
    nativeCapability: provider.capability,
    nativeDependency: Object.freeze({ ...input.nativeDependency }),
    nativeProviderBindingDigest: provider.toolchainBindingDigest,
    requiredApiClosureDigest,
    status: 'intentional-pair' as const
  });
  const decision = Object.freeze({
    [typeScriptCapabilityCoverageBrand]: true as const,
    ...projection,
    coverageDigest: sha256(projection) as `sha256:${string}`
  });
  issuedTypeScriptCapabilityCoverage.add(decision);
  return decision;
}
