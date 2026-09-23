import { isPlainObject, sha256 } from '../../contracts/canonical.ts';
import { parseExactJson } from '../../contracts/exact-json.ts';
import type { ReleaseBuilderIdentity } from './release-source-materialization.ts';

export const RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH = 'release-artifact-manifest.json' as const;

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

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainObject(value) || Object.keys(value).length !== fields.length
      || fields.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} must contain exactly its declared fields`);
  }
  return value;
}

function nonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function isDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function isGitObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function isMemberPath(value: unknown): value is string {
  return nonemptyText(value) && !value.includes('\\')
    && value !== RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Decode the shared staged/published contract before hashing or physical comparison. */
export function parseReleaseArtifactManifestBytes(
  bytes: Uint8Array,
  label = 'Release artifact manifest'
): ReleaseArtifactManifest {
  // Fatal decoding preserves byte identity; replacement characters must not repair invalid UTF-8.
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  const root = parseExactJson(source, label, { rootObjectKeys: [
    'schema', 'packageVersion', 'sourceCommit', 'sourceTree',
    'dependencyLockDigest', 'builder', 'files', 'contentDigest'
  ] }, 3) as Record<string, unknown>;
  if (root.schema !== 'sec-release-artifact-manifest-v1' || !nonemptyText(root.packageVersion)
      || !isGitObjectId(root.sourceCommit) || !isGitObjectId(root.sourceTree)
      || root.sourceCommit.length !== root.sourceTree.length
      || !isDigest(root.dependencyLockDigest) || !isDigest(root.contentDigest)) {
    throw new Error(`${label} identity is invalid`);
  }
  const builder = exactRecord(root.builder, [
    'schema', 'runtime', 'version', 'executableSha256', 'platform', 'architecture'
  ], `${label} builder`);
  if (builder.schema !== 'sec-release-builder-identity-v1' || builder.runtime !== 'bun'
      || !nonemptyText(builder.version) || !isDigest(builder.executableSha256)
      || !nonemptyText(builder.platform) || !nonemptyText(builder.architecture)) {
    throw new Error(`${label} builder identity is invalid`);
  }
  if (!Array.isArray(root.files)) throw new Error(`${label} files must be an array`);
  const paths = new Set<string>();
  for (const member of root.files) {
    const file = exactRecord(member, ['path', 'bytes', 'digest', 'executable'], `${label} member`);
    if (!isMemberPath(file.path) || typeof file.bytes !== 'number'
        || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || Object.is(file.bytes, -0)
        || !isDigest(file.digest) || typeof file.executable !== 'boolean') {
      throw new Error(`${label} member is invalid`);
    }
    if (paths.has(file.path)) throw new Error(`${label} members must have unique paths`);
    paths.add(file.path);
    Object.freeze(file);
  }
  const { contentDigest, ...material } = root;
  if (sha256(material) !== contentDigest) throw new Error(`${label} readback digest is invalid`);
  Object.freeze(builder);
  Object.freeze(root.files);
  return Object.freeze(root) as unknown as ReleaseArtifactManifest;
}
