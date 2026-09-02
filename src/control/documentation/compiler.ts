import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  rawSha256,
  sha256
} from '../../system-architecture/foundation/runtime/canonical.ts';

import {
  documentationRecordById,
  type DocumentationAuthorityRecord,
  type DocumentationAuthorityRegistry
} from './authority.ts';

export const DOCUMENTATION_SEMANTIC_GRAPH_SCHEMA = 'sec-documentation-semantic-graph' as const;
export const DOCUMENTATION_VIEW_SCHEMA = 'sec-documentation-view' as const;

export type DocumentationClauseKind =
  | 'stable-decision'
  | 'temporary-safety-denial'
  | 'untyped-observation';
export type DocumentationAdmission = 'eligible' | 'blocked' | 'unknown' | 'not-applicable';
export type DocumentationViewKind = 'compact-agent' | 'full-human' | 'admission-obligation';

export interface DocumentationSourceInput {
  readonly documentId: string;
  readonly source: string;
}

export interface DocumentationAdmissionFactInput {
  readonly id: string;
  readonly ownerDocumentId: string;
  readonly subjectRefs: readonly string[];
  readonly admission: DocumentationAdmission;
  readonly evidenceObligations: readonly string[];
  readonly consumerRefs: readonly string[];
  readonly invalidationRefs: readonly string[];
}

declare const DOCUMENTATION_ADMISSION_PROJECTION_BRAND: unique symbol;
declare const DOCUMENTATION_SEMANTIC_GRAPH_BRAND: unique symbol;

export type DocumentationAdmissionProjection = Readonly<{
  readonly status: 'complete' | 'unavailable';
  readonly facts: readonly DocumentationAdmissionFactInput[];
  readonly trustedTree: string;
  readonly registryDigest: `sha256:${string}` | null;
  readonly [DOCUMENTATION_ADMISSION_PROJECTION_BRAND]: true;
}>;

const issuedDocumentationAdmissionProjections = new WeakSet<object>();

export interface DocumentationSemanticGraphInput {
  readonly trustedTree: string;
  readonly registry: DocumentationAuthorityRegistry;
  readonly sources: readonly DocumentationSourceInput[];
  readonly admission: DocumentationAdmissionProjection;
}

export interface DocumentationClause {
  readonly id: `clause:${string}`;
  readonly documentId: string;
  readonly repositoryPath: string;
  readonly kind: DocumentationClauseKind;
  readonly blocker: string | null;
  readonly headingPath: readonly string[];
  readonly level: number;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly parentClauseId: `clause:${string}` | null;
  readonly sourceDigest: `sha256:${string}`;
  readonly contentDigest: `sha256:${string}`;
  readonly content: string;
}

export interface DocumentationAdmissionFact extends DocumentationAdmissionFactInput {
  readonly factDigest: `sha256:${string}`;
}

export interface DocumentationSemanticGraph {
  readonly schema: typeof DOCUMENTATION_SEMANTIC_GRAPH_SCHEMA;
  readonly trustedTree: string;
  readonly registryDigest: `sha256:${string}`;
  readonly compilerInputDigest: `sha256:${string}`;
  readonly semanticGraphDigest: `sha256:${string}`;
  readonly clauses: readonly DocumentationClause[];
  readonly admissionStatus: DocumentationAdmissionProjection['status'];
  readonly admissionFacts: readonly DocumentationAdmissionFact[];
  readonly blockers: readonly string[];
  readonly [DOCUMENTATION_SEMANTIC_GRAPH_BRAND]: true;
}

const issuedDocumentationSemanticGraphs = new WeakSet<object>();

function issueDocumentationSemanticGraph(
  graph: Omit<DocumentationSemanticGraph, typeof DOCUMENTATION_SEMANTIC_GRAPH_BRAND>
): DocumentationSemanticGraph {
  const issued = deepFreeze(graph) as DocumentationSemanticGraph;
  issuedDocumentationSemanticGraphs.add(issued);
  return issued;
}

