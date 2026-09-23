import type { LockFile } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { compareCodeUnits, uniqueSorted } from '../../../contracts/canonical.ts';
import { validateProvenanceFile } from '../../../semantics/provenance/authority.ts';
import {
  PROVENANCE_FORMAT_VERSION,
  type OverrideManifest,
  type ProvenanceArtifact,
  type ProvenanceFile
} from '../../../semantics/provenance/types.ts';
import { testsRelativePath } from '../../../workspace/paths.ts';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS
} from '../ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../contract/types.ts';

const verificationArtifactPaths: ReadonlySet<string> = new Set([
  CI_ARTIFACT_FILES.verificationReport,
  CI_ARTIFACT_FILES.runtimeReport,
  CI_ARTIFACT_FILES.policyReport,
  CI_ARTIFACT_FILES.acceptanceCoverage
]);

function buildSemanticArtifact(
  task: NonNullable<LockFile['semanticLoweringTasks']>[number],
  verifiedBy: string[]
): ProvenanceArtifact {
  if (
    (task.status === 'generated' || task.status === 'verified') &&
    !task.artifactBinding
  ) {
    throw new CompilerError(
      'PROVENANCE-SEMANTIC-001',
      `Generated semantic task "${task.id}" is missing its IR/transaction artifact binding`
    );
  }
  const binding = task.artifactBinding;
  return {
    path: task.target,
    originType: 'generated',
    originId: task.generatorEntityId,
    sourceBlock: task.blockId,
    registrySourceId: task.registrySourceId,
    registryKind: task.registryKind,
    registryLocation: task.registryLocation,
    registryPath: task.registryPath,
    sourcePath: task.contractPath,
    runtimeTarget: task.target,
    generatedByPass: 'compose',
    generatorTaskId: task.id,
    ...(binding ? {
      generatorEntityId: binding.generatorEntityId,
      artifactEntityId: binding.artifactEntityId,
      semanticRevision: binding.semanticRevision,
      compilationTransactionId: binding.compilationTransactionId
    } : {}),
    verifiedBy,
    overrideStatus: 'none'
  };
}

type PassRule = Readonly<{ test: (path: string) => boolean; pass: string }>;

const PASS_RULES: readonly PassRule[] = Object.freeze([
  { test: p => p === CI_ARTIFACT_FILES.provenance, pass: 'lock' },
  {
    test: p => p === CI_ARTIFACT_FILES.blockUsageMap ||
      p === CI_ARTIFACT_FILES.installManifest,
    pass: 'compose'
  },
  { test: p => verificationArtifactPaths.has(p), pass: 'verify' },
  { test: p => CI_EXPLAIN_GRAPH_ARTIFACT_PATHS.includes(p), pass: 'explain' },
  { test: p => p === CI_ARTIFACT_MANIFEST_PATH, pass: 'artifacts' },
  { test: p => p === CI_ARTIFACT_FILES.repairPlan, pass: 'repair' },
  {
    test: p => p === CI_ARTIFACT_FILES.upgradePlan ||
      p === CI_ARTIFACT_FILES.upgradeDiagnostics,
    pass: 'upgrade'
  }
]);

function inferGeneratedByPass(targetPath: string): string {
  return PASS_RULES.find(rule => rule.test(targetPath))?.pass ?? 'compose';
}

function passedVerificationPaths(report: VerificationReport | null): string[] {
  if (!report || report.summary.status !== 'passed') return [];
  const canonicalTestPath = (
    file: string,
    lane: 'unit' | 'acceptance'
  ): string => file.startsWith(`${testsRelativePath}/`)
    ? file
    : `${testsRelativePath}/${lane}/${file}`;
  return uniqueSorted([
    ...report.unit.passed.map(file => canonicalTestPath(file, 'unit')),
    ...report.acceptance.passed.map(file => canonicalTestPath(file, 'acceptance')),
    ...report.runtime.unit.passed,
    ...report.runtime.acceptance.passed
  ]);
}

