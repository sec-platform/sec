import { createHash } from 'node:crypto';

import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../system-architecture/foundation/contract/repository-path.ts';
import { uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import type { CiVerificationGatePhase, CiVerificationGateStep } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../contract/revision.ts';
import { isKnownSlowTestSuiteId, isSlowTestFile, slowTestSuiteIds, slowTestSuiteIdsForFile } from '../../test-impact/contract/budget.ts';
import type { CodexDevelopmentTestImpactSourceProvider } from '../../test-impact/runtime/impact.ts';
import type { CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { selectSlowTestRiskClosure } from '../../test-impact/slow-risk-selection.ts';

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

function selectedSlowTestGateId(file: string): string {
  return `slow-test-${createHash('sha256').update(file, 'utf8').digest('hex')}`;
}

function selectedRiskGates(
  rawSuites: readonly string[],
  rawSlowTests: readonly string[]
): CiVerificationGateStep[] {
  const suites = uniqueSorted(rawSuites);
  const slowTests = uniqueSorted(rawSlowTests);
  for (const suite of suites) {
    if (!isKnownSlowTestSuiteId(suite)) {
      throw new Error(`Verification selected an unknown slow-test suite: ${suite}`);
    }
  }
  for (const file of slowTests) {
    if (!CodexDevelopmentIsCanonicalRepositoryPath(file) || !isSlowTestFile(file)) {
      throw new Error(`Verification selected a noncanonical slow-test path: ${file}`);
    }
    if (slowTestSuiteIdsForFile(file).length > 0) {
      throw new Error(`Verification selected a suite-owned slow test as a direct member: ${file}`);
    }
  }
  return [
    ...suites.map((suite) => gate(
      `slow-suite-${suite}`,
      'risk',
      'run',
      'test:slow',
      '--',
      '--suite',
      suite
    )),
    ...slowTests.map((file) => gate(
      selectedSlowTestGateId(file),
      'risk',
      'run',
      'test:slow',
      '--',
      file
    ))
  ];
}

export function buildCiQuickGatePlan(options: {
  includeImports: boolean;
  includeDocs: boolean;
  selectedSlowSuites?: readonly string[];
  selectedSlowTests?: readonly string[];
}): CiVerificationGateStep[] {
  const riskGates = selectedRiskGates(
    options.selectedSlowSuites ?? [],
    options.selectedSlowTests ?? []
  );
  return [
    ...(options.includeImports ? [gate('imports', 'quick', 'run', 'imports:check')] : []),
    ...(options.includeDocs ? [gate('docs-doctor', 'quick', 'run', 'docs:doctor')] : []),
    gate('typecheck', 'quick', 'run', 'typecheck'),
    gate('affected-tests', 'quick', 'run', 'test:affected'),
    ...(riskGates.length > 0 ? [gate('contract-freeze', 'risk', 'run', 'test:contract-freeze')] : []),
    ...riskGates
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
    ...selectedRiskGates(slowTestSuiteIds(), []),
    gate('benchmark-task-suite', 'full', 'run', 'sec', '--', 'benchmark', 'suite', '--json', '--compact'),
    gate('deps-warmup', 'full', 'run', 'sec', '--', 'deps', 'warmup'),
    gate('resolve', 'workspace', 'run', 'sec', '--', 'resolve'),
    gate('compose', 'workspace', 'run', 'sec', '--', 'compose'),
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
  testImpactSourceProvider: CodexDevelopmentTestImpactSourceProvider,
  transition?: CodexDevelopmentTestImpactTransitionObservation
): CodexDevelopmentVerificationPlan {
  const changedFiles = rawChangedFiles === null ? null : CodexDevelopmentCanonicalChangedFiles(rawChangedFiles);
  const selection = selectSlowTestRiskClosure(changedFiles, testImpactSourceProvider, transition);
  const hasDocsLifecycleChange = changedFiles === null || hasDocumentationLifecycleChange(selection.owners);
  const gates = profile === 'full'
    ? buildCiFullGatePlan({ hasDocumentationLifecycleChange: hasDocsLifecycleChange })
    : buildCiQuickGatePlan({
      includeImports: changedFiles === null || hasTypeScriptChange(changedFiles),
      includeDocs: hasDocsLifecycleChange,
      selectedSlowSuites: selection.suites,
      selectedSlowTests: selection.slowTests
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
