import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

export const DOCUMENT_AUTHORITY_REGISTRY_SCHEMA =
  'sec-document-authority-registry-v2' as const;

export const DOCUMENT_AUTHORITY_KINDS = [
  'authority',
  'registry',
  'navigation',
  'agent-projection',
  'control',
  'machine-ledger',
  'corpus-contract',
  'proposal'
] as const;

export const DOCUMENT_AUTHORITY_LIFECYCLES = [
  'active',
  'stable',
  'draft'
] as const;

export const DOCUMENT_DYNAMIC_POLICIES = [
  'forbidden',
  'control',
  'machine-state'
] as const;

export const DOCUMENT_PROPOSAL_DISPOSITIONS = [
  'adopt',
  'adapt',
  'reject',
  'defer',
  'experimental'
] as const;

export type DocumentationAuthorityKind = typeof DOCUMENT_AUTHORITY_KINDS[number];
export type DocumentationAuthorityLifecycle = typeof DOCUMENT_AUTHORITY_LIFECYCLES[number];
export type DocumentationDynamicPolicy = typeof DOCUMENT_DYNAMIC_POLICIES[number];
export type DocumentationProposalDisposition = typeof DOCUMENT_PROPOSAL_DISPOSITIONS[number];

export interface DocumentationProposalLifecycle {
  readonly disposition: DocumentationProposalDisposition;
  readonly canonicalTargets: readonly string[];
  readonly activationTrigger: string | null;
  readonly retirementTarget: string;
  readonly evidenceRequirement: string | null;
  readonly reversalCondition: string | null;
}

export interface DocumentationAuthorityRecord {
  readonly id: string;
  readonly path: string;
  readonly kind: DocumentationAuthorityKind;
  readonly domain: string;
  readonly lifecycle: DocumentationAuthorityLifecycle;
  readonly dynamicPolicy: DocumentationDynamicPolicy;
  readonly owns: readonly string[];
  readonly projects: readonly string[];
  readonly generatedFrom?: string;
  readonly proposal?: DocumentationProposalLifecycle;
  readonly audience: readonly string[];
  readonly consumers: readonly string[];
  readonly updateTriggers: readonly string[];
}

export interface DocumentationAuthorityRegistry {
  readonly schema: typeof DOCUMENT_AUTHORITY_REGISTRY_SCHEMA;
  readonly documents: readonly DocumentationAuthorityRecord[];
}

const RECORD_KEYS = new Set([
  'id', 'path', 'kind', 'domain', 'lifecycle', 'dynamicPolicy', 'owns', 'projects',
  'generatedFrom', 'proposal', 'audience', 'consumers', 'updateTriggers'
]);

const PROPOSAL_KEYS = new Set([
  'disposition', 'canonicalTargets', 'activationTrigger', 'retirementTarget',
  'evidenceRequirement', 'reversalCondition'
]);

