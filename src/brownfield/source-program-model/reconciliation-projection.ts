import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import type {
  SecModuleCausalRelationKind,
  SecModuleOperationRole,
  SecRepositoryModuleMembership
} from '../../system-architecture/repository-modules/contract.ts';
import {
  sourceProgramSurfaceForPath,
  type SourceProgramDeclaration,
  type SourceProgramModel,
  type SourceProgramReference
} from './contract.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';

export const SOURCE_PROGRAM_RECONCILIATION_PHASES = Object.freeze([
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

export type SourceProgramReconciliationPhase =
  (typeof SOURCE_PROGRAM_RECONCILIATION_PHASES)[number];

export type SourceProgramReconciliationProviderEvidence = Readonly<{
  provider: string;
  status: 'observed' | 'unresolved';
  providerRevision: string | null;
  configDigest: `sha256:${string}` | null;
  inputDigest: `sha256:${string}` | null;
  candidateDigest: `sha256:${string}` | null;
}>;

export type SourceProgramReconciliationReasonCode =
  | 'candidate-provider-evidence-invalid'
  | 'candidate-provider-evidence-unresolved'
  | 'changed-declaration-owner-relation-unresolved'
  | 'changed-path-source-program-unknown'
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

export type SourceProgramReconciliationReason = Readonly<{
  code: SourceProgramReconciliationReasonCode;
  subject: string;
  paths: readonly string[];
  detailDigest: `sha256:${string}`;
}>;

export type SourceProgramReconciliationDeclarationChange = Readonly<{
  changeId: `sha256:${string}`;
  kind: 'added' | 'modified' | 'moved' | 'removed' | 'renamed' | 'reexported';
  subjects: readonly string[];
  before: SourceProgramReconciliationDeclarationAddress | null;
  after: SourceProgramReconciliationDeclarationAddress | null;
  beforeConsumerPaths: readonly string[];
  afterConsumerPaths: readonly string[];
}>;

export type SourceProgramReconciliationDeclarationAddress = Readonly<{
  observationId: string;
  declarationDigest: string;
  moduleId: string | null;
  path: string;
  name: string;
  kind: string;
  exported: boolean;
}>;

export type SourceProgramReconciliationFrontier = Readonly<{
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
  frontiers: readonly SourceProgramReconciliationFrontier[];
  providerEvidence: readonly SourceProgramReconciliationProviderEvidence[];
  unresolvedReasons: readonly SourceProgramReconciliationReason[];
  projectionDigest: `sha256:${string}`;
}>;

export type CompileSourceProgramReconciliationProjectionInput = Readonly<{
  before: RepositorySourceProgramCompilationReceipt;
  after: RepositorySourceProgramCompilationReceipt;
  beforeMembership: SecRepositoryModuleMembership;
  afterMembership: SecRepositoryModuleMembership;
  providerEvidence?: readonly SourceProgramReconciliationProviderEvidence[];
}>;

type BoundRelation = Readonly<{
  subject: string;
  relation: SecModuleCausalRelationKind;
  ownerModuleId: string;
  declaration: SourceProgramDeclaration | null;
  path: string;
  name: string;
}>;

type BoundRole = Readonly<{
  semanticOperation: string;
  role: SecModuleOperationRole;
  ownerModuleId: string;
  declaration: SourceProgramDeclaration | null;
}>;

type ReconciliationModelIndex = Readonly<{
  declarationByObservationId: ReadonlyMap<string, SourceProgramDeclaration>;
  declarationsByModuleName: ReadonlyMap<string, readonly SourceProgramDeclaration[]>;
  declarationsByPathName: ReadonlyMap<string, readonly SourceProgramDeclaration[]>;
  consumerPathsByTarget: ReadonlyMap<string, readonly string[]>;
  referencesByTarget: ReadonlyMap<string, readonly SourceProgramReference[]>;
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
  for (const reference of model.references) {
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
    )))
  });
}

