import { uniqueSorted } from './collections.ts';
import { isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';
import {
  isTestImpactSourceFile,
  resolveTestImpactSelectionTrustBoundary,
  selectTestsForSources,
  type CodexDevelopmentTestImpactSourceProviderV1
} from './test-impact-contract.ts';
import type { VerificationGateResultV1 } from './verification-result-contract.ts';

export type CodexDevelopmentAffectedTestInventoryV1 = {
  changedFastTests: string[];
  changedSlowTests: string[];
  affectedFastTests: string[];
  affectedSlowTests: string[];
  selectedFastTests: string[];
  selectedSlowTests: string[];
  affectedOwners: string[];
  sourceChanged: boolean;
  selectionResolved: boolean;
  unresolvedTestFiles: string[];
};

export function CodexDevelopmentAffectedInventoryInputsV1(
  changedPaths: readonly string[],
  currentTestPathIsRunnable: (file: string) => boolean
): string[] {
  return uniqueSorted(changedPaths.filter((file) => (
    (!isFastTestFile(file) && !isSlowTestFile(file)) || currentTestPathIsRunnable(file)
  )));
}

export function CodexDevelopmentBuildAffectedTestInventoryV1(
  files: readonly string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): CodexDevelopmentAffectedTestInventoryV1 {
  const changedFastTests = uniqueSorted(files.filter(isFastTestFile));
  const changedSlowTests = uniqueSorted(files.filter(isSlowTestFile));
  const impactSourceFiles = files.filter(isTestImpactSourceFile);
  const impact = selectTestsForSources(impactSourceFiles, provider);
  const resolution = resolveTestImpactSelectionTrustBoundary(provider);
  const affectedFastTests = uniqueSorted(impact.fast.filter(isFastTestFile));
  const affectedSlowTests = uniqueSorted(impact.slow.filter(isSlowTestFile));
  return {
    changedFastTests,
    changedSlowTests,
    affectedFastTests,
    affectedSlowTests,
    selectedFastTests: uniqueSorted([...changedFastTests, ...affectedFastTests]),
    selectedSlowTests: uniqueSorted([...changedSlowTests, ...affectedSlowTests]),
    affectedOwners: uniqueSorted(impact.owners),
    sourceChanged: impactSourceFiles.length > 0,
    selectionResolved: resolution.selectionResolved,
    unresolvedTestFiles: resolution.unresolvedTestFiles
  };
}

const AFFECTED_SELECTION_VERIFICATION_GATE_RESULT_SCHEMA =
  'sec-verification-gate-result-v1' as const;

export type AffectedSelectionTrustBoundary =
  | 'applicable-no-tests'
  | 'applicable-with-tests'
  | 'unresolved-selection'
  | 'unresolved-test-source'
  | 'broad-fallback'
  | 'unresolved-ownership'
  | 'unresolved-git';

export interface AffectedSelectionClassificationInput {
  gitDiscoveryFailed: boolean;
  ownershipResolved: boolean;
  sourceChanged: boolean;
  selectionResolved: boolean;
  unresolvedTestFiles: readonly string[];
  selectedFastTestCount: number;
  broadFallbackEnabled: boolean;
}

export function classifyAffectedSelectionTrustBoundary(
  input: AffectedSelectionClassificationInput
): AffectedSelectionTrustBoundary {
  if (input.gitDiscoveryFailed) return 'unresolved-git';
  if (!input.ownershipResolved) return 'unresolved-ownership';
  if (input.sourceChanged
    && input.selectedFastTestCount === 0
    && !input.broadFallbackEnabled) {
    return input.unresolvedTestFiles.length > 0
      ? 'unresolved-test-source'
      : 'unresolved-selection';
  }
  if (input.broadFallbackEnabled
    && input.sourceChanged
    && input.selectedFastTestCount === 0) {
    return 'broad-fallback';
  }
  if (input.selectedFastTestCount > 0) return 'applicable-with-tests';
  return 'applicable-no-tests';
}

export interface AffectedSelectionProjectionContext {
  gateId: string;
  gateRevision: string;
  owner: string;
  requirementKey: string;
  subjectRevision: string;
  inputDigest: string;
  diagnostic: string | null;
}

const AFFECTED_SELECTION_GATE_REVISION = 'affected-selection-trust-boundary-v1' as const;
const AFFECTED_SELECTION_REQUIREMENT_KEY =
  'issue-206-affected-selection-trust-boundary' as const;
const AFFECTED_SELECTION_OWNER = 'affected-selection-worker' as const;
const AFFECTED_SELECTION_GATE_ID = 'test:affected' as const;
const AFFECTED_SELECTION_CLAIM_ID =
  'issue-206-affected-selection-trust-boundary' as const;

export function defaultAffectedSelectionProjectionContext(
  subjectRevision: string,
  inputDigest: string,
  diagnostic: string | null = null
): AffectedSelectionProjectionContext {
  return {
    gateId: AFFECTED_SELECTION_GATE_ID,
    gateRevision: AFFECTED_SELECTION_GATE_REVISION,
    owner: AFFECTED_SELECTION_OWNER,
    requirementKey: AFFECTED_SELECTION_REQUIREMENT_KEY,
    subjectRevision,
    inputDigest,
    diagnostic
  };
}

function planResultBase(context: AffectedSelectionProjectionContext) {
  return {
    schema: AFFECTED_SELECTION_VERIFICATION_GATE_RESULT_SCHEMA,
    gateId: context.gateId,
    gateRevision: context.gateRevision,
    owner: context.owner,
    requirementKey: context.requirementKey,
    subjectRevision: context.subjectRevision,
    inputDigest: context.inputDigest,
    requiredForClaims: [AFFECTED_SELECTION_CLAIM_ID],
    // Plan phase has selected or classified work but has not executed it.
    // It must never claim that the requirement is already supported.
    supportedClaims: [] as string[],
    evidenceRefs: [] as string[],
    invalidationRules: [
      'source-changed',
      'selection-unresolved',
      'test-source-read-failure',
      'ownership-unresolved',
      'git-discovery-failure'
    ],
    environment: null,
    execution: null,
    diagnostic: context.diagnostic
  };
}

export function projectAffectedSelectionToVerificationGateResult(
  boundary: AffectedSelectionTrustBoundary,
  context: AffectedSelectionProjectionContext
): VerificationGateResultV1 {
  const base = planResultBase(context);
  switch (boundary) {
    case 'unresolved-git':
    case 'unresolved-ownership':
    case 'unresolved-selection':
    case 'unresolved-test-source':
      return {
        ...base,
        applicability: 'unresolved',
        status: 'invalidated',
        disposition: 'not-executed',
        reasonCode: 'selection-unresolved'
      };
    case 'broad-fallback':
    case 'applicable-with-tests':
      return {
        ...base,
        applicability: 'required',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'not-dispatched'
      };
    case 'applicable-no-tests':
      return {
        ...base,
        applicability: 'not-applicable',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'not-applicable'
      };
  }
}

export function isAffectedSelectionFailClosed(
  boundary: AffectedSelectionTrustBoundary
): boolean {
  return boundary === 'unresolved-git'
    || boundary === 'unresolved-ownership'
    || boundary === 'unresolved-selection'
    || boundary === 'unresolved-test-source';
}
