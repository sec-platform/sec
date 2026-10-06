import { assertVerificationArtifactSet, type ValidatedVerificationArtifactSet } from '../../assurance/verification/artifact/contract/artifact.ts';
import { CI_ARTIFACT_FILES, CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  buildProvenanceArtifacts,
  finalizeProvenanceArtifacts
} from '../../assurance/verification/provenance/build-provenance.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { cloneAndDeepFreeze } from '../../contracts/canonical.ts';
import { type CommitFence } from '../../contracts/commit-fence.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { isPathInside, isSafeRelativePath, posixPath, resolvePathInside } from '../../contracts/relative-path.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
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
import { publishExistingParentCanonicalWorkspaceFile } from '../filesystem/file-publication.ts';
import { readOptionalVerificationArtifactSet } from '../verification/platform/artifact/runtime/authority.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  resolveWorkspaceArtifactPath
} from '../workspace-context.ts';
import { writeGeneratedArtifactWithLock } from '../workspace/lock.ts';
import { calculateCanonicalProjectFileHash } from '../workspace/project-file-hash.ts';
import { loadOverrideManifest } from '../workspace/sources/load-override-manifest.ts';

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

export async function buildProvenance(
  workspaceRoot: string,
  lock: LockFile,
  verification?: ValidatedVerificationArtifactSet | null
): Promise<ProvenanceFile> {
  // Capture plain inputs before override loading suspends. A publisher can
  // carry its admitted evidence here without observing a replacement tuple.
  lock = cloneAndDeepFreeze(lock);
  const verificationArtifacts = verification === undefined
    ? readOptionalVerificationArtifactSet(workspaceRoot, 'Provenance Verification artifact set')
    : cloneAndDeepFreeze(verification);
  if (verificationArtifacts !== null) assertVerificationArtifactSet(verificationArtifacts);
  const observedReport = verificationArtifacts?.verificationReport;
  // Partial diagnostic provenance must not claim unscoped complete proof.
  const report = observedReport?.summary.requestedLane === 'all' ? observedReport : null;
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
  commitFence?: CommitFence,
  verification?: ValidatedVerificationArtifactSet | null
): Promise<ProvenanceFile> {
  const publicationLock = structuredClone(lock);
  const provenancePath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.provenance
  );
  const lockPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.graphLock
  );
  const provenance = await writeGeneratedArtifactWithLock(
    lockPath,
    publicationLock,
    [CI_ARTIFACT_FILES.provenance],
    async () => {
      const provenance = await buildProvenance(workspaceRoot, publicationLock, verification);
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
  lock.generatedPaths = [...publicationLock.generatedPaths];
  return provenance;
}
