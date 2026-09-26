import documentationBaselineSource from '../../../../../.documentation/baseline.json' with { type: 'json' };
import documentationIdentitySource from '../../../../../.documentation/documents.json' with { type: 'json' };

import { compareCodeUnits, isPlainObject } from '../../../../contracts/canonical.ts';
import { parseDocumentationBoundary } from '../../../../contracts/documentation-source.ts';
import { parseExactJson } from '../../../../contracts/exact-json.ts';
import { portableLogicalPathCollisionKey } from '../../../../contracts/logical-path.ts';
import { IsCanonicalRepositoryPath } from '../../../../contracts/repository-path.ts';

export const DOCUMENTATION_IDENTITY_PATH = '.documentation/documents.json' as const;
const DOCUMENTATION_IDENTITY_SCHEMA = 'sec.documentation-identity/1' as const;
export const DOCUMENTATION_BASELINE_PATH = '.documentation/baseline.json' as const;
const DOCUMENTATION_SOURCE_MANIFEST_PATH = '.documentation/source-manifest.json' as const;
const DOCUMENTATION_BASELINE_SCHEMA = 'sec.documentation-baseline/2' as const;

export interface DocumentationVerificationBaseline {
  readonly schema: typeof DOCUMENTATION_BASELINE_SCHEMA;
  readonly sourceRoots: readonly string[];
  readonly auditedNamespaces: readonly string[];
  readonly nonDocumentationRoots: readonly string[];
}

export interface DocumentationIdentityRecord {
  readonly documentId: `urn:uuid:${string}`;
  readonly path: string;
}

export interface DocumentationIdentityRegistry {
  readonly schema: typeof DOCUMENTATION_IDENTITY_SCHEMA;
  readonly scope: string;
  readonly documents: readonly DocumentationIdentityRecord[];
}

function fail(message: string): never {
  throw new Error(`Documentation identity registry: ${message}`);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const canonical = [...expected].sort(compareCodeUnits);
  if (actual.length !== canonical.length
      || actual.some((key, index) => key !== canonical[index])) {
    fail(`${label} keys must be exact; received ${actual.join(',')}.`);
  }
}

function parseText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value
      || value.normalize('NFC') !== value || value.includes('\0')) {
    fail(`${label} must be one non-empty canonical string.`);
  }
  return value;
}

function pathMatchesRoot(repositoryPath: string, root: string): boolean {
  return repositoryPath === root || repositoryPath.startsWith(`${root}/`);
}

