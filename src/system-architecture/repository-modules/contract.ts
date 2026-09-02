import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import ts from 'typescript';

import { compileClosedDirectedGraphStrongComponents } from '../foundation/runtime/directed-graph.ts';
import { SEC_SEMANTIC_OPERATION_ID_PATTERN } from '../operation/identity.ts';
import {
  isCanonicalSecOperationBudgetMaximum,
  SEC_OPERATION_BUDGET_RESOURCES,
  SEC_PROCESS_OPERATION_BUDGET_RESOURCES,
  type SecOperationBudgetResource
} from '../operation/semantic.ts';
import { isSecRepositoryTestModulePath } from './test-module-path.ts';

/**
 * The repository graph frontier is owned here. Consumers must derive their
 * source/test closure from this projection instead of keeping another list of
 * platform/scripts/tooling roots. Descriptor coverage can become more precise
 * over time without changing the graph owner or its import resolver.
 */
const SEC_MODULE_IMPORT_GRAPHS = Object.freeze([
  'runtime',
  'content'
] as const);

export type SecModuleDescriptor = Readonly<{
  readonly moduleId: string;
  readonly root: string;
  readonly importGraph: typeof SEC_MODULE_IMPORT_GRAPHS[number];
  readonly externalEntrypoints: readonly string[];
  /** Low-level capabilities and public operations for which this module is the sole transport owner. */
  readonly capabilityProviders: readonly SecModuleCapabilityProvider[];
  /** Required only for operations that may be removed or replaced. */
  readonly operationObligations: readonly SecModuleOperationObligation[];
  /** Owner-issued semantic relations; Source Program binds every entry to an exact declaration. */
  readonly causalRelations: readonly SecModuleCausalRelation[];
  /** Every external entrypoint must load before repository dependencies exist. */
  readonly preDependencyBootstrap: boolean;
}>;

export const SEC_MODULE_CAUSAL_RELATIONS = Object.freeze([
  'declares',
  'produces',
  'parses',
  'reads',
  'writes',
  'executes',
  'settles',
  'reads-back',
  'recovers',
  'caches',
  'projects',
  'verifies',
  'migrates',
  'retires'
] as const);

export type SecModuleCausalRelationKind =
  (typeof SEC_MODULE_CAUSAL_RELATIONS)[number];

export type SecModuleCausalRelation = Readonly<{
  readonly subject: string;
  readonly relation: SecModuleCausalRelationKind;
  readonly symbol: Readonly<{
    readonly path: string;
    readonly name: string;
  }>;
  readonly operation: Readonly<{
    readonly semanticOperation: string;
    readonly requirementId: string | null;
  }> | null;
}>;

export type SecModuleCapabilityProvider = Readonly<{
  readonly capability: string;
  readonly operations: readonly string[];
  /** Capability effects intrinsic to every operation exposed by this provider. */
  readonly effectKinds: readonly SecModuleEffectKind[];
  /**
   * Operations that are implementation primitives of the owning module. They
   * remain observable for source-graph accounting, but another module cannot
   * consume them as a public capability surface.
   */
  readonly ownerInternalOperations: readonly string[];
  /** Semantic authority roles bound to exact exported provider operations. */
  readonly operationRoles: readonly SecModuleOperationRoleBinding[];
}>;

export const SEC_MODULE_OPERATION_ROLES = Object.freeze([
  'attempt-issuer',
  'binding-issuer',
  'domain-owner',
  'durable-worker',
  'grant-issuer',
  'provider-settlement-issuer',
  'registration-issuer',
  'readback-issuer',
  'recovery-issuer',
  'terminal-issuer'
] as const);

export type SecModuleOperationRole =
  (typeof SEC_MODULE_OPERATION_ROLES)[number];

export type SecModuleOperationRoleBinding = Readonly<{
  readonly operation: string;
  readonly role: SecModuleOperationRole;
  /** Canonical semantic operation whose authority relation this issuer participates in. */
  readonly semanticOperation: string;
  /** Exact bound requirement for roles that act on one capability provider. */
  readonly requirementId: string | null;
  /** Durable workers must delegate recovery to a distinct owner operation. */
  readonly recovery: Readonly<{
    readonly capability: string;
    readonly operation: string;
    readonly semanticOperation: string;
  }> | null;
}>;

export type SecModuleEffectKind =
  | 'dynamic-code'
  | 'filesystem'
  | 'network'
  | 'persistent-state'
  | 'process'
  | 'provider';

export type SecModuleOperationIdentity =
  | Readonly<{ readonly kind: 'capability'; readonly capability: string; readonly operation: string }>
  | Readonly<{ readonly kind: 'public-entrypoint'; readonly path: string }>;

export type SecModuleOperationObligation = Readonly<{
  readonly operation: SecModuleOperationIdentity;
  readonly consumerSupport: Readonly<{ readonly consumers: readonly string[] }>;
  readonly effect: Readonly<{
    readonly kinds: readonly SecModuleEffectKind[];
    readonly failureKinds: readonly string[];
    readonly recovery: 'idempotent-retry' | 'not-applicable' | 'owner-intervention' | 'resume' | 'rollback';
  }>;
  readonly evolution: Readonly<{
    readonly migration: 'durable-read-migration' | 'not-required' | 'one-shot-owner-migration';
    readonly retirement: 'consumer-zero' | 'never' | 'replacement-obligations-satisfied';
  }>;
  readonly resources: Readonly<{
    /** Static ceilings only; physical workers own runtime accounting and settlement. */
    readonly aggregateBudgets: readonly Readonly<{
      readonly resource: SecOperationBudgetResource;
      readonly maximum: number;
    }>[];
  }>;
  readonly futureSupport: Readonly<{
    readonly condition: 'explicit-owner-decision' | 'preserve-obligations' | 'semantic-superset-required';
  }>;
}>;

export type SecModuleImportKind =
  | 'static'
  | 'dynamic'
  | 'require';

export type SecRepositoryModuleGraphImport = Readonly<{
  readonly kind: SecModuleImportKind;
  readonly specifier: string;
  readonly typeOnly: boolean;
}>;

export type SecRepositoryModuleGraphReference = Readonly<{
  readonly from: string;
  readonly kind: SecModuleImportKind;
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly candidateTargets: readonly string[];
  readonly resolvedTarget: string | null;
}>;

export type SecRepositoryModuleGraph = Readonly<{
  readonly files: readonly string[];
  readonly references: readonly SecRepositoryModuleGraphReference[];
  readonly unresolvedFiles: readonly string[];
  readonly directConsumers: (modulePath: string) => readonly string[];
  readonly directDependencies: (modulePath: string) => readonly string[];
  readonly directRuntimeDependencies: (modulePath: string) => readonly string[];
}>;

export type SecRepositoryModuleBoundaryViolationCode =
  | 'authority-mint-export-unclassified'
  | 'compiler-no-upward-entrypoint-deps'
  | 'cross-package-aggregate-surface'
  | 'module-dependency-cycle'
  | 'no-registry-to-compiler'
  | 'no-unresolved-production-dependencies'
  | 'orchestrator-no-cli-or-dev-runner'
  | 'platform-compiler-facade-boundary'
  | 'product-no-codex-control-plane'
  | 'repository-module-internal-cycle'
  | 'repository-node-responsibility-reverse-dependency'
  | 'repository-node-responsibility-unresolved'
  | 'repository-module-surface-unresolved'
  | 'repository-module-role-reverse-dependency'
  | 'repository-module-role-unresolved'
  | 'pre-dependency-bootstrap-unavailable-package'
  | 'repository-entrypoint-owner-ambiguous'
  | 'repository-entrypoint-owner-unresolved'
  | 'repository-entrypoint-not-declared'
  | 'semantic-foundations-no-reverse-mutation-deps'
  | 'semantic-mutation-no-upward-layer-deps'
  | 'verification-evidence-no-child-runner'
  | 'unowned-production-source';

export type SecRepositoryModuleBoundaryViolation = Readonly<{
  readonly code: SecRepositoryModuleBoundaryViolationCode;
  readonly from: string;
  readonly to: string;
  readonly detail: string;
}>;

/**
 * Narrow projection of the canonical Source Program Model facts consumed by
 * repository-module admission.  This owner deliberately does not classify
 * paths or parse package commands: the Source Program compiler supplies the
 * observed surface and entrypoint closure from its exact snapshot.
 */
export type SecRepositoryModuleSourceProgramFacts = Readonly<{
  readonly sourceRevision?: string;
  readonly semanticRevision?: string;
  readonly files: readonly Readonly<{
    readonly path: string;
    readonly moduleId: string | null;
    readonly surface: 'production' | 'test' | 'fixture' | 'workflow' | 'resource';
    readonly semanticKind?: 'pure-reexport' | 'declaration-owner' | 'executable' | 'unknown';
    readonly semanticObservationClass?: 'observed' | 'derived' | 'unknown';
  }>[];
  readonly entrypoints: readonly Readonly<{
    readonly observationId: string;
    readonly kind: 'package-script' | 'package-bin' | 'cli-command' | 'module-entrypoint' | 'git-hook' | 'workflow';
    readonly path: string;
    readonly name: string;
    readonly targetPaths?: readonly string[];
    readonly observationClass: 'observed' | 'derived' | 'unknown';
  }>[];
  readonly entrypointClosures: readonly Readonly<{
    readonly entrypointObservationId: string;
    readonly targetPaths: readonly string[];
    readonly handlerModuleIds: readonly string[];
    readonly reachablePaths: readonly string[];
    readonly capabilityPaths: readonly string[];
    readonly transports?: readonly string[];
    readonly unknownPaths?: readonly string[];
    readonly observationClass: 'observed' | 'derived' | 'unknown';
  }>[];
  readonly capabilities?: readonly Readonly<{
    readonly path?: string;
    readonly moduleId: string | null;
    readonly surface: 'production' | 'test' | 'fixture' | 'workflow' | 'resource';
    readonly capability?: string;
    readonly operation?: string;
    readonly transport: string;
    readonly observationClass: 'observed' | 'derived' | 'unknown';
  }>[];
  readonly declarations?: readonly Readonly<{
    readonly observationId?: string;
    readonly declarationDigest?: string;
    readonly path: string;
    readonly moduleId: string | null;
    readonly name: string;
    readonly exported: boolean;
  }>[];
  readonly responsibilityEvidence?: readonly Readonly<{
    readonly bindingId: string;
    readonly responsibilityId: string;
    readonly target: Readonly<{
      readonly kind: 'entity' | 'effect' | 'operation' | 'scenario';
      readonly id: string;
    }>;
    readonly declaration: Readonly<{
      readonly path: string;
      readonly exportName: string;
      readonly observationId: string | null;
      readonly declarationDigest: string | null;
      readonly moduleId: string | null;
    }>;
    readonly sourceRevision: string;
    readonly semanticRevision: string;
    readonly observationClass: 'observed' | 'unknown';
    readonly reason: 'validated' | 'semantic-binding-invalid'
      | 'exported-declaration-missing' | 'exported-declaration-ambiguous'
      | 'declaration-binding-conflict';
    readonly evidenceDigest: string;
  }>[];
}>;

export type SecRepositoryNodeResponsibility =
  | 'contract'
  | 'computation'
  | 'capability'
  | 'operation'
  | 'workflow'
  | 'interface';

export type SecRepositoryNodeResponsibilityReason =
  | 'semantic-responsibility-binding'
  | 'responsibility-evidence-conflict'
  | 'responsibility-evidence-unresolved';

export type SecRepositoryNodeResponsibilityProjection = Readonly<{
  readonly path: string;
  readonly moduleId: string;
  readonly responsibility: SecRepositoryNodeResponsibility | 'unknown';
  readonly evidenceDigest: `sha256:${string}`;
  readonly reason: SecRepositoryNodeResponsibilityReason;
}>;

export type SecRepositoryModuleEdgeWitness = Readonly<{
  readonly fromPath: string;
  readonly toPath: string;
  readonly kind: SecModuleImportKind;
  readonly specifier: string;
}>;

export type SecRepositoryModuleOwnerEdge = Readonly<{
  readonly fromOwner: string;
  readonly toOwner: string;
  readonly witnesses: readonly SecRepositoryModuleEdgeWitness[];
}>;

export type SecRepositoryModuleStrongComponent = Readonly<{
  readonly ownerIds: readonly string[];
  readonly edges: readonly SecRepositoryModuleOwnerEdge[];
}>;

export type SecRepositoryModuleFileStrongComponent = Readonly<{
  readonly ownerId: string;
  readonly paths: readonly string[];
  readonly edges: readonly SecRepositoryModuleEdgeWitness[];
}>;

export type SecRepositoryModuleReciprocalPair = Readonly<{
  readonly ownerIds: readonly [string, string];
  readonly forward: SecRepositoryModuleOwnerEdge;
  readonly reverse: SecRepositoryModuleOwnerEdge;
}>;

/**
 * Exact structural projection compiled from the canonical repository import
 * graph. It is intentionally independent from TypeScript semantic facts so
 * editor and migration loops can observe ownership cycles without compiling
 * the full Source Program. The semantic architecture projection below extends
 * this result; it does not maintain a second graph.
 */
