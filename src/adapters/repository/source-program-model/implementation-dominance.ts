import { compareCodeUnits, sha256 } from '../../../contracts/canonical.ts';
import type {
  SourceProgramDeclaration,
  SourceProgramModel,
  SourceProgramOperationObligationEvidence,
  SourceProgramOwnerIntentEvidence
} from './contract.ts';
import { isCompiledRepositoryModel } from './repository.ts';

type SourceProgramImplementationUnitKind =
  | 'contract-codec'
  | 'transition-algebra'
  | 'relation-projection'
  | 'provider-adapter'
  | 'completion-proof'
  | 'identity'
  | 'test-observation'
  | 'external-capability-candidate';

type SourceProgramImplementationCandidateEvidenceClass =
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

type SourceProgramImplementationFrontierStatus =
  | 'closed'
  | 'present'
  | 'unknown';

interface SourceProgramImplementationUnit {
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
    readonly migration: SourceProgramImplementationFrontierStatus;
    readonly retirement: SourceProgramImplementationFrontierStatus;
    readonly acceptedFutureObligation: SourceProgramImplementationFrontierStatus;
    readonly unknown: SourceProgramImplementationFrontierStatus;
  }>;
  readonly requiredUnmaterializedObligations: readonly SourceProgramRequiredUnmaterializedObligation[];
  readonly publicOperationEvolution: 'not-applicable' | 'verified' | 'missing' | 'unknown';
  readonly evidenceDigest: string;
}

type SourceProgramImplementationDisposition =
  | 'duplicate-owner'
  | 'dominated'
  | 'orphan'
  | 'required-unmaterialized'
  | 'migration-required'
  | 'owner-decision-required'
  | 'unknown';

export interface SourceProgramRequiredUnmaterializedObligation {
  readonly targetOwner: string;
  readonly operation: SourceProgramOperationObligationEvidence['obligation']['operation'];
  readonly acceptance: Readonly<{
    readonly consumerSupport: SourceProgramOperationObligationEvidence['obligation']['consumerSupport'];
    readonly effect: SourceProgramOperationObligationEvidence['obligation']['effect'];
    readonly resources: SourceProgramOperationObligationEvidence['obligation']['resources'];
  }>;
  readonly responsibilities: Readonly<{
    readonly evolution: SourceProgramOperationObligationEvidence['obligation']['evolution'];
    readonly futureSupport: SourceProgramOperationObligationEvidence['obligation']['futureSupport'];
  }>;
  readonly replacementDag: readonly Readonly<{
    readonly node: 'target-closure' | 'obligation-acceptance' | 'source-retirement';
    readonly owner: string;
    readonly dependsOn: readonly ('target-closure' | 'obligation-acceptance')[];
  }>[];
  readonly observation: SourceProgramOperationObligationEvidence['observation'];
  readonly evidenceDigest: string;
}

