import { portableLogicalPathCollisionKey } from '../../system-architecture/foundation/contract/logical-path.ts';
import { CodexDevelopmentIsCanonicalRepositoryPath } from '../../system-architecture/foundation/contract/repository-path.ts';
import { compareCodeUnits, isPlainObject } from '../../system-architecture/foundation/runtime/canonical.ts';

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

export const DOCUMENT_AUTHORITY_LIFECYCLES = ['active', 'stable', 'draft'] as const;
export const DOCUMENT_DYNAMIC_POLICIES = ['forbidden', 'control', 'machine-state'] as const;
export const DOCUMENT_PROPOSAL_DISPOSITIONS = [
  'adopt',
  'adapt',
  'reject',
  'defer',
  'retire',
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
  readonly documents: readonly DocumentationAuthorityRecord[];
}

const ROOT_DOCUMENT_PATHS = new Set(['AGENTS.md', 'README.md']);
const NON_OWNING_KINDS = new Set<DocumentationAuthorityKind>([
  'navigation',
  'agent-projection',
  'proposal'
]);
const RECORD_KEYS = new Set([
  'id', 'path', 'kind', 'domain', 'lifecycle', 'dynamicPolicy', 'owns', 'projects',
  'generatedFrom', 'proposal', 'audience', 'consumers', 'updateTriggers'
]);
const PROPOSAL_KEYS = new Set([
  'disposition', 'canonicalTargets', 'activationTrigger', 'retirementTarget',
  'evidenceRequirement', 'reversalCondition'
]);

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object.`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: readonly string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key)).sort(compareCodeUnits);
  if (unknown.length > 0) throw new Error(`${label} has unknown keys: ${unknown.join(', ')}.`);
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) throw new Error(`${label} is missing keys: ${missing.join(', ')}.`);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
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
  const sorted = [...result].sort(compareCodeUnits);
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
  const repositoryPath = nonEmptyString(value, label);
  if (!CodexDevelopmentIsCanonicalRepositoryPath(repositoryPath)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  }
  return repositoryPath;
}

function registryDocumentPath(value: unknown, label: string): string {
  const repositoryPath = canonicalRepositoryPath(value, label);
  if (!repositoryPath.startsWith('docs/') && !ROOT_DOCUMENT_PATHS.has(repositoryPath)) {
    throw new Error(`${label} must be under docs/ or one of AGENTS.md, README.md.`);
  }
  return repositoryPath;
}

function pathIdentity(repositoryPath: string): string {
  return portableLogicalPathCollisionKey(repositoryPath, 'Documentation repository path');
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
    canonicalTargets.length === 0
    || activationTrigger === null
    || evidenceRequirement === null
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
  if (disposition === 'retire' && (
    canonicalTargets.length === 0
    || activationTrigger !== null
    || evidenceRequirement === null
    || reversalCondition !== null
  )) {
    throw new Error(
      `${label} retire requires canonicalTargets and evidenceRequirement, `
      + 'with null activationTrigger and reversalCondition.'
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
    : registryDocumentPath(value.generatedFrom, `${label}.generatedFrom`);
  if (generatedFrom !== undefined && owns.length > 0) {
    throw new Error(`${label} generated projection cannot own canonical facts.`);
  }

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
    path: registryDocumentPath(value.path, `${label}.path`),
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
    ...(generatedFrom === undefined ? {} : { generatedFrom }),
    ...(proposal === undefined ? {} : { proposal }),
    audience: stringList(value.audience, `${label}.audience`),
    consumers: stringList(value.consumers, `${label}.consumers`),
    updateTriggers: stringList(value.updateTriggers, `${label}.updateTriggers`)
  };
}

function assertRegistryClosure(records: readonly DocumentationAuthorityRecord[]): void {
  const ids = new Map<string, DocumentationAuthorityRecord>();
  const paths = new Map<string, DocumentationAuthorityRecord>();
  const caseInsensitivePaths = new Map<string, DocumentationAuthorityRecord>();
  const owners = new Map<string, DocumentationAuthorityRecord>();

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

    const identity = pathIdentity(record.path);
    const previousCaseInsensitive = caseInsensitivePaths.get(identity);
    if (previousCaseInsensitive) {
      throw new Error(
        `Case-insensitive document path collision ${record.path}: `
        + `${previousCaseInsensitive.id}, ${record.id}.`
      );
    }
    caseInsensitivePaths.set(identity, record);

    for (const owned of record.owns) {
      const previousOwner = owners.get(owned);
      if (previousOwner) {
        throw new Error(
          `Canonical ownership ${owned} is duplicated by ${previousOwner.id} and ${record.id}.`
        );
      }
      owners.set(owned, record);
    }
  }

  const retirementTargets = new Map<string, DocumentationAuthorityRecord>();
  for (const record of records) {
    if (!record.proposal) continue;
    const retirementIdentity = pathIdentity(record.proposal.retirementTarget);
    const occupied = caseInsensitivePaths.get(retirementIdentity);
    if (occupied) {
      throw new Error(
        `Proposal ${record.id} retirementTarget ${record.proposal.retirementTarget} `
        + `is occupied by ${occupied.id}.`
      );
    }
    const previous = retirementTargets.get(retirementIdentity);
    if (previous) {
      throw new Error(
        `Proposal retirementTarget ${record.proposal.retirementTarget} `
        + `is shared by ${previous.id} and ${record.id}.`
      );
    }
    retirementTargets.set(retirementIdentity, record);
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
      if (!record.proposal.retirementTarget.startsWith('docs/archive/')) {
        throw new Error(`Proposal ${record.id} retirementTarget must be under docs/archive/.`);
      }
      for (const targetId of record.proposal.canonicalTargets) {
        const target = ids.get(targetId);
        if (!target) {
          throw new Error(`Proposal ${record.id} targets unknown document ${targetId}.`);
        }
        if (target.kind === 'proposal') {
          throw new Error(`Proposal ${record.id} cannot migrate into proposal ${targetId}.`);
        }
        if (target.generatedFrom !== undefined || target.owns.length === 0) {
          throw new Error(
            `Proposal ${record.id} target ${targetId} is not an owning canonical record.`
          );
        }
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
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string, chain: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Documentation dependency cycle: ${[...chain, id].join(' -> ')}.`);
    }
    const record = byId.get(id);
    if (!record) throw new Error(`Documentation dependency references unknown document ${id}.`);
    visiting.add(id);
    for (const target of record.projects) visit(target, [...chain, id]);
    for (const target of record.proposal?.canonicalTargets ?? []) visit(target, [...chain, id]);
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
    throw new Error(
      `Documentation authority registry is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  assertPlainObject(raw, 'registry');
  assertExactKeys(raw, new Set(['documents']), ['documents'], 'registry');
  if (!Array.isArray(raw.documents)) throw new Error('registry.documents must be an array.');
  const documents = raw.documents.map(parseRecord);
  if (documents.length === 0) throw new Error('registry.documents must not be empty.');
  assertRegistryClosure(documents);
  assertDependencyGraphAcyclic(documents);
  return { documents };
}

export function documentationRecordByPath(
  registry: DocumentationAuthorityRegistry,
  repositoryPath: string
): DocumentationAuthorityRecord | undefined {
  return registry.documents.find((record) => record.path === repositoryPath);
}

export function documentationRecordById(
  registry: DocumentationAuthorityRegistry,
  id: string
): DocumentationAuthorityRecord | undefined {
  return registry.documents.find((record) => record.id === id);
}

const OPERATION_OWNER_KINDS = new Set<DocumentationAuthorityKind>([
  'authority',
  'corpus-contract'
]);

/**
 * Resolve the smallest canonical documentation-owner closure for one frozen
 * operation. Work Package authorityRefs map non-document source scope to its
 * domain owners; changed registered documents add their own owner or declared
 * projection targets. The registry is an input from trusted base, so candidate
 * prose can never create an owner identity or expand this closure.
 */
export function resolveDocumentationOperationOwners(input: Readonly<{
  registry: DocumentationAuthorityRegistry;
  authorityRefs: readonly string[];
  changedPaths: readonly string[];
}>): readonly DocumentationAuthorityRecord[] {
  if (input.authorityRefs.length === 0) {
    throw new Error('Operation documentation authorityRefs must not be empty.');
  }
  const sortedRefs = [...input.authorityRefs].sort(compareCodeUnits);
  if (new Set(sortedRefs).size !== sortedRefs.length
      || sortedRefs.some((entry, index) => entry !== input.authorityRefs[index])) {
    throw new Error('Operation documentation authorityRefs must be sorted and unique.');
  }
  const changedPaths = input.changedPaths.map((repositoryPath, index) => canonicalRepositoryPath(
    repositoryPath,
    `Operation changedPaths[${index}]`
  )).sort(compareCodeUnits);
  if (new Set(changedPaths).size !== changedPaths.length
      || changedPaths.some((entry, index) => entry !== input.changedPaths[index])) {
    throw new Error('Operation changed paths must be sorted and unique.');
  }
  const selected = new Map<string, DocumentationAuthorityRecord>();
  const addOwningRecord = (id: string, reason: string): void => {
    const record = documentationRecordById(input.registry, id);
    if (record === undefined) throw new Error(`${reason} references unknown document owner ${id}.`);
    if (!OPERATION_OWNER_KINDS.has(record.kind)
        || (record.lifecycle !== 'active' && record.lifecycle !== 'stable')) {
      throw new Error(`${reason} references non-owning or inactive document ${id}.`);
    }
    selected.set(record.id, record);
  };
  for (const id of input.authorityRefs) addOwningRecord(id, 'Work Package authorityRefs');
  if (!selected.has('development-governance')) {
    throw new Error('Operation documentation authorityRefs must include development-governance.');
  }
  for (const repositoryPath of changedPaths) {
    const changed = documentationRecordByPath(input.registry, repositoryPath);
    if (changed === undefined) continue;
    if (OPERATION_OWNER_KINDS.has(changed.kind)) {
      addOwningRecord(changed.id, `Changed document ${repositoryPath}`);
      continue;
    }
    for (const projectedOwner of changed.projects) {
      addOwningRecord(projectedOwner, `Changed projection ${repositoryPath}`);
    }
  }
  return Object.freeze([...selected.values()].sort((left, right) => compareCodeUnits(left.id, right.id)));
}

export function activeDocumentationPaths(registry: DocumentationAuthorityRegistry): string[] {
  return registry.documents.map((record) => record.path).sort(compareCodeUnits);
}

function documentationLink(repositoryPath: string): string {
  if (!repositoryPath.endsWith('.md')) return `\`${repositoryPath}\``;
  if (repositoryPath === 'README.md' || repositoryPath === 'AGENTS.md') {
    return `[\`${repositoryPath}\`](../${repositoryPath})`;
  }
  if (repositoryPath.startsWith('docs/')) {
    return `[\`${repositoryPath}\`](${repositoryPath.slice('docs/'.length)})`;
  }
  return `\`${repositoryPath}\``;
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
      || compareCodeUnits(left.domain, right.domain)
      || compareCodeUnits(left.path, right.path)
    ));

  return [
    '---',
    'title: SEC 文档导航',
    'status: active',
    'domain: documentation',
    'last-reviewed: 2026-08-05',
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
    '新增、移动、裁决或退役文档必须先修改 registry；未登记 active 文档、'
      + '无处置 draft proposal、重复 owner 或失效生成投影均 fail closed。',
    ''
  ].join('\n');
}
