import { createTwoFilesPatch } from 'diff';
import nodePath from 'node:path';
import ts from 'typescript';

import { compareCodeUnits, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { isRepositoryTestModulePath } from '../../../contracts/repository-test-path.ts';
import { isCanonicalOperationBudgetMaximum } from '../../../execution/operation/semantic.ts';
import type {
  RepositoryModuleArchitectureProjection,
  RepositoryModuleMembership
} from '../architecture/contract.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  type SourceProgramCompilationOperation
} from './compilation-operation.ts';
import type {
  SourceProgramCapabilityInvocation,
  SourceProgramDeclaration,
  SourceProgramFileInput,
  SourceProgramModel,
  SourceProgramOperationObligationEvidence,
  SourceProgramOwnerIntentEvidence,
  SourceProgramReference,
  SourceProgramSpan,
  SourceProgramSupersessionFinding,
  SourceProgramSupersessionFindingCode,
  SourceProgramSupersessionLifecycleCost,
  SourceProgramSupersessionReceipt,
  SourceProgramSupersessionReplacement,
  SourceProgramSupersessionStatus
} from './contract.ts';
import {
  compileSourceProgramRequiredUnmaterializedObligations,
  type SourceProgramRequiredUnmaterializedObligation
} from './implementation-dominance.ts';
import {
  compileRepositoryModel,
  compileOwnerIntentEvidence,
  isCompiledRepositoryModel
} from './repository.ts';
import {
  reconcileSourceProgramTestValueWithSupersession,
  type SourceProgramTestDisposition,
  type SourceProgramTestDispositionProjection,
  type SourceProgramTestRegistration,
  type TestSemanticClass,
  type SourceProgramTestValueCompilation
} from './test-value.ts';
import {
  compileTypeScriptDiagnosticSnapshot,
  observeTypeScriptRename,
  typeScriptExactFactGenerationReceipt,
  typeScriptSourceFile
} from './typescript.ts';
import {
  compileWorkspaceSourceRevision,
  type WorkspaceSourceFile
} from './workspace-source-snapshot.ts';

const compiledGraphCutReductionPlans = new WeakSet<object>();
const compiledAggregateImportReductionPlans = new WeakSet<object>();
const compiledUnusedSymbolProviderReceipts = new WeakSet<object>();
const compiledSourceProgramSupersessionReceipts = new WeakSet<object>();

interface SourceProgramRenameLocation {
  readonly path: string;
  readonly span: SourceProgramSpan;
  readonly prefixText: string;
  readonly suffixText: string;
}

interface SourceProgramVersionSuffixReduction {
  readonly status: 'ready' | 'blocked';
  readonly currentName: string;
  readonly proposedName: string;
  readonly declarationPaths: readonly string[];
  readonly locations: readonly SourceProgramRenameLocation[];
  readonly reason: string | null;
}

export interface SourceProgramVersionSuffixReductionPlan {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly reductions: readonly SourceProgramVersionSuffixReduction[];
}

export interface SourceProgramVersionSuffixReductionPatch {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly patchDigest: string;
  readonly patch: string;
  readonly files: readonly Readonly<{
    path: string;
    beforeDigest: string;
    afterDigest: string;
  }>[];
}

export interface SourceProgramUnusedSymbolEvidence {
  readonly path: string;
  readonly name: string;
}

export interface SourceProgramUnusedSymbolProviderReceipt {
  readonly schema: 'source-program-unused-symbol-provider-receipt-v1';
  readonly provider: 'knip';
  readonly providerRevision: `sha256:${string}`;
  readonly settlement: 'completed';
  readonly sourceRevision: string;
  readonly sourceSnapshotDigest: string;
  readonly configurationDigest: string;
  readonly inputDigest: string;
  readonly candidateDigest: string;
  readonly candidates: readonly SourceProgramUnusedSymbolEvidence[];
  readonly receiptDigest: string;
}

export interface CompileSourceProgramUnusedSymbolProviderReceiptInput {
  readonly model: SourceProgramModel;
  readonly files: readonly SourceProgramFileInput[];
  readonly providerRevision: `sha256:${string}`;
  readonly configuration: Readonly<{
    readonly includedIssueTypes: readonly ['exports', 'types'];
    readonly isShowProgress: false;
  }>;
  readonly settlement: 'completed';
  readonly candidates: readonly SourceProgramUnusedSymbolEvidence[];
}

interface SourceProgramGraphCutReduction {
  readonly status: 'ready' | 'blocked';
  readonly disposition: 'delete' | 'required-unmaterialized' | 'blocked';
  readonly path: string;
  readonly name: string;
  readonly removalSpan: SourceProgramSpan | null;
  readonly requiredUnmaterializedObligations: readonly SourceProgramRequiredUnmaterializedObligation[];
  readonly reason: string | null;
}

export interface SourceProgramGraphCutReductionPlan {
  readonly sourceRevision: string;
  readonly sourceSnapshotDigest: string;
  readonly planDigest: string;
  readonly evidenceDigest: string;
  readonly verificationDigest: string;
  readonly reductions: readonly SourceProgramGraphCutReduction[];
}

export interface SourceProgramReductionCompilerContext {
  readonly typeScriptModel: SourceProgramModel;
  readonly moduleMembership: RepositoryModuleMembership;
  readonly reviewedProcessDispatchers: readonly string[];
  readonly operation?: SourceProgramCompilationOperation;
}

interface SourceProgramAggregateImportReduction {
  readonly status: 'ready' | 'blocked';
  readonly path: string;
  readonly moduleSpecifier: string;
  readonly statementSpan: SourceProgramSpan;
  readonly replacementText: string | null;
  readonly targetPaths: readonly string[];
  readonly reason: string | null;
}

export interface SourceProgramAggregateImportReductionPlan {
  readonly sourceRevision: string;
  readonly sourceSnapshotDigest: string;
  readonly architectureDigest: string;
  readonly snapshotStatus: 'sealed' | 'blocked';
  readonly snapshotReason: string | null;
  readonly planDigest: string;
  readonly reductions: readonly SourceProgramAggregateImportReduction[];
}

export interface SourceProgramArchitectureSnapshot {
  readonly sourceRevision: string;
  readonly architecture: RepositoryModuleArchitectureProjection;
}

export type SourceProgramReductionAdmissionFailureCode =
  | 'compiler-issued-plan-required'
  | 'source-snapshot-drift';

export class SourceProgramReductionAdmissionError extends Error {
  readonly code: SourceProgramReductionAdmissionFailureCode;

  constructor(code: SourceProgramReductionAdmissionFailureCode, message: string) {
    super(message);
    this.name = 'SourceProgramReductionAdmissionError';
    this.code = code;
  }
}

function exactReductionTypeScriptModel(
  repositoryModel: SourceProgramModel,
  context: SourceProgramReductionCompilerContext
): SourceProgramModel {
  const typeScriptModel = context.typeScriptModel;
  const repositoryFiles = new Map(repositoryModel.files.map(({ path, contentDigest }) => [
    path,
    contentDigest
  ] as const));
  if (typeScriptModel.sourceRevision !== repositoryModel.sourceRevision
      || typeScriptExactFactGenerationReceipt(typeScriptModel) === null
      || typeScriptModel.files.some(({ path, contentDigest }) =>
        repositoryFiles.get(path) !== contentDigest)) {
    throw new SourceProgramReductionAdmissionError(
      'compiler-issued-plan-required',
      'Reduction requires the exact TypeScript generation bound to the repository projection'
    );
  }
  return typeScriptModel;
}

export interface SourceProgramAggregateImportReductionPatch {
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly patchDigest: string;
  readonly patch: string;
  readonly files: readonly Readonly<{
    path: string;
    beforeDigest: string;
    afterDigest: string;
  }>[];
}

const SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA = Object.freeze({
  evidenceKeys: Object.freeze([
    'actionKey',
    'identity',
    'source',
    'productionUnits',
    'resourceUnits',
    'entrypointUnits',
    'tests',
    'intentEvidence',
    'unknowns',
    'evidenceDigest'
  ]),
  identityKeys: Object.freeze([
    'sourceRevision',
    'revisionDigest',
    'treeDigest',
    'toolchainDigest',
    'configurationDigest',
    'schemaDigest'
  ]),
  sourceKeys: Object.freeze([
    'modelDigest',
    'testCompilationDigest',
    'intentEvidenceDigest'
  ]),
  semanticUnitKeys: Object.freeze(['id', 'occurrenceId', 'owner', 'path', 'signature']),
  testUnitKeys: Object.freeze([
    'testId',
    'path',
    'semanticClasses',
    'observedProductionPaths',
    'capabilityOperations',
    'unknowns'
  ]),
  intentKeys: Object.freeze([
    'owner',
    'capabilityEnvelope',
    'publicEntrypointEnvelope',
    'operationObligations',
    'evidenceDigest'
  ]),
  capabilityIntentKeys: Object.freeze(['capability', 'operations']),
  entrypointIntentKeys: Object.freeze(['kind', 'name', 'targetPackages', 'targetPaths', 'transports']),
  operationObligationEvidenceKeys: Object.freeze(['obligation', 'observation', 'evidenceDigest']),
  operationObligationKeys: Object.freeze([
    'operation', 'consumerSupport', 'effect', 'evolution', 'resources', 'futureSupport'
  ]),
  capabilityOperationKeys: Object.freeze(['kind', 'capability', 'operation']),
  entrypointOperationKeys: Object.freeze(['kind', 'path']),
  consumerSupportKeys: Object.freeze(['consumers']),
  effectKeys: Object.freeze(['kinds', 'failureKinds', 'recovery']),
  evolutionKeys: Object.freeze(['migration', 'retirement']),
  resourceEnvelopeKeys: Object.freeze(['aggregateBudgets']),
  resourceBudgetKeys: Object.freeze(['resource', 'maximum']),
  futureSupportKeys: Object.freeze(['condition']),
  obligationObservationKeys: Object.freeze([
    'status', 'reason', 'consumerModuleIds', 'effectKinds'
  ]),
  unknownKeys: Object.freeze(['code', 'path', 'detail']),
  decisionProjections: Object.freeze([
    'current-value',
    'owner-issued-design-intent',
    'lifecycle-cost',
    'typed-unknown'
  ])
});

const SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA_DIGEST = sha256(
  SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA
);

export interface SourceProgramSupersessionEvidenceIdentity {
  /** Digest of the exact repository revision locator resolved by the Git owner. */
  readonly revisionDigest: string;
  /** Digest of the exact repository tree compiled into the Source Program. */
  readonly treeDigest: string;
  /** Digest of the compiler and provider capability closure. */
  readonly toolchainDigest: string;
  /** Digest of every configuration input that can change compiled facts. */
  readonly configurationDigest: string;
  /** Digest of the strict evidence grammar consumed by this compiler. */
  readonly schemaDigest: string;
}

export type SourceProgramSupersessionEvidenceIdentityInput = Omit<
  SourceProgramSupersessionEvidenceIdentity,
  'schemaDigest'
>;

export function compileSourceProgramSupersessionEvidenceIdentity(
  input: SourceProgramSupersessionEvidenceIdentityInput
): SourceProgramSupersessionEvidenceIdentity {
  if (!Object.values(input).every((value) => DIGEST.test(value))) {
    throw new Error('Source Program supersession identity requires exact content digests');
  }
  return Object.freeze({
    ...input,
    schemaDigest: SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA_DIGEST
  });
}

interface SourceProgramSupersessionTestUnit {
  readonly testId: string;
  readonly path: string;
  readonly semanticClasses: readonly TestSemanticClass[];
  readonly observedProductionPaths: readonly string[];
  readonly capabilityOperations: readonly string[];
  readonly unknowns: readonly string[];
}

export interface SourceProgramSupersessionEvidence {
  readonly actionKey: string;
  readonly identity: Readonly<SourceProgramSupersessionEvidenceIdentity & {
    readonly sourceRevision: string;
  }>;
  readonly source: Readonly<{
    readonly modelDigest: string;
    readonly testCompilationDigest: string;
    readonly intentEvidenceDigest: string;
  }>;
  readonly productionUnits: readonly SourceProgramSemanticUnit[];
  readonly resourceUnits: readonly SourceProgramSemanticUnit[];
  readonly entrypointUnits: readonly SourceProgramSemanticUnit[];
  readonly tests: readonly SourceProgramSupersessionTestUnit[];
  readonly intentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  readonly unknowns: readonly Readonly<{
    readonly code: string;
    readonly path: string;
    readonly detail: string;
  }>[];
  readonly evidenceDigest: string;
}

export interface CompileSourceProgramSupersessionEvidenceInput {
  readonly model: SourceProgramModel;
  readonly tests: SourceProgramTestValueCompilation;
  readonly intentEvidence: readonly SourceProgramOwnerIntentEvidence[];
  readonly identity: SourceProgramSupersessionEvidenceIdentity;
  readonly operation?: SourceProgramCompilationOperation;
}

export interface CompileSourceProgramSupersessionInput {
  readonly baseline: SourceProgramSupersessionEvidence;
  readonly current: SourceProgramSupersessionEvidence;
  readonly operation?: SourceProgramCompilationOperation;
}

interface SourceProgramSemanticUnit {
  readonly id: string;
  readonly occurrenceId: string;
  readonly owner: string | null;
  readonly path: string;
  readonly signature: string;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function pathSemanticUnitOccurrenceId(
  kind: 'production' | 'resource',
  path: string
): string {
  return sha256({ kind, path });
}

function sourceProgramModelEvidenceIsExact(model: SourceProgramModel): boolean {
  return DIGEST.test(model.modelDigest)
    && DIGEST.test(model.sourceRevision)
    && isCompiledRepositoryModel(model);
}

function sourceProgramTestEvidenceIsExact(compilation: SourceProgramTestValueCompilation): boolean {
  return DIGEST.test(compilation.compilationDigest)
    && DIGEST.test(compilation.sourceRevision)
    && DIGEST.test(compilation.baselineDigest)
    && DIGEST.test(compilation.baselineEvidenceDigest)
    && new Set(compilation.records.map(({ testId }) => testId)).size === compilation.records.length
    && compilation.records.every(({ testId }) => DIGEST.test(testId));
}

function ownerIntentEvidenceIsExact(evidence: SourceProgramOwnerIntentEvidence): boolean {
  if (!DIGEST.test(evidence.evidenceDigest)
      || evidence.operationObligations.some((obligation) =>
        !operationObligationEvidenceIsExact(obligation))
      || new Set(evidence.operationObligations.map(({ obligation }) =>
        operationIdentityKey(obligation.operation))).size !== evidence.operationObligations.length) return false;
  const { evidenceDigest: _evidenceDigest, ...canonicalEvidence } = evidence;
  return sha256(canonicalEvidence) === evidence.evidenceDigest;
}

function operationIdentityKey(
  operation: SourceProgramOperationObligationEvidence['obligation']['operation']
): string {
  return operation.kind === 'capability'
    ? `capability\0${operation.capability}\0${operation.operation}`
    : `public-entrypoint\0${operation.path}`;
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value)
    && value.every((item) => typeof item === 'string' && item.length > 0)
    && new Set(value).size === value.length;
}

type SourceProgramOperationResourceBudget =
  SourceProgramOperationObligationEvidence['obligation']['resources']['aggregateBudgets'][number];

const SOURCE_PROGRAM_OPERATION_RESOURCE_KINDS = new Set([
  'duration-ms', 'input-bytes', 'output-bytes', 'processes', 'records'
]);

function resourceBudgetIsExact(value: unknown): value is SourceProgramOperationResourceBudget {
  const resource = hasExactKeys(value, SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA.resourceBudgetKeys)
    && typeof value.resource === 'string'
    && SOURCE_PROGRAM_OPERATION_RESOURCE_KINDS.has(value.resource)
    ? value.resource as SourceProgramOperationResourceBudget['resource']
    : null;
  return hasExactKeys(value, SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA.resourceBudgetKeys)
    && resource !== null
    && typeof value.maximum === 'number'
    && isCanonicalOperationBudgetMaximum(resource, value.maximum);
}