export type SecRepositoryModuleTopologyProjection = Readonly<{
  readonly ownerEdges: readonly SecRepositoryModuleOwnerEdge[];
  readonly strongComponents: readonly SecRepositoryModuleStrongComponent[];
  readonly fileStrongComponents: readonly SecRepositoryModuleFileStrongComponent[];
  readonly reciprocalPairs: readonly SecRepositoryModuleReciprocalPair[];
  readonly feedbackCuts: readonly SecRepositoryModuleOwnerEdge[];
  readonly violations: readonly SecRepositoryModuleBoundaryViolation[];
}>;

export type SecRepositoryModuleArchitectureProjection = Readonly<{
  readonly ownerEdges: readonly SecRepositoryModuleOwnerEdge[];
  readonly strongComponents: readonly SecRepositoryModuleStrongComponent[];
  /** Same-owner file cycles derived from the exact canonical import graph. */
  readonly fileStrongComponents: readonly SecRepositoryModuleFileStrongComponent[];
  readonly reciprocalPairs: readonly SecRepositoryModuleReciprocalPair[];
  /** Removing these exact owner edges makes the projected owner graph acyclic. */
  readonly feedbackCuts: readonly SecRepositoryModuleOwnerEdge[];
  readonly aggregateFacadePaths: readonly string[];
  readonly unresolvedAggregateSurfacePaths: readonly string[];
  /** The only responsibility authority: one decision per production node. */
  readonly nodeResponsibilities: readonly SecRepositoryNodeResponsibilityProjection[];
  readonly violations: readonly SecRepositoryModuleBoundaryViolation[];
}>;

/**
 * A relocation is a semantic graph operation, rather than a path rename.
 * Keeping the graph evidence on the entry prevents the physical transaction
 * owner from silently moving a source whose import closure was not resolved.
 * The transaction owner supplies the byte/identity preimage separately.
 */
export type SecRepositoryModuleRelocationUnresolvedReference = Readonly<{
  readonly from: string;
  readonly specifier: string;
  readonly kind: SecModuleImportKind;
  readonly reason: 'unresolved-target' | 'non-typescript-reference' | 'unresolved-source';
}>;

export type SecRepositoryModuleRelocationPlanEntry = Readonly<{
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceKind: 'typescript' | 'unsupported';
  readonly references: readonly SecRepositoryModuleGraphReference[];
  readonly unresolvedReferences: readonly SecRepositoryModuleRelocationUnresolvedReference[];
}>;

export type SecRepositoryModuleGraphCompileInput = Readonly<{
  readonly files: readonly string[];
  /** Return null for an unavailable source. Empty source is a valid source. */
  readonly readSource: (moduleFile: string) => string | null;
  /**
   * Optional cache seam. The parser remains owned by this module; callers may
   * cache its returned records without implementing another parser.
   */
  readonly readImports?: (
    moduleFile: string,
    source: string
  ) => readonly SecRepositoryModuleGraphImport[];
  readonly unresolvedFiles?: readonly string[];
}>;

export type SecRepositoryModuleMembership = Readonly<{
  readonly descriptors: readonly SecModuleDescriptor[];
  readonly graphRoots: readonly string[];
  readonly moduleRoots: readonly string[];
  readonly moduleForPath: (path: string) => SecModuleDescriptor | null;
}>;

export type SecRepositoryModuleDescriptorSource = Readonly<{
  readonly descriptorPath: string;
  readonly source: string;
}>;

export type SecRepositoryModuleMembershipSnapshot = Readonly<{
  readonly repositoryFiles: readonly string[];
  readonly descriptorSources: readonly SecRepositoryModuleDescriptorSource[];
}>;

const SEC_MODULE_DESCRIPTOR_KEYS = Object.freeze([
  'importGraph',
  'externalEntrypoints',
  'capabilityProviders',
  'operationObligations',
  'causalRelations',
  'preDependencyBootstrap'
] as const);

const SEC_MODULE_ID_PATTERN = /^[a-z][a-z0-9.-]{1,127}$/u;
const SEC_MODULE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u;
/**
 * The repository no longer has a flat `src/modules` or `src/apps` layer.
 * Keep this as an admission invariant at the graph owner so a stale path,
 * descriptor, cache snapshot, or relocation request cannot silently recreate
 * either retired namespace.
 */
const SEC_RETIRED_REPOSITORY_ROOTS = Object.freeze([
  'src/apps',
  'src/modules'
] as const);

function descriptorError(field: string, detail: string): never {
  throw new Error(`invalid sec.module.json ${field}: ${detail}`);
}

function descriptorRecord(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return descriptorError('descriptor', 'expected an object');
  }
  const record = input as Record<string, unknown>;
  const allowed = new Set<string>(SEC_MODULE_DESCRIPTOR_KEYS);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) descriptorError(key, 'unknown field');
  }
  for (const key of SEC_MODULE_DESCRIPTOR_KEYS.filter(
    (key) => key !== 'preDependencyBootstrap'
      && key !== 'capabilityProviders'
      && key !== 'operationObligations'
      && key !== 'causalRelations'
  )) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      descriptorError(key, 'required field is missing');
    }
  }
  return record;
}

function descriptorCausalRelations(
  value: unknown,
  root: string
): readonly SecModuleCausalRelation[] {
  if (!Array.isArray(value) || value.length > 128) {
    return descriptorError('causalRelations', 'expected at most 128 entries');
  }
  const relations = value.map((item, index) => {
    const field = `causalRelations[${index}]`;
    const record = descriptorExactRecord(item, field, [
      'operation', 'relation', 'subject', 'symbol'
    ]);
    const subject = descriptorString(
      record.subject,
      `${field}.subject`,
      SEC_SEMANTIC_OPERATION_ID_PATTERN
    );
    const relation = descriptorEnum(
      record.relation,
      `${field}.relation`,
      SEC_MODULE_CAUSAL_RELATIONS
    );
    const symbolRecord = descriptorExactRecord(
      record.symbol,
      `${field}.symbol`,
      ['name', 'path']
    );
    const symbolPath = descriptorString(
      symbolRecord.path,
      `${field}.symbol.path`,
      SEC_MODULE_PATH_PATTERN
    );
    if (!pathWithinRoot(symbolPath, root)) {
      descriptorError(`${field}.symbol.path`, 'must remain inside the declaring module root');
    }
    const symbol = Object.freeze({
      path: symbolPath,
      name: descriptorString(
        symbolRecord.name,
        `${field}.symbol.name`,
        /^[A-Za-z_$][A-Za-z0-9_$]*$/u
      )
    });
    const operationRecord = record.operation === null
      ? null
      : descriptorExactRecord(
          record.operation,
          `${field}.operation`,
          ['requirementId', 'semanticOperation']
        );
    const operation = operationRecord === null ? null : Object.freeze({
      semanticOperation: descriptorString(
        operationRecord.semanticOperation,
        `${field}.operation.semanticOperation`,
        SEC_SEMANTIC_OPERATION_ID_PATTERN
      ),
      requirementId: operationRecord.requirementId === null
        ? null
        : descriptorString(
            operationRecord.requirementId,
            `${field}.operation.requirementId`,
            SEC_SEMANTIC_OPERATION_ID_PATTERN
          )
    });
    return Object.freeze({ subject, relation, symbol, operation });
  });
  const identities = relations.map((relation) => JSON.stringify(relation));
  if (new Set(identities).size !== identities.length) {
    descriptorError('causalRelations', 'relations must be unique');
  }
  return Object.freeze(relations);
}

function descriptorString(
  value: unknown,
  field: string,
  pattern?: RegExp
): string {
  if (typeof value !== 'string' || value.length === 0) {
    return descriptorError(field, 'expected a non-empty string');
  }
  if (pattern !== undefined && !pattern.test(value)) {
    return descriptorError(field, 'has an invalid format');
  }
  return value;
}

function descriptorEnum<Value extends string>(
  value: unknown,
  field: string,
  choices: readonly Value[]
): Value {
  if (typeof value !== 'string' || !choices.includes(value as Value)) {
    return descriptorError(field, `expected one of ${choices.join(', ')}`);
  }
  return value as Value;
}

function descriptorStringArray(
  value: unknown,
  field: string,
  itemPattern?: RegExp,
  minimumLength = 0
): readonly string[] {
  if (!Array.isArray(value) || value.length > 128 || value.length < minimumLength) {
    return descriptorError(field, `expected ${minimumLength === 0 ? 'at most' : 'between'} ${minimumLength === 0 ? '128' : `${minimumLength} and 128`} entries`);
  }
  const items = value.map((item, index) => descriptorString(item, `${field}[${index}]`, itemPattern));
  if (new Set(items).size !== items.length) descriptorError(field, 'entries must be unique');
  return Object.freeze(items);
}

function descriptorCapabilityProviders(value: unknown): readonly SecModuleCapabilityProvider[] {
  if (!Array.isArray(value) || value.length > 32) {
    return descriptorError('capabilityProviders', 'expected at most 32 entries');
  }
  const providers = value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return descriptorError(`capabilityProviders[${index}]`, 'expected an object');
    }
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => (
      key !== 'capability'
      && key !== 'operations'
      && key !== 'effectKinds'
      && key !== 'ownerInternalOperations'
      && key !== 'operationRoles'
    ))) {
      return descriptorError(`capabilityProviders[${index}]`, 'contains an unknown field');
    }
    const capability = descriptorString(
      record.capability,
      `capabilityProviders[${index}].capability`,
      SEC_MODULE_ID_PATTERN
    );
    const operations = descriptorStringArray(
      record.operations,
      `capabilityProviders[${index}].operations`,
      /^[A-Za-z_$][A-Za-z0-9_$]*$/u,
      1
    );
    const effectKindInput = record.effectKinds ?? [];
    if (!Array.isArray(effectKindInput) || effectKindInput.length > 6) {
      return descriptorError(`capabilityProviders[${index}].effectKinds`, 'expected at most 6 entries');
    }
    const effectKinds = effectKindInput.map((kind, effectIndex) => descriptorEnum(
          kind,
          `capabilityProviders[${index}].effectKinds[${effectIndex}]`,
          ['dynamic-code', 'filesystem', 'network', 'persistent-state', 'process', 'provider'] as const
        ));
    if (new Set(effectKinds).size !== effectKinds.length) {
      descriptorError(`capabilityProviders[${index}].effectKinds`, 'entries must be unique');
    }
    const ownerInternalOperations = descriptorStringArray(
      record.ownerInternalOperations ?? [],
      `capabilityProviders[${index}].ownerInternalOperations`,
      /^[A-Za-z_$][A-Za-z0-9_$]*$/u
    );
    if (ownerInternalOperations.some((operation) => !operations.includes(operation))) {
      descriptorError(
        `capabilityProviders[${index}].ownerInternalOperations`,
        'entries must be declared provider operations'
      );
    }
    const operationRoleInput = record.operationRoles ?? [];
    if (!Array.isArray(operationRoleInput) || operationRoleInput.length > operations.length) {
      return descriptorError(
        `capabilityProviders[${index}].operationRoles`,
        'expected at most one role binding per declared operation'
      );
    }
    const operationRoles = operationRoleInput.map((item, roleIndex) => {
      const roleField = `capabilityProviders[${index}].operationRoles[${roleIndex}]`;
      const roleRecord = descriptorExactRecord(
        item,
        roleField,
        ['operation', 'recovery', 'requirementId', 'role', 'semanticOperation']
      );
      const operation = descriptorString(
        roleRecord.operation,
        `${roleField}.operation`,
        /^[A-Za-z_$][A-Za-z0-9_$]*$/u
      );
      if (!operations.includes(operation)) {
        descriptorError(`${roleField}.operation`, 'must be one declared provider operation');
      }
      const role = descriptorEnum(
        roleRecord.role,
        `${roleField}.role`,
        SEC_MODULE_OPERATION_ROLES
      );
      const semanticOperation = descriptorString(
        roleRecord.semanticOperation,
        `${roleField}.semanticOperation`,
        SEC_SEMANTIC_OPERATION_ID_PATTERN
      );
      const requirementId = roleRecord.requirementId === null
        ? null
        : descriptorString(
            roleRecord.requirementId,
            `${roleField}.requirementId`,
            SEC_SEMANTIC_OPERATION_ID_PATTERN
          );
      const requirementBoundRole = role === 'binding-issuer'
        || role === 'provider-settlement-issuer'
        || role === 'readback-issuer';
      if (requirementBoundRole !== (requirementId !== null)) {
        descriptorError(
          `${roleField}.requirementId`,
          requirementBoundRole
            ? `is required for ${role}`
            : `must be null for ${role}`
        );
      }
      const recoveryRecord = roleRecord.recovery === null
        ? null
        : descriptorExactRecord(
            roleRecord.recovery,
            `${roleField}.recovery`,
            ['capability', 'operation', 'semanticOperation']
          );
      const recovery = recoveryRecord === null ? null : Object.freeze({
        capability: descriptorString(
          recoveryRecord.capability,
          `${roleField}.recovery.capability`,
          SEC_MODULE_ID_PATTERN
        ),
        operation: descriptorString(
          recoveryRecord.operation,
          `${roleField}.recovery.operation`,
          /^[A-Za-z_$][A-Za-z0-9_$]*$/u
        ),
        semanticOperation: descriptorString(
          recoveryRecord.semanticOperation,
          `${roleField}.recovery.semanticOperation`,
          SEC_SEMANTIC_OPERATION_ID_PATTERN
        )
      });
      if (role !== 'durable-worker' && recovery !== null) {
        descriptorError(`${roleField}.recovery`, 'is only valid for a durable-worker');
      }
      if (recovery !== null && recovery.semanticOperation !== semanticOperation) {
        descriptorError(
          `${roleField}.recovery.semanticOperation`,
          'must bind the durable worker semantic operation'
        );
      }
      return Object.freeze({ operation, role, semanticOperation, requirementId, recovery });
    });
    if (new Set(operationRoles.map(({ operation }) => operation)).size !== operationRoles.length) {
      descriptorError(
        `capabilityProviders[${index}].operationRoles`,
        'operation entries must be unique'
      );
    }
    const roleRelations = operationRoles.map(({ role, semanticOperation, requirementId }) => (
      `${semanticOperation}\u0000${requirementId ?? ''}\u0000${role}`
    ));
    if (new Set(roleRelations).size !== roleRelations.length) {
      descriptorError(
        `capabilityProviders[${index}].operationRoles`,
        'semantic operation requirement role relations must be unique'
      );
    }
    return Object.freeze({
      capability,
      operations,
      effectKinds: Object.freeze(effectKinds),
      ownerInternalOperations,
      operationRoles: Object.freeze(operationRoles)
    });
  });
  if (new Set(providers.map(({ capability }) => capability)).size !== providers.length) {
    descriptorError('capabilityProviders', 'capability entries must be unique');
  }
  const issuerRelations = providers.flatMap((provider) => provider.operationRoles.map((binding) => ({
    provider,
    binding
  })));
  const issuerRelationIdentities = issuerRelations.map(({ binding }) => (
    `${binding.semanticOperation}\u0000${binding.requirementId ?? ''}\u0000${binding.role}`
  ));
  if (new Set(issuerRelationIdentities).size !== issuerRelationIdentities.length) {
    descriptorError(
      'capabilityProviders',
      'semantic operation requirement issuer relations must be unique across the module'
    );
  }
  return Object.freeze(providers);
}

