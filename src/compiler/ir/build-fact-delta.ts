import { cloneAndDeepFreeze, compareCodeUnits, deepFreeze } from '../../contracts/canonical.ts';
import { fail } from '../../contracts/failure.ts';
import type { FactAssertionUpdate, FactAssertionUpdateField, FactDelta, FactDeltaEndpoint, FactDeltaEndpointContext, SemanticFactChange } from '../../semantics/engineering-ir/delta-types.ts';
import { FACT_DELTA_CONTRACT_VERSION, FACT_DELTA_SCOPE } from '../../semantics/engineering-ir/delta-types.ts';
import type { FactAssertion, SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import { rawSha256Hex, semanticRevisionPayload } from './ir-revision.ts';

type CanonicalFactPayload = Omit<SemanticFact, 'assertions'> & {
  assertions: Array<Omit<FactAssertion, 'validFromRevision' | 'validToRevision'>>;
};

function endpoint(context: FactDeltaEndpointContext): FactDeltaEndpoint {
  return {
    transactionId: context.transactionId,
    inputRevision: context.inputRevision,
    semanticRevision: context.semanticRevision
  };
}

function assertEndpoint(context: FactDeltaEndpointContext, side: 'from' | 'to'): void {
  const { ir } = context.snapshot;
  if (
    !context.transactionId.trim() ||
    !context.inputRevision.trim() ||
    !context.semanticRevision.trim() ||
    context.inputRevision !== ir.inputRevision ||
    context.semanticRevision !== ir.semanticRevision
  ) {
    fail(
      'FACT-DELTA-001',
      `Fact Delta ${side} endpoint must bind a non-empty transaction audit label and exact snapshot revisions`,
      {
        side,
        transactionId: context.transactionId,
        inputRevision: context.inputRevision,
        snapshotInputRevision: ir.inputRevision,
        semanticRevision: context.semanticRevision,
        snapshotSemanticRevision: ir.semanticRevision
      }
    );
  }
}

function assertCompatibleLineage(from: FactDeltaEndpointContext, to: FactDeltaEndpointContext): void {
  const before = from.snapshot.ir;
  const after = to.snapshot.ir;
  if (
    before.formatVersion !== after.formatVersion ||
    before.graphId !== after.graphId ||
    before.appId !== after.appId
  ) {
    fail(
      'FACT-DELTA-002',
      'Fact Delta endpoints must have the same format, graph, and app lineage',
      {
        from: { formatVersion: before.formatVersion, graphId: before.graphId, appId: before.appId },
        to: { formatVersion: after.formatVersion, graphId: after.graphId, appId: after.appId }
      }
    );
  }
}

function semanticPayload(context: FactDeltaEndpointContext): string {
  const { ir } = context.snapshot;
  return semanticRevisionPayload(ir.graphId, ir.appId, ir.entities, ir.facts, ir.scenarios);
}

function assertSameRevisionInvariant(
  from: FactDeltaEndpointContext,
  to: FactDeltaEndpointContext
): void {
  if (
    from.semanticRevision === to.semanticRevision &&
    semanticPayload(from) !== semanticPayload(to)
  ) {
    fail(
      'FACT-DELTA-003',
      'Equal semantic revisions must identify the same canonical semantic payload',
      { semanticRevision: from.semanticRevision }
    );
  }
}

function assertSupportedValidity(context: FactDeltaEndpointContext, side: 'from' | 'to'): void {
  for (const fact of context.snapshot.ir.facts) {
    for (const assertion of fact.assertions) {
      if (assertion.validToRevision !== undefined) {
        fail(
          'FACT-DELTA-006',
          'Fact Delta v1 does not support validToRevision',
          { side, factId: fact.id, assertionId: assertion.id, validToRevision: assertion.validToRevision }
        );
      }
    }
  }
}

function canonicalAssertion(assertion: FactAssertion): Omit<FactAssertion, 'validFromRevision' | 'validToRevision'> {
  const {
    validFromRevision: _validFromRevision,
    validToRevision: _validToRevision,
    ...canonical
  } = assertion;
  return canonical;
}

function canonicalFact(fact: SemanticFact): CanonicalFactPayload {
  return {
    ...fact,
    assertions: fact.assertions.map(canonicalAssertion)
  };
}

function factSetDigest(context: FactDeltaEndpointContext): string {
  const { ir } = context.snapshot;
  const payload = JSON.stringify({
    domain: 'engineering-ir-fact-set-v1',
    formatVersion: ir.formatVersion,
    graphId: ir.graphId,
    appId: ir.appId,
    facts: ir.facts.map(canonicalFact)
  });
  return `sha256:${rawSha256Hex(payload)}`;
}

function sameTriple(before: SemanticFact, after: SemanticFact): boolean {
  return before.subject === after.subject &&
    before.predicate === after.predicate &&
    JSON.stringify(before.object) === JSON.stringify(after.object);
}

function sameAssertionIdentity(before: FactAssertion, after: FactAssertion): boolean {
  return before.authority === after.authority &&
    JSON.stringify(before.provenance) === JSON.stringify(after.provenance);
}

function assertionUpdate(
  before: FactAssertion,
  after: FactAssertion
): FactAssertionUpdate | undefined {
  const changedFields: FactAssertionUpdateField[] = [];
  if (before.confidence !== after.confidence) changedFields.push('confidence');
  if (JSON.stringify(before.evidence) !== JSON.stringify(after.evidence)) changedFields.push('evidence');
  if (changedFields.length === 0) return undefined;

  return {
    assertionId: before.id,
    changedFields,
    before: { confidence: before.confidence, evidence: cloneAndDeepFreeze(before.evidence) },
    after: { confidence: after.confidence, evidence: cloneAndDeepFreeze(after.evidence) }
  };
}

function diffAssertions(before: SemanticFact, after: SemanticFact): SemanticFactChange | undefined {
  const addedAssertions: FactAssertion[] = [];
  const removedAssertions: FactAssertion[] = [];
  const updatedAssertions: FactAssertionUpdate[] = [];
  let fromIndex = 0;
  let toIndex = 0;

  while (fromIndex < before.assertions.length || toIndex < after.assertions.length) {
    const fromAssertion = before.assertions[fromIndex];
    const toAssertion = after.assertions[toIndex];

    if (fromAssertion === undefined) {
      addedAssertions.push(cloneAndDeepFreeze(toAssertion!));
      toIndex += 1;
      continue;
    }
    if (toAssertion === undefined) {
      removedAssertions.push(cloneAndDeepFreeze(fromAssertion));
      fromIndex += 1;
      continue;
    }

    const comparison = compareCodeUnits(fromAssertion.id, toAssertion.id);
    if (comparison < 0) {
      removedAssertions.push(cloneAndDeepFreeze(fromAssertion));
      fromIndex += 1;
      continue;
    }
    if (comparison > 0) {
      addedAssertions.push(cloneAndDeepFreeze(toAssertion));
      toIndex += 1;
      continue;
    }

    if (!sameAssertionIdentity(fromAssertion, toAssertion)) {
      fail(
        'FACT-DELTA-005',
        `Fact assertion identity collision for "${fromAssertion.id}"`,
        { factId: before.id, assertionId: fromAssertion.id }
      );
    }
    const update = assertionUpdate(fromAssertion, toAssertion);
    if (update) updatedAssertions.push(update);
    fromIndex += 1;
    toIndex += 1;
  }

  if (addedAssertions.length === 0 && removedAssertions.length === 0 && updatedAssertions.length === 0) {
    return undefined;
  }
  return { factId: before.id, addedAssertions, removedAssertions, updatedAssertions };
}

function diffFacts(
  from: FactDeltaEndpointContext,
  to: FactDeltaEndpointContext
): Pick<FactDelta, 'added' | 'removed' | 'changed'> {
  const before = from.snapshot.ir.facts;
  const after = to.snapshot.ir.facts;
  const added: SemanticFact[] = [];
  const removed: SemanticFact[] = [];
  const changed: SemanticFactChange[] = [];
  let fromIndex = 0;
  let toIndex = 0;

  while (fromIndex < before.length || toIndex < after.length) {
    const fromFact = before[fromIndex];
    const toFact = after[toIndex];

    if (fromFact === undefined) {
      added.push(cloneAndDeepFreeze(toFact!));
      toIndex += 1;
      continue;
    }
    if (toFact === undefined) {
      removed.push(cloneAndDeepFreeze(fromFact));
      fromIndex += 1;
      continue;
    }

    const comparison = compareCodeUnits(fromFact.id, toFact.id);
    if (comparison < 0) {
      removed.push(cloneAndDeepFreeze(fromFact));
      fromIndex += 1;
      continue;
    }
    if (comparison > 0) {
      added.push(cloneAndDeepFreeze(toFact));
      toIndex += 1;
      continue;
    }

    if (!sameTriple(fromFact, toFact)) {
      fail(
        'FACT-DELTA-004',
        `Semantic fact identity collision for "${fromFact.id}"`,
        { factId: fromFact.id }
      );
    }
    const change = diffAssertions(fromFact, toFact);
    if (change) changed.push(change);
    fromIndex += 1;
    toIndex += 1;
  }

  return { added, removed, changed };
}

function assertSortedUnique(values: readonly { id: string }[], collection: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const id = values[index]!.id;
    const previous = values[index - 1]?.id;
    if (previous !== undefined && compareCodeUnits(previous, id) >= 0) {
      fail('FACT-DELTA-007', `Fact Delta ${collection} must be unique and canonically ordered`, {
        collection,
        previousId: previous,
        id
      });
    }
  }
}