function operationObligationEvidenceIsExact(
  evidence: SourceProgramOperationObligationEvidence
): boolean {
  const schema = SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA;
  const aggregateBudgets = evidence.obligation.resources.aggregateBudgets;
  if (!hasExactKeys(evidence, schema.operationObligationEvidenceKeys)
      || !hasExactKeys(evidence.obligation, schema.operationObligationKeys)
      || !hasExactKeys(
        evidence.obligation.operation,
        evidence.obligation.operation.kind === 'capability'
          ? schema.capabilityOperationKeys
          : schema.entrypointOperationKeys
      )
      || !hasExactKeys(evidence.obligation.consumerSupport, schema.consumerSupportKeys)
      || !hasExactKeys(evidence.obligation.effect, schema.effectKeys)
      || !hasExactKeys(evidence.obligation.evolution, schema.evolutionKeys)
      || !hasExactKeys(evidence.obligation.resources, schema.resourceEnvelopeKeys)
      || !hasExactKeys(evidence.obligation.futureSupport, schema.futureSupportKeys)
      || !hasExactKeys(evidence.observation, schema.obligationObservationKeys)
      || !Array.isArray(evidence.obligation.consumerSupport.consumers)
      || !Array.isArray(evidence.obligation.effect.kinds)
      || !Array.isArray(evidence.obligation.effect.failureKinds)
      || !Array.isArray(aggregateBudgets)
      || !aggregateBudgets.every(resourceBudgetIsExact)
      || !Array.isArray(evidence.observation.consumerModuleIds)
      || !Array.isArray(evidence.observation.effectKinds)
      || !DIGEST.test(evidence.evidenceDigest)
      || (evidence.observation.status === 'verified') !== (evidence.observation.reason === 'verified')) {
    return false;
  }
  const operation = evidence.obligation.operation;
  const allowedEffectKinds = new Set([
    'dynamic-code', 'filesystem', 'network', 'persistent-state', 'process', 'provider'
  ]);
  const allowedRecovery = new Set([
    'idempotent-retry', 'not-applicable', 'owner-intervention', 'resume', 'rollback'
  ]);
  const allowedMigration = new Set([
    'durable-read-migration', 'not-required', 'one-shot-owner-migration'
  ]);
  const allowedRetirement = new Set([
    'consumer-zero', 'never', 'replacement-obligations-satisfied'
  ]);
  const allowedFutureSupport = new Set([
    'explicit-owner-decision', 'preserve-obligations', 'semantic-superset-required'
  ]);
  const allowedReasons = new Set([
    'consumer-closure-unresolved', 'effect-closure-unresolved', 'identity-unresolved', 'verified'
  ]);
  if ((operation.kind !== 'capability' && operation.kind !== 'public-entrypoint')
      || (operation.kind === 'capability'
        && (operation.capability.length === 0 || operation.operation.length === 0))
      || (operation.kind === 'public-entrypoint' && operation.path.length === 0)
      || !isUniqueStringArray(evidence.obligation.consumerSupport.consumers)
      || !isUniqueStringArray(evidence.obligation.effect.kinds)
      || evidence.obligation.effect.kinds.some((kind) => !allowedEffectKinds.has(kind))
      || !isUniqueStringArray(evidence.obligation.effect.failureKinds)
      || !allowedRecovery.has(evidence.obligation.effect.recovery)
      || !allowedMigration.has(evidence.obligation.evolution.migration)
      || !allowedRetirement.has(evidence.obligation.evolution.retirement)
      || aggregateBudgets.length < 1
      || new Set(aggregateBudgets.map(({ resource }) => resource)).size
        !== aggregateBudgets.length
      || !allowedFutureSupport.has(evidence.obligation.futureSupport.condition)
      || !isUniqueStringArray(evidence.observation.consumerModuleIds)
      || !isUniqueStringArray(evidence.observation.effectKinds)
      || evidence.observation.effectKinds.some((kind) => !allowedEffectKinds.has(kind))
      || (evidence.observation.status !== 'unknown' && evidence.observation.status !== 'verified')
      || !allowedReasons.has(evidence.observation.reason)) return false;
  if (evidence.observation.status === 'verified'
      && (!isStringSuperset(
        evidence.obligation.consumerSupport.consumers,
        evidence.observation.consumerModuleIds
      )
        || !isStringSuperset(
          evidence.observation.consumerModuleIds,
          evidence.obligation.consumerSupport.consumers
        )
        || !isStringSuperset(
          evidence.obligation.effect.kinds,
          evidence.observation.effectKinds
        ))) return false;
  const { evidenceDigest: _evidenceDigest, ...canonicalEvidence } = evidence;
  return sha256(canonicalEvidence) === evidence.evidenceDigest;
}

function operationObligationIsSuperset(
  current: SourceProgramOperationObligationEvidence,
  baseline: SourceProgramOperationObligationEvidence
): boolean {
  if (operationIdentityKey(current.obligation.operation)
      !== operationIdentityKey(baseline.obligation.operation)
      || current.observation.status !== 'verified'
      || baseline.observation.status !== 'verified'
      || !isStringSuperset(
        current.obligation.consumerSupport.consumers,
        baseline.obligation.consumerSupport.consumers
      )
      || !isStringSuperset(current.obligation.effect.kinds, baseline.obligation.effect.kinds)
      || !isStringSuperset(
        current.obligation.effect.failureKinds,
        baseline.obligation.effect.failureKinds
      )
      || current.obligation.effect.recovery !== baseline.obligation.effect.recovery
      || current.obligation.evolution.migration !== baseline.obligation.evolution.migration
      || current.obligation.evolution.retirement !== baseline.obligation.evolution.retirement
      || current.obligation.futureSupport.condition
        !== baseline.obligation.futureSupport.condition) return false;
  const currentBudgets = new Map(current.obligation.resources.aggregateBudgets.map((budget) =>
    [budget.resource, budget.maximum] as const));
  return baseline.obligation.resources.aggregateBudgets.every(({ maximum, resource }) => {
    const currentMaximum = currentBudgets.get(resource);
    return currentMaximum !== undefined && currentMaximum <= maximum;
  });
}

function intentEnvelopeIsSuperset(
  current: SourceProgramOwnerIntentEvidence,
  baseline: SourceProgramOwnerIntentEvidence
): boolean {
  const currentCapabilities = new Map(current.capabilityEnvelope.map(({ capability, operations }) =>
    [capability, new Set(operations)] as const));
  const capabilitiesCovered = baseline.capabilityEnvelope.every(({ capability, operations }) => {
    const currentOperations = currentCapabilities.get(capability);
    return currentOperations !== undefined && operations.every((operation) =>
      currentOperations.has(operation));
  });
  const currentEntrypoints = new Set(current.publicEntrypointEnvelope.map((entrypoint) =>
    sha256(entrypoint)));
  return capabilitiesCovered
    && baseline.publicEntrypointEnvelope.every((entrypoint) =>
      currentEntrypoints.has(sha256(entrypoint)));
}

function sourceProgramIntentEvidenceDigest(
  evidence: readonly SourceProgramOwnerIntentEvidence[]
): string {
  return sha256([...evidence].sort((left, right) => compareCodeUnits(left.owner, right.owner)));
}

function sourceProgramSupersessionSemanticEvidenceDigest(
  evidence: SourceProgramSupersessionEvidence
): string {
  const {
    actionKey: _actionKey,
    identity: _identity,
    evidenceDigest: _evidenceDigest,
    ...semanticEvidence
  } = evidence;
  return sha256(semanticEvidence);
}

function ownerIntentOperationIdentities(
  intent: SourceProgramOwnerIntentEvidence
): readonly SourceProgramOperationObligationEvidence['obligation']['operation'][] {
  const operations = [
    ...intent.capabilityEnvelope.flatMap(({ capability, operations }) => operations.map((operation) =>
      Object.freeze({ kind: 'capability' as const, capability, operation }))),
    ...intent.publicEntrypointEnvelope.flatMap(({ targetPaths }) => targetPaths.map((path) =>
      Object.freeze({ kind: 'public-entrypoint' as const, path })))
  ];
  return Object.freeze([...new Map(operations.map((operation) =>
    [operationIdentityKey(operation), operation] as const)).values()]
    .sort((left, right) => compareCodeUnits(
      operationIdentityKey(left),
      operationIdentityKey(right)
    )));
}

function supersessionLifecycleCost(
  sourceUnknownCount: number,
  tests: readonly SourceProgramSupersessionTestUnit[],
  productionUnits: readonly SourceProgramSemanticUnit[]
): SourceProgramSupersessionLifecycleCost {
  return Object.freeze({
    productionUnits: new Set(productionUnits.map(({ id }) => id)).size,
    testUnits: new Set(tests.map(({ testId }) => testId)).size,
    owners: new Set(productionUnits.flatMap(({ owner }) => owner === null ? [] : [owner])).size,
    unresolvedObservations: sourceUnknownCount
      + tests.filter(({ unknowns }) => unknowns.length > 0).length,
    unobservedTestRisk: tests.reduce((risk, { semanticClasses }) => risk
      + (semanticClasses.includes('failure-boundary') ? 0 : 1)
      + (semanticClasses.includes('effect') ? 0 : 1), 0)
  });
}

function lifecycleCostIsNoWorse(
  current: SourceProgramSupersessionLifecycleCost,
  baseline: SourceProgramSupersessionLifecycleCost
): boolean {
  return current.productionUnits <= baseline.productionUnits
    && current.testUnits <= baseline.testUnits
    && current.owners <= baseline.owners
    && current.unresolvedObservations <= baseline.unresolvedObservations
    && current.unobservedTestRisk <= baseline.unobservedTestRisk;
}

function lifecycleCostIsLower(
  current: SourceProgramSupersessionLifecycleCost,
  baseline: SourceProgramSupersessionLifecycleCost
): boolean {
  return current.productionUnits < baseline.productionUnits
    || current.testUnits < baseline.testUnits
    || current.owners < baseline.owners
    || current.unresolvedObservations < baseline.unresolvedObservations
    || current.unobservedTestRisk < baseline.unobservedTestRisk;
}

function declarationSemanticAddress(
  declaration: SourceProgramDeclaration,
  moduleIdByPath: ReadonlyMap<string, string | null>
): Readonly<{
  moduleId: string | null;
  name: string;
  kind: string;
  declarationDigest: string;
}> {
  const moduleId = moduleIdByPath.get(declaration.path) ?? null;
  return Object.freeze({
    moduleId,
    name: declaration.name,
    kind: declaration.kind,
    declarationDigest: declaration.declarationDigest
  });
}

function referenceSemanticAddress(
  reference: SourceProgramReference,
  declarationById: ReadonlyMap<string, SourceProgramDeclaration>,
  moduleIdByPath: ReadonlyMap<string, string | null>
): Readonly<Record<string, unknown>> {
  const target = reference.targetObservationId === null
    ? null
    : declarationById.get(reference.targetObservationId) ?? null;
  return Object.freeze({
    kind: reference.kind,
    name: reference.name,
    target: target === null
      ? Object.freeze({
          moduleSpecifier: reference.moduleSpecifier,
          targetPath: reference.targetPath,
          observationClass: reference.observationClass
        })
      : declarationSemanticAddress(target, moduleIdByPath)
  });
}

function capabilitySemanticAddress(
  capability: SourceProgramCapabilityInvocation
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    capability: capability.capability,
    operation: capability.operation,
    subject: capability.subject,
    transport: capability.transport,
    moduleSpecifier: capability.moduleSpecifier,
    providerCapability: capability.providerCapability,
    providerModuleId: capability.providerModuleId,
    observationClass: capability.observationClass
  });
}

function sourceProgramRequiredProductionPaths(
  model: SourceProgramModel,
  operation: SourceProgramCompilationOperation
): ReadonlySet<string> {
  const required = new Set<string>();
  for (const closure of model.entrypointClosures) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    for (const path of [...closure.targetPaths, ...closure.reachablePaths, ...closure.capabilityPaths]) {
      required.add(path);
    }
  }
  for (const entrypoint of model.entrypoints) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    required.add(entrypoint.path);
    for (const path of entrypoint.targetPaths) required.add(path);
  }
  for (const capability of model.capabilities) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    required.add(capability.path);
  }
  for (const declaration of model.declarations) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    if (declaration.exported) required.add(declaration.path);
  }
  for (const reference of model.references) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    if (reference.targetPath !== null) required.add(reference.targetPath);
  }
  return required;
}

function compileSourceProgramSemanticUnits(
  model: SourceProgramModel,
  operation: SourceProgramCompilationOperation
): readonly SourceProgramSemanticUnit[] {
  const moduleIdByPath = new Map<string, string | null>();
  for (const file of model.files) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    if (!moduleIdByPath.has(file.path)) moduleIdByPath.set(file.path, file.moduleId);
  }
  const declarationById = new Map(model.declarations.map((declaration) =>
    [declaration.observationId, declaration] as const));
  const declarationsByPath = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of model.declarations) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    const declarations = declarationsByPath.get(declaration.path);
    if (declarations === undefined) declarationsByPath.set(declaration.path, [declaration]);
    else declarations.push(declaration);
  }
  const referencesByPath = new Map<string, SourceProgramReference[]>();
  for (const reference of model.references) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    const references = referencesByPath.get(reference.path);
    if (references === undefined) referencesByPath.set(reference.path, [reference]);
    else references.push(reference);
  }
  const capabilitiesByPath = new Map<string, SourceProgramCapabilityInvocation[]>();
  for (const capability of model.capabilities) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    const capabilities = capabilitiesByPath.get(capability.path);
    if (capabilities === undefined) capabilitiesByPath.set(capability.path, [capability]);
    else capabilities.push(capability);
  }
  const requiredPaths = sourceProgramRequiredProductionPaths(model, operation);
  const units: SourceProgramSemanticUnit[] = [];
  for (const file of model.files) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    if (file.surface !== 'production' || !requiredPaths.has(file.path)) continue;
    const owner = file.moduleId ?? null;
    const declarations = (declarationsByPath.get(file.path) ?? [])
      .map((declaration) => declarationSemanticAddress(declaration, moduleIdByPath));
    const references = (referencesByPath.get(file.path) ?? [])
      .map((reference) => referenceSemanticAddress(reference, declarationById, moduleIdByPath));
    const capabilities = (capabilitiesByPath.get(file.path) ?? [])
      .map(capabilitySemanticAddress);
    const semanticShape = Object.freeze({
      owner: owner ?? Object.freeze({ exactUnownedPath: file.path }),
      declarations,
      references,
      capabilities,
      fallbackContentDigest: declarations.length === 0
        && references.length === 0
        && capabilities.length === 0
        ? file.contentDigest
        : null
    });
    const signature = sha256(semanticShape);
    const occurrenceId = pathSemanticUnitOccurrenceId('production', file.path);
    units.push(Object.freeze({
      id: sha256({ kind: 'production', path: file.path, occurrenceId, signature }),
      occurrenceId,
      owner,
      path: file.path,
      signature
    }));
  }
  return Object.freeze(units.sort((left, right) =>
    compareCodeUnits(left.signature, right.signature)
    || compareCodeUnits(left.path, right.path)));
}

