import type { CanonicalVerificationArtifactSet } from '../../assurance/verification/artifact/contract/artifact.ts';
import { snapshotVerificationPublicationArtifacts, type VerificationArtifactPublicationArtifacts } from '../../assurance/verification/artifact/publication.ts';
import { CI_ARTIFACT_FILES, CI_PROVENANCE_PROJECTION_ARTIFACT_PATHS } from '../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../assurance/verification/contract/types.ts';
import { assertProductVerificationArtifactSubject } from '../../assurance/verification/project/report.ts';
import {
  buildProvenanceArtifacts,
  finalizeProvenanceArtifacts
} from '../../assurance/verification/provenance/build-provenance.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { cloneAndDeepFreeze } from '../../contracts/canonical.ts';
import { type CommitFence } from '../../contracts/commit-fence.ts';
import { CodedFailure } from '../../contracts/failure.ts';
import { formatJsonFile } from '../../contracts/json-text.ts';
import { isPathInside, isSafeRelativePath, posixPath, resolvePathInside } from '../../contracts/relative-path.ts';
import { workspaceConfigRelativePath } from '../../contracts/workspace-config.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import { packageJsonRelativePath, prismaRelativePath, secRelativePath, srcRelativePath, testsRelativePath, tsconfigRelativePath } from '../../workspace/paths.ts';
import { publishExistingParentCanonicalWorkspaceFile } from '../filesystem/file-publication.ts';
import { readOptionalCanonicalVerificationArtifactSet } from '../verification/platform/artifact/runtime/authority.ts';
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

function readVerificationReport(workspaceRoot: string): VerificationReport | null {
  return readOptionalCanonicalVerificationArtifactSet(
    workspaceRoot,
    'Provenance Verification artifact set'
  )?.verificationReport ?? null;
}

export async function buildProvenance(workspaceRoot: string, lock: LockFile): Promise<ProvenanceFile> {
  return buildProvenanceFromReport(workspaceRoot, lock, readVerificationReport(workspaceRoot));
}

/** Prepare diagnostic provenance from the same admitted publication. This
 * captures plain evidence before suspension; it does not grant Lock completion. */
export async function buildProvenanceFromVerificationPublication(
  workspaceRoot: string,
  lock: LockFile,
  artifacts: VerificationArtifactPublicationArtifacts | null
): Promise<ProvenanceFile> {
  const capturedLock = cloneAndDeepFreeze(lock);
  const capturedArtifacts = artifacts === null ? null : cloneAndDeepFreeze(
    snapshotVerificationPublicationArtifacts(artifacts)
  );
  if (capturedArtifacts !== null) {
    assertProductVerificationArtifactSubject(capturedLock, capturedArtifacts);
  }
  return buildProvenanceFromReport(workspaceRoot, capturedLock,
    capturedArtifacts?.verificationReport ?? null);
}

async function buildProvenanceFromReport(
  workspaceRoot: string, lock: LockFile, report: VerificationReport | null
): Promise<ProvenanceFile> {
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  const artifacts = buildProvenanceArtifacts(lock, report, overrideManifest);
  const hashedArtifacts = artifacts.map((artifact) => {
    if (provenanceProjectionArtifacts.has(artifact.path)) return artifact;
    const artifactPath = artifact.path;
    const normalizedPath = posixPath(artifactPath);
    if (normalizedPath !== artifactPath || !isSafeRelativePath(artifactPath)) {
      throw new CodedFailure(
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
      throw new CodedFailure(
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
  return publishProvenance(workspaceRoot, lock, () => buildProvenance(workspaceRoot, lock), commitFence);
}

/** Same-operation data handoff from Lock's canonical reader, not a producer
 * qualification. Other callers retain writeProvenance's own observation path. */
export async function writeProvenanceFromVerification(
  workspaceRoot: string,
  lock: LockFile,
  artifacts: CanonicalVerificationArtifactSet,
  commitFence?: CommitFence
): Promise<ProvenanceFile> {
  return publishProvenance(workspaceRoot, lock,
    () => buildProvenanceFromReport(workspaceRoot, lock, artifacts.verificationReport), commitFence);
}

async function publishProvenance(
  workspaceRoot: string, lock: LockFile, build: () => Promise<ProvenanceFile>, commitFence?: CommitFence
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
      const provenance = await build();
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
