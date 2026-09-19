import fs from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from '../../contracts/canonical.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  buildDocumentationArtifact,
  DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH,
  readDocumentationArtifactManifest,
  type DocumentationCleanupFinding
} from './documentation-artifact.ts';
import {
  buildReleaseArtifact,
  readReleaseArtifactManifest,
  RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH,
  RELEASE_RUNTIME_LICENSE_RELATIVE_PATH,
  RELEASE_SOURCE_REPOSITORY,
  type ReleaseCleanupFinding
} from './release-artifact.ts';

export const RELEASE_SET_MANIFEST_RELATIVE_PATH = 'release-set-manifest.json' as const;
export const RELEASE_SET_RUNTIME_RELATIVE_PATH = 'runtime' as const;
export const RELEASE_SET_DOCUMENTATION_RELATIVE_PATH = 'documentation' as const;

export interface ReleaseSetManifest {
  readonly schema: 'sec.release-set/1';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly sourceRepository: typeof RELEASE_SOURCE_REPOSITORY;
  readonly members: Readonly<{
    runtime: Readonly<{
      path: typeof RELEASE_SET_RUNTIME_RELATIVE_PATH;
      manifestPath: string;
      manifestDigest: `sha256:${string}`;
      fileCount: number;
      license: 'MPL-2.0';
      licenseTextPath: 'runtime/LICENSE';
    }>;
    documentation: Readonly<{
      path: typeof RELEASE_SET_DOCUMENTATION_RELATIVE_PATH;
      manifestPath: string;
      manifestDigest: `sha256:${string}`;
      fileCount: number;
      license: 'CC-BY-4.0';
      licenseTextPath: 'documentation/LICENSES/CC-BY-4.0.txt';
    }>;
  }>;
  readonly contentDigest: `sha256:${string}`;
}

export interface ReleaseSetBuildReceipt {
  readonly schema: 'sec.release-set-build-receipt/1';
  readonly publicationStatus: 'accepted';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly artifactRoot: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
  readonly cleanupFindings: readonly (ReleaseCleanupFinding | DocumentationCleanupFinding)[];
}

function releaseSetMaterial(
  manifest: Omit<ReleaseSetManifest, 'contentDigest'>
): Omit<ReleaseSetManifest, 'contentDigest'> {
  return Object.freeze({ ...manifest });
}

export function createReleaseSetManifest(input: Readonly<{
  packageVersion: string;
  sourceCommit: string;
  sourceTree: string;
  runtimeManifestDigest: `sha256:${string}`;
  runtimeFileCount: number;
  documentationManifestDigest: `sha256:${string}`;
  documentationFileCount: number;
}>): ReleaseSetManifest {
  const material = releaseSetMaterial({
    schema: 'sec.release-set/1' as const,
    packageVersion: input.packageVersion,
    sourceCommit: input.sourceCommit,
    sourceTree: input.sourceTree,
    sourceRepository: RELEASE_SOURCE_REPOSITORY,
    members: Object.freeze({
      runtime: Object.freeze({
        path: RELEASE_SET_RUNTIME_RELATIVE_PATH,
        manifestPath: `${RELEASE_SET_RUNTIME_RELATIVE_PATH}/${RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH}`,
        manifestDigest: input.runtimeManifestDigest,
        fileCount: input.runtimeFileCount,
        license: 'MPL-2.0' as const,
        licenseTextPath: `${RELEASE_SET_RUNTIME_RELATIVE_PATH}/${RELEASE_RUNTIME_LICENSE_RELATIVE_PATH}` as 'runtime/LICENSE'
      }),
      documentation: Object.freeze({
        path: RELEASE_SET_DOCUMENTATION_RELATIVE_PATH,
        manifestPath: `${RELEASE_SET_DOCUMENTATION_RELATIVE_PATH}/${DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH}`,
        manifestDigest: input.documentationManifestDigest,
        fileCount: input.documentationFileCount,
        license: 'CC-BY-4.0' as const,
        licenseTextPath: `${RELEASE_SET_DOCUMENTATION_RELATIVE_PATH}/LICENSES/CC-BY-4.0.txt` as 'documentation/LICENSES/CC-BY-4.0.txt'
      })
    })
  });
  return Object.freeze({
    ...material,
    contentDigest: sha256(material) as `sha256:${string}`
  });
}