function compileSourceProgramResourceUnits(
  model: SourceProgramModel,
  operation: SourceProgramCompilationOperation
): readonly SourceProgramSemanticUnit[] {
  return Object.freeze(model.files
    .filter(({ surface }) => surface === 'resource' || surface === 'workflow')
    .map((file) => {
      sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
      const signature = sha256({
        path: file.path,
        contentDigest: file.contentDigest,
        moduleId: file.moduleId,
        surface: file.surface
      });
      const occurrenceId = pathSemanticUnitOccurrenceId('resource', file.path);
      return Object.freeze({
        id: sha256({ kind: 'resource', path: file.path, occurrenceId, signature }),
        occurrenceId,
        owner: file.moduleId,
        path: file.path,
        signature
      });
    })
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
}

function compileSourceProgramEntrypointUnits(
  model: SourceProgramModel,
  productionUnitByPath: ReadonlyMap<string, SourceProgramSemanticUnit>,
  operation: SourceProgramCompilationOperation
): readonly SourceProgramSemanticUnit[] {
  const closureByEntrypoint = new Map<string, SourceProgramModel['entrypointClosures'][number]>();
  for (const closure of model.entrypointClosures) {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    if (!closureByEntrypoint.has(closure.entrypointObservationId)) {
      closureByEntrypoint.set(closure.entrypointObservationId, closure);
    }
  }
  return Object.freeze(model.entrypoints.map((entrypoint) => {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    const closure = closureByEntrypoint.get(entrypoint.observationId);
    const targetSignatures = [...new Set([
      ...(closure?.targetPaths ?? []),
      ...(closure?.reachablePaths ?? [])
    ].flatMap((path) => {
      const unit = productionUnitByPath.get(path);
      return unit === undefined ? [] : [unit.signature];
    }))].sort(compareCodeUnits);
    const owner = [...new Set((closure?.handlerModuleIds ?? []))].sort(compareCodeUnits).join('+') || null;
    let commandShape = entrypoint.command;
    if (commandShape !== null) {
      for (const targetPath of [...entrypoint.targetPaths]
        .sort((left, right) => right.length - left.length || compareCodeUnits(left, right))) {
        const target = productionUnitByPath.get(targetPath);
        if (target === undefined) continue;
        commandShape = commandShape
          .replaceAll(`./${targetPath}`, `<target:${target.signature}>`)
          .replaceAll(targetPath, `<target:${target.signature}>`);
      }
    }
    const signature = sha256({
      kind: entrypoint.kind,
      name: entrypoint.name,
      commandShape,
      targetPackages: entrypoint.targetPackages,
      targetSignatures,
      transports: closure?.transports ?? [],
      providerModuleIds: closure?.providerModuleIds ?? [],
      observationClass: closure?.observationClass ?? entrypoint.observationClass
    });
    const occurrenceId = entrypoint.observationId;
    return Object.freeze({
      id: sha256({ kind: 'entrypoint', path: entrypoint.path, occurrenceId, signature }),
      occurrenceId,
      owner,
      path: entrypoint.path,
      signature
    });
  }).sort((left, right) => compareCodeUnits(left.signature, right.signature)
    || compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.occurrenceId, right.occurrenceId)));
}

function testBoundary(
  registration: Pick<SourceProgramTestRegistration,
    'semanticClasses' | 'observedProductionPaths' | 'capabilityOperations'>,
  productionRequirementIdByPath: ReadonlyMap<string, string>
): Readonly<{
  semanticClasses: readonly TestSemanticClass[];
  observedRequirementIds: readonly string[];
  capabilityOperations: readonly string[];
}> {
  return Object.freeze({
    semanticClasses: Object.freeze([...registration.semanticClasses].sort(compareCodeUnits)),
    observedRequirementIds: Object.freeze([...new Set(registration.observedProductionPaths
      .flatMap((path) => {
        const requirementId = productionRequirementIdByPath.get(path);
        return requirementId === undefined ? [] : [requirementId];
      }))].sort(compareCodeUnits)),
    capabilityOperations: Object.freeze([...registration.capabilityOperations].sort(compareCodeUnits))
  });
}

function supersessionEvidenceActionKey(
  identity: SourceProgramSupersessionEvidence['identity'],
  source: SourceProgramSupersessionEvidence['source']
): string {
  return sha256({ identity, source });
}

function semanticUnitsAreCanonical(
  units: readonly SourceProgramSemanticUnit[],
  kind: 'production' | 'resource' | 'entrypoint'
): boolean {
  if (new Set(units.map(({ id }) => id)).size !== units.length) return false;
  if (new Set(units.map(({ occurrenceId }) => occurrenceId)).size !== units.length) return false;
  if (units.some(({ id, occurrenceId, path, signature }) => !DIGEST.test(signature)
      || !DIGEST.test(occurrenceId)
      || (kind !== 'entrypoint' && occurrenceId !== pathSemanticUnitOccurrenceId(kind, path))
      || id !== sha256({ kind, path, occurrenceId, signature }))) return false;
  const sorted = [...units].sort((left, right) => kind === 'resource'
    ? compareCodeUnits(left.path, right.path)
    : compareCodeUnits(left.signature, right.signature)
      || compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.occurrenceId, right.occurrenceId));
  return sorted.every(({ id }, index) => id === units[index]?.id);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function sourceProgramSupersessionEvidenceHasExactGrammar(
  value: unknown
): value is SourceProgramSupersessionEvidence {
  const schema = SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA;
  if (!hasExactKeys(value, schema.evidenceKeys)
      || !hasExactKeys(value.identity, schema.identityKeys)
      || !hasExactKeys(value.source, schema.sourceKeys)
      || !Array.isArray(value.productionUnits)
      || !Array.isArray(value.resourceUnits)
      || !Array.isArray(value.entrypointUnits)
      || !Array.isArray(value.tests)
      || !Array.isArray(value.intentEvidence)
      || !Array.isArray(value.unknowns)) return false;
  const semanticUnits = [
    ...value.productionUnits,
    ...value.resourceUnits,
    ...value.entrypointUnits
  ];
  return semanticUnits.every((unit) => hasExactKeys(unit, schema.semanticUnitKeys))
    && value.tests.every((test) => hasExactKeys(test, schema.testUnitKeys))
    && value.unknowns.every((unknown) => hasExactKeys(unknown, schema.unknownKeys))
    && value.intentEvidence.every((intent) => hasExactKeys(intent, schema.intentKeys)
      && Array.isArray(intent.capabilityEnvelope)
      && intent.capabilityEnvelope.every((capability) =>
        hasExactKeys(capability, schema.capabilityIntentKeys))
      && Array.isArray(intent.publicEntrypointEnvelope)
      && intent.publicEntrypointEnvelope.every((entrypoint) =>
        hasExactKeys(entrypoint, schema.entrypointIntentKeys)
        && Array.isArray(entrypoint.targetPackages)
        && Array.isArray(entrypoint.targetPaths)
        && Array.isArray(entrypoint.transports))
      && Array.isArray(intent.operationObligations)
      && intent.operationObligations.every((obligation) =>
        operationObligationEvidenceIsExact(obligation)));
}

function sourceProgramSupersessionEvidenceIsExact(
  value: unknown
): value is SourceProgramSupersessionEvidence {
  if (!sourceProgramSupersessionEvidenceHasExactGrammar(value)) return false;
  const evidence = value;
  if (!DIGEST.test(evidence.actionKey)
      || !DIGEST.test(evidence.evidenceDigest)
      || !Object.values(evidence.identity).every((value) => DIGEST.test(value))
      || evidence.identity.schemaDigest !== SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA_DIGEST
      || !Object.values(evidence.source).every((value) => DIGEST.test(value))
      || evidence.actionKey !== supersessionEvidenceActionKey(evidence.identity, evidence.source)
      || !semanticUnitsAreCanonical(evidence.productionUnits, 'production')
      || !semanticUnitsAreCanonical(evidence.resourceUnits, 'resource')
      || !semanticUnitsAreCanonical(evidence.entrypointUnits, 'entrypoint')
      || evidence.intentEvidence.some((ownerEvidence) => !ownerIntentEvidenceIsExact(ownerEvidence))
      || new Set(evidence.intentEvidence.map(({ owner }) => owner)).size !== evidence.intentEvidence.length
      || evidence.source.intentEvidenceDigest
        !== sourceProgramIntentEvidenceDigest(evidence.intentEvidence)
      || new Set(evidence.tests.map(({ testId }) => testId)).size !== evidence.tests.length
      || evidence.tests.some(({ testId }) => !DIGEST.test(testId))) return false;
  const canonicalIntent = [...evidence.intentEvidence]
    .sort((left, right) => compareCodeUnits(left.owner, right.owner));
  const canonicalTests = [...evidence.tests]
    .sort((left, right) => compareCodeUnits(left.testId, right.testId));
  const canonicalUnknowns = [...evidence.unknowns]
    .sort((left, right) => compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.code, right.code)
      || compareCodeUnits(left.detail, right.detail));
  if (canonicalIntent.some(({ evidenceDigest }, index) =>
      evidenceDigest !== evidence.intentEvidence[index]?.evidenceDigest)
      || canonicalTests.some(({ testId }, index) => testId !== evidence.tests[index]?.testId)
      || canonicalUnknowns.some((unknown, index) =>
        sha256(unknown) !== sha256(evidence.unknowns[index]))) return false;
  const { evidenceDigest: _evidenceDigest, ...canonicalEvidence } = evidence;
  return sha256(canonicalEvidence) === evidence.evidenceDigest;
}

/** Accept one cached compact receipt only after replaying its strict grammar and digests. */
export function parseSourceProgramSupersessionEvidence(
  value: unknown
): SourceProgramSupersessionEvidence {
  if (!sourceProgramSupersessionEvidenceIsExact(value)) {
    throw new Error('Source Program supersession evidence is not canonical or action-bound');
  }
  return Object.freeze(value);
}

/**
 * Project one exact Source Program revision into the only facts that the
 * supersession decision consumes.  Callers may then release the Program,
 * TypeChecker and full Test Value graph and cache this receipt by actionKey.
 */
export function compileSourceProgramSupersessionEvidence(
  input: CompileSourceProgramSupersessionEvidenceInput
): SourceProgramSupersessionEvidence {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'supersession-evidence', 'start');
  const invalidOwnerIntent = input.intentEvidence.find((evidence) =>
    !ownerIntentEvidenceIsExact(evidence));
  const inputFailures = [
    ...(!sourceProgramModelEvidenceIsExact(input.model) ? ['model'] : []),
    ...(!sourceProgramTestEvidenceIsExact(input.tests) ? ['tests'] : []),
    ...(input.model.sourceRevision !== input.tests.sourceRevision ? ['source-revision'] : []),
    ...(invalidOwnerIntent === undefined ? [] : [`owner-intent:${invalidOwnerIntent.owner}`]),
    ...(new Set(input.intentEvidence.map(({ owner }) => owner)).size
      === input.intentEvidence.length ? [] : ['duplicate-owner-intent']),
    ...(Object.values(input.identity).every((value) => DIGEST.test(value))
      ? [] : ['identity-digest']),
    ...(input.identity.schemaDigest === SOURCE_PROGRAM_SUPERSESSION_EVIDENCE_SCHEMA_DIGEST
      ? [] : ['schema-digest'])
  ];
  if (inputFailures.length > 0) {
    throw new Error(
      `Source Program supersession evidence requires exact revision-bound inputs: ${inputFailures.join(', ')}`
    );
  }
  const productionUnits = compileSourceProgramSemanticUnits(input.model, operation);
  sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
  const productionUnitByPath = new Map(productionUnits.map((unit) => [unit.path, unit] as const));
  const intentEvidence = Object.freeze(input.intentEvidence.map((evidence) => {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    return evidence;
  }).sort((left, right) => compareCodeUnits(left.owner, right.owner)));
  const identity = Object.freeze({
    sourceRevision: input.model.sourceRevision,
    ...input.identity
  });
  const source = Object.freeze({
    modelDigest: input.model.modelDigest,
    testCompilationDigest: input.tests.compilationDigest,
    intentEvidenceDigest: sourceProgramIntentEvidenceDigest(intentEvidence)
  });
  const tests = Object.freeze(input.tests.records.map((registration) => {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    return Object.freeze({
      testId: registration.testId,
      path: registration.path,
      semanticClasses: Object.freeze([...registration.semanticClasses].sort(compareCodeUnits)),
      observedProductionPaths: Object.freeze([...registration.observedProductionPaths]
        .sort(compareCodeUnits)),
      capabilityOperations: Object.freeze([...registration.capabilityOperations]
        .sort(compareCodeUnits)),
      unknowns: Object.freeze([...registration.unknowns].sort(compareCodeUnits))
    });
  }).sort((left, right) => compareCodeUnits(left.testId, right.testId)));
  const unknowns = Object.freeze(input.model.unknowns.map(({ code, path, detail }) => {
    sourceProgramCompilationCheckpoint(operation, 'supersession-evidence');
    return Object.freeze({ code, path, detail });
  }).sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.detail, right.detail)));
  const canonicalEvidence = Object.freeze({
    actionKey: supersessionEvidenceActionKey(identity, source),
    identity,
    source,
    productionUnits,
    resourceUnits: compileSourceProgramResourceUnits(input.model, operation),
    entrypointUnits: compileSourceProgramEntrypointUnits(input.model, productionUnitByPath, operation),
    tests,
    intentEvidence,
    unknowns
  });
  sourceProgramCompilationCheckpoint(operation, 'supersession-evidence', 'complete');
  return Object.freeze({
    ...canonicalEvidence,
    evidenceDigest: sha256(canonicalEvidence)
  });
}

function isStringSuperset(current: readonly string[], baseline: readonly string[]): boolean {
  const currentValues = new Set(current);
  return baseline.every((value) => currentValues.has(value));
}

function supersessionFinding(
  code: SourceProgramSupersessionFindingCode,
  detail: string,
  input: Partial<Pick<SourceProgramSupersessionFinding,
    'baselineId' | 'owner' | 'baselinePaths' | 'currentCandidateIds'>> = {}
): SourceProgramSupersessionFinding {
  return Object.freeze({
    code,
    baselineId: input.baselineId ?? null,
    owner: input.owner ?? null,
    baselinePaths: Object.freeze([...(input.baselinePaths ?? [])].sort(compareCodeUnits)),
    currentCandidateIds: Object.freeze([...(input.currentCandidateIds ?? [])].sort(compareCodeUnits)),
    detail
  });
}

function finalizeSourceProgramSupersessionReceipt(
  input: CompileSourceProgramSupersessionInput,
  status: SourceProgramSupersessionStatus,
  lifecycleCost: Readonly<{
    baseline: SourceProgramSupersessionLifecycleCost;
    current: SourceProgramSupersessionLifecycleCost;
  }>,
  replacements: readonly SourceProgramSupersessionReplacement[],
  findings: readonly SourceProgramSupersessionFinding[]
): SourceProgramSupersessionReceipt {
  const canonicalReceipt = Object.freeze({
    status,
    baseline: Object.freeze({
      sourceRevision: input.baseline.identity.sourceRevision,
      modelDigest: input.baseline.source.modelDigest,
      testCompilationDigest: input.baseline.source.testCompilationDigest,
      intentEvidenceDigest: input.baseline.source.intentEvidenceDigest
    }),
    current: Object.freeze({
      sourceRevision: input.current.identity.sourceRevision,
      modelDigest: input.current.source.modelDigest,
      testCompilationDigest: input.current.source.testCompilationDigest,
      intentEvidenceDigest: input.current.source.intentEvidenceDigest
    }),
    lifecycleCost: Object.freeze(lifecycleCost),
    replacements: Object.freeze(replacements),
    findings: Object.freeze(findings)
  });
  const receipt = Object.freeze({
    ...canonicalReceipt,
    receiptDigest: sha256(canonicalReceipt)
  });
  compiledSourceProgramSupersessionReceipts.add(receipt);
  return receipt;
}

/**
 * Prove that a candidate retains every statically observable baseline
 * capability.  The compiler is intentionally one-way and conservative: it
 * can prove exact semantic obligations and stronger test observations, but it
 * cannot infer arbitrary behavioral equivalence from similar names, paths or
 * bytes.  Unresolved evidence is therefore an owner decision, never a PASS.
 */