interface SourceProgramImplementationDominanceFinding {
  readonly disposition: SourceProgramImplementationDisposition;
  readonly kind: SourceProgramImplementationUnitKind;
  readonly semanticIdentity: string;
  readonly canonicalOwner: string | null;
  readonly unitIds: readonly string[];
  readonly removableUnitIds: readonly string[];
  readonly requiredUnmaterializedObligations: readonly SourceProgramRequiredUnmaterializedObligation[];
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

function operationObligationRequiresMaterialization(
  evidence: SourceProgramOperationObligationEvidence
): boolean {
  if (evidence.observation.reason === 'identity-unresolved'
      || evidence.observation.reason === 'effect-closure-unresolved') return false;
  const missingConsumers = evidence.obligation.consumerSupport.consumers.some((consumer) => (
    !evidence.observation.consumerModuleIds.includes(consumer)
  ));
  return missingConsumers
    || evidence.obligation.evolution.retirement !== 'consumer-zero'
    || evidence.obligation.futureSupport.condition !== 'explicit-owner-decision';
}

/**
 * Project one already owner-issued obligation into the exact replacement DAG
 * needed by retirement consumers. This adds no plan or authority: every
 * acceptance field is copied from the canonical operation obligation and the
 * current observation remains attached as the materialization gap.
 */
export function compileSourceProgramRequiredUnmaterializedObligations(
  declaration: SourceProgramDeclaration,
  ownerIntents: readonly SourceProgramOwnerIntentEvidence[],
  hasLiveConsumer: boolean
): readonly SourceProgramRequiredUnmaterializedObligation[] {
  if (hasLiveConsumer) return Object.freeze([]);
  const owner = ownerIntents.find(({ owner: candidate }) => candidate === declaration.moduleId);
  if (owner === undefined) return Object.freeze([]);
  return Object.freeze(operationObligations(declaration, ownerIntents)
    .filter(operationObligationRequiresMaterialization)
    .map((evidence) => {
      const canonical = Object.freeze({
        targetOwner: owner.owner,
        operation: evidence.obligation.operation,
        acceptance: Object.freeze({
          consumerSupport: evidence.obligation.consumerSupport,
          effect: evidence.obligation.effect,
          resources: evidence.obligation.resources
        }),
        responsibilities: Object.freeze({
          evolution: evidence.obligation.evolution,
          futureSupport: evidence.obligation.futureSupport
        }),
        replacementDag: Object.freeze([
          Object.freeze({
            node: 'target-closure' as const,
            owner: owner.owner,
            dependsOn: Object.freeze([])
          }),
          Object.freeze({
            node: 'obligation-acceptance' as const,
            owner: owner.owner,
            dependsOn: Object.freeze(['target-closure' as const])
          }),
          Object.freeze({
            node: 'source-retirement' as const,
            owner: owner.owner,
            dependsOn: Object.freeze(['obligation-acceptance' as const])
          })
        ]),
        observation: evidence.observation
      });
      return Object.freeze({ ...canonical, evidenceDigest: sha256(canonical) });
    })
    .sort((left, right) => compareCodeUnits(
      JSON.stringify(left.operation),
      JSON.stringify(right.operation)
    )));
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

function declarationDefersExecution(declaration: SourceProgramDeclaration): boolean {
  return declaration.kind === 'FunctionDeclaration'
    || declaration.kind === 'FunctionExpression'
    || declaration.kind === 'ArrowFunction'
    || declaration.kind === 'MethodDeclaration'
    || declaration.kind === 'Constructor'
    || declaration.kind === 'GetAccessor'
    || declaration.kind === 'SetAccessor';
}

type SourceProgramCapability = SourceProgramModel['capabilities'][number];
type SourceProgramReference = SourceProgramModel['references'][number];

type SourceProgramImplementationIndex = Readonly<{
  capabilitiesByDeclarationId: ReadonlyMap<string, readonly SourceProgramCapability[]>;
  declarationsByDigest: ReadonlyMap<string, readonly SourceProgramDeclaration[]>;
  declarationsById: ReadonlyMap<string, SourceProgramDeclaration>;
  declarationsByOwnerAndName: ReadonlyMap<string, readonly SourceProgramDeclaration[]>;
  exportedDeclarationIdsByPath: ReadonlyMap<string, readonly string[]>;
  incomingReferencesByDeclarationId: ReadonlyMap<string, readonly SourceProgramReference[]>;
  outgoingCallsByDeclarationId: ReadonlyMap<string, readonly SourceProgramReference[]>;
  ownerIntentsByOwner: ReadonlyMap<string, SourceProgramOwnerIntentEvidence>;
  pathHasUndeferredCapability: ReadonlySet<string>;
  unknownPaths: ReadonlySet<string>;
  unresolvedReferencesByName: ReadonlyMap<string, readonly SourceProgramReference[]>;
}>;

function appendMapValue<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values === undefined) map.set(key, [value]);
  else values.push(value);
}

function ownerDeclarationKey(owner: string | null, name: string): string {
  return `${owner ?? ''}\0${name}`;
}

