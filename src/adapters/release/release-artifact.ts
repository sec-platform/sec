import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { acquirePhysicalMutationLease } from '../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  copyNoFollowDirectoryTreesBulk,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile,
  relocateRetainedNoFollowDirectory,
  relocateRetainedNoFollowDirectoryAcrossParents,
  scanNoFollowDirectoryTreeInventory,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS
} from '../toolchain/runtime.ts';
import { rawSha256Hex, sha256 } from '../../contracts/canonical.ts';
import {
  allocateReleaseStage,
  retireReleaseTree
} from './release-physical.ts';
import {
  assertReleaseBunRuntimeRequirement,
  buildFrozenReleaseBundle,
  disposeFrozenReleaseSource,
  prepareFrozenReleaseSource
} from './release-source-materialization.ts';

import {
  RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH,
  parseReleaseArtifactManifestBytes,
  type ReleaseArtifactFile,
  type ReleaseArtifactManifest
} from './release-artifact-manifest.ts';

;
;
;

type ReleaseCleanupPhase =
  | 'previous-artifact'
  | 'artifact-stage'
  | 'frozen-source';

interface ReleaseCleanupFinding {
  readonly phase: ReleaseCleanupPhase;
  readonly path: string;
  readonly state: 'cleanup-unconfirmed';
  readonly detail: string;
}

export interface ReleaseArtifactBuildReceipt {
  readonly schema: 'sec-release-artifact-build-receipt-v1';
  readonly publicationStatus: 'accepted';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly artifactRoot: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
  readonly cleanupFindings: readonly ReleaseCleanupFinding[];
}

function assertPublicationParent(parent: PhysicalDirectoryIdentity): PhysicalDirectoryIdentity {
  return assertSameNoFollowDirectoryIdentity(
    parent,
    'Release artifact publication parent'
  ).target;
}

