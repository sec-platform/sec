import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { digest, sha256 } from '../shared/canonical-primitives.ts';
import {
  assertSameNoFollowDirectoryIdentityV1,
  inspectNoFollowDirectoryChainV1,
  type PhysicalDirectoryIdentityV1
} from '../shared/physical-no-follow.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  RELEASE_ENTRYPOINT_RELATIVE_PATH,
  resolveCompilerRuntimeLayout
} from '../shared/runtime-layout.ts';
import {
  buildFrozenReleaseBundleV1,
  disposeFrozenReleaseSourceV1,
  prepareFrozenReleaseSourceV1
} from './release-source-materialization.ts';

export const RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH = 'release-artifact-manifest.json' as const;

export interface ReleaseArtifactFileV1 {
  readonly path: string;
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly executable: boolean;
}

export interface ReleaseArtifactManifestV1 {
  readonly schema: 'sec-release-artifact-manifest-v1';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: string;
  readonly files: readonly ReleaseArtifactFileV1[];
  readonly contentDigest: `sha256:${string}`;
}

export interface ReleaseArtifactBuildReceiptV1 {
  readonly schema: 'sec-release-artifact-build-receipt-v1';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly artifactRoot: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
}

function assertPublicationParent(parent: PhysicalDirectoryIdentityV1): PhysicalDirectoryIdentityV1 {
  return assertSameNoFollowDirectoryIdentityV1(
    parent,
    'Release artifact publication parent'
  ).target;
}