function descriptorExactRecord(
  value: unknown,
  field: string,
  keys: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return descriptorError(field, 'expected an object');
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    return descriptorError(field, `expected exact keys ${expected.join(', ')}`);
  }
  return record;
}

function descriptorOperationObligations(
  value: unknown,
  capabilityProviders: readonly SecModuleCapabilityProvider[],
  externalEntrypoints: readonly string[]
): readonly SecModuleOperationObligation[] {
  if (!Array.isArray(value) || value.length > 64) {
    return descriptorError('operationObligations', 'expected at most 64 entries');
  }
  const obligations = value.map((item, index) => {
    const field = `operationObligations[${index}]`;
    const record = descriptorExactRecord(item, field, [
      'operation', 'consumerSupport', 'effect', 'evolution', 'resources', 'futureSupport'
    ]);
    const operationRecord = descriptorExactRecord(
      record.operation,
      `${field}.operation`,
      (record.operation as { kind?: unknown } | null)?.kind === 'capability'
        ? ['kind', 'capability', 'operation'] : ['kind', 'path']
    );
    const operationKind = descriptorEnum(
      operationRecord.kind,
      `${field}.operation.kind`,
      ['capability', 'public-entrypoint'] as const
    );
    const operation: SecModuleOperationIdentity = operationKind === 'capability'
      ? Object.freeze({
          kind: operationKind,
          capability: descriptorString(
            operationRecord.capability,
            `${field}.operation.capability`,
            SEC_MODULE_ID_PATTERN
          ),
          operation: descriptorString(
            operationRecord.operation,
            `${field}.operation.operation`,
            /^[A-Za-z_$][A-Za-z0-9_$]*$/u
          )
        })
      : Object.freeze({
          kind: operationKind,
          path: descriptorString(
            operationRecord.path,
            `${field}.operation.path`,
            SEC_MODULE_PATH_PATTERN
          )
        });
    if (operation.kind === 'capability') {
      const provider = capabilityProviders.find(({ capability }) => (
        capability === operation.capability
      ));
      if (provider === undefined || !provider.operations.includes(operation.operation)) {
        descriptorError(`${field}.operation`, 'must bind one declared capability provider operation');
      }
      if (provider.ownerInternalOperations.includes(operation.operation)) {
        descriptorError(`${field}.operation`, 'cannot publish obligations for an owner-internal operation');
      }
    } else if (!externalEntrypoints.includes(operation.path)) {
      descriptorError(`${field}.operation`, 'must bind one declared external entrypoint');
    }

    const consumerSupportRecord = descriptorExactRecord(
      record.consumerSupport,
      `${field}.consumerSupport`,
      ['consumers']
    );
    const consumerSupport = Object.freeze({
      consumers: descriptorStringArray(
        consumerSupportRecord.consumers,
        `${field}.consumerSupport.consumers`,
        SEC_MODULE_ID_PATTERN
      )
    });
    const effectRecord = descriptorExactRecord(
      record.effect,
      `${field}.effect`,
      ['kinds', 'failureKinds', 'recovery']
    );
    const effectKinds = Array.isArray(effectRecord.kinds)
      ? effectRecord.kinds.map((kind, effectIndex) => descriptorEnum(
          kind,
          `${field}.effect.kinds[${effectIndex}]`,
          ['dynamic-code', 'filesystem', 'network', 'persistent-state', 'process', 'provider'] as const
        ))
      : descriptorError(`${field}.effect.kinds`, 'expected an array');
    if (new Set(effectKinds).size !== effectKinds.length) {
      descriptorError(`${field}.effect.kinds`, 'entries must be unique');
    }
    const failureKinds = descriptorStringArray(
      effectRecord.failureKinds,
      `${field}.effect.failureKinds`,
      /^[a-z][a-z0-9.-]{0,127}$/u
    );
    const recovery = descriptorEnum(
      effectRecord.recovery,
      `${field}.effect.recovery`,
      ['idempotent-retry', 'not-applicable', 'owner-intervention', 'resume', 'rollback'] as const
    );
    if (effectKinds.length === 0 && (failureKinds.length > 0 || recovery !== 'not-applicable')) {
      descriptorError(`${field}.effect`, 'effect-free operations require no failures and not-applicable recovery');
    }
    if (effectKinds.length > 0 && (failureKinds.length === 0 || recovery === 'not-applicable')) {
      descriptorError(`${field}.effect`, 'effectful operations require failure kinds and recovery');
    }
    const effect = Object.freeze({
      kinds: Object.freeze(effectKinds),
      failureKinds,
      recovery
    });

    const evolutionRecord = descriptorExactRecord(
      record.evolution,
      `${field}.evolution`,
      ['migration', 'retirement']
    );
    const evolution = Object.freeze({
      migration: descriptorEnum(
        evolutionRecord.migration,
        `${field}.evolution.migration`,
        ['durable-read-migration', 'not-required', 'one-shot-owner-migration'] as const
      ),
      retirement: descriptorEnum(
        evolutionRecord.retirement,
        `${field}.evolution.retirement`,
        ['consumer-zero', 'never', 'replacement-obligations-satisfied'] as const
      )
    });

    const resourcesRecord = descriptorExactRecord(
      record.resources,
      `${field}.resources`,
      ['aggregateBudgets']
    );
    if (!Array.isArray(resourcesRecord.aggregateBudgets)
        || resourcesRecord.aggregateBudgets.length < 1
        || resourcesRecord.aggregateBudgets.length > 16) {
      descriptorError(`${field}.resources.aggregateBudgets`, 'expected between 1 and 16 entries');
    }
    const aggregateBudgets = resourcesRecord.aggregateBudgets.map((budget, budgetIndex) => {
      const budgetRecord = descriptorExactRecord(
        budget,
        `${field}.resources.aggregateBudgets[${budgetIndex}]`,
        ['resource', 'maximum']
      );
      const resource = descriptorEnum(
        budgetRecord.resource,
        `${field}.resources.aggregateBudgets[${budgetIndex}].resource`,
        SEC_OPERATION_BUDGET_RESOURCES
      );
      if (!isCanonicalSecOperationBudgetMaximum(resource, budgetRecord.maximum as number)) {
        descriptorError(
          `${field}.resources.aggregateBudgets[${budgetIndex}].maximum`,
          'expected a canonical static aggregate ceiling'
        );
      }
      return Object.freeze({ resource, maximum: budgetRecord.maximum as number });
    });
    if (new Set(aggregateBudgets.map(({ resource }) => resource)).size !== aggregateBudgets.length) {
      descriptorError(`${field}.resources.aggregateBudgets`, 'resource entries must be unique');
    }
    if (effectKinds.includes('process')) {
      const missingProcessResources = SEC_PROCESS_OPERATION_BUDGET_RESOURCES.filter(
        (resource) => !aggregateBudgets.some((budget) => budget.resource === resource)
      );
      if (missingProcessResources.length > 0) {
        descriptorError(
          `${field}.resources.aggregateBudgets`,
          `process Effect obligation must declare exactly one ${missingProcessResources.join(', ')} ceiling`
        );
      }
    }
    const resources = Object.freeze({ aggregateBudgets: Object.freeze(aggregateBudgets) });
    const futureSupportRecord = descriptorExactRecord(
      record.futureSupport,
      `${field}.futureSupport`,
      ['condition']
    );
    const futureSupport = Object.freeze({
      condition: descriptorEnum(
        futureSupportRecord.condition,
        `${field}.futureSupport.condition`,
        ['explicit-owner-decision', 'preserve-obligations', 'semantic-superset-required'] as const
      )
    });
    return Object.freeze({
      operation,
      consumerSupport,
      effect,
      evolution,
      resources,
      futureSupport
    });
  });
  const identities = obligations.map(({ operation }) => JSON.stringify(operation));
  if (new Set(identities).size !== identities.length) {
    descriptorError('operationObligations', 'operation identities must be unique');
  }
  const obligationsByIdentity = new Map(obligations.flatMap((obligation) => (
    obligation.operation.kind === 'capability'
      ? [[`${obligation.operation.capability}\u0000${obligation.operation.operation}`, obligation] as const]
      : []
  )));
  for (const provider of capabilityProviders) {
    if (provider.effectKinds.length === 0) continue;
    for (const operation of provider.operations) {
      if (provider.ownerInternalOperations.includes(operation)) continue;
      const obligation = obligationsByIdentity.get(`${provider.capability}\u0000${operation}`);
      if (obligation === undefined) {
        descriptorError(
          'operationObligations',
          `effectful public capability ${provider.capability}:${operation} requires an operation obligation`
        );
      }
      if (provider.effectKinds.some((kind) => !obligation.effect.kinds.includes(kind))) {
        descriptorError(
          'operationObligations',
          `public capability ${provider.capability}:${operation} obligation omits an intrinsic provider effect`
        );
      }
    }
  }
  return Object.freeze(obligations);
}

export function parseSecModuleDescriptor(
  input: unknown,
  descriptorPath: string
): SecModuleDescriptor {
  const record = descriptorRecord(input);
  const normalizedDescriptorPath = normalizeSecRepositoryPath(descriptorPath);
  if (isRetiredRepositoryRootPath(normalizedDescriptorPath)) {
    descriptorError('descriptorPath', 'uses a retired repository root');
  }
  if (!isCanonicalSecRepositoryModulePath(normalizedDescriptorPath)
      || nodePath.posix.basename(normalizedDescriptorPath) !== 'sec.module.json') {
    descriptorError('descriptorPath', 'must be a canonical repository sec.module.json path');
  }
  const root = nodePath.posix.dirname(normalizedDescriptorPath);
  if (root === '.') descriptorError('descriptorPath', 'repository-root descriptors are not supported');
  const importGraph = descriptorEnum(record.importGraph, 'importGraph', SEC_MODULE_IMPORT_GRAPHS);
  if (!root.startsWith('src/') && root !== 'tests' && importGraph !== 'content') {
    descriptorError('descriptorPath', 'non-src module roots must be content-only');
  }
  const externalEntrypoints = descriptorStringArray(
    record.externalEntrypoints,
    'externalEntrypoints',
    SEC_MODULE_PATH_PATTERN
  );
  const capabilityProviders = descriptorCapabilityProviders(record.capabilityProviders ?? []);
  const operationObligations = descriptorOperationObligations(
    record.operationObligations ?? [],
    capabilityProviders,
    externalEntrypoints
  );
  const causalRelations = descriptorCausalRelations(record.causalRelations ?? [], root);
  const preDependencyBootstrap = record.preDependencyBootstrap ?? false;
  if (typeof preDependencyBootstrap !== 'boolean') {
    descriptorError('preDependencyBootstrap', 'expected a boolean');
  }
  if (preDependencyBootstrap && externalEntrypoints.length === 0) {
    descriptorError('preDependencyBootstrap', 'requires at least one external entrypoint');
  }
  return Object.freeze({
    moduleId: secRepositoryModuleIdFromRoot(root),
    root,
    importGraph,
    externalEntrypoints,
    capabilityProviders,
    operationObligations,
    causalRelations,
    preDependencyBootstrap
  });
}

