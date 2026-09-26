import { isCanonicalVerificationArtifactSet } from '../../artifact/contract/artifact.ts';
import type { VerificationReport } from '../../contract/types.ts';
import {
  snapshotVerificationData,
  type VerificationResultStatus
} from '../../result/contract/result.ts';

export interface IsolatedSemanticBundleEvidence {
  readonly snapshot: Readonly<{
    readonly ir: Readonly<{
      readonly inputRevision: string;
      readonly semanticRevision: string;
    }>;
  }>;
  readonly generatorPlan: Readonly<{
    readonly inputRevision: string;
    readonly semanticRevision: string;
    readonly tasks: readonly unknown[];
  }>;
  readonly semanticViews: Readonly<{
    readonly formatVersion: unknown;
    readonly inputRevision: string;
    readonly semanticRevision: string;
    readonly views: readonly unknown[];
  }>;
  readonly semanticContractSources: readonly Readonly<{
    readonly sourceKind: 'workspace-authoring' | 'workspace-registry' | 'compiler-registry';
    readonly loadedContract: object;
    readonly sourceRevision: string;
  }>[];
}

export interface IsolatedVerificationArtifactSet {
  readonly childExitCode: number;
  readonly verificationReport: unknown;
  readonly runtimeReport: unknown;
  readonly policyReport: unknown;
  readonly acceptanceCoverage: unknown;
  readonly semanticBundle: unknown;
}

/** Project only evidence-bearing semantic fields; workspace authority is not proof payload. */
export function projectIsolatedSemanticBundle(
  input: IsolatedSemanticBundleEvidence
): IsolatedSemanticBundleEvidence {
  return Object.freeze({
    snapshot: input.snapshot,
    generatorPlan: input.generatorPlan,
    semanticViews: input.semanticViews,
    semanticContractSources: input.semanticContractSources
  });
}

function exactKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function exactSemanticBundle(
  value: unknown
): value is IsolatedSemanticBundleEvidence {
  if (!exactKeys(value, [
    'snapshot', 'generatorPlan', 'semanticViews', 'semanticContractSources'
  ]) || !exactKeys(value.snapshot, ['ir']) ||
    !exactKeys(value.generatorPlan, ['inputRevision', 'semanticRevision', 'tasks']) ||
    !exactKeys(value.semanticViews, [
      'formatVersion', 'inputRevision', 'semanticRevision', 'views'
    ]) || !Array.isArray(value.semanticContractSources)) {
    return false;
  }
  const bundle = value as unknown as IsolatedSemanticBundleEvidence;
  return typeof bundle.snapshot.ir.inputRevision === 'string' &&
    typeof bundle.snapshot.ir.semanticRevision === 'string' &&
    bundle.generatorPlan.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.generatorPlan.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    bundle.semanticViews.inputRevision === bundle.snapshot.ir.inputRevision &&
    bundle.semanticViews.semanticRevision === bundle.snapshot.ir.semanticRevision &&
    Array.isArray(bundle.generatorPlan.tasks) &&
    Array.isArray(bundle.semanticViews.views) &&
    bundle.semanticContractSources.every(source => exactKeys(source, [
      'sourceKind', 'loadedContract', 'sourceRevision'
    ]) && (source.sourceKind === 'workspace-authoring' ||
      source.sourceKind === 'workspace-registry' ||
      source.sourceKind === 'compiler-registry') &&
      typeof source.sourceRevision === 'string' &&
      source.loadedContract !== null &&
      typeof source.loadedContract === 'object' &&
      !Array.isArray(source.loadedContract));
}

/** Pure decision rule over canonical verification status plus physical child-exit truth. */
export function classifyIsolatedVerificationOutcome(
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
  return 'blocked';
}

export function classifyIsolatedVerificationArtifactSet(
  input: IsolatedVerificationArtifactSet
): 'passed' | 'failed' | 'blocked' {
  let candidate: IsolatedVerificationArtifactSet;
  try {
    candidate = {
      childExitCode: input.childExitCode,
      verificationReport: snapshotVerificationData(
        input.verificationReport,
        'verification report'
      ),
      runtimeReport: snapshotVerificationData(
        input.runtimeReport,
        'runtime report'
      ),
      policyReport: snapshotVerificationData(
        input.policyReport,
        'policy report'
      ),
      acceptanceCoverage: snapshotVerificationData(
        input.acceptanceCoverage,
        'acceptance coverage'
      ),
      semanticBundle: input.semanticBundle
    };
  } catch {
    return 'blocked';
  }
  if (!Number.isSafeInteger(input.childExitCode) || input.childExitCode < 0 ||
    !isCanonicalVerificationArtifactSet({
      verificationReport: candidate.verificationReport,
      runtimeReport: candidate.runtimeReport,
      policyReport: candidate.policyReport,
      acceptanceCoverage: candidate.acceptanceCoverage
    }) || !exactSemanticBundle(input.semanticBundle)) {
    return 'blocked';
  }
  const report = candidate.verificationReport as VerificationReport;
  const claimSummary = report.summary.claimSummary;
  if (!claimSummary) return 'blocked';
  return classifyIsolatedVerificationOutcome(
    claimSummary.overall.overallStatus,
    input.childExitCode,
    report.fast.status === 'passed',
    report.runtime.status === 'passed'
  );
}
