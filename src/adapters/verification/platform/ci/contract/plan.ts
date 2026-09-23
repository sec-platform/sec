import { createHash } from 'node:crypto';

import { uniqueSorted } from '../../../../../contracts/canonical.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../../../../contracts/repository-path.ts';
import { isSourceProgramInputPath } from '../../../../repository/source-program-model/contract.ts';
import {
  isDocumentationVerificationInputPath,
  type DocumentationVerificationBaseline
} from '../../../../self-hosting/control/documentation/active.ts';
import type { CiVerificationGatePhase, CiVerificationGateStep } from '../../action/contract/ci.ts';
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
    ...riskGates
  ];
}

export function buildCiFullGatePlan(): CiVerificationGateStep[] {
  return [
    gate('imports', 'quick', 'run', 'imports:check'),
    gate('typecheck', 'quick', 'run', 'typecheck'),
    gate('docs-doctor', 'quick', 'run', 'docs:doctor'),
    gate('full-fast', 'full', 'run', 'test:fast'),
    gate('test-budget', 'full', 'run', 'sec', '--', 'test', 'budget', '--json', '--compact'),
    ...selectedRiskGates(slowTestSuiteIds(), []),
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

function hasTypeScriptChange(
  files: readonly string[],
  documentationBaseline: DocumentationVerificationBaseline
): boolean {
  return files.some((file) => (
    /\.[cm]?tsx?$/u.test(file)
    && (isSourceProgramInputPath(file)
      || !isDocumentationVerificationInputPath(file, documentationBaseline))
  ));
}

function hasDocumentationLifecycleChange(owners: readonly string[]): boolean {
  return owners.includes('control.documentation');
}

const documentationVerificationBaselines = new WeakMap<object, DocumentationVerificationBaseline>();

export function bindDocumentationVerificationGateInput<T extends CodexDevelopmentTestImpactSourceProvider>(
  provider: T,
  baseline: DocumentationVerificationBaseline
): T {
  const bound = documentationVerificationBaselines.get(provider);
  if (bound !== undefined && bound !== baseline) {
    throw new Error('CI documentation baseline is already bound to this exact candidate provider.');
  }
  documentationVerificationBaselines.set(provider, baseline);
  return provider;
}

function documentationVerificationBaselineFromProvider(
  provider: CodexDevelopmentTestImpactSourceProvider
): DocumentationVerificationBaseline {
  const candidate = documentationVerificationBaselines.get(provider);
  if (candidate === undefined) {
    throw new Error('CI verification requires an exact candidate documentation verification baseline.');
  }
  return candidate;
}

export function CodexDevelopmentBuildVerificationPlan(
  profile: CodexDevelopmentVerificationPlanProfile,
  rawChangedFiles: readonly string[] | null,
  testImpactSourceProvider: CodexDevelopmentTestImpactSourceProvider | null,
  transition?: CodexDevelopmentTestImpactTransitionObservation
): CodexDevelopmentVerificationPlan {
  const changedFiles = rawChangedFiles === null ? null : CodexDevelopmentCanonicalChangedFiles(rawChangedFiles);
  if (profile === 'full') {
    return {
      profile,
      changedFiles,
      selectionResolved: true,
      selectionReasons: ['full-inventory'],
      affectedOwners: [],
      affectedSlowTests: [],
      gates: buildCiFullGatePlan()
    };
  }
  if (testImpactSourceProvider === null) {
    throw new Error('Quick verification requires an owner-issued test-impact source provider.');
  }
  const selection = selectSlowTestRiskClosure(changedFiles, testImpactSourceProvider, transition);
  const documentationBaseline = documentationVerificationBaselineFromProvider(testImpactSourceProvider);
  const hasDocsLifecycleChange = changedFiles === null
    || hasDocumentationLifecycleChange(selection.owners)
    || changedFiles.some((file) => isDocumentationVerificationInputPath(file, documentationBaseline));
  const gates = buildCiQuickGatePlan({
      includeImports: changedFiles === null || hasTypeScriptChange(changedFiles, documentationBaseline),
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