export function parseDocumentationVerificationBaseline(source: string): DocumentationVerificationBaseline {
  try {
    const boundary = parseDocumentationBoundary(Buffer.from(source, 'utf8'));
    return Object.freeze({ schema: DOCUMENTATION_BASELINE_SCHEMA, sourceRoots: boundary.sourceRoots,
      auditedNamespaces: boundary.auditedNamespaces, nonDocumentationRoots: boundary.nonDocumentationRoots });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

export function isDocumentationVerificationInputPath(
  file: string,
  baseline: DocumentationVerificationBaseline = CURRENT_DOCUMENTATION_VERIFICATION_BASELINE
): boolean {
  if (!IsCanonicalRepositoryPath(file)) return false;
  // Rendering bytes belong to the reading consumer, not source-only verification.
  if (file === '.documentation/figures.json') return false;
  if (file === DOCUMENTATION_BASELINE_PATH || file === DOCUMENTATION_SOURCE_MANIFEST_PATH) return true;
  if (baseline.sourceRoots.some((root) => pathMatchesRoot(file, root))) return true;
  return baseline.auditedNamespaces.some((namespace) => pathMatchesRoot(file, namespace))
    && !baseline.nonDocumentationRoots.some((root) => pathMatchesRoot(file, root));
}

export function parseDocumentationIdentityRegistry(source: string): DocumentationIdentityRegistry {
  let value: unknown;
  try {
    value = parseExactJson(source, 'Documentation identity registry', {
      rootObjectKeys: ['schema', 'scope', 'documents']
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  if (!isPlainObject(value)) fail('root must be one object.');
  exactKeys(value, ['schema', 'scope', 'documents'], 'root');
  if (value.schema !== DOCUMENTATION_IDENTITY_SCHEMA) fail('schema is unsupported.');
  const scope = parseText(value.scope, 'scope');
  if (!Array.isArray(value.documents) || value.documents.length === 0) {
    fail('documents must be one non-empty array.');
  }
  const ids = new Set<string>();
  const paths = new Set<string>();
  const logicalPaths = new Set<string>();
  const documents = value.documents.map((entry, index): DocumentationIdentityRecord => {
    if (!isPlainObject(entry)) fail(`documents[${index}] must be one object.`);
    exactKeys(entry, ['document_id', 'path'], `documents[${index}]`);
    const documentId = parseText(entry.document_id, `documents[${index}].document_id`);
    if (!/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(documentId)) {
      fail(`documents[${index}].document_id must be one lowercase UUID URN.`);
    }
    const repositoryPath = parseText(entry.path, `documents[${index}].path`);
    if (!IsCanonicalRepositoryPath(repositoryPath)
        || !repositoryPath.endsWith('.md')) {
      fail(`documents[${index}].path must be one canonical Markdown repository path.`);
    }
    const logicalPath = portableLogicalPathCollisionKey(
      repositoryPath,
      `documents[${index}].path`
    );
    if (ids.has(documentId)) fail(`duplicate document identity ${documentId}.`);
    if (paths.has(repositoryPath) || logicalPaths.has(logicalPath)) {
      fail(`duplicate document path ${repositoryPath}.`);
    }
    ids.add(documentId);
    paths.add(repositoryPath);
    logicalPaths.add(logicalPath);
    return Object.freeze({ documentId: documentId as `urn:uuid:${string}`, path: repositoryPath });
  });
  return Object.freeze({
    schema: DOCUMENTATION_IDENTITY_SCHEMA,
    scope,
    documents: Object.freeze(documents)
  });
}

export function documentationIdentityByPath(
  registry: DocumentationIdentityRegistry,
  repositoryPath: string
): DocumentationIdentityRecord | undefined {
  return registry.documents.find((record) => record.path === repositoryPath);
}

export function documentationIdentityById(
  registry: DocumentationIdentityRegistry,
  documentId: string
): DocumentationIdentityRecord | undefined {
  return registry.documents.find((record) => record.documentId === documentId);
}

export function activeDocumentationPaths(registry: DocumentationIdentityRegistry): string[] {
  return [
    DOCUMENTATION_BASELINE_PATH,
    DOCUMENTATION_IDENTITY_PATH,
    DOCUMENTATION_SOURCE_MANIFEST_PATH,
    ...registry.documents.map((record) => record.path)
  ]
    .sort(compareCodeUnits);
}

const ACTIVE_DOCUMENTATION_REGISTRY = parseDocumentationIdentityRegistry(
  JSON.stringify(documentationIdentitySource)
);
const CURRENT_DOCUMENTATION_VERIFICATION_BASELINE = parseDocumentationVerificationBaseline(
  JSON.stringify(documentationBaselineSource)
);
const ACTIVE_DOCUMENTATION_PATH_LIST = Object.freeze(
  activeDocumentationPaths(ACTIVE_DOCUMENTATION_REGISTRY)
);
const ACTIVE_DOCUMENTATION_PATHS = new Set(ACTIVE_DOCUMENTATION_PATH_LIST);

export function currentActiveDocumentationPaths(): readonly string[] {
  return ACTIVE_DOCUMENTATION_PATH_LIST;
}

export function currentDocumentationVerificationBaseline(): DocumentationVerificationBaseline {
  return CURRENT_DOCUMENTATION_VERIFICATION_BASELINE;
}

export function isActiveDocumentationPath(file: string): boolean {
  return IsCanonicalRepositoryPath(file)
    && ACTIVE_DOCUMENTATION_PATHS.has(file);
}

export function activeDocumentationRecord(file: string): DocumentationIdentityRecord | undefined {
  if (!IsCanonicalRepositoryPath(file)) return undefined;
  return documentationIdentityByPath(ACTIVE_DOCUMENTATION_REGISTRY, file);
}
