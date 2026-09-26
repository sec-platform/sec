import { rawSha256Hex, isPlainObject } from './canonical.ts';
import { parseExactJson } from './exact-json.ts';
import { isCanonicalPortableLogicalPath, portableLogicalPathCollisionKey } from './logical-path.ts';

/** Source package identity, not normative adoption, semantic equality or build success. */
export const DOCUMENTATION_BASELINE = '.documentation/baseline.json' as const;
export const DOCUMENTATION_SOURCE_MANIFEST = '.documentation/source-manifest.json' as const;
export const DOCUMENTATION_REQUIREMENTS = '.documentation/requirements.json' as const;
export const DOCUMENTATION_FIGURES = '.documentation/figures.json' as const;
export const DOCUMENTATION_NON_SOURCE = Object.freeze([
  DOCUMENTATION_FIGURES, DOCUMENTATION_REQUIREMENTS, DOCUMENTATION_SOURCE_MANIFEST
]);
export const DOCUMENTATION_LIMITS = Object.freeze({ fileBytes: 16_000_000, totalBytes: 80_000_000, members: 100_000 });
export const DOCUMENTATION_AUTHORED_METADATA = Object.freeze([
  DOCUMENTATION_BASELINE, '.documentation/README.md', '.documentation/documents.json', '.documentation/known-regressions.json'
]);
const BASELINE_KEYS = Object.freeze([
  'schema', 'source_root', 'source_roots', 'source_manifest', 'audited_namespaces',
  'non_documentation_roots', 'excluded_from_source_hash', 'entry', 'delivery_number',
  'archive_name', 'scope', 'authority_limit'
]);
export interface DocumentationBoundary {
  readonly schema: 'sec.documentation-baseline/2';
  readonly sourceRoots: readonly string[];
  readonly auditedNamespaces: readonly string[];
  readonly nonDocumentationRoots: readonly string[];
  readonly entrypoint: string;
}
export interface DocumentationSourceMember {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}
export interface DocumentationSourceContract {
  readonly boundary: DocumentationBoundary;
  readonly sourceSetSha256: string;
  readonly entrypoint: string;
  readonly members: readonly DocumentationSourceMember[];
}
export function documentationPath(value: unknown): value is string {
  return typeof value === 'string' && !/[\uD800-\uDFFF]/u.test(
    // Valid pairs are scalar values; the u-flag only matches unpaired surrogates.
    value
  ) && isCanonicalPortableLogicalPath(value);
}
export function documentationPathWithin(file: string, root: string): boolean {
  return file === root || file.startsWith(`${root}/`);
}
export function documentationIsNonSource(file: string): boolean {
  return (DOCUMENTATION_NON_SOURCE as readonly string[]).includes(file);
}
export function compareDocumentationPaths(a: string, b: string): number {
  // UTF-8 scalar order matches Python's source inventory, not UTF-16/locale collation.
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}
function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`${label} fields are not exact`);
  return value;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value);
}
function bareDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}
export function decodeDocumentationJson(bytes: Uint8Array, label: string, keys?: readonly string[]): unknown {
  if (bytes.byteLength > DOCUMENTATION_LIMITS.fileBytes) throw new Error(`${label} byte budget exceeded`);
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return parseExactJson(source, label, keys === undefined ? undefined : { rootObjectKeys: keys }, 8);
}
function pathList(value: unknown, label: string, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
      || value.length > DOCUMENTATION_LIMITS.members || !value.every(documentationPath)) {
    throw new Error(`${label} is not a bounded canonical path array`);
  }
  const collision = value.map(v => portableLogicalPathCollisionKey(v));
  if (new Set(collision).size !== collision.length) throw new Error(`${label} contains duplicate/aliased paths`);
  return Object.freeze([...value]);
}
export function parseDocumentationBoundary(bytes: Uint8Array): DocumentationBoundary {
  const value = exact(decodeDocumentationJson(bytes, 'Documentation baseline', BASELINE_KEYS), BASELINE_KEYS, 'Baseline');
  if (value.schema !== 'sec.documentation-baseline/2' || value.source_root !== '..'
      || value.source_manifest !== 'source-manifest.json') throw new Error('Unsupported documentation boundary schema');
  const sourceRoots = pathList(value.source_roots, 'source_roots');
  const auditedNamespaces = pathList(value.audited_namespaces, 'audited_namespaces');
  const nonDocumentationRoots = pathList(value.non_documentation_roots, 'non_documentation_roots', true);
  const excluded = pathList(value.excluded_from_source_hash, 'excluded_from_source_hash');
  if (JSON.stringify([...excluded].sort(compareDocumentationPaths)) !== JSON.stringify(DOCUMENTATION_NON_SOURCE)) {
    throw new Error('Source exclusions differ from registered projection/cache paths');
  }
  for (const key of ['entry', 'delivery_number', 'archive_name', 'scope', 'authority_limit']) {
    if (!text(value[key])) throw new Error(`Invalid baseline ${key}`);
  }
  if (!(value.entry as string).startsWith('../') || !documentationPath((value.entry as string).slice(3))) {
    throw new Error('Invalid documentation entrypoint');
  }
  if (!sourceRoots.some(root => documentationPathWithin(DOCUMENTATION_BASELINE, root))) {
    throw new Error('The boundary itself must be a source member');
  }
  for (let i = 0; i < sourceRoots.length; i++) for (let j = i + 1; j < sourceRoots.length; j++) {
    if (documentationPathWithin(sourceRoots[i]!, sourceRoots[j]!) || documentationPathWithin(sourceRoots[j]!, sourceRoots[i]!)) {
      throw new Error('Documentation source roots overlap');
    }
  }
  for (const exemption of nonDocumentationRoots) {
    if (!auditedNamespaces.some(root => exemption !== root && documentationPathWithin(exemption, root))) {
      throw new Error('non_documentation_roots is outside audited_namespaces');
    }
    if (sourceRoots.some(root => documentationPathWithin(exemption, root) || documentationPathWithin(root, exemption))) {
      throw new Error('non_documentation_roots overlaps source_roots');
    }
  }
  return Object.freeze({ schema: 'sec.documentation-baseline/2', sourceRoots, auditedNamespaces,
    nonDocumentationRoots, entrypoint: (value.entry as string).slice(3) });
}
export function documentationSourceDigest(members: readonly DocumentationSourceMember[]): string {
  // Field order is the published compact-JSON byte protocol. Never use host locale/pretty JSON.
  return rawSha256Hex(JSON.stringify(members.map(member => ({ bytes: member.bytes, path: member.path, sha256: member.sha256 }))));
}
export function parseDocumentationSourceContract(baselineBytes: Uint8Array, manifestBytes: Uint8Array): DocumentationSourceContract {
  const boundary = parseDocumentationBoundary(baselineBytes);
  const keys = ['schema', 'source_set_sha256', 'members'];
  const manifest = exact(decodeDocumentationJson(manifestBytes, 'Documentation source manifest', keys), keys, 'Source manifest');
  if (manifest.schema !== 'sec.documentation-source-manifest/2' || !bareDigest(manifest.source_set_sha256)
      || !Array.isArray(manifest.members) || manifest.members.length > DOCUMENTATION_LIMITS.members) {
    throw new Error('Unsupported or malformed documentation source manifest');
  }
  const members: DocumentationSourceMember[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const raw of manifest.members) {
    const value = exact(raw, ['path', 'bytes', 'sha256'], 'Source member');
    if (!documentationPath(value.path) || documentationIsNonSource(value.path)
        || !Number.isSafeInteger(value.bytes) || typeof value.bytes !== 'number' || Object.is(value.bytes, -0)
        || value.bytes < 0 || value.bytes > DOCUMENTATION_LIMITS.fileBytes || !bareDigest(value.sha256)) {
      throw new Error('Invalid authoritative source member');
    }
    const key = portableLogicalPathCollisionKey(value.path);
    if (seen.has(key)) throw new Error('Duplicate/aliased authoritative member');
    seen.add(key);
    const previous = members.at(-1);
    if (previous !== undefined && compareDocumentationPaths(previous.path, value.path) >= 0) {
      throw new Error('Authoritative source members must use canonical UTF-8 path order');
    }
    if (!boundary.sourceRoots.some(root => documentationPathWithin(value.path as string, root))) {
      throw new Error('Source manifest member is outside the declared boundary');
    }
    totalBytes += value.bytes;
    if (totalBytes > DOCUMENTATION_LIMITS.totalBytes) throw new Error('Documentation source byte budget exceeded');
    members.push(Object.freeze({ path: value.path, bytes: value.bytes, sha256: value.sha256 }));
  }
  const boundBaseline = members.find(member => member.path === DOCUMENTATION_BASELINE);
  if (boundBaseline?.bytes !== baselineBytes.byteLength || boundBaseline.sha256 !== rawSha256Hex(baselineBytes)) {
    throw new Error('Documentation boundary bytes are not bound by the source manifest');
  }
  if (!members.some(member => member.path === boundary.entrypoint)) throw new Error('Documentation entrypoint is not a source member');
  const actual = documentationSourceDigest(members);
  if (actual !== manifest.source_set_sha256) throw new Error('Documentation source-set digest differs from its actual members');
  return Object.freeze({ boundary, sourceSetSha256: actual, entrypoint: boundary.entrypoint, members: Object.freeze(members) });
}