/**
 * A package identity is a projection of its physical capability root. It is
 * never repeated in sec.module.json, so a descriptor cannot self-assign a
 * semantic owner or preserve a stale identity after relocation.
 */
export function secRepositoryModuleIdFromRoot(root: string): string {
  const normalized = normalizeSecRepositoryPath(root);
  if (normalized === 'tests') return 'verification.tests';
  const isSource = normalized.startsWith('src/');
  const segments = (isSource ? normalized.slice('src/'.length) : normalized).split('/');
  if (segments.some((segment) => !/^[a-z][a-z0-9-]*$/u.test(segment))) {
    return descriptorError('descriptorPath', 'contains a noncanonical capability segment');
  }
  return `${isSource ? '' : 'content.'}${segments.join('.')}`;
}

function pathWithinRoot(path: string, root: string): boolean {
  const normalizedPath = path.toLocaleLowerCase('en-US');
  const normalizedRoot = root.toLocaleLowerCase('en-US');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function normalizeSecRepositoryPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function isRetiredRepositoryRootPath(value: string): boolean {
  const normalized = normalizeSecRepositoryPath(value).toLocaleLowerCase('en-US');
  return SEC_RETIRED_REPOSITORY_ROOTS.some((root) => (
    normalized === root || normalized.startsWith(`${root}/`)
  ));
}

function normalizeRepositoryPath(value: string): string {
  return normalizeSecRepositoryPath(value);
}

function isTestOnlyRepositoryModulePath(value: string): boolean {
  const normalized = normalizeSecRepositoryPath(value);
  return isSecRepositoryTestModulePath(normalized)
    || normalized.startsWith('tests/')
    || normalized.includes('/test/');
}

function absolutePathWithinRepository(repositoryRoot: string, relativePath: string): string {
  const absolute = nodePath.resolve(repositoryRoot, ...relativePath.split('/'));
  const relative = nodePath.relative(repositoryRoot, absolute);
  if (relative === '..' || relative.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relative)) {
    throw new Error(`repository module path escapes repository root: ${relativePath}`);
  }
  return absolute;
}

/**
 * The only import scanner exposed to downstream graph consumers.  It keeps
 * the cache seam typed while preventing test-impact or another projection from
 * growing a second source parser.
 */
