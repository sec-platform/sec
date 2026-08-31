import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SourceProgramDeclaration,
  SourceProgramModel,
  SourceProgramOwnerIntentEvidence
} from './contract.ts';
import { isCompiledRepositorySourceProgramModel } from './repository.ts';

export type SourceProgramImplementationUnitKind =
  | 'contract-codec'
  | 'transition-algebra'
  | 'relation-projection'
  | 'provider-adapter'
  | 'completion-proof'
  | 'identity'
  | 'test-observation'
  | 'external-capability-candidate';

export type SourceProgramImplementationCandidateEvidenceClass =
  | 'compiler-exact'
  | 'owner-contract'
  | 'heuristic';

/**
 * Candidate discovery does not grant removal authority. A compiler- or tool-
 * supplied observation only identifies declarations that may implement one
 * semantic identity; the Source Program closes every authority frontier.
 */
export interface SourceProgramImplementationCandidateObservation {
  readonly kind: SourceProgramImplementationUnitKind;
  readonly semanticIdentity: string;
  readonly declarationObservationIds: readonly string[];
  readonly evidenceClass: SourceProgramImplementationCandidateEvidenceClass;
  readonly observationClass: 'observed' | 'unknown';
}

export type SourceProgramImplementationFrontierStatus =
  | 'closed'
  | 'present'
  | 'unknown';

export interface SourceProgramImplementationUnit {
  readonly unitId: string;
  readonly kind: SourceProgramImplementationUnitKind;
  readonly semanticIdentity: string;
  readonly candidateEvidenceClass: SourceProgramImplementationCandidateEvidenceClass;
  readonly declarationObservationId: string;
  readonly declarationDigest: string;
  readonly canonicalOwner: string | null;
  readonly producerPaths: readonly string[];
  readonly consumerPaths: readonly string[];
  readonly effectPaths: readonly string[];
  readonly frontiers: Readonly<{
    readonly producer: SourceProgramImplementationFrontierStatus;
    readonly consumer: SourceProgramImplementationFrontierStatus;
    readonly effect: SourceProgramImplementationFrontierStatus;
    readonly durable: SourceProgramImplementationFrontierStatus;
    readonly external: SourceProgramImplementationFrontierStatus;
    readonly recovery: SourceProgramImplementationFrontierStatus;
    readonly readback: SourceProgramImplementationFrontierStatus;
    readonly unknown: SourceProgramImplementationFrontierStatus;
  }>;
  readonly evidenceDigest: string;
}

export type SourceProgramImplementationDisposition =
  | 'duplicate-owner'
  | 'dominated'
  | 'orphan'
  | 'migration-required'
  | 'owner-decision-required'
  | 'unknown';

export interface SourceProgramImplementationDominanceFinding {
  readonly disposition: SourceProgramImplementationDisposition;
  readonly kind: SourceProgramImplementationUnitKind;
  readonly semanticIdentity: string;
  readonly canonicalOwner: string | null;
  readonly unitIds: readonly string[];
  readonly removableUnitIds: readonly string[];
  readonly reason: string;
  readonly evidenceDigest: string;
}

export interface SourceProgramImplementationDominanceCompilation {
  readonly sourceRevision: string;
  readonly sourceProgramModelDigest: string;
  readonly units: readonly SourceProgramImplementationUnit[];
  readonly findings: readonly SourceProgramImplementationDominanceFinding[];
  readonly compilationDigest: string;
}

function operationObligations(
  declaration: SourceProgramDeclaration,
  ownerIntents: readonly SourceProgramOwnerIntentEvidence[]
): readonly SourceProgramOwnerIntentEvidence['operationObligations'][number][] {
  const intent = ownerIntents.find(({ owner }) => owner === declaration.moduleId);
  if (intent === undefined) return Object.freeze([]);
  return Object.freeze(intent.operationObligations.filter(({ obligation }) => {
    const operation = obligation.operation;
    return operation.kind === 'capability'
      ? operation.operation === declaration.name
      : operation.path === declaration.path;
  }));
}

function frontierFromPresence(present: boolean, unknown: boolean): SourceProgramImplementationFrontierStatus {
  return unknown ? 'unknown' : present ? 'present' : 'closed';
}

