import { selectCiPrRiskSlowSuites } from './ci-pr-risk-selection.ts';
import { uniqueSorted } from './collections.ts';

export const CI_VERIFICATION_CONTRACT_REVISION = 'ci-verification-v6' as const;
export const CI_VERIFICATION_EXECUTION_MODEL = 'frozen-delivery-single-runner' as const;

export type CiVerificationGatePhase = 'quick' | 'risk' | 'full' | 'workspace';

export type CiVerificationGateStep = {
  id: string;
  phase: CiVerificationGatePhase;
  args: string[];
};

export type CodexDevelopmentVerificationPlanProfileV1 = 'quick' | 'full';

export type CodexDevelopmentVerificationPlanV1 = {
  profile: CodexDevelopmentVerificationPlanProfileV1;
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
    ...(options.includeRisk ? [gate('impact-risk', 'risk', 'scripts/ci-pr-risk.ts')] : [])
  ];
}

export function buildCiFullGatePlan(): CiVerificationGateStep[] {
  return [
    gate('imports', 'quick', 'run', 'imports:check'),
    gate('typecheck', 'quick', 'run', 'typecheck'),
    gate('docs-doctor', 'quick', 'run', 'docs:doctor'),
    gate('affected-tests', 'quick', 'run', 'test:affected'),
    gate('full-fast', 'full', 'run', 'test:fast'),
    gate('test-budget', 'full', 'run', 'sec', '--', 'test', 'budget', '--json', '--compact'),
    gate('contract-freeze', 'risk', 'run', 'test:contract-freeze'),
    gate('all-slow-risk', 'risk', 'scripts/ci-pr-risk.ts', '--all-slow'),
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

export function CodexDevelopmentCanonicalChangedFilesV1(files: readonly string[]): string[] {
  for (const file of files) {
    if (
      typeof file !== 'string'
      || file.length === 0
      || file !== file.normalize('NFC')
      || file.includes('\\')
      || file.startsWith('/')
      || file.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      throw new Error(`Verification changed path is not canonical repository-relative POSIX: ${String(file)}`);
    }
  }
  return uniqueSorted(files);
}

function hasTypeScriptChange(files: readonly string[]): boolean {
  return files.some((file) => /\.[cm]?tsx?$/u.test(file));
}

function hasActiveDocumentationChange(files: readonly string[]): boolean {
  return files.some((file) => /^docs\/.+\.md$/u.test(file));
}

export function CodexDevelopmentBuildVerificationPlanV1(
  profile: CodexDevelopmentVerificationPlanProfileV1,
  rawChangedFiles: readonly string[] | null
): CodexDevelopmentVerificationPlanV1 {
  const changedFiles = rawChangedFiles === null ? null : CodexDevelopmentCanonicalChangedFilesV1(rawChangedFiles);
  const selection = selectCiPrRiskSlowSuites(changedFiles);
  const includeRisk = !selection.resolved || selection.suites.length > 0 || selection.slowTests.length > 0;
  const gates = profile === 'full'
    ? buildCiFullGatePlan()
    : buildCiQuickGatePlan({
      includeImports: changedFiles === null || hasTypeScriptChange(changedFiles),
      includeDocs: changedFiles === null || hasActiveDocumentationChange(changedFiles),
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

export function CodexDevelopmentBuildVerificationInputV2(options: {
  profile: CodexDevelopmentVerificationPlanProfileV1;
  headSha: string | null;
  treeSha: string | null;
  prBaseSha: string | null;
  affectedBaseSha: string | null;
  manifestPath: string | null;
  manifestDigest: string | null;
  changedFiles: string[] | null;
  selectionResolved: boolean;
  gates: readonly CiVerificationGateStep[];
}): Record<string, unknown> {
  return {
    contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
    profile: options.profile,
    headSha: options.headSha,
    treeSha: options.treeSha,
    prBaseSha: options.prBaseSha,
    affectedBaseSha: options.affectedBaseSha,
    manifestPath: options.manifestPath,
    manifestDigest: options.manifestDigest,
    files: options.changedFiles,
    selectionResolved: options.selectionResolved,
    gatePlan: options.gates.map((step) => ({ id: step.id, phase: step.phase, argv: ['bun', ...step.args] }))
  };
}
