import type { VerificationGateResult } from '../../../../../assurance/verification/result/contract/result.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../../../../assurance/verification/result/contract/schema.ts';

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
 * affected.ts); this contract only consumes them.
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
 * 6. fast tests selected → applicable-with-tests.
 * 7. no source change and no fast tests → applicable-no-tests (legitimate
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
  // This is the core empty-selection false-green scenario: fail closed.
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
 * Cross-field invariants enforced by CodexDevelopmentBuildVerificationGateResult:
 * - `applicability: unresolved` requires `status: invalidated`.
 * - `applicability: not-applicable` requires `status: not-run`.
 * - `status: invalidated` requires an INVALIDATED reasonCode (selection-unresolved).
 * - `status: not-run` requires a NOT_RUN reasonCode (not-applicable | not-dispatched).
 * - `disposition: not-executed` requires `execution: null`.
 * This plan projection also leaves `environment` null; other non-executed
 * observations may retain an environment identity.
 *
 * Implementation note: this function constructs the result object directly
 * (with the dependency-free canonical schema constant) rather than calling
 * CodexDevelopmentBuildVerificationGateResult, to avoid pulling
 * src/assurance/verification/result/contract/result.ts into the TCB runtime import closure.
 * The result is validated by CodexDevelopmentAssertVerificationGateResult
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
