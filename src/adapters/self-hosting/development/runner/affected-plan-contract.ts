import type { VerificationGateResult } from '../../../../assurance/verification/result/contract/result.ts';
import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import type { GitReadProviderRoute } from '../../../providers/git-read/runtime/session.ts';
import { SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS } from '../../../repository/source-program-model/compilation-operation.ts';
import { isSourceProgramInputPath } from '../../../repository/source-program-model/contract.ts';
import {
  isAffectedSelectionFailClosed,
  type AffectedSelectionTrustBoundary
} from '../../../verification/platform/test-impact/affected.ts';
import { isDocumentationVerificationInputPath } from '../../control/documentation/active.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';

export const AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING = Object.freeze({
  maxProcesses: 256,
  maxTotalArgumentBytes: 128 * 1024 * 1024,
  maxStdoutBytes: 512 * 1024 * 1024,
  maxStderrBytes: 16 * 1024 * 1024,
  maxRecords: 2_000_000,
  maxRootObservedBytes: 2 * 1024 * 1024 * 1024,
  maxReopenRefreshes: 80_000,
  maxSettlementAttempts: 256,
  maxExecutableBytes: 512 * 1024 * 1024
});

// The semantic operation includes source acquisition, compiler projection and
// final Git readback. Individual Git sessions remain capped by their narrower
// transport budget; the total operation must not alias one child duration.
const AFFECTED_SELECTION_FINAL_READBACK_RESERVE_MS = 5_000;
export const AFFECTED_SELECTION_OPERATION_DURATION_MS =
  SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS + AFFECTED_SELECTION_FINAL_READBACK_RESERVE_MS;

export interface AffectedTestSelection {
  readonly tests: readonly string[];
  readonly slowTests: readonly string[];
  readonly affectedTests: readonly string[];
  readonly affectedSlowTests: readonly string[];
  readonly affectedOwners: readonly string[];
  readonly sourceChanged: boolean;
  readonly selectionResolved: boolean;
  readonly unresolvedModuleFiles: readonly string[];
}

type AffectedPlanIdentity = Readonly<{
  schema: 'sec-affected-plan-identity-v1';
  baseSha: string | null;
  headSha: string;
  indexDigest: `sha256:${string}`;
  worktreeDigest: `sha256:${string}`;
  changedPathsDigest: `sha256:${string}`;
  sourceObservationDigest: `sha256:${string}` | null;
  sourceEpoch: `sha256:${string}` | null;
  ruleRevision: string;
  broadFallbackEnabled: boolean;
  gitProviderRoute: GitReadProviderRoute;
  gitProviderIdentityDigest: `sha256:${string}`;
  gitExecutable: string;
  gitExecutableDigest: `sha256:${string}` | null;
}>;

export interface AffectedTestPlan {
  readonly schema: 'sec-affected-test-plan-v1';
  readonly changedPaths: readonly string[];
  readonly owners: readonly string[];
  readonly selectedFastTests: readonly string[];
  readonly selectedSlowTests: readonly string[];
  readonly riskSuites: readonly string[];
  readonly riskTests: readonly string[];
  readonly riskReasons: readonly string[];
  readonly unresolvedPaths: readonly string[];
  readonly resolved: boolean;
  readonly selectionResolved: AffectedTestSelection;
  readonly selectionTrustBoundary: AffectedSelectionTrustBoundary;
  readonly verificationResult: VerificationGateResult;
  readonly broadFallbackEnabled: boolean;
  readonly identity?: AffectedPlanIdentity;
}

export type LocalAffectedGateId =
  | 'imports:check'
  | 'typecheck'
  | 'docs:doctor'
  | 'test:affected';

export interface LocalAffectedGateStep {
  readonly id: LocalAffectedGateId;
  readonly command: string;
}

export interface LocalAffectedCheckPlan {
  readonly schema: 'sec-local-affected-check-plan-v1';
  readonly resolved: boolean;
  readonly changedPaths: string[];
  readonly affectedPlan: AffectedTestPlan;
  readonly gates: LocalAffectedGateStep[];
  readonly umbrellaCommand: 'bun run check -- --affected';
  readonly subsumedStandaloneCommands: string[];
}

const TYPECHECK_AUTHORITY_PATHS = new Set([
  'bun.lock',
  'bunfig.toml',
  'package.json',
  'tsconfig.json'
]);

function gate(id: LocalAffectedGateId): LocalAffectedGateStep {
  return {
    id,
    command: id === 'test:affected' ? 'bun run test -- --affected' : `bun run ${id}`
  };
}