export function scanSecRepositoryModuleImports(
  source: string
): readonly SecRepositoryModuleGraphImport[] {
  const sourceFile = ts.createSourceFile(
    'repository-module.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const imports: SecRepositoryModuleGraphImport[] = [];
  const add = (kind: SecModuleImportKind, specifier: string, typeOnly = false): void => {
    imports.push(Object.freeze({ kind, specifier, typeOnly }));
  };
  for (const reference of [
    ...sourceFile.referencedFiles,
    ...sourceFile.typeReferenceDirectives,
    ...sourceFile.libReferenceDirectives
  ]) add('static', reference.fileName, true);
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause !== undefined && (
            node.importClause.isTypeOnly
            || (node.importClause.name === undefined
              && node.importClause.namedBindings !== undefined
              && ts.isNamedImports(node.importClause.namedBindings)
              && node.importClause.namedBindings.elements.length > 0
              && node.importClause.namedBindings.elements.every((element) => element.isTypeOnly))
          )
        : node.isTypeOnly || (
            node.exportClause !== undefined
            && ts.isNamedExports(node.exportClause)
            && node.exportClause.elements.length > 0
            && node.exportClause.elements.every((element) => element.isTypeOnly)
          );
      add('static', node.moduleSpecifier.text, typeOnly);
    } else if (ts.isImportEqualsDeclaration(node)
        && ts.isExternalModuleReference(node.moduleReference)
        && node.moduleReference.expression !== undefined
        && ts.isStringLiteralLike(node.moduleReference.expression)) {
      add('require', node.moduleReference.expression.text, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0
        && ts.isStringLiteralLike(node.arguments[0]!)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        add('dynamic', node.arguments[0]!.text);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        add('require', node.arguments[0]!.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const unique = new Map<string, SecRepositoryModuleGraphImport>();
  for (const reference of imports) {
    const key = `${reference.kind}\0${reference.specifier}`;
    const existing = unique.get(key);
    if (existing === undefined || (existing.typeOnly && !reference.typeOnly)) {
      unique.set(key, reference);
    }
  }
  return Object.freeze([...unique.values()].sort((left, right) => (
    left.specifier < right.specifier ? -1
      : left.specifier > right.specifier ? 1
        : left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0
  )));
}

/**
 * Resolve import candidates without touching the filesystem.  Existing-file
 * selection belongs to the graph compiler's supplied `files` snapshot; all
 * candidate paths are retained so a removed target still affects consumers.
 */
export function resolveSecRepositoryModuleImportCandidates(
  sourcePath: string,
  specifier: string
): readonly string[] {
  if (!specifier.startsWith('.')) return Object.freeze([]);
  const base = normalizeSecRepositoryPath(nodePath.posix.join(
    nodePath.posix.dirname(normalizeSecRepositoryPath(sourcePath)),
    specifier
  ));
  const extension = nodePath.posix.extname(base);
  if (/^\.(?:[cm]?tsx?)$/u.test(extension)) return Object.freeze([base]);
  if (/^\.(?:[cm]?jsx?)$/u.test(extension)) {
    const stem = base.slice(0, -extension.length);
    return Object.freeze([...new Set([
      base,
      `${stem}.ts`,
      `${stem}.tsx`,
      `${stem}.mts`,
      `${stem}.cts`
    ])].sort((left, right) => left.localeCompare(right, 'en-US')));
  }
  if (extension) return Object.freeze([base]);
  return Object.freeze([
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mts`,
    `${base}/index.cts`
  ]);
}

function requiresLocalModuleResolution(specifier: string): boolean {
  return specifier.startsWith('.');
}

function isCanonicalSecRepositoryModulePath(value: string): boolean {
  return value.length > 0
    && !value.includes('\0')
    && !value.startsWith('../')
    && !value.includes('/../')
    && !value.includes('/./')
    && !nodePath.isAbsolute(value)
    && !/^[A-Za-z]:/u.test(value)
    && !isRetiredRepositoryRootPath(value)
    && normalizeSecRepositoryPath(value) === value;
}

/**
 * Compile one deterministic import graph from an already observed source
 * snapshot.  This is the graph owner consumed by test-impact and any future
 * reverse projection.  The optional import reader is cache-only: it must
 * return records produced by `scanSecRepositoryModuleImports`.
 */
export function compileSecRepositoryModuleGraph(
  input: SecRepositoryModuleGraphCompileInput
): SecRepositoryModuleGraph {
  const files = Object.freeze([...new Set(input.files.map((file) => {
    const normalized = normalizeSecRepositoryPath(file);
    if (isRetiredRepositoryRootPath(normalized)) {
      throw new Error(`repository module graph path uses a retired repository root: ${file}`);
    }
    if (!isCanonicalSecRepositoryModulePath(normalized)) {
      throw new Error(`repository module graph path is not canonical: ${file}`);
    }
    return normalized;
  }))].sort((left, right) => left.localeCompare(right, 'en-US')));
  const fileSet = new Set(files);
  const unresolvedFiles = new Set<string>(
    (input.unresolvedFiles ?? []).map(normalizeSecRepositoryPath)
  );
  const references: SecRepositoryModuleGraphReference[] = [];
  const reverseConsumers = new Map<string, string[]>();
  const forwardDependencies = new Map<string, Set<string>>();
  const runtimeForwardDependencies = new Map<string, Set<string>>();
  for (const moduleFile of files) {
    const source = input.readSource(moduleFile);
    if (source === null) {
      unresolvedFiles.add(moduleFile);
      continue;
    }
    let imports: readonly SecRepositoryModuleGraphImport[];
    try {
      imports = input.readImports === undefined
        ? scanSecRepositoryModuleImports(source)
        : input.readImports(moduleFile, source);
    } catch {
      unresolvedFiles.add(moduleFile);
      continue;
    }
    const uniqueImports = new Map<string, SecRepositoryModuleGraphImport>();
    for (const reference of imports) {
      uniqueImports.set(`${reference.kind}\0${reference.specifier}`, reference);
    }
    for (const reference of uniqueImports.values()) {
      const candidates = resolveSecRepositoryModuleImportCandidates(
        moduleFile,
        reference.specifier
      );
      const retiredCandidate = candidates.find(isRetiredRepositoryRootPath);
      if (retiredCandidate !== undefined) {
        throw new Error(
          `repository module import targets a retired repository root: `
          + `${moduleFile} -> ${retiredCandidate}`
        );
      }
      const local = reference.specifier.startsWith('.');
      if (local && candidates.some((candidate) => !isCanonicalSecRepositoryModulePath(candidate))) {
        unresolvedFiles.add(moduleFile);
      }
      const resolvedTarget = candidates.find((candidate) => fileSet.has(candidate)) ?? null;
      if (resolvedTarget !== null
          && isTestOnlyRepositoryModulePath(resolvedTarget)
          && !isTestOnlyRepositoryModulePath(moduleFile)) {
        throw new Error(
          `production repository module imports test-only module: ${moduleFile} -> ${resolvedTarget}`
        );
      }
      if (local
          && resolvedTarget === null
          && requiresLocalModuleResolution(reference.specifier)) {
        unresolvedFiles.add(moduleFile);
      }
      const graphReference = Object.freeze({
        from: moduleFile,
        kind: reference.kind,
        specifier: reference.specifier,
        typeOnly: reference.typeOnly,
        candidateTargets: Object.freeze([...new Set(candidates)].sort((left, right) => left.localeCompare(right, 'en-US'))),
        resolvedTarget
      });
      references.push(graphReference);
      if (resolvedTarget !== null) {
        const dependencies = forwardDependencies.get(moduleFile) ?? new Set<string>();
        dependencies.add(resolvedTarget);
        forwardDependencies.set(moduleFile, dependencies);
        if (!reference.typeOnly) {
          const runtimeDependencies = runtimeForwardDependencies.get(moduleFile) ?? new Set<string>();
          runtimeDependencies.add(resolvedTarget);
          runtimeForwardDependencies.set(moduleFile, runtimeDependencies);
        }
      }
      for (const candidate of graphReference.candidateTargets) {
        const consumers = reverseConsumers.get(candidate) ?? [];
        if (!consumers.includes(moduleFile)) consumers.push(moduleFile);
        reverseConsumers.set(candidate, consumers);
      }
    }
  }
  for (const consumers of reverseConsumers.values()) consumers.sort((left, right) => left.localeCompare(right, 'en-US'));
  references.sort((left, right) => (
    left.from.localeCompare(right.from, 'en-US')
    || left.specifier.localeCompare(right.specifier, 'en-US')
    || left.kind.localeCompare(right.kind, 'en-US')
  ));
  const frozenReferences = Object.freeze(references);
  return Object.freeze({
    files,
    references: frozenReferences,
    unresolvedFiles: Object.freeze([...unresolvedFiles].sort((left, right) => left.localeCompare(right, 'en-US'))),
    directConsumers: (modulePath) => Object.freeze([
      ...(reverseConsumers.get(normalizeSecRepositoryPath(modulePath)) ?? [])
    ]),
    directDependencies: (modulePath) => Object.freeze([
      ...(forwardDependencies.get(normalizeSecRepositoryPath(modulePath)) ?? [])
    ].sort((left, right) => left.localeCompare(right, 'en-US'))),
    directRuntimeDependencies: (modulePath) => Object.freeze([
      ...(runtimeForwardDependencies.get(normalizeSecRepositoryPath(modulePath)) ?? [])
    ].sort((left, right) => left.localeCompare(right, 'en-US')))
  });
}

function isTypeScriptRepositoryModulePath(value: string): boolean {
  return /\.(?:[cm]?tsx?)$/u.test(value);
}

/**
 * Derive one relocation entry from the already compiled repository graph.
 * This is intentionally a pure projection: it never reads the worktree and
 * never turns an unresolved/non-TypeScript edge into a best-effort move.
 * Physical preimages and the effect transaction belong to the transaction
 * owner, which consumes this entry.
 */
export function compileSecRepositoryModuleRelocationPlanEntry(
  graph: SecRepositoryModuleGraph,
  sourcePath: string,
  targetPath: string
): SecRepositoryModuleRelocationPlanEntry {
  const source = normalizeSecRepositoryPath(sourcePath);
  const target = normalizeSecRepositoryPath(targetPath);
  if (isRetiredRepositoryRootPath(source) || isRetiredRepositoryRootPath(target)) {
    throw new Error('repository relocation path uses a retired repository root');
  }
  if (!isCanonicalSecRepositoryModulePath(source)
      || !isCanonicalSecRepositoryModulePath(target)
      || source !== sourcePath
      || target !== targetPath
      || source === target) {
    throw new Error('repository relocation paths must be distinct canonical repository paths');
  }
  const references = Object.freeze(graph.references.filter((reference) => reference.from === source));
  const unresolved: SecRepositoryModuleRelocationUnresolvedReference[] = [];
  const addUnresolved = (
    reference: Readonly<{
      readonly from: string;
      readonly specifier: string;
      readonly kind: SecModuleImportKind;
    }>,
    reason: SecRepositoryModuleRelocationUnresolvedReference['reason']
  ): void => {
    unresolved.push(Object.freeze({ ...reference, reason }));
  };
  const sourceIsTypeScript = isTypeScriptRepositoryModulePath(source);
  if (!sourceIsTypeScript || !isTypeScriptRepositoryModulePath(target)) {
    addUnresolved({ from: source, specifier: target, kind: 'static' }, 'non-typescript-reference');
  }
  if (!graph.files.includes(source) || graph.unresolvedFiles.includes(source)) {
    addUnresolved({ from: source, specifier: '<source-file>', kind: 'static' }, 'unresolved-source');
  }
  for (const reference of references) {
    if (reference.resolvedTarget === null) {
      addUnresolved(reference, 'unresolved-target');
      continue;
    }
    if (!isTypeScriptRepositoryModulePath(reference.resolvedTarget)) {
      addUnresolved(reference, 'non-typescript-reference');
    }
  }
  const uniqueUnresolved = new Map<string, SecRepositoryModuleRelocationUnresolvedReference>();
  for (const reference of unresolved) {
    uniqueUnresolved.set(
      `${reference.from}\0${reference.kind}\0${reference.specifier}\0${reference.reason}`,
      reference
    );
  }
  return Object.freeze({
    sourcePath: source,
    targetPath: target,
    sourceKind: sourceIsTypeScript && isTypeScriptRepositoryModulePath(target)
      ? 'typescript' : 'unsupported',
    references,
    unresolvedReferences: Object.freeze([...uniqueUnresolved.values()])
  });
}

function repositoryModuleTextOrder(left: string, right: string): number {
  return left.localeCompare(right, 'en-US');
}

function repositoryModuleOwnerEdgeKey(fromOwner: string, toOwner: string): string {
  return `${fromOwner}\0${toOwner}`;
}

function compileRepositoryModuleOwnerEdges(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership
): readonly SecRepositoryModuleOwnerEdge[] {
  const witnessesByEdge = new Map<string, SecRepositoryModuleEdgeWitness[]>();
  for (const reference of graph.references) {
    if (reference.resolvedTarget === null || isTestOnlyRepositoryModulePath(reference.from)) continue;
    const sourceOwner = membership.moduleForPath(reference.from);
    const targetOwner = membership.moduleForPath(reference.resolvedTarget);
    if (sourceOwner === null || targetOwner === null || sourceOwner.moduleId === targetOwner.moduleId) continue;
    const key = repositoryModuleOwnerEdgeKey(sourceOwner.moduleId, targetOwner.moduleId);
    const witnesses = witnessesByEdge.get(key) ?? [];
    witnesses.push(Object.freeze({
      fromPath: reference.from,
      toPath: reference.resolvedTarget,
      kind: reference.kind,
      specifier: reference.specifier
    }));
    witnessesByEdge.set(key, witnesses);
  }
  return Object.freeze([...witnessesByEdge.entries()].map(([key, witnesses]) => {
    const separator = key.indexOf('\0');
    const uniqueWitnesses = new Map<string, SecRepositoryModuleEdgeWitness>();
    for (const witness of witnesses) {
      uniqueWitnesses.set(
        `${witness.fromPath}\0${witness.toPath}\0${witness.kind}\0${witness.specifier}`,
        witness
      );
    }
    return Object.freeze({
      fromOwner: key.slice(0, separator),
      toOwner: key.slice(separator + 1),
      witnesses: Object.freeze([...uniqueWitnesses.values()].sort((left, right) => (
        repositoryModuleTextOrder(left.fromPath, right.fromPath)
        || repositoryModuleTextOrder(left.toPath, right.toPath)
        || repositoryModuleTextOrder(left.kind, right.kind)
        || repositoryModuleTextOrder(left.specifier, right.specifier)
      )))
    });
  }).sort((left, right) => (
    repositoryModuleTextOrder(left.fromOwner, right.fromOwner)
    || repositoryModuleTextOrder(left.toOwner, right.toOwner)
  )));
}

function compileRepositoryStrongComponentIds(
  nodeIds: readonly string[],
  edges: readonly Readonly<{ readonly from: string; readonly to: string }>[]
): readonly (readonly string[])[] {
  const selfLoops = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) selfLoops.add(edge.from);
  }
  return Object.freeze(compileClosedDirectedGraphStrongComponents(nodeIds, edges).filter((component) => (
    component.length > 1 || selfLoops.has(component[0]!)
  )));
}

function compileRepositoryModuleStrongComponents(
  ownerIds: readonly string[],
  ownerEdges: readonly SecRepositoryModuleOwnerEdge[]
): readonly SecRepositoryModuleStrongComponent[] {
  return Object.freeze(compileRepositoryStrongComponentIds(
    ownerIds,
    ownerEdges.map(({ fromOwner: from, toOwner: to }) => ({ from, to }))
  ).map((ownerIds) => {
    const componentSet = new Set(ownerIds);
    return Object.freeze({
      ownerIds,
      edges: Object.freeze(ownerEdges.filter((edge) => (
        componentSet.has(edge.fromOwner) && componentSet.has(edge.toOwner)
      )))
    });
  }));
}

function compileRepositoryModuleFileStrongComponents(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership
): readonly SecRepositoryModuleFileStrongComponent[] {
  const edgesByOwner = new Map<string, SecRepositoryModuleEdgeWitness[]>();
  for (const reference of graph.references) {
    if (reference.resolvedTarget === null
        || /\.d\.[cm]?ts$/u.test(reference.from)
        || /\.d\.[cm]?ts$/u.test(reference.resolvedTarget)) continue;
    const sourceOwner = membership.moduleForPath(reference.from);
    const targetOwner = membership.moduleForPath(reference.resolvedTarget);
    if (sourceOwner === null || targetOwner === null
        || sourceOwner.moduleId !== targetOwner.moduleId) continue;
    const edges = edgesByOwner.get(sourceOwner.moduleId) ?? [];
    edges.push(Object.freeze({
      fromPath: reference.from,
      toPath: reference.resolvedTarget,
      kind: reference.kind,
      specifier: reference.specifier
    }));
    edgesByOwner.set(sourceOwner.moduleId, edges);
  }
  const components: SecRepositoryModuleFileStrongComponent[] = [];
  for (const [ownerId, rawEdges] of [...edgesByOwner].sort(([left], [right]) => (
    repositoryModuleTextOrder(left, right)
  ))) {
    const uniqueEdges = new Map<string, SecRepositoryModuleEdgeWitness>();
    for (const edge of rawEdges) {
      uniqueEdges.set(
        `${edge.fromPath}\0${edge.toPath}\0${edge.kind}\0${edge.specifier}`,
        edge
      );
    }
    const edges = [...uniqueEdges.values()].sort((left, right) => (
      repositoryModuleTextOrder(left.fromPath, right.fromPath)
      || repositoryModuleTextOrder(left.toPath, right.toPath)
      || repositoryModuleTextOrder(left.kind, right.kind)
      || repositoryModuleTextOrder(left.specifier, right.specifier)
    ));
    const paths = edges.flatMap(({ fromPath, toPath }) => [fromPath, toPath]);
    for (const componentPaths of compileRepositoryStrongComponentIds(
      paths,
      edges.map(({ fromPath: from, toPath: to }) => ({ from, to }))
    )) {
      const componentSet = new Set(componentPaths);
      components.push(Object.freeze({
        ownerId,
        paths: componentPaths,
        edges: Object.freeze(edges.filter(({ fromPath, toPath }) => (
          componentSet.has(fromPath) && componentSet.has(toPath)
        )))
      }));
    }
  }
  return Object.freeze(components);
}

function compileRepositoryModuleReciprocalPairs(
  ownerEdges: readonly SecRepositoryModuleOwnerEdge[]
): readonly SecRepositoryModuleReciprocalPair[] {
  const byKey = new Map(ownerEdges.map((edge) => [
    repositoryModuleOwnerEdgeKey(edge.fromOwner, edge.toOwner),
    edge
  ] as const));
  const pairs: SecRepositoryModuleReciprocalPair[] = [];
  for (const forward of ownerEdges) {
    if (repositoryModuleTextOrder(forward.fromOwner, forward.toOwner) >= 0) continue;
    const reverse = byKey.get(repositoryModuleOwnerEdgeKey(forward.toOwner, forward.fromOwner));
    if (reverse === undefined) continue;
    pairs.push(Object.freeze({
      ownerIds: Object.freeze([forward.fromOwner, forward.toOwner]) as readonly [string, string],
      forward,
      reverse
    }));
  }
  return Object.freeze(pairs);
}

/**
 * Repeatedly remove the deterministic DFS back-edge until no cycle remains.
 * This is a guaranteed feedback edge set, not a claim that an NP-hard minimum
 * feedback set was solved.  Each cut retains every exact source witness so a
 * human or codemod can choose the semantic seam rather than guessing a file.
 */
function compileRepositoryModuleFeedbackCuts(
  ownerIds: readonly string[],
  ownerEdges: readonly SecRepositoryModuleOwnerEdge[]
): readonly SecRepositoryModuleOwnerEdge[] {
  const remaining = new Map(ownerEdges.map((edge) => [
    repositoryModuleOwnerEdgeKey(edge.fromOwner, edge.toOwner),
    edge
  ] as const));
  const cuts: SecRepositoryModuleOwnerEdge[] = [];
  const findBackEdge = (): SecRepositoryModuleOwnerEdge | null => {
    const state = new Map<string, 'active' | 'complete'>();
    const visit = (ownerId: string): SecRepositoryModuleOwnerEdge | null => {
      state.set(ownerId, 'active');
      const outgoing = [...remaining.values()]
        .filter((edge) => edge.fromOwner === ownerId)
        .sort((left, right) => repositoryModuleTextOrder(left.toOwner, right.toOwner));
      for (const edge of outgoing) {
        const targetState = state.get(edge.toOwner);
        if (targetState === 'active') return edge;
        if (targetState === undefined) {
          const nested = visit(edge.toOwner);
          if (nested !== null) return nested;
        }
      }
      state.set(ownerId, 'complete');
      return null;
    };
    for (const ownerId of [...ownerIds].sort(repositoryModuleTextOrder)) {
      if (state.has(ownerId)) continue;
      const edge = visit(ownerId);
      if (edge !== null) return edge;
    }
    return null;
  };
  for (;;) {
    const cut = findBackEdge();
    if (cut === null) break;
    cuts.push(cut);
    remaining.delete(repositoryModuleOwnerEdgeKey(cut.fromOwner, cut.toOwner));
  }
  return Object.freeze(cuts);
}

/**
 * Compile the low-cost ownership topology from the same canonical graph used
 * by full architecture admission. This is the edit-loop projection: it keeps
 * exact witnesses and never guesses semantic roles or aggregate facades.
 */
export function compileSecRepositoryModuleTopologyProjection(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership
): SecRepositoryModuleTopologyProjection {
  const ownerEdges = compileRepositoryModuleOwnerEdges(graph, membership);
  const ownerIds = membership.descriptors.map(({ moduleId }) => moduleId);
  return Object.freeze({
    ownerEdges,
    strongComponents: compileRepositoryModuleStrongComponents(ownerIds, ownerEdges),
    fileStrongComponents: compileRepositoryModuleFileStrongComponents(graph, membership),
    reciprocalPairs: compileRepositoryModuleReciprocalPairs(ownerEdges),
    feedbackCuts: compileRepositoryModuleFeedbackCuts(ownerIds, ownerEdges),
    violations: collectSecRepositoryModuleBoundaryViolations(graph, membership)
  });
}

type RepositorySourceAddress = Readonly<{
  domain: string;
  area: string | null;
  path: string;
}>;

const PRODUCT_SOURCE_DOMAINS = new Set([
  'compiler',
  'external-capabilities',
  'reference',
  'release',
  'runtime-state',
  'semantic',
  'toolchain',
  'workspace'
]);

const COMPILER_INTERNAL_FACADE_AREAS = new Set([
  'align',
  'codegen',
  'compose',
  'emit',
  'parse',
  'repair',
  'resolve',
  'synthesize',
  'verify'
]);

function repositorySourceAddress(value: string): RepositorySourceAddress | null {
  const path = normalizeSecRepositoryPath(value);
  const segments = path.split('/');
  if (segments[0] !== 'src' || segments.length < 2) return null;
  return Object.freeze({
    domain: segments[1]!,
    area: segments.length > 2 ? segments[2]! : null,
    path
  });
}

function collectRepositoryImportPolicyViolations(
  reference: SecRepositoryModuleGraphReference
): readonly SecRepositoryModuleBoundaryViolation[] {
  if (reference.resolvedTarget === null) return Object.freeze([]);
  const source = repositorySourceAddress(reference.from);
  const target = repositorySourceAddress(reference.resolvedTarget);
  if (source === null || target === null) return Object.freeze([]);
  const violations: SecRepositoryModuleBoundaryViolation[] = [];
  const add = (code: SecRepositoryModuleBoundaryViolationCode): void => {
    violations.push(Object.freeze({
      code,
      from: source.path,
      to: target.path,
      detail: `${code}: ${source.path} imports ${target.path}`
    }));
  };

  if (source.domain === 'compiler'
      && source.area !== 'orchestration'
      && (target.domain === 'interface' && target.area === 'cli'
        || target.domain === 'compiler' && target.area === 'orchestration'
        || target.domain === 'development' && target.area === 'runner')) {
    add('compiler-no-upward-entrypoint-deps');
  }
  if (source.domain === 'compiler'
      && source.area === 'orchestration'
      && (target.domain === 'interface' && target.area === 'cli'
        || target.domain === 'development' && target.area === 'runner')) {
    add('orchestrator-no-cli-or-dev-runner');
  }
  if (PRODUCT_SOURCE_DOMAINS.has(source.domain)
      && !isSecRepositoryTestModulePath(source.path)
      && target.domain === 'control'
      && target.area !== 'task') {
    add('product-no-codex-control-plane');
  }
  if (source.domain !== 'compiler'
      && !(source.domain === 'change-management' && source.area === 'upgrade')
      && target.domain === 'compiler'
      && target.area !== null
      && COMPILER_INTERNAL_FACADE_AREAS.has(target.area)) {
    add('platform-compiler-facade-boundary');
  }
  if (source.path === 'src/compiler/verify/semantic-mutation-isolated-verification-evidence.ts'
      && target.path === 'src/compiler/verify/run-semantic-mutation-isolated-child.ts') {
    add('verification-evidence-no-child-runner');
  }
  if (source.domain === 'compiler'
      && source.area === 'semantic-mutation'
      && (target.domain === 'workspace'
        || target.domain === 'change-management' && target.area === 'upgrade'
        || target.domain === 'compiler' && (target.area === 'orchestration' || target.area === 'repair'))) {
    add('semantic-mutation-no-upward-layer-deps');
  }
  if (source.domain === 'compiler'
      && (source.area === 'ir' || source.area === 'semantic-impact' || source.area === 'projection')
      && target.domain === 'compiler'
      && target.area === 'semantic-mutation') {
    add('semantic-foundations-no-reverse-mutation-deps');
  }
  if (source.domain === 'compiler'
      && source.area === 'registry'
      && target.domain === 'compiler'
      && target.area !== 'registry') {
    add('no-registry-to-compiler');
  }
  return Object.freeze(violations);
}

/**
 * Enforce the physical package contract on a graph compiled from one source
 * snapshot. The low-level graph owns package membership, bootstrap admission,
 * and the production DAG. Aggregate surfaces require Source Program semantic
 * facts and are enforced by the architecture projection below. This layer
 * does not infer visibility from directory names: declaration visibility is a
 * TypeScript symbol fact compiled by the Source Program Model.
 */
export function collectSecRepositoryModuleBoundaryViolations(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership
): readonly SecRepositoryModuleBoundaryViolation[] {
  const violations: SecRepositoryModuleBoundaryViolation[] = [];
  for (const unresolvedFile of graph.unresolvedFiles) {
    if (repositorySourceAddress(unresolvedFile) === null || /\.d\.[cm]?ts$/u.test(unresolvedFile)) {
      continue;
    }
    violations.push(Object.freeze({
      code: 'no-unresolved-production-dependencies',
      from: unresolvedFile,
      to: '<unresolved>',
      detail: `${unresolvedFile} has an unresolved source or local dependency`
    }));
  }
  for (const reference of graph.references) {
    violations.push(...collectRepositoryImportPolicyViolations(reference));
  }
  const ownerEdges = compileRepositoryModuleOwnerEdges(graph, membership);
  const moduleIds = membership.descriptors.map(({ moduleId }) => moduleId);
  const components = compileRepositoryModuleStrongComponents(moduleIds, ownerEdges);
  for (const component of components) {
    const representative = component.edges[0]!.witnesses[0]!;
    violations.push(Object.freeze({
      code: 'module-dependency-cycle',
      from: representative.fromPath,
      to: representative.toPath,
      detail: `module dependency cycle: ${component.ownerIds.join(' -> ')} -> ${component.ownerIds[0]}`
    }));
  }
  for (const component of compileRepositoryModuleFileStrongComponents(graph, membership)) {
    const representative = component.edges[0]!;
    violations.push(Object.freeze({
      code: 'repository-module-internal-cycle',
      from: representative.fromPath,
      to: representative.toPath,
      detail: `${component.ownerId} internal strongly connected file component: ${component.paths.join(', ')}`
    }));
  }

  for (const descriptor of membership.descriptors) {
    if (!descriptor.preDependencyBootstrap) continue;
    const pending = [...descriptor.externalEntrypoints];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const source = pending.pop()!;
      if (visited.has(source)) continue;
      visited.add(source);
      for (const reference of graph.references) {
        if (reference.from !== source) continue;
        // Dynamic import is the explicit post-bootstrap loading boundary. The
        // pre-dependency closure contains only modules evaluated by static
        // import/require before dependency admission completes.
        if (reference.kind === 'dynamic') continue;
        if (reference.resolvedTarget !== null) {
          pending.push(reference.resolvedTarget);
          continue;
        }
        if (reference.specifier.startsWith('node:')
            || reference.specifier.startsWith('bun:')
            || reference.specifier === 'bun'
            || (reference.specifier.startsWith('.') && reference.specifier.endsWith('.json'))) {
          continue;
        }
        violations.push(Object.freeze({
          code: 'pre-dependency-bootstrap-unavailable-package',
          from: source,
          to: reference.specifier,
          detail: `${descriptor.moduleId} statically imports a package before dependency admission`
        }));
      }
    }
  }
  const unique = new Map<string, SecRepositoryModuleBoundaryViolation>();
  for (const violation of violations) {
    unique.set(
      `${violation.code}\0${violation.from}\0${violation.to}\0${violation.detail}`,
      violation
    );
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    `${left.code}\0${left.from}\0${left.to}\0${left.detail}`
      .localeCompare(`${right.code}\0${right.from}\0${right.to}\0${right.detail}`, 'en-US')));
}

type RepositoryModuleAggregateSurface = 'aggregate' | 'implementation' | 'unknown';

function repositoryResponsibilityForSemanticTargetKind(
  kind: NonNullable<SecRepositoryModuleSourceProgramFacts['responsibilityEvidence']>[number]['target']['kind']
): Extract<SecRepositoryNodeResponsibility, 'contract' | 'capability' | 'operation' | 'workflow'> {
  switch (kind) {
    case 'entity': return 'contract';
    case 'effect': return 'capability';
    case 'operation': return 'operation';
    case 'scenario': return 'workflow';
  }
}

function classifyRepositoryModuleAggregateSurface(
  repositoryPath: string,
  facts: SecRepositoryModuleSourceProgramFacts
): RepositoryModuleAggregateSurface {
  const fileFacts = facts.files.filter(({ path }) => (
    normalizeSecRepositoryPath(path) === repositoryPath
  ));
  if (fileFacts.length !== 1
      || fileFacts[0]!.semanticObservationClass === undefined
      || fileFacts[0]!.semanticObservationClass === 'unknown'
      || fileFacts[0]!.semanticKind === undefined
      || fileFacts[0]!.semanticKind === 'unknown') return 'unknown';
  return fileFacts[0]!.semanticKind === 'pure-reexport' ? 'aggregate' : 'implementation';
}

function compileRepositoryNodeResponsibilities(
  _graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership,
  facts: SecRepositoryModuleSourceProgramFacts
): readonly SecRepositoryNodeResponsibilityProjection[] {
  const digest = (value: unknown): `sha256:${string}` => (
    `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
  );
  const normalizedProductionFacts = [...facts.files]
    .filter(({ path, surface }) => (
      surface === 'production'
      && /\.[cm]?[jt]sx?$/iu.test(path)
    ))
    .flatMap((file) => {
      const path = normalizeSecRepositoryPath(file.path);
      const moduleId = membership.moduleForPath(path)?.moduleId ?? null;
      return moduleId === null ? [] : [{
        ...file,
        path,
        moduleId,
        observedModuleId: file.moduleId
      }];
    })
    .sort((left, right) => repositoryModuleTextOrder(left.path, right.path));
  const factsByPath = new Map<string, typeof normalizedProductionFacts>();
  for (const fact of normalizedProductionFacts) {
    const values = factsByPath.get(fact.path) ?? [];
    values.push(fact);
    factsByPath.set(fact.path, values);
  }
  const duplicateFactPaths = new Set([...factsByPath]
    .filter(([, values]) => values.length !== 1)
    .map(([path]) => path));
  const productionFiles = [...factsByPath.values()]
    .map((values) => values[0]!)
    .sort((left, right) => repositoryModuleTextOrder(left.path, right.path));
  const declarations = (facts.declarations ?? []).map((declaration) => ({
    ...declaration,
    path: normalizeSecRepositoryPath(declaration.path)
  }));
  type ResponsibilityEvidence = NonNullable<
    SecRepositoryModuleSourceProgramFacts['responsibilityEvidence']
  >[number];
  const evidenceByPath = new Map<string, ResponsibilityEvidence[]>();
  for (const evidence of facts.responsibilityEvidence ?? []) {
    const evidencePath = normalizeSecRepositoryPath(evidence.declaration.path);
    const values = evidenceByPath.get(evidencePath) ?? [];
    values.push(evidence);
    evidenceByPath.set(evidencePath, values);
  }
  const semanticRevisions = new Set((facts.responsibilityEvidence ?? [])
    .map(({ semanticRevision }) => semanticRevision));

  type MutableDecision = {
    responsibility: SecRepositoryNodeResponsibility | 'unknown';
    reason: SecRepositoryNodeResponsibilityReason;
  };
  const decisions = new Map<string, MutableDecision>();
  for (const file of productionFiles) {
    const candidates = evidenceByPath.get(file.path) ?? [];
    const valid = candidates.filter((evidence) => {
      if (evidence.observationClass !== 'observed'
          || evidence.reason !== 'validated'
          || evidence.sourceRevision !== facts.sourceRevision
          || evidence.semanticRevision !== facts.semanticRevision
          || semanticRevisions.size !== 1
          || !evidence.responsibilityId.startsWith('responsibility:')
          || !evidence.target.id.startsWith(`${evidence.target.kind}:`)
          || evidence.declaration.moduleId !== file.moduleId
          || evidence.declaration.observationId === null
          || evidence.declaration.declarationDigest === null) return false;
      const exactDeclarations = declarations.filter((declaration) => (
        declaration.exported
        && declaration.path === file.path
        && declaration.name === evidence.declaration.exportName
        && declaration.moduleId === evidence.declaration.moduleId
        && declaration.observationId === evidence.declaration.observationId
        && declaration.declarationDigest === evidence.declaration.declarationDigest
      ));
      return exactDeclarations.length === 1;
    });
    if (duplicateFactPaths.has(file.path) || file.observedModuleId !== file.moduleId
        || valid.length === 0) {
      decisions.set(file.path, {
        responsibility: 'unknown',
        reason: 'responsibility-evidence-unresolved'
      });
    } else if (valid.length > 1 || candidates.length !== valid.length) {
      decisions.set(file.path, {
        responsibility: 'unknown',
        reason: 'responsibility-evidence-conflict'
      });
    } else {
      decisions.set(file.path, {
        responsibility: repositoryResponsibilityForSemanticTargetKind(valid[0]!.target.kind),
        reason: 'semantic-responsibility-binding'
      });
    }
  }

  return Object.freeze(productionFiles.map((file) => {
    const decision = decisions.get(file.path)!;
    const evidence = {
      path: file.path,
      moduleId: file.moduleId,
      sourceRevision: facts.sourceRevision ?? null,
      semanticRevision: facts.semanticRevision ?? null,
      bindings: (evidenceByPath.get(file.path) ?? []).map(({ evidenceDigest }) => evidenceDigest),
      decision
    };
    return Object.freeze({
      path: file.path,
      moduleId: file.moduleId!,
      responsibility: decision.responsibility,
      reason: decision.reason,
      evidenceDigest: digest(evidence)
    });
  }));
}

function repositoryNodeDependencyAllowed(
  from: SecRepositoryNodeResponsibility,
  to: SecRepositoryNodeResponsibility
): boolean {
  if (from === 'contract') return to === 'contract';
  if (from === 'computation') return to === 'contract' || to === 'computation';
  if (from === 'capability') {
    return to === 'contract' || to === 'computation' || to === 'capability';
  }
  if (from === 'operation') {
    return to === 'contract' || to === 'computation' || to === 'capability' || to === 'operation';
  }
  if (from === 'workflow') {
    return to === 'contract' || to === 'computation' || to === 'operation' || to === 'workflow';
  }
  return to === 'contract'
    || to === 'computation'
    || to === 'operation'
    || to === 'workflow'
    || to === 'interface';
}

function compileRepositoryModuleAuthorityRoleViolations(
  membership: SecRepositoryModuleMembership,
  facts: SecRepositoryModuleSourceProgramFacts
): readonly SecRepositoryModuleBoundaryViolation[] {
  const incompatibleRolePairs = new Set([
    'attempt-issuer\u0000grant-issuer',
    'binding-issuer\u0000grant-issuer',
    'domain-owner\u0000grant-issuer',
    'grant-issuer\u0000provider-settlement-issuer',
    'provider-settlement-issuer\u0000readback-issuer',
    'readback-issuer\u0000recovery-issuer'
  ]);
  const violations: SecRepositoryModuleBoundaryViolation[] = [];
  for (const descriptor of membership.descriptors) {
    const roleBindings = descriptor.capabilityProviders.flatMap((provider) => (
      provider.operationRoles.map((binding) => ({ provider, binding }))
    ));
    const bindingsBySemanticOperation = new Map<string, typeof roleBindings>();
    for (const roleBinding of roleBindings) {
      const bindings = bindingsBySemanticOperation.get(roleBinding.binding.semanticOperation) ?? [];
      bindings.push(roleBinding);
      bindingsBySemanticOperation.set(roleBinding.binding.semanticOperation, bindings);
    }
    for (const [semanticOperation, bindings] of bindingsBySemanticOperation) {
      const roleKinds = [...new Set(bindings.map(({ binding }) => binding.role))]
        .sort(repositoryModuleTextOrder);
      const conflict = roleKinds.some((left, index) => roleKinds.slice(index + 1).some((right) => (
        incompatibleRolePairs.has(`${left}\u0000${right}`)
      )));
      if (!conflict) continue;
      violations.push(Object.freeze({
        code: 'repository-module-role-unresolved',
        from: `${descriptor.root}/sec.module.json`,
        to: semanticOperation,
        detail: `${descriptor.moduleId} co-owns independent semantic operation roles for ${semanticOperation}: ${roleKinds.join(', ')}`
      }));
    }

    for (const provider of descriptor.capabilityProviders) {
      if (provider.operationRoles.length === 0) continue;
      const classifiedOperations = new Set([
        ...provider.ownerInternalOperations,
        ...provider.operationRoles.map(({ operation }) => operation)
      ]);
      for (const operation of provider.operations) {
        if (classifiedOperations.has(operation)) continue;
        const declarations = (facts.declarations ?? []).filter((declaration) => (
          declaration.exported
          && declaration.moduleId === descriptor.moduleId
          && declaration.name === operation
        ));
        violations.push(Object.freeze({
          code: 'authority-mint-export-unclassified',
          from: declarations.length === 1
            ? normalizeSecRepositoryPath(declarations[0]!.path)
            : `${descriptor.root}/sec.module.json`,
          to: `${provider.capability}:${operation}`,
          detail: declarations.length === 1
            ? 'exported authority operation has no exact operation role classification'
            : 'declared authority operation has no exact exported declaration and operation role classification'
        }));
      }
    }
  }
  return Object.freeze(violations);
}

/**
 * Compile architecture evidence from the already canonical import graph and
 * TypeScript Source Program facts.  This is a projection, not another graph:
 * it retains the graph's exact references and never reparses source, guesses
 * roles from paths, or turns missing semantic facts into an allow decision.
 */
export function compileSecRepositoryModuleArchitectureProjection(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership,
  facts: SecRepositoryModuleSourceProgramFacts
): SecRepositoryModuleArchitectureProjection {
  const topology = compileSecRepositoryModuleTopologyProjection(graph, membership);
  const { ownerEdges, strongComponents, fileStrongComponents, reciprocalPairs, feedbackCuts } = topology;
  const importedCrossModulePaths = new Set<string>();
  for (const edge of ownerEdges) {
    for (const witness of edge.witnesses) importedCrossModulePaths.add(witness.toPath);
  }
  const aggregateFacadePaths: string[] = [];
  const unresolvedAggregateSurfacePaths: string[] = [];
  for (const repositoryPath of [...importedCrossModulePaths].sort(repositoryModuleTextOrder)) {
    const surface = classifyRepositoryModuleAggregateSurface(repositoryPath, facts);
    if (surface === 'aggregate') aggregateFacadePaths.push(repositoryPath);
    if (surface === 'unknown') unresolvedAggregateSurfacePaths.push(repositoryPath);
  }
  const aggregateSet = new Set(aggregateFacadePaths);
  const unresolvedAggregateSet = new Set(unresolvedAggregateSurfacePaths);
  const nodeResponsibilities = compileRepositoryNodeResponsibilities(graph, membership, facts);
  const responsibilityByPath = new Map(nodeResponsibilities.map((node) => (
    [node.path, node] as const
  )));
  const violations: SecRepositoryModuleBoundaryViolation[] = [
    ...topology.violations,
    ...compileRepositoryModuleAuthorityRoleViolations(membership, facts)
  ];
  for (const edge of ownerEdges) {
    for (const witness of edge.witnesses) {
      if (aggregateSet.has(witness.toPath)) {
        violations.push(Object.freeze({
          code: 'cross-package-aggregate-surface',
          from: witness.fromPath,
          to: witness.toPath,
          detail: `${edge.fromOwner} imports a pure aggregate facade owned by ${edge.toOwner}`
        }));
      } else if (unresolvedAggregateSet.has(witness.toPath)) {
        violations.push(Object.freeze({
          code: 'repository-module-surface-unresolved',
          from: witness.fromPath,
          to: witness.toPath,
          detail: `Source Program facts cannot distinguish aggregate facade from declaration owner`
        }));
      }
    }
  }
  for (const reference of graph.references) {
    if (reference.resolvedTarget === null) continue;
    const from = responsibilityByPath.get(normalizeSecRepositoryPath(reference.from));
    const to = responsibilityByPath.get(normalizeSecRepositoryPath(reference.resolvedTarget));
    if (from === undefined || to === undefined
        || from.responsibility === 'unknown'
        || to.responsibility === 'unknown') continue;
    if (!repositoryNodeDependencyAllowed(from.responsibility, to.responsibility)) {
      violations.push(Object.freeze({
        code: 'repository-node-responsibility-reverse-dependency',
        from: from.path,
        to: to.path,
        detail: `${from.moduleId}:${from.responsibility} depends on ${to.moduleId}:${to.responsibility}`
      }));
    }
  }
  for (const node of nodeResponsibilities) {
    if (node.responsibility !== 'unknown') continue;
    violations.push(Object.freeze({
      code: 'repository-node-responsibility-unresolved',
      from: node.path,
      to: node.moduleId,
      detail: `${node.path} has no unique responsibility; reason=${node.reason}; evidence=${node.evidenceDigest}`
    }));
  }
  const uniqueViolations = new Map<string, SecRepositoryModuleBoundaryViolation>();
  for (const violation of violations) {
    uniqueViolations.set(
      `${violation.code}\0${violation.from}\0${violation.to}\0${violation.detail}`,
      violation
    );
  }
  return Object.freeze({
    ownerEdges,
    strongComponents,
    fileStrongComponents,
    reciprocalPairs,
    feedbackCuts,
    aggregateFacadePaths: Object.freeze(aggregateFacadePaths),
    unresolvedAggregateSurfacePaths: Object.freeze(unresolvedAggregateSurfacePaths),
    nodeResponsibilities,
    violations: Object.freeze([...uniqueViolations.values()].sort((left, right) => (
      repositoryModuleTextOrder(
        `${left.code}\0${left.from}\0${left.to}\0${left.detail}`,
        `${right.code}\0${right.from}\0${right.to}\0${right.detail}`
      )
    )))
  });
}

export function assertSecRepositoryModuleArchitectureBoundaries(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership,
  facts: SecRepositoryModuleSourceProgramFacts
): void {
  const projection = compileSecRepositoryModuleArchitectureProjection(graph, membership, facts);
  if (projection.violations.length === 0) return;
  throw new Error([
    `repository module architecture boundary violations (${projection.violations.length})`,
    ...projection.violations.map((violation) =>
      `[${violation.code}] ${violation.from} -> ${violation.to}: ${violation.detail}`)
  ].join('\n'));
}

/**
 * Close repository ownership over the canonical Source Program facts.  The
 * descriptor graph does not rediscover source surfaces or package commands;
 * it only rejects facts that the exact Source Program snapshot has already
 * classified and resolved.
 */
export function collectSecRepositoryModuleSourceProgramViolations(
  facts: SecRepositoryModuleSourceProgramFacts,
  membership: SecRepositoryModuleMembership
): readonly SecRepositoryModuleBoundaryViolation[] {
  const violations: SecRepositoryModuleBoundaryViolation[] = [];
  const descriptorsById = new Map(membership.descriptors.map((descriptor) => (
    [descriptor.moduleId, descriptor] as const
  )));

  for (const file of facts.files) {
    if (file.surface !== 'production'
        || !normalizeSecRepositoryPath(file.path).startsWith('src/')
        || !/\.[cm]?[jt]sx?$/iu.test(file.path)
        || file.moduleId !== null) continue;
    violations.push(Object.freeze({
      code: 'unowned-production-source',
      from: file.path,
      to: 'sec.module.json',
      detail: `${file.path} is production source with no repository module owner`
    }));
  }

  const closureByEntrypoint = new Map(facts.entrypointClosures.map((closure) => (
    [closure.entrypointObservationId, closure] as const
  )));
  for (const entrypoint of facts.entrypoints) {
    if (entrypoint.kind !== 'package-script'
        && entrypoint.kind !== 'package-bin'
        && entrypoint.kind !== 'module-entrypoint') continue;
    const closure = closureByEntrypoint.get(entrypoint.observationId);
    if (closure === undefined) continue;
    const repositoryHandlerPaths = [...new Set([
      ...closure.targetPaths,
      ...closure.capabilityPaths,
      ...closure.reachablePaths
    ].map(normalizeSecRepositoryPath).filter((repositoryPath) => (
      repositoryPath.startsWith('src/')
      && /\.[cm]?[jt]sx?$/iu.test(repositoryPath)
    )))].sort((left, right) => left.localeCompare(right, 'en-US'));
    const handlerModuleIds = [...new Set(closure.handlerModuleIds)]
      .sort((left, right) => left.localeCompare(right, 'en-US'));
    // External-package-only scripts have no repository handler and therefore
    // do not claim a repository module entrypoint.
    if (repositoryHandlerPaths.length === 0 && handlerModuleIds.length === 0) continue;
    const entrypointIdentity = `${entrypoint.kind}:${entrypoint.path}#${entrypoint.name}`;
    if (entrypoint.observationClass === 'unknown'
        || closure.observationClass === 'unknown'
        || handlerModuleIds.length === 0) {
      violations.push(Object.freeze({
        code: 'repository-entrypoint-owner-unresolved',
        from: entrypoint.path,
        to: entrypointIdentity,
        detail: `${entrypointIdentity} has repository source but no resolved module owner`
      }));
      continue;
    }
    if (handlerModuleIds.length > 1) {
      violations.push(Object.freeze({
        code: 'repository-entrypoint-owner-ambiguous',
        from: entrypoint.path,
        to: entrypointIdentity,
        detail: `${entrypointIdentity} resolves to multiple module owners: ${handlerModuleIds.join(', ')}`
      }));
      continue;
    }
    const owner = descriptorsById.get(handlerModuleIds[0]!);
    if (owner === undefined) {
      violations.push(Object.freeze({
        code: 'repository-entrypoint-owner-unresolved',
        from: entrypoint.path,
        to: entrypointIdentity,
        detail: `${entrypointIdentity} resolves to unknown module ${handlerModuleIds[0]}`
      }));
      continue;
    }
    const declaredEntrypoints = new Set(owner.externalEntrypoints.map(normalizeSecRepositoryPath));
    const ownedHandlerPaths = repositoryHandlerPaths.filter((repositoryPath) => (
      membership.moduleForPath(repositoryPath)?.moduleId === owner.moduleId
    ));
    if (ownedHandlerPaths.length === 0
        || !ownedHandlerPaths.some((repositoryPath) => declaredEntrypoints.has(repositoryPath))) {
      violations.push(Object.freeze({
        code: 'repository-entrypoint-not-declared',
        from: entrypoint.path,
        to: owner.root,
        detail: `${entrypointIdentity} resolves to ${owner.moduleId} but none of its handler paths are declared as externalEntrypoints: ${ownedHandlerPaths.join(', ') || '<none>'}`
      }));
    }
  }

  const unique = new Map<string, SecRepositoryModuleBoundaryViolation>();
  for (const violation of violations) {
    unique.set(
      `${violation.code}\0${violation.from}\0${violation.to}\0${violation.detail}`,
      violation
    );
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    `${left.code}\0${left.from}\0${left.to}\0${left.detail}`
      .localeCompare(`${right.code}\0${right.from}\0${right.to}\0${right.detail}`, 'en-US')));
}

export function assertSecRepositoryModuleSourceProgramBoundaries(
  facts: SecRepositoryModuleSourceProgramFacts,
  membership: SecRepositoryModuleMembership
): void {
  const violations = collectSecRepositoryModuleSourceProgramViolations(facts, membership);
  if (violations.length === 0) return;
  throw new Error([
    `repository module source-program boundary violations (${violations.length})`,
    ...violations.map((violation) =>
      `[${violation.code}] ${violation.from} -> ${violation.to}: ${violation.detail}`)
  ].join('\n'));
}

export function assertSecRepositoryModuleImportBoundaries(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership
): void {
  const violations = collectSecRepositoryModuleBoundaryViolations(graph, membership);
  if (violations.length === 0) return;
  throw new Error([
    `repository module boundary violations (${violations.length})`,
    ...violations.map((violation) =>
      `[${violation.code}] ${violation.from} -> ${violation.to}: ${violation.detail}`)
  ].join('\n'));
}

function descriptorExternalEntrypointPaths(
  descriptor: SecModuleDescriptor
): readonly string[] {
  return Object.freeze(descriptor.externalEntrypoints.map(normalizeRepositoryPath));
}

function descriptorGraphRoots(
  descriptors: readonly SecModuleDescriptor[]
): readonly string[] {
  const candidates = [...new Set(descriptors.flatMap((descriptor) => [
    descriptor.root,
    ...descriptorExternalEntrypointPaths(descriptor)
      .map((entrypoint) => normalizeRepositoryPath(nodePath.posix.dirname(entrypoint)))
  ]))].sort((left, right) => (
    left.split('/').length - right.split('/').length
    || left.localeCompare(right, 'en-US')
  ));
  const roots: string[] = [];
  for (const candidate of candidates) {
    if (!roots.some((root) => pathWithinRoot(candidate, root))) roots.push(candidate);
  }
  return Object.freeze(roots.sort((left, right) => left.localeCompare(right, 'en-US')));
}

const DESCRIPTOR_DISCOVERY_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.tmp',
  'dist',
  'node_modules',
  'report'
]);

function discoverDescriptorPathsSync(
  repositoryRoot: string
): readonly string[] {
  const paths: string[] = [];
  const visit = (absoluteDirectory: string): void => {
    const entries = readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, 'en-US'));
    for (const entry of entries) {
      if (entry.isDirectory() && DESCRIPTOR_DISCOVERY_IGNORED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = nodePath.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name === 'sec.module.json') {
        paths.push(normalizeRepositoryPath(nodePath.relative(repositoryRoot, absolutePath)));
      }
    }
  };
  visit(repositoryRoot);
  return Object.freeze(paths.sort((left, right) => left.localeCompare(right, 'en-US')));
}

