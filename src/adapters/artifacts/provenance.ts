import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../verification/platform/artifact/runtime/authority.ts';
import { CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import {
  packageJsonRelativePath,
  prismaRelativePath,
  secRelativePath,
  srcRelativePath,
  testsRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath
} from '../../workspace/paths.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { publishExistingParentCanonicalWorkspaceFile } from '../filesystem/file-publication.ts';
import { type CommitFence } from '../../contracts/commit-fence.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath
} from '../workspace-context.ts';
import { isPathInside, isSafeRelativePath, posixPath, resolvePathInside } from '../../contracts/relative-path.ts';
import { calculateCanonicalProjectFileHash } from '../workspace/project-file-hash.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { writeGeneratedArtifactWithLock } from '../workspace/lock.ts';
import { loadOverrideManifest } from '../workspace/sources/load-override-manifest.ts';
import {
  buildProvenanceArtifacts,
  finalizeProvenanceArtifacts
} from '../../assurance/verification/provenance/build-provenance.ts';
import { CI_ARTIFACT_FILES } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';

const provenanceProjectionArtifacts = new Set(CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS);
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

function readVerificationReport(workspaceRoot: string): VerificationReport | null {
  return readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Provenance Verification artifact set'
  )?.verificationReport ?? null;
}

export async function buildProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  const report = readVerificationReport(workspaceRoot);
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const artifacts = buildProvenanceArtifacts(lock, report, overrideManifest);
  const hashedArtifacts = artifacts.map((artifact) => {
    if (provenanceProjectionArtifacts.has(artifact.path)) return artifact;
    const artifactPath = artifact.path;
    const normalizedPath = posixPath(artifactPath);
    if (normalizedPath !== artifactPath || !isSafeRelativePath(artifactPath)) {
      throw new CompilerError(
        'PROVENANCE-PATH-001',
        `Provenance artifact path "${artifactPath}" is not canonical`
      );
    }
    const absolutePath = isCanonicalWorkspaceArtifactPath(artifactPath)
      ? resolveWorkspaceArtifactPath(workspaceRoot, artifactPath)
      : nativeWorkspaceRoots.some(root =>
          artifactPath === root || artifactPath.startsWith(`${root}/`)
        )
        ? resolvePathInside(workspaceRoot, artifactPath)
        : null;
    if (!absolutePath || !isPathInside(workspaceRoot, absolutePath)) {
      throw new CompilerError(
        'PROVENANCE-PATH-001',
        `Provenance artifact path "${artifactPath}" is outside the native workspace layout`
      );
    }
    const hash = calculateCanonicalProjectFileHash(absolutePath);
    return hash ? { ...artifact, hash } : artifact;
  });
  return finalizeProvenanceArtifacts(hashedArtifacts);
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