function declarationOwnsSpan(
  declaration: SourceProgramDeclaration,
  path: string,
  span: Readonly<{ readonly start: number; readonly end: number }>
): boolean {
  return declaration.path === path
    && span.start >= declaration.span.start
    && span.end <= declaration.span.end;
}

function declarationIdsForPaths(
  model: SourceProgramModel,
  paths: readonly string[]
): readonly string[] {
  const pathSet = new Set(paths);
  return Object.freeze(model.declarations
    .filter(({ exported, path }) => exported && pathSet.has(path))
    .map(({ observationId }) => observationId)
    .sort(compareCodeUnits));
}

function candidate(
  kind: SourceProgramImplementationUnitKind,
  semanticIdentity: string,
  declarationObservationIds: readonly string[],
  evidenceClass: SourceProgramImplementationCandidateEvidenceClass,
  observationClass: 'observed' | 'unknown'
): SourceProgramImplementationCandidateObservation | null {
  const ids = Object.freeze([...new Set(declarationObservationIds)].sort(compareCodeUnits));
  if (ids.length === 0) return null;
  return Object.freeze({
    kind,
    semanticIdentity,
    declarationObservationIds: ids,
    evidenceClass,
    observationClass
  });
}

/**
 * Derive review candidates from the already compiled Source Program. This is
 * deliberately not a second syntax graph: compiler-exact candidates come from
 * declaration/type/capability facts, while names, literals and paths remain
 * heuristic unknowns that cannot authorize a disposition.
 */
