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
  /**
   * Whether the reverse-import-map closure used to compute `affectedFastTests`
   * was fully resolved. False when any test file's import specifiers could not
   * be read (stat/read/parse failure), meaning the affected closure may be
   * incomplete. When `sourceChanged && !selectionResolved`, callers MUST fail
   * closed instead of treating an empty `selectedFastTests` as "no impact".
   */
  selectionResolved: boolean;
  /**
   * Test files whose import specifiers could not be read. Always empty when
   * `selectionResolved` is true. Surfaced for diagnostics and projection to
   * the unified verification result model.
   */
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
  // The reverse-import-map is built once during selectTestsForSources (cached
  // for the default provider). Re-fetch the trust boundary from the same cache
  // to avoid a second scan; in provider mode it rebuilds but the provider's
  // test file set is stable for this call.
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

// ---------------------------------------------------------------------------
// Affected Selection Trust Boundary (Issue #206)
// ---------------------------------------------------------------------------
//
// Classifies the result of an affected-test selection into a trust boundary
// and projects it to the unified VerificationGateResultV1 model (PR #204).
//
// The core problem this solves: `test-runner.ts` used to return exit 0 when
// `sourceChanged=true && selectedFastTests=[]` even when the empty closure was
// caused by an unresolved selection (test file read/stat failure, git discovery
// failure, or unmapped ownership). That silently treated "could not determine
// impact" as "no impact" — a false-green.
//
// This contract does NOT modify verification-result-contract.ts. It uses
// type-only imports for the VerificationGateResultV1 shape and constructs
// results with a local schema constant to avoid pulling
// verification-result-contract.ts into the TCB runtime import closure (it is
// not in the canonical verifier trust-root registry). The projection results are
// validated by CodexDevelopmentAssertVerificationGateResultV1 in tests.

/**
 * Local copy of the schema constant. MUST stay in sync with
 * VERIFICATION_GATE_RESULT_SCHEMA_V1 in verification-result-contract.ts.
 * Tests (affected-selection-trust-boundary.test.ts) assert this value matches
 * the canonical constant to detect drift.
 */
const AFFECTED_SELECTION_VERIFICATION_GATE_RESULT_SCHEMA = 'sec-verification-gate-result-v1' as const;

/**
 * The seven trust boundaries an affected-test selection can land in.
 *
 * - `unresolved-git`: git discovery of changed files failed entirely.
 * - `unresolved-ownership`: ci-pr-risk selection found changed paths that map
 *   to no ownership declaration, fallback rule, or reverse-import edge.
 * - `unresolved-selection`: sourceChanged but the reverse-import-map closure
 *   is incomplete for a reason NOT attributable to a specific test file read
 *   failure (defensive — should not normally occur).
 * - `unresolved-test-source`: sourceChanged and at least one test file's
 *   import specifiers could not be read (stat/read/parse failure). The
 *   affected closure may be incomplete; an empty selection is NOT proof of
 *   "no impact".
 * - `broad-fallback`: SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1 triggered a
 *   broad fast-suite run because no targeted closure matched.
 * - `applicable-with-tests`: one or more fast tests were selected for
 *   execution.
 * - `applicable-no-tests`: no source change required test impact AND no fast
 *   tests were selected. This is the only boundary where an empty selection
 *   is legitimately "no impact" (e.g. only slow tests changed, or only docs).
 */
export type AffectedSelectionTrustBoundary =
  | 'applicable-no-tests'
  | 'applicable-with-tests'
  | 'unresolved-selection'
  | 'unresolved-test-source'
  | 'broad-fallback'
  | 'unresolved-ownership'
  | 'unresolved-git';

/**
 * Input to the classification. All fields are produced by the existing
 * affected-test plan pipeline (test-runner.ts + ci-pr-risk-selection.ts +
 * affected-test-inventory.ts); this contract only consumes them.
 */
export interface AffectedSelectionClassificationInput {
  /** True when gitChangedFiles() returned null. */
  gitDiscoveryFailed: boolean;
  /** ci-pr-risk selection `resolved` field (ownership of changed paths). */
  ownershipResolved: boolean;
  /** inventory.sourceChanged — at least one changed file is a test impact source. */
  sourceChanged: boolean;
  /** inventory.selectionResolved — reverse-import-map closure is complete. */
  selectionResolved: boolean;
  /** inventory.unresolvedTestFiles — test files whose imports could not be read. */
  unresolvedTestFiles: readonly string[];
  /** Number of selected fast tests (changed + affected). */
  selectedFastTestCount: number;
  /** SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1. */
  broadFallbackEnabled: boolean;
}

/**
 * Classify the affected-test selection into a trust boundary.
 *
 * Order matters:
 * 1. git discovery failure dominates everything (we cannot say anything
 *    without changed paths).
 * 2. ownership failure dominates selection failure (ownership is a stricter,
 *    earlier gate).
 * 3. sourceChanged + empty closure + no fallback → fail closed. In PR quick
 *    lane, an empty closure for a source change is a risk signal: either test
 *    coverage is missing, or the selector failed silently. The runner must
 *    NOT treat this as "no impact". When test-source read failures are
 *    present, report `unresolved-test-source` for diagnostics; otherwise
 *    `unresolved-selection`.
 * 4. broad fallback explicitly enabled for source change with empty closure.
 * 5. fast tests selected → applicable-with-tests.
 * 6. no source change and no fast tests → applicable-no-tests (legitimate
 *    "no impact": only slow tests, docs, or data changed).
 */
