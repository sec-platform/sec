import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { acquirePhysicalMutationLease } from '../../adapters/runtime-state/physical/runtime/mutation-lease.ts';
import { assertSameNoFollowDirectoryIdentity, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, relocateRetainedNoFollowDirectory, relocateRetainedNoFollowDirectoryAcrossParents, type PhysicalDirectoryIdentity } from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { digest, sha256 } from '../../contracts/canonical.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS
} from '../../adapters/toolchain/runtime.ts';
import {
  assertReleaseBunRuntimeRequirement,
  buildFrozenReleaseBundle,
  disposeFrozenReleaseSource,
  prepareFrozenReleaseSource,
  type ReleaseBuilderIdentity
} from './release-source-materialization.ts';

export const RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH = 'release-artifact-manifest.json' as const;
export const RELEASE_BUN_ENTRYPOINT_SHEBANG = '#!/usr/bin/env bun\n' as const;

export interface ReleaseArtifactFile {
  readonly path: string;
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly executable: boolean;
}

export interface ReleaseArtifactManifest {
  readonly schema: 'sec-release-artifact-manifest-v1';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: ReleaseBuilderIdentity;
  readonly files: readonly ReleaseArtifactFile[];
  readonly contentDigest: `sha256:${string}`;
}

export type ReleaseCleanupPhase =
  | 'previous-artifact'
  | 'artifact-stage'
  | 'frozen-source';