export function compileSourceProgramImplementationCandidates(input: Readonly<{
  readonly model: SourceProgramModel;
  readonly ownerIntents: readonly SourceProgramOwnerIntentEvidence[];
}>): readonly SourceProgramImplementationCandidateObservation[] {
  if (!isCompiledRepositorySourceProgramModel(input.model)) {
    throw new Error('Implementation candidate discovery requires a compiler-issued Repository Source Program Model');
  }
  const candidates: SourceProgramImplementationCandidateObservation[] = [];
  const declarationsByDigest = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of input.model.declarations) {
    if (!declaration.exported) continue;
    const group = declarationsByDigest.get(declaration.declarationDigest) ?? [];
    group.push(declaration);
    declarationsByDigest.set(declaration.declarationDigest, group);
  }
  for (const [declarationDigest, declarations] of declarationsByDigest) {
    if (declarations.length < 2) continue;
    const observed = candidate(
      'identity',
      `exact-declaration:${declarationDigest}`,
      declarations.map(({ observationId }) => observationId),
      'compiler-exact',
      'observed'
    );
    if (observed !== null) candidates.push(observed);
  }

  for (const intent of input.ownerIntents) {
    for (const { capability, operations } of intent.capabilityEnvelope) {
      for (const operation of operations) {
        const declarations = input.model.declarations.filter((declaration) => (
          declaration.exported
          && declaration.moduleId === intent.owner
          && declaration.name === operation
        ));
        if (declarations.length === 0) continue;
        const codecLike = /(?:codec|decode|encode|parse|schema|serial|validat)/iu.test(`${capability}:${operation}`);
        if (codecLike) {
          const observed = candidate(
            'contract-codec',
            `owner-capability:${capability}:${operation}`,
            declarations.map(({ observationId }) => observationId),
            'heuristic',
            'unknown'
          );
          if (observed !== null) candidates.push(observed);
        }
      }
    }
    for (const { obligation, observation } of intent.operationObligations) {
      const operation = obligation.operation;
      if (operation.kind !== 'capability') continue;
      const declarations = input.model.declarations.filter((declaration) => (
        declaration.exported
        && declaration.moduleId === intent.owner
        && declaration.name === operation.operation
      ));
      if (declarations.length === 0) continue;
      const semanticIdentity = `operation:${operation.capability}:${operation.operation}`;
      const stateful = obligation.effect.kinds.length > 0
        || obligation.effect.recovery !== 'not-applicable'
        || obligation.evolution.migration !== 'not-required';
      if (stateful) {
        const transition = candidate(
          'transition-algebra',
          semanticIdentity,
          declarations.map(({ observationId }) => observationId),
          'owner-contract',
          observation.status === 'verified' ? 'observed' : 'unknown'
        );
        if (transition !== null) candidates.push(transition);
      }
      if (obligation.effect.kinds.length > 0) {
        const completion = candidate(
          'completion-proof',
          semanticIdentity,
          declarations.map(({ observationId }) => observationId),
          'owner-contract',
          'unknown'
        );
        if (completion !== null) candidates.push(completion);
      }
    }
  }

  for (const declaration of input.model.declarations) {
    if (!declaration.exported) continue;
    const invocations = input.model.capabilities.filter(({ path, span }) => (
      declarationOwnsSpan(declaration, path, span)
    ));
    for (const invocation of invocations) {
      if (invocation.capability === 'provider' || invocation.transport === 'repository-provider') {
        const observed = candidate(
          'provider-adapter',
          `provider:${invocation.providerCapability ?? invocation.capability}:${invocation.operation}`,
          [declaration.observationId],
          'compiler-exact',
          invocation.observationClass === 'unknown' ? 'unknown' : 'observed'
        );
        if (observed !== null) candidates.push(observed);
      }
      if (invocation.capability === 'network'
          || invocation.capability === 'process'
          || invocation.transport === 'package-api'
          || invocation.transport === 'native-runtime') {
        const observed = candidate(
          'external-capability-candidate',
          `external:${invocation.capability}:${invocation.moduleSpecifier ?? invocation.transport}:${invocation.operation}`,
          [declaration.observationId],
          'compiler-exact',
          invocation.observationClass === 'unknown' ? 'unknown' : 'observed'
        );
        if (observed !== null) candidates.push(observed);
      }
    }
  }

  for (const sourceCandidate of input.model.candidates) {
    const mapping = sourceCandidate.code === 'production-mirrors-source-path'
        || sourceCandidate.code === 'duplicate-production-source-path-owner'
      ? Object.freeze({ kind: 'relation-projection' as const, identity: `relation:${sourceCandidate.subject}` })
      : sourceCandidate.code === 'production-declaration-only-test-consumers'
        ? Object.freeze({ kind: 'test-observation' as const, identity: `test-observation:${sourceCandidate.subject}` })
        : null;
    if (mapping === null) continue;
    const observed = candidate(
      mapping.kind,
      mapping.identity,
      declarationIdsForPaths(input.model, sourceCandidate.paths),
      'heuristic',
      'unknown'
    );
    if (observed !== null) candidates.push(observed);
  }

  const deduplicated = new Map<string, SourceProgramImplementationCandidateObservation>();
  for (const observed of candidates) {
    const key = sha256(observed);
    deduplicated.set(key, observed);
  }
  return Object.freeze([...deduplicated.values()].sort((left, right) => (
    compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.semanticIdentity, right.semanticIdentity)
    || compareCodeUnits(left.declarationObservationIds.join('\0'), right.declarationObservationIds.join('\0'))
  )));
}

