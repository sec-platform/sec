import { type VerificationGateResult } from '../../../../assurance/verification/result/contract/result.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../../../assurance/verification/result/contract/schema.ts';
import { uniqueSorted } from '../../../../contracts/canonical.ts';
import { isFastTestFile, isSlowTestFile } from './contract/budget.ts';
import {
  isTestImpactModuleGraphInputFile,
  isTestImpactSourceFile,
  resolveTestImpactSelectionTrustBoundary,
  selectTestsForSources,
  type TestImpactSourceProvider
} from './runtime/impact.ts';

export type AffectedTestInventory = {
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
   * was fully resolved. False when a repository module could not be read or a
   * local code import could not be resolved, meaning the affected closure may be
   * incomplete. When `sourceChanged && !selectionResolved`, callers MUST fail
   * closed instead of treating an empty `selectedFastTests` as "no impact".
   */
  selectionResolved: boolean;
  /**
   * Repository modules whose import graph could not be resolved. Always empty when
   * `selectionResolved` is true. Surfaced for diagnostics and projection to
   * the unified verification result model.
   */
  unresolvedModuleFiles: string[];
};

export function AffectedInventoryInputs(
  changedPaths: readonly string[],
  currentTestPathIsRunnable: (file: string) => boolean
): string[] {
  return uniqueSorted(changedPaths.filter((file) => (
    (!isFastTestFile(file) && !isSlowTestFile(file)) || currentTestPathIsRunnable(file)
  )));
}

export function BuildAffectedTestInventory(
  files: readonly string[],
  provider: TestImpactSourceProvider
): AffectedTestInventory {
  const changedFastTests = uniqueSorted(files.filter(isFastTestFile));
  const changedSlowTests = uniqueSorted(files.filter(isSlowTestFile));
  const impactSourceFiles = files.filter((file) => isTestImpactSourceFile(file, provider));
  const impact = selectTestsForSources(impactSourceFiles, provider);
  // The reverse-import-map is built once during selectTestsForSources (cached
  // for the default provider). Re-fetch the trust boundary from the same cache
  // to avoid a second scan; in provider mode it rebuilds but the provider's
  // test file set is stable for this call.
  // A direct test/slow-test or declarative non-source change has no reverse
  // module-graph frontier. Avoid constructing the graph (and, in the default
  // provider mode, touching its persistent cache) for that already-complete
  // empty source batch. Unknown source-like paths still enter the graph path
  // through `impactSourceFiles` and therefore remain fail-closed.
  const graphImpactSourceFiles = impactSourceFiles.filter((file) => (
    isTestImpactModuleGraphInputFile(file, provider)
  ));
  const resolution = graphImpactSourceFiles.length === 0
    ? { selectionResolved: true, unresolvedModuleFiles: [] }
    : resolveTestImpactSelectionTrustBoundary(provider);
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
    unresolvedModuleFiles: resolution.unresolvedModuleFiles
  };
}

// ---------------------------------------------------------------------------
// Affected Selection Trust Boundary (Issue #206)
// ---------------------------------------------------------------------------
//
// Classifies the result of an affected-test selection into a trust boundary
// and projects it to the unified VerificationGateResult model (PR #204).
//
// The core problem this solves: `test-runner.ts` used to return exit 0 when
// `sourceChanged=true && selectedFastTests=[]` even when the empty closure was
  // caused by an unresolved selection (module read/stat failure, git discovery
// failure, or unmapped ownership). That silently treated "could not determine
// impact" as "no impact" — a false-green.
//
// The schema identity comes from its dependency-free canonical owner. The full
// verification-result implementation remains outside this runtime closure and
// is consumed only as a type here.

/**
 * The seven trust boundaries an affected-test selection can land in.
 *
 * - `unresolved-git`: git discovery of changed files failed entirely.
 * - `unresolved-ownership`: slow-test closure found changed paths that map
 *   to no ownership declaration, fallback rule, or reverse-import edge.
 * - `unresolved-selection`: sourceChanged but the reverse-import-map closure
 *   is incomplete for a reason NOT attributable to a specific module read
 *   failure (defensive — should not normally occur).
 * - `unresolved-module-graph`: sourceChanged and at least one repository module's
 *   source could not be read or a local code target could not be resolved. The
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
  | 'unresolved-module-graph'
  | 'broad-fallback'
  | 'unresolved-ownership'
  | 'unresolved-git';

/**
 * Input to the classification. All fields are produced by the existing
 * affected-test plan pipeline (test-runner.ts + slow-risk-selection.ts +
 * affected-test-inventory.ts); this contract only consumes them.
 */