export async function readReleaseSetManifest(releaseRoot: string): Promise<ReleaseSetManifest> {
  inspectNoFollowDirectoryChain(releaseRoot, 'Release set readback root');
  const manifest = JSON.parse(await fs.readFile(
    path.join(releaseRoot, RELEASE_SET_MANIFEST_RELATIVE_PATH),
    'utf8'
  )) as ReleaseSetManifest;
  if (manifest.schema !== 'sec.release-set/1') {
    throw new Error('Release set manifest schema is invalid');
  }
  const { contentDigest, ...material } = manifest;
  if (sha256(releaseSetMaterial(material)) !== contentDigest) {
    throw new Error('Release set manifest digest is invalid');
  }
  if (
    manifest.sourceRepository !== RELEASE_SOURCE_REPOSITORY
    || manifest.members.runtime.path !== RELEASE_SET_RUNTIME_RELATIVE_PATH
    || manifest.members.documentation.path !== RELEASE_SET_DOCUMENTATION_RELATIVE_PATH
    || manifest.members.runtime.manifestPath
      !== `${RELEASE_SET_RUNTIME_RELATIVE_PATH}/${RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH}`
    || manifest.members.documentation.manifestPath
      !== `${RELEASE_SET_DOCUMENTATION_RELATIVE_PATH}/${DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH}`
    || manifest.members.runtime.license !== 'MPL-2.0'
    || manifest.members.runtime.licenseTextPath !== 'runtime/LICENSE'
    || manifest.members.documentation.license !== 'CC-BY-4.0'
    || manifest.members.documentation.licenseTextPath !== 'documentation/LICENSES/CC-BY-4.0.txt'
  ) {
    throw new Error('Release set member/source contract is invalid');
  }

  const [runtime, documentation] = await Promise.all([
    readReleaseArtifactManifest(path.join(releaseRoot, RELEASE_SET_RUNTIME_RELATIVE_PATH)),
    readDocumentationArtifactManifest(path.join(releaseRoot, RELEASE_SET_DOCUMENTATION_RELATIVE_PATH))
  ]);
  if (
    runtime.sourceCommit !== manifest.sourceCommit
    || runtime.sourceTree !== manifest.sourceTree
    || documentation.sourceCommit !== manifest.sourceCommit
    || documentation.sourceTree !== manifest.sourceTree
    || runtime.packageVersion !== manifest.packageVersion
    || documentation.packageVersion !== manifest.packageVersion
    || runtime.contentDigest !== manifest.members.runtime.manifestDigest
    || documentation.contentDigest !== manifest.members.documentation.manifestDigest
    || runtime.files.length !== manifest.members.runtime.fileCount
    || documentation.files.length !== manifest.members.documentation.fileCount
    || !runtime.files.some((file) => file.path === RELEASE_RUNTIME_LICENSE_RELATIVE_PATH)
  ) {
    throw new Error('Release set members do not match the shared release identity');
  }
  return Object.freeze(manifest);
}

