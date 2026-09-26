import { canonicalJson, compareCodeUnits, deepFreeze, sha256, uniqueSorted } from '../../contracts/canonical.ts';
import { fail } from '../../contracts/failure.ts';
import type { FactDelta, FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import type { SemanticEntity } from '../../semantics/engineering-ir/entity-types.ts';
import type { SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import { IMPACT_CONTRACT_VERSION, IMPACT_PROPAGATION_RULE_REVISION, IMPACT_SCOPE, type ImpactBasis, type ImpactOccurrence, type ImpactPathStep, type ImpactPropagationInput, type ImpactSeed, type ImpactUncertainty, type SemanticImpactPropagation, type VerificationReason, type VerificationRecommendation } from '../../semantics/impact/types.ts';
import { buildFactDelta } from '../ir/build-fact-delta.ts';
import {
  indexValidatedEngineeringIR,
  type EngineeringIRIndex
} from '../ir/index-engineering-ir.ts';
import { rawSha256Hex } from '../ir/ir-revision.ts';
import {
  assertImpactPropagationRuleRegistry,
  IMPACT_PROPAGATION_RULES
} from './propagation-rules.ts';

type PropagatingSeed = { readonly seed: ImpactSeed; readonly propagates: boolean };

interface ReachState {
  readonly entityId: string;
  distance: number;
  seedIds: string[];
  canonicalSeedId: string;
  canonicalPath: ImpactPathStep[];
}

interface ImpactSource {
  readonly basis: ImpactBasis;
  readonly entityId: string;
  readonly level: 'seed' | 'direct' | 'transitive';
  readonly seedIds: readonly string[];
  readonly canonicalSeedId: string;
  readonly canonicalPath: readonly ImpactPathStep[];
}

interface UncertaintyDraft extends ImpactUncertainty {
  readonly distance: number;
  readonly canonicalSeedId: string;
}

const BASIS_RANK: Readonly<Record<ImpactBasis, number>> = { from: 0, to: 1 };
const SOURCE_LEVEL_RANK = { seed: 0, direct: 1, transitive: 2 } as const;

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareCodeUnits(left[index]!, right[index]!);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function pathStepTuple(step: ImpactPathStep): string[] {
  return [
    step.predicate,
    step.factId,
    step.ruleVariantId,
    step.direction,
    step.fromEntityId,
    step.toEntityId
  ];
}

function comparePaths(left: readonly ImpactPathStep[], right: readonly ImpactPathStep[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const comparison = compareStringArrays(pathStepTuple(left[index]!), pathStepTuple(right[index]!));
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}

function compareSeedPaths(
  leftSeedId: string,
  leftPath: readonly ImpactPathStep[],
  rightSeedId: string,
  rightPath: readonly ImpactPathStep[]
): number {
  const seedComparison = compareCodeUnits(leftSeedId, rightSeedId);
  return seedComparison !== 0 ? seedComparison : comparePaths(leftPath, rightPath);
}

function compareSeeds(left: ImpactSeed, right: ImpactSeed): number {
  return BASIS_RANK[left.basis] - BASIS_RANK[right.basis] ||
    compareCodeUnits(left.kind, right.kind) ||
    compareCodeUnits(left.id, right.id);
}

function compareOccurrences(left: ImpactOccurrence, right: ImpactOccurrence): number {
  return BASIS_RANK[left.basis] - BASIS_RANK[right.basis] ||
    left.distance - right.distance ||
    compareCodeUnits(left.entityId, right.entityId);
}

function uncertaintyIdentity(value: ImpactUncertainty): string[] {
  return [
    String(BASIS_RANK[value.basis]),
    value.classification,
    value.reasonCode,
    value.boundaryEntityId ?? '',
    value.factId ?? '',
    value.predicate ?? ''
  ];
}

function compareUncertainties(left: ImpactUncertainty, right: ImpactUncertainty): number {
  return compareStringArrays(uncertaintyIdentity(left), uncertaintyIdentity(right)) ||
    compareStringArrays(left.seedIds, right.seedIds) ||
    comparePaths(left.canonicalPath, right.canonicalPath);
}

function verificationTarget(value: VerificationRecommendation): string {
  return value.kind === 'acceptance' ? value.acceptanceEntityId : value.selector;
}

function compareVerificationReasons(left: VerificationReason, right: VerificationReason): number {
  return BASIS_RANK[left.basis] - BASIS_RANK[right.basis] ||
    SOURCE_LEVEL_RANK[left.sourceLevel] - SOURCE_LEVEL_RANK[right.sourceLevel] ||
    compareCodeUnits(left.sourceEntityId, right.sourceEntityId) ||
    compareCodeUnits(left.factId ?? '', right.factId ?? '') ||
    compareStringArrays(left.sourceSeedIds, right.sourceSeedIds);
}

function compareRecommendations(
  left: VerificationRecommendation,
  right: VerificationRecommendation
): number {
  return compareCodeUnits(left.kind, right.kind) || compareCodeUnits(verificationTarget(left), verificationTarget(right));
}

function assertInputBinding(input: ImpactPropagationInput): void {
  const { delta, from, to } = input;
  const fromIR = from.snapshot.ir;
  const toIR = to.snapshot.ir;
  const valid = delta.formatVersion === fromIR.formatVersion &&
    delta.formatVersion === toIR.formatVersion &&
    delta.graphId === fromIR.graphId &&
    delta.graphId === toIR.graphId &&
    delta.appId === fromIR.appId &&
    delta.appId === toIR.appId &&
    delta.from.transactionId === from.transactionId &&
    delta.from.inputRevision === from.inputRevision &&
    delta.from.semanticRevision === from.semanticRevision &&
    delta.to.transactionId === to.transactionId &&
    delta.to.inputRevision === to.inputRevision &&
    delta.to.semanticRevision === to.semanticRevision;
  if (!valid) {
    fail('IMPACT-001', 'Impact input delta endpoint fields must bind the supplied endpoint contexts', {
      delta: {
        formatVersion: delta.formatVersion,
        graphId: delta.graphId,
        appId: delta.appId,
        from: delta.from,
        to: delta.to
      },
      contexts: {
        from: {
          transactionId: from.transactionId,
          inputRevision: from.inputRevision,
          semanticRevision: from.semanticRevision
        },
        to: {
          transactionId: to.transactionId,
          inputRevision: to.inputRevision,
          semanticRevision: to.semanticRevision
        }
      }
    });
  }
}

function assertCanonicalDelta(
  supplied: FactDelta,
  from: FactDeltaEndpointContext,
  to: FactDeltaEndpointContext
): FactDelta {
  const canonical = buildFactDelta(from, to);
  if (JSON.stringify(supplied) !== JSON.stringify(canonical)) {
    fail('IMPACT-002', 'Impact input delta must exactly equal canonical Fact Delta recomputation', {
      suppliedDeltaRevision: supplied.deltaRevision,
      canonicalDeltaRevision: canonical.deltaRevision
    });
  }
  return canonical;
}

function seedDigest(payload: Record<string, string>): string {
  return sha256({ domain: 'engineering-ir-impact-seed-v1', ...payload });
}

function entitySeed(
  kind: 'entity-added' | 'entity-removed',
  basis: ImpactBasis,
  entityId: string
): ImpactSeed {
  return {
    id: seedDigest({ kind, basis, entityId }),
    kind,
    basis,
    entityId,
    anchorEntityId: entityId
  };
}

function updatedEntitySeed(
  basis: ImpactBasis,
  entityId: string,
  changedFields: readonly ('label' | 'attributes')[]
): ImpactSeed {
  const kind = 'entity-updated' as const;
  return {
    id: seedDigest({ kind, basis, entityId }),
    kind,
    basis,
    entityId,
    anchorEntityId: entityId,
    changedFields: [...changedFields]
  };
}

function factSeed(
  kind: 'fact-added' | 'fact-removed',
  basis: ImpactBasis,
  fact: SemanticFact
): ImpactSeed {
  return {
    id: seedDigest({ kind, basis, factId: fact.id }),
    kind,
    basis,
    factId: fact.id,
    anchorEntityId: fact.subject
  };
}

function assertionSeed(
  kind: 'assertion-added' | 'assertion-removed',
  basis: ImpactBasis,
  fact: SemanticFact,
  assertionId: string
): ImpactSeed {
  return {
    id: seedDigest({ kind, basis, factId: fact.id, assertionId }),
    kind,
    basis,
    factId: fact.id,
    assertionId,
    anchorEntityId: fact.subject
  };
}

function assertionUpdateSeed(
  basis: ImpactBasis,
  fact: SemanticFact,
  assertionId: string,
  changedFields: readonly ('confidence' | 'evidence')[]
): ImpactSeed {
  const kind = 'assertion-updated' as const;
  return {
    id: seedDigest({ kind, basis, factId: fact.id, assertionId }),
    kind,
    basis,
    factId: fact.id,
    assertionId,
    anchorEntityId: fact.subject,
    changedFields: [...changedFields]
  };
}

function hasDefiniteAuthority(fact: SemanticFact): boolean {
  return fact.assertions.some((assertion) =>
    assertion.authority === 'authoritative' || assertion.authority === 'derived'
  );
}

function entityChangedFields(
  before: SemanticEntity,
  after: SemanticEntity
): Array<'label' | 'attributes'> {
  const changed: Array<'label' | 'attributes'> = [];
  if (before.label !== after.label) changed.push('label');
  if (JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)) changed.push('attributes');
  return changed;
}

function collectEntitySeeds(
  from: FactDeltaEndpointContext,
  to: FactDeltaEndpointContext
): PropagatingSeed[] {
  const seeds: PropagatingSeed[] = [];
  const before = from.snapshot.ir.entities;
  const after = to.snapshot.ir.entities;
  let fromIndex = 0;
  let toIndex = 0;
  while (fromIndex < before.length || toIndex < after.length) {
    const fromEntity = before[fromIndex];
    const toEntity = after[toIndex];
    if (fromEntity === undefined) {
      seeds.push({ seed: entitySeed('entity-added', 'to', toEntity!.id), propagates: true });
      toIndex += 1;
      continue;
    }
    if (toEntity === undefined) {
      seeds.push({ seed: entitySeed('entity-removed', 'from', fromEntity.id), propagates: true });
      fromIndex += 1;
      continue;
    }
    const comparison = compareCodeUnits(fromEntity.id, toEntity.id);
    if (comparison < 0) {
      seeds.push({ seed: entitySeed('entity-removed', 'from', fromEntity.id), propagates: true });
      fromIndex += 1;
      continue;
    }
    if (comparison > 0) {
      seeds.push({ seed: entitySeed('entity-added', 'to', toEntity.id), propagates: true });
      toIndex += 1;
      continue;
    }
    if (fromEntity.kind !== toEntity.kind) {
      fail('IMPACT-004', `Entity identity collision for "${fromEntity.id}" across Impact endpoints`, {
        entityId: fromEntity.id,
        fromKind: fromEntity.kind,
        toKind: toEntity.kind
      });
    }
    const changedFields = entityChangedFields(fromEntity, toEntity);
    if (changedFields.length > 0) {
      seeds.push({
        seed: updatedEntitySeed('from', fromEntity.id, changedFields),
        propagates: true
      });
      seeds.push({
        seed: updatedEntitySeed('to', toEntity.id, changedFields),
        propagates: true
      });
    }
    fromIndex += 1;
    toIndex += 1;
  }
  return seeds;
}

function requireFact(index: EngineeringIRIndex, factId: string, basis: ImpactBasis): SemanticFact {
  const fact = index.factById.get(factId);
  if (!fact) {
    fail('IMPACT-006', `Canonical Impact seed references missing ${basis} Fact "${factId}"`, {
      basis,
      factId
    });
  }
  return fact;
}

function collectFactSeeds(
  delta: FactDelta,
  fromIndex: EngineeringIRIndex,
  toIndex: EngineeringIRIndex
): PropagatingSeed[] {
  const seeds: PropagatingSeed[] = [];
  for (const fact of delta.added) {
    seeds.push({ seed: factSeed('fact-added', 'to', fact), propagates: hasDefiniteAuthority(fact) });
  }
  for (const fact of delta.removed) {
    seeds.push({ seed: factSeed('fact-removed', 'from', fact), propagates: hasDefiniteAuthority(fact) });
  }
  for (const change of delta.changed) {
    const before = requireFact(fromIndex, change.factId, 'from');
    const after = requireFact(toIndex, change.factId, 'to');
    for (const assertion of change.addedAssertions) {
      seeds.push({
        seed: assertionSeed('assertion-added', 'to', after, assertion.id),
        propagates: false
      });
    }
    for (const assertion of change.removedAssertions) {
      seeds.push({
        seed: assertionSeed('assertion-removed', 'from', before, assertion.id),
        propagates: false
      });
    }
    for (const update of change.updatedAssertions) {
      seeds.push({
        seed: assertionUpdateSeed('from', before, update.assertionId, update.changedFields),
        propagates: false
      });
      seeds.push({
        seed: assertionUpdateSeed('to', after, update.assertionId, update.changedFields),
        propagates: false
      });
    }
  }
  return seeds;
}

function addUncertainty(
  uncertainties: Map<string, UncertaintyDraft>,
  draft: UncertaintyDraft
): void {
  const key = JSON.stringify(uncertaintyIdentity(draft));
  const existing = uncertainties.get(key);
  if (!existing || draft.distance < existing.distance) {
    uncertainties.set(key, {
      ...draft,
      seedIds: uniqueSorted(draft.seedIds),
      canonicalPath: [...draft.canonicalPath]
    });
    return;
  }
  if (draft.distance > existing.distance) return;
  const seedIds = uniqueSorted([...existing.seedIds, ...draft.seedIds]);
  const path = compareSeedPaths(
    draft.canonicalSeedId,
    draft.canonicalPath,
    existing.canonicalSeedId,
    existing.canonicalPath
  ) < 0 ? [...draft.canonicalPath] : [...existing.canonicalPath];
  const useDraftPath = compareSeedPaths(
    draft.canonicalSeedId,
    draft.canonicalPath,
    existing.canonicalSeedId,
    existing.canonicalPath
  ) < 0;
  uncertainties.set(key, {
    ...existing,
    seedIds,
    canonicalSeedId: useDraftPath ? draft.canonicalSeedId : existing.canonicalSeedId,
    canonicalPath: path
  });
}

function nonDefiniteUncertainty(
  basis: ImpactBasis,
  fact: SemanticFact,
  boundaryEntityId: string,
  seedIds: readonly string[],
  canonicalSeedId: string,
  canonicalPath: readonly ImpactPathStep[]
): UncertaintyDraft {
  return {
    basis,
    classification: 'unknown',
    reasonCode: 'non-definite-authority',
    boundaryEntityId,
    factId: fact.id,
    predicate: fact.predicate,
    seedIds: [...seedIds],
    canonicalSeedId,
    canonicalPath: [...canonicalPath],
    distance: canonicalPath.length
  };
}

function edgeCandidates(
  basis: ImpactBasis,
  state: ReachState,
  index: EngineeringIRIndex,
  uncertainties: Map<string, UncertaintyDraft>
): ImpactPathStep[] {
  const candidates: ImpactPathStep[] = [];
  const outgoing = index.outgoingFactsBySubject.get(state.entityId) ?? [];
  const incoming = index.incomingFactsByEntityObject.get(state.entityId) ?? [];

  const inspectUnknown = (fact: SemanticFact): void => {
    addUncertainty(uncertainties, {
      basis,
      classification: 'unknown',
      reasonCode: 'unregistered-active-predicate',
      boundaryEntityId: state.entityId,
      factId: fact.id,
      predicate: fact.predicate,
      seedIds: state.seedIds,
      canonicalSeedId: state.canonicalSeedId,
      canonicalPath: state.canonicalPath,
      distance: state.distance
    });
  };

  for (const fact of outgoing) {
    const rule = IMPACT_PROPAGATION_RULES[fact.predicate];
    if (rule.action === 'unknown') {
      inspectUnknown(fact);
      continue;
    }
    if (rule.action === 'value-stop') {
      if (hasDefiniteAuthority(fact)) {
        addUncertainty(uncertainties, {
          basis,
          classification: 'unknown',
          reasonCode: 'value-object-boundary',
          boundaryEntityId: state.entityId,
          factId: fact.id,
          predicate: fact.predicate,
          seedIds: state.seedIds,
          canonicalSeedId: state.canonicalSeedId,
          canonicalPath: state.canonicalPath,
          distance: state.distance
        });
      } else {
        addUncertainty(
          uncertainties,
          nonDefiniteUncertainty(
            basis,
            fact,
            state.entityId,
            state.seedIds,
            state.canonicalSeedId,
            state.canonicalPath
          )
        );
      }
      continue;
    }
    if (rule.action !== 'edge' || rule.direction !== 'subject-to-object') continue;
    if (fact.object.kind !== 'entity') {
      fail('IMPACT-003', `Impact edge rule "${rule.ruleVariantId}" requires an entity object`, {
        predicate: fact.predicate,
        factId: fact.id
      });
    }
    if (!hasDefiniteAuthority(fact)) {
      addUncertainty(
        uncertainties,
        nonDefiniteUncertainty(
          basis,
          fact,
          state.entityId,
          state.seedIds,
          state.canonicalSeedId,
          state.canonicalPath
        )
      );
      continue;
    }
    candidates.push({
      factId: fact.id,
      predicate: fact.predicate,
      ruleVariantId: rule.ruleVariantId,
      direction: rule.direction,
      fromEntityId: state.entityId,
      toEntityId: fact.object.entityId
    });
  }

  for (const fact of incoming) {
    const rule = IMPACT_PROPAGATION_RULES[fact.predicate];
    if (rule.action === 'unknown') {
      inspectUnknown(fact);
      continue;
    }
    if (rule.action !== 'edge' || rule.direction !== 'object-to-subject') continue;
    if (!hasDefiniteAuthority(fact)) {
      addUncertainty(
        uncertainties,
        nonDefiniteUncertainty(
          basis,
          fact,
          state.entityId,
          state.seedIds,
          state.canonicalSeedId,
          state.canonicalPath
        )
      );
      continue;
    }
    candidates.push({
      factId: fact.id,
      predicate: fact.predicate,
      ruleVariantId: rule.ruleVariantId,
      direction: rule.direction,
      fromEntityId: state.entityId,
      toEntityId: fact.subject
    });
  }
  return candidates.sort((left, right) => compareStringArrays(pathStepTuple(left), pathStepTuple(right)));
}

function mergeReachState(
  states: Map<string, ReachState>,
  entityId: string,
  candidate: ReachState
): boolean {
  const existing = states.get(entityId);
  if (!existing || candidate.distance < existing.distance) {
    states.set(entityId, candidate);
    return true;
  }
  if (candidate.distance > existing.distance) return false;
  const seedIds = uniqueSorted([...existing.seedIds, ...candidate.seedIds]);
  const betterPath = compareSeedPaths(
    candidate.canonicalSeedId,
    candidate.canonicalPath,
    existing.canonicalSeedId,
    existing.canonicalPath
  ) < 0;
  const seedsChanged = compareStringArrays(seedIds, existing.seedIds) !== 0;
  if (!betterPath && !seedsChanged) return false;
  states.set(entityId, {
    ...existing,
    seedIds,
    canonicalSeedId: betterPath ? candidate.canonicalSeedId : existing.canonicalSeedId,
    canonicalPath: betterPath ? candidate.canonicalPath : existing.canonicalPath
  });
  return true;
}

function traverseBasis(
  basis: ImpactBasis,
  seeds: readonly PropagatingSeed[],
  index: EngineeringIRIndex,
  uncertainties: Map<string, UncertaintyDraft>
): Map<string, ReachState> {
  const states = new Map<string, ReachState>();
  for (const entry of seeds) {
    if (entry.seed.basis !== basis || !entry.propagates) continue;
    const candidate: ReachState = {
      entityId: entry.seed.anchorEntityId,
      distance: 0,
      seedIds: [entry.seed.id],
      canonicalSeedId: entry.seed.id,
      canonicalPath: []
    };
    mergeReachState(states, candidate.entityId, candidate);
  }

  let frontier = [...states.keys()];
  while (frontier.length > 0) {
    frontier.sort((left, right) => {
        const leftState = states.get(left)!;
        const rightState = states.get(right)!;
        return leftState.distance - rightState.distance ||
          compareSeedPaths(
            leftState.canonicalSeedId,
            leftState.canonicalPath,
            rightState.canonicalSeedId,
            rightState.canonicalPath
          ) ||
          compareCodeUnits(left, right);
      });
    const nextFrontier = new Set<string>();
    for (const entityId of frontier) {
      const state = states.get(entityId)!;
      for (const step of edgeCandidates(basis, state, index, uncertainties)) {
        if (!index.entityById.has(step.toEntityId)) {
          fail('IMPACT-006', `Impact path references missing Entity "${step.toEntityId}"`, {
            basis,
            factId: step.factId,
            entityId: step.toEntityId
          });
        }
        const candidate: ReachState = {
          entityId: step.toEntityId,
          distance: state.distance + 1,
          seedIds: [...state.seedIds],
          canonicalSeedId: state.canonicalSeedId,
          canonicalPath: [...state.canonicalPath, step]
        };
        if (mergeReachState(states, candidate.entityId, candidate)) {
          nextFrontier.add(candidate.entityId);
        }
      }
    }
    frontier = [...nextFrontier];
  }
  return states;
}

function occurrence(basis: ImpactBasis, state: ReachState): ImpactOccurrence | undefined {
  if (state.distance === 0) return undefined;
  return {
    basis,
    entityId: state.entityId,
    level: state.distance === 1 ? 'direct' : 'transitive',
    distance: state.distance,
    seedIds: [...state.seedIds],
    canonicalPath: [...state.canonicalPath]
  };
}

function sourcesForVerification(
  seeds: readonly PropagatingSeed[],
  statesByBasis: Readonly<Record<ImpactBasis, Map<string, ReachState>>>
): ImpactSource[] {
  const sources = new Map<string, ImpactSource>();
  for (const { seed, propagates } of seeds) {
    if (
      !propagates &&
      (seed.kind === 'fact-added' || seed.kind === 'fact-removed')
    ) {
      continue;
    }
    const key = `${seed.basis}\u0000${seed.anchorEntityId}`;
    const existing = sources.get(key);
    sources.set(key, {
      basis: seed.basis,
      entityId: seed.anchorEntityId,
      level: 'seed',
      seedIds: uniqueSorted([...(existing?.seedIds ?? []), seed.id]),
      canonicalSeedId: existing === undefined
        ? seed.id
        : [existing.canonicalSeedId, seed.id].sort(compareCodeUnits)[0]!,
      canonicalPath: []
    });
  }
  for (const basis of ['from', 'to'] as const) {
    for (const state of statesByBasis[basis].values()) {
      if (state.distance === 0) continue;
      const key = `${basis}\u0000${state.entityId}`;
      if (sources.has(key)) continue;
      sources.set(key, {
        basis,
        entityId: state.entityId,
        level: state.distance === 1 ? 'direct' : 'transitive',
        seedIds: [...state.seedIds],
        canonicalSeedId: state.canonicalSeedId,
        canonicalPath: [...state.canonicalPath]
      });
    }
  }
  return [...sources.values()].sort((left, right) =>
    BASIS_RANK[left.basis] - BASIS_RANK[right.basis] ||
    SOURCE_LEVEL_RANK[left.level] - SOURCE_LEVEL_RANK[right.level] ||
    compareCodeUnits(left.entityId, right.entityId)
  );
}

function verificationReason(source: ImpactSource, factId?: string): VerificationReason {
  return {
    basis: source.basis,
    sourceEntityId: source.entityId,
    sourceLevel: source.level,
    sourceSeedIds: [...source.seedIds],
    ...(factId === undefined ? {} : { factId })
  };
}

interface RecommendationDraft {
  readonly target: VerificationRecommendation;
  readonly reasonsByKey: Map<string, VerificationReason>;
}

function addRecommendation(
  recommendations: Map<string, RecommendationDraft>,
  target: { kind: 'acceptance'; acceptanceEntityId: string } | { kind: 'selector'; selector: string },
  reason: VerificationReason
): void {
  const value = target.kind === 'acceptance'
    ? { kind: target.kind, acceptanceEntityId: target.acceptanceEntityId, reasons: [reason] } as const
    : { kind: target.kind, selector: target.selector, reasons: [reason] } as const;
  const key = `${target.kind}\u0000${verificationTarget(value)}`;
  let draft = recommendations.get(key);
  if (draft === undefined) {
    draft = { target: value, reasonsByKey: new Map() };
    recommendations.set(key, draft);
  }
  // Accumulate once per target. Rebuilding and sorting all earlier reasons on
  // every incoming mapping makes a shared verification target quadratic.
  const reasonKey = JSON.stringify([
    reason.basis,
    SOURCE_LEVEL_RANK[reason.sourceLevel],
    reason.sourceEntityId,
    reason.factId ?? '',
    reason.sourceSeedIds
  ]);
  draft.reasonsByKey.set(reasonKey, reason);
}

function selectorFromFact(fact: SemanticFact): string {
  if (
    fact.object.kind !== 'value' ||
    fact.object.value === null ||
    typeof fact.object.value !== 'object' ||
    Array.isArray(fact.object.value) ||
    typeof fact.object.value.selector !== 'string'
  ) {
    fail('IMPACT-005', `VERIFIED_BY selector Fact "${fact.id}" has an invalid target shape`, {
      factId: fact.id,
      object: fact.object
    });
  }
  return fact.object.value.selector;
}

function collectVerification(
  sources: readonly ImpactSource[],
  indexes: Readonly<Record<ImpactBasis, EngineeringIRIndex>>,
  uncertainties: Map<string, UncertaintyDraft>
): VerificationRecommendation[] {
  const recommendations = new Map<string, RecommendationDraft>();
  for (const source of sources) {
    const index = indexes[source.basis];
    const entity = index.entityById.get(source.entityId);
    if (!entity) {
      fail('IMPACT-006', `Impact verification source references missing Entity "${source.entityId}"`, {
        basis: source.basis,
        entityId: source.entityId
      });
    }
    if (entity.kind === 'acceptance') {
      addRecommendation(
        recommendations,
        { kind: 'acceptance', acceptanceEntityId: entity.id },
        verificationReason(source)
      );
      continue;
    }
    if (entity.kind !== 'scenario' && entity.kind !== 'artifact' && entity.kind !== 'policy') continue;

    const mappings = (index.outgoingFactsBySubject.get(entity.id) ?? [])
      .filter((fact) => fact.predicate === 'VERIFIED_BY');
    let runnable = false;
    let nonDefinite = false;
    for (const fact of mappings) {
      if (!hasDefiniteAuthority(fact)) {
        nonDefinite = true;
        addUncertainty(
          uncertainties,
          nonDefiniteUncertainty(
            source.basis,
            fact,
            source.entityId,
            source.seedIds,
            source.canonicalSeedId,
            source.canonicalPath
          )
        );
        continue;
      }
      if (entity.kind === 'policy') {
        if (fact.object.kind !== 'entity') {
          fail('IMPACT-005', `Policy VERIFIED_BY Fact "${fact.id}" must target a policy Entity`, {
            factId: fact.id,
            object: fact.object
          });
        }
        const target = index.entityById.get(fact.object.entityId);
        if (!target || target.kind !== 'policy') {
          fail('IMPACT-005', `Policy VERIFIED_BY Fact "${fact.id}" has an invalid target`, {
            factId: fact.id,
            targetEntityId: fact.object.entityId,
            targetKind: target?.kind ?? null
          });
        }
        addUncertainty(uncertainties, {
          basis: source.basis,
          classification: 'unknown',
          reasonCode: 'verification-mapping-non-runnable',
          boundaryEntityId: source.entityId,
          factId: fact.id,
          predicate: fact.predicate,
          seedIds: source.seedIds,
          canonicalSeedId: source.canonicalSeedId,
          canonicalPath: source.canonicalPath,
          distance: source.canonicalPath.length
        });
        continue;
      }
      if (fact.object.kind === 'entity') {
        const target = index.entityById.get(fact.object.entityId);
        if (!target || target.kind !== 'acceptance') {
          fail('IMPACT-005', `VERIFIED_BY Fact "${fact.id}" must target an Acceptance Entity`, {
            factId: fact.id,
            targetEntityId: fact.object.entityId,
            targetKind: target?.kind ?? null
          });
        }
        runnable = true;
        addRecommendation(
          recommendations,
          { kind: 'acceptance', acceptanceEntityId: target.id },
          verificationReason(source, fact.id)
        );
        continue;
      }
      if (entity.kind !== 'artifact') {
        fail('IMPACT-005', `Only Artifact VERIFIED_BY Facts can contain selector values`, {
          factId: fact.id,
          sourceEntityId: entity.id,
          sourceKind: entity.kind
        });
      }
      runnable = true;
      addRecommendation(
        recommendations,
        { kind: 'selector', selector: selectorFromFact(fact) },
        verificationReason(source, fact.id)
      );
    }
    if ((entity.kind === 'scenario' || entity.kind === 'artifact') && !runnable && !nonDefinite) {
      addUncertainty(uncertainties, {
        basis: source.basis,
        classification: 'unknown',
        reasonCode: 'verification-mapping-missing',
        boundaryEntityId: source.entityId,
        seedIds: source.seedIds,
        canonicalSeedId: source.canonicalSeedId,
        canonicalPath: source.canonicalPath,
        distance: source.canonicalPath.length
      });
    }
  }
  return [...recommendations.values()]
    .map(({ target, reasonsByKey }) => ({
      ...target,
      reasons: [...reasonsByKey.values()].sort(compareVerificationReasons)
    } as VerificationRecommendation))
    .sort(compareRecommendations);
}

function assertCanonicalOutput(
  seeds: readonly ImpactSeed[],
  direct: readonly ImpactOccurrence[],
  transitive: readonly ImpactOccurrence[],
  uncertainties: readonly ImpactUncertainty[],
  verification: readonly VerificationRecommendation[]
): void {
  const seedIds = new Set<string>();
  for (const [index, seed] of seeds.entries()) {
    if (seedIds.has(seed.id) || (index > 0 && compareSeeds(seeds[index - 1]!, seed) >= 0)) {
      fail('IMPACT-006', 'Impact seeds must be unique and canonically ordered', { seedId: seed.id });
    }
    seedIds.add(seed.id);
  }
  const occurrences = new Set<string>();
  for (const [collection, values] of [['direct', direct], ['transitive', transitive]] as const) {
    for (const [index, value] of values.entries()) {
      const key = `${value.basis}\u0000${value.entityId}`;
      const expectedLevel = value.distance === 1 ? 'direct' : 'transitive';
      if (
        occurrences.has(key) ||
        value.level !== expectedLevel ||
        value.canonicalPath.length !== value.distance ||
        (index > 0 && compareOccurrences(values[index - 1]!, value) >= 0) ||
        value.canonicalPath.at(-1)?.toEntityId !== value.entityId ||
        (collection === 'direct' ? value.distance !== 1 : value.distance < 2)
      ) {
        fail('IMPACT-006', 'Impact occurrences violate overlap, level, path, or order invariants', {
          collection,
          basis: value.basis,
          entityId: value.entityId,
          distance: value.distance
        });
      }
      occurrences.add(key);
    }
  }
  for (let index = 1; index < uncertainties.length; index += 1) {
    if (compareUncertainties(uncertainties[index - 1]!, uncertainties[index]!) >= 0) {
      fail('IMPACT-006', 'Impact uncertainties must be unique and canonically ordered', {
        previous: uncertaintyIdentity(uncertainties[index - 1]!),
        current: uncertaintyIdentity(uncertainties[index]!)
      });
    }
  }
  for (let index = 1; index < verification.length; index += 1) {
    if (compareRecommendations(verification[index - 1]!, verification[index]!) >= 0) {
      fail('IMPACT-006', 'Impact verification recommendations must be unique and canonically ordered', {
        previous: verificationTarget(verification[index - 1]!),
        current: verificationTarget(verification[index]!)
      });
    }
  }
}

function impactDigestPayload(
  value: Omit<SemanticImpactPropagation, 'impactRevision'>
): string {
  return JSON.stringify(canonicalJson({
    domain: 'engineering-ir-impact-propagation-v1',
    contractVersion: value.contractVersion,
    scope: value.scope,
    formatVersion: value.formatVersion,
    graphId: value.graphId,
    appId: value.appId,
    deltaRevision: value.deltaRevision,
    from: {
      semanticRevision: value.fromSemanticRevision,
      factSetDigest: value.fromFactSetDigest
    },
    to: {
      semanticRevision: value.toSemanticRevision,
      factSetDigest: value.toFactSetDigest
    },
    propagationRuleRevision: value.propagationRuleRevision,
    seeds: value.seeds,
    direct: value.direct,
    transitive: value.transitive,
    uncertainties: value.uncertainties,
    verification: value.verification
  }));
}

export function buildImpactPropagation(
  input: ImpactPropagationInput
): SemanticImpactPropagation {
  assertInputBinding(input);
  const delta = assertCanonicalDelta(input.delta, input.from, input.to);
  assertImpactPropagationRuleRegistry();

  const indexes: Record<ImpactBasis, EngineeringIRIndex> = {
    from: indexValidatedEngineeringIR(input.from.snapshot),
    to: indexValidatedEngineeringIR(input.to.snapshot)
  };
  const seeds = [
    ...collectEntitySeeds(input.from, input.to),
    ...collectFactSeeds(delta, indexes.from, indexes.to)
  ].sort((left, right) => compareSeeds(left.seed, right.seed));

  const uncertainties = new Map<string, UncertaintyDraft>();
  for (const entry of seeds) {
    if (entry.propagates || (entry.seed.kind !== 'fact-added' && entry.seed.kind !== 'fact-removed')) continue;
    const fact = requireFact(indexes[entry.seed.basis], entry.seed.factId, entry.seed.basis);
    addUncertainty(
      uncertainties,
      nonDefiniteUncertainty(
        entry.seed.basis,
        fact,
        entry.seed.anchorEntityId,
        [entry.seed.id],
        entry.seed.id,
        []
      )
    );
  }

  const statesByBasis = {
    from: traverseBasis('from', seeds, indexes.from, uncertainties),
    to: traverseBasis('to', seeds, indexes.to, uncertainties)
  };
  const seedAnchors = new Set(seeds.map(({ seed }) => `${seed.basis}\u0000${seed.anchorEntityId}`));
  const occurrences = (['from', 'to'] as const)
    .flatMap((basis) => [...statesByBasis[basis].values()]
      .map((state) => occurrence(basis, state))
      .filter((value): value is ImpactOccurrence =>
        value !== undefined && !seedAnchors.has(`${basis}\u0000${value.entityId}`)
      ));
  const direct = occurrences.filter((value) => value.level === 'direct').sort(compareOccurrences);
  const transitive = occurrences.filter((value) => value.level === 'transitive').sort(compareOccurrences);
  const verification = collectVerification(
    sourcesForVerification(seeds, statesByBasis),
    indexes,
    uncertainties
  );
  const uncertaintyOutput = [...uncertainties.values()]
    .map(({ distance: _distance, canonicalSeedId: _canonicalSeedId, ...value }) => value)
    .sort(compareUncertainties);
  const seedOutput = seeds.map((entry) => entry.seed);

  assertCanonicalOutput(seedOutput, direct, transitive, uncertaintyOutput, verification);
  const withoutRevision: Omit<SemanticImpactPropagation, 'impactRevision'> = {
    contractVersion: IMPACT_CONTRACT_VERSION,
    scope: IMPACT_SCOPE,
    formatVersion: input.from.snapshot.ir.formatVersion,
    graphId: input.from.snapshot.ir.graphId,
    appId: input.from.snapshot.ir.appId,
    deltaRevision: delta.deltaRevision,
    fromSemanticRevision: input.from.semanticRevision,
    toSemanticRevision: input.to.semanticRevision,
    fromFactSetDigest: delta.fromFactSetDigest,
    toFactSetDigest: delta.toFactSetDigest,
    propagationRuleRevision: IMPACT_PROPAGATION_RULE_REVISION,
    seeds: seedOutput,
    direct,
    transitive,
    uncertainties: uncertaintyOutput,
    verification
  };
  return deepFreeze({
    ...withoutRevision,
    impactRevision: `sha256:${rawSha256Hex(impactDigestPayload(withoutRevision))}`
  });
}