export function assertIssuedDocumentationSemanticGraph(
  graph: DocumentationSemanticGraph
): void {
  if (!issuedDocumentationSemanticGraphs.has(graph)) {
    fail('semantic graph was not issued by the documentation compiler.');
  }
}

export interface DocumentationViewSelection {
  readonly kind: DocumentationViewKind;
  readonly clauseIds: readonly string[];
  readonly ownerDocumentIds: readonly string[];
  readonly decisionQuestionDigest: `sha256:${string}`;
}

export interface DocumentationView {
  readonly schema: typeof DOCUMENTATION_VIEW_SCHEMA;
  readonly kind: DocumentationViewKind;
  readonly trustedTree: string;
  readonly compilerInputDigest: `sha256:${string}`;
  readonly semanticGraphDigest: `sha256:${string}`;
  readonly selectionDigest: `sha256:${string}`;
  readonly viewBytesDigest: `sha256:${string}`;
  readonly clauses: readonly DocumentationClause[];
  readonly admissionStatus: DocumentationAdmissionProjection['status'];
  readonly admissionFacts: readonly DocumentationAdmissionFact[];
  readonly blockers: readonly string[];
}

export interface DocumentationClauseSelectionReference {
  readonly kind: 'markdown-clauses';
  readonly compilerInputDigest: `sha256:${string}`;
  readonly semanticGraphDigest: `sha256:${string}`;
  readonly sourceDigest: `sha256:${string}`;
  readonly selectionDigest: `sha256:${string}`;
  readonly clauses: readonly Readonly<{
    readonly clauseId: string;
    readonly contentDigest: `sha256:${string}`;
    readonly lineStart: number;
    readonly lineEnd: number;
  }>[];
}

type ClauseDirective = Readonly<{
  kind: DocumentationClauseKind;
  blocker: string | null;
}>;

const SOURCE_KINDS = new Set<DocumentationAuthorityRecord['kind']>(['authority', 'corpus-contract']);
const DIRECTIVE = /^\s*<!--\s*sec-clause\s+(\{.*\})\s*-->\s*$/u;
const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;
const FENCE = /^\s*(`{3,}|~{3,})/u;

function fail(message: string): never {
  throw new Error(`Documentation compiler: ${message}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.includes('\0')) {
    fail(`${label} must be one non-empty trimmed string.`);
  }
  return value;
}

function token(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(result)) fail(`${label} must be one canonical token.`);
  return result;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  const result = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a lowercase SHA-256 digest.`);
  return result as `sha256:${string}`;
}

function sortedUnique(values: readonly string[], label: string): readonly string[] {
  const result = values.map((value, index) => token(value, `${label}[${index}]`));
  const sorted = [...result].sort(compareCodeUnits);
  if (new Set(sorted).size !== sorted.length || sorted.some((value, index) => value !== result[index])) {
    fail(`${label} must be unique and in canonical code-unit order.`);
  }
  return Object.freeze(result);
}

function parseDirective(source: string, label: string): ClauseDirective {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (error) {
    fail(`${label} must contain strict JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(`${label} must be one object.`);
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareCodeUnits);
  if (keys.length !== 2 || keys[0] !== 'blocker' || keys[1] !== 'kind') {
    fail(`${label} keys must be exactly blocker and kind.`);
  }
  if (record.kind !== 'stable-decision' && record.kind !== 'temporary-safety-denial') {
    fail(`${label}.kind is unsupported.`);
  }
  const blocker = record.blocker === null ? null : token(record.blocker, `${label}.blocker`);
  if (record.kind === 'temporary-safety-denial' && blocker === null) {
    fail(`${label} temporary safety denial requires one blocker.`);
  }
  if (record.kind === 'stable-decision' && blocker !== null) {
    fail(`${label} stable decision cannot carry one runtime blocker.`);
  }
  return Object.freeze({ kind: record.kind, blocker });
}

function compilerSources(registry: DocumentationAuthorityRegistry): readonly DocumentationAuthorityRecord[] {
  return Object.freeze(registry.documents
    .filter((record) => SOURCE_KINDS.has(record.kind) && record.lifecycle === 'stable')
    .sort((left, right) => compareCodeUnits(left.id, right.id)));
}