export function compileSourceProgramSupersessionReceipt(
  input: CompileSourceProgramSupersessionInput
): SourceProgramSupersessionReceipt {
  const compilationOperation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt', 'start');
  const findings: SourceProgramSupersessionFinding[] = [];
  const baselineIsExact = sourceProgramSupersessionEvidenceIsExact(input.baseline);
  const currentIsExact = sourceProgramSupersessionEvidenceIsExact(input.current);
  if (!baselineIsExact) {
    findings.push(supersessionFinding(
      'baseline-evidence-invalid',
      'baseline compact evidence must be exact, content-addressed, canonical, and action-bound'
    ));
  }
  if (!currentIsExact) {
    findings.push(supersessionFinding(
      'current-evidence-invalid',
      'current compact evidence must be exact, content-addressed, canonical, and action-bound'
    ));
  }

  if (baselineIsExact
      && currentIsExact
      && sourceProgramSupersessionSemanticEvidenceDigest(input.baseline)
        === sourceProgramSupersessionSemanticEvidenceDigest(input.current)) {
    const replacements = [
      ...input.baseline.productionUnits.map((unit) => Object.freeze({
        kind: 'production' as const,
        baselineId: unit.id,
        currentIds: Object.freeze([unit.id]),
        owner: unit.owner,
        baselinePaths: Object.freeze([unit.path]),
        currentPaths: Object.freeze([unit.path]),
        proof: 'exact-semantic-obligation' as const
      })),
      ...input.baseline.resourceUnits.map((unit) => Object.freeze({
        kind: 'resource' as const,
        baselineId: unit.id,
        currentIds: Object.freeze([unit.id]),
        owner: unit.owner,
        baselinePaths: Object.freeze([unit.path]),
        currentPaths: Object.freeze([unit.path]),
        proof: 'exact-semantic-obligation' as const
      })),
      ...input.baseline.entrypointUnits.map((unit) => Object.freeze({
        kind: 'entrypoint' as const,
        baselineId: unit.id,
        currentIds: Object.freeze([unit.id]),
        owner: unit.owner,
        baselinePaths: Object.freeze([unit.path]),
        currentPaths: Object.freeze([unit.path]),
        proof: 'exact-semantic-obligation' as const
      })),
      ...input.baseline.tests.map((test) => Object.freeze({
        kind: 'test' as const,
        baselineId: test.testId,
        currentIds: Object.freeze([test.testId]),
        owner: null,
        baselinePaths: Object.freeze([test.path]),
        currentPaths: Object.freeze([test.path]),
        proof: 'exact-semantic-obligation' as const
      }))
    ].sort((left, right) => compareCodeUnits(left.kind, right.kind)
      || compareCodeUnits(left.baselineId, right.baselineId));
    const baselineLifecycleCost = supersessionLifecycleCost(
      input.baseline.unknowns.length,
      input.baseline.tests,
      input.baseline.productionUnits
    );
    const currentLifecycleCost = supersessionLifecycleCost(
      input.current.unknowns.length,
      input.current.tests,
      input.current.productionUnits
    );
    const receipt = finalizeSourceProgramSupersessionReceipt(
      input,
      'equivalent',
      Object.freeze({ baseline: baselineLifecycleCost, current: currentLifecycleCost }),
      replacements,
      Object.freeze([])
    );
    sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt', 'complete');
    return receipt;
  }

  for (const [side, evidence] of [
    ['baseline', input.baseline],
    ['current', input.current]
  ] as const) {
    for (const unknown of evidence.unknowns) {
      findings.push(supersessionFinding(
        'dynamic-or-external-observation-unresolved',
        `${side} observation ${unknown.code} is unresolved: ${unknown.detail}`,
        { baselinePaths: [unknown.path] }
      ));
    }
  }

  const baselineProduction = input.baseline.productionUnits;
  const currentProduction = input.current.productionUnits;
  const baselineIntentByOwner = new Map(input.baseline.intentEvidence.map((evidence) =>
    [evidence.owner, evidence] as const));
  const currentIntentByOwner = new Map(input.current.intentEvidence.map((evidence) =>
    [evidence.owner, evidence] as const));
  const currentProductionBySignature = new Map<string, SourceProgramSemanticUnit[]>();
  for (const unit of currentProduction) {
    const candidates = currentProductionBySignature.get(unit.signature) ?? [];
    candidates.push(unit);
    currentProductionBySignature.set(unit.signature, candidates);
  }
  const replacements: SourceProgramSupersessionReplacement[] = [];
  const currentRequirementIdByPath = new Map<string, string>();
  for (const baselineUnit of baselineProduction) {
    const candidates = currentProductionBySignature.get(baselineUnit.signature) ?? [];
    const exactPath = candidates.find(({ path }) => path === baselineUnit.path);
    const selected = exactPath ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (selected === undefined) {
      findings.push(supersessionFinding(
        candidates.length === 0
          ? 'required-production-behavior-missing'
          : 'replacement-ambiguous',
        candidates.length === 0
          ? 'no current production unit proves the same owner, declarations, resolved dependencies, and capabilities'
          : 'multiple current production units have the same semantic shape; path/byte similarity cannot choose authority',
        {
          baselineId: baselineUnit.id,
          owner: baselineUnit.owner,
          baselinePaths: [baselineUnit.path],
          currentCandidateIds: candidates.map(({ id }) => id)
        }
      ));
      continue;
    }
    currentRequirementIdByPath.set(selected.path, baselineUnit.id);
    replacements.push(Object.freeze({
      kind: 'production',
      baselineId: baselineUnit.id,
      currentIds: Object.freeze([selected.id]),
      owner: baselineUnit.owner,
      baselinePaths: Object.freeze([baselineUnit.path]),
      currentPaths: Object.freeze([selected.path]),
      proof: 'exact-semantic-obligation'
    }));
  }

  const baselineResources = input.baseline.resourceUnits;
  const currentResourceBySignature = new Map(input.current.resourceUnits
    .map((unit) => [unit.signature, unit] as const));
  for (const baselineUnit of baselineResources) {
    const currentUnit = currentResourceBySignature.get(baselineUnit.signature);
    if (currentUnit === undefined) {
      findings.push(supersessionFinding(
        'required-resource-missing',
        'resource bytes, repository address, surface, or owner changed without a semantic migration proof',
        {
          baselineId: baselineUnit.id,
          owner: baselineUnit.owner,
          baselinePaths: [baselineUnit.path]
        }
      ));
      continue;
    }
    replacements.push(Object.freeze({
      kind: 'resource',
      baselineId: baselineUnit.id,
      currentIds: Object.freeze([currentUnit.id]),
      owner: baselineUnit.owner,
      baselinePaths: Object.freeze([baselineUnit.path]),
      currentPaths: Object.freeze([currentUnit.path]),
      proof: 'exact-semantic-obligation'
    }));
  }

  const baselineEntrypoints = input.baseline.entrypointUnits;
  const currentEntrypointsBySignature = new Map<string, SourceProgramSemanticUnit[]>();
  for (const unit of input.current.entrypointUnits) {
    const candidates = currentEntrypointsBySignature.get(unit.signature) ?? [];
    candidates.push(unit);
    currentEntrypointsBySignature.set(unit.signature, candidates);
  }
  const baselineEntrypointsBySignature = new Map<string, SourceProgramSemanticUnit[]>();
  for (const unit of baselineEntrypoints) {
    const candidates = baselineEntrypointsBySignature.get(unit.signature) ?? [];
    candidates.push(unit);
    baselineEntrypointsBySignature.set(unit.signature, candidates);
  }
  const selectedCurrentEntrypointIdByBaselineId = new Map<string, string>();
  const reservedCurrentEntrypointIds = new Set<string>();
  for (const baselineUnit of baselineEntrypoints) {
    const exactOccurrences = (currentEntrypointsBySignature.get(baselineUnit.signature) ?? [])
      .filter(({ occurrenceId }) => occurrenceId === baselineUnit.occurrenceId);
    if (exactOccurrences.length !== 1) continue;
    selectedCurrentEntrypointIdByBaselineId.set(baselineUnit.id, exactOccurrences[0]!.id);
    reservedCurrentEntrypointIds.add(exactOccurrences[0]!.id);
  }
  const unmatchedBaselineEntrypointsBySignaturePath = new Map<string, SourceProgramSemanticUnit[]>();
  const unmatchedCurrentEntrypointsBySignaturePath = new Map<string, SourceProgramSemanticUnit[]>();
  for (const unit of baselineEntrypoints) {
    if (selectedCurrentEntrypointIdByBaselineId.has(unit.id)) continue;
    const key = `${unit.signature}\0${unit.path}`;
    const candidates = unmatchedBaselineEntrypointsBySignaturePath.get(key) ?? [];
    candidates.push(unit);
    unmatchedBaselineEntrypointsBySignaturePath.set(key, candidates);
  }
  for (const unit of input.current.entrypointUnits) {
    if (reservedCurrentEntrypointIds.has(unit.id)) continue;
    const key = `${unit.signature}\0${unit.path}`;
    const candidates = unmatchedCurrentEntrypointsBySignaturePath.get(key) ?? [];
    candidates.push(unit);
    unmatchedCurrentEntrypointsBySignaturePath.set(key, candidates);
  }
  for (const [key, baselineCandidates] of unmatchedBaselineEntrypointsBySignaturePath) {
    const currentCandidates = unmatchedCurrentEntrypointsBySignaturePath.get(key) ?? [];
    if (baselineCandidates.length !== 1 || currentCandidates.length !== 1) continue;
    selectedCurrentEntrypointIdByBaselineId.set(
      baselineCandidates[0]!.id,
      currentCandidates[0]!.id
    );
    reservedCurrentEntrypointIds.add(currentCandidates[0]!.id);
  }
  for (const [signature, baselineCandidates] of baselineEntrypointsBySignature) {
    const unmatchedBaseline = baselineCandidates.filter(({ id }) => (
      !selectedCurrentEntrypointIdByBaselineId.has(id)
    ));
    const unmatchedCurrent = (currentEntrypointsBySignature.get(signature) ?? []).filter(({ id }) => (
      !reservedCurrentEntrypointIds.has(id)
    ));
    if (unmatchedBaseline.length !== 1 || unmatchedCurrent.length !== 1) continue;
    selectedCurrentEntrypointIdByBaselineId.set(
      unmatchedBaseline[0]!.id,
      unmatchedCurrent[0]!.id
    );
    reservedCurrentEntrypointIds.add(unmatchedCurrent[0]!.id);
  }
  const currentEntrypointById = new Map(input.current.entrypointUnits.map((unit) => (
    [unit.id, unit] as const
  )));
  for (const baselineUnit of baselineEntrypoints) {
    const candidates = currentEntrypointsBySignature.get(baselineUnit.signature) ?? [];
    const selectedCurrentId = selectedCurrentEntrypointIdByBaselineId.get(baselineUnit.id);
    const currentUnit = selectedCurrentId === undefined
      ? undefined
      : currentEntrypointById.get(selectedCurrentId);
    if (currentUnit === undefined) {
      findings.push(supersessionFinding(
        candidates.length === 0
          ? 'required-entrypoint-missing'
          : 'replacement-ambiguous',
        candidates.length === 0
          ? 'no current entrypoint proves the same public command, semantic target closure, provider, and capability transport'
          : 'multiple current entrypoint occurrences have the same semantic shape; source order cannot choose authority',
        {
          baselineId: baselineUnit.id,
          owner: baselineUnit.owner,
          baselinePaths: [baselineUnit.path],
          currentCandidateIds: candidates.map(({ id }) => id)
        }
      ));
      continue;
    }
    replacements.push(Object.freeze({
      kind: 'entrypoint',
      baselineId: baselineUnit.id,
      currentIds: Object.freeze([currentUnit.id]),
      owner: baselineUnit.owner,
      baselinePaths: Object.freeze([baselineUnit.path]),
      currentPaths: Object.freeze([currentUnit.path]),
      proof: 'exact-semantic-obligation'
    }));
  }

  const evolutionOwners = new Set<string>();
  let unownedEvolution = false;
  for (const [baselineUnits, currentUnits] of [
    [baselineProduction, currentProduction],
    [baselineResources, input.current.resourceUnits],
    [baselineEntrypoints, input.current.entrypointUnits]
  ] as const) {
    for (const baselineUnit of baselineUnits) {
      if (currentUnits.some(({ id, path }) => (
        id === baselineUnit.id && path === baselineUnit.path
      ))) continue;
      if (baselineUnit.owner === null) unownedEvolution = true;
      else evolutionOwners.add(baselineUnit.owner);
    }
  }
  if (unownedEvolution) {
    findings.push(supersessionFinding(
      'design-intent-unresolved',
      'a removed or replaced production surface has no canonical module owner; observations cannot invent its evolution obligations'
    ));
  }
  for (const owner of [...evolutionOwners].sort(compareCodeUnits)) {
    const baselineIntent = baselineIntentByOwner.get(owner);
    const currentIntent = currentIntentByOwner.get(owner);
    if (baselineIntent === undefined) {
      findings.push(supersessionFinding(
        'design-intent-unresolved',
        'the affected canonical owner has no machine-issued design intent',
        { owner }
      ));
      continue;
    }
    const requiredOperations = ownerIntentOperationIdentities(baselineIntent);
    // Internal modules without a public operation remain ordinary graph facts.
    // An obligation envelope is mandatory only when a public operation is
    // actually being removed or replaced.
    if (requiredOperations.length === 0) continue;
    if (currentIntent === undefined || !intentEnvelopeIsSuperset(currentIntent, baselineIntent)) {
      findings.push(supersessionFinding(
        'design-intent-regressed',
        'the current owner does not preserve the affected capability and public-entrypoint identity envelope',
        { owner }
      ));
    }
    const baselineObligations = new Map(baselineIntent.operationObligations.map((evidence) =>
      [operationIdentityKey(evidence.obligation.operation), evidence] as const));
    const currentObligations = new Map((currentIntent?.operationObligations ?? []).map((evidence) =>
      [operationIdentityKey(evidence.obligation.operation), evidence] as const));
    for (const operation of requiredOperations) {
      const operationKey = operationIdentityKey(operation);
      const baselineObligation = baselineObligations.get(operationKey);
      const currentObligation = currentObligations.get(operationKey);
      const reason = baselineObligation === undefined
        ? 'baseline owner has not issued an evolution obligation for this public operation'
        : baselineObligation.observation.status !== 'verified'
          ? `baseline operation observation is ${baselineObligation.observation.reason}`
          : currentObligation === undefined
            ? 'current owner has not issued the corresponding evolution obligation'
            : currentObligation.observation.status !== 'verified'
              ? `current operation observation is ${currentObligation.observation.reason}`
              : !operationObligationIsSuperset(currentObligation, baselineObligation)
                ? 'current operation widens resources or drops consumer, failure, recovery, migration, retirement, or future-support obligations'
                : null;
      if (reason !== null) {
        findings.push(supersessionFinding(
          'operation-obligation-unresolved',
          `${operationKey}: ${reason}`,
          { baselineId: sha256(operation), owner }
        ));
      }
    }
  }

  const baselineRequirementIdByPath = new Map(baselineProduction.map((unit) =>
    [unit.path, unit.id] as const));
  const availableCurrentTestIds = new Set(input.current.tests.map(({ testId }) => testId));
  const baselineTestBoundaryById = new Map(input.baseline.tests
    .filter(({ unknowns }) => unknowns.length === 0)
    .map((test) => {
      sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt');
      return [test.testId, testBoundary(test, baselineRequirementIdByPath)] as const;
    }));
  const currentTestBoundaryById = new Map(input.current.tests
    .filter(({ unknowns }) => unknowns.length === 0)
    .map((test) => {
      sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt');
      return [test.testId, testBoundary(test, currentRequirementIdByPath)] as const;
    }));
  const currentTestsByPath = new Map<string, SourceProgramSupersessionTestUnit[]>();
  const currentTestsById = input.current.tests
    .filter(({ testId, unknowns }) => (
      availableCurrentTestIds.has(testId) && unknowns.length === 0
    ))
    .sort((left, right) => compareCodeUnits(left.testId, right.testId));
  for (const test of currentTestsById) {
    const tests = currentTestsByPath.get(test.path) ?? [];
    tests.push(test);
    currentTestsByPath.set(test.path, tests);
  }
  const currentTestById = new Map(currentTestsById.map((test) => [test.testId, test] as const));
  const currentTestsByBoundaryToken = new Map<string, SourceProgramSupersessionTestUnit[]>();
  const boundaryTokens = (
    boundary: ReturnType<typeof testBoundary>
  ): readonly string[] => Object.freeze([
    ...boundary.semanticClasses.map((value) => `class\0${value}`),
    ...boundary.observedRequirementIds.map((value) => `requirement\0${value}`),
    ...boundary.capabilityOperations.map((value) => `capability\0${value}`)
  ]);
  for (const test of currentTestsById) {
    const boundary = currentTestBoundaryById.get(test.testId)!;
    for (const token of boundaryTokens(boundary)) {
      const tests = currentTestsByBoundaryToken.get(token) ?? [];
      tests.push(test);
      currentTestsByBoundaryToken.set(token, tests);
    }
  }
  const indexedCurrentTests = (
    baselineBoundary: ReturnType<typeof testBoundary>
  ): readonly SourceProgramSupersessionTestUnit[] => {
    const postings = boundaryTokens(baselineBoundary)
      .map((token) => currentTestsByBoundaryToken.get(token) ?? [])
      .sort((left, right) => left.length - right.length);
    return postings[0] ?? currentTestsById;
  };
  const boundaryIsSuperset = (
    currentTest: SourceProgramSupersessionTestUnit,
    baselineBoundary: ReturnType<typeof testBoundary>
  ): boolean => {
    sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt');
    if (!availableCurrentTestIds.has(currentTest.testId)) return false;
    const currentBoundary = currentTestBoundaryById.get(currentTest.testId);
    return currentBoundary !== undefined
      && isStringSuperset(currentBoundary.semanticClasses, baselineBoundary.semanticClasses)
      && isStringSuperset(
        currentBoundary.observedRequirementIds,
        baselineBoundary.observedRequirementIds
      )
      && isStringSuperset(
        currentBoundary.capabilityOperations,
        baselineBoundary.capabilityOperations
      );
  };
  for (const baselineTest of input.baseline.tests) {
    sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt');
    if (baselineTest.unknowns.length > 0) {
      findings.push(supersessionFinding(
        'dynamic-or-external-observation-unresolved',
        `baseline test boundary is unresolved: ${baselineTest.unknowns.join(',')}`,
        { baselineId: baselineTest.testId, baselinePaths: [baselineTest.path] }
      ));
      continue;
    }
    const baselineBoundary = baselineTestBoundaryById.get(baselineTest.testId)!;
    const exactId = currentTestById.get(baselineTest.testId);
    const currentTest = (exactId !== undefined && boundaryIsSuperset(exactId, baselineBoundary)
      ? exactId
      : undefined)
      ?? (currentTestsByPath.get(baselineTest.path) ?? [])
      .find((candidate) => boundaryIsSuperset(candidate, baselineBoundary))
      ?? indexedCurrentTests(baselineBoundary)
        .find((candidate) => boundaryIsSuperset(candidate, baselineBoundary));
    if (currentTest === undefined) {
      findings.push(supersessionFinding(
        'required-test-boundary-missing',
        'no unused current canonical testId observes a semantic superset of this behavior/effect/failure boundary',
        {
          baselineId: baselineTest.testId,
          baselinePaths: [baselineTest.path],
          currentCandidateIds: []
        }
      ));
      continue;
    }
    availableCurrentTestIds.delete(currentTest.testId);
    const currentBoundary = currentTestBoundaryById.get(currentTest.testId)!;
    const exactBoundary = sha256(currentBoundary) === sha256(baselineBoundary);
    replacements.push(Object.freeze({
      kind: 'test',
      baselineId: baselineTest.testId,
      currentIds: Object.freeze([currentTest.testId]),
      owner: null,
      baselinePaths: Object.freeze([baselineTest.path]),
      currentPaths: Object.freeze([currentTest.path]),
      proof: exactBoundary ? 'exact-semantic-obligation' : 'strict-observation-superset'
    }));
  }

  findings.sort((left, right) => compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.baselineId ?? '', right.baselineId ?? '')
    || compareCodeUnits(left.baselinePaths.join('\0'), right.baselinePaths.join('\0')));
  replacements.sort((left, right) => compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.baselineId, right.baselineId));
  const selectedCurrentProductionIds = new Set(replacements
    .filter(({ kind }) => kind === 'production')
    .flatMap(({ currentIds }) => currentIds));
  const selectedCurrentTestIds = new Set(replacements
    .filter(({ kind }) => kind === 'test')
    .flatMap(({ currentIds }) => currentIds));
  const selectedCurrentProduction = currentProduction.filter(({ id }) =>
    selectedCurrentProductionIds.has(id));
  const selectedCurrentTests = input.current.tests.filter(({ testId }) =>
    selectedCurrentTestIds.has(testId));
  const baselineLifecycleCost = supersessionLifecycleCost(
    input.baseline.unknowns.length,
    input.baseline.tests,
    baselineProduction
  );
  const currentLifecycleCost = supersessionLifecycleCost(
    input.current.unknowns.length,
    selectedCurrentTests,
    selectedCurrentProduction
  );
  const stronger = replacements.some(({ proof }) => proof === 'strict-observation-superset')
    || input.baseline.intentEvidence.some((baselineIntent) => {
      const currentIntent = currentIntentByOwner.get(baselineIntent.owner);
      return currentIntent !== undefined
        && intentEnvelopeIsSuperset(currentIntent, baselineIntent)
        && currentIntent.evidenceDigest !== baselineIntent.evidenceDigest;
    });
  if (stronger && (!lifecycleCostIsNoWorse(currentLifecycleCost, baselineLifecycleCost)
      || !lifecycleCostIsLower(currentLifecycleCost, baselineLifecycleCost))) {
    findings.push(supersessionFinding(
      'lifecycle-cost-not-reduced',
      'a stronger replacement may be useful, but it cannot be called supersession until its selected implementation/test/owner/uncertainty lifecycle cost is strictly lower'
    ));
  }
  const status: SourceProgramSupersessionStatus = findings.length > 0
    ? 'owner-decision-required'
    : stronger ? 'superseded' : 'equivalent';
  const receipt = finalizeSourceProgramSupersessionReceipt(
    input,
    status,
    Object.freeze({ baseline: baselineLifecycleCost, current: currentLifecycleCost }),
    replacements,
    findings
  );
  sourceProgramCompilationCheckpoint(compilationOperation, 'supersession-receipt', 'complete');
  return receipt;
}