async function assertDestinationAdmissible(
  destinationRoot: string,
  parent: PhysicalDirectoryIdentityV1
): Promise<void> {
  assertPublicationParent(parent);
  try {
    const metadata = await fs.lstat(destinationRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error('Existing release artifact destination is not one ordinary directory');
    }
    inspectNoFollowDirectoryChainV1(destinationRoot, 'Existing release artifact destination');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assertPublicationParent(parent);
}

async function listArtifactFiles(root: string): Promise<ReleaseArtifactFileV1[]> {
  const rootMetadata = await fs.lstat(root);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error('Release artifact root is not one ordinary directory');
  }
  const files: ReleaseArtifactFileV1[] = [];

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

function manifestMaterial(input: Omit<ReleaseArtifactManifestV1, 'contentDigest'>) {
  return Object.freeze({ ...input });
}

function manifestMaterialFromReadback(readback: ReleaseArtifactManifestV1) {
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
): Promise<ReleaseArtifactManifestV1> {
  const manifestPath = path.join(artifactRoot, RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH);
  const readback = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ReleaseArtifactManifestV1;
  if (readback.schema !== 'sec-release-artifact-manifest-v1') {
    throw new Error(`${label} release artifact manifest schema is invalid`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(readback.dependencyLockDigest)) {
    throw new Error(`${label} release artifact dependency lock digest is invalid`);
  }
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
  input: Omit<ReleaseArtifactManifestV1, 'files' | 'contentDigest'>
): Promise<ReleaseArtifactManifestV1> {
  const files = Object.freeze(await listArtifactFiles(artifactRoot));
  const material = manifestMaterial({ ...input, files });
  const manifest: ReleaseArtifactManifestV1 = Object.freeze({
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

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function restorePreviousAfterCandidateRenameFailure(input: {
  readonly destinationRoot: string;
  readonly backupRoot: string;
  readonly parent: PhysicalDirectoryIdentityV1;
  readonly publicationError: unknown;
}): Promise<never> {
  try {
    assertPublicationParent(input.parent);
    await fs.rename(input.backupRoot, input.destinationRoot);
    assertPublicationParent(input.parent);
  } catch (restoreError) {
    throw new Error(
      `Release artifact publication failed and previous artifact restoration did not converge; ` +
      `destination=${input.destinationRoot}; previous=${input.backupRoot}; ` +
      `publication=${failureText(input.publicationError)}; restore=${failureText(restoreError)}`,
      { cause: restoreError }
    );
  }
  throw input.publicationError;
}

async function recoverAfterPublishedReadbackFailure(input: {
  readonly destinationRoot: string;
  readonly backupRoot: string;
  readonly parent: PhysicalDirectoryIdentityV1;
  readonly movedPrevious: boolean;
  readonly readbackError: unknown;
}): Promise<never> {
  const failedRoot = path.join(input.parent.path, `.sec-release-failed-${randomUUID()}`);
  try {
    assertPublicationParent(input.parent);
    await fs.rename(input.destinationRoot, failedRoot);
    assertPublicationParent(input.parent);
  } catch (containmentError) {
    throw new Error(
      `Published release artifact failed readback and the failed candidate could not be isolated; ` +
      `candidate=${input.destinationRoot}; previous=${input.movedPrevious ? input.backupRoot : '<none>'}; ` +
      `readback=${failureText(input.readbackError)}; containment=${failureText(containmentError)}`,
      { cause: containmentError }
    );
  }

  if (input.movedPrevious) {
    try {
      assertPublicationParent(input.parent);
      await fs.rename(input.backupRoot, input.destinationRoot);
      assertPublicationParent(input.parent);
    } catch (restoreError) {
      throw new Error(
        `Published release artifact failed readback and previous artifact restoration did not converge; ` +
        `failedCandidate=${failedRoot}; previous=${input.backupRoot}; destination=${input.destinationRoot}; ` +
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
  parent: PhysicalDirectoryIdentityV1
): Promise<void> {
  assertPublicationParent(parent);
  if (path.dirname(destinationRoot) !== parent.path) {
    throw new Error('Release artifact destination is not a direct child of its retained publication parent');
  }
  const backupRoot = path.join(parent.path, `.sec-release-previous-${randomUUID()}`);
  let movedPrevious = false;

  try {
    assertPublicationParent(parent);
    await fs.rename(destinationRoot, backupRoot);
    movedPrevious = true;
    assertPublicationParent(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  try {
    assertPublicationParent(parent);
    await fs.rename(stagedArtifactRoot, destinationRoot);
    assertPublicationParent(parent);
  } catch (publicationError) {
    if (movedPrevious) {
      return restorePreviousAfterCandidateRenameFailure({
        destinationRoot,
        backupRoot,
        parent,
        publicationError
      });
    }
    throw publicationError;
  }

  try {
    await assertReleaseArtifactReadback(destinationRoot, 'published');
    assertPublicationParent(parent);
  } catch (readbackError) {
    return recoverAfterPublishedReadbackFailure({
      destinationRoot,
      backupRoot,
      parent,
      movedPrevious,
      readbackError
    });
  }

  if (movedPrevious) {
    try {
      assertPublicationParent(parent);
      await fs.rm(backupRoot, { recursive: true, force: true });
      assertPublicationParent(parent);
    } catch (cleanupError) {
      throw new Error(
        `Published release artifact is accepted but previous-artifact cleanup failed; ` +
        `accepted=${destinationRoot}; residue=${backupRoot}; cleanup=${failureText(cleanupError)}`,
        { cause: cleanupError }
      );
    }
  }
}

export async function buildReleaseArtifactV1(
  repositoryRoot: string,
  destinationRoot: string
): Promise<ReleaseArtifactBuildReceiptV1> {
  const absoluteDestinationRoot = path.resolve(destinationRoot);
  const destinationParentPath = path.dirname(absoluteDestinationRoot);
  const destinationParent = inspectNoFollowDirectoryChainV1(
    destinationParentPath,
    'Release artifact destination parent'
  ).target;
  if (destinationParent.path !== destinationParentPath) {
    throw new Error('Release artifact destination parent changed lexical identity during retention');
  }
  await assertDestinationAdmissible(absoluteDestinationRoot, destinationParent);

  const source = await prepareFrozenReleaseSourceV1(repositoryRoot);
  let artifactStageRoot: string | null = null;
  try {
    assertPublicationParent(destinationParent);
    artifactStageRoot = await fs.mkdtemp(path.join(destinationParent.path, '.sec-release-artifact-stage-'));
    inspectNoFollowDirectoryChainV1(artifactStageRoot, 'Release artifact staging root');
    assertPublicationParent(destinationParent);

    const stageRuntimeLayout = resolveCompilerRuntimeLayout(pathToFileURL(path.join(
      artifactStageRoot,
      RELEASE_ENTRYPOINT_RELATIVE_PATH
    )).href);
    const stagedArtifactRoot = stageRuntimeLayout.runtimeAssetRoot;
    await fs.mkdir(stagedArtifactRoot, { recursive: true });

    await buildFrozenReleaseBundleV1(source, stagedArtifactRoot);

    for (const relativePath of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
      const sourcePath = path.join(source.root, relativePath);
      const destinationPath = path.join(stagedArtifactRoot, relativePath);
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.cp(sourcePath, destinationPath, { recursive: true });
    }

    const entrypoint = stageRuntimeLayout.executableModulePath;
    let entrypointBytes = await fs.readFile(entrypoint);
    if (!entrypointBytes.toString('utf8').startsWith('#!/usr/bin/env node')) {
      entrypointBytes = Buffer.concat([
        Buffer.from('#!/usr/bin/env node\n', 'utf8'),
        entrypointBytes
      ]);
      await fs.writeFile(entrypoint, entrypointBytes);
    }
    await fs.chmod(entrypoint, 0o755);

    const manifest = await writeAndVerifyManifest(stagedArtifactRoot, {
      schema: 'sec-release-artifact-manifest-v1',
      packageVersion: source.packageVersion,
      sourceCommit: source.sourceCommit,
      sourceTree: source.sourceTree,
      dependencyLockDigest: source.dependencyLockDigest,
      builder: `bun@${Bun.version}`
    });

    await publishAcceptedArtifact(stagedArtifactRoot, absoluteDestinationRoot, destinationParent);
    return Object.freeze({
      schema: 'sec-release-artifact-build-receipt-v1' as const,
      sourceCommit: source.sourceCommit,
      sourceTree: source.sourceTree,
      artifactRoot: absoluteDestinationRoot,
      manifestDigest: manifest.contentDigest,
      fileCount: manifest.files.length
    });
  } finally {
    await Promise.all([
      artifactStageRoot === null
        ? Promise.resolve()
        : fs.rm(artifactStageRoot, { recursive: true, force: true }).catch(() => undefined),
      disposeFrozenReleaseSourceV1(source).catch(() => undefined)
    ]);
  }
}