const NON_OWNING_KINDS = new Set<DocumentationAuthorityKind>([
  'navigation', 'agent-projection', 'proposal'
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object.`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  label: string
): void {
  const keys = Object.keys(value);
  const unknown = keys.filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) throw new Error(`${label} has unknown keys: ${unknown.join(', ')}.`);
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) throw new Error(`${label} is missing keys: ${missing.join(', ')}.`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonEmptyString(value, label);
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const result = value.map((item, index) => nonEmptyString(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
  const sorted = [...result].sort();
  if (sorted.some((item, index) => item !== result[index])) {
    throw new Error(`${label} must be in canonical code-unit order.`);
  }
  return result;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] {
  const result = nonEmptyString(value, label);
  if (!allowed.includes(result)) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return result as T[number];
}

function canonicalRepositoryPath(value: unknown, label: string): string {
  const path = nonEmptyString(value, label);
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(path)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  }
  return path;
}

function parseProposalLifecycle(
  value: unknown,
  label: string
): DocumentationProposalLifecycle {
  assertPlainObject(value, label);
  assertExactKeys(value, PROPOSAL_KEYS, [
    'disposition', 'canonicalTargets', 'activationTrigger', 'retirementTarget',
    'evidenceRequirement', 'reversalCondition'
  ], label);

  const disposition = enumValue(
    value.disposition,
    DOCUMENT_PROPOSAL_DISPOSITIONS,
    `${label}.disposition`
  );
  const canonicalTargets = stringList(value.canonicalTargets, `${label}.canonicalTargets`);
  const activationTrigger = nullableString(value.activationTrigger, `${label}.activationTrigger`);
  const retirementTarget = canonicalRepositoryPath(
    value.retirementTarget,
    `${label}.retirementTarget`
  );
  const evidenceRequirement = nullableString(
    value.evidenceRequirement,
    `${label}.evidenceRequirement`
  );
  const reversalCondition = nullableString(
    value.reversalCondition,
    `${label}.reversalCondition`
  );

  if ((disposition === 'adopt' || disposition === 'adapt') && (
    canonicalTargets.length === 0 ||
    activationTrigger === null ||
    evidenceRequirement === null
  )) {
    throw new Error(
      `${label} ${disposition} requires canonicalTargets, activationTrigger and evidenceRequirement.`
    );
  }
  if (disposition === 'reject' && (
    canonicalTargets.length > 0 || reversalCondition === null
  )) {
    throw new Error(`${label} reject requires no canonicalTargets and a reversalCondition.`);
  }
  if ((disposition === 'defer' || disposition === 'experimental') && (
    activationTrigger === null || evidenceRequirement === null
  )) {
    throw new Error(
      `${label} ${disposition} requires activationTrigger and evidenceRequirement.`
    );
  }

  return {
    disposition,
    canonicalTargets,
    activationTrigger,
    retirementTarget,
    evidenceRequirement,
    reversalCondition
  };
}

function parseRecord(value: unknown, index: number): DocumentationAuthorityRecord {
  const label = `documents[${index}]`;
  assertPlainObject(value, label);
  assertExactKeys(value, RECORD_KEYS, [
    'id', 'path', 'kind', 'domain', 'lifecycle', 'dynamicPolicy', 'owns', 'projects',
    'audience', 'consumers', 'updateTriggers'
  ], label);

  const kind = enumValue(value.kind, DOCUMENT_AUTHORITY_KINDS, `${label}.kind`);
  const lifecycle = enumValue(
    value.lifecycle,
    DOCUMENT_AUTHORITY_LIFECYCLES,
    `${label}.lifecycle`
  );
  const owns = stringList(value.owns, `${label}.owns`);
  if (NON_OWNING_KINDS.has(kind) && owns.length > 0) {
    throw new Error(`${label} kind ${kind} cannot own canonical facts.`);
  }
  if (!NON_OWNING_KINDS.has(kind) && owns.length === 0) {
    throw new Error(`${label} kind ${kind} must own at least one canonical key.`);
  }

  const generatedFrom = value.generatedFrom === undefined
    ? undefined
    : canonicalRepositoryPath(value.generatedFrom, `${label}.generatedFrom`);
  const proposal = value.proposal === undefined
    ? undefined
    : parseProposalLifecycle(value.proposal, `${label}.proposal`);

  if (kind === 'proposal') {
    if (lifecycle !== 'draft' || proposal === undefined) {
      throw new Error(`${label} proposal kind requires lifecycle draft and proposal metadata.`);
    }
  } else if (proposal !== undefined) {
    throw new Error(`${label} non-proposal kind cannot declare proposal metadata.`);
  }
  if (kind !== 'proposal' && lifecycle === 'draft') {
    throw new Error(`${label} lifecycle draft is reserved for proposal documents.`);
  }

  return {
    id: nonEmptyString(value.id, `${label}.id`),
    path: canonicalRepositoryPath(value.path, `${label}.path`),
    kind,
    domain: nonEmptyString(value.domain, `${label}.domain`),
    lifecycle,
    dynamicPolicy: enumValue(
      value.dynamicPolicy,
      DOCUMENT_DYNAMIC_POLICIES,
      `${label}.dynamicPolicy`
    ),
    owns,
    projects: stringList(value.projects, `${label}.projects`),
    ...(generatedFrom ? { generatedFrom } : {}),
    ...(proposal ? { proposal } : {}),
    audience: stringList(value.audience, `${label}.audience`),
    consumers: stringList(value.consumers, `${label}.consumers`),
    updateTriggers: stringList(value.updateTriggers, `${label}.updateTriggers`)
  };
}

function assertRegistryClosure(records: readonly DocumentationAuthorityRecord[]): void {
  const ids = new Map<string, DocumentationAuthorityRecord>();
  const paths = new Map<string, DocumentationAuthorityRecord>();
  const windowsPaths = new Map<string, DocumentationAuthorityRecord>();
  const owners = new Map<string, DocumentationAuthorityRecord>();
  const retirementTargets = new Map<string, DocumentationAuthorityRecord>();

  for (const record of records) {
    const previousId = ids.get(record.id);
    if (previousId) {
      throw new Error(`Duplicate document id ${record.id}: ${previousId.path}, ${record.path}.`);
    }
    ids.set(record.id, record);

    const previousPath = paths.get(record.path);
    if (previousPath) {
      throw new Error(`Duplicate document path ${record.path}: ${previousPath.id}, ${record.id}.`);
    }
    paths.set(record.path, record);

    const windowsPath = record.path.toLowerCase();
    const previousWindowsPath = windowsPaths.get(windowsPath);
    if (previousWindowsPath) {
      throw new Error(
        `Case-insensitive document path collision ${record.path}: ${previousWindowsPath.id}, ${record.id}.`
      );
    }
    windowsPaths.set(windowsPath, record);

    for (const owned of record.owns) {
      const previousOwner = owners.get(owned);
      if (previousOwner) {
        throw new Error(
          `Canonical ownership ${owned} is duplicated by ${previousOwner.id} and ${record.id}.`
        );
      }
      owners.set(owned, record);
    }

    if (record.proposal) {
      const previousRetirement = retirementTargets.get(record.proposal.retirementTarget);
      if (previousRetirement) {
        throw new Error(
          `Proposal retirementTarget ${record.proposal.retirementTarget} is shared by ${
            previousRetirement.id
          } and ${record.id}.`
        );
      }
      retirementTargets.set(record.proposal.retirementTarget, record);
    }
  }

  for (const record of records) {
    for (const projectedId of record.projects) {
      if (!ids.has(projectedId)) {
        throw new Error(`Document ${record.id} projects unknown document ${projectedId}.`);
      }
      if (projectedId === record.id) {
        throw new Error(`Document ${record.id} cannot project itself.`);
      }
    }
    if (record.generatedFrom && !paths.has(record.generatedFrom)) {
      throw new Error(
        `Document ${record.id} is generated from unregistered path ${record.generatedFrom}.`
      );
    }
    if (record.proposal) {
      for (const target of record.proposal.canonicalTargets) {
        const targetRecord = ids.get(target);
        if (!targetRecord) {
          throw new Error(`Proposal ${record.id} targets unknown document ${target}.`);
        }
        if (targetRecord.kind === 'proposal') {
          throw new Error(`Proposal ${record.id} cannot migrate into proposal ${target}.`);
        }
        if (targetRecord.owns.length === 0) {
          throw new Error(`Proposal ${record.id} target ${target} is not an owning canonical record.`);
        }
      }
      if (!record.proposal.retirementTarget.startsWith('docs/archive/')) {
        throw new Error(`Proposal ${record.id} retirementTarget must be under docs/archive/.`);
      }
    }
    if (record.dynamicPolicy === 'forbidden'
      && (record.kind === 'control' || record.kind === 'machine-ledger')) {
      throw new Error(`${record.kind} document ${record.id} cannot forbid all dynamic state.`);
    }
    if (record.dynamicPolicy !== 'forbidden'
      && record.kind !== 'control'
      && record.kind !== 'machine-ledger') {
      throw new Error(
        `Only control or machine-ledger documents may use dynamic policy ${record.dynamicPolicy}.`
      );
    }
  }
}

function assertDependencyGraphAcyclic(records: readonly DocumentationAuthorityRecord[]): void {
  const byId = new Map(records.map((record) => [record.id, record] as const));
  const idByPath = new Map(records.map((record) => [record.path, record.id] as const));
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string, chain: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Documentation dependency cycle: ${[...chain, id].join(' -> ')}.`);
    }
    visiting.add(id);
    const record = byId.get(id);
    if (!record) throw new Error(`Documentation dependency references unknown document ${id}.`);
    for (const target of record.projects) visit(target, [...chain, id]);
    for (const target of record.proposal?.canonicalTargets ?? []) {
      visit(target, [...chain, id]);
    }
    if (record.generatedFrom) {
      const sourceId = idByPath.get(record.generatedFrom);
      if (!sourceId) {
        throw new Error(
          `Documentation generation dependency references unknown path ${record.generatedFrom}.`
        );
      }
      visit(sourceId, [...chain, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const record of records) visit(record.id, []);
}

export function parseDocumentationAuthorityRegistry(
  source: string
): DocumentationAuthorityRegistry {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    throw new Error(`Documentation authority registry is not valid JSON: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  assertPlainObject(raw, 'registry');
  assertExactKeys(raw, new Set(['schema', 'documents']), ['schema', 'documents'], 'registry');
  if (raw.schema !== DOCUMENT_AUTHORITY_REGISTRY_SCHEMA) {
    throw new Error(`Unsupported documentation authority schema ${String(raw.schema)}.`);
  }
  if (!Array.isArray(raw.documents)) throw new Error('registry.documents must be an array.');
  const documents = raw.documents.map(parseRecord);
  if (documents.length === 0) throw new Error('registry.documents must not be empty.');
  assertRegistryClosure(documents);
  assertDependencyGraphAcyclic(documents);
  return { schema: DOCUMENT_AUTHORITY_REGISTRY_SCHEMA, documents };
}

export function documentationRecordByPath(
  registry: DocumentationAuthorityRegistry,
  path: string
): DocumentationAuthorityRecord | undefined {
  return registry.documents.find((record) => record.path === path);
}

export function documentationRecordById(
  registry: DocumentationAuthorityRegistry,
  id: string
): DocumentationAuthorityRecord | undefined {
  return registry.documents.find((record) => record.id === id);
}

export function activeDocumentationPaths(
  registry: DocumentationAuthorityRegistry
): string[] {
  return registry.documents.map((record) => record.path).sort();
}

function documentationLink(path: string): string {
  if (!path.endsWith('.md')) return `\`${path}\``;
  if (path === 'README.md' || path === 'AGENTS.md') return `[\`${path}\`](../${path})`;
  if (path.startsWith('docs/')) return `[\`${path}\`](${path.slice('docs/'.length)})`;
  return `\`${path}\``;
}

export function renderDocumentationIndex(
  registry: DocumentationAuthorityRegistry
): string {
  const kindOrder = new Map<DocumentationAuthorityKind, number>([
    ['registry', 0],
    ['authority', 1],
    ['corpus-contract', 2],
    ['proposal', 3],
    ['machine-ledger', 4],
    ['control', 5],
    ['agent-projection', 6],
    ['navigation', 7]
  ]);
  const records = [...registry.documents]
    .filter((record) => record.path !== 'docs/README.md')
    .sort((left, right) => (
      (kindOrder.get(left.kind) ?? 99) - (kindOrder.get(right.kind) ?? 99)
      || (left.domain < right.domain ? -1 : left.domain > right.domain ? 1 : 0)
      || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    ));

  return [
    '---',
    'title: SEC 文档导航',
    'status: active',
    'domain: documentation',
    'last-reviewed: 2026-08-02',
    'generated-from: docs/authority.json',
    '---',
    '',
    '# SEC 文档导航',
    '',
    '本页由 `docs/authority.json` 生成，只提供导航，不拥有产品、架构、状态或 Gate。',
    '',
    '| 类型 | 领域 | 路径 | 拥有 | Proposal 处置 |',
    '| --- | --- | --- | --- | --- |',
    ...records.map((record) => (
      `| ${record.kind} | ${record.domain} | ${documentationLink(record.path)} | ${
        record.owns.length > 0 ? record.owns.join('、') : '—'
      } | ${record.proposal?.disposition ?? '—'} |`
    )),
    '',
    '新增、移动、裁决或退役文档必须先修改 registry；未登记 active 文档、无处置 draft proposal、重复 owner 或失效生成投影均 fail closed。',
    ''
  ].join('\n');
}