export interface AffectedSelectionClassificationInput {
  /** True when gitChangedFiles() returned null. */
  gitDiscoveryFailed: boolean;
  /** slow-test closure `resolved` field (ownership of changed paths). */
  ownershipResolved: boolean;
  /** inventory.sourceChanged — at least one changed file is a test impact source. */
  sourceChanged: boolean;
  /** inventory.selectionResolved — reverse-import-map closure is complete. */
  selectionResolved: boolean;
  /** inventory.unresolvedModuleFiles — modules whose import graph could not be resolved. */
  unresolvedModuleFiles: readonly string[];
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
 * 3. sourceChanged + unresolved closure → fail closed before considering the
 *    selected-test count or broad fallback. A partial graph is never made
 *    trustworthy by an already-selected test or by an opt-in broad fallback:
 *    either can hide an unresolved path and turn the plan into a false-green.
 *    When module-source read failures are present, report
 *    `unresolved-module-graph` for diagnostics; otherwise
 *    `unresolved-selection`.
 * 4. sourceChanged + empty resolved closure + no fallback → fail closed. In PR
 *    quick lane, an empty closure for a source change is a risk signal: either
 *    test coverage is missing, or the selector failed silently. The runner
 *    must NOT treat this as "no impact".
 * 5. broad fallback explicitly enabled for source change with empty closure.
 * 5. fast tests selected → applicable-with-tests.
 * 6. no source change and no fast tests → applicable-no-tests (legitimate
 *    "no impact": only slow tests, docs, or data changed).
 */
export function classifyAffectedSelectionTrustBoundary(
  input: AffectedSelectionClassificationInput
): AffectedSelectionTrustBoundary {
  if (input.gitDiscoveryFailed) return 'unresolved-git';
  if (!input.ownershipResolved) return 'unresolved-ownership';
  // A partial/unresolved module graph is unsafe regardless of how many tests
  // happened to be selected. Checking this before selectedFastTestCount is
  // the trust boundary: a known test cannot prove that the missing frontier
  // has no additional consumers, and broad fallback cannot repair an
  // observation that was not complete.
  if (input.sourceChanged && !input.selectionResolved) {
    return input.unresolvedModuleFiles.length > 0
      ? 'unresolved-module-graph'
      : 'unresolved-selection';
  }
  // Source changed but no fast tests selected and no broad fallback.
  // This is the core Issue #206 false-green scenario: fail closed.
  if (input.sourceChanged
    && input.selectedFastTestCount === 0
    && !input.broadFallbackEnabled) {
    return 'unresolved-selection';
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
 * Context for projecting a trust boundary to a VerificationGateResult.
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

const AFFECTED_SELECTION_GATE_REVISION = 'affected-selection-trust-boundary-v3-resolved-module-graph' as const;
const AFFECTED_SELECTION_REQUIREMENT_KEY = 'issue-206-affected-selection-trust-boundary' as const;
const AFFECTED_SELECTION_OWNER = 'affected-selection-worker' as const;
const AFFECTED_SELECTION_GATE_ID = 'test:affected' as const;

/**
 * Default context for the standard `bun run test -- --affected` / `--plan` path.
 * Callers with a different gate identity (e.g. `check --affected` umbrella)
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
 * Project an affected-selection trust boundary to a VerificationGateResult.
 *
 * This projection is for the PLAN phase (before test execution). Execution
 * outcome (passed/failed) is NOT represented here — `applicable-with-tests`
 * and `broad-fallback` project to `not-run/not-dispatched` because no test
 * has run yet. After execution, the runner constructs a fresh result with
 * the actual exit code; that path is outside this contract.
 *
 * Cross-field invariants enforced by BuildVerificationGateResult:
 * - `applicability: unresolved` requires `status: invalidated`.
 * - `applicability: not-applicable` requires `status: not-run`.
 * - `status: invalidated` requires an INVALIDATED reasonCode (selection-unresolved).
 * - `status: not-run` requires a NOT_RUN reasonCode (not-applicable | not-dispatched).
 * - `disposition: not-executed` requires `execution: null` and `environment: null`.
 *
 * Implementation note: this function constructs the result object directly
 * (with a local schema constant) rather than calling
 * BuildVerificationGateResult, to avoid pulling
 * verification-result-contract.ts into the TCB runtime import closure.
 * The result is validated by AssertVerificationGateResult
 * in tests/contract/affected-selection-trust-boundary.test.ts.
 */
export function projectAffectedSelectionToVerificationGateResult(
  boundary: AffectedSelectionTrustBoundary,
  context: AffectedSelectionProjectionContext
): VerificationGateResult {
  const base = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
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
      'module-graph-resolution-failure',
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
    case 'unresolved-module-graph':
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
    || boundary === 'unresolved-module-graph';
}
