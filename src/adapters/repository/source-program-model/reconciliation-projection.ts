import {
  compareCodeUnits,
  deepFreeze,
  sha256
} from '../../../contracts/canonical.ts';
import {
  compileRepositoryModuleArchitectureProjection,
  type ModuleCausalRelationKind,
  type ModuleOperationRole,
  type RepositoryModuleArchitectureProjection,
  type RepositoryModuleBoundaryViolation,
  type RepositoryModuleEdgeWitness,
  type RepositoryModuleFileStrongComponent,
  type RepositoryModuleMembership,
  type RepositoryModuleOwnerEdge,
  type RepositoryModuleReciprocalPair,
  type RepositoryModuleStrongComponent
} from '../architecture/contract.ts';
import {
  sourceProgramSurfaceForPath,
  type SourceProgramDeclaration,
  type SourceProgramModel,
  type SourceProgramReference
} from './contract.ts';
import { compileSourceProgramRequiredUnmaterializedObligations } from './implementation-dominance.ts';
import { compareSourceProgramDeclarations as declarationOrder, pairSourceProgramDeclarations } from './reconciliation-declarations.ts';
import { compileSourceProgramFindingDelta, type SourceProgramFindingDelta } from './reconciliation-findings.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import { compileOwnerIntentEvidence } from './repository.ts';

type SourceProgramReconciliationBinding = Readonly<{
  before: RepositorySourceProgramCompilationReceipt;
  after: RepositorySourceProgramCompilationReceipt;
}>;

const sourceProgramReconciliationBindings =
  new WeakMap<SourceProgramReconciliationProjection, SourceProgramReconciliationBinding>();

const SOURCE_PROGRAM_RECONCILIATION_PHASES = Object.freeze([
  'consumer',
  'producer',
  'parser',
  'writer',
  'effect',
  'terminal',
  'readback',
  'recovery',
  'facade',
  'registration',
  'test',
  'retirement'
] as const);

type SourceProgramReconciliationPhase =
  (typeof SOURCE_PROGRAM_RECONCILIATION_PHASES)[number];

export type SourceProgramReconciliationProviderEvidence = Readonly<{
  provider: string;
  status: 'observed' | 'unresolved';
  providerRevision: string | null;
  configDigest: `sha256:${string}` | null;
  inputDigest: `sha256:${string}` | null;
  candidateDigest: `sha256:${string}` | null;
}>;

type SourceProgramReconciliationReasonCode =
  | 'candidate-provider-evidence-invalid'
  | 'candidate-provider-evidence-unresolved'
  | 'changed-declaration-owner-relation-unresolved'
  | 'changed-path-source-program-unknown'
  | 'finding-disappearance-unobserved'
  | 'source-program-observation-coverage-regressed'
  | 'source-program-observation-outside-snapshot'
  | 'consumer-frontier-removed-without-retirement'
  | 'effect-terminal-unresolved'
  | 'effect-readback-unresolved'
  | 'effect-test-observation-unresolved'
  | 'durable-recovery-unresolved'
  | 'frontier-phase-missing'
  | 'module-responsibility-duplicate-owner'
  | 'module-responsibility-owner-transition-unresolved'
  | 'module-responsibility-symbol-unresolved'
  | 'production-layout-policy-unowned'
  | 'retirement-consumer-frontier-not-empty'
  | 'retirement-unresolved';

type SourceProgramReconciliationReason = Readonly<{
  code: SourceProgramReconciliationReasonCode;
  subject: string;
  paths: readonly string[];
  detailDigest: `sha256:${string}`;
}>;

type SourceProgramReconciliationDeclarationChange = Readonly<{
  changeId: `sha256:${string}`;
  kind: 'added' | 'modified' | 'moved' | 'removed' | 'renamed' | 'reexported';
  subjects: readonly string[];
  before: SourceProgramReconciliationDeclarationAddress | null;
  after: SourceProgramReconciliationDeclarationAddress | null;
  beforeConsumerPaths: readonly string[];
  afterConsumerPaths: readonly string[];
}>;

type SourceProgramReconciliationDeclarationAddress = Readonly<{
  observationId: string;
  declarationDigest: string;
  moduleId: string | null;
  path: string;
  name: string;
  kind: string;
  exported: boolean;
}>;

type SourceProgramReconciliationFrontier = Readonly<{
  subject: string;
  ownerModuleIds: readonly string[];
  changeIds: readonly `sha256:${string}`[];
  beforePhases: readonly SourceProgramReconciliationPhase[];
  afterPhases: readonly SourceProgramReconciliationPhase[];
  beforeConsumerPaths: readonly string[];
  afterConsumerPaths: readonly string[];
  frontierDigest: `sha256:${string}`;
}>;

export type SourceProgramReconciliationProjection = Readonly<{
  status: 'resolved' | 'unresolved';
  before: Readonly<{
    sourceRevision: string;
    modelDigest: string;
    compilationReceiptDigest: `sha256:${string}`;
  }>;
  after: Readonly<{
    sourceRevision: string;
    modelDigest: string;
    compilationReceiptDigest: `sha256:${string}`;
  }>;
  changes: readonly SourceProgramReconciliationDeclarationChange[];
  findingDelta: SourceProgramFindingDelta;
  frontiers: readonly SourceProgramReconciliationFrontier[];
  providerEvidence: readonly SourceProgramReconciliationProviderEvidence[];
  unresolvedReasons: readonly SourceProgramReconciliationReason[];
  projectionDigest: `sha256:${string}`;
}>;

export type CompileSourceProgramReconciliationProjectionInput = Readonly<{
  before: RepositorySourceProgramCompilationReceipt;
  after: RepositorySourceProgramCompilationReceipt;
  providerEvidence?: readonly SourceProgramReconciliationProviderEvidence[];
}>;

const issuedSourceProgramReconciliationProjections = new WeakSet<object>();

function assertSourceProgramReconciliationProjection(
  value: SourceProgramReconciliationProjection
): void {
  if (!issuedSourceProgramReconciliationProjections.has(value)) {
    throw new Error('Architecture evolution requires one compiler-issued reconciliation projection');
  }
}

type BoundRelation = Readonly<{
  subject: string;
  relation: ModuleCausalRelationKind;
  ownerModuleId: string;
  declaration: SourceProgramDeclaration | null;
  path: string;
  name: string;
}>;

type BoundRole = Readonly<{
  semanticOperation: string;
  role: ModuleOperationRole;
  ownerModuleId: string;
  declaration: SourceProgramDeclaration | null;
}>;

type ReconciliationModelIndex = Readonly<{
  declarationByObservationId: ReadonlyMap<string, SourceProgramDeclaration>;
  declarationsByModuleName: ReadonlyMap<string, readonly SourceProgramDeclaration[]>;
  declarationsByPathName: ReadonlyMap<string, readonly SourceProgramDeclaration[]>;
  consumerPathsByTarget: ReadonlyMap<string, readonly string[]>;
  referencesByTarget: ReadonlyMap<string, readonly SourceProgramReference[]>;
  referencesBySource: ReadonlyMap<string, readonly SourceProgramReference[]>;
  moduleInitializationReferencesByPath: ReadonlyMap<string, readonly SourceProgramReference[]>;
}>;

function declarationAddress(
  declaration: SourceProgramDeclaration
): SourceProgramReconciliationDeclarationAddress {
  return Object.freeze({
    observationId: declaration.observationId,
    declarationDigest: declaration.declarationDigest,
    moduleId: declaration.moduleId,
    path: declaration.path,
    name: declaration.name,
    kind: declaration.kind,
    exported: declaration.exported
  });
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareCodeUnits));
}