export interface ReleaseCleanupFinding {
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
  try {
    const metadata = await fs.lstat(destinationRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Existing release artifact destination is not one ordinary directory');
    }
    inspectNoFollowDirectoryChain(destinationRoot, 'Existing release artifact destination');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assertPublicationParent(parent);
}

async function listArtifactFiles(root: string): Promise<ReleaseArtifactFile[]> {
  const rootMetadata = await fs.lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Release artifact root is not one ordinary directory');
  }
  const files: ReleaseArtifactFile[] = [];

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Release artifact contains a symbolic link: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Release artifact contains a non-ordinary entry: ${relativePath}`);
      }
      const [bytes, metadata] = await Promise.all([
        fs.readFile(absolutePath),
        fs.stat(absolutePath)
      ]);
      files.push(Object.freeze({
        path: relativePath,
        bytes: bytes.byteLength,
        digest: `sha256:${digest(bytes)}` as `sha256:${string}`,
        executable: (metadata.mode & 0o111) !== 0
      }));
    }
  }

  await walk(root, '');
  return files;
}

function assertReleaseBuilderIdentity(value: unknown, label: string): asserts value is ReleaseBuilderIdentity {
  const candidate = value as Partial<ReleaseBuilderIdentity> | null;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    candidate.schema !== 'sec-release-builder-identity-v1' ||
    candidate.runtime !== 'bun' ||
    typeof candidate.version !== 'string' ||
    candidate.version.length === 0 ||
    typeof candidate.executableSha256 !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/u.test(candidate.executableSha256) ||
    typeof candidate.platform !== 'string' ||
    candidate.platform.length === 0 ||
    typeof candidate.architecture !== 'string' ||
    candidate.architecture.length === 0
  ) {
    throw new Error(`${label} is not one valid SEC release builder identity`);
  }
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
  const manifestPath = path.join(artifactRoot, RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH);
  const readback = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ReleaseArtifactManifest;
  if (readback.schema !== 'sec-release-artifact-manifest-v1') {
    throw new Error(`${label} release artifact manifest schema is invalid`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(readback.dependencyLockDigest)) {
    throw new Error(`${label} release artifact dependency lock digest is invalid`);
  }
  assertReleaseBuilderIdentity(readback.builder, `${label} release artifact builder`);
  assertReleaseBunRuntimeRequirement(readback.builder);
  if (sha256(manifestMaterialFromReadback(readback)) !== readback.contentDigest) {
    throw new Error(`${label} release artifact manifest readback digest is invalid`);
  }
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
  const manifestPath = path.join(artifactRoot, RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH);
  await fs.writeFile(
    manifestPath,
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    { flag: 'wx' }
  );
  return assertReleaseArtifactReadback(artifactRoot, 'staged');
}

export function releaseBunEntrypointBytes(bytes: Uint8Array): Buffer {
  const source = Buffer.from(bytes);
  const firstLineEnd = source.indexOf(0x0a);
  const firstLine = source.subarray(0, firstLineEnd < 0 ? source.byteLength : firstLineEnd)
    .toString('utf8')
    .replace(/\r$/u, '');
  if (firstLine.startsWith('#!') && firstLine !== RELEASE_BUN_ENTRYPOINT_SHEBANG.trimEnd()) {
    throw new Error(`Release bundle contains a non-Bun interpreter directive: ${firstLine}`);
  }
  return firstLine.startsWith('#!')
    ? source
    : Buffer.concat([Buffer.from(RELEASE_BUN_ENTRYPOINT_SHEBANG, 'utf8'), source]);
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const destinationKey = createHash('sha256').update(path.basename(destinationRoot)).digest('hex');
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
          assertSameNoFollowDirectoryIdentity(
            acceptedBackup,
            'Release artifact interrupted previous cleanup root'
          );
          await fs.rm(acceptedBackup.path, { recursive: true, force: false });
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
        return restorePreviousAfterCandidateRenameFailure({
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
      return recoverAfterPublishedReadbackFailure({
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
        assertSameNoFollowDirectoryIdentity(backup!, 'Release artifact previous cleanup root');
        await fs.rm(backup!.path, { recursive: true, force: true });
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
  readonly artifactStageRoot: string | null;
  readonly frozenSourceStageRoot: string;
  readonly disposeFrozenSource: () => Promise<void>;
}): Promise<readonly ReleaseCleanupFinding[]> {
  const findings: ReleaseCleanupFinding[] = [];
  if (input.artifactStageRoot !== null) {
    const finding = await collectCleanupFinding(
      'artifact-stage',
      input.artifactStageRoot,
      () => fs.rm(input.artifactStageRoot!, { recursive: true, force: true })
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
  let artifactStageRoot: string | null = null;
  let manifest: ReleaseArtifactManifest | null = null;
  let publicationCleanupFindings: readonly ReleaseCleanupFinding[] = Object.freeze([]);
  let primaryFailure: unknown = null;

  try {
    assertPublicationParent(destinationParent);
    artifactStageRoot = await fs.mkdtemp(path.join(destinationParent.path, '.sec-release-artifact-stage-'));
    inspectNoFollowDirectoryChain(artifactStageRoot, 'Release artifact staging root');
    assertPublicationParent(destinationParent);

    const stagedArtifactRoot = path.join(
      artifactStageRoot,
      ...path.posix.dirname(source.entrypoint.artifact).split('/')
    );
    await fs.mkdir(stagedArtifactRoot, { recursive: true });

    await buildFrozenReleaseBundle(source, stagedArtifactRoot);
    assertReleaseBunRuntimeRequirement(source.builder);

    for (const relativePath of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
      const sourcePath = path.join(source.root, relativePath);
      const destinationPath = path.join(stagedArtifactRoot, relativePath);
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.cp(sourcePath, destinationPath, { recursive: true });
    }

    const entrypoint = path.join(
      artifactStageRoot,
      ...source.entrypoint.artifact.split('/')
    );
    const entrypointBytes = releaseBunEntrypointBytes(await fs.readFile(entrypoint));
    await fs.writeFile(entrypoint, entrypointBytes);
    await fs.chmod(entrypoint, 0o755);

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
    primaryFailure = error;
  }

  const temporaryCleanupFindings = await collectTemporaryCleanupFindings({
    artifactStageRoot,
    frozenSourceStageRoot: source.stageRoot,
    disposeFrozenSource: () => disposeFrozenReleaseSource(source)
  });
  const cleanupFindings = Object.freeze([
    ...publicationCleanupFindings,
    ...temporaryCleanupFindings
  ]);

  if (primaryFailure !== null) {
    throw new Error(
      `Release artifact build/publication failed: ${failureText(primaryFailure)}`
      + cleanupFailureSuffix(cleanupFindings),
      primaryFailure instanceof Error ? { cause: primaryFailure } : undefined
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
