import { CodexDevelopmentIsActiveDocumentationPathV1 } from './active-documentation-contract.ts';
import type { CodexDevelopmentTestImpactTransitionObservationV1 } from './ci-git-changed-files.ts';
import type { PassId } from './pipeline-types.ts';

export const TEST_IMPACT_SOURCE_KINDS = [
  'typescript',
  'manifest',
  'semantic-contract',
  'source-model',
  'workflow',
  'active-documentation',
  'repository-config'
] as const;

export type TestImpactSourceKind = (typeof TEST_IMPACT_SOURCE_KINDS)[number];

export type TestOwnershipIdentity =
  | { kind: 'architecture-owner'; id: string }
  | { kind: 'pass'; id: PassId }
  | { kind: 'contract'; id: string };

/**
 * Controls whether a matched ownership declaration may add reverse-import
 * consumers to its explicit evidence closure.
 *
 * `declared-only` is intentionally opt-in. It is for registries whose own
 * declaration is the complete authority for scheduling; inferring consumers
 * from imports would create a second, moving risk truth.
 */
export type TestOwnershipClosureMode = 'include' | 'declared-only';
export type TestOwnershipRiskProfile = 'focused' | 'bounded-baseline';

export type TestOwnershipDeclaration = {
  owner: string;
  identity: TestOwnershipIdentity;
  closureMode?: TestOwnershipClosureMode;
  riskProfile?: TestOwnershipRiskProfile;
  sourceFiles?: readonly string[];
  excludedSourceFiles?: readonly string[];
  sourcePrefixes?: readonly string[];
  sourceKinds?: readonly TestImpactSourceKind[];
  removedSourceTransitions?: readonly Readonly<{
    path: string;
    baseSha: string;
    baseMode: '100644' | '100755';
    baseBlobSha: string;
  }>[];
  /** Behavior/physical evidence that cannot be inferred from module imports. */
  supplementalFast: readonly string[];
  /** Slow behavior/physical evidence that cannot be inferred from module imports. */
  supplementalSlow: readonly string[];
};

/**
 * Resolve one closure mode for a matched declaration set.
 *
 * A source can match multiple owners, but those owners must agree on whether
 * reverse-import consumers are part of the closure. A conflict is an
 * authority error and therefore fails closed instead of silently choosing one
 * mode based on declaration order.
 */
export function resolveTestOwnershipClosureMode(
  declarations: readonly TestOwnershipDeclaration[]
): TestOwnershipClosureMode {
  const modes = [...new Set(declarations.map((declaration) => (
    declaration.closureMode ?? 'include'
  )))];
  if (modes.length > 1) {
    throw new Error('Test ownership declarations contain conflicting closure modes.');
  }
  return modes[0] ?? 'include';
}

export function resolveTestOwnershipRiskProfile(
  declarations: readonly TestOwnershipDeclaration[]
): TestOwnershipRiskProfile {
  return declarations.some((declaration) => declaration.riskProfile === 'bounded-baseline')
    ? 'bounded-baseline'
    : 'focused';
}

export type ResolvedTestOwnership = {
  source: string;
  owner: string;
  identity: TestOwnershipIdentity;
};

export function classifyTestImpactSource(file: string): TestImpactSourceKind | null {
  if (CodexDevelopmentIsActiveDocumentationPathV1(file)) return 'active-documentation';
  if (/^docs\//u.test(file)) return null;
  if (/(?:^|\/)contracts\/[^/]+\.ya?ml$/u.test(file)) return 'semantic-contract';
  if (/(?:^|\/)(?:block\.)?manifest\.ya?ml$/u.test(file) || /(?:^|\/)[^/]+\.manifest\.ya?ml$/u.test(file)) return 'manifest';
  if (/^source\//u.test(file)) return 'source-model';
  if (/\.[cm]?tsx?$/u.test(file)) return 'typescript';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(file)) return 'workflow';
  if (/^(?:package\.json|bun\.lock)$/u.test(file)) return 'repository-config';
  return null;
}

export function matchesTestOwnershipDeclaration(
  declaration: TestOwnershipDeclaration,
  file: string,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): boolean {
  if (declaration.excludedSourceFiles?.includes(file) === true) return false;
  const sourceKind = classifyTestImpactSource(file);
  return declaration.sourceFiles?.includes(file) === true
    || declaration.sourcePrefixes?.some((prefix) => file.startsWith(prefix)) === true
    || (sourceKind !== null && declaration.sourceKinds?.includes(sourceKind) === true)
    || declaration.removedSourceTransitions?.some((rule) => (
      transition?.baseSha === rule.baseSha
      && transition.records.filter((record) => (
        record.path === file || record.previousPath === file
      )).length === 1
      && transition.records.some((record) => (
        record.status === 'removed' && record.path === file && record.previousPath === undefined
      ))
      && transition.removedPathBlobs.some((observation) => (
        observation.path === file
        && observation.baseMode === rule.baseMode
        && observation.baseBlobSha === rule.baseBlobSha
        && observation.headMode === null
        && observation.headBlobSha === null
      ))
      && rule.path === file
    )) === true;
}

export function resolveDeclaredTestOwnership(
  files: readonly string[],
  declarations: readonly TestOwnershipDeclaration[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): ResolvedTestOwnership[] {
  return files.flatMap((source) => {
    const matched = declarations.filter((declaration) => (
      matchesTestOwnershipDeclaration(declaration, source, transition)
    ));
    resolveTestOwnershipClosureMode(matched);
    resolveTestOwnershipRiskProfile(matched);
    return matched.map((declaration) => ({
      source,
      owner: declaration.owner,
      identity: declaration.identity
    }));
  });
}