/**
 * Discover module descriptors once at the architecture owner.  Consumers may
 * cache the returned membership projection, but may not rediscover descriptor
 * roots or duplicate the path matcher.
 */
export function discoverSecModuleDescriptors(
  repositoryRoot: string
): readonly SecModuleDescriptor[] {
  const absoluteRepositoryRoot = nodePath.resolve(repositoryRoot);
  const descriptorPaths = discoverDescriptorPathsSync(absoluteRepositoryRoot);
  return Object.freeze(descriptorPaths.map((descriptorPath) => {
    const descriptorFile = nodePath.join(absoluteRepositoryRoot, ...descriptorPath.split('/'));
    return parseSecModuleDescriptor(
      JSON.parse(readFileSync(descriptorFile, 'utf8')),
      descriptorPath
    );
  }).sort((left, right) => left.root.localeCompare(right.root, 'en-US')));
}

/**
 * Compile only the descriptor/path facts consumed by the affected-test
 * selector. Import edges are compiled separately from the selector's exact
 * source snapshot; descriptors never rediscover or certify repository files.
 */
function compileSecRepositoryModuleMembershipFromDescriptors(
  descriptors: readonly SecModuleDescriptor[],
  observation: Readonly<{
    directExecutableSources: (descriptor: SecModuleDescriptor) => readonly string[];
    entrypointExists: (entrypoint: string) => boolean;
    rootExists: (descriptor: SecModuleDescriptor) => boolean;
  }>
): SecRepositoryModuleMembership {
  const moduleIds = new Set<string>();
  const rootKeys = new Set<string>();
  const bySpecificity = [...descriptors].sort((left, right) => right.root.length - left.root.length);
  const entrypointOwners = new Map<string, SecModuleDescriptor>();
  const capabilityOwners = new Map<string, SecModuleDescriptor>();
  for (const descriptor of descriptors) {
    if (isRetiredRepositoryRootPath(descriptor.root)) {
      throw new Error(
        `repository module descriptor uses a retired repository root: ${descriptor.root}`
      );
    }
    if (moduleIds.has(descriptor.moduleId)) {
      throw new Error(`duplicate repository moduleId: ${descriptor.moduleId}`);
    }
    moduleIds.add(descriptor.moduleId);
    const rootKey = descriptor.root.toLocaleLowerCase('en-US');
    if (rootKeys.has(rootKey)) throw new Error(`duplicate repository module root: ${descriptor.root}`);
    rootKeys.add(rootKey);
    if (!observation.rootExists(descriptor)) {
      throw new Error(`repository module root is not a directory: ${descriptor.root}`);
    }
    if (descriptor.importGraph === 'content') {
      const directExecutableSources = observation.directExecutableSources(descriptor);
      if (directExecutableSources.length > 0) {
        throw new Error(
          `${descriptor.moduleId} content root mixes executable source: `
          + directExecutableSources.join(', ')
        );
      }
    }
    for (const provider of descriptor.capabilityProviders) {
      const previous = capabilityOwners.get(provider.capability);
      if (previous !== undefined && previous.moduleId !== descriptor.moduleId) {
        throw new Error(
          `repository capability ${provider.capability} is claimed by multiple modules: `
          + `${previous.moduleId}, ${descriptor.moduleId}`
        );
      }
      capabilityOwners.set(provider.capability, descriptor);
    }
    for (const entrypoint of descriptorExternalEntrypointPaths(descriptor)) {
      if (isRetiredRepositoryRootPath(entrypoint)) {
        throw new Error(
          `repository module entrypoint uses a retired repository root: ${entrypoint}`
        );
      }
      const physicalOwner = bySpecificity.find((candidate) => pathWithinRoot(entrypoint, candidate.root));
      if (physicalOwner !== undefined && physicalOwner.moduleId !== descriptor.moduleId) {
        throw new Error(
          `${descriptor.moduleId} external entrypoint is inside ${physicalOwner.moduleId}: ${entrypoint}`
        );
      }
      if (!observation.entrypointExists(entrypoint)) {
        throw new Error(`${descriptor.moduleId} entrypoint does not exist: ${entrypoint}`);
      }
      const entrypointKey = entrypoint.toLocaleLowerCase('en-US');
      const previous = entrypointOwners.get(entrypointKey);
      if (previous && previous.moduleId !== descriptor.moduleId) {
        throw new Error(`repository module entrypoint is claimed by multiple modules: ${entrypoint}`);
      }
      entrypointOwners.set(entrypointKey, descriptor);
    }
  }
  const ownershipRoots = bySpecificity.map((descriptor) => Object.freeze({
    descriptor,
    normalizedRoot: descriptor.root.toLocaleLowerCase('en-US')
  }));
  const moduleForPathCache = new Map<string, SecModuleDescriptor | null>();
  const moduleForPath = (inputPath: string): SecModuleDescriptor | null => {
    const normalized = normalizeSecRepositoryPath(inputPath);
    const normalizedKey = normalized.toLocaleLowerCase('en-US');
    const cached = moduleForPathCache.get(normalizedKey);
    if (cached !== undefined || moduleForPathCache.has(normalizedKey)) return cached ?? null;
    const owner = entrypointOwners.get(normalizedKey)
      ?? ownershipRoots.find(({ normalizedRoot }) =>
        normalizedKey === normalizedRoot || normalizedKey.startsWith(`${normalizedRoot}/`))
        ?.descriptor
      ?? null;
    moduleForPathCache.set(normalizedKey, owner);
    return owner;
  };
  return Object.freeze({
    descriptors,
    graphRoots: descriptorGraphRoots(descriptors),
    moduleRoots: Object.freeze(descriptors.map(({ root }) => root)),
    moduleForPath
  });
}

