import fs from 'node:fs/promises';
import path from 'node:path';

import { digest, sha256 } from '../../contracts/canonical.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  materializeExactReleaseGitTree,
  type ExactReleaseGitTree
} from './release-git-tree-source.ts';
import {
  assertPublishedCanonicalDocumentationSource,
  materializeCanonicalDocumentationSource,
  type DocumentationReleaseFile
} from './documentation-source.ts';

export const DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH =
  'documentation-artifact-manifest.json' as const;
export const DOCUMENTATION_RELEASE_CREATOR = 'Jeremy Yang' as const;

export interface ReleaseSourceIdentity {
  readonly sourceCommit: string;
  readonly sourceTree: string;
}

export type DocumentationArtifactFile = DocumentationReleaseFile;

export interface DocumentationArtifactManifest {
  readonly schema: 'sec.release-documentation-artifact/1';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly documentationSourceSetDigest: `sha256:${string}`;
  readonly license: Readonly<{
    readonly spdx: 'CC-BY-4.0';
    readonly textPath: 'LICENSES/CC-BY-4.0.txt';
    readonly softwareLicenseTextPath: 'LICENSE';
    readonly classificationPath: 'REUSE.toml';
    readonly creator: typeof DOCUMENTATION_RELEASE_CREATOR;
    readonly work: 'Engineering Workspace Compiler (SEC)';
    readonly source: 'https://github.com/sec-platform/sec';
  }>;
  readonly files: readonly DocumentationArtifactFile[];
  readonly contentDigest: `sha256:${string}`;
}

export interface DocumentationArtifactBuildReceipt {
  readonly schema: 'sec.release-documentation-build-receipt/1';
  readonly publicationStatus: 'accepted';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly artifactRoot: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
  readonly cleanupFindings: readonly DocumentationCleanupFinding[];
}

