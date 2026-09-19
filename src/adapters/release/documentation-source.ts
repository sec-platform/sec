import fs from 'node:fs/promises';
import path from 'node:path';

import { compareCodeUnits, digest } from '../../contracts/canonical.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';

export const DOCUMENTATION_SOURCE_BASELINE_PATH = '.documentation/baseline.json' as const;
export const DOCUMENTATION_SOURCE_MANIFEST_PATH = '.documentation/source-manifest.json' as const;
export const DOCUMENTATION_SOURCE_EXCLUSIONS = Object.freeze([
  DOCUMENTATION_SOURCE_BASELINE_PATH,
  DOCUMENTATION_SOURCE_MANIFEST_PATH
] as const);
export const DOCUMENTATION_RELEASE_SUPPLEMENTAL_PATHS = Object.freeze([
  DOCUMENTATION_SOURCE_BASELINE_PATH,
  DOCUMENTATION_SOURCE_MANIFEST_PATH,
  'CITATION.cff',
  'NOTICE',
  'LICENSE',
  'LICENSES/CC-BY-4.0.txt',
  'LICENSES/README.md',
  'REUSE.toml'
] as const);

export interface DocumentationSourceMember {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface DocumentationReleaseFile {
  readonly path: string;
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly executable: boolean;
}

export interface CanonicalDocumentationSource {
  readonly sourceSetDigest: `sha256:${string}`;
  readonly files: readonly DocumentationReleaseFile[];
}

interface DocumentationSourceManifest {
  readonly schema: 'sec.documentation-source-manifest/1';
  readonly source_set_sha256: string;
  readonly members: readonly DocumentationSourceMember[];
}

interface DocumentationBaseline {
  readonly schema: 'sec.documentation-baseline/1';
  readonly source_set_sha256: string;
  readonly source_roots: readonly string[];
  readonly source_manifest: 'source-manifest.json';
  readonly excluded_from_source_hash: readonly string[];
}

function assertCanonicalMember(member: DocumentationSourceMember, index: number): void {
  if (!isCanonicalPortableLogicalPath(member.path)) {
    throw new Error(`Documentation source manifest member ${index} has a noncanonical path: ${member.path}`);
  }
  if (!Number.isSafeInteger(member.bytes) || member.bytes < 0) {
    throw new Error(`Documentation source manifest member ${member.path} has invalid byte length`);
  }
  if (!/^[0-9a-f]{64}$/u.test(member.sha256)) {
    throw new Error(`Documentation source manifest member ${member.path} has invalid SHA-256`);
  }
}

function canonicalSourceSetDigest(members: readonly DocumentationSourceMember[]): string {
  const canonical = members.map(({ path: memberPath, bytes, sha256 }) => ({
    bytes,
    path: memberPath,
    sha256
  }));
  return digest(Buffer.from(JSON.stringify(canonical), 'utf8'));
}

async function collectSourceRootFiles(
  repositoryRoot: string,
  relativeRoot: string,
  paths: Set<string>
): Promise<void> {
  if (!isCanonicalPortableLogicalPath(relativeRoot)) {
    throw new Error(`Documentation baseline has a noncanonical source root: ${relativeRoot}`);
  }
  const absoluteRoot = path.join(repositoryRoot, ...relativeRoot.split('/'));
  const metadata = await fs.lstat(absoluteRoot);
  if (metadata.isSymbolicLink()) {
    throw new Error(`Documentation source root is a symbolic link: ${relativeRoot}`);
  }
  if (metadata.isFile()) {
    if (paths.has(relativeRoot)) {
      throw new Error(`Documentation source roots overlap at ${relativeRoot}`);
    }
    paths.add(relativeRoot);
    return;
  }
  if (!metadata.isDirectory()) {
    throw new Error(`Documentation source root is not a file or directory: ${relativeRoot}`);
  }

  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const relativePath = `${prefix}/${entry.name}`;
      if (!isCanonicalPortableLogicalPath(relativePath)) {
        throw new Error(`Documentation source contains a noncanonical path: ${relativePath}`);
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Documentation source contains a symbolic link: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Documentation source contains a non-ordinary entry: ${relativePath}`);
      }
      if (paths.has(relativePath)) {
        throw new Error(`Documentation source roots overlap at ${relativePath}`);
      }
      paths.add(relativePath);
    }
  }

  await walk(absoluteRoot, relativeRoot);
}

async function readCanonicalDocumentationSource(
  repositoryRoot: string
): Promise<Readonly<{
  sourceSetDigest: `sha256:${string}`;
  members: readonly DocumentationSourceMember[];
}>> {
  const [baselineRaw, manifestRaw] = await Promise.all([
    fs.readFile(path.join(repositoryRoot, ...DOCUMENTATION_SOURCE_BASELINE_PATH.split('/')), 'utf8'),
    fs.readFile(path.join(repositoryRoot, ...DOCUMENTATION_SOURCE_MANIFEST_PATH.split('/')), 'utf8')
  ]);
  const baseline = JSON.parse(baselineRaw) as DocumentationBaseline;
  const manifest = JSON.parse(manifestRaw) as DocumentationSourceManifest;
  if (baseline.schema !== 'sec.documentation-baseline/1') {
    throw new Error('Documentation baseline schema is invalid');
  }
  if (
    baseline.source_manifest !== 'source-manifest.json'
    || !Array.isArray(baseline.source_roots)
    || baseline.source_roots.length === 0
    || !Array.isArray(baseline.excluded_from_source_hash)
    || JSON.stringify([...baseline.excluded_from_source_hash].sort(compareCodeUnits))
      !== JSON.stringify([...DOCUMENTATION_SOURCE_EXCLUSIONS].sort(compareCodeUnits))
  ) {
    throw new Error('Documentation baseline source-boundary contract is invalid');
  }
  if (
    manifest.schema !== 'sec.documentation-source-manifest/1'
    || !/^[0-9a-f]{64}$/u.test(manifest.source_set_sha256)
    || baseline.source_set_sha256 !== manifest.source_set_sha256
    || !Array.isArray(manifest.members)
  ) {
    throw new Error('Documentation source manifest identity is invalid');
  }

  let previousPath: string | null = null;
  const memberPaths = new Set<string>();
  for (let index = 0; index < manifest.members.length; index += 1) {
    const member = manifest.members[index]!;
    assertCanonicalMember(member, index);
    if (
      previousPath !== null
      && compareCodeUnits(previousPath, member.path) >= 0
    ) {
      throw new Error('Documentation source manifest members are not in strict canonical path order');
    }
    if (memberPaths.has(member.path)) {
      throw new Error(`Documentation source manifest duplicates ${member.path}`);
    }
    memberPaths.add(member.path);
    previousPath = member.path;
  }
  if (canonicalSourceSetDigest(manifest.members) !== manifest.source_set_sha256) {
    throw new Error('Documentation source manifest set digest is invalid');
  }

  const sourcePaths = new Set<string>();
  for (const sourceRoot of baseline.source_roots) {
    if (typeof sourceRoot !== 'string') {
      throw new Error('Documentation baseline source roots must be strings');
    }
    await collectSourceRootFiles(repositoryRoot, sourceRoot, sourcePaths);
  }
  for (const excluded of DOCUMENTATION_SOURCE_EXCLUSIONS) sourcePaths.delete(excluded);
  const observedPaths = [...sourcePaths].sort(compareCodeUnits);
  const declaredPaths = manifest.members.map((member) => member.path);
  if (JSON.stringify(observedPaths) !== JSON.stringify(declaredPaths)) {
    throw new Error('Documentation source manifest members differ from the baseline source roots');
  }

  for (const member of manifest.members) {
    const bytes = await fs.readFile(path.join(repositoryRoot, ...member.path.split('/')));
    if (bytes.byteLength !== member.bytes || digest(bytes) !== member.sha256) {
      throw new Error(`Documentation source manifest bytes differ at ${member.path}`);
    }
  }

  return Object.freeze({
    sourceSetDigest: `sha256:${manifest.source_set_sha256}` as `sha256:${string}`,
    members: Object.freeze([...manifest.members])
  });
}

async function copyReleaseFile(
  sourceRoot: string,
  artifactRoot: string,
  relativePath: string
): Promise<DocumentationReleaseFile> {
  if (!isCanonicalPortableLogicalPath(relativePath)) {
    throw new Error(`Documentation release file path is noncanonical: ${relativePath}`);
  }
  const sourcePath = path.join(sourceRoot, ...relativePath.split('/'));
  const [bytes, metadata] = await Promise.all([
    fs.readFile(sourcePath),
    fs.lstat(sourcePath)
  ]);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`Documentation release input is not one ordinary file: ${relativePath}`);
  }
  const destinationPath = path.join(artifactRoot, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.writeFile(destinationPath, bytes, { flag: 'wx' });
  if (process.platform !== 'win32') {
    await fs.chmod(destinationPath, metadata.mode & 0o777);
  }
  return Object.freeze({
    path: relativePath,
    bytes: bytes.byteLength,
    digest: `sha256:${digest(bytes)}` as `sha256:${string}`,
    executable: (metadata.mode & 0o111) !== 0
  });
}

export async function materializeCanonicalDocumentationSource(
  sourceRoot: string,
  artifactRoot: string
): Promise<CanonicalDocumentationSource> {
  const canonical = await readCanonicalDocumentationSource(sourceRoot);
  const paths = new Set(canonical.members.map((member) => member.path));
  for (const supplemental of DOCUMENTATION_RELEASE_SUPPLEMENTAL_PATHS) paths.add(supplemental);

  const files: DocumentationReleaseFile[] = [];
  for (const relativePath of [...paths].sort(compareCodeUnits)) {
    files.push(await copyReleaseFile(sourceRoot, artifactRoot, relativePath));
  }
  return Object.freeze({
    sourceSetDigest: canonical.sourceSetDigest,
    files: Object.freeze(files)
  });
}

export async function assertPublishedCanonicalDocumentationSource(
  artifactRoot: string,
  expectedSourceSetDigest: `sha256:${string}`
): Promise<void> {
  const canonical = await readCanonicalDocumentationSource(artifactRoot);
  if (canonical.sourceSetDigest !== expectedSourceSetDigest) {
    throw new Error('Published documentation source-set digest differs from the artifact manifest');
  }
}