async function assertDestinationAdmissible(
  destinationRoot: string,
  parent: PhysicalDirectoryIdentity
): Promise<void> {
  assertPublicationParent(parent);
  const presence = inspectExactNoFollowDirectoryPresence(
    destinationRoot,
    'Existing release artifact destination'
  );
  if (presence.state === 'present') {
    assertSameNoFollowDirectoryIdentity(
      presence.directory.target,
      'Existing release artifact destination'
    );
  }
  assertPublicationParent(parent);
}
async function listArtifactFiles(root: string): Promise<ReleaseArtifactFile[]> {
  const physicalRoot = inspectNoFollowDirectoryChain(
    path.resolve(root),
    'Release artifact inventory root'
  ).target;
  const entries = scanNoFollowDirectoryTreeInventory(physicalRoot, {
    includeByteDigest: true,
    includePermissionMode: true
  });
  const files: ReleaseArtifactFile[] = [];
  for (const entry of entries) {
    if (entry.relativePath === RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH) continue;
    if (entry.kind === 'link') {
      throw new Error(`Release artifact contains a link/reparse entry: ${entry.relativePath}`);
    }
    if (entry.kind === 'directory') continue;
    if (entry.kind !== 'file' || entry.byteDigest === undefined) {
      throw new Error(`Release artifact contains a non-ordinary entry: ${entry.relativePath}`);
    }
    files.push(Object.freeze({
      path: entry.relativePath,
      bytes: entry.size,
      digest: entry.byteDigest,
      executable: ((entry.permissionMode ?? 0) & 0o111) !== 0
    }));
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}
function manifestMaterial(input: Omit<ReleaseArtifactManifest, 'contentDigest'>) {
  return Object.freeze({ ...input });
}

function manifestMaterialFromReadback(readback: ReleaseArtifactManifest) {
  return manifestMaterial({
    schema: readback.schema,
    packageVersion: readback.packageVersion,
    sourceCommit: readback.sourceCommit,
    sourceTree: readback.sourceTree,
    dependencyLockDigest: readback.dependencyLockDigest,
    builder: readback.builder,
    files: readback.files
  });
}

async function assertReleaseArtifactReadback(
  artifactRoot: string,
  label: 'staged' | 'published'
): Promise<ReleaseArtifactManifest> {
  const root = inspectNoFollowDirectoryChain(
    path.resolve(artifactRoot),
    `${label} release artifact root`
  ).target;
  const manifestBytes = readNoFollowOrdinaryFile(root, RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH);
  if (manifestBytes === null) {
    throw new Error(`${label} release artifact manifest is missing`);
  }
  const readback = parseReleaseArtifactManifestBytes(
    manifestBytes,
    `${label} release artifact manifest`
  );
  assertReleaseBunRuntimeRequirement(readback.builder);
  const physicalFiles = await listArtifactFiles(artifactRoot);
  if (sha256(physicalFiles) !== sha256(readback.files)) {
    throw new Error(`${label} release artifact physical file inventory differs from manifest`);
  }
  return readback;
}

async function writeAndVerifyManifest(
  artifactRoot: string,
  input: Omit<ReleaseArtifactManifest, 'files' | 'contentDigest'>
): Promise<ReleaseArtifactManifest> {
  const files = Object.freeze(await listArtifactFiles(artifactRoot));
  const material = manifestMaterial({ ...input, files });
  const manifest: ReleaseArtifactManifest = Object.freeze({
    ...material,
    contentDigest: sha256(material) as `sha256:${string}`
  });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const root = inspectNoFollowDirectoryChain(
    path.resolve(artifactRoot),
    'Release artifact manifest parent'
  ).target;
  publishExclusiveDurableCanonicalFile({
    parent: root,
    name: RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH,
    bytes,
    validate: (current) => {
      if (!Buffer.from(current).equals(bytes)) {
        throw new Error('Release artifact manifest readback differs');
      }
    }
  });
  return assertReleaseArtifactReadback(artifactRoot, 'staged');
}

function failureText(error: unknown): string {
  try {
    const text: unknown = error instanceof Error ? error.message : String(error);
    return typeof text === 'string' ? text : '<unprintable failure>';
  } catch {
    // Diagnostics must not replace the retained cause or interrupt remaining cleanup.
    return '<unprintable failure>';
  }
}

function cleanupFinding(
  phase: ReleaseCleanupPhase,
  targetPath: string,
  error: unknown
): ReleaseCleanupFinding {
  return Object.freeze({
    phase,
    path: targetPath,
    state: 'cleanup-unconfirmed' as const,
    detail: failureText(error)
  });
}

async function collectCleanupFinding(
  phase: ReleaseCleanupPhase,
  targetPath: string,
  cleanup: () => Promise<void>
): Promise<ReleaseCleanupFinding | null> {
  try {
    await cleanup();
    return null;
  } catch (error) {
    return cleanupFinding(phase, targetPath, error);
  }
}

function cleanupFailureSuffix(findings: readonly ReleaseCleanupFinding[]): string {
  if (findings.length === 0) return '';
  return `; cleanup=${findings.map((finding) =>
    `${finding.phase}:${finding.path}:${finding.state}:${finding.detail}`).join(' | ')}`;
}

async function restorePreviousAfterCandidateRenameFailure(input: {
  readonly destinationRoot: string;
  readonly backup: PhysicalDirectoryIdentity;
  readonly parent: PhysicalDirectoryIdentity;
  readonly publicationError: unknown;
}): Promise<never> {
  try {
    assertPublicationParent(input.parent);
    relocateRetainedNoFollowDirectory({
      directory: input.backup,
      tombstoneName: path.basename(input.destinationRoot)
    });
    assertPublicationParent(input.parent);
  } catch (restoreError) {
    throw new Error(
      `Release artifact publication failed and previous artifact restoration did not converge; ` +
      `destination=${input.destinationRoot}; previous=${input.backup.path}; ` +
      `publication=${failureText(input.publicationError)}; restore=${failureText(restoreError)}`,
      { cause: restoreError }
    );
  }
  throw input.publicationError;
}

async function recoverAfterPublishedReadbackFailure(input: {
  readonly destinationRoot: string;
  readonly backup: PhysicalDirectoryIdentity | null;
  readonly published: PhysicalDirectoryIdentity;
  readonly parent: PhysicalDirectoryIdentity;
  readonly readbackError: unknown;
}): Promise<never> {
  const failedName = `.sec-release-failed-${randomUUID()}`;
  const failedRoot = path.join(input.parent.path, failedName);
  try {
    assertPublicationParent(input.parent);
    relocateRetainedNoFollowDirectory({
      directory: input.published,
      tombstoneName: failedName
    });
    assertPublicationParent(input.parent);
  } catch (containmentError) {
    throw new Error(
      `Published release artifact failed readback and the failed candidate could not be isolated; ` +
      `candidate=${input.destinationRoot}; previous=${input.backup?.path ?? '<none>'}; ` +
      `readback=${failureText(input.readbackError)}; containment=${failureText(containmentError)}`,
      { cause: containmentError }
    );
  }

  if (input.backup !== null) {
    try {
      assertPublicationParent(input.parent);
      relocateRetainedNoFollowDirectory({
        directory: input.backup,
        tombstoneName: path.basename(input.destinationRoot)
      });
      assertPublicationParent(input.parent);
    } catch (restoreError) {
      throw new Error(
        `Published release artifact failed readback and previous artifact restoration did not converge; ` +
        `failedCandidate=${failedRoot}; previous=${input.backup.path}; destination=${input.destinationRoot}; ` +
        `readback=${failureText(input.readbackError)}; restore=${failureText(restoreError)}`,
        { cause: restoreError }
      );
    }
  }
  throw input.readbackError;
}

async function publishAcceptedArtifact(
  stagedArtifactRoot: string,
  destinationRoot: string,
  parent: PhysicalDirectoryIdentity,
  expectedManifest: ReleaseArtifactManifest
): Promise<readonly ReleaseCleanupFinding[]> {
  assertPublicationParent(parent);
  if (path.dirname(destinationRoot) !== parent.path) {
    throw new Error('Release artifact destination is not a direct child of its retained publication parent');
  }
  const destinationKey = rawSha256Hex(path.basename(destinationRoot));
  const backupName = `.sec-release-previous-${destinationKey}`;
  const backupRoot = path.join(parent.path, backupName);
  const lease = acquirePhysicalMutationLease(
    parent,
    `.sec-release-publication-${destinationKey}.lock`
  );
  if (lease === null) {
    throw new Error(`Release artifact publication is contended: ${destinationRoot}`);
  }
  const sameExpectedManifest = (manifest: ReleaseArtifactManifest): boolean =>
    manifest.contentDigest === expectedManifest.contentDigest &&
    sha256(manifestMaterialFromReadback(manifest)) === sha256(manifestMaterialFromReadback(expectedManifest));

  let primaryFailure: unknown;
  let hasPrimaryFailure = false;
  try {
    // Publication recovery is bound to the retained artifact/backup manifest.
    lease.acknowledgeReclaimedRecovery();
    let backup: PhysicalDirectoryIdentity | null = null;
    const retainedBackup = inspectExactNoFollowDirectoryPresence(
      backupRoot,
      'Release artifact retained publication backup'
    );
    if (retainedBackup.state === 'present') {
      backup = retainedBackup.directory.target;
      const retainedDestination = inspectExactNoFollowDirectoryPresence(
        destinationRoot,
        'Release artifact interrupted publication destination'
      );
      if (retainedDestination.state === 'absent') {
        relocateRetainedNoFollowDirectory({
          directory: backup,
          tombstoneName: path.basename(destinationRoot)
        });
        backup = null;
      } else {
        let acceptedManifest: ReleaseArtifactManifest | null = null;
        try {
          acceptedManifest = await assertReleaseArtifactReadback(destinationRoot, 'published');
        } catch {
          const failedName = `.sec-release-failed-${randomUUID()}`;
          relocateRetainedNoFollowDirectory({
            directory: retainedDestination.directory.target,
            tombstoneName: failedName
          });
          relocateRetainedNoFollowDirectory({
            directory: backup,
            tombstoneName: path.basename(destinationRoot)
          });
          backup = null;
        }
        if (acceptedManifest !== null) {
          const exactRetry = sameExpectedManifest(acceptedManifest);
          const acceptedBackup = backup;
          if (acceptedBackup === null) {
            throw new Error('Release artifact interrupted publication lost its retained backup identity');
          }
          retireReleaseTree(
            acceptedBackup,
            parent,
            'Release artifact interrupted previous cleanup root'
          );
          assertPublicationParent(parent);
          backup = null;
          if (exactRetry) return Object.freeze([]);
        }
      }
    }

    const currentDestination = inspectExactNoFollowDirectoryPresence(
      destinationRoot,
      'Release artifact publication destination'
    );
    if (currentDestination.state === 'present') {
      try {
        const currentManifest = await assertReleaseArtifactReadback(destinationRoot, 'published');
        if (sameExpectedManifest(currentManifest)) return Object.freeze([]);
      } catch {
        // A malformed existing destination is still retained as the exact
        // rollback preimage; it is never deleted or adopted by path alone.
      }
      backup = relocateRetainedNoFollowDirectory({
        directory: currentDestination.directory.target,
        tombstoneName: backupName
      });
    }

    const staged = inspectNoFollowDirectoryChain(
      stagedArtifactRoot,
      'Release artifact staged publication candidate'
    ).target;
    let published: PhysicalDirectoryIdentity;
    try {
      assertPublicationParent(parent);
      published = relocateRetainedNoFollowDirectoryAcrossParents({
        directory: staged,
        destinationParent: parent,
        tombstoneName: path.basename(destinationRoot)
      });
      assertPublicationParent(parent);
    } catch (publicationError) {
      if (backup !== null) {
        return await restorePreviousAfterCandidateRenameFailure({
          destinationRoot,
          backup,
          parent,
          publicationError
        });
      }
      throw publicationError;
    }

    try {
      const publishedManifest = await assertReleaseArtifactReadback(destinationRoot, 'published');
      if (!sameExpectedManifest(publishedManifest)) {
        throw new Error('Published release artifact differs from the exact staged manifest');
      }
      assertPublicationParent(parent);
    } catch (readbackError) {
      return await recoverAfterPublishedReadbackFailure({
        destinationRoot,
        backup,
        published,
        parent,
        readbackError
      });
    }

    if (backup === null) return Object.freeze([]);
    const cleanup = await collectCleanupFinding(
      'previous-artifact',
      backup.path,
      async () => {
        assertPublicationParent(parent);
        retireReleaseTree(
          backup!,
          parent,
          'Release artifact previous cleanup root'
        );
        assertPublicationParent(parent);
      }
    );
    return Object.freeze(cleanup === null ? [] : [cleanup]);
  } catch (error) {
    primaryFailure = error;
    hasPrimaryFailure = true;
    throw error;
  } finally {
    try {
      if (lease.recoveryPending) lease.restoreReclaimedOwner();
      else lease.release();
    } catch (settlementFailure) {
      if (hasPrimaryFailure) {
        throw new AggregateError(
          [primaryFailure, settlementFailure],
          'Release artifact publication and lease settlement both failed.'
        );
      }
      throw settlementFailure;
    }
  }
}

async function collectTemporaryCleanupFindings(input: {
  readonly artifactStage: PhysicalDirectoryIdentity | null;
  readonly artifactStageParent: PhysicalDirectoryIdentity;
  readonly frozenSourceStageRoot: string;
  readonly disposeFrozenSource: () => Promise<void>;
}): Promise<readonly ReleaseCleanupFinding[]> {
  const findings: ReleaseCleanupFinding[] = [];
  if (input.artifactStage !== null) {
    const finding = await collectCleanupFinding(
      'artifact-stage',
      input.artifactStage.path,
      async () => {
        retireReleaseTree(
          input.artifactStage!,
          input.artifactStageParent,
          'Release artifact failed stage cleanup'
        );
      }
    );
    if (finding !== null) findings.push(finding);
  }
  const sourceFinding = await collectCleanupFinding(
    'frozen-source',
    input.frozenSourceStageRoot,
    input.disposeFrozenSource
  );
  if (sourceFinding !== null) findings.push(sourceFinding);
  return Object.freeze(findings);
}

export async function buildReleaseArtifact(
  repositoryRoot: string,
  destinationRoot: string
): Promise<ReleaseArtifactBuildReceipt> {
  const absoluteDestinationRoot = path.resolve(destinationRoot);
  const destinationParentPath = path.dirname(absoluteDestinationRoot);
  const destinationParent = inspectNoFollowDirectoryChain(
    destinationParentPath,
    'Release artifact destination parent'
  ).target;
  if (destinationParent.path !== destinationParentPath) {
    throw new Error('Release artifact destination parent changed lexical identity during retention');
  }
  await assertDestinationAdmissible(absoluteDestinationRoot, destinationParent);

  const source = await prepareFrozenReleaseSource(repositoryRoot);
  let artifactStage: PhysicalDirectoryIdentity | null = null;
  let manifest: ReleaseArtifactManifest | null = null;
  let publicationCleanupFindings: readonly ReleaseCleanupFinding[] = Object.freeze([]);
  let primaryFailure: { readonly error: unknown } | null = null;

  try {
    assertPublicationParent(destinationParent);
    artifactStage = allocateReleaseStage(
      destinationParent,
      '.sec-release-artifact-stage-'
    );
    assertPublicationParent(destinationParent);

    const artifactSegments = path.posix.dirname(source.entrypoint.artifact)
      .split('/')
      .filter((segment) => segment.length > 0 && segment !== '.');
    const stagedArtifactRoot = createNoFollowOrdinaryDirectoryChain(
      artifactStage,
      artifactSegments,
      undefined,
      0o755
    ).path;

    await buildFrozenReleaseBundle(source, stagedArtifactRoot);
    assertReleaseBunRuntimeRequirement(source.builder);

    for (const relativePath of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
      const sourcePath = path.join(source.root, relativePath);
      const destinationPath = path.join(stagedArtifactRoot, relativePath);
      const sourceIdentity = inspectNoFollowDirectoryChain(
        sourcePath,
        `Release artifact resource source ${relativePath}`
      ).target;
      await copyNoFollowDirectoryTreesBulk([{
        source: sourceIdentity,
        target: destinationPath
      }], {
        preservePermissionMode: true
      });
    }

    manifest = await writeAndVerifyManifest(stagedArtifactRoot, {
      schema: 'sec-release-artifact-manifest-v1',
      packageVersion: source.packageVersion,
      sourceCommit: source.sourceCommit,
      sourceTree: source.sourceTree,
      dependencyLockDigest: source.dependencyLockDigest,
      builder: source.builder
    });

    publicationCleanupFindings = await publishAcceptedArtifact(
      stagedArtifactRoot,
      absoluteDestinationRoot,
      destinationParent,
      manifest
    );
  } catch (error) {
    primaryFailure = { error };
  }

  const temporaryCleanupFindings = await collectTemporaryCleanupFindings({
    artifactStage,
    artifactStageParent: destinationParent,
    frozenSourceStageRoot: source.stageRoot,
    disposeFrozenSource: () => disposeFrozenReleaseSource(source)
  });
  const cleanupFindings = Object.freeze([
    ...publicationCleanupFindings,
    ...temporaryCleanupFindings
  ]);

  if (primaryFailure !== null) {
    throw new Error(
      `Release artifact build/publication failed: ${failureText(primaryFailure.error)}`
      + cleanupFailureSuffix(cleanupFindings),
      { cause: primaryFailure.error }
    );
  }
  if (manifest === null) {
    throw new Error('Release artifact reached accepted terminal state without one staged manifest');
  }

  return Object.freeze({
    schema: 'sec-release-artifact-build-receipt-v1' as const,
    publicationStatus: 'accepted' as const,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
    artifactRoot: absoluteDestinationRoot,
    manifestDigest: manifest.contentDigest,
    fileCount: manifest.files.length,
    cleanupFindings
  });
}