function compileSourceProgramImplementationIndex(
  model: SourceProgramModel,
  ownerIntents: readonly SourceProgramOwnerIntentEvidence[]
): SourceProgramImplementationIndex {
  const declarationsById = new Map(model.declarations.map((declaration) => (
    [declaration.observationId, declaration] as const
  )));
  const declarationsByPath = new Map<string, SourceProgramDeclaration[]>();
  const declarationsByDigest = new Map<string, SourceProgramDeclaration[]>();
  const declarationsByOwnerAndName = new Map<string, SourceProgramDeclaration[]>();
  const exportedDeclarationIdsByPath = new Map<string, string[]>();
  for (const declaration of model.declarations) {
    appendMapValue(declarationsByPath, declaration.path, declaration);
    if (!declaration.exported) continue;
    appendMapValue(declarationsByDigest, declaration.declarationDigest, declaration);
    appendMapValue(
      declarationsByOwnerAndName,
      ownerDeclarationKey(declaration.moduleId, declaration.name),
      declaration
    );
    appendMapValue(exportedDeclarationIdsByPath, declaration.path, declaration.observationId);
  }

  const capabilitiesByDeclarationId = new Map<string, SourceProgramCapability[]>();
  const pathHasUndeferredCapability = new Set<string>();
  for (const capability of model.capabilities) {
    let deferred = false;
    for (const declaration of declarationsByPath.get(capability.path) ?? []) {
      if (!declarationOwnsSpan(declaration, capability.path, capability.span)) continue;
      appendMapValue(capabilitiesByDeclarationId, declaration.observationId, capability);
      if (declarationDefersExecution(declaration)) deferred = true;
    }
    if (!deferred) pathHasUndeferredCapability.add(capability.path);
  }

  const incomingReferencesByDeclarationId = new Map<string, SourceProgramReference[]>();
  const outgoingCallsByDeclarationId = new Map<string, SourceProgramReference[]>();
  const unresolvedReferencesByName = new Map<string, SourceProgramReference[]>();
  for (const reference of model.references) {
    if (reference.targetObservationId !== null) {
      appendMapValue(incomingReferencesByDeclarationId, reference.targetObservationId, reference);
    }
    if (reference.observationClass === 'unknown') {
      appendMapValue(unresolvedReferencesByName, reference.name, reference);
    }
    if (reference.kind !== 'call' && reference.kind !== 'construct') continue;
    for (const declaration of declarationsByPath.get(reference.path) ?? []) {
      if (declarationOwnsSpan(declaration, reference.path, reference.span)) {
        appendMapValue(outgoingCallsByDeclarationId, declaration.observationId, reference);
      }
    }
  }

  const freezeValues = <K, V>(map: Map<K, V[]>): ReadonlyMap<K, readonly V[]> => {
    for (const [key, values] of map) map.set(key, Object.freeze(values) as V[]);
    return map;
  };
  return Object.freeze({
    capabilitiesByDeclarationId: freezeValues(capabilitiesByDeclarationId),
    declarationsByDigest: freezeValues(declarationsByDigest),
    declarationsById,
    declarationsByOwnerAndName: freezeValues(declarationsByOwnerAndName),
    exportedDeclarationIdsByPath: freezeValues(exportedDeclarationIdsByPath),
    incomingReferencesByDeclarationId: freezeValues(incomingReferencesByDeclarationId),
    outgoingCallsByDeclarationId: freezeValues(outgoingCallsByDeclarationId),
    ownerIntentsByOwner: new Map(ownerIntents.map((intent) => [intent.owner, intent] as const)),
    pathHasUndeferredCapability,
    unknownPaths: new Set(model.unknowns.map(({ path }) => path)),
    unresolvedReferencesByName: freezeValues(unresolvedReferencesByName)
  });
}