function compileUnit(
  model: SourceProgramModel,
  ownerIntents: readonly SourceProgramOwnerIntentEvidence[],
  candidate: SourceProgramImplementationCandidateObservation,
  declaration: SourceProgramDeclaration
): SourceProgramImplementationUnit {
  const ownerIntent = ownerIntents.find(({ owner }) => owner === declaration.moduleId);
  const exactReferences = model.references.filter(({ targetObservationId }) => (
    targetObservationId === declaration.observationId
  ));
  const unresolvedReferences = model.references.filter((reference) => (
    reference.observationClass === 'unknown'
    && reference.name === declaration.name
    && (reference.targetPath === null || reference.targetPath === declaration.path)
  ));
  const capabilities = model.capabilities.filter(({ path }) => path === declaration.path);
  const obligations = operationObligations(declaration, ownerIntents);
  const ownerIntentMissing = declaration.moduleId !== null && ownerIntent === undefined;
  const obligationUnknown = obligations.some(({ observation }) => observation.status === 'unknown');
  const pathUnknown = model.unknowns.some(({ path }) => path === declaration.path);
  const durable = obligations.some(({ obligation }) => (
    obligation.effect.kinds.includes('persistent-state')
    || obligation.evolution.migration !== 'not-required'
  ));
  const recovery = obligations.some(({ obligation }) => obligation.effect.recovery !== 'not-applicable');
  const readbackUnknown = candidate.kind === 'completion-proof';
  const external = capabilities.some(({ capability, transport }) => (
    capability === 'network'
    || capability === 'process'
    || capability === 'provider'
    || transport === 'package-api'
    || transport === 'native-runtime'
  )) || (ownerIntent?.publicEntrypointEnvelope.some(({ targetPaths }) => (
    targetPaths.includes(declaration.path)
  )) ?? false);
  const unknown = candidate.observationClass === 'unknown'
    || candidate.evidenceClass === 'heuristic'
    || declaration.moduleId === null
    || ownerIntentMissing
    || unresolvedReferences.length > 0
    || pathUnknown
    || obligationUnknown
    || capabilities.some(({ observationClass, transport }) => (
      observationClass === 'unknown' || transport === 'unknown'
    ));
  const producerPaths = Object.freeze([declaration.path]);
  const consumerPaths = Object.freeze([...new Set(exactReferences.map(({ path }) => path))]
    .sort(compareCodeUnits));
  const effectPaths = Object.freeze([...new Set(capabilities.map(({ path }) => path))]
    .sort(compareCodeUnits));
  const frontiers = Object.freeze({
    producer: 'present' as const,
    consumer: frontierFromPresence(consumerPaths.length > 0, unresolvedReferences.length > 0),
    effect: frontierFromPresence(effectPaths.length > 0, obligationUnknown),
    durable: frontierFromPresence(durable, obligationUnknown),
    external: frontierFromPresence(external, obligationUnknown),
    recovery: frontierFromPresence(recovery, obligationUnknown),
    readback: readbackUnknown ? 'unknown' as const : 'closed' as const,
    unknown: unknown ? 'present' as const : 'closed' as const
  });
  const canonical = Object.freeze({
    kind: candidate.kind,
    semanticIdentity: candidate.semanticIdentity,
    candidateEvidenceClass: candidate.evidenceClass,
    declarationObservationId: declaration.observationId,
    declarationDigest: declaration.declarationDigest,
    canonicalOwner: declaration.moduleId,
    producerPaths,
    consumerPaths,
    effectPaths,
    frontiers
  });
  const evidenceDigest = sha256(canonical);
  return Object.freeze({
    unitId: sha256({ evidenceDigest, sourceRevision: model.sourceRevision }),
    ...canonical,
    evidenceDigest
  });
}

function allRemovalFrontiersClosed(unit: SourceProgramImplementationUnit): boolean {
  return unit.frontiers.producer === 'present'
    && unit.frontiers.consumer === 'closed'
    && unit.frontiers.effect === 'closed'
    && unit.frontiers.durable === 'closed'
    && unit.frontiers.external === 'closed'
    && unit.frontiers.recovery === 'closed'
    && unit.frontiers.readback === 'closed'
    && unit.frontiers.unknown === 'closed';
}

function finding(
  disposition: SourceProgramImplementationDisposition,
  units: readonly SourceProgramImplementationUnit[],
  removableUnitIds: readonly string[],
  reason: string
): SourceProgramImplementationDominanceFinding {
  const owners = [...new Set(units.map(({ canonicalOwner }) => canonicalOwner).filter((owner) => owner !== null))]
    .sort(compareCodeUnits);
  const canonical = Object.freeze({
    disposition,
    kind: units[0]!.kind,
    semanticIdentity: units[0]!.semanticIdentity,
    canonicalOwner: owners.length === 1 ? owners[0]! : null,
    unitIds: Object.freeze(units.map(({ unitId }) => unitId).sort(compareCodeUnits)),
    removableUnitIds: Object.freeze([...removableUnitIds].sort(compareCodeUnits)),
    reason
  });
  return Object.freeze({ ...canonical, evidenceDigest: sha256(canonical) });
}