function assertOutputInvariants(
  added: readonly SemanticFact[],
  removed: readonly SemanticFact[],
  changed: readonly SemanticFactChange[]
): void {
  assertSortedUnique(added, 'added');
  assertSortedUnique(removed, 'removed');
  assertSortedUnique(changed.map((entry) => ({ id: entry.factId })), 'changed');

  const seen = new Set<string>();
  for (const factId of [
    ...added.map((fact) => fact.id),
    ...removed.map((fact) => fact.id),
    ...changed.map((change) => change.factId)
  ]) {
    if (seen.has(factId)) {
      fail('FACT-DELTA-007', `Fact Delta fact "${factId}" appears in multiple classifications`, { factId });
    }
    seen.add(factId);
  }

  for (const change of changed) {
    assertSortedUnique(change.addedAssertions, `changed:${change.factId}:addedAssertions`);
    assertSortedUnique(change.removedAssertions, `changed:${change.factId}:removedAssertions`);
    assertSortedUnique(
      change.updatedAssertions.map((entry) => ({ id: entry.assertionId })),
      `changed:${change.factId}:updatedAssertions`
    );
    const assertionIds = new Set<string>();
    for (const assertionId of [
      ...change.addedAssertions.map((assertion) => assertion.id),
      ...change.removedAssertions.map((assertion) => assertion.id),
      ...change.updatedAssertions.map((update) => update.assertionId)
    ]) {
      if (assertionIds.has(assertionId)) {
        fail(
          'FACT-DELTA-007',
          `Fact Delta assertion "${assertionId}" appears in multiple classifications`,
          { factId: change.factId, assertionId }
        );
      }
      assertionIds.add(assertionId);
    }
    for (const update of change.updatedAssertions) {
      const expectedFields: FactAssertionUpdateField[] = [];
      if (update.before.confidence !== update.after.confidence) expectedFields.push('confidence');
      if (JSON.stringify(update.before.evidence) !== JSON.stringify(update.after.evidence)) {
        expectedFields.push('evidence');
      }
      if (JSON.stringify(update.changedFields) !== JSON.stringify(expectedFields)) {
        fail(
          'FACT-DELTA-007',
          `Fact Delta assertion update "${update.assertionId}" has non-canonical changedFields`,
          { factId: change.factId, assertionId: update.assertionId }
        );
      }
    }
  }
}