function issueDocumentationAdmissionProjection(
  projection: Omit<DocumentationAdmissionProjection, typeof DOCUMENTATION_ADMISSION_PROJECTION_BRAND>
): DocumentationAdmissionProjection {
  const issued = deepFreeze(projection) as DocumentationAdmissionProjection;
  issuedDocumentationAdmissionProjections.add(issued);
  return issued;
}

/**
 * A docs-only working-tree diagnostic has no operation authority. Keeping that
 * state explicit prevents docs doctor from manufacturing a positive Effect or
 * scope decision merely because the prose parses.
 */
export function unavailableDocumentationAdmissionProjection(
  trustedTree: string
): DocumentationAdmissionProjection {
  return issueDocumentationAdmissionProjection({
    status: 'unavailable',
    facts: Object.freeze([]),
    trustedTree: token(trustedTree, 'admission.trustedTree'),
    registryDigest: null
  });
}

/**
 * Compile the documentation applicability projection from the operation's
 * already authenticated owner closure. This projection says which stable
 * decisions apply to the operation; it never grants product Effect, scope,
 * Verification, merge, or completion authority.
 */
export function compileDocumentationOperationAdmissionProjection(input: Readonly<{
  readonly trustedTree: string;
  readonly registry: DocumentationAuthorityRegistry;
  readonly owners: readonly DocumentationAuthorityRecord[];
  readonly subjectRefs: readonly string[];
}>): DocumentationAdmissionProjection {
  const trustedTree = token(input.trustedTree, 'admission.trustedTree');
  const subjectRefs = sortedUnique(input.subjectRefs, 'admission.subjectRefs');
  const owners = [...input.owners].sort((left, right) => compareCodeUnits(left.id, right.id));
  if (owners.length === 0
      || new Set(owners.map(({ id }) => id)).size !== owners.length
      || owners.some((owner, index) => owner !== input.owners[index])) {
    fail('admission owners must be non-empty, unique, and in canonical id order.');
  }
  const facts = Object.freeze(owners.map((owner) => {
    const registered = documentationRecordById(input.registry, owner.id);
    if (registered !== owner || !SOURCE_KINDS.has(owner.kind) || owner.lifecycle !== 'stable') {
      fail(`admission owner ${owner.id} is not the stable registry-issued record.`);
    }
    return Object.freeze({
      id: `operation-owner:${owner.id}`,
      ownerDocumentId: owner.id,
      subjectRefs,
      admission: 'eligible' as const,
      evidenceObligations: Object.freeze([...owner.owns]),
      consumerRefs: Object.freeze([]),
      invalidationRefs: Object.freeze([owner.path])
    });
  }));
  return issueDocumentationAdmissionProjection({
    status: 'complete',
    facts,
    trustedTree,
    registryDigest: sha256(input.registry) as `sha256:${string}`
  });
}

