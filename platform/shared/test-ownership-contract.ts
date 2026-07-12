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

export type TestOwnershipDeclaration = {
  owner: string;
  identity: TestOwnershipIdentity;
  sourceFiles?: readonly string[];
  sourcePrefixes?: readonly string[];
  sourceKinds?: readonly TestImpactSourceKind[];
  fast: readonly string[];
  slow: readonly string[];
};

export type ResolvedTestOwnership = {
  source: string;
  owner: string;
  identity: TestOwnershipIdentity;
};

export function classifyTestImpactSource(file: string): TestImpactSourceKind | null {
  if (/(?:^|\/)contracts\/[^/]+\.ya?ml$/u.test(file)) return 'semantic-contract';
  if (/(?:^|\/)(?:block\.)?manifest\.ya?ml$/u.test(file) || /(?:^|\/)[^/]+\.manifest\.ya?ml$/u.test(file)) return 'manifest';
  if (/^source\//u.test(file)) return 'source-model';
  if (/\.[cm]?tsx?$/u.test(file)) return 'typescript';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/u.test(file)) return 'workflow';
  if (/^docs\/.+\.md$/u.test(file)) return 'active-documentation';
  if (/^(?:package\.json|bun\.lock)$/u.test(file)) return 'repository-config';
  return null;
}

export function matchesTestOwnershipDeclaration(
  declaration: TestOwnershipDeclaration,
  file: string
): boolean {
  const sourceKind = classifyTestImpactSource(file);
  return declaration.sourceFiles?.includes(file) === true
    || declaration.sourcePrefixes?.some((prefix) => file.startsWith(prefix)) === true
    || (sourceKind !== null && declaration.sourceKinds?.includes(sourceKind) === true);
}

export function resolveDeclaredTestOwnership(
  files: readonly string[],
  declarations: readonly TestOwnershipDeclaration[]
): ResolvedTestOwnership[] {
  return files.flatMap((source) => declarations
    .filter((declaration) => matchesTestOwnershipDeclaration(declaration, source))
    .map((declaration) => ({
      source,
      owner: declaration.owner,
      identity: declaration.identity
    })));
}