export interface DocumentationCleanupFinding {
  readonly phase: 'documentation-stage' | 'documentation-source';
  readonly state: 'cleanup-unconfirmed';
  readonly path: string;
  readonly detail: string;
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function documentationCleanupFinding(
  phase: DocumentationCleanupFinding['phase'],
  targetPath: string,
  error: unknown
): DocumentationCleanupFinding {
  return Object.freeze({
    phase,
    state: 'cleanup-unconfirmed' as const,
    path: targetPath,
    detail: failureText(error)
  });
}

async function readPackageIdentity(sourceRoot: string): Promise<Readonly<{
  packageVersion: string;
  creator: typeof DOCUMENTATION_RELEASE_CREATOR;
}>> {
  const value = JSON.parse(await fs.readFile(path.join(sourceRoot, 'package.json'), 'utf8')) as {
    version?: unknown;
    author?: unknown;
  };
  if (typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error('Documentation release source package version is absent');
  }
  if (value.author !== DOCUMENTATION_RELEASE_CREATOR) {
    throw new Error('Documentation release source author does not match the required CC BY attribution');
  }
  return Object.freeze({ packageVersion: value.version, creator: DOCUMENTATION_RELEASE_CREATOR });
}

function assertExpectedSource(
  source: ExactReleaseGitTree,
  expectedSource: ReleaseSourceIdentity | undefined
): void {
  if (expectedSource === undefined) return;
  if (
    source.sourceCommit !== expectedSource.sourceCommit
    || source.sourceTree !== expectedSource.sourceTree
  ) {
    throw new Error([
      'Documentation release source differs from the expected release revision',
      `expectedCommit=${expectedSource.sourceCommit}`,
      `actualCommit=${source.sourceCommit}`,
      `expectedTree=${expectedSource.sourceTree}`,
      `actualTree=${source.sourceTree}`
    ].join(' '));
  }
}

function documentationManifestMaterial(
  manifest: Omit<DocumentationArtifactManifest, 'contentDigest'>
): Omit<DocumentationArtifactManifest, 'contentDigest'> {
  return Object.freeze({ ...manifest });
}

async function listPublishedDocumentationFiles(
  artifactRoot: string
): Promise<readonly DocumentationArtifactFile[]> {
  const files: DocumentationArtifactFile[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Documentation artifact contains a symbolic link: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Documentation artifact contains a non-ordinary entry: ${relativePath}`);
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
  await walk(artifactRoot, '');
  return Object.freeze(files);
}

export async function readDocumentationArtifactManifest(
  artifactRoot: string
): Promise<DocumentationArtifactManifest> {
  inspectNoFollowDirectoryChain(artifactRoot, 'Documentation artifact readback root');
  const manifest = JSON.parse(await fs.readFile(
    path.join(artifactRoot, DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH),
    'utf8'
  )) as DocumentationArtifactManifest;
  if (manifest.schema !== 'sec.release-documentation-artifact/1') {
    throw new Error('Documentation artifact manifest schema is invalid');
  }
  if (
    manifest.license?.spdx !== 'CC-BY-4.0'
    || manifest.license.textPath !== 'LICENSES/CC-BY-4.0.txt'
    || manifest.license.softwareLicenseTextPath !== 'LICENSE'
    || manifest.license.classificationPath !== 'REUSE.toml'
    || manifest.license.creator !== DOCUMENTATION_RELEASE_CREATOR
    || manifest.license.work !== 'Engineering Workspace Compiler (SEC)'
    || manifest.license.source !== 'https://github.com/sec-platform/sec'
  ) {
    throw new Error('Documentation artifact license/attribution contract is invalid');
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(manifest.documentationSourceSetDigest)) {
    throw new Error('Documentation artifact source-set digest is invalid');
  }
  const { contentDigest, ...material } = manifest;
  if (sha256(documentationManifestMaterial(material)) !== contentDigest) {
    throw new Error('Documentation artifact manifest digest is invalid');
  }
  const files = await listPublishedDocumentationFiles(artifactRoot);
  if (sha256(files) !== sha256(manifest.files)) {
    throw new Error('Documentation artifact physical file inventory differs from its manifest');
  }
  if (
    !files.some((file) => file.path === manifest.license.textPath)
    || !files.some((file) => file.path === manifest.license.softwareLicenseTextPath)
    || !files.some((file) => file.path === manifest.license.classificationPath)
  ) {
    throw new Error('Documentation artifact legal metadata is absent');
  }
  await assertPublishedCanonicalDocumentationSource(
    artifactRoot,
    manifest.documentationSourceSetDigest
  );
  return Object.freeze(manifest);
}

async function writeDocumentationManifest(
  artifactRoot: string,
  input: Readonly<{
    packageVersion: string;
    creator: typeof DOCUMENTATION_RELEASE_CREATOR;
    sourceCommit: string;
    sourceTree: string;
    documentationSourceSetDigest: `sha256:${string}`;
    files: readonly DocumentationArtifactFile[];
  }>
): Promise<DocumentationArtifactManifest> {
  const material = documentationManifestMaterial({
    schema: 'sec.release-documentation-artifact/1' as const,
    packageVersion: input.packageVersion,
    sourceCommit: input.sourceCommit,
    sourceTree: input.sourceTree,
    documentationSourceSetDigest: input.documentationSourceSetDigest,
    license: Object.freeze({
      spdx: 'CC-BY-4.0' as const,
      textPath: 'LICENSES/CC-BY-4.0.txt' as const,
      softwareLicenseTextPath: 'LICENSE' as const,
      classificationPath: 'REUSE.toml' as const,
      creator: input.creator,
      work: 'Engineering Workspace Compiler (SEC)' as const,
      source: 'https://github.com/sec-platform/sec' as const
    }),
    files: input.files
  });
  const manifest: DocumentationArtifactManifest = Object.freeze({
    ...material,
    contentDigest: sha256(material) as `sha256:${string}`
  });
  await fs.writeFile(
    path.join(artifactRoot, DOCUMENTATION_ARTIFACT_MANIFEST_RELATIVE_PATH),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' }
  );
  return readDocumentationArtifactManifest(artifactRoot);
}

async function assertDestinationAdmissible(destinationRoot: string): Promise<void> {
  const presence = inspectExactNoFollowDirectoryPresence(
    destinationRoot,
    'Documentation artifact destination'
  );
  if (presence.state === 'absent') return;
  inspectNoFollowDirectoryChain(destinationRoot, 'Existing documentation artifact destination');
}

export async function buildDocumentationArtifact(
  repositoryRoot: string,
  destinationRoot: string,
  expectedSource?: ReleaseSourceIdentity
): Promise<DocumentationArtifactBuildReceipt> {
  const absoluteDestinationRoot = path.resolve(destinationRoot);
  const destinationParentPath = path.dirname(absoluteDestinationRoot);
  const destinationParent = inspectNoFollowDirectoryChain(
    destinationParentPath,
    'Documentation artifact destination parent'
  ).target;
  if (destinationParent.path !== destinationParentPath) {
    throw new Error('Documentation artifact destination parent changed physical identity');
  }
  await assertDestinationAdmissible(absoluteDestinationRoot);

  const source = await materializeExactReleaseGitTree(repositoryRoot);
  let artifactStageRoot: string | null = null;
  let manifest: DocumentationArtifactManifest | null = null;
  let primaryFailure: unknown = null;
  let published = false;
  const cleanupFindings: DocumentationCleanupFinding[] = [];

  try {
    assertExpectedSource(source, expectedSource);
    const packageIdentity = await readPackageIdentity(source.root);
    artifactStageRoot = await fs.mkdtemp(
      path.join(destinationParent.path, '.sec-documentation-artifact-stage-')
    );
    inspectNoFollowDirectoryChain(artifactStageRoot, 'Documentation artifact staging root');
    const documentationSource = await materializeCanonicalDocumentationSource(
      source.root,
      artifactStageRoot
    );
    manifest = await writeDocumentationManifest(artifactStageRoot, {
      ...packageIdentity,
      sourceCommit: source.sourceCommit,
      sourceTree: source.sourceTree,
      documentationSourceSetDigest: documentationSource.sourceSetDigest,
      files: documentationSource.files
    });

    const existing = inspectExactNoFollowDirectoryPresence(
      absoluteDestinationRoot,
      'Documentation artifact destination before publication'
    );
    if (existing.state === 'present') {
      const existingManifest = await readDocumentationArtifactManifest(absoluteDestinationRoot);
      if (existingManifest.contentDigest !== manifest.contentDigest) {
        throw new Error('Existing documentation artifact destination is a different immutable release');
      }
    } else {
      try {
        await fs.rename(artifactStageRoot, absoluteDestinationRoot);
        published = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'ENOTEMPTY') throw error;
        const racedManifest = await readDocumentationArtifactManifest(absoluteDestinationRoot);
        if (racedManifest.contentDigest !== manifest.contentDigest) {
          throw new Error('Concurrent documentation artifact publication selected a different immutable release');
        }
      }
      if (published) {
        try {
          const publishedManifest = await readDocumentationArtifactManifest(absoluteDestinationRoot);
          if (publishedManifest.contentDigest !== manifest.contentDigest) {
            throw new Error('Published documentation artifact differs from its staged manifest');
          }
        } catch (readbackError) {
          try {
            await fs.rename(absoluteDestinationRoot, artifactStageRoot);
            published = false;
          } catch (restoreError) {
            throw new AggregateError(
              [readbackError, restoreError],
              'Documentation artifact publication readback failed and absence could not be restored'
            );
          }
          throw readbackError;
        }
      }
    }
  } catch (error) {
    primaryFailure = error;
  } finally {
    if (!published && artifactStageRoot !== null) {
      try {
        await fs.rm(artifactStageRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupFindings.push(documentationCleanupFinding('documentation-stage', artifactStageRoot, error));
      }
    }
    try {
      await fs.rm(source.stageRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupFindings.push(documentationCleanupFinding('documentation-source', source.stageRoot, error));
    }
  }

  if (primaryFailure !== null) {
    const cleanupSuffix = cleanupFindings.length === 0
      ? ''
      : `; cleanup=${cleanupFindings.map((finding) => `${finding.phase}:${finding.path}:${finding.detail}`).join(' | ')}`;
    throw new Error(
      `Documentation artifact build/publication failed: ${failureText(primaryFailure)}${cleanupSuffix}`,
      primaryFailure instanceof Error ? { cause: primaryFailure } : undefined
    );
  }
  if (manifest === null) {
    throw new Error('Documentation artifact reached terminal state without one manifest');
  }

  return Object.freeze({
    schema: 'sec.release-documentation-build-receipt/1' as const,
    publicationStatus: 'accepted' as const,
    packageVersion: manifest.packageVersion,
    sourceCommit: manifest.sourceCommit,
    sourceTree: manifest.sourceTree,
    artifactRoot: absoluteDestinationRoot,
    manifestDigest: manifest.contentDigest,
    fileCount: manifest.files.length,
    cleanupFindings: Object.freeze(cleanupFindings)
  });
}