function parseClauses(record: DocumentationAuthorityRecord, source: string): readonly DocumentationClause[] {
  const normalized = source.replaceAll('\r\n', '\n');
  if (normalized.includes('\r')) fail(`${record.path} must use canonical LF newlines.`);
  const lines = normalized.split('\n');
  const headings: Array<{
    title: string;
    level: number;
    line: number;
    directive: ClauseDirective;
  }> = [];
  let fence: string | null = null;
  let pendingDirective: ClauseDirective | null = null;
  let pendingDirectiveLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch !== null) {
      const marker = fenceMatch[1]![0]!;
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const directiveMatch = DIRECTIVE.exec(line);
    if (directiveMatch !== null) {
      if (pendingDirective !== null) fail(`${record.path}:${index + 1} has adjacent clause directives.`);
      pendingDirective = parseDirective(directiveMatch[1]!, `${record.path}:${index + 1}`);
      pendingDirectiveLine = index;
      continue;
    }
    const headingMatch = HEADING.exec(line);
    if (headingMatch !== null) {
      if (pendingDirective !== null && pendingDirectiveLine !== index - 1) {
        fail(`${record.path}:${pendingDirectiveLine + 1} clause directive must immediately precede a heading.`);
      }
      headings.push({
        title: text(headingMatch[2]!, `${record.path}:${index + 1} heading`),
        level: headingMatch[1]!.length,
        line: index,
        directive: pendingDirective ?? Object.freeze({ kind: 'untyped-observation', blocker: null })
      });
      pendingDirective = null;
      pendingDirectiveLine = -1;
      continue;
    }
    if (pendingDirective !== null && line.trim().length > 0) {
      fail(`${record.path}:${pendingDirectiveLine + 1} clause directive must immediately precede a heading.`);
    }
  }
  if (fence !== null) fail(`${record.path} contains an unterminated fenced block.`);
  if (pendingDirective !== null) fail(`${record.path}:${pendingDirectiveLine + 1} has an orphan clause directive.`);
  if (headings.length === 0 || headings[0]!.level !== 1) fail(`${record.path} must begin its clause graph with one H1.`);

  const stack: Array<{ level: number; title: string; id: `clause:${string}` }> = [];
  const sourceDigest = rawSha256(normalized);
  return Object.freeze(headings.map((heading, index) => {
    while (stack.length > 0 && stack.at(-1)!.level >= heading.level) stack.pop();
    const headingPath = Object.freeze([...stack.map(({ title }) => title), heading.title]);
    const id = `clause:${sha256({ documentId: record.id, headingPath }).slice('sha256:'.length)}` as const;
    const parentClauseId = stack.at(-1)?.id ?? null;
    const lineEnd = (headings[index + 1]?.line ?? lines.length) - 1;
    const content = lines.slice(heading.line, lineEnd + 1).join('\n').trimEnd();
    const clause: DocumentationClause = Object.freeze({
      id,
      documentId: record.id,
      repositoryPath: record.path,
      kind: heading.directive.kind,
      blocker: heading.directive.blocker,
      headingPath,
      level: heading.level,
      lineStart: heading.line + 1,
      lineEnd: lineEnd + 1,
      parentClauseId,
      sourceDigest,
      contentDigest: rawSha256(content),
      content
    });
    stack.push({ level: heading.level, title: heading.title, id });
    return clause;
  }));
}

function parseAdmissionFact(
  registry: DocumentationAuthorityRegistry,
  fact: DocumentationAdmissionFactInput,
  index: number
): DocumentationAdmissionFact {
  const id = token(fact.id, `admission.facts[${index}].id`);
  const ownerDocumentId = token(fact.ownerDocumentId, `admission.facts[${index}].ownerDocumentId`);
  const owner = documentationRecordById(registry, ownerDocumentId);
  if (owner === undefined || !SOURCE_KINDS.has(owner.kind)) {
    fail(`admission fact ${id} references unknown or non-owning document ${ownerDocumentId}.`);
  }
  if (!['eligible', 'blocked', 'unknown', 'not-applicable'].includes(fact.admission)) {
    fail(`admission fact ${id} has unsupported admission.`);
  }
  const withoutDigest = {
    id,
    ownerDocumentId,
    subjectRefs: sortedUnique(fact.subjectRefs, `admission.facts[${index}].subjectRefs`),
    admission: fact.admission,
    evidenceObligations: sortedUnique(
      fact.evidenceObligations,
      `admission.facts[${index}].evidenceObligations`
    ),
    consumerRefs: sortedUnique(fact.consumerRefs, `admission.facts[${index}].consumerRefs`),
    invalidationRefs: sortedUnique(
      fact.invalidationRefs,
      `admission.facts[${index}].invalidationRefs`
    )
  };
  return Object.freeze({ ...withoutDigest, factDigest: sha256(withoutDigest) as `sha256:${string}` });
}

