import type { CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import type { CiVerificationGatePhase, CiVerificationGateStep } from '../../action/contract/ci.ts';
import { selectCiPrRiskSlowSuites } from '../runtime/pr-risk-selection.ts';
import { uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../system-architecture/foundation/contract/repository-path.ts';
import type { CodexDevelopmentTestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';

export const CI_VERIFICATION_CONTRACT_REVISION = 'ci-verification-v19' as const;
export const CI_VERIFICATION_EXECUTION_MODEL = 'verification-session-v2-action-closure' as const;

export type CodexDevelopmentVerificationPlanProfile = 'quick' | 'full';

export type CodexDevelopmentVerificationPlan = {
  profile: CodexDevelopmentVerificationPlanProfile;
  changedFiles: string[] | null;
  selectionResolved: boolean;
  selectionReasons: string[];
  affectedOwners: string[];
  affectedSlowTests: string[];
  gates: CiVerificationGateStep[];
};

export function assertCiExpectedHead(actualHeadSha: string, expectedHeadSha: string | undefined): void {
  if (!expectedHeadSha) throw new Error('CI verification requires an exact expected head SHA.');
  if (actualHeadSha !== expectedHeadSha) {
    throw new Error(`CI verification head mismatch: expected ${expectedHeadSha}, actual ${actualHeadSha}.`);
  }
}

function gate(id: string, phase: CiVerificationGatePhase, ...args: string[]): CiVerificationGateStep {
  return { id, phase, args };
}

export function buildCiQuickGatePlan(options: {
  includeImports: boolean;
  includeDocs: boolean;
  includeRisk: boolean;
}): CiVerificationGateStep[] {
  return [
    ...(options.includeImports ? [gate('imports', 'quick', 'run', 'imports:check')] : []),
    ...(options.includeDocs ? [gate('docs-doctor', 'quick', 'run', 'docs:doctor')] : []),
    gate('typecheck', 'quick', 'run', 'typecheck'),
    gate('affected-tests', 'quick', 'run', 'test:affected'),
    ...(options.includeRisk ? [gate('impact-risk', 'risk', 'src/verification/ci/pr-risk.ts')] : [])
  ];
}

export function buildCiFullGatePlan(options: {
  hasDocumentationLifecycleChange?: boolean;
} = {}): CiVerificationGateStep[] {
  const includeDocs = options.hasDocumentationLifecycleChange !== false;
  return [
    gate('imports', 'quick', 'run', 'imports:check'),
    gate('typecheck', 'quick', 'run', 'typecheck'),
    ...(includeDocs ? [gate('docs-doctor', 'quick', 'run', 'docs:doctor')] : []),
    gate('affected-tests', 'quick', 'run', 'test:affected'),
    gate('full-fast', 'full', 'run', 'test:fast'),
    gate('test-budget', 'full', 'run', 'sec', '--', 'test', 'budget', '--json', '--compact'),
    gate('contract-freeze', 'risk', 'run', 'test:contract-freeze'),
    gate('all-slow-risk', 'risk', 'src/verification/ci/pr-risk.ts', '--all-slow'),
    gate('benchmark-task-suite', 'full', 'run', 'sec', '--', 'benchmark', 'suite', '--json', '--compact'),
    gate('deps-warmup', 'full', 'run', 'sec', '--', 'deps', 'warmup'),
    gate('resolve', 'workspace', 'run', 'sec', '--', 'resolve'),
    gate('compose', 'workspace', 'run', 'sec', '--', 'compose'),
    gate('adapt', 'workspace', 'run', 'sec', '--', 'adapt'),
    gate('verify-all', 'workspace', 'run', 'sec', '--', 'verify', '--lane', 'all', '--json', '--compact'),
    gate('lock', 'workspace', 'run', 'sec', '--', 'lock'),
    gate('explain', 'workspace', 'run', 'sec', '--', 'explain'),
    gate('reference-check', 'workspace', 'run', 'sec', '--', 'reference', 'check', '--json', '--compact')
  ];
}

export function CodexDevelopmentCanonicalChangedFiles(files: readonly string[]): string[] {
  for (const file of files) {
    if (!CodexDevelopmentIsCanonicalRepositoryPath(file)) {
      throw new Error(`Verification changed path is not canonical repository-relative POSIX: ${String(file)}`);
    }
  }
  return uniqueSorted(files);
}

function hasTypeScriptChange(files: readonly string[]): boolean {
  return files.some((file) => /\.[cm]?tsx?$/u.test(file));
}

function hasDocumentationLifecycleChange(owners: readonly string[]): boolean {
  return owners.includes('control.documentation');
}

export function CodexDevelopmentBuildVerificationPlan(
  profile: CodexDevelopmentVerificationPlanProfile,
  rawChangedFiles: readonly string[] | null,
  testImpactSourceProvider?: CodexDevelopmentTestImpactSourceProvider,
  transition?: CodexDevelopmentTestImpactTransitionObservation
): CodexDevelopmentVerificationPlan {
  const changedFiles = rawChangedFiles === null ? null : CodexDevelopmentCanonicalChangedFiles(rawChangedFiles);
  const selection = selectCiPrRiskSlowSuites(changedFiles, testImpactSourceProvider, transition);
  const includeRisk = !selection.resolved || selection.suites.length > 0 || selection.slowTests.length > 0;
  const hasDocsLifecycleChange = changedFiles === null || hasDocumentationLifecycleChange(selection.owners);
  const gates = profile === 'full'
    ? buildCiFullGatePlan({ hasDocumentationLifecycleChange: hasDocsLifecycleChange })
    : buildCiQuickGatePlan({
      includeImports: changedFiles === null || hasTypeScriptChange(changedFiles),
      includeDocs: hasDocsLifecycleChange,
      includeRisk
    });
  return {
    profile,
    changedFiles,
    selectionResolved: selection.resolved,
    selectionReasons: [...selection.reasons],
    affectedOwners: [...selection.owners],
    affectedSlowTests: [...selection.affectedSlowTests],
    gates
  };
}