function declarationIdsForPaths(
  index: SourceProgramImplementationIndex,
  paths: readonly string[]
): readonly string[] {
  return Object.freeze([...new Set(paths.flatMap((path) => (
    index.exportedDeclarationIdsByPath.get(path) ?? []
  )))].sort(compareCodeUnits));
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
function compileSourceProgramImplementationCandidatesWithIndex(input: Readonly<{
  readonly model: SourceProgramModel;
  readonly ownerIntents: readonly SourceProgramOwnerIntentEvidence[];
}>, index: SourceProgramImplementationIndex): readonly SourceProgramImplementationCandidateObservation[] {
  const candidates: SourceProgramImplementationCandidateObservation[] = [];
  const ownerBoundDeclarationIds = new Set<string>();
  for (const intent of input.ownerIntents) {
    for (const { operations } of intent.capabilityEnvelope) {
      for (const operation of operations) {
        for (const declaration of index.declarationsByOwnerAndName.get(
          ownerDeclarationKey(intent.owner, operation)
        ) ?? []) {
          ownerBoundDeclarationIds.add(declaration.observationId);
        }
      }
    }
  }
  for (const declarations of index.declarationsByDigest.values()) {
    if (declarations.length < 2) continue;
    const declarationObservationIds = declarations
      .filter(({ observationId }) => !ownerBoundDeclarationIds.has(observationId))
      .map(({ observationId }) => observationId);
    if (declarationObservationIds.length === 0) continue;
    const observed = candidate(
      'identity',
      `unbound-responsibility:${sha256(declarationObservationIds.slice().sort(compareCodeUnits))}`,
      declarationObservationIds,
      'heuristic',
      'unknown'
    );
    if (observed !== null) candidates.push(observed);
  }

  for (const intent of input.ownerIntents) {
    for (const { capability, operations } of intent.capabilityEnvelope) {
      for (const operation of operations) {
        const declarations = index.declarationsByOwnerAndName.get(
          ownerDeclarationKey(intent.owner, operation)
        ) ?? [];
        if (declarations.length === 0) continue;
        const identity = candidate(
          'identity',
          `provider-operation:${capability}:${operation}`,
          declarations.map(({ observationId }) => observationId),
          'owner-contract',
          'observed'
        );
        if (identity !== null) candidates.push(identity);
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
      const declarations = index.declarationsByOwnerAndName.get(
        ownerDeclarationKey(intent.owner, operation.operation)
      ) ?? [];
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
    const invocations = index.capabilitiesByDeclarationId.get(declaration.observationId) ?? [];
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
      declarationIdsForPaths(index, sourceCandidate.paths),
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

export function compileSourceProgramImplementationCandidates(input: Readonly<{
  readonly model: SourceProgramModel;
  readonly ownerIntents: readonly SourceProgramOwnerIntentEvidence[];
}>): readonly SourceProgramImplementationCandidateObservation[] {
  if (!isCompiledRepositoryModel(input.model)) {
    throw new Error('Implementation candidate discovery requires a compiler-issued Repository Source Program Model');
  }
  const index = compileSourceProgramImplementationIndex(input.model, input.ownerIntents);
  return compileSourceProgramImplementationCandidatesWithIndex(input, index);
}

function compileDeclarationCapabilityClosure(
  index: SourceProgramImplementationIndex,
  root: SourceProgramDeclaration
): Readonly<{
  readonly capabilities: readonly SourceProgramModel['capabilities'][number][];
  readonly unknown: boolean;
}> {
  const visited = new Set<string>();
  const pending = [root.observationId];
  const capabilities = new Map<string, SourceProgramModel['capabilities'][number]>();
  let unknown = false;

  while (pending.length > 0) {
    const observationId = pending.pop()!;
    if (visited.has(observationId)) continue;
    visited.add(observationId);
    const declaration = index.declarationsById.get(observationId);
    if (declaration === undefined) {
      unknown = true;
      continue;
    }
    for (const invocation of index.capabilitiesByDeclarationId.get(observationId) ?? []) {
      capabilities.set(sha256(invocation), invocation);
      if (invocation.observationClass === 'unknown' || invocation.transport === 'unknown') unknown = true;
    }
    for (const reference of index.outgoingCallsByDeclarationId.get(observationId) ?? []) {
      if (reference.observationClass === 'unknown' || reference.targetObservationId === null) {
        unknown = true;
        continue;
      }
      pending.push(reference.targetObservationId);
    }
  }

  const closurePaths = new Set([...visited]
    .map((observationId) => index.declarationsById.get(observationId)?.path)
    .filter((path): path is string => path !== undefined));
  for (const path of closurePaths) {
    if (index.pathHasUndeferredCapability.has(path)) unknown = true;
  }

  return Object.freeze({
    capabilities: Object.freeze([...capabilities.values()].sort((left, right) => (
      compareCodeUnits(left.path, right.path)
      || left.span.start - right.span.start
      || left.span.end - right.span.end
    ))),
    unknown
  });
}

function compileUnit(
  model: SourceProgramModel,
  ownerIntents: readonly SourceProgramOwnerIntentEvidence[],
  index: SourceProgramImplementationIndex,
  candidate: SourceProgramImplementationCandidateObservation,
  declaration: SourceProgramDeclaration
): SourceProgramImplementationUnit {
  const ownerIntent = declaration.moduleId === null
    ? undefined
    : index.ownerIntentsByOwner.get(declaration.moduleId);
  const exactReferences = index.incomingReferencesByDeclarationId.get(declaration.observationId) ?? [];
  const unresolvedReferences = (index.unresolvedReferencesByName.get(declaration.name) ?? []).filter((reference) => (
    reference.targetPath === null || reference.targetPath === declaration.path
  ));
  const capabilityClosure = compileDeclarationCapabilityClosure(index, declaration);
  const capabilities = capabilityClosure.capabilities;
  const obligations = operationObligations(declaration, ownerIntents);
  const ownerContractPublicOperation = candidate.kind === 'identity'
    && candidate.evidenceClass === 'owner-contract';
  const hasLiveConsumer = exactReferences.length > 0;
  const requiredUnmaterializedObligations = compileSourceProgramRequiredUnmaterializedObligations(
    declaration,
    ownerIntents,
    hasLiveConsumer
  );
  const ownerIntentMissing = declaration.moduleId !== null && ownerIntent === undefined;
  const obligationUnknown = obligations.some(({ observation }) => observation.status === 'unknown');
  const publicOperationEvolution = !ownerContractPublicOperation
    ? 'not-applicable' as const
    : obligations.length === 0
      ? 'missing' as const
      : obligationUnknown
        ? 'unknown' as const
        : 'verified' as const;
  const pathUnknown = index.unknownPaths.has(declaration.path);
  const durable = obligations.some(({ obligation }) => (
    obligation.effect.kinds.includes('persistent-state')
    || obligation.evolution.migration !== 'not-required'
  ));
  const recovery = obligations.some(({ obligation }) => obligation.effect.recovery !== 'not-applicable');
  const migration = obligations.some(({ obligation }) => obligation.evolution.migration !== 'not-required');
  const retirement = obligations.some(({ obligation }) => obligation.evolution.retirement !== 'consumer-zero');
  const acceptedFutureObligation = obligations.some(({ obligation }) => (
    obligation.futureSupport.condition !== 'explicit-owner-decision'
  ));
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
    || capabilityClosure.unknown
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
    effect: frontierFromPresence(effectPaths.length > 0, obligationUnknown || capabilityClosure.unknown),
    durable: frontierFromPresence(durable, obligationUnknown),
    external: frontierFromPresence(external, obligationUnknown),
    recovery: frontierFromPresence(recovery, obligationUnknown),
    readback: readbackUnknown ? 'unknown' as const : 'closed' as const,
    migration: frontierFromPresence(migration, obligationUnknown),
    retirement: frontierFromPresence(retirement, obligationUnknown),
    acceptedFutureObligation: frontierFromPresence(acceptedFutureObligation, obligationUnknown),
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
    frontiers,
    requiredUnmaterializedObligations,
    publicOperationEvolution
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
    && unit.frontiers.migration === 'closed'
    && unit.frontiers.retirement === 'closed'
    && unit.frontiers.acceptedFutureObligation === 'closed'
    && unit.frontiers.unknown === 'closed'
    && (unit.publicOperationEvolution === 'not-applicable'
      || unit.publicOperationEvolution === 'verified');
}

function finding(
  disposition: SourceProgramImplementationDisposition,
  units: readonly SourceProgramImplementationUnit[],
  removableUnitIds: readonly string[],
  reason: string,
  requiredUnmaterializedObligations: readonly SourceProgramRequiredUnmaterializedObligation[] = []
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
    requiredUnmaterializedObligations: Object.freeze([...requiredUnmaterializedObligations]
      .sort((left, right) => compareCodeUnits(left.evidenceDigest, right.evidenceDigest))),
    reason
  });
  return Object.freeze({ ...canonical, evidenceDigest: sha256(canonical) });
}

function classifyGroup(
  units: readonly SourceProgramImplementationUnit[]
): SourceProgramImplementationDominanceFinding {
  const protectedState = units.some((unit) => (
    unit.frontiers.durable === 'present'
    || unit.frontiers.recovery === 'present'
    || unit.frontiers.effect === 'present'
    || unit.frontiers.external === 'present'
    || unit.frontiers.readback === 'present'
    || unit.frontiers.migration === 'present'
  ));
  const requiredUnmaterializedObligations = units.flatMap((unit) => (
    unit.requiredUnmaterializedObligations
  ));
  if (!protectedState && requiredUnmaterializedObligations.length > 0) {
    return finding(
      'required-unmaterialized',
      units,
      [],
      'an owner-issued operation obligation has no live consumer closure and must reach acceptance before source retirement',
      requiredUnmaterializedObligations
    );
  }

  const unknown = units.some((unit) => Object.values(unit.frontiers).includes('unknown')
    || unit.frontiers.unknown !== 'closed'
    || unit.publicOperationEvolution === 'unknown');
  if (unknown) return finding('unknown', units, [], 'one or more authority frontiers remain unknown');

  if (units.some(({ publicOperationEvolution }) => publicOperationEvolution === 'missing')) {
    return finding(
      'owner-decision-required',
      units,
      [],
      'an owner-declared public capability operation has no exact evolution obligation'
    );
  }

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

  const responsibilityBound = units.every((unit) => (
    unit.candidateEvidenceClass === 'owner-contract'
    || (unit.kind === 'provider-adapter' && unit.canonicalOwner !== null)
  ));
  const equivalent = responsibilityBound
    && new Set(units.map(({ declarationDigest }) => declarationDigest)).size === 1;
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
  if (!isCompiledRepositoryModel(input.model)) {
    throw new Error('Implementation dominance requires a compiler-issued Repository Source Program Model');
  }
  const index = compileSourceProgramImplementationIndex(input.model, input.ownerIntents);
  const candidates = compileSourceProgramImplementationCandidatesWithIndex(input, index);
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
      const declaration = index.declarationsById.get(observationId);
      if (declaration === undefined || !declaration.exported) {
        throw new Error(`Implementation candidate declaration is not one exported Source Program unit: ${observationId}`);
      }
      units.push(compileUnit(input.model, input.ownerIntents, index, candidate, declaration));
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