function reconciliationModelIndex(model: SourceProgramModel): ReconciliationModelIndex {
  const declarationByObservationId = new Map<string, SourceProgramDeclaration>();
  const declarationsByModuleName = new Map<string, SourceProgramDeclaration[]>();
  const declarationsByPathName = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of model.declarations) {
    declarationByObservationId.set(declaration.observationId, declaration);
    const pathNameKey = `${declaration.path}\0${declaration.name}`;
    const pathNameGroup = declarationsByPathName.get(pathNameKey) ?? [];
    pathNameGroup.push(declaration);
    declarationsByPathName.set(pathNameKey, pathNameGroup);
    if (!declaration.exported) continue;
    const moduleNameKey = `${declaration.moduleId ?? ''}\0${declaration.name}`;
    const moduleNameGroup = declarationsByModuleName.get(moduleNameKey) ?? [];
    moduleNameGroup.push(declaration);
    declarationsByModuleName.set(moduleNameKey, moduleNameGroup);
  }
  const consumerPathsByTarget = new Map<string, Set<string>>();
  const referencesByTarget = new Map<string, SourceProgramReference[]>();
  const referencesBySource = new Map<string, SourceProgramReference[]>();
  const moduleInitializationReferencesByPath = new Map<string, SourceProgramReference[]>();
  for (const reference of model.references) {
    if (reference.sourceObservationId === null) {
      const moduleReferences = moduleInitializationReferencesByPath.get(reference.path) ?? [];
      moduleReferences.push(reference);
      moduleInitializationReferencesByPath.set(reference.path, moduleReferences);
    } else {
      const sourceReferences = referencesBySource.get(reference.sourceObservationId) ?? [];
      sourceReferences.push(reference);
      referencesBySource.set(reference.sourceObservationId, sourceReferences);
    }
    if (reference.targetObservationId === null) continue;
    const consumerPaths = consumerPathsByTarget.get(reference.targetObservationId) ?? new Set<string>();
    consumerPaths.add(reference.path);
    consumerPathsByTarget.set(reference.targetObservationId, consumerPaths);
    const targetReferences = referencesByTarget.get(reference.targetObservationId) ?? [];
    targetReferences.push(reference);
    referencesByTarget.set(reference.targetObservationId, targetReferences);
  }
  return Object.freeze({
    declarationByObservationId,
    declarationsByModuleName: new Map([...declarationsByModuleName].map(([key, declarations]) => (
      [key, Object.freeze(declarations)] as const
    ))),
    declarationsByPathName: new Map([...declarationsByPathName].map(([key, declarations]) => (
      [key, Object.freeze(declarations)] as const
    ))),
    consumerPathsByTarget: new Map([...consumerPathsByTarget].map(([key, paths]) => (
      [key, sortedUnique(paths)] as const
    ))),
    referencesByTarget: new Map([...referencesByTarget].map(([key, references]) => (
      [key, Object.freeze(references)] as const
    ))),
    referencesBySource: new Map([...referencesBySource].map(([key, references]) => (
      [key, Object.freeze(references)] as const
    ))),
    moduleInitializationReferencesByPath: new Map(
      [...moduleInitializationReferencesByPath].map(([key, references]) => (
        [key, Object.freeze(references)] as const
      ))
    )
  });
}

function relationPhase(
  relation: ModuleCausalRelationKind
): SourceProgramReconciliationPhase | null {
  switch (relation) {
    case 'declares':
    case 'produces': return 'producer';
    case 'parses': return 'parser';
    case 'writes': return 'writer';
    case 'executes': return 'effect';
    case 'settles': return 'terminal';
    case 'reads-back': return 'readback';
    case 'recovers': return 'recovery';
    case 'projects': return 'facade';
    case 'retires': return 'retirement';
    default: return null;
  }
}

function rolePhase(role: ModuleOperationRole): SourceProgramReconciliationPhase | null {
  switch (role) {
    case 'durable-worker': return 'writer';
    case 'provider-settlement-issuer':
    case 'terminal-issuer': return 'terminal';
    case 'readback-issuer': return 'readback';
    case 'recovery-issuer': return 'recovery';
    case 'registration-issuer': return 'registration';
    default: return null;
  }
}

function bindRelations(
  index: ReconciliationModelIndex,
  membership: RepositoryModuleMembership
): readonly BoundRelation[] {
  const relations: BoundRelation[] = [];
  for (const descriptor of membership.descriptors) {
    for (const relation of descriptor.causalRelations) {
      const matches = index.declarationsByPathName.get(
        `${relation.symbol.path}\0${relation.symbol.name}`
      ) ?? [];
      relations.push(Object.freeze({
        subject: relation.subject,
        relation: relation.relation,
        ownerModuleId: descriptor.moduleId,
        declaration: matches.length === 1 ? matches[0]! : null,
        path: relation.symbol.path,
        name: relation.symbol.name
      }));
    }
  }
  return Object.freeze(relations.sort((left, right) => compareCodeUnits(
    `${left.subject}\0${left.relation}\0${left.ownerModuleId}\0${left.path}\0${left.name}`,
    `${right.subject}\0${right.relation}\0${right.ownerModuleId}\0${right.path}\0${right.name}`
  )));
}

function bindRoles(
  index: ReconciliationModelIndex,
  membership: RepositoryModuleMembership
): readonly BoundRole[] {
  const roles: BoundRole[] = [];
  for (const descriptor of membership.descriptors) {
    for (const provider of descriptor.capabilityProviders) {
      for (const binding of provider.operationRoles) {
        const matches = index.declarationsByModuleName.get(
          `${descriptor.moduleId}\0${binding.operation}`
        ) ?? [];
        roles.push(Object.freeze({
          semanticOperation: binding.semanticOperation,
          role: binding.role,
          ownerModuleId: descriptor.moduleId,
          declaration: matches.length === 1 ? matches[0]! : null
        }));
      }
    }
  }
  return Object.freeze(roles.sort((left, right) => compareCodeUnits(
    `${left.semanticOperation}\0${left.role}\0${left.ownerModuleId}`,
    `${right.semanticOperation}\0${right.role}\0${right.ownerModuleId}`
  )));
}

function consumerPaths(
  index: ReconciliationModelIndex,
  declaration: SourceProgramDeclaration
): readonly string[] {
  return index.consumerPathsByTarget.get(declaration.observationId) ?? Object.freeze([]);
}

function transitiveConsumerPaths(
  index: ReconciliationModelIndex,
  declaration: SourceProgramDeclaration
): readonly string[] {
  const paths = new Set<string>();
  const visited = new Set<string>([declaration.observationId]);
  const pending = [declaration.observationId];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const targetObservationId = pending[cursor]!;
    for (const reference of index.referencesByTarget.get(targetObservationId) ?? []) {
      paths.add(reference.path);
      if (reference.sourceObservationId === null
          || visited.has(reference.sourceObservationId)) continue;
      visited.add(reference.sourceObservationId);
      pending.push(reference.sourceObservationId);
    }
  }
  return sortedUnique(paths);
}

function transitiveDependencyPaths(
  index: ReconciliationModelIndex,
  references: readonly SourceProgramReference[]
): readonly string[] {
  const paths = new Set<string>();
  const visited = new Set<string>();
  const pending = [...references];
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const reference = pending[cursor]!;
    if (reference.targetPath !== null) paths.add(reference.targetPath);
    if (reference.targetObservationId === null
        || visited.has(reference.targetObservationId)) continue;
    visited.add(reference.targetObservationId);
    for (const next of index.referencesBySource.get(reference.targetObservationId) ?? []) pending.push(next);
  }
  return sortedUnique(paths);
}

function referenceIdentity(
  reference: SourceProgramReference,
  index: ReconciliationModelIndex
): string {
  const target = reference.targetObservationId === null
    ? null
    : index.declarationByObservationId.get(reference.targetObservationId) ?? null;
  return `${reference.kind}\0${reference.path}\0${reference.name}\0${target?.moduleId ?? ''}\0${target?.name ?? ''}`;
}

function reexportIdentity(
  index: ReconciliationModelIndex,
  declaration: SourceProgramDeclaration
): readonly string[] {
  return sortedUnique((index.referencesByTarget.get(declaration.observationId) ?? [])
    .filter(({ kind }) => kind === 'reexport')
    .map((reference) => referenceIdentity(reference, index)));
}