function deltaDigestPayload(
  delta: Omit<FactDelta, 'deltaRevision'>
): string {
  return JSON.stringify({
    domain: 'engineering-ir-fact-delta-v1',
    contractVersion: delta.contractVersion,
    scope: delta.scope,
    formatVersion: delta.formatVersion,
    graphId: delta.graphId,
    appId: delta.appId,
    from: { semanticRevision: delta.from.semanticRevision },
    to: { semanticRevision: delta.to.semanticRevision },
    fromFactSetDigest: delta.fromFactSetDigest,
    toFactSetDigest: delta.toFactSetDigest,
    added: delta.added.map(canonicalFact),
    removed: delta.removed.map(canonicalFact),
    changed: delta.changed.map((change) => ({
      factId: change.factId,
      addedAssertions: change.addedAssertions.map(canonicalAssertion),
      removedAssertions: change.removedAssertions.map(canonicalAssertion),
      updatedAssertions: change.updatedAssertions
    }))
  });
}

export function buildFactDelta(
  from: FactDeltaEndpointContext,
  to: FactDeltaEndpointContext
): FactDelta {
  assertEndpoint(from, 'from');
  assertEndpoint(to, 'to');
  assertCompatibleLineage(from, to);
  assertSameRevisionInvariant(from, to);
  assertSupportedValidity(from, 'from');
  assertSupportedValidity(to, 'to');

  const { added, removed, changed } = diffFacts(from, to);
  assertOutputInvariants(added, removed, changed);

  const deltaWithoutRevision: Omit<FactDelta, 'deltaRevision'> = {
    contractVersion: FACT_DELTA_CONTRACT_VERSION,
    scope: FACT_DELTA_SCOPE,
    formatVersion: from.snapshot.ir.formatVersion,
    graphId: from.snapshot.ir.graphId,
    appId: from.snapshot.ir.appId,
    from: endpoint(from),
    to: endpoint(to),
    fromFactSetDigest: factSetDigest(from),
    toFactSetDigest: factSetDigest(to),
    added,
    removed,
    changed
  };
  const result: FactDelta = {
    ...deltaWithoutRevision,
    deltaRevision: `sha256:${rawSha256Hex(deltaDigestPayload(deltaWithoutRevision))}`
  };
  return deepFreeze(result);
}
