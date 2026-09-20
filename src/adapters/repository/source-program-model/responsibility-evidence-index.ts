/** Derived lookup data for one responsibility projection; never evidence or authority. */
type Selection<Value> =
  | Readonly<{ status: 'absent' }>
  | Readonly<{ status: 'unique'; value: Value }>
  | Readonly<{ status: 'ambiguous' }>;

const ABSENT = Object.freeze({ status: 'absent' as const });
const AMBIGUOUS = Object.freeze({ status: 'ambiguous' as const });

interface BindingRow {
  readonly binding: Readonly<{ id: string }>;
  readonly declarationPath: string | null;
  readonly exportName: string | null;
}

interface ContainmentFact {
  readonly predicate: string;
  readonly subject: string;
  readonly object: Readonly<{ kind: string; entityId?: string }>;
  readonly assertions: readonly Readonly<{
    authority: string;
    validFromRevision: string;
    provenance: readonly Readonly<{ kind: string }>[];
  }>[];
}

interface Declaration {
  readonly exported: boolean;
  readonly path: string;
  readonly name: string;
}

function observe<Value>(previous: Selection<Value> | undefined, value: Value): Selection<Value> {
  // This is cardinality, not last-writer-wins: duplicate identical facts are
  // still ambiguous. Only the zero/one/multiple distinction is consumed.
  return previous === undefined
    ? Object.freeze({ status: 'unique', value })
    : AMBIGUOUS;
}

/**
 * Replace per-binding full scans with one generation-local relational join.
 * Attribute decoding and evidence issuance remain with the caller. No global
 * cache, source parsing, new graph, or state survives this projection call.
 */
export function indexResponsibilityEvidenceInputs<Row extends BindingRow, Entry extends Declaration>(
  rows: readonly Row[],
  facts: readonly ContainmentFact[],
  declarations: readonly Entry[],
  semanticRevision: string
): readonly Readonly<Row & {
  containment: Selection<string>;
  declaration: Selection<Entry>;
  conflictingDeclarationClaim: boolean;
}>[] {
  if (rows.length === 0) return Object.freeze([]);
  const bindingIds = new Set(rows.map(({ binding }) => binding.id));
  const containmentByBinding = new Map<string, Selection<string>>();
  for (const fact of facts) {
    if (fact.predicate !== 'CONTAINS' || fact.object.kind !== 'entity'
        || !bindingIds.has(fact.object.entityId!)) continue;
    if (!fact.assertions.some((assertion) => (
      assertion.authority === 'authoritative'
      && assertion.validFromRevision === semanticRevision
      && assertion.provenance.some(({ kind }) => kind === 'contract')
    ))) continue;
    const id = fact.object.entityId!;
    containmentByBinding.set(id, observe(containmentByBinding.get(id), fact.subject));
  }

  // Retain the caller's existing claim-identity spelling. Declaration lookup
  // itself compares both fields independently, just as the original filter did.
  const claimKey = (path: string, name: string): string => `${path}\u0000${name}`;
  const claimCounts = new Map<string, number>();
  const requested = new Map<string, Map<string, Selection<Entry>>>();
  for (const { declarationPath, exportName } of rows) {
    if (declarationPath === null || exportName === null) continue;
    const key = claimKey(declarationPath, exportName);
    claimCounts.set(key, (claimCounts.get(key) ?? 0) + 1);
    let names = requested.get(declarationPath);
    if (names === undefined) { names = new Map(); requested.set(declarationPath, names); }
    if (!names.has(exportName)) names.set(exportName, ABSENT);
  }
  for (const declaration of declarations) {
    if (!declaration.exported) continue;
    const names = requested.get(declaration.path);
    const previous = names?.get(declaration.name);
    if (previous === undefined) continue;
    names!.set(declaration.name, observe(
      previous.status === 'absent' ? undefined : previous, declaration
    ));
  }
  return Object.freeze(rows.map((row) => Object.freeze({
    ...row,
    containment: containmentByBinding.get(row.binding.id) ?? ABSENT,
    declaration: row.declarationPath === null || row.exportName === null
      ? ABSENT : requested.get(row.declarationPath)!.get(row.exportName)!,
    conflictingDeclarationClaim: row.declarationPath !== null && row.exportName !== null
      && claimCounts.get(claimKey(row.declarationPath, row.exportName))! > 1
  })));
}