/** Git-issued paths only; semantic selection still owns every other input. */
export function isDocumentationOnlyAffectedSelection(changedPaths: readonly string[]): boolean {
  return changedPaths.length > 0
    && changedPaths.every((file) => isDocumentationVerificationInputPath(file)
      && !isSourceProgramInputPath(file)
      && !file.startsWith('tools/'));
}

export function buildLocalAffectedCheckPlan(
  affectedPlan: AffectedTestPlan
): LocalAffectedCheckPlan {
  const changedPaths = [...affectedPlan.changedPaths];
  const documentationGateChanged = changedPaths.some((file) => isDocumentationVerificationInputPath(file));
  const documentationGateOnly = isDocumentationOnlyAffectedSelection(changedPaths);
  const typescriptChanged = changedPaths.some((file) => (
    /\.[cm]?tsx?$/u.test(file)
    && (isSourceProgramInputPath(file) || !isDocumentationVerificationInputPath(file))
  ));
  const typecheckRequired = typescriptChanged || changedPaths.some((file) => (
    TYPECHECK_AUTHORITY_PATHS.has(file)
    || /^tsconfig(?:\.[^/]+)?\.json$/u.test(file)
  ));
  const failClosed = affectedPlan.resolved
    && isAffectedSelectionFailClosed(affectedPlan.selectionTrustBoundary);
  const testAffectedRequired = affectedPlan.selectedFastTests.length > 0 || failClosed;
  const gates = documentationGateOnly
    ? [gate('docs:doctor')]
    : [
      ...(typescriptChanged ? [gate('imports:check')] : []),
      ...(typecheckRequired ? [gate('typecheck')] : []),
      ...(documentationGateChanged ? [gate('docs:doctor')] : []),
      ...(testAffectedRequired ? [gate('test:affected')] : [])
    ];

  return {
    schema: 'sec-local-affected-check-plan-v1',
    resolved: affectedPlan.resolved,
    changedPaths,
    affectedPlan,
    gates,
    umbrellaCommand: 'bun run check -- --affected',
    subsumedStandaloneCommands: gates.map(({ command }) => command)
  };
}

export function compileAffectedTestSelectionSemanticOperation(input: Readonly<{
  readonly purpose: 'budget-projection' | 'check-affected';
  /** Optional owner deadline which may only narrow the canonical operation window. */
  readonly deadlineAtUnixMs?: number;
}>): BoundSemanticOperation {
  const localDeadlineAtUnixMs = Date.now() + AFFECTED_SELECTION_OPERATION_DURATION_MS;
  const deadlineAtUnixMs = Math.min(input.deadlineAtUnixMs ?? localDeadlineAtUnixMs, localDeadlineAtUnixMs);
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
    throw new Error('Affected test selection operation deadline is invalid or expired.');
  }
  const contractDigest = sha256({
    operation: 'verification.affected-test-selection',
    provider: 'external-capabilities.git-read',
    projection: 'source-program-test-impact'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: 'verification.affected-test-selection',
    intentDigest: sha256({ purpose: input.purpose }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: AFFECTED_SELECTION_OPERATION_DURATION_MS },
      { resource: 'input-bytes', maximum: GIT_READ_OPERATION_BUDGET.maxStdinBytes },
      { resource: 'output-bytes', maximum: AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING.maxStdoutBytes + AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING.maxStderrBytes },
      { resource: 'processes', maximum: AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING.maxProcesses },
      { resource: 'records', maximum: AFFECTED_GIT_REVALIDATION_AGGREGATE_CEILING.maxRecords }
    ],
    requirements: [{
      id: 'repository.affected-selection',
      contractDigest,
      effectKinds: ['process'],
      failureKinds: ['provider.cancelled', 'provider.deadline-exhausted', 'provider.drift', 'provider.unavailable', 'provider.unverified']
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'repository.affected-selection',
    contractDigest,
    providerIdentityDigest: contractDigest
  })]);
}

/**
 * Source compilation consumes the parent absolute window but must leave one
 * bounded final Git/readback settlement reserve. No phase may reset either
 * duration from its own start time.
 */
export function affectedSelectionSourceCompilationDeadlineAtUnixMs(
  operation: BoundSemanticOperation
): number {
  const deadlineAtUnixMs = operation.plan.attempt.deadlineAtUnixMs
    - AFFECTED_SELECTION_FINAL_READBACK_RESERVE_MS;
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
    throw new Error('Affected selection has no remaining Source Program compilation window.');
  }
  return deadlineAtUnixMs;
}

export function affectedTestPlanExitCode(
  plan: Pick<AffectedTestPlan, 'selectionTrustBoundary'>
): number {
  return isAffectedSelectionFailClosed(plan.selectionTrustBoundary) ? 1 : 0;
}