type SourceProgramTestRetirementBlockReason =
  | 'consumer-closure-not-empty'
  | 'observation-obligation-not-empty'
  | 'source-evidence-unresolved';

interface SourceProgramTestRetirementProof {
  readonly path: string;
  readonly status: 'retired' | 'blocked';
  readonly reason: SourceProgramTestRetirementBlockReason | null;
  readonly baselineTestIds: readonly string[];
  readonly census: Readonly<{
    readonly producerCount: number;
    readonly consumerCount: number;
    readonly externalContractCount: number;
  }>;
  readonly observationClasses: readonly TestSemanticClass[];
  readonly consumerEvidence: readonly string[];
  readonly unknownEvidence: readonly string[];
  readonly proofDigest: string;
}

export interface SourceProgramTestRetirementReceipt {
  readonly baselineSourceRevision: string;
  readonly currentSourceRevision: string;
  readonly baselineActionKey: string;
  readonly currentActionKey: string;
  readonly baselineTestPathsDigest: string;
  readonly baselineRegistrationCensusDigest: string;
  readonly currentRegistrationCensusDigest: string;
  readonly currentTestCompilationDigest: string;
  readonly supersessionReceiptDigest: string;
  readonly proofs: readonly SourceProgramTestRetirementProof[];
  readonly receiptDigest: string;
}

export interface CompileSourceProgramTestRetirementReceiptInput {
  readonly baseline: SourceProgramSupersessionEvidence;
  readonly current: SourceProgramSupersessionEvidence;
  readonly supersession: SourceProgramSupersessionReceipt;
  readonly currentModel: SourceProgramModel;
  readonly currentTestCompilation: SourceProgramTestValueCompilation;
  /** Exact tracked baseline bytes, not a caller-authored zero census. */
  readonly baselineFiles: readonly WorkspaceSourceFile[];
  /** Exact current bytes compiled into currentModel/currentTestCompilation. */
  readonly currentFiles: readonly WorkspaceSourceFile[];
  readonly operation?: SourceProgramCompilationOperation;
}

export interface SourceProgramTestRetirementDispositionProjection
  extends Omit<SourceProgramTestDispositionProjection, 'projectionDigest'> {
  readonly retirementReceiptDigest: string;
  readonly projectionDigest: string;
}

const compiledSourceProgramTestRetirementReceipts = new WeakSet<object>();

function supersessionReceiptBindsEvidence(
  receipt: SourceProgramSupersessionReceipt,
  baseline: SourceProgramSupersessionEvidence,
  current: SourceProgramSupersessionEvidence
): boolean {
  const { receiptDigest: _receiptDigest, ...canonical } = receipt;
  return DIGEST.test(receipt.receiptDigest)
    && sha256(canonical) === receipt.receiptDigest
    && receipt.baseline.sourceRevision === baseline.identity.sourceRevision
    && receipt.baseline.modelDigest === baseline.source.modelDigest
    && receipt.baseline.testCompilationDigest === baseline.source.testCompilationDigest
    && receipt.baseline.intentEvidenceDigest === baseline.source.intentEvidenceDigest
    && receipt.current.sourceRevision === current.identity.sourceRevision
    && receipt.current.modelDigest === current.source.modelDigest
    && receipt.current.testCompilationDigest === current.source.testCompilationDigest
    && receipt.current.intentEvidenceDigest === current.source.intentEvidenceDigest;
}

function sourceProgramTestPathConsumerIndex(
  model: SourceProgramModel,
  testPaths: readonly string[],
  knownPaths: ReadonlySet<string>,
  operation: SourceProgramCompilationOperation
): ReadonlyMap<string, readonly string[]> {
  const consumersByPath = new Map(testPaths.map((path) => [path, new Set<string>()] as const));
  const addConsumer = (path: string, consumer: string): void => {
    consumersByPath.get(path)?.add(consumer);
  };
  for (const reference of model.references) {
    sourceProgramCompilationCheckpoint(operation, 'test-retirement');
    if (reference.targetPath !== null) {
      addConsumer(reference.targetPath, `reference:${reference.path}:${reference.kind}`);
    }
  }
  for (const entrypoint of model.entrypoints) {
    sourceProgramCompilationCheckpoint(operation, 'test-retirement');
    for (const targetPath of entrypoint.targetPaths) {
      addConsumer(targetPath, `entrypoint:${entrypoint.kind}:${entrypoint.name}`);
    }
  }
  for (const closure of model.entrypointClosures) {
    sourceProgramCompilationCheckpoint(operation, 'test-retirement');
    for (const targetPath of [...closure.targetPaths, ...closure.reachablePaths]) {
      addConsumer(targetPath, `entrypoint-closure:${closure.entrypointObservationId}`);
    }
  }
  for (const literal of model.literals) {
    sourceProgramCompilationCheckpoint(operation, 'test-retirement');
    const consumer = `path-literal:${literal.path}`;
    addConsumer(literal.value, consumer);
    const resolvedTarget = resolveRelativeModulePath(literal.path, literal.value, knownPaths);
    if (resolvedTarget !== null) addConsumer(resolvedTarget, consumer);
  }
  return new Map([...consumersByPath].map(([path, consumers]) => [
    path,
    Object.freeze([...consumers].sort(compareCodeUnits))
  ] as const));
}

/**
 * Sign consumer-zero test retirement from sealed baseline/current facts.  A
 * syntactic zero census is necessary but never sufficient: the canonical
 * model, registration observations, supersession receipt, exact bytes and all
 * unknown frontiers must also close before one per-path proof is retired.
 * Only removed baseline modules require retirement; retained registrations
 * remain subject to Test Value and Supersession rather than a deletion proof.
 */