/**
 * Compile membership from one immutable repository snapshot. Descriptor bytes,
 * repository paths, and the resulting ownership projection therefore share a
 * single revision instead of consulting the caller's mutable filesystem.
 */
export function compileSecRepositoryModuleMembershipSnapshot(
  snapshot: SecRepositoryModuleMembershipSnapshot
): SecRepositoryModuleMembership {
  const repositoryFiles = Object.freeze(snapshot.repositoryFiles.map((repositoryFile) => {
    const normalized = normalizeSecRepositoryPath(repositoryFile);
    if (isRetiredRepositoryRootPath(normalized)) {
      throw new Error(
        `repository snapshot path uses a retired repository root: ${repositoryFile}`
      );
    }
    if (normalized !== repositoryFile || !isCanonicalSecRepositoryModulePath(normalized)) {
      throw new Error(`repository snapshot contains a non-canonical path: ${repositoryFile}`);
    }
    return normalized;
  }).sort((left, right) => left.localeCompare(right, 'en-US')));
  if (new Set(repositoryFiles).size !== repositoryFiles.length) {
    throw new Error('repository snapshot contains duplicate paths');
  }
  const repositoryFileSet = new Set(repositoryFiles);
  const expectedDescriptorPaths = repositoryFiles.filter((repositoryFile) => (
    nodePath.posix.basename(repositoryFile) === 'sec.module.json'
  ));
  if (expectedDescriptorPaths.length === 0) {
    throw new Error('repository snapshot module descriptor census is missing');
  }
  const descriptorSourceByPath = new Map<string, string>();
  for (const descriptorSource of snapshot.descriptorSources) {
    const descriptorPath = normalizeSecRepositoryPath(descriptorSource.descriptorPath);
    if (descriptorPath !== descriptorSource.descriptorPath
        || nodePath.posix.basename(descriptorPath) !== 'sec.module.json'
        || !repositoryFileSet.has(descriptorPath)) {
      throw new Error(`repository snapshot descriptor is not one observed file: ${descriptorSource.descriptorPath}`);
    }
    if (descriptorSourceByPath.has(descriptorPath)) {
      throw new Error(`repository snapshot contains duplicate descriptor bytes: ${descriptorPath}`);
    }
    descriptorSourceByPath.set(descriptorPath, descriptorSource.source);
  }
  const missingDescriptorPaths = expectedDescriptorPaths.filter((descriptorPath) => (
    !descriptorSourceByPath.has(descriptorPath)
  ));
  if (missingDescriptorPaths.length > 0
      || descriptorSourceByPath.size !== expectedDescriptorPaths.length) {
    throw new Error(
      `repository snapshot descriptor census is incomplete: ${missingDescriptorPaths.join(', ') || 'unexpected descriptor'}`
    );
  }
  const descriptors = Object.freeze(expectedDescriptorPaths.map((descriptorPath) => {
    const source = descriptorSourceByPath.get(descriptorPath)!;
    try {
      return parseSecModuleDescriptor(JSON.parse(source), descriptorPath);
    } catch (error) {
      throw new Error(`repository snapshot descriptor is invalid: ${descriptorPath}`, { cause: error });
    }
  }));
  return compileSecRepositoryModuleMembershipFromDescriptors(descriptors, {
    rootExists: (descriptor) => repositoryFileSet.has(`${descriptor.root}/sec.module.json`),
    entrypointExists: (entrypoint) => repositoryFileSet.has(entrypoint),
    directExecutableSources: (descriptor) => repositoryFiles
      .filter((repositoryFile) => (
        nodePath.posix.dirname(repositoryFile) === descriptor.root
        && /\.(?:[cm]?[jt]sx?)$/u.test(nodePath.posix.basename(repositoryFile))
      ))
      .map((repositoryFile) => nodePath.posix.basename(repositoryFile))
  });
}

export function compileSecRepositoryModuleMembership(
  repositoryRoot: string
): SecRepositoryModuleMembership {
  const absoluteRepositoryRoot = nodePath.resolve(repositoryRoot);
  const descriptors = discoverSecModuleDescriptors(absoluteRepositoryRoot);
  return compileSecRepositoryModuleMembershipFromDescriptors(descriptors, {
    rootExists: (descriptor) => statSync(absolutePathWithinRepository(
      absoluteRepositoryRoot,
      descriptor.root
    )).isDirectory(),
    entrypointExists: (entrypoint) => statSync(absolutePathWithinRepository(
      absoluteRepositoryRoot,
      entrypoint
    )).isFile(),
    directExecutableSources: (descriptor) => readdirSync(absolutePathWithinRepository(
      absoluteRepositoryRoot,
      descriptor.root
    ), { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:[cm]?[jt]sx?)$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en-US'))
  });
}
