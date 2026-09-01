import { validateProvenanceFile } from '../../semantic/provenance/authority.ts';
import { PROVENANCE_FORMAT_VERSION, type ProvenanceArtifact, type ProvenanceFile } from '../../semantic/provenance/contract/types.ts';
import { compareCodeUnits, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../../verification/artifact/runtime/authority.ts';
import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_EXPLAIN_GRAPH_ARTIFACT_PATHS,
  CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS
} from '../../verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../verification/contract/types.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import { formatJsonFile, publishExistingParentCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  isPathInside,
  isSafeRelativePath,
  packageJsonRelativePath,
  posixPath,
  prismaRelativePath,
  resolvePathInside,
  resolveWorkspaceArtifactPath,
  secRelativePath,
  srcRelativePath,
  testsRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath
} from '../../workspace/runtime/paths.ts';
import { calculateCanonicalProjectFileHash } from '../../workspace/runtime/project-file-hash.ts';
import type { LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { writeGeneratedArtifactWithLock } from '../lock.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';

const provenanceProjectionArtifacts = new Set(CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS);
const verificationArtifactPaths: ReadonlySet<string> = new Set([
  CI_ARTIFACT_FILES.verificationReport,
  CI_ARTIFACT_FILES.runtimeReport,
  CI_ARTIFACT_FILES.policyReport,
  CI_ARTIFACT_FILES.acceptanceCoverage
]);
const nativeWorkspaceRoots = [
  modelRelativePath,
  srcRelativePath,
  testsRelativePath,
  prismaRelativePath,
  packageJsonRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath,
  secRelativePath
] as const;

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

type PassRule = { test: (path: string) => boolean; pass: string };

const PASS_RULES: PassRule[] = [
  { test: (p) => p === CI_ARTIFACT_FILES.provenance, pass: 'lock' },
  { test: (p) => p === CI_ARTIFACT_FILES.blockUsageMap || p === CI_ARTIFACT_FILES.installManifest, pass: 'compose' },
  { test: (p) => verificationArtifactPaths.has(p), pass: 'verify' },
  { test: (p) => CI_EXPLAIN_GRAPH_ARTIFACT_PATHS.includes(p), pass: 'explain' },
  { test: (p) => p === CI_ARTIFACT_MANIFEST_PATH, pass: 'artifacts' },
  { test: (p) => p === CI_ARTIFACT_FILES.repairPlan, pass: 'repair' },
  { test: (p) => p === CI_ARTIFACT_FILES.upgradePlan || p === CI_ARTIFACT_FILES.upgradeDiagnostics, pass: 'upgrade' },
];

function inferGeneratedByPass(targetPath: string): string {
  return PASS_RULES.find((rule) => rule.test(targetPath))?.pass ?? 'compose';
}

function passedVerificationPaths(report: VerificationReport | null): string[] {
  if (!report || report.summary.status !== 'passed') return [];
  const canonicalTestPath = (file: string, lane: 'unit' | 'acceptance'): string =>
    file.startsWith(`${testsRelativePath}/`) ? file : `${testsRelativePath}/${lane}/${file}`;
  return uniqueSorted([
    ...report.unit.passed.map((file) => canonicalTestPath(file, 'unit')),
    ...report.acceptance.passed.map((file) => canonicalTestPath(file, 'acceptance')),
    ...report.runtime.unit.passed,
    ...report.runtime.acceptance.passed
  ]);
}

function buildBlockVerificationMap(lock: LockFile, report: VerificationReport | null): Map<string, string[]> {
  const installedTestBlocks = new Map<string, string>();
  for (const step of lock.installPlan) {
    if (step.to.startsWith(`${testsRelativePath}/`)) installedTestBlocks.set(step.to, step.blockId);
  }

  const pendingByBlock = new Map<string, Set<string>>();
  for (const testPath of passedVerificationPaths(report)) {
    const blockId = installedTestBlocks.get(testPath);
    if (!blockId) continue;
    const paths = pendingByBlock.get(blockId) ?? new Set<string>();
    paths.add(testPath);
    pendingByBlock.set(blockId, paths);
  }
  return new Map([...pendingByBlock].map(([blockId, testPaths]) => [
    blockId,
    uniqueSorted([...testPaths])
  ]));
}

function readVerificationReport(workspaceRoot: string): VerificationReport | null {
  return readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Provenance Verification artifact set'
  )?.verificationReport ?? null;
}

export async function buildProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  const artifacts = new Map<string, ProvenanceArtifact>();
  const blockVerificationMap = buildBlockVerificationMap(lock, readVerificationReport(workspaceRoot));

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
    artifacts.set(task.target, buildSemanticArtifact(
      task,
      blockVerificationMap.get(task.blockId) ?? []
    ));
  }

  const overrideManifest = await loadOverrideManifest(workspaceRoot);
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

  for (const [artifactPath, artifact] of artifacts.entries()) {
    if (provenanceProjectionArtifacts.has(artifactPath)) continue;
    const normalizedPath = posixPath(artifactPath);
    if (normalizedPath !== artifactPath || !isSafeRelativePath(artifactPath)) {
      throw new CompilerError(
        'PROVENANCE-PATH-001',
        `Provenance artifact path "${artifactPath}" is not canonical`
      );
    }
    const absolutePath = isCanonicalWorkspaceArtifactPath(artifactPath)
      ? resolveWorkspaceArtifactPath(workspaceRoot, artifactPath)
      : nativeWorkspaceRoots.some((root) => artifactPath === root || artifactPath.startsWith(`${root}/`))
        ? resolvePathInside(workspaceRoot, artifactPath)
        : null;
    if (!absolutePath || !isPathInside(workspaceRoot, absolutePath)) {
      throw new CompilerError(
        'PROVENANCE-PATH-001',
        `Provenance artifact path "${artifactPath}" is outside the native workspace layout`
      );
    }
    const hash = calculateCanonicalProjectFileHash(absolutePath);
    if (hash) artifact.hash = hash;
  }

  return validateProvenanceFile({
    formatVersion: PROVENANCE_FORMAT_VERSION,
    artifacts: [...artifacts.values()].sort((left, right) => compareCodeUnits(left.path, right.path))
  });
}

export async function writeProvenance(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<ProvenanceFile> {
  const provenancePath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.provenance
  );
  const lockPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.graphLock
  );
  return writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    [CI_ARTIFACT_FILES.provenance],
    async () => {
      const provenance = await buildProvenance(workspaceRoot, lock);
      await publishExistingParentCanonicalWorkspaceFile({
        workspaceRoot,
        targetPath: provenancePath,
        bytes: Buffer.from(formatJsonFile(provenance), 'utf8'),
        label: 'Provenance projection',
        commitFence
      });
      return provenance;
    },
    commitFence
  );
}