export function compileSourceProgramTestRetirementReceipt(
  input: CompileSourceProgramTestRetirementReceiptInput
): SourceProgramTestRetirementReceipt {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'test-retirement', 'start');
  const baselineRevision = compileWorkspaceSourceRevision(input.baselineFiles);
  const currentRevision = compileWorkspaceSourceRevision(input.currentFiles);
  const sealFailures = [
    ...(!sourceProgramSupersessionEvidenceIsExact(input.baseline) ? ['baseline-evidence'] : []),
    ...(!sourceProgramSupersessionEvidenceIsExact(input.current) ? ['current-evidence'] : []),
    ...(!sourceProgramModelEvidenceIsExact(input.currentModel) ? ['current-model'] : []),
    ...(!sourceProgramTestEvidenceIsExact(input.currentTestCompilation) ? ['current-tests'] : []),
    ...(baselineRevision !== input.baseline.identity.sourceRevision ? ['baseline-source-revision'] : []),
    ...(currentRevision !== input.current.identity.sourceRevision ? ['current-source-revision'] : []),
    ...(input.currentModel.sourceRevision !== currentRevision ? ['model-source-revision'] : []),
    ...(input.currentModel.modelDigest !== input.current.source.modelDigest ? ['model-digest'] : []),
    ...(input.currentTestCompilation.sourceRevision !== currentRevision ? ['test-source-revision'] : []),
    ...(input.currentTestCompilation.compilationDigest
      !== input.current.source.testCompilationDigest ? ['test-compilation-digest'] : []),
    ...(!supersessionReceiptBindsEvidence(
      input.supersession,
      input.baseline,
      input.current
    ) ? ['supersession-receipt'] : [])
  ];
  if (sealFailures.length > 0) {
    throw new Error(
      `Test retirement requires sealed baseline/current Source Program evidence: ${sealFailures.join(', ')}`
    );
  }
  if (!compiledSourceProgramSupersessionReceipts.has(input.supersession)) {
    throw new Error(
      'Test retirement requires the exact Supersession decision recomputed from sealed evidence'
    );
  }
  const baselineTestPaths = Object.freeze(input.baselineFiles
    .map(({ path }) => path)
    .filter(isRepositoryTestModulePath)
    .sort(compareCodeUnits));
  if (sha256(baselineTestPaths) !== sha256(input.currentTestCompilation.baselineTestPaths)) {
    throw new Error('Test retirement tracked baseline differs from Test Value compilation');
  }
  const currentTestPaths = new Set(input.currentFiles
    .map(({ path }) => path)
    .filter(isRepositoryTestModulePath));
  const supersessionDisposition = reconcileSourceProgramTestValueWithSupersession(
    input.currentTestCompilation,
    input.supersession
  );
  const resolvedTestPaths = new Set(supersessionDisposition.dispositions
    .filter(({ disposition, evidence }) => disposition === 'rewrite'
      || (disposition === 'merge'
        && evidence.supersession?.receiptDigest === input.supersession.receiptDigest))
    .map(({ path }) => path));
  const removedTestPaths = baselineTestPaths.filter((testPath) =>
    !currentTestPaths.has(testPath) && !resolvedTestPaths.has(testPath));
  const knownPaths = new Set([
    ...input.baselineFiles.map(({ path }) => path),
    ...input.currentFiles.map(({ path }) => path)
  ]);
  const censusByPath = new Map(input.currentTestCompilation.dispositions.map((disposition) => [
    disposition.path,
    disposition.evidence.census
  ] as const));
  const baselineTestsByPath = new Map<string, SourceProgramSupersessionTestUnit[]>();
  for (const test of input.baseline.tests) {
    const tests = baselineTestsByPath.get(test.path) ?? [];
    tests.push(test);
    baselineTestsByPath.set(test.path, tests);
  }
  const currentTestsByPath = new Map<string, SourceProgramSupersessionTestUnit[]>();
  for (const test of input.current.tests) {
    const tests = currentTestsByPath.get(test.path) ?? [];
    tests.push(test);
    currentTestsByPath.set(test.path, tests);
  }
  const globalUnknowns = Object.freeze([
    ...input.baseline.unknowns.map(({ code, path }) => `baseline:${path}:${code}`),
    ...input.current.unknowns.map(({ code, path }) => `current:${path}:${code}`)
  ].sort(compareCodeUnits));
  const supersessionUnknowns = input.supersession.status === 'owner-decision-required'
    ? Object.freeze(input.supersession.findings.map(({ code }) => `supersession:${code}`)
      .sort(compareCodeUnits))
    : Object.freeze([] as string[]);
  const modelConsumersByTestPath = sourceProgramTestPathConsumerIndex(
    input.currentModel,
    removedTestPaths,
    knownPaths,
    operation
  );
  const proofs = removedTestPaths.map((testPath) => {
    sourceProgramCompilationCheckpoint(operation, 'test-retirement');
    const census = censusByPath.get(testPath) ?? Object.freeze({
      producerCount: 0,
      consumerCount: 0,
      externalContractCount: 1
    });
    const baselineTests = Object.freeze([...(baselineTestsByPath.get(testPath) ?? [])]
      .sort((left, right) => compareCodeUnits(left.testId, right.testId)));
    const currentTests = Object.freeze([...(currentTestsByPath.get(testPath) ?? [])]
      .sort((left, right) => compareCodeUnits(left.testId, right.testId)));
    const observationClasses = Object.freeze([...new Set(baselineTests
      .flatMap(({ semanticClasses }) => semanticClasses))].sort(compareCodeUnits));
    const observationConsumers = Object.freeze([...new Set(baselineTests.flatMap((test) => [
      ...test.observedProductionPaths.map((path) => `observed-production:${path}`),
      ...test.capabilityOperations.map((operation) => `capability:${operation}`)
    ]))].sort(compareCodeUnits));
    const consumerEvidence = Object.freeze([
      ...(modelConsumersByTestPath.get(testPath) ?? []),
      ...observationConsumers,
      ...currentTests.map(({ testId }) => `current-registration:${testId}`)
    ].sort(compareCodeUnits));
    const unknownEvidence = Object.freeze([
      ...globalUnknowns,
      ...supersessionUnknowns,
      ...baselineTests.flatMap(({ testId, unknowns }) =>
        unknowns.map((unknown) => `baseline-registration:${testId}:${unknown}`)),
      ...currentTests.flatMap(({ testId, unknowns }) =>
        unknowns.map((unknown) => `current-registration:${testId}:${unknown}`))
    ].sort(compareCodeUnits));
    const censusIsZero = census.producerCount === 0
      && census.consumerCount === 0
      && census.externalContractCount === 0;
    const reason: SourceProgramTestRetirementBlockReason | null = !censusIsZero || consumerEvidence.length > 0
        ? 'consumer-closure-not-empty'
        : observationClasses.length > 0
          ? 'observation-obligation-not-empty'
          : unknownEvidence.length > 0
            ? 'source-evidence-unresolved'
            : null;
    const canonicalProof = Object.freeze({
      path: testPath,
      status: reason === null ? 'retired' as const : 'blocked' as const,
      reason,
      baselineTestIds: Object.freeze(baselineTests.map(({ testId }) => testId)),
      census,
      observationClasses,
      consumerEvidence,
      unknownEvidence
    });
    return Object.freeze({ ...canonicalProof, proofDigest: sha256(canonicalProof) });
  });
  const canonicalReceipt = Object.freeze({
    baselineSourceRevision: input.baseline.identity.sourceRevision,
    currentSourceRevision: input.current.identity.sourceRevision,
    baselineActionKey: input.baseline.actionKey,
    currentActionKey: input.current.actionKey,
    baselineTestPathsDigest: sha256(baselineTestPaths),
    baselineRegistrationCensusDigest: sha256(input.baseline.tests),
    currentRegistrationCensusDigest: sha256(input.current.tests),
    currentTestCompilationDigest: input.currentTestCompilation.compilationDigest,
    supersessionReceiptDigest: input.supersession.receiptDigest,
    proofs: Object.freeze(proofs)
  });
  const receipt = Object.freeze({
    ...canonicalReceipt,
    receiptDigest: sha256(canonicalReceipt)
  });
  sourceProgramCompilationCheckpoint(operation, 'test-retirement', 'complete');
  compiledSourceProgramTestRetirementReceipts.add(receipt);
  return receipt;
}

/**
 * One-way terminal projection.  The receipt does not consume dispositions,
 * and the derived DELETE projection cannot be fed back into Supersession.
 */
export function projectSourceProgramTestRetirementDispositions(
  projection: SourceProgramTestDispositionProjection,
  receipt: SourceProgramTestRetirementReceipt
): SourceProgramTestRetirementDispositionProjection {
  if (!compiledSourceProgramTestRetirementReceipts.has(receipt)
      || receipt.currentSourceRevision !== projection.sourceRevision
      || receipt.currentTestCompilationDigest !== projection.observationCompilationDigest
      || receipt.baselineTestPathsDigest !== sha256(projection.baselineTestPaths)) {
    throw new Error('Test retirement projection requires one compiler-issued exact receipt');
  }
  const retiredByPath = new Map(receipt.proofs
    .filter(({ status }) => status === 'retired')
    .map((proof) => [proof.path, proof] as const));
  const resolvedPaths = new Set<string>();
  const dispositions = projection.dispositions.map((disposition) => {
    const proof = disposition.disposition === 'unknown'
      ? retiredByPath.get(disposition.path)
      : undefined;
    if (proof === undefined) return disposition;
    resolvedPaths.add(disposition.path);
    const evidence = Object.freeze({
      owner: 'source-program-reduction',
      sourceRevision: projection.sourceRevision,
      replacementTestIds: Object.freeze([] as string[]),
      census: proof.census,
      ownerDecisionDigest: null,
      supersession: Object.freeze({
        receiptDigest: receipt.receiptDigest,
        baselineTestId: proof.baselineTestIds.length === 1
          ? proof.baselineTestIds[0]!
          : sha256({ path: proof.path, testIds: proof.baselineTestIds }),
        proof: 'consumer-zero' as const
      })
    });
    const canonicalDisposition = Object.freeze({
      path: disposition.path,
      disposition: 'delete' as const,
      evidence,
      baselineDigest: disposition.baselineDigest
    });
    return Object.freeze({
      ...canonicalDisposition,
      evidenceDigest: sha256(canonicalDisposition)
    }) satisfies SourceProgramTestDisposition;
  });
  const findings = projection.findings.filter((finding) => !(
    resolvedPaths.has(finding.path)
    && finding.code === 'test-module-disposition-unknown'
  ));
  const canonicalProjection = Object.freeze({
    sourceRevision: projection.sourceRevision,
    baselineTestPaths: projection.baselineTestPaths,
    baselineDigest: projection.baselineDigest,
    baselineEvidenceDigest: projection.baselineEvidenceDigest,
    dispositions: Object.freeze(dispositions),
    findings: Object.freeze(findings),
    observationCompilationDigest: projection.observationCompilationDigest,
    supersessionReceiptDigest: projection.supersessionReceiptDigest,
    retirementReceiptDigest: receipt.receiptDigest
  });
  return Object.freeze({
    ...canonicalProjection,
    projectionDigest: sha256(canonicalProjection)
  });
}

const VERSIONED_DECLARATION_NAME = /^(.*?)(?:_?V)([1-9][0-9]*)$/u;

function spanFor(sourceFile: ts.SourceFile, start: number, end: number): SourceProgramSpan {
  const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
  const endLocation = sourceFile.getLineAndCharacterOfPosition(end);
  return Object.freeze({
    start,
    end,
    startLine: startLocation.line + 1,
    startColumn: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1
  });
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isOmittedExpression(element)
    ? []
    : bindingNames(element.name));
}

function sourceFileHasTopLevelBinding(
  sourceFile: ts.SourceFile,
  name: string,
  exceptImport: ts.ImportSpecifier
): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.name?.text === name) return true;
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings) && bindings.name.text === name) {
        return true;
      }
      if (bindings !== undefined && ts.isNamedImports(bindings)
          && bindings.elements.some((element) => element !== exceptImport && element.name.text === name)) {
        return true;
      }
      continue;
    }
    if (ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) =>
          bindingNames(declaration.name).includes(name))) return true;
    const declarationName = (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
      || ts.isModuleDeclaration(statement)
    ) ? statement.name : undefined;
    if (declarationName !== undefined && ts.isIdentifier(declarationName)
        && declarationName.text === name) {
      return true;
    }
  }
  return false;
}

function graphCutNode(
  sourceFile: ts.SourceFile,
  name: string,
  declarationSpan: SourceProgramSpan
): ts.Node | null {
  let match: ts.Node | null = null;
  const visit = (node: ts.Node): void => {
    if (match !== null || node.getStart(sourceFile, false) > declarationSpan.end
      || node.getEnd() < declarationSpan.start) return;
    const named = node as ts.NamedDeclaration;
    if (named.name && ts.isIdentifier(named.name) && named.name.text === name
      && node.getStart(sourceFile, false) === declarationSpan.start
      && node.getEnd() === declarationSpan.end) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return match;
}

function graphCutRemovalNode(node: ts.Node): ts.Node | null {
  if (ts.isVariableDeclaration(node)) {
    const list = node.parent;
    const statement = list?.parent;
    return ts.isVariableDeclarationList(list)
      && list.declarations.length === 1
      && statement !== undefined
      && ts.isVariableStatement(statement)
      && ts.isSourceFile(statement.parent)
      ? statement
      : null;
  }
  return (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isModuleDeclaration(node)
  ) && ts.isSourceFile(node.parent)
    ? node
    : null;
}

function graphCutRemovalSpan(sourceFile: ts.SourceFile, node: ts.Node): SourceProgramSpan {
  const tokenStart = node.getStart(sourceFile, false);
  const lineStart = sourceFile.text.lastIndexOf('\n', Math.max(0, tokenStart - 1)) + 1;
  const start = /^\s*$/u.test(sourceFile.text.slice(lineStart, tokenStart))
    ? lineStart
    : tokenStart;
  let end = node.getEnd();
  if (sourceFile.text.startsWith('\r\n', end)) end += 2;
  else if (sourceFile.text[end] === '\n' || sourceFile.text[end] === '\r') end += 1;
  return spanFor(sourceFile, start, end);
}

function relativeModuleSpecifier(fromPath: string, targetPath: string): string {
  const relative = nodePath.posix.relative(nodePath.posix.dirname(fromPath), targetPath);
  return relative.startsWith('.') ? relative : `./${relative}`;
}

function pureAggregateModulePaths(model: SourceProgramModel): ReadonlySet<string> {
  return new Set(model.files
    .filter(({ semanticKind }) => semanticKind === 'pure-reexport')
    .map(({ path }) => path));
}

function resolveRelativeModulePath(
  sourcePath: string,
  moduleSpecifier: string,
  knownPaths: ReadonlySet<string>
): string | null {
  if (!moduleSpecifier.startsWith('.')) return null;
  const base = nodePath.posix.normalize(nodePath.posix.join(
    nodePath.posix.dirname(sourcePath),
    moduleSpecifier
  ));
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    nodePath.posix.join(base, 'index.ts'),
    nodePath.posix.join(base, 'index.tsx'),
    nodePath.posix.join(base, 'index.mts'),
    nodePath.posix.join(base, 'index.cts')
  ]) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function sourceSnapshotIdentity(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[]
): Readonly<{
  sourceRevision: string;
  modelDigest: string;
  files: readonly Readonly<{ path: string; contentDigest: string }>[];
}> {
  return Object.freeze({
    sourceRevision: model.sourceRevision,
    modelDigest: model.modelDigest,
    files: Object.freeze([...files]
      .map(({ path, source }) => Object.freeze({ path, contentDigest: rawSha256(source) }))
      .sort((left, right) => compareCodeUnits(left.path, right.path)))
  });
}

function sourceFileSnapshotDigest(files: readonly SourceProgramFileInput[]): string {
  return sha256(Object.freeze([...files]
    .map(({ path, source }) => Object.freeze({ path, contentDigest: rawSha256(source) }))
    .sort((left, right) => compareCodeUnits(left.path, right.path))));
}

