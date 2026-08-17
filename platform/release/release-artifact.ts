import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { digest, sha256 } from '../shared/canonical-primitives.ts';
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

async function listArtifactFiles(root: string): Promise<ReleaseArtifactFileV1[]> {
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

async function publishAcceptedArtifact(stagedArtifactRoot: string, destinationRoot: string): Promise<void> {
  const parent = path.dirname(destinationRoot);
  const backupRoot = path.join(parent, `.sec-release-previous-${randomUUID()}`);
  let movedPrevious = false;
  try {
    try {
      await fs.rename(destinationRoot, backupRoot);
      movedPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    try {
      await fs.rename(stagedArtifactRoot, destinationRoot);
    } catch (error) {
      if (movedPrevious) await fs.rename(backupRoot, destinationRoot);
      throw error;
    }

    try {
      await assertReleaseArtifactReadback(destinationRoot, 'published');
    } catch (error) {
      const failedRoot = path.join(parent, `.sec-release-failed-${randomUUID()}`);
      await fs.rename(destinationRoot, failedRoot).catch(() => undefined);
      if (movedPrevious) await fs.rename(backupRoot, destinationRoot).catch(() => undefined);
      throw error;
    }

    if (movedPrevious) {
      await fs.rm(backupRoot, { recursive: true, force: true });
    }
  } catch (error) {
    throw error;
  }
}

export async function buildReleaseArtifactV1(
  repositoryRoot: string,
  destinationRoot: string
): Promise<ReleaseArtifactBuildReceiptV1> {
  const absoluteDestinationRoot = path.resolve(destinationRoot);
  const destinationParent = path.dirname(absoluteDestinationRoot);
  await fs.mkdir(destinationParent, { recursive: true });

  const source = await prepareFrozenReleaseSourceV1(repositoryRoot);
  let artifactStageRoot: string | null = null;
  try {
    artifactStageRoot = await fs.mkdtemp(path.join(destinationParent, '.sec-release-artifact-stage-'));
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

    await publishAcceptedArtifact(stagedArtifactRoot, absoluteDestinationRoot);
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