export function classifyAffectedSelectionTrustBoundary(
  input: AffectedSelectionClassificationInput
): AffectedSelectionTrustBoundary {
  if (input.gitDiscoveryFailed) return 'unresolved-git';
  if (!input.ownershipResolved) return 'unresolved-ownership';
  // Source changed but no fast tests selected and no broad fallback.
  // This is the core Issue #206 false-green scenario: fail closed.
  if (input.sourceChanged
    && input.selectedFastTestCount === 0
    && !input.broadFallbackEnabled) {
    return input.unresolvedTestFiles.length > 0
      ? 'unresolved-test-source'
      : 'unresolved-selection';
  }
  // Broad fallback explicitly enabled for source change with empty closure.
  if (input.broadFallbackEnabled
    && input.sourceChanged
    && input.selectedFastTestCount === 0) {
    return 'broad-fallback';
  }
  if (input.selectedFastTestCount > 0) return 'applicable-with-tests';
  return 'applicable-no-tests';
}

/**
 * Context for projecting a trust boundary to a VerificationGateResultV1.
 * The caller is responsible for providing identity fields (gate/owner/subject/digest).
 */
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
const AFFECTED_SELECTION_REQUIREMENT_KEY = 'issue-206-affected-selection-trust-boundary' as const;
const AFFECTED_SELECTION_OWNER = 'affected-selection-worker' as const;
const AFFECTED_SELECTION_GATE_ID = 'test:affected' as const;

/**
 * Default context for the standard `bun run test:affected` / `--plan` path.
 * Callers with a different gate identity (e.g. `check:affected` umbrella)
 * can override individual fields.
 */
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

/**
 * Project an affected-selection trust boundary to a VerificationGateResultV1.
 *
 * This projection is for the PLAN phase (before test execution). Execution
 * outcome (passed/failed) is NOT represented here — `applicable-with-tests`
 * and `broad-fallback` project to `not-run/not-dispatched` because no test
 * has run yet. After execution, the runner constructs a fresh result with
 * the actual exit code; that path is outside this contract.
 *
 * Cross-field invariants enforced by CodexDevelopmentBuildVerificationGateResultV1:
 * - `applicability: unresolved` requires `status: invalidated`.
 * - `applicability: not-applicable` requires `status: not-run`.
 * - `status: invalidated` requires an INVALIDATED reasonCode (selection-unresolved).
 * - `status: not-run` requires a NOT_RUN reasonCode (not-applicable | not-dispatched).
 * - `disposition: not-executed` requires `execution: null` and `environment: null`.
 *
 * Implementation note: this function constructs the result object directly
 * (with a local schema constant) rather than calling
 * CodexDevelopmentBuildVerificationGateResultV1, to avoid pulling
 * verification-result-contract.ts into the TCB runtime import closure.
 * The result is validated by CodexDevelopmentAssertVerificationGateResultV1
 * in tests/contract/affected-selection-trust-boundary.test.ts.
 */
export function projectAffectedSelectionToVerificationGateResult(
  boundary: AffectedSelectionTrustBoundary,
  context: AffectedSelectionProjectionContext
): VerificationGateResultV1 {
  const base = {
    schema: AFFECTED_SELECTION_VERIFICATION_GATE_RESULT_SCHEMA,
    gateId: context.gateId,
    gateRevision: context.gateRevision,
    owner: context.owner,
    requirementKey: context.requirementKey,
    subjectRevision: context.subjectRevision,
    inputDigest: context.inputDigest,
    requiredForClaims: ['issue-206-affected-selection-trust-boundary'],
    supportedClaims: ['issue-206-affected-selection-trust-boundary'],
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
      // Plan phase: tests are selected but have not executed yet.
      return {
        ...base,
        applicability: 'required',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'not-dispatched'
      };
    case 'applicable-no-tests':
      // No source change required test impact, and no fast tests selected.
      // This is the only boundary where an empty selection is legitimately
      // "no impact" — e.g. only slow tests changed, or only docs/data.
      return {
        ...base,
        applicability: 'not-applicable',
        status: 'not-run',
        disposition: 'not-executed',
        reasonCode: 'not-applicable'
      };
  }
}

/**
 * Whether a trust boundary requires the runner to fail closed (non-zero exit)
 * in the plan phase, before any test execution.
 *
 * The four `unresolved-*` boundaries must fail closed: an empty or partial
 * selection cannot be treated as "no impact". The other boundaries either
 * execute tests (and let the test exit code decide) or legitimately have no
 * applicable tests.
 */
export function isAffectedSelectionFailClosed(
  boundary: AffectedSelectionTrustBoundary
): boolean {
  return boundary === 'unresolved-git'
    || boundary === 'unresolved-ownership'
    || boundary === 'unresolved-selection'
    || boundary === 'unresolved-test-source';
}