function classifyGroup(
  units: readonly SourceProgramImplementationUnit[]
): SourceProgramImplementationDominanceFinding {
  const unknown = units.some((unit) => Object.values(unit.frontiers).includes('unknown')
    || unit.frontiers.unknown !== 'closed');
  if (unknown) return finding('unknown', units, [], 'one or more authority frontiers remain unknown');

  const protectedState = units.some((unit) => (
    unit.frontiers.durable === 'present'
    || unit.frontiers.recovery === 'present'
    || unit.frontiers.effect === 'present'
    || unit.frontiers.external === 'present'
    || unit.frontiers.readback === 'present'
  ));
  if (units.length > 1 && protectedState) {
    return finding(
      'migration-required',
      units,
      [],
      'duplicate implementations touch effect, durable, recovery, or external boundaries'
    );
  }

  const owners = new Set(units.map(({ canonicalOwner }) => canonicalOwner));
  if (units.length > 1 && owners.size > 1) {
    return finding('duplicate-owner', units, [], 'one semantic identity has implementations in multiple owners');
  }

  const equivalent = new Set(units.map(({ declarationDigest }) => declarationDigest)).size === 1;
  const removable = units.filter(allRemovalFrontiersClosed);
  if (units.length > 1 && equivalent && removable.length > 0 && removable.length < units.length) {
    return finding(
      'dominated',
      units,
      removable.map(({ unitId }) => unitId),
      'an exact-equivalent implementation has no consumer or protected frontier'
    );
  }
  if (units.length === 1 && allRemovalFrontiersClosed(units[0]!)) {
    return finding('orphan', units, [units[0]!.unitId], 'the implementation has no consumer or protected frontier');
  }
  return finding(
    'owner-decision-required',
    units,
    [],
    'the source graph cannot prove a semantics-preserving dominance relation'
  );
}

/**
 * Compile candidate observations against one compiler-issued Source Program.
 * This function never edits source and never treats candidate-tool output as
 * removal authority.
 */
export function compileSourceProgramImplementationDominance(input: Readonly<{
  readonly model: SourceProgramModel;
  readonly ownerIntents: readonly SourceProgramOwnerIntentEvidence[];
}>): SourceProgramImplementationDominanceCompilation {
  if (!isCompiledRepositorySourceProgramModel(input.model)) {
    throw new Error('Implementation dominance requires a compiler-issued Repository Source Program Model');
  }
  const declarations = new Map(input.model.declarations.map((declaration) => (
    [declaration.observationId, declaration] as const
  )));
  const candidates = compileSourceProgramImplementationCandidates(input);
  const units: SourceProgramImplementationUnit[] = [];
  for (const candidate of candidates) {
    if (candidate.semanticIdentity.trim().length === 0
        || candidate.declarationObservationIds.length === 0
        || new Set(candidate.declarationObservationIds).size !== candidate.declarationObservationIds.length) {
      throw new Error('Implementation candidate observation is noncanonical');
    }
    if (candidate.evidenceClass === 'heuristic' && candidate.observationClass !== 'unknown') {
      throw new Error('Heuristic implementation candidates cannot claim observed semantics');
    }
    for (const observationId of [...candidate.declarationObservationIds].sort(compareCodeUnits)) {
      const declaration = declarations.get(observationId);
      if (declaration === undefined || !declaration.exported) {
        throw new Error(`Implementation candidate declaration is not one exported Source Program unit: ${observationId}`);
      }
      units.push(compileUnit(input.model, input.ownerIntents, candidate, declaration));
    }
  }
  units.sort((left, right) => compareCodeUnits(left.semanticIdentity, right.semanticIdentity)
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.unitId, right.unitId));
  const groups = new Map<string, SourceProgramImplementationUnit[]>();
  for (const unit of units) {
    const key = `${unit.kind}\u0000${unit.semanticIdentity}`;
    const group = groups.get(key) ?? [];
    group.push(unit);
    groups.set(key, group);
  }
  const findings = Object.freeze([...groups.values()].map((group) => classifyGroup(group))
    .sort((left, right) => compareCodeUnits(left.semanticIdentity, right.semanticIdentity)
      || compareCodeUnits(left.disposition, right.disposition)));
  const canonical = Object.freeze({
    sourceRevision: input.model.sourceRevision,
    sourceProgramModelDigest: input.model.modelDigest,
    units: Object.freeze(units),
    findings
  });
  return Object.freeze({ ...canonical, compilationDigest: sha256(canonical) });
}