function compileChanges(
  before: SourceProgramModel,
  after: SourceProgramModel,
  beforeIndex: ReconciliationModelIndex,
  afterIndex: ReconciliationModelIndex,
  beforeRelations: readonly BoundRelation[],
  afterRelations: readonly BoundRelation[]
): readonly SourceProgramReconciliationDeclarationChange[] {
  const pairs = pairSourceProgramDeclarations(before.declarations, after.declarations,
    beforeRelations, afterRelations);
  const pairedAfterIds = new Set([...pairs.values()].map(({ after: declaration }) => declaration.observationId));
  const subjectsFor = (
    declaration: SourceProgramDeclaration | null,
    relations: readonly BoundRelation[]
  ): readonly string[] => declaration === null ? Object.freeze([]) : sortedUnique(relations
    .filter((relation) => relation.declaration?.observationId === declaration.observationId)
    .map(({ subject }) => subject));
  const changes: SourceProgramReconciliationDeclarationChange[] = [];
  const push = (
    kind: SourceProgramReconciliationDeclarationChange['kind'],
    beforeDeclaration: SourceProgramDeclaration | null,
    afterDeclaration: SourceProgramDeclaration | null
  ): void => {
    const beforeConsumers = beforeDeclaration === null
      ? Object.freeze([]) : consumerPaths(beforeIndex, beforeDeclaration);
    const afterConsumers = afterDeclaration === null
      ? Object.freeze([]) : consumerPaths(afterIndex, afterDeclaration);
    const canonical = {
      kind,
      before: beforeDeclaration === null ? null : declarationAddress(beforeDeclaration),
      after: afterDeclaration === null ? null : declarationAddress(afterDeclaration),
      beforeConsumerPaths: beforeConsumers,
      afterConsumerPaths: afterConsumers
    };
    changes.push(Object.freeze({
      changeId: sha256(canonical) as `sha256:${string}`,
      kind,
      subjects: sortedUnique([
        ...subjectsFor(beforeDeclaration, beforeRelations),
        ...subjectsFor(afterDeclaration, afterRelations)
      ]),
      before: canonical.before,
      after: canonical.after,
      beforeConsumerPaths: beforeConsumers,
      afterConsumerPaths: afterConsumers
    }));
  };
  for (const beforeDeclaration of before.declarations) {
    const pair = pairs.get(beforeDeclaration.observationId);
    if (pair === undefined) {
      push('removed', beforeDeclaration, null);
      continue;
    }
    const afterDeclaration = pair.after;
    const beforeReexports = reexportIdentity(beforeIndex, beforeDeclaration);
    const afterReexports = reexportIdentity(afterIndex, afterDeclaration);
    const beforeConsumers = consumerPaths(beforeIndex, beforeDeclaration);
    const afterConsumers = consumerPaths(afterIndex, afterDeclaration);
    const kind = beforeDeclaration.name !== afterDeclaration.name
      ? 'renamed' as const
      : beforeDeclaration.path !== afterDeclaration.path
        ? 'moved' as const
        : sha256(beforeReexports) !== sha256(afterReexports)
          ? 'reexported' as const
          : beforeDeclaration.exported !== afterDeclaration.exported
            || beforeDeclaration.declarationDigest !== afterDeclaration.declarationDigest
            || sha256(beforeConsumers) !== sha256(afterConsumers)
            ? 'modified' as const
            : null;
    if (kind !== null) push(kind, beforeDeclaration, afterDeclaration);
  }
  for (const afterDeclaration of after.declarations) {
    if (!pairedAfterIds.has(afterDeclaration.observationId)) push('added', null, afterDeclaration);
  }
  return Object.freeze(changes.sort((left, right) => compareCodeUnits(left.changeId, right.changeId)));
}

function testPathsForSubject(
  compilation: RepositorySourceProgramCompilationReceipt,
  declarationIds: ReadonlySet<string>,
  declarationPaths: ReadonlySet<string>
): readonly string[] {
  const references = compilation.testObservations.references
    .filter(({ targetObservationId }) => targetObservationId !== null
      && declarationIds.has(targetObservationId))
    .map(({ path }) => path);
  const registrations = compilation.testObservations.registrations
    .filter(({ observedProductionPaths }) => observedProductionPaths.some((path) => (
      declarationPaths.has(path)
    )))
    .map(({ path }) => path);
  return sortedUnique([...references, ...registrations]);
}

function phasesForSubject(input: Readonly<{
  subject: string;
  relations: readonly BoundRelation[];
  roles: readonly BoundRole[];
  compilation: RepositorySourceProgramCompilationReceipt;
  modelIndex: ReconciliationModelIndex;
}>): readonly SourceProgramReconciliationPhase[] {
  const phases = new Set<SourceProgramReconciliationPhase>();
  const subjectRelations = input.relations.filter(({ subject }) => subject === input.subject);
  for (const { relation } of subjectRelations) {
    const phase = relationPhase(relation);
    if (phase !== null) phases.add(phase);
  }
  const semanticOperations = new Set(subjectRelations.flatMap((relation) => {
    const descriptor = input.compilation.workspaceSnapshot.moduleMembership.descriptors
      .find(({ moduleId }) => moduleId === relation.ownerModuleId);
    return descriptor?.causalRelations
      .filter(({ subject }) => subject === input.subject)
      .flatMap(({ operation }) => operation === null ? [] : [operation.semanticOperation]) ?? [];
  }));
  for (const role of input.roles) {
    if (!semanticOperations.has(role.semanticOperation)) continue;
    const phase = rolePhase(role.role);
    if (phase !== null) phases.add(phase);
  }
  const declarationIds = new Set(subjectRelations.flatMap(({ declaration }) => (
    declaration === null ? [] : [declaration.observationId]
  )));
  const declarationPaths = new Set(subjectRelations.flatMap(({ declaration }) => (
    declaration === null ? [] : [declaration.path]
  )));
  const consumers = subjectRelations.flatMap(({ declaration }) => declaration === null
    ? [] : consumerPaths(input.modelIndex, declaration));
  if (consumers.length > 0) phases.add('consumer');
  if (testPathsForSubject(input.compilation, declarationIds, declarationPaths).length > 0) {
    phases.add('test');
  }
  const reexports = [...declarationIds].some((declarationId) => (
    (input.modelIndex.referencesByTarget.get(declarationId) ?? []).some(({ kind }) => (
      kind === 'reexport'
    ))
  ));
  if (reexports) phases.add('facade');
  return Object.freeze(SOURCE_PROGRAM_RECONCILIATION_PHASES.filter((phase) => phases.has(phase)));
}

function normalizeProviderEvidence(
  evidence: readonly SourceProgramReconciliationProviderEvidence[] | undefined
): Readonly<{
  evidence: readonly SourceProgramReconciliationProviderEvidence[];
  invalidProviders: readonly string[];
}> {
  const grouped = new Map<string, SourceProgramReconciliationProviderEvidence[]>();
  const invalidProviders = new Set<string>();
  const exactKeys = Object.freeze([
    'candidateDigest',
    'configDigest',
    'inputDigest',
    'provider',
    'providerRevision',
    'status'
  ]);
  for (const [index, candidate] of (evidence ?? []).entries()) {
    const raw = candidate as unknown;
    const record = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    const provider = typeof record?.provider === 'string'
      ? record.provider
      : `invalid-provider-evidence-${index}`;
    const status = record?.status;
    const keys = record === null ? [] : Object.keys(record).sort(compareCodeUnits);
    const exactShape = keys.length === exactKeys.length
      && keys.every((key, keyIndex) => key === exactKeys[keyIndex]);
    const canonicalProvider = /^[a-z0-9](?:[a-z0-9.-]{0,127})$/u.test(provider);
    const canonicalDigests = [
      record?.configDigest,
      record?.inputDigest,
      record?.candidateDigest
    ].every((digest) => typeof digest === 'string' && /^sha256:[0-9a-f]{64}$/u.test(digest));
    const observed = status === 'observed'
      && typeof record?.providerRevision === 'string'
      && record.providerRevision.length > 0
      && Buffer.byteLength(record.providerRevision, 'utf8') <= 256
      && canonicalDigests;
    const unresolved = status === 'unresolved'
      && record?.providerRevision === null
      && record.configDigest === null
      && record.inputDigest === null
      && record.candidateDigest === null;
    if (!exactShape || !canonicalProvider || (!observed && !unresolved)) {
      invalidProviders.add(provider);
      continue;
    }
    const normalized = Object.freeze({
      provider,
      status,
      providerRevision: record.providerRevision,
      configDigest: record.configDigest,
      inputDigest: record.inputDigest,
      candidateDigest: record.candidateDigest
    }) as SourceProgramReconciliationProviderEvidence;
    const group = grouped.get(provider) ?? [];
    group.push(normalized);
    grouped.set(provider, group);
  }
  const output = [...grouped]
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .flatMap(([provider, records]) => {
      if (records.length === 1) return records;
      invalidProviders.add(provider);
      return [];
    });
  return Object.freeze({
    evidence: Object.freeze(output),
    invalidProviders: sortedUnique(invalidProviders)
  });
}