async function writeReleaseSetManifest(
  releaseRoot: string,
  manifest: ReleaseSetManifest
): Promise<ReleaseSetManifest> {
  await fs.writeFile(
    path.join(releaseRoot, RELEASE_SET_MANIFEST_RELATIVE_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' }
  );
  return readReleaseSetManifest(releaseRoot);
}

export async function buildReleaseSet(
  repositoryRoot: string,
  destinationRoot: string
): Promise<ReleaseSetBuildReceipt> {
  const absoluteDestinationRoot = path.resolve(destinationRoot);
  const destinationParentPath = path.dirname(absoluteDestinationRoot);
  const destinationParent = inspectNoFollowDirectoryChain(
    destinationParentPath,
    'Release set destination parent'
  ).target;
  if (destinationParent.path !== destinationParentPath) {
    throw new Error('Release set destination parent changed physical identity');
  }
  const destinationPresence = inspectExactNoFollowDirectoryPresence(
    absoluteDestinationRoot,
    'Release set destination'
  );
  if (destinationPresence.state === 'present') {
    inspectNoFollowDirectoryChain(absoluteDestinationRoot, 'Existing release set destination');
  }

  const stageRoot = await fs.mkdtemp(path.join(destinationParent.path, '.sec-release-set-stage-'));
  let published = false;
  let primaryFailure: unknown = null;
  let manifest: ReleaseSetManifest | null = null;
  const cleanupFindings: (ReleaseCleanupFinding | DocumentationCleanupFinding)[] = [];

  try {
    const runtime = await buildReleaseArtifact(
      repositoryRoot,
      path.join(stageRoot, RELEASE_SET_RUNTIME_RELATIVE_PATH)
    );
    cleanupFindings.push(...runtime.cleanupFindings);
    const documentation = await buildDocumentationArtifact(
      repositoryRoot,
      path.join(stageRoot, RELEASE_SET_DOCUMENTATION_RELATIVE_PATH),
      { sourceCommit: runtime.sourceCommit, sourceTree: runtime.sourceTree }
    );
    cleanupFindings.push(...documentation.cleanupFindings);

    if (
      documentation.sourceCommit !== runtime.sourceCommit
      || documentation.sourceTree !== runtime.sourceTree
    ) {
      throw new Error('Runtime and documentation artifacts do not share one exact source revision');
    }

    const runtimeManifest = await readReleaseArtifactManifest(
      path.join(stageRoot, RELEASE_SET_RUNTIME_RELATIVE_PATH)
    );
    if (runtimeManifest.packageVersion !== documentation.packageVersion) {
      throw new Error('Runtime and documentation artifacts do not share one package version');
    }

    manifest = createReleaseSetManifest({
      packageVersion: runtimeManifest.packageVersion,
      sourceCommit: runtime.sourceCommit,
      sourceTree: runtime.sourceTree,
      runtimeManifestDigest: runtime.manifestDigest,
      runtimeFileCount: runtime.fileCount,
      documentationManifestDigest: documentation.manifestDigest,
      documentationFileCount: documentation.fileCount
    });
    await writeReleaseSetManifest(stageRoot, manifest);

    if (destinationPresence.state === 'present') {
      const existing = await readReleaseSetManifest(absoluteDestinationRoot);
      if (existing.contentDigest !== manifest.contentDigest) {
        throw new Error('Existing release set destination is a different immutable release');
      }
    } else {
      try {
        await fs.rename(stageRoot, absoluteDestinationRoot);
        published = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
        const racedManifest = await readReleaseSetManifest(absoluteDestinationRoot);
        if (racedManifest.contentDigest !== manifest.contentDigest) {
          throw new Error('Concurrent release set publication selected a different immutable release');
        }
      }
      if (published) {
        try {
          const publishedManifest = await readReleaseSetManifest(absoluteDestinationRoot);
          if (publishedManifest.contentDigest !== manifest.contentDigest) {
            throw new Error('Published release set differs from its staged manifest');
          }
        } catch (readbackError) {
          try {
            await fs.rename(absoluteDestinationRoot, stageRoot);
            published = false;
          } catch (restoreError) {
            throw new AggregateError(
              [readbackError, restoreError],
              'Release set publication readback failed and absence could not be restored'
            );
          }
          throw readbackError;
        }
      }
    }
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (!published) {
      try {
        await fs.rm(stageRoot, { recursive: true, force: true });
      } catch (cleanupError) {
        if (primaryFailure === null) primaryFailure = cleanupError;
        else primaryFailure = new AggregateError(
          [primaryFailure, cleanupError],
          `Release set failed and staging cleanup did not converge: ${stageRoot}`
        );
      }
    }
  }

  if (primaryFailure !== null) {
    throw primaryFailure;
  }
  if (manifest === null) {
    throw new Error('Release set reached terminal state without one manifest');
  }

  return Object.freeze({
    schema: 'sec.release-set-build-receipt/1' as const,
    publicationStatus: 'accepted' as const,
    sourceCommit: manifest.sourceCommit,
    sourceTree: manifest.sourceTree,
    artifactRoot: absoluteDestinationRoot,
    manifestDigest: manifest.contentDigest,
    fileCount: manifest.members.runtime.fileCount + manifest.members.documentation.fileCount,
    cleanupFindings: Object.freeze(cleanupFindings)
  });
}
