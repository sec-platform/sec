import { isCanonicalVerificationArtifactSet } from '../../shared/verification-artifact-contract.ts';
import {
  CodexDevelopmentSnapshotVerificationDataV1,
  type VerificationResultStatus
} from '../../shared/verification-result-contract.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import type { WorkspaceSemanticBundle } from '../semantic-frontend.ts';

/**
 * Thin verification/Coverage wrapper for the Semantic Mutation isolated
 * runner. The execution core produces raw reports and the child exit code;
 * this module is the single authority that turns the canonical artifact set
 * plus physical exit truth into `passed` / `failed` / `blocked`.
 *
 * Decision rule (1B-4):
 * - canonical `passed` requires zero child exit AND passed fast/runtime lanes;
 * - canonical `failed` with nonzero child exit is a real physical failure;
 * - canonical `failed` with zero exit is protocol incoherence (blocked);
 * - canonical `invalidated` / `unsupported` / `not-run` are selection,
 *   environment or coverage truth problems and are always blocked, never a
 *   product failure.
 */
export interface SemanticMutationIsolatedVerificationArtifactSet {
  readonly childExitCode: number;
  readonly verificationReport: unknown;
  readonly runtimeReport: unknown;
  readonly policyReport: unknown;
  readonly acceptanceCoverage: unknown;
  readonly semanticBundle: unknown;
}

function exactKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function exactSemanticBundle(value: unknown): value is WorkspaceSemanticBundle {
  if (!exactKeys(value, [
    'snapshot', 'generatorPlan', 'semanticViews', 'semanticContractSources'
  ]) || !exactKeys((value as Record<string, unknown>).snapshot, ['ir']) ||
    !exactKeys((value as Record<string, unknown>).generatorPlan, [
      'inputRevision', 'semanticRevision', 'tasks'
    ]) || !exactKeys((value as Record<string, unknown>).semanticViews, [
      'formatVersion', 'inputRevision', 'semanticRevision', 'views'
    ]) || !Array.isArray((value as Record<string, unknown>).semanticContractSources)) {
    return false;
  }
  const bundle = value as unknown as WorkspaceSemanticBundle;
  return typeof bundle.snapshot.ir.inputRevision === 'string' &&
    typeof bundle.snapshot.ir.semanticRevision === 'string' &&
    bundle.generatorPlan.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.generatorPlan.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    bundle.semanticViews.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.semanticViews.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    Array.isArray(bundle.generatorPlan.tasks) && Array.isArray(bundle.semanticViews.views) &&
    bundle.semanticContractSources.every((source) => exactKeys(source, [
      'sourceKind', 'loadedContract', 'sourceRevision'
    ]) && (source.sourceKind === 'workspace-authoring' ||
      source.sourceKind === 'workspace-registry' || source.sourceKind === 'compiler-registry') &&
      typeof source.sourceRevision === 'string' && source.loadedContract !== null &&
      typeof source.loadedContract === 'object' && !Array.isArray(source.loadedContract));
}

/** Pure 1B-4 decision rule over canonical status plus physical exit truth. */
export function classifySemanticMutationIsolatedVerificationOutcome(
  overallStatus: VerificationResultStatus,
  childExitCode: number,
  fastPassed: boolean,
  runtimePassed: boolean
): 'passed' | 'failed' | 'blocked' {
  if (!Number.isSafeInteger(childExitCode) || childExitCode < 0) return 'blocked';
  if (overallStatus === 'passed') {
    return childExitCode === 0 && fastPassed && runtimePassed ? 'passed' : 'blocked';
  }
  if (overallStatus === 'failed') {
    return childExitCode === 0 ? 'blocked' : 'failed';
  }
  // invalidated / unsupported / not-run: never a product failure.
  return 'blocked';
}

export function classifySemanticMutationIsolatedVerificationArtifactSet(
  input: SemanticMutationIsolatedVerificationArtifactSet
): 'passed' | 'failed' | 'blocked' {
  let candidate: SemanticMutationIsolatedVerificationArtifactSet;
  try {
    candidate = {
      verificationReport: CodexDevelopmentSnapshotVerificationDataV1(
        input.verificationReport,
        'verification report'
      ),
      runtimeReport: CodexDevelopmentSnapshotVerificationDataV1(
        input.runtimeReport,
        'runtime report'
      ),
      policyReport: CodexDevelopmentSnapshotVerificationDataV1(
        input.policyReport,
        'policy report'
      ),
      acceptanceCoverage: CodexDevelopmentSnapshotVerificationDataV1(
        input.acceptanceCoverage,
        'acceptance coverage'
      )
    } as SemanticMutationIsolatedVerificationArtifactSet;
  } catch {
    return 'blocked';
  }
  if (!Number.isSafeInteger(input.childExitCode) || input.childExitCode < 0 ||
    !isCanonicalVerificationArtifactSet(
      candidate as SemanticMutationIsolatedVerificationArtifactSet
    ) ||
    !exactSemanticBundle(input.semanticBundle)) {
    return 'blocked';
  }
  const report = candidate.verificationReport as VerificationReport;
  const claimSummary = report.summary.claimSummary;
  if (!claimSummary) return 'blocked';
  return classifySemanticMutationIsolatedVerificationOutcome(
    claimSummary.overall.overallStatus,
    input.childExitCode,
    report.fast.status === 'passed',
    report.runtime.status === 'passed'
  );
}