function sourceFilesBindModel(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[]
): boolean {
  const modelFiles = [...model.files]
    .map(({ path, contentDigest }) => Object.freeze({ path, contentDigest }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  const inputFiles = [...files]
    .map(({ path, source }) => Object.freeze({ path, contentDigest: rawSha256(source) }))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
  return new Set(inputFiles.map(({ path }) => path)).size === inputFiles.length
    && sha256(modelFiles) === sha256(inputFiles);
}

/**
 * Seal one completed Knip observation against the exact Source Program input.
 * The receipt remains candidate evidence only: it can narrow which declarations
 * need retirement review, but it cannot close an unknown consumer frontier.
 */
export function compileSourceProgramUnusedSymbolProviderReceipt(
  input: CompileSourceProgramUnusedSymbolProviderReceiptInput
): SourceProgramUnusedSymbolProviderReceipt {
  if (!sourceProgramModelEvidenceIsExact(input.model)
      || !sourceFilesBindModel(input.model, input.files)
      || !DIGEST.test(input.providerRevision)
      || input.settlement !== 'completed'
      || input.configuration.isShowProgress !== false
      || input.configuration.includedIssueTypes.length !== 2
      || input.configuration.includedIssueTypes[0] !== 'exports'
      || input.configuration.includedIssueTypes[1] !== 'types') {
    throw new SourceProgramReductionAdmissionError(
      'compiler-issued-plan-required',
      'Unused-symbol provider evidence requires one completed exact-snapshot provider observation'
    );
  }
  const candidates = Object.freeze([...input.candidates]
    .map(({ path, name }) => Object.freeze({ path, name }))
    .sort((left, right) => compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.name, right.name)));
  if (candidates.some(({ path, name }) => path.length === 0
      || path.startsWith('/')
      || path.includes('\\')
      || path.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
      || name.trim().length === 0)
      || new Set(candidates.map(({ path, name }) => `${path}\0${name}`)).size !== candidates.length) {
    throw new SourceProgramReductionAdmissionError(
      'compiler-issued-plan-required',
      'Unused-symbol provider candidates are not canonical repository symbols'
    );
  }
  const sourceSnapshotDigest = sourceFileSnapshotDigest(input.files);
  const canonical = Object.freeze({
    schema: 'source-program-unused-symbol-provider-receipt-v1' as const,
    provider: 'knip' as const,
    providerRevision: input.providerRevision,
    settlement: input.settlement,
    sourceRevision: input.model.sourceRevision,
    sourceSnapshotDigest,
    configurationDigest: sha256(input.configuration),
    inputDigest: sha256(sourceSnapshotIdentity(input.model, input.files)),
    candidateDigest: sha256(candidates),
    candidates
  });
  const receipt = Object.freeze({ ...canonical, receiptDigest: sha256(canonical) });
  compiledUnusedSymbolProviderReceipts.add(receipt);
  return receipt;
}

function assertReductionSourceSnapshot(
  expectedDigest: string,
  files: readonly SourceProgramFileInput[]
): void {
  if (sourceFileSnapshotDigest(files) !== expectedDigest) {
    throw new SourceProgramReductionAdmissionError(
      'source-snapshot-drift',
      'Reduction patch source bytes do not match the compiler-sealed Source Program snapshot'
    );
  }
}

/**
 * Resolve broad barrel imports through the compiler-owned symbol graph. The
 * plan never guesses a public path: each imported/exported binding must map to
 * one exact exported declaration. Filesystem segment names do not declare
 * semantic visibility; TypeScript's exported symbol graph does.
 */
export function compileSourceProgramAggregateImportReductionPlan(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[],
  architectureSnapshot: SourceProgramArchitectureSnapshot,
  context: SourceProgramReductionCompilerContext
): SourceProgramAggregateImportReductionPlan {
  const operation = resolveSourceProgramCompilationOperation(context.operation);
  sourceProgramCompilationCheckpoint(operation, 'reduction-plan', 'start');
  if (architectureSnapshot.sourceRevision !== model.sourceRevision) {
    throw new SourceProgramReductionAdmissionError(
      'source-snapshot-drift',
      'Aggregate import reduction architecture does not bind the Source Program revision'
    );
  }
  const sourceSnapshotDigest = sourceFileSnapshotDigest(files);
  const typeScriptModel = exactReductionTypeScriptModel(model, context);
  const architectureDigest = sha256(architectureSnapshot.architecture);
  const snapshotReason = model.unknowns.some(({ code }) =>
    code === 'working-tree-changed-during-source-program-census')
    ? 'source snapshot changed during Source Program compilation'
    : null;
  const sourceByPath = new Map(files.map(({ path, source }) => [path, source] as const));
  const knownPaths = new Set(sourceByPath.keys());
  const aggregatePaths = pureAggregateModulePaths(model);
  const declarationById = new Map(model.declarations.map((declaration) =>
    [declaration.observationId, declaration] as const));
  const moduleByPath = new Map(model.files.map((file) => [file.path, file.moduleId] as const));
  const referencesByPath = new Map<string, SourceProgramModel['references'][number][]>();
  for (const reference of model.references) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const current = referencesByPath.get(reference.path) ?? [];
    current.push(reference);
    referencesByPath.set(reference.path, current);
  }
  const reductions: SourceProgramAggregateImportReduction[] = [];
  for (const path of sourceByPath.keys()) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    if (!/\.[cm]?[jt]sx?$/iu.test(path)) continue;
    const sourceFile = typeScriptSourceFile(typeScriptModel, path);
    if (sourceFile === null) {
      throw new SourceProgramReductionAdmissionError(
        'compiler-issued-plan-required',
        `Aggregate import reduction lacks exact compiler syntax: ${path}`
      );
    }
    for (const statement of sourceFile.statements) {
      sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
      if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
          || statement.moduleSpecifier === undefined
          || !ts.isStringLiteralLike(statement.moduleSpecifier)
          || !aggregatePaths.has(resolveRelativeModulePath(
            path,
            statement.moduleSpecifier.text,
            knownPaths
          ) ?? '')) continue;
      const moduleSpecifier = statement.moduleSpecifier.text;
      const bindings = ts.isImportDeclaration(statement)
        ? statement.importClause?.namedBindings !== undefined
          && ts.isNamedImports(statement.importClause.namedBindings)
          ? statement.importClause.namedBindings.elements
          : null
        : statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements
          : null;
      const statementReferences = (referencesByPath.get(path) ?? []).filter((reference) =>
        reference.moduleSpecifier === moduleSpecifier
        && reference.span.start >= statement.getStart(sourceFile, false)
        && reference.span.end <= statement.getEnd());
      const sourceModuleId = moduleByPath.get(path) ?? null;
      const importedModuleIds = new Set(statementReferences
        .map(({ targetPath }) => targetPath === null ? null : moduleByPath.get(targetPath) ?? null)
        .filter((moduleId): moduleId is string => moduleId !== null));
      if (sourceModuleId !== null && importedModuleIds.size === 1
          && importedModuleIds.has(sourceModuleId)) continue;
      const resolved = new Map<string, { targetPath: string; text: string }[]>();
      let reason: string | null = bindings === null
        ? 'aggregate default, namespace, side-effect, or star imports require an explicit owner surface'
        : null;
      if (bindings !== null) {
        for (const binding of bindings) {
          sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
          const reference = statementReferences.find((candidate) =>
            candidate.span.start >= binding.getStart(sourceFile, false)
            && candidate.span.end <= binding.getEnd());
          const declaration = reference?.targetObservationId === null
            || reference?.targetObservationId === undefined
            ? undefined
            : declarationById.get(reference.targetObservationId);
          if (declaration === undefined || declaration.exported !== true || declaration.path === path
              || /(?:^|\/)index\.[cm]?[jt]sx?$/u.test(declaration.path)) {
            reason = 'aggregate binding does not resolve to one exported declaration owner';
            break;
          }
          const entries = resolved.get(declaration.path) ?? [];
          entries.push({ targetPath: declaration.path, text: binding.getText(sourceFile) });
          resolved.set(declaration.path, entries);
        }
      }
      const replacementText = reason !== null ? null : [...resolved]
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([targetPath, entries]) => {
          const keyword = ts.isImportDeclaration(statement) ? 'import' : 'export';
          const typeOnly = ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly === true
            ? ' type' : ts.isExportDeclaration(statement) && statement.isTypeOnly ? ' type' : '';
          return `${keyword}${typeOnly} { ${entries.map(({ text }) => text).join(', ')} } from '${relativeModuleSpecifier(path, targetPath)}';`;
        }).join('\n');
      const reductionReason = reason ?? snapshotReason;
      reductions.push(Object.freeze({
        status: reductionReason === null ? 'ready' : 'blocked',
        path,
        moduleSpecifier,
        statementSpan: spanFor(sourceFile, statement.getStart(sourceFile, false), statement.getEnd()),
        replacementText: reductionReason === null ? replacementText : null,
        targetPaths: Object.freeze([...resolved.keys()].sort(compareCodeUnits)),
        reason: reductionReason
      }));
    }
  }
  reductions.sort((left, right) => compareCodeUnits(left.path, right.path)
    || left.statementSpan.start - right.statementSpan.start);
  const plan = Object.freeze({
    sourceRevision: model.sourceRevision,
    sourceSnapshotDigest,
    architectureDigest,
    snapshotStatus: snapshotReason === null ? 'sealed' : 'blocked',
    snapshotReason,
    planDigest: sha256({
      snapshot: sourceSnapshotIdentity(model, files),
      architectureDigest,
      snapshotReason,
      reductions
    }),
    reductions: Object.freeze(reductions)
  });
  sourceProgramCompilationCheckpoint(operation, 'reduction-plan', 'complete');
  compiledAggregateImportReductionPlans.add(plan);
  return plan;
}

export function buildSourceProgramAggregateImportReductionPatch(
  plan: SourceProgramAggregateImportReductionPlan,
  files: readonly SourceProgramFileInput[]
): SourceProgramAggregateImportReductionPatch {
  if (!compiledAggregateImportReductionPlans.has(plan)) {
    throw new SourceProgramReductionAdmissionError(
      'compiler-issued-plan-required',
      'Aggregate import patch requires a compiler-issued plan'
    );
  }
  assertReductionSourceSnapshot(plan.sourceSnapshotDigest, files);
  const sourceByPath = new Map(files.map(({ path, source }) => [path, source] as const));
  const editsByPath = new Map<string, SourceProgramAggregateImportReduction[]>();
  for (const reduction of plan.reductions) {
    if (reduction.status !== 'ready') continue;
    const edits = editsByPath.get(reduction.path) ?? [];
    edits.push(reduction);
    editsByPath.set(reduction.path, edits);
  }
  const patches: string[] = [];
  const changedFiles: { path: string; beforeDigest: string; afterDigest: string }[] = [];
  for (const [path, edits] of [...editsByPath].sort(([left], [right]) => compareCodeUnits(left, right))) {
    const source = sourceByPath.get(path);
    if (source === undefined) throw new Error(`aggregate import source is unavailable: ${path}`);
    let replacement = source;
    for (const edit of [...edits].sort((left, right) => right.statementSpan.start - left.statementSpan.start)) {
      replacement = replacement.slice(0, edit.statementSpan.start)
        + edit.replacementText!
        + replacement.slice(edit.statementSpan.end);
    }
    if (replacement === source) continue;
    patches.push(createTwoFilesPatch(`a/${path}`, `b/${path}`, source, replacement, '', '', { context: 3 }));
    changedFiles.push({ path, beforeDigest: rawSha256(source), afterDigest: rawSha256(replacement) });
  }
  const patch = patches.join('');
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    planDigest: plan.planDigest,
    patchDigest: rawSha256(patch),
    patch,
    files: Object.freeze(changedFiles)
  });
}

function graphCutVirtualFiles(
  files: readonly SourceProgramFileInput[],
  reductions: readonly SourceProgramGraphCutReduction[]
): readonly SourceProgramFileInput[] {
  const editsByPath = new Map<string, SourceProgramGraphCutReduction[]>();
  for (const reduction of reductions) {
    if (reduction.status !== 'ready' || reduction.removalSpan === null) continue;
    const edits = editsByPath.get(reduction.path) ?? [];
    edits.push(reduction);
    editsByPath.set(reduction.path, edits);
  }
  return Object.freeze(files.map((file) => {
    const edits = [...(editsByPath.get(file.path) ?? [])].sort((left, right) =>
      right.removalSpan!.start - left.removalSpan!.start);
    if (edits.length === 0) return file;
    let source = file.source;
    for (const edit of edits) {
      source = `${source.slice(0, edit.removalSpan!.start)}${source.slice(edit.removalSpan!.end)}`;
    }
    if (source.length > 0) source = `${source.replace(/[\t \r\n]+$/u, '')}\n`;
    return Object.freeze({
      ...file,
      source,
      contentDigest: rawSha256(source)
    });
  }));
}

function graphCutSemanticProjection(
  model: SourceProgramModel,
  excludedDeclarationIds: ReadonlySet<string>
): Readonly<{
  declarations: readonly unknown[];
  references: readonly unknown[];
  entrypoints: readonly unknown[];
  entrypointClosures: readonly unknown[];
  capabilities: readonly unknown[];
}> {
  const declarationsById = new Map(model.declarations.map((declaration) =>
    [declaration.observationId, declaration] as const));
  const declarationIdentity = (declaration: SourceProgramDeclaration): unknown => ({
    declarationDigest: declaration.declarationDigest,
    exported: declaration.exported,
    kind: declaration.kind,
    moduleId: declaration.moduleId,
    name: declaration.name,
    path: declaration.path
  });
  const sorted = <Value>(values: readonly Value[]): readonly Value[] => Object.freeze(
    [...values].sort((left, right) => compareCodeUnits(JSON.stringify(left), JSON.stringify(right)))
  );
  return Object.freeze({
    declarations: sorted(model.declarations
      .filter(({ observationId }) => !excludedDeclarationIds.has(observationId))
      .map(declarationIdentity)),
    references: sorted(model.references.map((reference) => ({
      kind: reference.kind,
      moduleSpecifier: reference.moduleSpecifier,
      name: reference.name,
      observationClass: reference.observationClass,
      path: reference.path,
      target: reference.targetObservationId === null
        ? null
        : declarationsById.has(reference.targetObservationId)
          ? declarationIdentity(declarationsById.get(reference.targetObservationId)!)
          : { unresolvedObservationId: reference.targetObservationId },
      targetPath: reference.targetPath
    }))),
    entrypoints: sorted(model.entrypoints.map(({
      observationId: _observationId,
      span: _span,
      ...entrypoint
    }) => entrypoint)),
    entrypointClosures: sorted(model.entrypointClosures.map(({
      entrypointObservationId: _entrypointObservationId,
      ...closure
    }) => closure)),
    capabilities: sorted(model.capabilities.map(({ span: _span, ...capability }) => capability))
  });
}