function reconciliationReason(
  code: SourceProgramReconciliationReasonCode,
  subject: string,
  paths: Iterable<string>,
  detail: unknown
): SourceProgramReconciliationReason {
  return Object.freeze({
    code,
    subject,
    paths: sortedUnique(paths),
    detailDigest: sha256(detail) as `sha256:${string}`
  });
}

const EXPORT_RETIREMENT_UNKNOWN_CODES = new Set([
  'computed-property-unresolved',
  'dynamic-module-unresolved',
  'dynamic-runtime-opaque'
]);

function exportSurfaceRetirementBlockers(input: Readonly<{
  before: RepositorySourceProgramCompilationReceipt;
  after: RepositorySourceProgramCompilationReceipt;
  beforeIndex: ReconciliationModelIndex;
  afterIndex: ReconciliationModelIndex;
  beforeRoles: readonly BoundRole[];
  afterRoles: readonly BoundRole[];
  beforeOwnerIntents: ReturnType<typeof compileOwnerIntentEvidence>;
  afterOwnerIntents: ReturnType<typeof compileOwnerIntentEvidence>;
  change: SourceProgramReconciliationDeclarationChange;
}>): readonly string[] {
  const beforeAddress = input.change.before;
  const afterAddress = input.change.after;
  if (beforeAddress?.exported !== true || afterAddress?.exported !== false) return Object.freeze([]);
  const beforeDeclaration = input.beforeIndex.declarationByObservationId.get(beforeAddress.observationId);
  const afterDeclaration = input.afterIndex.declarationByObservationId.get(afterAddress.observationId);
  if (beforeDeclaration === undefined || afterDeclaration === undefined) {
    return Object.freeze(['compiler-declaration-unresolved']);
  }
  const blockers = new Set<string>();
  const beforeConsumers = consumerPaths(input.beforeIndex, beforeDeclaration);
  const afterConsumers = consumerPaths(input.afterIndex, afterDeclaration);
  const crossFileConsumers = sortedUnique([...beforeConsumers, ...afterConsumers]
    .filter((path) => path !== afterDeclaration.path));
  if (crossFileConsumers.length > 0) blockers.add('cross-file-consumer');

  const isTargetedEntrypoint = (model: SourceProgramModel): boolean => model.entrypoints.some((entrypoint) => (
    entrypoint.kind === 'module-entrypoint' && entrypoint.targetPaths.includes(afterDeclaration.path)
  ));
  if (isTargetedEntrypoint(input.before.model) || isTargetedEntrypoint(input.after.model)) {
    blockers.add('module-entrypoint-target');
  }
  const relevantPaths = new Set([
    afterDeclaration.path,
    ...beforeConsumers,
    ...afterConsumers
  ]);
  const hasRelevantUnknown = (model: SourceProgramModel): boolean => (
    model.unknowns.some(({ code, path }) => (
      EXPORT_RETIREMENT_UNKNOWN_CODES.has(code) && relevantPaths.has(path)
    ))
    || model.entrypointClosures.some((closure) => (
      closure.targetPaths.includes(afterDeclaration.path)
      && (closure.observationClass === 'unknown' || closure.unknownPaths.length > 0)
    ))
    || model.references.some((reference) => (
      reference.targetObservationId === null
      && reference.path !== afterDeclaration.path
      && (reference.targetPath === afterDeclaration.path
        || (reference.targetPath === null && reference.name === afterDeclaration.name))
    ))
  );
  if (hasRelevantUnknown(input.before.model) || hasRelevantUnknown(input.after.model)) {
    blockers.add('consumer-or-entrypoint-unknown');
  }

  const roleBound = [...input.beforeRoles, ...input.afterRoles].some(({ declaration }) => (
    declaration?.observationId === beforeDeclaration.observationId
    || declaration?.observationId === afterDeclaration.observationId
  ));
  if (roleBound) blockers.add('operation-role');

  for (const { label, intents, declaration } of [
    { label: 'before', intents: input.beforeOwnerIntents, declaration: beforeDeclaration },
    { label: 'after', intents: input.afterOwnerIntents, declaration: afterDeclaration }
  ] as const) {
    const ownerIntent = intents.find(({ owner }) => owner === declaration.moduleId);
    if (ownerIntent === undefined) blockers.add(`${label}-owner-intent-unresolved`);
    if (ownerIntent?.publicEntrypointEnvelope.some(({ targetPaths }) => (
      targetPaths.includes(declaration.path)
    ))) blockers.add(`${label}-owner-public-entrypoint`);
    if (ownerIntent?.capabilityEnvelope.some(({ operations }) => (
      operations.includes(declaration.name)
    ))) blockers.add(`${label}-owner-capability-operation`);
    if (ownerIntent?.operationObligations.some(({ obligation }) => (
      obligation.operation.kind === 'capability'
        ? obligation.operation.operation === declaration.name
        : obligation.operation.path === declaration.path
    ))) blockers.add(`${label}-owner-operation-obligation`);
    if (compileSourceProgramRequiredUnmaterializedObligations(
      declaration,
      intents,
      false
    ).length > 0) blockers.add(`${label}-required-unmaterialized-obligation`);
  }
  return sortedUnique(blockers);
}