export function compileDocumentationSemanticGraph(
  input: DocumentationSemanticGraphInput
): DocumentationSemanticGraph {
  const trustedTree = token(input.trustedTree, 'trustedTree');
  if (!issuedDocumentationAdmissionProjections.has(input.admission)) {
    fail('admission projection was not issued by the documentation admission owner.');
  }
  if (input.admission.trustedTree !== trustedTree) {
    fail('admission projection is bound to a different trusted tree.');
  }
  const expectedRegistryDigest = sha256(input.registry) as `sha256:${string}`;
  if (input.admission.status === 'complete'
      && input.admission.registryDigest !== expectedRegistryDigest) {
    fail('admission projection is bound to a different documentation registry.');
  }
  const records = compilerSources(input.registry);
  const sourceIds = input.sources.map(({ documentId }) => documentId);
  const expectedIds = records.map(({ id }) => id);
  if (new Set(sourceIds).size !== sourceIds.length
      || sourceIds.some((id, index) => id !== [...sourceIds].sort(compareCodeUnits)[index])
      || sourceIds.length !== expectedIds.length
      || sourceIds.some((id, index) => id !== expectedIds[index])) {
    fail('sources must exactly match stable owning documents in canonical id order.');
  }
  const clauses = Object.freeze(records.flatMap((record, index) => (
    parseClauses(record, input.sources[index]!.source)
  )));
  if (new Set(clauses.map(({ id }) => id)).size !== clauses.length) {
    fail('clause identity collision detected.');
  }
  if (input.admission.status !== 'complete' && input.admission.status !== 'unavailable') {
    fail('admission.status is unsupported.');
  }
  if (input.admission.status === 'unavailable' && input.admission.facts.length !== 0) {
    fail('unavailable admission cannot carry facts.');
  }
  const admissionFacts = Object.freeze(input.admission.facts
    .map((fact, index) => parseAdmissionFact(input.registry, fact, index))
    .sort((left, right) => compareCodeUnits(left.id, right.id)));
  if (new Set(admissionFacts.map(({ id }) => id)).size !== admissionFacts.length) {
    fail('admission facts contain duplicate ids.');
  }
  const registryDigest = expectedRegistryDigest;
  const compilerInputDigest = sha256({
    trustedTree,
    registryDigest,
    sources: clauses.filter(({ level }) => level === 1).map(({ documentId, sourceDigest }) => ({
      documentId,
      sourceDigest
    })),
    admissionStatus: input.admission.status,
    admissionFacts: admissionFacts.map(({ id, factDigest }) => ({ id, factDigest }))
  }) as `sha256:${string}`;
  const blockers = Object.freeze([
    ...(input.admission.status === 'unavailable' ? ['documentation-admission-projection-unavailable'] : []),
    ...clauses
      .filter(({ kind }) => kind === 'untyped-observation')
      .map(({ documentId }) => `documentation-untyped-source:${documentId}`),
    ...clauses.flatMap(({ kind, blocker }) => kind === 'temporary-safety-denial' && blocker !== null
      ? [blocker]
      : []),
    ...admissionFacts.flatMap(({ admission, id }) => admission === 'blocked' || admission === 'unknown'
      ? [`admission:${id}:${admission}`]
      : [])
  ].sort(compareCodeUnits));
  const graphWithoutDigest = {
    schema: DOCUMENTATION_SEMANTIC_GRAPH_SCHEMA,
    trustedTree,
    registryDigest,
    compilerInputDigest,
    clauses,
    admissionStatus: input.admission.status,
    admissionFacts,
    blockers
  };
  return issueDocumentationSemanticGraph({
    ...graphWithoutDigest,
    semanticGraphDigest: sha256(graphWithoutDigest) as `sha256:${string}`
  });
}

function canonicalSelection(selection: DocumentationViewSelection): DocumentationViewSelection {
  const kind = selection.kind;
  if (!['compact-agent', 'full-human', 'admission-obligation'].includes(kind)) {
    fail('view kind is unsupported.');
  }
  const clauseIds = sortedUnique(selection.clauseIds, 'selection.clauseIds');
  const ownerDocumentIds = sortedUnique(selection.ownerDocumentIds, 'selection.ownerDocumentIds');
  const decisionQuestionDigest = digest(
    selection.decisionQuestionDigest,
    'selection.decisionQuestionDigest'
  );
  if (kind === 'full-human' && (clauseIds.length > 0 || ownerDocumentIds.length > 0)) {
    fail('full-human view must not carry one partial selection.');
  }
  return Object.freeze({ kind, clauseIds, ownerDocumentIds, decisionQuestionDigest });
}