function buildBlockVerificationMap(
  lock: LockFile,
  report: VerificationReport | null
): Map<string, string[]> {
  const installedTestBlocks = new Map<string, string>();
  for (const step of lock.installPlan) {
    if (step.to.startsWith(`${testsRelativePath}/`)) {
      installedTestBlocks.set(step.to, step.blockId);
    }
  }

  const pendingByBlock = new Map<string, Set<string>>();
  for (const testPath of passedVerificationPaths(report)) {
    const blockId = installedTestBlocks.get(testPath);
    if (!blockId) continue;
    const paths = pendingByBlock.get(blockId) ?? new Set<string>();
    paths.add(testPath);
    pendingByBlock.set(blockId, paths);
  }
  return new Map(
    [...pendingByBlock].map(([blockId, testPaths]) => [
      blockId,
      uniqueSorted([...testPaths])
    ])
  );
}

/**
 * Build provenance meaning from one retained lock, verification result and
 * override manifest. Physical workspace hashing is deliberately excluded.
 */
export function buildProvenanceArtifacts(
  lock: LockFile,
  report: VerificationReport | null,
  overrideManifest: OverrideManifest
): ProvenanceArtifact[] {
  const artifacts = new Map<string, ProvenanceArtifact>();
  const blockVerificationMap = buildBlockVerificationMap(lock, report);

  for (const step of lock.installPlan) {
    artifacts.set(step.to, {
      path: step.to,
      originType: 'block',
      originId: step.blockId,
      sourceBlock: step.blockId,
      registrySourceId: step.registrySourceId,
      registryKind: step.registryKind,
      registryLocation: step.registryLocation,
      registryPath: step.registryPath,
      generatedByPass: 'compose',
      verifiedBy: blockVerificationMap.get(step.blockId) ?? [],
      overrideStatus: 'none'
    });
  }

  for (const generatedPath of lock.generatedPaths) {
    artifacts.set(generatedPath, {
      path: generatedPath,
      originType: 'generated',
      originId: generatedPath,
      generatedByPass: inferGeneratedByPass(generatedPath),
      verifiedBy: [],
      overrideStatus: 'none'
    });
  }

  for (const task of lock.semanticLoweringTasks ?? []) {
    artifacts.set(
      task.target,
      buildSemanticArtifact(task, blockVerificationMap.get(task.blockId) ?? [])
    );
  }

  for (const entry of overrideManifest.overrides) {
    const existing = artifacts.get(entry.target);
    artifacts.set(entry.target, {
      path: entry.target,
      originType: 'override',
      originId: entry.id,
      sourceBlock: existing?.sourceBlock,
      registrySourceId: existing?.registrySourceId,
      registryKind: existing?.registryKind,
      registryLocation: existing?.registryLocation,
      registryPath: existing?.registryPath,
      ...(existing?.sourcePath ? { sourcePath: existing.sourcePath } : {}),
      ...(existing?.runtimeTarget ? { runtimeTarget: existing.runtimeTarget } : {}),
      generatedByPass: 'compose',
      generatorTaskId: existing?.generatorTaskId,
      generatorEntityId: existing?.generatorEntityId,
      artifactEntityId: existing?.artifactEntityId,
      semanticRevision: existing?.semanticRevision,
      compilationTransactionId: existing?.compilationTransactionId,
      verifiedBy: existing?.verifiedBy ?? [],
      overrideStatus: entry.source
    });
  }

  return [...artifacts.values()].sort((left, right) =>
    compareCodeUnits(left.path, right.path)
  );
}

/** Validate and freeze the final artifact set after physical hashes are bound. */
export function finalizeProvenanceArtifacts(
  artifacts: readonly ProvenanceArtifact[]
): ProvenanceFile {
  return validateProvenanceFile({
    formatVersion: PROVENANCE_FORMAT_VERSION,
    artifacts: [...artifacts].sort((left, right) =>
      compareCodeUnits(left.path, right.path)
    )
  });
}