function relationPhase(
  relation: SecModuleCausalRelationKind
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

function rolePhase(role: SecModuleOperationRole): SourceProgramReconciliationPhase | null {
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
  membership: SecRepositoryModuleMembership
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
  membership: SecRepositoryModuleMembership
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

function relationDeclarationPairs(
  beforeRelations: readonly BoundRelation[],
  afterRelations: readonly BoundRelation[]
): ReadonlyMap<string, Readonly<{ before: SourceProgramDeclaration; after: SourceProgramDeclaration }>> {
  const beforeByKey = new Map(beforeRelations
    .filter((relation): relation is BoundRelation & { declaration: SourceProgramDeclaration } => (
      relation.declaration !== null
    ))
    .map((relation) => [`${relation.subject}\0${relation.relation}`, relation] as const));
  const pairs = new Map<string, Readonly<{ before: SourceProgramDeclaration; after: SourceProgramDeclaration }>>();
  for (const relation of afterRelations) {
    if (relation.declaration === null) continue;
    const before = beforeByKey.get(`${relation.subject}\0${relation.relation}`)?.declaration ?? null;
    if (before === null) continue;
    pairs.set(before.observationId, Object.freeze({ before, after: relation.declaration }));
  }
  return pairs;
}

function compileChanges(
  before: SourceProgramModel,
  after: SourceProgramModel,
  beforeIndex: ReconciliationModelIndex,
  afterIndex: ReconciliationModelIndex,
  beforeRelations: readonly BoundRelation[],
  afterRelations: readonly BoundRelation[]
): readonly SourceProgramReconciliationDeclarationChange[] {
  const pairs = new Map(relationDeclarationPairs(beforeRelations, afterRelations));
  const pairedAfterIds = new Set([...pairs.values()].map(({ after: declaration }) => declaration.observationId));
  const afterByStableKey = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of after.declarations) {
    const key = `${declaration.moduleId ?? ''}\0${declaration.name}\0${declaration.kind}\0${declaration.exported}`;
    const group = afterByStableKey.get(key) ?? [];
    group.push(declaration);
    afterByStableKey.set(key, group);
  }
  for (const declaration of before.declarations) {
    if (pairs.has(declaration.observationId)) continue;
    const key = `${declaration.moduleId ?? ''}\0${declaration.name}\0${declaration.kind}\0${declaration.exported}`;
    const candidates = (afterByStableKey.get(key) ?? [])
      .filter(({ observationId }) => !pairedAfterIds.has(observationId));
    if (candidates.length !== 1) continue;
    pairs.set(declaration.observationId, Object.freeze({ before: declaration, after: candidates[0]! }));
    pairedAfterIds.add(candidates[0]!.observationId);
  }
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
          : beforeDeclaration.declarationDigest !== afterDeclaration.declarationDigest
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

export function compileSourceProgramReconciliationProjection(
  input: CompileSourceProgramReconciliationProjectionInput
): SourceProgramReconciliationProjection {
  assertRepositorySourceProgramCompilationReceipt(input.before);
  assertRepositorySourceProgramCompilationReceipt(input.after);
  const beforeModelIndex = reconciliationModelIndex(input.before.model);
  const afterModelIndex = reconciliationModelIndex(input.after.model);
  const beforeRelations = bindRelations(beforeModelIndex, input.beforeMembership);
  const afterRelations = bindRelations(afterModelIndex, input.afterMembership);
  const beforeRoles = bindRoles(beforeModelIndex, input.beforeMembership);
  const afterRoles = bindRoles(afterModelIndex, input.afterMembership);
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
      if (!afterPhases.includes('retirement')) {
        reasons.push(reconciliationReason(
          'retirement-unresolved',
          subject,
          subjectChanges.flatMap(({ before }) => before === null ? [] : [before.path]),
          { afterPhases }
        ));
      }
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
  const changedPaths = new Set(changes.flatMap(({ before, after }) => [before?.path, after?.path]
    .filter((path): path is string => path !== undefined)));
  for (const unknown of [...input.before.model.unknowns, ...input.after.model.unknowns]) {
    if (unknown.path !== '.' && !changedPaths.has(unknown.path)) continue;
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
    frontiers: frontiers.sort((left, right) => compareCodeUnits(left.subject, right.subject)),
    providerEvidence,
    unresolvedReasons
  };
  return Object.freeze({
    ...canonical,
    before: Object.freeze(canonical.before),
    after: Object.freeze(canonical.after),
    frontiers: Object.freeze(canonical.frontiers),
    projectionDigest: sha256(canonical) as `sha256:${string}`
  });
}