function graphCutNewDiagnosticReason(
  baseline: ReturnType<typeof compileTypeScriptDiagnosticSnapshot>,
  virtual: ReturnType<typeof compileTypeScriptDiagnosticSnapshot>
): string | null {
  const counts = new Map<string, number>();
  for (const diagnostic of baseline.diagnostics) {
    const key = JSON.stringify(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const diagnostic of virtual.diagnostics) {
    const key = JSON.stringify(diagnostic);
    const remaining = counts.get(key) ?? 0;
    if (remaining === 0) {
      return `virtual graph cut introduces TypeScript diagnostic ${diagnostic.code} at ${diagnostic.path ?? '<global>'}`;
    }
    counts.set(key, remaining - 1);
  }
  return null;
}

/**
 * Combines the canonical Program/TypeChecker consumer closure with Knip's
 * independent unused-export graph. All preliminary cuts are then applied to
 * one virtual exact snapshot and recompiled by the same Source Program owner.
 */
export function compileSourceProgramGraphCutReductionPlan(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[],
  unusedSymbols: SourceProgramUnusedSymbolProviderReceipt,
  context: SourceProgramReductionCompilerContext
): SourceProgramGraphCutReductionPlan {
  const operation = resolveSourceProgramCompilationOperation(context.operation);
  sourceProgramCompilationCheckpoint(operation, 'reduction-plan', 'start');
  const sourceSnapshotDigest = sourceFileSnapshotDigest(files);
  const typeScriptModel = exactReductionTypeScriptModel(model, context);
  if (!compiledUnusedSymbolProviderReceipts.has(unusedSymbols)
      || unusedSymbols.sourceRevision !== model.sourceRevision
      || unusedSymbols.sourceSnapshotDigest !== sourceSnapshotDigest
      || unusedSymbols.candidateDigest !== sha256(unusedSymbols.candidates)) {
    throw new SourceProgramReductionAdmissionError(
      'compiler-issued-plan-required',
      'Graph-cut reduction requires one compiler-issued exact provider candidate receipt'
    );
  }
  const sourceFileByPath = new Map<string, ts.SourceFile | null>();
  const candidateCodes = new Set([
    'production-declaration-without-consumer',
    'identity-token-without-consumer'
  ]);
  const candidateKeys = new Set(model.candidates
    .filter(({ code }) => candidateCodes.has(code))
    .flatMap((candidate) => candidate.paths.map((path) => `${path}\0${candidate.subject}`)));
  const unknownCandidateKeys = new Set(model.candidates
    .filter(({ code, observationClass }) => candidateCodes.has(code)
      && observationClass === 'unknown')
    .flatMap((candidate) => candidate.paths.map((path) => `${path}\0${candidate.subject}`)));
  const moduleEntrypointPaths = new Set(model.entrypoints
    .filter(({ kind }) => kind === 'module-entrypoint')
    .flatMap(({ targetPaths }) => targetPaths));
  const dynamicFrontierPaths = new Set(model.unknowns
    .filter(({ code }) => code === 'dynamic-module-unresolved'
      || code === 'dynamic-runtime-opaque'
      || code === 'computed-property-unresolved')
    .map(({ path }) => path));
  const ownerIntents = compileOwnerIntentEvidence(
    model,
    context.moduleMembership,
    operation
  );
  const evidence = [...unusedSymbols.candidates]
    .sort((left, right) => compareCodeUnits(left.path, right.path)
      || compareCodeUnits(left.name, right.name));
  const reductions: SourceProgramGraphCutReduction[] = [];
  const declarationIdsByReductionKey = new Map<string, string>();
  const seen = new Set<string>();
  for (const item of evidence) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const key = `${item.path}\0${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let sourceFile = sourceFileByPath.get(item.path);
    if (sourceFile === undefined) {
      sourceFile = typeScriptSourceFile(typeScriptModel, item.path);
      sourceFileByPath.set(item.path, sourceFile);
    }
    const matchingDeclarations = model.declarations.filter((candidate) =>
      candidate.path === item.path && candidate.name === item.name);
    const declaration = matchingDeclarations.length === 1 ? matchingDeclarations[0] : undefined;
    const consumers = declaration === undefined ? [] : model.references.filter((reference) =>
      reference.targetObservationId === declaration.observationId);
    const requiredUnmaterializedObligations = declaration === undefined
      ? Object.freeze([])
      : compileSourceProgramRequiredUnmaterializedObligations(
          declaration,
          ownerIntents,
          consumers.length > 0
        );
    const declarationNode = declaration === undefined || sourceFile === null
      ? null
      : graphCutNode(sourceFile, item.name, declaration.span);
    const removalNode = declarationNode === null ? null : graphCutRemovalNode(declarationNode);
    const reason = moduleEntrypointPaths.has(item.path)
      ? 'module entrypoint exports require an explicit external-consumer retirement'
      : dynamicFrontierPaths.has('.') || dynamicFrontierPaths.has(item.path)
        ? 'source file has an unresolved dynamic consumer frontier'
        : matchingDeclarations.length > 1
          ? 'unused symbol resolves to multiple declarations'
        : declaration === undefined || sourceFile === null
          ? 'declaration source snapshot is unresolved'
          : consumers.length > 0
            ? 'TypeScript Program resolved one or more value, type, alias, or re-export consumers'
            : requiredUnmaterializedObligations.length > 0
              ? 'owner-issued operation obligation is required-unmaterialized; target acceptance must precede source retirement'
            : unknownCandidateKeys.has(key)
              ? 'canonical Source Program consumer frontier is unknown; unused provider evidence cannot authorize deletion'
            : !candidateKeys.has(key)
              ? 'canonical Source Program did not admit consumer-zero evidence'
          : removalNode === null
            ? 'declaration is not an independently removable top-level node'
            : null;
    const reduction = Object.freeze({
      status: reason === null ? 'ready' : 'blocked',
      disposition: reason === null
        ? 'delete'
        : requiredUnmaterializedObligations.length > 0
          ? 'required-unmaterialized'
          : 'blocked',
      path: item.path,
      name: item.name,
      removalSpan: reason === null ? graphCutRemovalSpan(sourceFile!, removalNode!) : null,
      requiredUnmaterializedObligations,
      reason
    } satisfies SourceProgramGraphCutReduction);
    reductions.push(reduction);
    if (reason === null) declarationIdsByReductionKey.set(key, declaration!.observationId);
  }
  const preliminaryReady = reductions.filter((reduction) =>
    reduction.status === 'ready' && reduction.removalSpan !== null);
  const overlappingKeys = new Set<string>();
  const readyByPath = new Map<string, SourceProgramGraphCutReduction[]>();
  for (const reduction of preliminaryReady) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const current = readyByPath.get(reduction.path) ?? [];
    current.push(reduction);
    readyByPath.set(reduction.path, current);
  }
  for (const pathReductions of readyByPath.values()) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const ordered = [...pathReductions].sort((left, right) =>
      left.removalSpan!.start - right.removalSpan!.start
      || left.removalSpan!.end - right.removalSpan!.end);
    for (let index = 1; index < ordered.length; index += 1) {
      sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
      if (ordered[index - 1]!.removalSpan!.end <= ordered[index]!.removalSpan!.start) continue;
      overlappingKeys.add(`${ordered[index - 1]!.path}\0${ordered[index - 1]!.name}`);
      overlappingKeys.add(`${ordered[index]!.path}\0${ordered[index]!.name}`);
    }
  }
  let verifiedReductions = reductions.map((reduction) => overlappingKeys.has(`${reduction.path}\0${reduction.name}`)
    ? Object.freeze({
        ...reduction,
        status: 'blocked' as const,
        disposition: 'blocked' as const,
        removalSpan: null,
        reason: 'graph-cut removal overlaps another candidate declaration'
      })
    : reduction);
  const ready = verifiedReductions.filter((reduction) =>
    reduction.status === 'ready' && reduction.removalSpan !== null);
  let verificationReason: string | null = null;
  let verificationDigest = sha256({ status: 'no-ready-reductions' });
  if (ready.length > 0) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const virtualFiles = graphCutVirtualFiles(files, ready);
    const virtualSourceRevision = sha256({
      baseSourceRevision: model.sourceRevision,
      files: virtualFiles.map(({ path, contentDigest }) => ({ path, contentDigest }))
    });
    const baselineDiagnostics = compileTypeScriptDiagnosticSnapshot({
      sourceRevision: model.sourceRevision,
      files
    });
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const virtualDiagnostics = compileTypeScriptDiagnosticSnapshot({
      sourceRevision: virtualSourceRevision,
      files: virtualFiles
    });
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const virtualModel = compileRepositoryModel({
      sourceRevision: virtualSourceRevision,
      files: virtualFiles,
      moduleMembership: context.moduleMembership,
      reviewedProcessDispatchers: context.reviewedProcessDispatchers
    });
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const excludedDeclarationIds = new Set(ready.map((reduction) =>
      declarationIdsByReductionKey.get(`${reduction.path}\0${reduction.name}`)!).filter(Boolean));
    const baselineProjection = graphCutSemanticProjection(model, excludedDeclarationIds);
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const virtualProjection = graphCutSemanticProjection(virtualModel, new Set());
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    verificationReason = graphCutNewDiagnosticReason(baselineDiagnostics, virtualDiagnostics)
      ?? (sha256(baselineProjection) === sha256(virtualProjection)
        ? null
        : 'virtual graph cut changes declarations, references, entrypoints, or capability semantics');
    verificationDigest = sha256({
      baselineDiagnostics,
      baselineProjection,
      virtualDiagnostics,
      virtualProjection,
      virtualSourceRevision
    });
    if (verificationReason !== null) {
      verifiedReductions = verifiedReductions.map((reduction) => reduction.status === 'ready'
        ? Object.freeze({
            ...reduction,
            status: 'blocked' as const,
            disposition: 'blocked' as const,
            removalSpan: null,
            reason: verificationReason
          })
        : reduction);
    }
  }
  verifiedReductions.sort((left, right) => compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.name, right.name));
  const evidenceDigest = unusedSymbols.receiptDigest;
  const plan = Object.freeze({
    sourceRevision: model.sourceRevision,
    sourceSnapshotDigest,
    evidenceDigest,
    verificationDigest,
    planDigest: sha256({
      snapshot: sourceSnapshotIdentity(model, files),
      evidenceDigest,
      verificationDigest,
      reductions: verifiedReductions
    }),
    reductions: Object.freeze(verifiedReductions)
  });
  sourceProgramCompilationCheckpoint(operation, 'reduction-plan', 'complete');
  compiledGraphCutReductionPlans.add(plan);
  return plan;
}

export function compileSourceProgramVersionSuffixReductionPlan(
  model: SourceProgramModel,
  files: readonly SourceProgramFileInput[],
  context: SourceProgramReductionCompilerContext
): SourceProgramVersionSuffixReductionPlan {
  const operation = resolveSourceProgramCompilationOperation(context.operation);
  sourceProgramCompilationCheckpoint(operation, 'reduction-plan', 'start');
  const typeScriptModel = exactReductionTypeScriptModel(model, context);
  const sourceByPath = new Map(files
    .filter(({ path }) => /\.[cm]?[jt]sx?$/iu.test(path))
    .map((file) => [file.path, file.source] as const));
  const sourceFileByPath = new Map<string, ts.SourceFile>();
  for (const path of sourceByPath.keys()) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const sourceFile = typeScriptSourceFile(typeScriptModel, path);
    if (sourceFile === null) {
      throw new SourceProgramReductionAdmissionError(
        'compiler-issued-plan-required',
        `Version reduction lacks exact compiler syntax: ${path}`
      );
    }
    sourceFileByPath.set(path, sourceFile);
  }
  const reductions: SourceProgramVersionSuffixReduction[] = [];
  const processedSymbols = new Set<string>();
  // A local import alias such as `import { canonical as canonicalV1 }` is not
  // a second protocol version. It is a pure compatibility name whose target
  // already proves the canonical identity. Reduce the local binding and every
  // compiler-resolved reference, but block when the canonical local name is
  // already occupied. Export aliases need a distinct public-surface graph cut
  // and are deliberately not rewritten as local bindings here.
  for (const [filePath, sourceFile] of sourceFileByPath) {
    sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
    const visitImportAlias = (node: ts.Node): void => {
      sourceProgramCompilationCheckpoint(operation, 'reduction-plan');
      if (ts.isImportSpecifier(node) && node.propertyName !== undefined) {
        const match = VERSIONED_DECLARATION_NAME.exec(node.name.text);
        const proposedName = match?.[1] ?? '';
        if (proposedName.length > 0 && node.propertyName.text === proposedName) {
          const candidateKey = `${filePath}\u0000${node.name.text}@${node.name.getStart(sourceFile, false)}`;
          if (!processedSymbols.has(candidateKey)) {
            const conflict = sourceFileHasTopLevelBinding(sourceFile, proposedName, node);
            const position = node.name.getStart(sourceFile, false);
            const renameObservation = conflict
              ? null
              : observeTypeScriptRename(typeScriptModel, filePath, position);
            const locations = Object.freeze(renameObservation?.status === 'resolved'
              ? [...renameObservation.locations]
              : []);
            const ready = !conflict
              && renameObservation?.status === 'resolved'
              && renameObservation.canRename
              && locations.length > 0;
            reductions.push(Object.freeze({
              status: ready ? 'ready' : 'blocked',
              currentName: node.name.text,
              proposedName,
              declarationPaths: Object.freeze([filePath]),
              locations: Object.freeze(locations),
              reason: ready
                ? null
                : conflict
                  ? 'canonical import binding already exists in the same module'
                  : renameObservation?.status === 'unresolved'
                    ? `import alias rename generation is unresolved: ${renameObservation.reason}`
                    : renameObservation !== null && !renameObservation.canRename
                      ? renameObservation.rejectionReason
                      : 'import alias rename locations are unresolved'
            }));
            processedSymbols.add(candidateKey);
          }
        }
      }
      ts.forEachChild(node, visitImportAlias);
    };
    visitImportAlias(sourceFile);
  }
  reductions.sort((left, right) => compareCodeUnits(left.declarationPaths[0] ?? '', right.declarationPaths[0] ?? '')
    || compareCodeUnits(left.currentName, right.currentName));
  const plan = Object.freeze({
    sourceRevision: model.sourceRevision,
    planDigest: sha256({
      snapshot: sourceSnapshotIdentity(model, files),
      reductions
    }),
    reductions: Object.freeze(reductions)
  });
  sourceProgramCompilationCheckpoint(operation, 'reduction-plan', 'complete');
  return plan;
}

export function renderSourceProgramVersionSuffixReductionPatch(
  plan: SourceProgramVersionSuffixReductionPlan,
  files: readonly SourceProgramFileInput[]
): SourceProgramVersionSuffixReductionPatch {
  const readyReductions = plan.reductions.filter(({ status }) => status === 'ready');
  if (readyReductions.length === 0) {
    throw new Error('Version suffix reduction patch requires at least one ready reduction');
  }
  const fileByPath = new Map(files.map((file) => [file.path, file] as const));
  const editsByPath = new Map<string, Readonly<{
    start: number;
    end: number;
    currentName: string;
    replacement: string;
  }>[]>()
  for (const reduction of readyReductions) {
    for (const location of reduction.locations) {
      const edits = editsByPath.get(location.path) ?? [];
      edits.push(Object.freeze({
        start: location.span.start,
        end: location.span.end,
        currentName: reduction.currentName,
        replacement: `${location.prefixText}${reduction.proposedName}${location.suffixText}`
      }));
      editsByPath.set(location.path, edits);
    }
  }
  const patches: string[] = [];
  const changedFiles: SourceProgramVersionSuffixReductionPatch['files'][number][] = [];
  for (const [path, rawEdits] of [...editsByPath].sort(([left], [right]) =>
    compareCodeUnits(left, right))) {
    const file = fileByPath.get(path);
    if (file === undefined) throw new Error(`Reduction location has no source snapshot: ${path}`);
    const edits = [...rawEdits].sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 0; index < edits.length; index += 1) {
      const edit = edits[index]!;
      const previous = edits[index - 1];
      if (previous && previous.end > edit.start) {
        throw new Error(`Overlapping version reduction edits: ${path}:${previous.start}-${edit.end}`);
      }
      if (file.source.slice(edit.start, edit.end) !== edit.currentName) {
        throw new Error(`Version reduction preimage mismatch: ${path}:${edit.start}-${edit.end}`);
      }
    }
    let nextSource = file.source;
    for (const edit of edits.reverse()) {
      nextSource = `${nextSource.slice(0, edit.start)}${edit.replacement}${nextSource.slice(edit.end)}`;
    }
    if (nextSource === file.source) continue;
    patches.push(createTwoFilesPatch(`a/${path}`, `b/${path}`, file.source, nextSource, '', '', { context: 3 }));
    changedFiles.push(Object.freeze({
      path,
      beforeDigest: file.contentDigest,
      afterDigest: rawSha256(nextSource)
    }));
  }
  const patch = patches.join('');
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    planDigest: plan.planDigest,
    patchDigest: rawSha256(patch),
    patch,
    files: Object.freeze(changedFiles)
  });
}

export function renderSourceProgramGraphCutReductionPatch(
  plan: SourceProgramGraphCutReductionPlan,
  files: readonly SourceProgramFileInput[]
): SourceProgramVersionSuffixReductionPatch {
  if (!compiledGraphCutReductionPlans.has(plan)) {
    throw new SourceProgramReductionAdmissionError(
      'compiler-issued-plan-required',
      'Graph-cut patch requires a compiler-issued verified plan'
    );
  }
  assertReductionSourceSnapshot(plan.sourceSnapshotDigest, files);
  const ready = plan.reductions.filter((reduction): reduction is SourceProgramGraphCutReduction & {
    readonly status: 'ready';
    readonly removalSpan: SourceProgramSpan;
  } => reduction.status === 'ready' && reduction.removalSpan !== null);
  if (ready.length === 0) throw new Error('Graph-cut patch requires at least one ready reduction');
  const fileByPath = new Map(files.map((file) => [file.path, file] as const));
  const editsByPath = new Map<string, SourceProgramGraphCutReduction[]>();
  for (const reduction of ready) {
    const edits = editsByPath.get(reduction.path) ?? [];
    edits.push(reduction);
    editsByPath.set(reduction.path, edits);
  }
  const patches: string[] = [];
  const changedFiles: SourceProgramVersionSuffixReductionPatch['files'][number][] = [];
  for (const [path, rawEdits] of [...editsByPath].sort(([left], [right]) =>
    compareCodeUnits(left, right))) {
    const file = fileByPath.get(path);
    if (file === undefined) throw new Error(`Graph-cut location has no source snapshot: ${path}`);
    const edits = [...rawEdits].sort((left, right) =>
      left.removalSpan!.start - right.removalSpan!.start
      || left.removalSpan!.end - right.removalSpan!.end);
    for (let index = 1; index < edits.length; index += 1) {
      if (edits[index - 1]!.removalSpan!.end > edits[index]!.removalSpan!.start) {
        throw new Error(`Overlapping graph-cut edits: ${path}`);
      }
    }
    let nextSource = file.source;
    for (const edit of edits.reverse()) {
      nextSource = `${nextSource.slice(0, edit.removalSpan!.start)}${nextSource.slice(edit.removalSpan!.end)}`;
    }
    if (nextSource.length > 0) nextSource = `${nextSource.replace(/[\t \r\n]+$/u, '')}\n`;
    if (nextSource === file.source) continue;
    patches.push(createTwoFilesPatch(`a/${path}`, `b/${path}`, file.source, nextSource, '', '', { context: 3 }));
    changedFiles.push(Object.freeze({
      path,
      beforeDigest: file.contentDigest,
      afterDigest: rawSha256(nextSource)
    }));
  }
  const patch = patches.join('');
  return Object.freeze({
    sourceRevision: plan.sourceRevision,
    planDigest: plan.planDigest,
    patchDigest: rawSha256(patch),
    patch,
    files: Object.freeze(changedFiles)
  });
}