export function compileSourceProgramReconciliationProjection(
  input: CompileSourceProgramReconciliationProjectionInput
): SourceProgramReconciliationProjection {
  // Bind this invocation once; receipt issuer checks remain the authority.
  const { before, after, providerEvidence: requestedProviderEvidence } = input;
  input = Object.freeze({ before, after, providerEvidence: requestedProviderEvidence });
  assertRepositorySourceProgramCompilationReceipt(input.before);
  assertRepositorySourceProgramCompilationReceipt(input.after);
  const findingDelta = compileSourceProgramFindingDelta(input.before, input.after);
  const beforeModelIndex = reconciliationModelIndex(input.before.model);
  const afterModelIndex = reconciliationModelIndex(input.after.model);
  const beforeMembership = input.before.workspaceSnapshot.moduleMembership;
  const afterMembership = input.after.workspaceSnapshot.moduleMembership;
  const beforeRelations = bindRelations(beforeModelIndex, beforeMembership);
  const afterRelations = bindRelations(afterModelIndex, afterMembership);
  const beforeRoles = bindRoles(beforeModelIndex, beforeMembership);
  const afterRoles = bindRoles(afterModelIndex, afterMembership);
  const beforeOwnerIntents = compileOwnerIntentEvidence(
    input.before.model,
    beforeMembership
  );
  const afterOwnerIntents = compileOwnerIntentEvidence(
    input.after.model,
    afterMembership
  );
  const changes = compileChanges(
    input.before.model,
    input.after.model,
    beforeModelIndex,
    afterModelIndex,
    beforeRelations,
    afterRelations
  );
  const subjects = sortedUnique(changes.flatMap(({ subjects: changeSubjects }) => changeSubjects));
  const reasons: SourceProgramReconciliationReason[] = [];
  if (findingDelta.scope.regressedPaths.length > 0) {
    reasons.push(reconciliationReason('source-program-observation-coverage-regressed',
      'source-program', findingDelta.scope.regressedPaths, findingDelta.after));
  }
  if (findingDelta.after.unexpectedObservedPaths.length > 0) {
    reasons.push(reconciliationReason('source-program-observation-outside-snapshot',
      'source-program', findingDelta.after.unexpectedObservedPaths, findingDelta.after));
  }
  for (const entry of findingDelta.entries) {
    if (entry.status !== 'unobserved') continue;
    reasons.push(reconciliationReason('finding-disappearance-unobserved', entry.subject,
      entry.beforePaths, { entry, changedContextFields: findingDelta.changedContextFields }));
  }
  for (const change of changes) {
    const beforeOwner = change.before?.moduleId ?? null;
    const afterOwner = change.after?.moduleId ?? null;
    const stableModuleResponsibility = (beforeOwner !== null && afterOwner !== null
      && beforeOwner === afterOwner)
      || (change.kind === 'added' && afterOwner !== null);
    if (change.subjects.length === 0 && (change.before?.exported || change.after?.exported)
        && !stableModuleResponsibility) {
      reasons.push(reconciliationReason(
        'changed-declaration-owner-relation-unresolved',
        change.after?.name ?? change.before?.name ?? '<unknown>',
        [change.after?.path ?? change.before?.path ?? '.'],
        change
      ));
    }
    const exportRetirementBlockers = exportSurfaceRetirementBlockers({
      before: input.before,
      after: input.after,
      beforeIndex: beforeModelIndex,
      afterIndex: afterModelIndex,
      beforeRoles,
      afterRoles,
      beforeOwnerIntents,
      afterOwnerIntents,
      change
    });
    if (exportRetirementBlockers.length > 0) {
      reasons.push(reconciliationReason(
        'retirement-unresolved',
        change.after?.name ?? change.before?.name ?? '<unknown>',
        [change.after?.path ?? change.before?.path ?? '.'],
        {
          retirementAdmission: 'export-surface-unresolved',
          blockers: exportRetirementBlockers,
          before: change.before,
          after: change.after
        }
      ));
    }
  }
  const frontiers: SourceProgramReconciliationFrontier[] = [];
  for (const subject of subjects) {
    const subjectChanges = changes.filter(({ subjects: changeSubjects }) => changeSubjects.includes(subject));
    const beforeSubjectRelations = beforeRelations.filter((relation) => relation.subject === subject);
    const afterSubjectRelations = afterRelations.filter((relation) => relation.subject === subject);
    const beforeOwnerModuleIds = sortedUnique(beforeSubjectRelations.map(({ ownerModuleId }) => ownerModuleId));
    const afterOwnerModuleIds = sortedUnique(afterSubjectRelations.map(({ ownerModuleId }) => ownerModuleId));
    const ownerModuleIds = sortedUnique([...beforeOwnerModuleIds, ...afterOwnerModuleIds]);
    if (beforeOwnerModuleIds.length > 1 || afterOwnerModuleIds.length > 1) {
      reasons.push(reconciliationReason(
        'module-responsibility-duplicate-owner',
        subject,
        [...beforeSubjectRelations, ...afterSubjectRelations].map(({ path }) => path),
        { ownerModuleIds }
      ));
    }
    if (beforeOwnerModuleIds.length === 1 && afterOwnerModuleIds.length === 1
        && beforeOwnerModuleIds[0] !== afterOwnerModuleIds[0]) {
      reasons.push(reconciliationReason(
        'module-responsibility-owner-transition-unresolved',
        subject,
        [...beforeSubjectRelations, ...afterSubjectRelations].map(({ path }) => path),
        { beforeOwnerModuleIds, afterOwnerModuleIds }
      ));
    }
    for (const relation of [...beforeSubjectRelations, ...afterSubjectRelations]) {
      if (relation.declaration !== null) continue;
      reasons.push(reconciliationReason(
        'module-responsibility-symbol-unresolved',
        subject,
        [relation.path],
        { relation: relation.relation, name: relation.name, ownerModuleId: relation.ownerModuleId }
      ));
    }
    const beforePhases = phasesForSubject({
      subject,
      relations: beforeRelations,
      roles: beforeRoles,
      compilation: input.before,
      modelIndex: beforeModelIndex
    });
    const afterPhases = phasesForSubject({
      subject,
      relations: afterRelations,
      roles: afterRoles,
      compilation: input.after,
      modelIndex: afterModelIndex
    });
    const beforeConsumerPaths = sortedUnique(subjectChanges.flatMap(({ beforeConsumerPaths }) => beforeConsumerPaths));
    const afterConsumerPaths = sortedUnique(subjectChanges.flatMap(({ afterConsumerPaths }) => afterConsumerPaths));
    const removed = subjectChanges.some(({ kind }) => kind === 'removed');
    if (!removed) {
      for (const phase of beforePhases) {
        if (phase === 'consumer' || phase === 'terminal' || phase === 'readback'
            || phase === 'recovery' || phase === 'retirement'
            || afterPhases.includes(phase)) continue;
        reasons.push(reconciliationReason(
          'frontier-phase-missing',
          subject,
          subjectChanges.flatMap(({ before, after }) => [before?.path, after?.path]
            .filter((path): path is string => path !== undefined)),
          { phase, beforePhases, afterPhases }
        ));
      }
    }
    if (beforeConsumerPaths.length > 0 && afterConsumerPaths.length === 0
        && !afterPhases.includes('retirement')) {
      reasons.push(reconciliationReason(
        'consumer-frontier-removed-without-retirement',
        subject,
        beforeConsumerPaths,
        { beforeConsumerPaths, afterConsumerPaths }
      ));
    }
    if (removed) {
      if (afterConsumerPaths.length > 0) {
        reasons.push(reconciliationReason(
          'retirement-consumer-frontier-not-empty',
          subject,
          afterConsumerPaths,
          { afterConsumerPaths }
        ));
      }
      // A `retires` causal relation proves only that a retirement phase is
      // represented in the candidate graph. It is not the Change Management
      // admission that closes external/durable/history, migration, accepted
      // future obligations, and the unknown ledger. Until that exact receipt
      // is a reconciliation input, every physical declaration removal remains
      // fail-closed even when the phase projection contains `retirement`.
      reasons.push(reconciliationReason(
        'retirement-unresolved',
        subject,
        subjectChanges.flatMap(({ before }) => before === null ? [] : [before.path]),
        { afterPhases, retirementAdmission: 'unresolved' }
      ));
    }
    const effectful = afterPhases.includes('effect') || beforePhases.includes('effect');
    const durable = afterPhases.includes('writer') || beforePhases.includes('writer');
    if (effectful && !afterPhases.includes('terminal')) {
      reasons.push(reconciliationReason(
        'effect-terminal-unresolved', subject, [], { beforePhases, afterPhases }
      ));
    }
    if (effectful && !afterPhases.includes('readback')) {
      reasons.push(reconciliationReason(
        'effect-readback-unresolved', subject, [], { beforePhases, afterPhases }
      ));
    }
    if (effectful && !afterPhases.includes('test')) {
      reasons.push(reconciliationReason(
        'effect-test-observation-unresolved', subject, [], { beforePhases, afterPhases }
      ));
    }
    if (durable && !afterPhases.includes('recovery')) {
      reasons.push(reconciliationReason(
        'durable-recovery-unresolved', subject, [], { beforePhases, afterPhases }
      ));
    }
    const changedAddresses = subjectChanges.flatMap(({ before, after }) => [before, after]
      .filter((address): address is SourceProgramReconciliationDeclarationAddress => address !== null));
    for (const address of changedAddresses) {
      const declaration = afterModelIndex.declarationByObservationId.get(address.observationId);
      if (declaration === undefined) continue;
      const pathPolicyLiterals = input.after.model.literals.filter(({ path, value, span }) => (
        path === declaration.path
        && span.start >= declaration.span.start
        && span.end <= declaration.span.end
        && sourceProgramSurfaceForPath(
          value.replaceAll('\\', '/').replace(/^\.\//u, '')
        ) === 'test'
      ));
      if (pathPolicyLiterals.length > 0
          && !afterSubjectRelations.some(({ relation }) => relation === 'projects')) {
        reasons.push(reconciliationReason(
          'production-layout-policy-unowned',
          subject,
          [declaration.path],
          pathPolicyLiterals.map(({ value, span }) => ({ value, span }))
        ));
      }
    }
    const canonical = {
      subject,
      ownerModuleIds,
      changeIds: subjectChanges.map(({ changeId }) => changeId).sort(compareCodeUnits),
      beforePhases,
      afterPhases,
      beforeConsumerPaths,
      afterConsumerPaths
    };
    frontiers.push(Object.freeze({
      ...canonical,
      changeIds: Object.freeze(canonical.changeIds),
      frontierDigest: sha256(canonical) as `sha256:${string}`
    }));
  }
  const beforeFileDigests = new Map(Object.entries(input.before.semanticSourceDigests));
  const afterFileDigests = new Map(Object.entries(input.after.semanticSourceDigests));
  const changedSourcePaths = new Set([...new Set([
    ...beforeFileDigests.keys(),
    ...afterFileDigests.keys()
  ])].filter((path) => beforeFileDigests.get(path) !== afterFileDigests.get(path)));
  const beforeUnknowns = new Set(input.before.model.unknowns.map(({ code, path, detail }) => (
    sha256({ code, path, detail })
  )));
  const changedAfterDeclarations = new Map(input.after.model.declarations.map((declaration) => (
    [declaration.observationId, declaration] as const
  )));
  const changedAfterSpans = changes.flatMap(({ after }) => {
    if (after === null) return [];
    const declaration = changedAfterDeclarations.get(after.observationId);
    return declaration === undefined ? [] : [declaration];
  });
  const changedConsumerPaths = new Set(changes.flatMap(({
    beforeConsumerPaths,
    afterConsumerPaths
  }) => [...beforeConsumerPaths, ...afterConsumerPaths]));
  for (const unknown of input.after.model.unknowns) {
    const stableUnknownId = sha256({
      code: unknown.code,
      path: unknown.path,
      detail: unknown.detail
    });
    const introduced = !beforeUnknowns.has(stableUnknownId);
    const containingDeclaration = unknown.span === null
      ? null
      : input.after.model.declarations
          .filter((declaration) => declaration.path === unknown.path
            && unknown.span!.start >= declaration.span.start
            && unknown.span!.end <= declaration.span.end)
          .sort((left, right) => (
            (left.span.end - left.span.start) - (right.span.end - right.span.start)
            || declarationOrder(left, right)
          ))[0] ?? null;
    const intersectsChangedDeclaration = containingDeclaration === null
      ? changedSourcePaths.has(unknown.path)
      : changedAfterSpans.some((declaration) => (
          declaration.path === unknown.path
          && unknown.span!.start >= declaration.span.start
          && unknown.span!.end <= declaration.span.end
        ));
    const changedConsumerFrontier = containingDeclaration !== null
      && transitiveConsumerPaths(afterModelIndex, containingDeclaration).some((consumerPath) => (
        changedSourcePaths.has(consumerPath) || changedConsumerPaths.has(consumerPath)
      ));
    const dependencyReferences = containingDeclaration === null
      ? afterModelIndex.moduleInitializationReferencesByPath.get(unknown.path) ?? []
      : afterModelIndex.referencesBySource.get(containingDeclaration.observationId) ?? [];
    const changedDependencyFrontier = transitiveDependencyPaths(
      afterModelIndex,
      dependencyReferences
    ).some((dependencyPath) => changedSourcePaths.has(dependencyPath));
    if (!introduced && !intersectsChangedDeclaration
        && !changedConsumerFrontier && !changedDependencyFrontier) continue;
    reasons.push(reconciliationReason(
      'changed-path-source-program-unknown',
      unknown.code,
      [unknown.path],
      { detail: unknown.detail, span: unknown.span }
    ));
  }
  const providerProjection = normalizeProviderEvidence(input.providerEvidence);
  const providerEvidence = providerProjection.evidence;
  for (const provider of providerProjection.invalidProviders) {
    reasons.push(reconciliationReason(
      'candidate-provider-evidence-invalid',
      provider,
      [],
      providerEvidence.find((item) => item.provider === provider) ?? null
    ));
  }
  for (const provider of providerEvidence.filter(({ status }) => status === 'unresolved')) {
    reasons.push(reconciliationReason(
      'candidate-provider-evidence-unresolved',
      provider.provider,
      [],
      provider
    ));
  }
  const unresolvedReasons = Object.freeze([...new Map(reasons.map((reason) => [
    `${reason.code}\0${reason.subject}\0${reason.paths.join('\0')}\0${reason.detailDigest}`,
    reason
  ])).values()].sort((left, right) => compareCodeUnits(
    `${left.code}\0${left.subject}\0${left.detailDigest}`,
    `${right.code}\0${right.subject}\0${right.detailDigest}`
  )));
  const canonical = {
    status: unresolvedReasons.length === 0 ? 'resolved' as const : 'unresolved' as const,
    before: {
      sourceRevision: input.before.sourceRevision,
      modelDigest: input.before.model.modelDigest,
      compilationReceiptDigest: input.before.receiptDigest
    },
    after: {
      sourceRevision: input.after.sourceRevision,
      modelDigest: input.after.model.modelDigest,
      compilationReceiptDigest: input.after.receiptDigest
    },
    changes,
    findingDelta,
    frontiers: frontiers.sort((left, right) => compareCodeUnits(left.subject, right.subject)),
    providerEvidence,
    unresolvedReasons
  };
  const projection = Object.freeze({
    ...canonical,
    before: Object.freeze(canonical.before),
    after: Object.freeze(canonical.after),
    frontiers: Object.freeze(canonical.frontiers),
    projectionDigest: sha256(canonical) as `sha256:${string}`
  });
  issuedSourceProgramReconciliationProjections.add(projection);
  sourceProgramReconciliationBindings.set(projection, Object.freeze({
    before: input.before,
    after: input.after
  }));
  return projection;
}

type SourceProgramArchitectureEvolutionBlockerCode =
  | 'architecture-aggregate-facade-added'
  | 'architecture-cycle-added'
  | 'architecture-cycle-expanded'
  | 'architecture-reciprocal-pair-added'
  | 'architecture-surface-became-unresolved'
  | 'architecture-violation-added'
  | 'reconciliation-unresolved';

type SourceProgramArchitectureEvolutionBlocker = Readonly<{
  code: SourceProgramArchitectureEvolutionBlockerCode;
  subjects: readonly string[];
  detailDigest: `sha256:${string}`;
}>;

type SourceProgramArchitectureEvolutionChange = Readonly<{
  changeId: `sha256:${string}`;
  kind: SourceProgramReconciliationDeclarationChange['kind'];
  subjects: readonly string[];
  sourcePath: string | null;
  targetPath: string | null;
  consumerPaths: readonly string[];
  changeDigest: `sha256:${string}`;
}>;

export type SourceProgramArchitectureEvolutionReference = Readonly<{
  status: 'blocked' | 'no-change' | 'ready';
  direction: 'blocked' | 'improving' | 'neutral';
  before: Readonly<{
    sourceRevision: string;
    modelDigest: string;
    architectureDigest: `sha256:${string}`;
  }>;
  after: Readonly<{
    sourceRevision: string;
    modelDigest: string;
    architectureDigest: `sha256:${string}`;
  }>;
  reconciliationProjectionDigest: `sha256:${string}`;
  changes: readonly SourceProgramArchitectureEvolutionChange[];
  changedPaths: readonly string[];
  consumerPaths: readonly string[];
  retirementPaths: readonly string[];
  graphDelta: Readonly<{
    addedOwnerEdges: readonly string[];
    removedOwnerEdges: readonly string[];
    addedOwnerEdgeWitnesses: readonly string[];
    removedOwnerEdgeWitnesses: readonly string[];
    addedReciprocalPairs: readonly string[];
    removedReciprocalPairs: readonly string[];
    addedStrongComponents: readonly string[];
    removedStrongComponents: readonly string[];
    addedOwnerCycleRelations: readonly string[];
    removedOwnerCycleRelations: readonly string[];
    addedFileCycleRelations: readonly string[];
    removedFileCycleRelations: readonly string[];
    addedCyclicEdgeWitnesses: readonly string[];
    removedCyclicEdgeWitnesses: readonly string[];
    expandedCyclicStructuralEdges: readonly string[];
    contractedCyclicStructuralEdges: readonly string[];
    addedFeedbackCuts: readonly string[];
    removedFeedbackCuts: readonly string[];
    addedViolations: readonly string[];
    removedViolations: readonly string[];
    addedAggregateFacades: readonly string[];
    removedAggregateFacades: readonly string[];
    addedUnresolvedSurfaces: readonly string[];
    removedUnresolvedSurfaces: readonly string[];
  }>;
  blockers: readonly SourceProgramArchitectureEvolutionBlocker[];
  referenceDigest: `sha256:${string}`;
}>;

function ownerEdgeKey(edge: RepositoryModuleOwnerEdge): string {
  return `${edge.fromOwner}->${edge.toOwner}`;
}

function reciprocalPairKey(pair: RepositoryModuleReciprocalPair): string {
  return [...pair.ownerIds].sort(compareCodeUnits).join('<->');
}

function strongComponentKey(component: RepositoryModuleStrongComponent): string {
  return [...component.ownerIds].sort(compareCodeUnits).join('<->');
}

function edgeWitnessKey(witness: RepositoryModuleEdgeWitness): string {
  return `${witness.fromPath}->${witness.toPath}\0${witness.kind}\0${witness.specifier}`;
}

function ownerEdgeWitnessKeys(edges: readonly RepositoryModuleOwnerEdge[]): readonly string[] {
  return sortedUnique(edges.flatMap((edge) => edge.witnesses.map((witness) => (
    `${edge.fromOwner}->${edge.toOwner}\0${edgeWitnessKey(witness)}`
  ))));
}

function ownerCycleRelations(
  components: readonly RepositoryModuleStrongComponent[]
): readonly string[] {
  return sortedUnique(components.flatMap(({ ownerIds }) => {
    const owners = [...ownerIds].sort(compareCodeUnits);
    return owners.flatMap((left, leftIndex) => owners
      .slice(leftIndex + 1)
      .map((right) => `${left}<->${right}`));
  }));
}

function fileCycleRelations(
  components: readonly RepositoryModuleFileStrongComponent[]
): readonly string[] {
  return sortedUnique(components.flatMap(({ ownerId, paths, edges }) => {
    const members = [...paths].sort(compareCodeUnits);
    if (members.length === 1) {
      const only = members[0]!;
      return edges.some(({ fromPath, toPath }) => fromPath === only && toPath === only)
        ? [`${ownerId}\0${only}<->${only}`]
        : [];
    }
    return members.flatMap((left, leftIndex) => members
      .slice(leftIndex + 1)
      .map((right) => `${ownerId}\0${left}<->${right}`));
  }));
}

function fileCycleEdgeWitnesses(
  components: readonly RepositoryModuleFileStrongComponent[]
): readonly string[] {
  return sortedUnique(components.flatMap(({ ownerId, edges }) => edges.map((edge) => (
    `${ownerId}\0${edgeWitnessKey(edge)}`
  ))));
}

function violationKey(violation: RepositoryModuleBoundaryViolation): string {
  // `detail` may carry revision-bound evidence digests. The violation identity
  // is its stable rule and graph endpoints; changing proof bytes must not look
  // like one violation was retired while a different violation was added.
  return `${violation.code}\0${violation.from}\0${violation.to}`;
}

function difference(after: readonly string[], before: readonly string[]): readonly string[] {
  const beforeSet = new Set(before);
  return sortedUnique(after.filter((value) => !beforeSet.has(value)));
}

function architectureIdentity(
  architecture: RepositoryModuleArchitectureProjection
): Readonly<{
  digest: `sha256:${string}`;
  ownerEdges: readonly string[];
  ownerEdgeWitnesses: readonly string[];
  reciprocalPairs: readonly string[];
  strongComponents: readonly string[];
  ownerCycles: readonly string[];
  fileCycles: readonly string[];
  cyclicEdgeWitnesses: readonly string[];
  cyclicStructuralEdgeCounts: ReadonlyMap<string, number>;
  feedbackCuts: readonly string[];
  violations: readonly string[];
}> {
  const ownerEdges = sortedUnique(architecture.ownerEdges.map(ownerEdgeKey));
  const ownerEdgeWitnesses = ownerEdgeWitnessKeys(architecture.ownerEdges);
  const reciprocalPairs = sortedUnique(architecture.reciprocalPairs.map(reciprocalPairKey));
  const strongComponents = sortedUnique(architecture.strongComponents.map(strongComponentKey));
  const ownerCycles = ownerCycleRelations(architecture.strongComponents);
  const fileCycles = fileCycleRelations(architecture.fileStrongComponents);
  const cyclicEdgeWitnesses = sortedUnique([
    ...ownerEdgeWitnessKeys(architecture.strongComponents.flatMap(({ edges }) => edges)),
    ...fileCycleEdgeWitnesses(architecture.fileStrongComponents)
  ]);
  const cyclicStructuralEdgeCounts = new Map<string, number>();
  const addStructuralWitness = (
    ownerEdge: string,
    witness: RepositoryModuleEdgeWitness
  ): void => {
    const key = `${ownerEdge}\0${witness.fromPath}->${witness.toPath}\0${witness.kind}`;
    cyclicStructuralEdgeCounts.set(key, (cyclicStructuralEdgeCounts.get(key) ?? 0) + 1);
  };
  for (const component of architecture.strongComponents) {
    for (const edge of component.edges) {
      for (const witness of edge.witnesses) {
        addStructuralWitness(`${edge.fromOwner}->${edge.toOwner}`, witness);
      }
    }
  }
  for (const component of architecture.fileStrongComponents) {
    for (const witness of component.edges) {
      addStructuralWitness(`${component.ownerId}->${component.ownerId}`, witness);
    }
  }
  const feedbackCuts = ownerEdgeWitnessKeys(architecture.feedbackCuts);
  const violations = sortedUnique(architecture.violations.map(violationKey));
  const canonical = deepFreeze({
    ownerEdges,
    ownerEdgeWitnesses,
    reciprocalPairs,
    strongComponents,
    ownerCycles,
    fileCycles,
    cyclicEdgeWitnesses,
    feedbackCuts,
    violations,
    aggregateFacadePaths: sortedUnique(architecture.aggregateFacadePaths),
    unresolvedAggregateSurfacePaths: sortedUnique(architecture.unresolvedAggregateSurfacePaths)
  });
  return deepFreeze({
    ...canonical,
    cyclicStructuralEdgeCounts,
    digest: sha256(canonical) as `sha256:${string}`
  });
}

function structuralCountDelta(
  after: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, number>,
  direction: 'expanded' | 'contracted'
): readonly string[] {
  return sortedUnique([...new Set([...after.keys(), ...before.keys()])].flatMap((key) => {
    const beforeCount = before.get(key) ?? 0;
    const afterCount = after.get(key) ?? 0;
    const changed = direction === 'expanded'
      ? afterCount > beforeCount
      : afterCount < beforeCount;
    return changed ? [`${key}\0${beforeCount}->${afterCount}`] : [];
  }));
}

function blocker(
  code: SourceProgramArchitectureEvolutionBlockerCode,
  subjects: Iterable<string>,
  detail: unknown
): SourceProgramArchitectureEvolutionBlocker {
  return deepFreeze({
    code,
    subjects: sortedUnique(subjects),
    detailDigest: sha256(detail) as `sha256:${string}`
  });
}

function reconciliationBlocker(
  reason: SourceProgramReconciliationReason
): SourceProgramArchitectureEvolutionBlocker {
  return blocker('reconciliation-unresolved', [reason.subject, ...reason.paths], reason);
}

function changeReference(
  change: SourceProgramReconciliationDeclarationChange
): SourceProgramArchitectureEvolutionChange {
  const canonical = deepFreeze({
    changeId: change.changeId,
    kind: change.kind,
    subjects: sortedUnique(change.subjects),
    sourcePath: change.before?.path ?? null,
    targetPath: change.after?.path ?? null,
    consumerPaths: sortedUnique([
      ...change.beforeConsumerPaths,
      ...change.afterConsumerPaths
    ])
  });
  return deepFreeze({
    ...canonical,
    changeDigest: sha256(canonical) as `sha256:${string}`
  });
}

/**
 * Compile the post-change architecture reference from the same compiler-issued
 * Source Program and repository-module graph. This is not a second graph and
 * accepts no caller path list, expected count, compatibility alias, or manual
 * migration table. Every path and dependency is derived from the exact before
 * and after projections.
 */
export function compileSourceProgramArchitectureEvolutionReference(input: Readonly<{
  reconciliation: SourceProgramReconciliationProjection;
}>): SourceProgramArchitectureEvolutionReference {
  assertSourceProgramReconciliationProjection(input.reconciliation);
  const binding = sourceProgramReconciliationBindings.get(input.reconciliation);
  if (binding === undefined) {
    throw new Error('Architecture evolution requires one reconciliation-bound source graph');
  }
  const beforeArchitecture = compileRepositoryModuleArchitectureProjection(
    binding.before.workspaceSnapshot.moduleGraph,
    binding.before.workspaceSnapshot.moduleMembership,
    binding.before.model
  );
  const afterArchitecture = compileRepositoryModuleArchitectureProjection(
    binding.after.workspaceSnapshot.moduleGraph,
    binding.after.workspaceSnapshot.moduleMembership,
    binding.after.model
  );
  const beforeIdentity = architectureIdentity(beforeArchitecture);
  const afterIdentity = architectureIdentity(afterArchitecture);
  const changes = Object.freeze(input.reconciliation.changes
    .map(changeReference)
    .sort((left, right) => compareCodeUnits(left.changeId, right.changeId)));
  const addedOwnerEdges = difference(afterIdentity.ownerEdges, beforeIdentity.ownerEdges);
  const removedOwnerEdges = difference(beforeIdentity.ownerEdges, afterIdentity.ownerEdges);
  const addedOwnerEdgeWitnesses = difference(
    afterIdentity.ownerEdgeWitnesses,
    beforeIdentity.ownerEdgeWitnesses
  );
  const removedOwnerEdgeWitnesses = difference(
    beforeIdentity.ownerEdgeWitnesses,
    afterIdentity.ownerEdgeWitnesses
  );
  const addedReciprocalPairs = difference(
    afterIdentity.reciprocalPairs,
    beforeIdentity.reciprocalPairs
  );
  const removedReciprocalPairs = difference(
    beforeIdentity.reciprocalPairs,
    afterIdentity.reciprocalPairs
  );
  const addedStrongComponents = difference(
    afterIdentity.strongComponents,
    beforeIdentity.strongComponents
  );
  const removedStrongComponents = difference(
    beforeIdentity.strongComponents,
    afterIdentity.strongComponents
  );
  const addedOwnerCycleRelations = difference(
    afterIdentity.ownerCycles,
    beforeIdentity.ownerCycles
  );
  const removedOwnerCycleRelations = difference(
    beforeIdentity.ownerCycles,
    afterIdentity.ownerCycles
  );
  const addedFileCycleRelations = difference(
    afterIdentity.fileCycles,
    beforeIdentity.fileCycles
  );
  const removedFileCycleRelations = difference(
    beforeIdentity.fileCycles,
    afterIdentity.fileCycles
  );
  const addedCyclicEdgeWitnesses = difference(
    afterIdentity.cyclicEdgeWitnesses,
    beforeIdentity.cyclicEdgeWitnesses
  );
  const removedCyclicEdgeWitnesses = difference(
    beforeIdentity.cyclicEdgeWitnesses,
    afterIdentity.cyclicEdgeWitnesses
  );
  const expandedCyclicStructuralEdges = structuralCountDelta(
    afterIdentity.cyclicStructuralEdgeCounts,
    beforeIdentity.cyclicStructuralEdgeCounts,
    'expanded'
  );
  const contractedCyclicStructuralEdges = structuralCountDelta(
    afterIdentity.cyclicStructuralEdgeCounts,
    beforeIdentity.cyclicStructuralEdgeCounts,
    'contracted'
  );
  const addedFeedbackCuts = difference(afterIdentity.feedbackCuts, beforeIdentity.feedbackCuts);
  const removedFeedbackCuts = difference(beforeIdentity.feedbackCuts, afterIdentity.feedbackCuts);
  const addedViolations = difference(afterIdentity.violations, beforeIdentity.violations);
  const removedViolations = difference(beforeIdentity.violations, afterIdentity.violations);
  const addedAggregateFacades = difference(
    afterArchitecture.aggregateFacadePaths,
    beforeArchitecture.aggregateFacadePaths
  );
  const removedAggregateFacades = difference(
    beforeArchitecture.aggregateFacadePaths,
    afterArchitecture.aggregateFacadePaths
  );
  const addedUnresolvedSurfaces = difference(
    afterArchitecture.unresolvedAggregateSurfacePaths,
    beforeArchitecture.unresolvedAggregateSurfacePaths
  );
  const removedUnresolvedSurfaces = difference(
    beforeArchitecture.unresolvedAggregateSurfacePaths,
    afterArchitecture.unresolvedAggregateSurfacePaths
  );
  const blockers: SourceProgramArchitectureEvolutionBlocker[] = [
    ...input.reconciliation.unresolvedReasons.map(reconciliationBlocker),
    ...(addedReciprocalPairs.length === 0 ? [] : [blocker(
      'architecture-reciprocal-pair-added', addedReciprocalPairs, { addedReciprocalPairs }
    )]),
    ...(addedOwnerCycleRelations.length === 0 && addedFileCycleRelations.length === 0
      ? [] : [blocker(
      'architecture-cycle-added',
      [...addedOwnerCycleRelations, ...addedFileCycleRelations],
      { addedOwnerCycleRelations, addedFileCycleRelations }
    )]),
    ...(expandedCyclicStructuralEdges.length === 0
      ? [] : [blocker(
      'architecture-cycle-expanded',
      expandedCyclicStructuralEdges,
      { expandedCyclicStructuralEdges }
    )]),
    ...(addedViolations.length === 0 ? [] : [blocker(
      'architecture-violation-added', addedViolations, { addedViolations }
    )]),
    ...(addedAggregateFacades.length === 0 ? [] : [blocker(
      'architecture-aggregate-facade-added', addedAggregateFacades, { addedAggregateFacades }
    )]),
    ...(addedUnresolvedSurfaces.length === 0 ? [] : [blocker(
      'architecture-surface-became-unresolved',
      addedUnresolvedSurfaces,
      { addedUnresolvedSurfaces }
    )])
  ];
  const uniqueBlockers = Object.freeze([...new Map(blockers.map((item) => [
    `${item.code}\0${item.subjects.join('\0')}\0${item.detailDigest}`,
    item
  ])).values()].sort((left, right) => compareCodeUnits(
    `${left.code}\0${left.subjects.join('\0')}\0${left.detailDigest}`,
    `${right.code}\0${right.subjects.join('\0')}\0${right.detailDigest}`
  )));
  const graphDelta = deepFreeze({
    addedOwnerEdges,
    removedOwnerEdges,
    addedOwnerEdgeWitnesses,
    removedOwnerEdgeWitnesses,
    addedReciprocalPairs,
    removedReciprocalPairs,
    addedStrongComponents,
    removedStrongComponents,
    addedOwnerCycleRelations,
    removedOwnerCycleRelations,
    addedFileCycleRelations,
    removedFileCycleRelations,
    addedCyclicEdgeWitnesses,
    removedCyclicEdgeWitnesses,
    expandedCyclicStructuralEdges,
    contractedCyclicStructuralEdges,
    addedFeedbackCuts,
    removedFeedbackCuts,
    addedViolations,
    removedViolations,
    addedAggregateFacades,
    removedAggregateFacades,
    addedUnresolvedSurfaces,
    removedUnresolvedSurfaces
  });
  const changed = changes.length > 0
    || Object.values(graphDelta).some((values) => values.length > 0);
  const improving = removedReciprocalPairs.length > 0
    || removedOwnerEdges.length > 0
    || removedOwnerCycleRelations.length > 0
    || removedFileCycleRelations.length > 0
    || contractedCyclicStructuralEdges.length > 0
    || removedViolations.length > 0
    || removedAggregateFacades.length > 0
    || removedUnresolvedSurfaces.length > 0;
  const canonical = deepFreeze({
    status: uniqueBlockers.length > 0
      ? 'blocked' as const
      : changed ? 'ready' as const : 'no-change' as const,
    direction: uniqueBlockers.length > 0
      ? 'blocked' as const
      : improving ? 'improving' as const : 'neutral' as const,
    before: {
      sourceRevision: input.reconciliation.before.sourceRevision,
      modelDigest: input.reconciliation.before.modelDigest,
      architectureDigest: beforeIdentity.digest
    },
    after: {
      sourceRevision: input.reconciliation.after.sourceRevision,
      modelDigest: input.reconciliation.after.modelDigest,
      architectureDigest: afterIdentity.digest
    },
    reconciliationProjectionDigest: input.reconciliation.projectionDigest,
    changes,
    changedPaths: sortedUnique(changes.flatMap(({ sourcePath, targetPath }) => [
      ...(sourcePath === null ? [] : [sourcePath]),
      ...(targetPath === null ? [] : [targetPath])
    ])),
    consumerPaths: sortedUnique(changes.flatMap(({ consumerPaths }) => consumerPaths)),
    retirementPaths: sortedUnique(changes.flatMap(({ kind, sourcePath }) => (
      (kind === 'removed' || kind === 'moved') && sourcePath !== null ? [sourcePath] : []
    ))),
    graphDelta,
    blockers: uniqueBlockers
  });
  return deepFreeze({
    ...canonical,
    referenceDigest: sha256(canonical) as `sha256:${string}`
  });
}