export function compileDocumentationView(
  graph: DocumentationSemanticGraph,
  selectionInput: DocumentationViewSelection
): DocumentationView {
  const selection = canonicalSelection(selectionInput);
  const byId = new Map(graph.clauses.map((clause) => [clause.id, clause] as const));
  for (const clauseId of selection.clauseIds) {
    if (!byId.has(clauseId as `clause:${string}`)) fail(`selection references unknown clause ${clauseId}.`);
  }
  const selected = new Set<string>();
  const addWithAncestors = (clause: DocumentationClause): void => {
    selected.add(clause.id);
    let parent = clause.parentClauseId === null ? undefined : byId.get(clause.parentClauseId);
    while (parent !== undefined) {
      selected.add(parent.id);
      parent = parent.parentClauseId === null ? undefined : byId.get(parent.parentClauseId);
    }
  };
  if (selection.kind === 'full-human') {
    for (const clause of graph.clauses) selected.add(clause.id);
  } else if (selection.kind === 'compact-agent') {
    for (const clauseId of selection.clauseIds) {
      const clause = byId.get(clauseId as `clause:${string}`)!;
      if (clause.kind === 'untyped-observation') {
        fail(`compact-agent selection cannot include untyped clause ${clauseId}.`);
      }
      addWithAncestors(clause);
    }
  }
  const clauses = Object.freeze(graph.clauses.filter(({ id }) => selected.has(id)));
  const ownerSet = new Set(selection.ownerDocumentIds);
  const admissionFacts = Object.freeze(selection.kind === 'full-human'
    ? [...graph.admissionFacts]
    : graph.admissionFacts.filter(({ ownerDocumentId }) => ownerSet.has(ownerDocumentId)));
  const selectionDigest = sha256(selection) as `sha256:${string}`;
  const withoutBytesDigest = {
    schema: DOCUMENTATION_VIEW_SCHEMA,
    kind: selection.kind,
    trustedTree: graph.trustedTree,
    compilerInputDigest: graph.compilerInputDigest,
    semanticGraphDigest: graph.semanticGraphDigest,
    selectionDigest,
    clauses,
    admissionStatus: graph.admissionStatus,
    admissionFacts,
    blockers: graph.blockers
  };
  const bytes = `${JSON.stringify(canonicalJson(withoutBytesDigest))}\n`;
  return deepFreeze({
    ...withoutBytesDigest,
    viewBytesDigest: rawSha256(bytes)
  });
}

export function projectDocumentationClauseSelection(
  graph: DocumentationSemanticGraph,
  documentIdInput: string
): DocumentationClauseSelectionReference {
  const documentId = token(documentIdInput, 'documentId');
  const clauses = Object.freeze(graph.clauses
    .filter((clause) => clause.documentId === documentId && clause.kind !== 'untyped-observation')
    .map((clause) => Object.freeze({
      clauseId: clause.id,
      contentDigest: clause.contentDigest,
      lineStart: clause.lineStart,
      lineEnd: clause.lineEnd
    })));
  if (clauses.length === 0) fail(`document ${documentId} has no compiled clauses.`);
  const sourceDigest = graph.clauses.find((clause) => clause.documentId === documentId)!.sourceDigest;
  const withoutSelectionDigest = {
    kind: 'markdown-clauses' as const,
    compilerInputDigest: graph.compilerInputDigest,
    semanticGraphDigest: graph.semanticGraphDigest,
    sourceDigest,
    clauses
  };
  return deepFreeze({
    ...withoutSelectionDigest,
    selectionDigest: sha256(withoutSelectionDigest) as `sha256:${string}`
  });
}
