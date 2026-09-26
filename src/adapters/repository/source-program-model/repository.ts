import path from 'node:path';
import ts from 'typescript';

import { compareCodeUnits, sha256 } from '../../../contracts/canonical.ts';
import { SEMANTIC_RESPONSIBILITY_TARGET_KINDS, type SemanticResponsibilityTargetKind } from '../../../semantics/definitions/types.ts';
import type { SemanticEntity } from '../../../semantics/engineering-ir/entity-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../semantics/engineering-ir/validated-types.ts';
import type { RepositoryModuleMembership } from '../architecture/contract.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  type SourceProgramCompilationOperation
} from './compilation-operation.ts';
import type {
  SourceProgramCandidate,
  SourceProgramCapabilityAuthorityClass,
  SourceProgramCapabilityInvocation,
  SourceProgramCausalRelationEvidence,
  SourceProgramDeclaration,
  SourceProgramDependency,
  SourceProgramDependencyScope,
  SourceProgramEntrypoint,
  SourceProgramEntrypointAddress,
  SourceProgramEntrypointClosure,
  SourceProgramFile,
  SourceProgramFileInput,
  SourceProgramModel,
  SourceProgramOwnerIntentEvidence,
  SourceProgramPackage,
  SourceProgramResponsibilityEvidence,
  SourceProgramReturnValueProvenance,
  SourceProgramTopologySummary,
  SourceProgramUnknown
} from './contract.ts';
import { sourceProgramSurfaceForPath } from './contract.ts';
import {
  compileSourceProgramEmbeddedWorkflowPrograms,
  observeSourceProgramEmbeddedTypeScriptLiteral,
  sourceProgramModuleImports
} from './embedded-programs.ts';
import { indexOwnerIntentInputs } from './owner-intent-index.ts';
import { indexResponsibilityEvidenceInputs } from './responsibility-evidence-index.ts';
import {
  compileTestObservations,
  compileTestObservationsFromSnapshot,
  snapshotIdentityForTestObservations,
  type TestObservations
} from './test-observations.ts';
import {
  compileRepositoryModuleGraph,
  compileTypeScriptModel,
  compileTypeScriptModelWithCompilation,
  isCompiledTypeScriptModel,
  observeDurableWorkerInput,
  currentExactReturnProvenances,
  workspaceSnapshotIdentityForTypeScriptModel
} from './typescript.ts';
import type { WorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

export interface RepositoryModelInput {
  readonly sourceRevision: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly moduleMembership: RepositoryModuleMembership;
  readonly unknowns?: readonly SourceProgramUnknown[];
  /** Exact process dispatcher inventory observed by the current TCB compiler; never Effect authority. */
  readonly reviewedProcessDispatchers?: readonly string[];
  /**
   * Exact TypeScript facts compiled by this package's incremental compiler.
   * The repository compiler validates the snapshot before consuming it.
   */
  readonly typescriptModel?: SourceProgramModel;
  /** Lightweight test-only observations bound to the production model. */
  readonly testObservations?: TestObservations;
}

type RepositoryModelInternalInput = RepositoryModelInput & Readonly<{
  repositoryCompilation?: WorkspaceSourceSnapshot;
}>;

const compiledRepositoryModels = new WeakSet<object>();

function unreachableModuleOperationIdentity(operation: never): never {
  throw new Error(`Unsupported module operation identity: ${JSON.stringify(operation)}`);
}

/** In-process issuer check; durable consumers use compact strict evidence. */
export function isCompiledRepositoryModel(
  value: SourceProgramModel
): boolean {
  return compiledRepositoryModels.has(value);
}

function exactStringAttribute(entity: SemanticEntity, key: string): string | null {
  const matches = entity.attributes.filter((attribute) => attribute.key === key);
  return matches.length === 1 && typeof matches[0]!.value === 'string'
    ? matches[0]!.value as string
    : null;
}

function responsibilityTargetKind(value: string | null): SemanticResponsibilityTargetKind | null {
  return value !== null && (SEMANTIC_RESPONSIBILITY_TARGET_KINDS as readonly string[]).includes(value)
    ? value as SemanticResponsibilityTargetKind
    : null;
}

/**
 * Read back authoritative semantic bindings against this exact Source Program.
 * The declaration name is never inferred from imports, descriptors or paths.
 */
export function compileResponsibilityEvidence(
  model: SourceProgramModel,
  snapshot: ValidatedEngineeringIRSnapshot
): readonly SourceProgramResponsibilityEvidence[] {
  if (!isCompiledRepositoryModel(model)) {
    throw new Error('Responsibility evidence requires a compiler-issued Repository Source Program Model');
  }
  const bindingEntities = snapshot.ir.entities
    .filter((entity) => entity.kind === 'responsibility-binding')
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  if (bindingEntities.length === 0) return Object.freeze([]);
  const indexed = indexResponsibilityEvidenceInputs(
    bindingEntities.map((binding) => ({
      binding,
      declarationPath: exactStringAttribute(binding, 'declarationPath'),
      exportName: exactStringAttribute(binding, 'declarationExportName')
    })),
    snapshot.ir.facts,
    model.declarations,
    snapshot.ir.semanticRevision
  );

  return Object.freeze(indexed.map(({
    binding, containment, declaration, conflictingDeclarationClaim, declarationPath, exportName
  }): SourceProgramResponsibilityEvidence => {
    const targetKind = responsibilityTargetKind(exactStringAttribute(binding, 'targetKind'));
    const targetId = exactStringAttribute(binding, 'targetId');
    const responsibilityId = containment.status === 'unique' ? containment.value : `unresolved:${binding.id}`;
    const targetPrefix = targetKind === null ? null : `${targetKind}:`;
    const structurallyValid = containment.status === 'unique'
      && targetKind !== null
      && targetId !== null
      && targetId.startsWith(targetPrefix!)
      && declarationPath !== null
      && exportName !== null;
    const reason = !structurallyValid
      ? 'semantic-binding-invalid' as const
      : conflictingDeclarationClaim
        ? 'declaration-binding-conflict' as const
        : declaration.status === 'absent'
          ? 'exported-declaration-missing' as const
          : declaration.status === 'ambiguous'
            ? 'exported-declaration-ambiguous' as const
            : 'validated' as const;
    const match = reason === 'validated' && declaration.status === 'unique' ? declaration.value : null;
    const canonical = {
      bindingId: binding.id,
      responsibilityId,
      target: {
        kind: targetKind ?? 'entity' as const,
        id: targetId ?? 'unresolved'
      },
      declaration: {
        path: declarationPath ?? 'unresolved',
        exportName: exportName ?? 'unresolved',
        observationId: match?.observationId ?? null,
        declarationDigest: match?.declarationDigest ?? null,
        moduleId: match?.moduleId ?? null
      },
      sourceRevision: model.sourceRevision,
      semanticRevision: snapshot.ir.semanticRevision,
      observationClass: reason === 'validated' ? 'observed' as const : 'unknown' as const,
      reason
    };
    return Object.freeze({ ...canonical, evidenceDigest: sha256(canonical) });
  }));
}

/**
 * Compile owner-issued design intent from the strict module descriptor and
 * exact entrypoint closure.  A declaration name or comment cannot enter this
 * projection, and an owner with no declared capability/entrypoint envelope
 * remains explicitly empty rather than acquiring inferred future intent.
 */
export function compileOwnerIntentEvidence(
  model: SourceProgramModel,
  membership: RepositoryModuleMembership,
  requestedOperation?: SourceProgramCompilationOperation
): readonly SourceProgramOwnerIntentEvidence[] {
  const operation = resolveSourceProgramCompilationOperation(requestedOperation);
  sourceProgramCompilationCheckpoint(operation, 'owner-intent', 'start');
  if (membership.descriptors.length === 0) {
    sourceProgramCompilationCheckpoint(operation, 'owner-intent', 'complete');
    return Object.freeze([]);
  }
  const index = indexOwnerIntentInputs(model);
  const knownOwnerIds = new Set(membership.descriptors.map(({ moduleId }) => moduleId));
  // Reuse membership.moduleForPath: membership already owns its lookup cache.
  // Only the missing relation indexes belong to this projection.
  const evidence = Object.freeze(membership.descriptors.map((descriptor) => {
    sourceProgramCompilationCheckpoint(operation, 'owner-intent');
    const capabilityEnvelope = Object.freeze(descriptor.capabilityProviders
      .map(({ capability, operations }) => Object.freeze({
        capability,
        operations: Object.freeze([...operations].sort(compareCodeUnits))
      }))
      .sort((left, right) => compareCodeUnits(left.capability, right.capability)));
    const publicEntrypointEnvelope = Object.freeze(index.entrypointsForOwner(descriptor.moduleId)
      .map(({ entrypoint, closure }) => Object.freeze({
        kind: entrypoint.kind,
        name: entrypoint.name,
        targetPackages: Object.freeze([...entrypoint.targetPackages].sort(compareCodeUnits)),
        targetPaths: Object.freeze([...entrypoint.targetPaths].sort(compareCodeUnits)),
        transports: Object.freeze([...closure.transports].sort(compareCodeUnits))
      })).sort((left, right) => compareCodeUnits(left.kind, right.kind)
      || compareCodeUnits(left.name, right.name)));
    const publicEntrypointTargets = new Set(publicEntrypointEnvelope.flatMap(({ targetPaths }) => targetPaths));
    const capabilityOperations = new Map<string, Set<string>>();
    for (const { capability, operations } of capabilityEnvelope) {
      let names = capabilityOperations.get(capability);
      if (names === undefined) { names = new Set(); capabilityOperations.set(capability, names); }
      for (const operation of operations) names.add(operation);
    }
    const operationObligations = Object.freeze(descriptor.operationObligations.map((obligation) => {
      sourceProgramCompilationCheckpoint(operation, 'owner-intent');
      const operationIdentity = obligation.operation;
      let operationDeclarations: readonly SourceProgramDeclaration[];
      switch (operationIdentity.kind) {
        case 'capability':
          operationDeclarations = index.declarationsForCapability(
            descriptor.moduleId,
            operationIdentity.operation
          );
          break;
        case 'public-entrypoint':
          operationDeclarations = index.declarationsForPath(operationIdentity.path);
          break;
        default:
          return unreachableModuleOperationIdentity(operationIdentity);
      }
      const operationObservationIds = new Set(operationDeclarations.map(({ observationId }) => observationId));
      const operationPaths = new Set(operationDeclarations.map(({ path }) => path));
      if (operationIdentity.kind === 'public-entrypoint') {
        for (const entrypoint of index.entrypointsForTarget(operationIdentity.path)) {
          const closure = index.firstClosureForEntrypoint(entrypoint.observationId);
          for (const path of closure?.reachablePaths ?? []) operationPaths.add(path);
          for (const path of closure?.capabilityPaths ?? []) operationPaths.add(path);
        }
      }
      const capabilitySummary = index.capabilitySummaryForPaths(operationPaths);
      const effectKinds = Object.freeze([...capabilitySummary.observedKinds].sort(compareCodeUnits));
      const actualConsumerModuleIds = Object.freeze([...new Set(
        [...index.consumerPaths(operationObservationIds, operationPaths)].flatMap((path) => {
          const sourceOwner = membership.moduleForPath(path)?.moduleId ?? null;
          return sourceOwner !== null && sourceOwner !== descriptor.moduleId ? [sourceOwner] : [];
        })
      )].sort(compareCodeUnits));
      const actualConsumerSet = new Set(actualConsumerModuleIds);
      const identityVerified = (() => {
        switch (operationIdentity.kind) {
          case 'capability':
            return capabilityOperations.get(operationIdentity.capability)
              ?.has(operationIdentity.operation) === true
              && operationDeclarations.length === 1;
          case 'public-entrypoint':
            return publicEntrypointTargets.has(operationIdentity.path);
          default:
            return unreachableModuleOperationIdentity(operationIdentity);
        }
      })();
      const consumersVerified = obligation.consumerSupport.consumers.length === actualConsumerModuleIds.length
        && obligation.consumerSupport.consumers.every((consumer) => (
          actualConsumerSet.has(consumer) && knownOwnerIds.has(consumer)
        ));
      const effectVerified = !capabilitySummary.hasUnknown
        && effectKinds.every((kind) => obligation.effect.kinds.includes(kind));
      const reason = !identityVerified
        ? 'identity-unresolved' as const
        : !consumersVerified
          ? 'consumer-closure-unresolved' as const
          : !effectVerified
            ? 'effect-closure-unresolved' as const
            : 'verified' as const;
      const observation = Object.freeze({
        status: reason === 'verified' ? 'verified' as const : 'unknown' as const,
        reason,
        consumerModuleIds: actualConsumerModuleIds,
        effectKinds
      });
      const canonicalObligation = Object.freeze({ obligation, observation });
      return Object.freeze({
        ...canonicalObligation,
        evidenceDigest: sha256(canonicalObligation)
      });
    }).sort((left, right) => compareCodeUnits(
      JSON.stringify(left.obligation.operation),
      JSON.stringify(right.obligation.operation)
    )));
    const canonical = Object.freeze({
      owner: descriptor.moduleId,
      capabilityEnvelope,
      publicEntrypointEnvelope,
      operationObligations
    });
    return Object.freeze({
      ...canonical,
      evidenceDigest: sha256(canonical)
    });
  }).sort((left, right) => compareCodeUnits(left.owner, right.owner)));
  sourceProgramCompilationCheckpoint(operation, 'owner-intent', 'complete');
  return evidence;
}

type JsonRecord = Record<string, unknown>;

const DIRECT_BUN_SOURCE = /^bun\s+(?:\.\/)?([A-Za-z0-9_./-]+\.[cm]?[jt]sx?)(?:\s|$)/u;
const BUN_SCRIPT_REFERENCE = /^bun\s+run\s+([A-Za-z0-9:_-]+)(?:\s+.*)?$/u;
const UNSUPPORTED_SHELL_COMPOSITION = /(?:\|\||[;|]|`|\$\(|&&)/u;
const IDENTITY_TOKEN_NAME = /(?:^|_)(?:format(?:_?version)?|schema|revision|version)(?:$|_)/iu;
const VERSIONED_DECLARATION_NAME = /^(.*?)(?:_?V)([1-9][0-9]*)$/u;

function identityFieldName(declarationName: string): string | null {
  const canonicalName = declarationName.replace(/_V[1-9][0-9]*$/u, '');
  if (/(?:^|_)FORMAT_VERSION$/u.test(canonicalName)) return 'formatVersion';
  if (/(?:^|_)SCHEMA$/u.test(canonicalName)) return 'schema';
  if (/(?:^|_)REVISION$/u.test(canonicalName)) return 'revision';
  if (/(?:^|_)VERSION$/u.test(canonicalName)) return 'version';
  if (/(?:^|_)FORMAT$/u.test(canonicalName)) return 'format';
  return null;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}


function dependencyPackageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0] ?? specifier;
}

function observedEntrypoint(input: Omit<SourceProgramEntrypoint, 'observationId'>): SourceProgramEntrypoint {
  return Object.freeze({
    ...input,
    observationId: sha256(input)
  });
}

function entrypointAddress(
  kind: SourceProgramEntrypoint['kind'],
  entrypointPath: string,
  name: string
): SourceProgramEntrypointAddress {
  return `${kind}:${entrypointPath}#${name}` as SourceProgramEntrypointAddress;
}

function parseEntrypointAddress(
  address: SourceProgramEntrypointAddress
): Readonly<{
  kind: SourceProgramEntrypoint['kind'];
  path: string;
  name: string;
}> | null {
  const kindSeparator = address.indexOf(':');
  const nameSeparator = address.lastIndexOf('#');
  if (
    kindSeparator <= 0
    || nameSeparator <= kindSeparator + 1
    || nameSeparator >= address.length - 1
  ) return null;
  const kind = address.slice(0, kindSeparator);
  if (
    kind !== 'package-script'
    && kind !== 'package-bin'
    && kind !== 'cli-command'
    && kind !== 'module-entrypoint'
    && kind !== 'git-hook'
    && kind !== 'workflow'
  ) return null;
  return Object.freeze({
    kind,
    path: address.slice(kindSeparator + 1, nameSeparator),
    name: address.slice(nameSeparator + 1)
  });
}

function stringRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string')) return null;
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function packageNameFromLockedResolution(value: string): string | null {
  const separator = value.startsWith('@') ? value.indexOf('@', 1) : value.lastIndexOf('@');
  return separator > 0 ? value.slice(0, separator) : null;
}

function executableSourceLiteralPaths(
  model: SourceProgramModel
): readonly Readonly<{ ownerPath: string; digest: string }>[] {
  return Object.freeze(model.literals
    .filter(({ path, value }) => (
      sourceProgramSurfaceForPath(path) === 'production'
      && value.includes('\n')
      && value.length >= 32
    ))
    .flatMap(({ path, value }) => {
      const observation = observeSourceProgramEmbeddedTypeScriptLiteral(value);
      return observation.executable
        ? [Object.freeze({ ownerPath: path, digest: observation.contentDigest })]
        : [];
  }));
}

function compileSourceProgramCausalRelationEvidence(
  model: SourceProgramModel,
  membership: RepositoryModuleMembership
): readonly SourceProgramCausalRelationEvidence[] {
  const evidence = membership.descriptors.flatMap((descriptor) => (
    descriptor.causalRelations.map((intent) => {
      const declarations = model.declarations.filter((declaration) => (
        declaration.moduleId === descriptor.moduleId
        && declaration.path === intent.symbol.path
        && declaration.name === intent.symbol.name
      ));
      const exact = declarations.length === 1 ? declarations[0]! : null;
      const reason = exact !== null
        ? 'exact-symbol' as const
        : declarations.length === 0
          ? 'symbol-missing' as const
          : 'symbol-ambiguous' as const;
      const canonical = Object.freeze({
        owner: descriptor.moduleId,
        intent,
        declaration: Object.freeze({
          observationId: exact?.observationId ?? null,
          declarationDigest: exact?.declarationDigest ?? null
        }),
        sourceRevision: model.sourceRevision,
        observationClass: exact === null ? 'unknown' as const : 'derived' as const,
        reason
      });
      return Object.freeze({
        ...canonical,
        evidenceDigest: sha256(canonical)
      });
    })
  ));
  return Object.freeze(evidence.sort((left, right) => compareCodeUnits(left.intent.subject, right.intent.subject)
    || compareCodeUnits(left.intent.relation, right.intent.relation)
    || compareCodeUnits(left.intent.symbol.path, right.intent.symbol.path)
    || compareCodeUnits(left.intent.symbol.name, right.intent.symbol.name)));
}

function declarationReturnsCanonicalParser(
  declarationObservationId: string,
  parserObservationId: string,
  model: SourceProgramModel
): boolean {
  const currentExactProvenances = currentExactReturnProvenances(model);
  if (currentExactProvenances === null) return false;
  const provenanceByDeclaration = new Map(currentExactProvenances.map((provenance) => [
    provenance.declarationObservationId,
    provenance
  ] as const));
  const opaque = Object.freeze({ kind: 'opaque' as const });
  const resolveValue = (
    value: SourceProgramReturnValueProvenance,
    parameters: readonly (readonly SourceProgramReturnValueProvenance[])[],
    activeDeclarations: ReadonlySet<string>
  ): readonly SourceProgramReturnValueProvenance[] => {
    if (value.kind === 'parameter') return parameters[value.index] ?? Object.freeze([opaque]);
    if (value.kind !== 'call-result') return Object.freeze([value]);
    if (value.targetObservationId === parserObservationId) return Object.freeze([value]);
    if (activeDeclarations.has(value.targetObservationId)) return Object.freeze([opaque]);
    const target = provenanceByDeclaration.get(value.targetObservationId);
    if (target === undefined || target.normalReturns.length === 0) {
      return Object.freeze([opaque]);
    }
    const nextParameters = Object.freeze(value.arguments.map((argument) => Object.freeze(
      argument.flatMap((argumentValue) => resolveValue(
        argumentValue,
        parameters,
        activeDeclarations
      ))
    )));
    const nextActive = new Set(activeDeclarations);
    nextActive.add(value.targetObservationId);
    return Object.freeze(target.normalReturns.flatMap((targetValue) => resolveValue(
      targetValue,
      nextParameters,
      nextActive
    )));
  };
  const provenance = provenanceByDeclaration.get(declarationObservationId);
  if (provenance === undefined || provenance.normalReturns.length === 0) return false;
  const resolved = provenance.normalReturns.flatMap((value) => resolveValue(
    value,
    Object.freeze([]),
    new Set([declarationObservationId])
  ));
  return resolved.length > 0 && resolved.every((value) => (
    value.kind === 'call-result' && value.targetObservationId === parserObservationId
  ));
}

function compileRepositoryModelInternal(
  input: RepositoryModelInternalInput
): SourceProgramModel {
  input.repositoryCompilation?.assertMatches(input);
  const typescriptInput = Object.freeze({
    sourceRevision: input.sourceRevision,
    files: input.files,
    moduleMembership: input.moduleMembership
  });
  const typescriptModel = input.typescriptModel ?? (
    input.repositoryCompilation === undefined
      ? compileTypeScriptModel(typescriptInput)
      : compileTypeScriptModelWithCompilation(
          typescriptInput,
          input.repositoryCompilation
        )
  );
  if (typescriptModel.sourceRevision !== input.sourceRevision
      || !isCompiledTypeScriptModel(typescriptModel)) {
    throw new Error('Repository Source Program Model received an invalid TypeScript fact snapshot');
  }
  if (input.repositoryCompilation !== undefined
      && workspaceSnapshotIdentityForTypeScriptModel(typescriptModel)
        !== input.repositoryCompilation.identityDigest) {
    throw new Error('Repository Source Program Model cannot mix TypeScript facts from another compilation');
  }
  const expectedTypeScriptFiles = input.files
    .filter(({ path: repositoryPath }) => (
      /\.(?:[cm]?[jt]sx?)$/iu.test(repositoryPath)
      && (sourceProgramSurfaceForPath(repositoryPath) === 'production'
        || sourceProgramSurfaceForPath(repositoryPath) === 'test')
    ))
    .map(({ path: repositoryPath, contentDigest }) => `${repositoryPath}\0${contentDigest}`)
    .sort(compareCodeUnits);
  const observedTypeScriptFiles = typescriptModel.files
    .map(({ path: repositoryPath, contentDigest }) => `${repositoryPath}\0${contentDigest}`)
    .sort(compareCodeUnits);
  if (expectedTypeScriptFiles.length !== observedTypeScriptFiles.length
      || expectedTypeScriptFiles.some((identity, index) => identity !== observedTypeScriptFiles[index])) {
    throw new Error('Repository Source Program Model TypeScript facts do not bind the exact source files');
  }
  const testObservationInput = Object.freeze({
    productionModel: typescriptModel,
    files: input.files,
    moduleMembership: input.moduleMembership
  });
  const testObservations = input.testObservations ?? (
    input.repositoryCompilation === undefined
      ? compileTestObservations(testObservationInput)
      : compileTestObservationsFromSnapshot(
          testObservationInput,
          input.repositoryCompilation
        )
  );
  if (testObservations.sourceRevision !== input.sourceRevision
      || testObservations.productionModelDigest !== typescriptModel.modelDigest) {
    throw new Error('Repository Source Program Model test observations do not bind the production facts');
  }
  if (input.repositoryCompilation !== undefined
      && snapshotIdentityForTestObservations(testObservations)
        !== input.repositoryCompilation.identityDigest) {
    throw new Error('Repository Source Program Model cannot mix test facts from another compilation');
  }
  const semanticModel = Object.freeze({
    ...typescriptModel,
    unknowns: Object.freeze([
      ...typescriptModel.unknowns,
      ...testObservations.unknowns.filter((unknown) => !typescriptModel.unknowns.some((existing) => (
        existing.code === unknown.code
        && existing.path === unknown.path
        && existing.detail === unknown.detail
        && existing.span?.start === unknown.span?.start
        && existing.span?.end === unknown.span?.end
      )))
    ])
  });
  const entrypoints: SourceProgramEntrypoint[] = [...typescriptModel.entrypoints];
  const packages: SourceProgramPackage[] = [];
  const dependencies: SourceProgramDependency[] = [];
  const unknowns: SourceProgramUnknown[] = [
    ...(input.unknowns ?? []),
    ...semanticModel.unknowns
  ];
  const embeddedWorkflowUnits = Object.freeze(input.files.flatMap((file) => (
    compileSourceProgramEmbeddedWorkflowPrograms(file)
  )));
  const embeddedCapabilities: readonly SourceProgramCapabilityInvocation[] = Object.freeze(
    embeddedWorkflowUnits.map((unit) => {
      const canonical = Object.freeze({
        path: unit.ownerPath,
        moduleId: null,
        surface: 'workflow' as const,
        capability: unit.kind === 'github-script' ? 'dynamic-code' as const : 'process' as const,
        operation: unit.kind,
        subject: unit.address,
        transport: unit.kind === 'github-script' ? 'package-api' as const : 'unknown' as const,
        moduleSpecifier: unit.provider,
        providerCapability: null,
        providerModuleId: null,
        owningDeclarationObservationId: null,
        observationClass: unit.unknowns.length === 0 ? 'derived' as const : 'unknown' as const,
        span: unit.span
      });
      return Object.freeze({
        observationId: sha256({ ...canonical, contentDigest: unit.contentDigest }),
        ...canonical
      });
    })
  );
  const embeddedReferences = Object.freeze(embeddedWorkflowUnits.flatMap((unit) => (
    unit.imports.map((reference) => Object.freeze({
      path: unit.ownerPath,
      kind: 'import' as const,
      name: '*',
      moduleSpecifier: reference.specifier,
      sourceObservationId: null,
      sourceRelation: 'module-initialization' as const,
      targetObservationId: null,
      targetPath: null,
      observationClass: reference.specifier.startsWith('.') ? 'unknown' as const : 'observed' as const,
      span: unit.span
    }))
  )));
  const capabilities = Object.freeze([
    ...semanticModel.capabilities,
    ...embeddedCapabilities
  ]);
  for (const unit of embeddedWorkflowUnits) {
    for (const unknown of unit.unknowns) {
      unknowns.push(Object.freeze({
        code: unknown.code,
        path: unit.ownerPath,
        detail: `${unit.address}: ${unknown.detail}`,
        span: unit.span
      }));
    }
  }
  const filePaths = new Set(input.files.map(({ path: repositoryPath }) => repositoryPath));
  const externalConsumers = new Map<string, Set<string>>();
  for (const unknown of semanticModel.unknowns) {
    if (unknown.code !== 'external-module-opaque') continue;
    const dependency = dependencyPackageName(unknown.detail);
    const consumers = externalConsumers.get(dependency) ?? new Set<string>();
    consumers.add(unknown.path);
    externalConsumers.set(dependency, consumers);
  }
  const ambientTypeConsumers = new Map<string, Set<string>>();
  for (const file of input.files) {
    if (path.posix.basename(file.path) !== 'tsconfig.json') continue;
    const parsed = ts.parseConfigFileTextToJson(file.path, file.source);
    if (parsed.error || !isRecord(parsed.config)) {
      unknowns.push(Object.freeze({
        code: 'typescript-config-unresolved',
        path: file.path,
        detail: parsed.error
          ? ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')
          : 'configuration root is not an object',
        span: null
      }));
      continue;
    }
    const compilerOptions = isRecord(parsed.config.compilerOptions)
      ? parsed.config.compilerOptions
      : null;
    const types = compilerOptions?.types;
    if (!Array.isArray(types) || types.some((entry) => typeof entry !== 'string')) continue;
    for (const typeName of types as string[]) {
      const packageName = `@types/${typeName}`;
      const consumers = ambientTypeConsumers.get(packageName) ?? new Set<string>();
      consumers.add(file.path);
      ambientTypeConsumers.set(packageName, consumers);
    }
  }

  const packageBins = new Map<string, Set<string>>();
  const packageForBin = new Map<string, string | null>();
  for (const file of input.files) {
    if (path.posix.basename(file.path) !== 'bun.lock') continue;
    const parsed = ts.parseConfigFileTextToJson(file.path, file.source);
    if (parsed.error || !isRecord(parsed.config) || !isRecord(parsed.config.packages)) {
      unknowns.push(Object.freeze({
        code: 'package-lock-unresolved',
        path: file.path,
        detail: parsed.error
          ? ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')
          : 'Bun lock package table is absent',
        span: null
      }));
      continue;
    }
    for (const locked of Object.values(parsed.config.packages)) {
      if (!Array.isArray(locked) || typeof locked[0] !== 'string' || !isRecord(locked[2])) continue;
      const packageName = packageNameFromLockedResolution(locked[0]);
      const bins = stringRecord(locked[2].bin);
      if (packageName === null || bins === null) continue;
      const names = packageBins.get(packageName) ?? new Set<string>();
      for (const binName of Object.keys(bins)) {
        names.add(binName);
        if (!packageForBin.has(binName)) packageForBin.set(binName, packageName);
        else if (packageForBin.get(binName) !== packageName) packageForBin.set(binName, null);
      }
      packageBins.set(packageName, names);
    }
    for (const [binName, packageName] of packageForBin) {
      entrypoints.push(observedEntrypoint({
        path: file.path,
        kind: 'package-bin',
        name: binName,
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([]),
        targetPackages: Object.freeze(packageName === null ? [] : [packageName]),
        observationClass: packageName === null ? 'unknown' : 'derived',
        span: null
      }));
    }
  }

  for (const descriptor of input.moduleMembership.descriptors) {
    for (const targetPath of descriptor.externalEntrypoints) {
      entrypoints.push(observedEntrypoint({
        path: `${descriptor.root}/module.json`,
        kind: 'module-entrypoint',
        name: `${descriptor.moduleId}:${targetPath}`,
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([targetPath]),
        targetPackages: Object.freeze([]),
        observationClass: filePaths.has(targetPath) ? 'observed' : 'unknown',
        span: null
      }));
    }
  }

  for (const file of input.files) {
    if (file.path === 'package.json' || file.path.endsWith('/package.json')) {
      let manifest: JsonRecord;
      try {
        const parsed: unknown = JSON.parse(file.source);
        if (!isRecord(parsed)) throw new Error('package manifest root is not an object');
        manifest = parsed;
      } catch (error) {
        unknowns.push(Object.freeze({
          code: 'package-manifest-unresolved',
          path: file.path,
          detail: error instanceof Error ? error.message : String(error),
          span: null
        }));
        continue;
      }
      const packageName = typeof manifest.name === 'string'
        ? manifest.name
        : path.posix.basename(path.posix.dirname(file.path)) || '<repository-root>';
      packages.push(Object.freeze({
        manifestPath: file.path,
        name: packageName,
        version: typeof manifest.version === 'string'
          ? manifest.version
          : null,
        private: typeof manifest.private === 'boolean' ? manifest.private : null
      }));

      const scripts = stringRecord(manifest.scripts);
      if (manifest.scripts !== undefined && scripts === null) {
        unknowns.push(Object.freeze({
          code: 'package-scripts-unresolved',
          path: file.path,
          detail: 'scripts must be an object of string commands',
          span: null
        }));
      }
      for (const [name, command] of Object.entries(scripts ?? {})) {
        const segments = command.split(/\s+&&\s+/u);
        const targetEntrypoints: SourceProgramEntrypointAddress[] = [];
        const targetPaths: string[] = [];
        const targetPackages: string[] = [];
        let structured = segments.length > 0;
        for (const segment of segments) {
          if (UNSUPPORTED_SHELL_COMPOSITION.test(segment)) {
            structured = false;
            break;
          }
          const scriptReference = BUN_SCRIPT_REFERENCE.exec(segment)?.[1] ?? null;
          if (scriptReference !== null) {
            targetEntrypoints.push(entrypointAddress('package-script', file.path, scriptReference));
            continue;
          }
          const directSource = DIRECT_BUN_SOURCE.exec(segment)?.[1] ?? null;
          if (directSource !== null) {
            targetPaths.push(path.posix.normalize(path.posix.join(path.posix.dirname(file.path), directSource)));
            continue;
          }
          const executable = /^([A-Za-z0-9_.@/-]+)(?:\s|$)/u.exec(segment)?.[1] ?? null;
          const providerPackage = executable === null ? undefined : packageForBin.get(executable);
          if (executable !== null && providerPackage !== undefined && providerPackage !== null) {
            targetEntrypoints.push(entrypointAddress('package-bin', 'bun.lock', executable));
            targetPackages.push(providerPackage);
            continue;
          }
          structured = false;
          break;
        }
        const resolved = structured
          && targetPaths.every((targetPath) => filePaths.has(targetPath))
          && targetEntrypoints.every((address) => {
            const target = parseEntrypointAddress(address);
            if (target === null) return false;
            return target.kind === 'package-bin'
              ? target.path === 'bun.lock'
                && packageForBin.get(target.name) !== null
                && packageForBin.has(target.name)
              : target.kind === 'package-script'
                && target.path === file.path
                && Object.hasOwn(scripts ?? {}, target.name);
          });
        entrypoints.push(observedEntrypoint({
          path: file.path,
          kind: 'package-script',
          name,
          command,
          targetEntrypoints: Object.freeze(targetEntrypoints),
          targetPaths: Object.freeze(targetPaths),
          targetPackages: Object.freeze([...new Set(targetPackages)].sort(compareCodeUnits)),
          observationClass: resolved ? 'derived' : 'unknown',
          span: null
        }));
        if (!resolved) {
          unknowns.push(Object.freeze({
            code: /(?:&&|\|\||[;|]|`|\$\()/u.test(command)
              ? 'package-script-shell-opaque'
              : targetPaths.length > 0 || targetEntrypoints.length > 0
                ? 'package-script-target-unresolved'
                : 'package-script-command-unresolved',
            path: file.path,
            detail: `${name}: ${command}`,
            span: null
          }));
        }
      }
      const reportedCycles = new Set<string>();
      for (const initial of Object.keys(scripts ?? {}).sort(compareCodeUnits)) {
        const chain: string[] = [];
        let current: string | null = initial;
        while (current !== null) {
          const repeatedAt = chain.indexOf(current);
          if (repeatedAt >= 0) {
            const cycle = chain.slice(repeatedAt).sort(compareCodeUnits);
            const cycleKey = cycle.join('\0');
            if (!reportedCycles.has(cycleKey)) {
              reportedCycles.add(cycleKey);
              unknowns.push(Object.freeze({
                code: 'package-script-cycle',
                path: file.path,
                detail: cycle.join(' -> '),
                span: null
              }));
            }
            break;
          }
          chain.push(current);
          const referencedCommand: string | undefined = scripts?.[current];
          if (referencedCommand === undefined || UNSUPPORTED_SHELL_COMPOSITION.test(referencedCommand)) break;
          current = BUN_SCRIPT_REFERENCE.exec(referencedCommand)?.[1] ?? null;
        }
      }

      const packageSourceValue = typeof manifest.source === 'string' ? manifest.source : null;
      const packageSourcePath = packageSourceValue !== null
        && packageSourceValue.startsWith('./')
        && !packageSourceValue.includes('\\')
        && !packageSourceValue.split('/').includes('..')
        ? path.posix.normalize(path.posix.join(
            path.posix.dirname(file.path),
            packageSourceValue.slice(2)
          ))
        : null;
      if (manifest.source !== undefined && (
        packageSourcePath === null
        || !filePaths.has(packageSourcePath)
      )) {
        unknowns.push(Object.freeze({
          code: 'package-source-unresolved',
          path: file.path,
          detail: String(manifest.source),
          span: null
        }));
      }

      const bins = typeof manifest.bin === 'string'
        ? { [packageName]: manifest.bin }
        : stringRecord(manifest.bin) ?? {};
      for (const [name, target] of Object.entries(bins)) {
        const targetPath = path.posix.normalize(path.posix.join(path.posix.dirname(file.path), target));
        const targetObserved = filePaths.has(targetPath);
        const sourceCommand = scripts?.[name];
        const directSource = sourceCommand === undefined
          ? null
          : DIRECT_BUN_SOURCE.exec(sourceCommand)?.[1] ?? null;
        const directSourcePath = directSource === null
          ? null
          : path.posix.normalize(path.posix.join(path.posix.dirname(file.path), directSource));
        const sourceBound = packageSourcePath !== null
          && filePaths.has(packageSourcePath)
          && directSourcePath === packageSourcePath;
        entrypoints.push(observedEntrypoint({
          path: file.path,
          kind: 'package-bin',
          name,
          command: null,
          targetEntrypoints: Object.freeze(sourceBound
            ? [entrypointAddress('package-script', file.path, name)]
            : []),
          targetPaths: Object.freeze([targetPath]),
          targetPackages: Object.freeze([packageName]),
          observationClass: targetObserved ? 'observed' : sourceBound ? 'derived' : 'unknown',
          span: null
        }));
        if (!targetObserved && !sourceBound) {
          unknowns.push(Object.freeze({
            code: 'generated-output-unresolved',
            path: file.path,
            detail: `package bin ${name} targets ${targetPath}, but no canonical source/build mapping is present in the observed snapshot`,
            span: null
          }));
        }
      }

      const scopes: readonly [keyof JsonRecord, SourceProgramDependencyScope][] = [
        ['dependencies', 'runtime'],
        ['devDependencies', 'development'],
        ['peerDependencies', 'peer'],
        ['optionalDependencies', 'optional']
      ];
      for (const [field, scope] of scopes) {
        const declared = stringRecord(manifest[field]);
        if (manifest[field] !== undefined && declared === null) {
          unknowns.push(Object.freeze({
            code: 'package-dependencies-unresolved',
            path: file.path,
            detail: `${String(field)} must be an object of string requirements`,
            span: null
          }));
          continue;
        }
        for (const [name, requirement] of Object.entries(declared ?? {})) {
          const consumers = new Set(externalConsumers.get(name) ?? []);
          for (const consumer of ambientTypeConsumers.get(name) ?? []) consumers.add(consumer);
          if (name.startsWith('@types/')) {
            const baseName = name.slice('@types/'.length).replace('__', '/');
            for (const consumer of externalConsumers.get(baseName) ?? []) consumers.add(consumer);
            if (baseName === 'node') {
              for (const [specifier, paths] of externalConsumers) {
                if (!specifier.startsWith('node:')) continue;
                for (const consumer of paths) consumers.add(consumer);
              }
            } else if (baseName === 'bun') {
              for (const [specifier, paths] of externalConsumers) {
                if (specifier !== 'bun' && !specifier.startsWith('bun:')) continue;
                for (const consumer of paths) consumers.add(consumer);
              }
            }
          }
          const executableNames = packageBins.get(name) ?? new Set<string>();
          if (Object.values(scripts ?? {}).some((command) => command
            .split(/\s+&&\s+/u)
            .some((segment) => [...executableNames].some((executableName) => (
              segment === executableName || segment.startsWith(`${executableName} `)
            ))))) {
            consumers.add(file.path);
          }
          const consumerPaths = [...consumers].sort(compareCodeUnits);
          dependencies.push(Object.freeze({
            manifestPath: file.path,
            name,
            requirement,
            scope,
            consumerPaths: Object.freeze(consumerPaths),
            observationClass: consumerPaths.length > 0 ? 'derived' : 'unknown'
          }));
        }
      }
    }
    if (file.path.startsWith('.githooks/') && !file.path.endsWith('/')) {
      entrypoints.push(observedEntrypoint({
        path: file.path,
        kind: 'git-hook',
        name: path.posix.basename(file.path),
        command: null,
        targetEntrypoints: Object.freeze([]),
        targetPaths: Object.freeze([file.path]),
        targetPackages: Object.freeze([]),
        observationClass: 'observed',
        span: null
      }));
    }
    if (sourceProgramSurfaceForPath(file.path) === 'workflow') {
      const units = embeddedWorkflowUnits.filter(({ ownerPath }) => ownerPath === file.path);
      entrypoints.push(observedEntrypoint({
        path: file.path,
        kind: 'workflow',
        name: path.posix.basename(file.path),
        command: null,
        targetEntrypoints: Object.freeze(units.map(({ address }) => (
          entrypointAddress('workflow', file.path, address)
        ))),
        targetPaths: Object.freeze([file.path]),
        targetPackages: Object.freeze([]),
        observationClass: 'observed',
        span: null
      }));
      for (const unit of units) {
        entrypoints.push(observedEntrypoint({
          path: file.path,
          kind: 'workflow',
          name: unit.address,
          command: null,
          targetEntrypoints: Object.freeze([]),
          targetPaths: Object.freeze([]),
          targetPackages: unit.targetPackages,
          observationClass: unit.unknowns.length === 0 ? 'derived' : 'unknown',
          span: unit.span
        }));
      }
    }
  }

  const sourceFiles = new Set(typescriptModel.files.map(({ path: repositoryPath }) => repositoryPath));
  const files: SourceProgramFile[] = [
    ...typescriptModel.files,
    ...input.files
      .filter(({ path: repositoryPath }) => !sourceFiles.has(repositoryPath))
      .map((file) => Object.freeze({
        path: file.path,
        contentDigest: file.contentDigest,
        moduleId: input.moduleMembership.moduleForPath(file.path)?.moduleId ?? null,
        surface: sourceProgramSurfaceForPath(file.path),
        semanticKind: 'unknown',
        semanticObservationClass: 'unknown'
      }))
  ].sort((left, right) => compareCodeUnits(left.path, right.path));
  entrypoints.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.kind, right.kind)
    || compareCodeUnits(left.name, right.name)
  );
  packages.sort((left, right) => compareCodeUnits(left.manifestPath, right.manifestPath));
  dependencies.sort((left, right) =>
    compareCodeUnits(left.manifestPath, right.manifestPath)
    || compareCodeUnits(left.scope, right.scope)
    || compareCodeUnits(left.name, right.name)
  );
  const declaredDependencyNames = new Set(dependencies.map(({ name }) => name));
  for (let index = unknowns.length - 1; index >= 0; index -= 1) {
    const unknown = unknowns[index]!;
    if (unknown.code !== 'external-module-opaque') continue;
    const packageName = dependencyPackageName(unknown.detail);
    const runtimeBuiltin = unknown.detail === 'bun'
      || unknown.detail.startsWith('bun:')
      || unknown.detail.startsWith('node:');
    if (runtimeBuiltin || declaredDependencyNames.has(packageName)) {
      unknowns.splice(index, 1);
    }
  }
  unknowns.sort((left, right) =>
    compareCodeUnits(left.path, right.path)
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.detail, right.detail)
  );
  const sourceByPath = new Map(input.files.map((file) => [file.path, file.source] as const));
  const importGraph = input.repositoryCompilation?.moduleGraph ?? compileRepositoryModuleGraph({
    files: Object.freeze([...sourceByPath.keys()].sort(compareCodeUnits)),
    readSource: (repositoryPath) => sourceByPath.get(repositoryPath) ?? null,
    readImports: (repositoryPath, source) => sourceProgramModuleImports(repositoryPath, source)
  });
  const entrypointByAddress = new Map(entrypoints.map((entrypoint) => [
    entrypointAddress(entrypoint.kind, entrypoint.path, entrypoint.name),
    entrypoint
  ]));
  const resolveEntrypointTargets = (entrypoint: SourceProgramEntrypoint): Readonly<{
    paths: readonly string[];
    packages: readonly string[];
    unresolved: boolean;
  }> => {
    const paths = new Set<string>();
    const packages = new Set<string>();
    const visited = new Set<string>();
    let unresolved = false;
    const collect = (current: SourceProgramEntrypoint): void => {
      const address = entrypointAddress(current.kind, current.path, current.name);
      if (visited.has(address)) {
        unresolved = true;
        return;
      }
      visited.add(address);
      for (const targetPath of current.targetPaths) paths.add(targetPath);
      for (const targetPackage of current.targetPackages) packages.add(targetPackage);
      for (const targetAddress of current.targetEntrypoints) {
        const target = entrypointByAddress.get(targetAddress);
        if (target === undefined) unresolved = true;
        else collect(target);
      }
      visited.delete(address);
    };
    collect(entrypoint);
    return Object.freeze({
      paths: Object.freeze([...paths].sort(compareCodeUnits)),
      packages: Object.freeze([...packages].sort(compareCodeUnits)),
      unresolved
    });
  };
  const capabilitiesByPath = new Map<string, SourceProgramCapabilityInvocation[]>();
  for (const capability of capabilities) {
    const group = capabilitiesByPath.get(capability.path) ?? [];
    group.push(capability);
    capabilitiesByPath.set(capability.path, group);
  }
  const graphUnknowns = new Set(importGraph.unresolvedFiles);
  const entrypointClosures: SourceProgramEntrypointClosure[] = entrypoints.map((entrypoint) => {
    const targets = resolveEntrypointTargets(entrypoint);
    const reachable = new Set<string>();
    const frontier = targets.paths.filter((targetPath) => sourceByPath.has(targetPath));
    while (frontier.length > 0) {
      const current = frontier.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const dependency of importGraph.directDependencies(current)) {
        if (!reachable.has(dependency)) frontier.push(dependency);
      }
    }
    const reachablePaths = [...reachable].sort(compareCodeUnits);
    const handlerModuleIds = [...new Set(targets.paths.flatMap((targetPath) => {
      const handler = input.moduleMembership.moduleForPath(targetPath);
      return handler === null ? [] : [handler.moduleId];
    }))].sort(compareCodeUnits);
    const capabilityInvocations = reachablePaths.flatMap((repositoryPath) => capabilitiesByPath.get(repositoryPath) ?? []);
    const capabilityPaths = [...new Set(capabilityInvocations.map(({ path: repositoryPath }) => repositoryPath))]
      .sort(compareCodeUnits);
    const transports = [...new Set(capabilityInvocations.map(({ transport }) => transport))]
      .sort(compareCodeUnits);
    const providerModuleIds = [...new Set(capabilityInvocations.flatMap(({ providerModuleId }) => (
      providerModuleId === null ? [] : [providerModuleId]
    )))].sort(compareCodeUnits);
    const unknownPaths = reachablePaths.filter((repositoryPath) => graphUnknowns.has(repositoryPath));
    if (targets.unresolved || (targets.paths.length === 0
        && targets.packages.length === 0
        && entrypoint.observationClass === 'unknown')) unknownPaths.push(entrypoint.path);
    return Object.freeze({
      entrypointObservationId: entrypoint.observationId,
      path: entrypoint.path,
      name: entrypoint.name,
      targetPaths: targets.paths,
      targetPackages: targets.packages,
      handlerModuleIds: Object.freeze(handlerModuleIds),
      reachablePaths: Object.freeze(reachablePaths),
      capabilityPaths: Object.freeze(capabilityPaths),
      transports: Object.freeze(transports),
      providerModuleIds: Object.freeze(providerModuleIds),
      unknownPaths: Object.freeze([...new Set(unknownPaths)].sort(compareCodeUnits)),
      observationClass: entrypoint.observationClass === 'unknown' || unknownPaths.length > 0
        ? 'unknown'
        : 'derived'
    });
  }).sort((left, right) =>
    compareCodeUnits(left.path, right.path) || compareCodeUnits(left.name, right.name)
  );
  const candidates: SourceProgramCandidate[] = [];
  const causalRelations = compileSourceProgramCausalRelationEvidence(
    typescriptModel,
    input.moduleMembership
  );
  for (const evidence of causalRelations.filter(({ observationClass }) => (
    observationClass === 'unknown'
  ))) {
    candidates.push(Object.freeze({
      code: 'causal-identity-unresolved',
      subject: `${evidence.intent.subject}:${evidence.intent.relation}`,
      paths: Object.freeze([
        evidence.intent.symbol.path,
        `${input.moduleMembership.descriptors.find(({ moduleId }) => (
          moduleId === evidence.owner
        ))!.root}/module.json`
      ].sort(compareCodeUnits)),
      reason: `owner-issued ${evidence.intent.relation} relation does not resolve to one exact Source Program symbol`,
      observationClass: 'unknown'
    }));
  }
  const causalSubjects = new Set(causalRelations.map(({ intent }) => intent.subject));
  for (const subject of causalSubjects) {
    const subjectRelations = causalRelations.filter(({ intent }) => intent.subject === subject);
    const declarations = subjectRelations.filter(({ intent, observationClass }) => (
      intent.relation === 'declares' && observationClass === 'derived'
    ));
    const parsers = subjectRelations.filter(({ intent, observationClass }) => (
      intent.relation === 'parses' && observationClass === 'derived'
    ));
    const readbacks = subjectRelations.filter(({ intent, observationClass }) => (
      intent.relation === 'reads-back' && observationClass === 'derived'
    ));
    if (subjectRelations.length > 0 && declarations.length !== 1) {
      candidates.push(Object.freeze({
        code: 'causal-identity-unresolved',
        subject,
        paths: Object.freeze(subjectRelations.map(({ intent }) => intent.symbol.path)
          .sort(compareCodeUnits)),
        reason: 'causal subject requires exactly one owner-issued declares relation',
        observationClass: 'unknown'
      }));
    }
    for (const readback of readbacks) {
      const matchingParsers = parsers.filter((parser) => (
        declarations.length === 1
        && parser.owner === declarations[0]!.owner
        && JSON.stringify(parser.intent.operation) === JSON.stringify(readback.intent.operation)
      ));
      const readerObservationId = readback.declaration.observationId;
      const parserObservationId = matchingParsers[0]?.declaration.observationId ?? null;
      if (matchingParsers.length === 1
          && readerObservationId !== null
          && parserObservationId !== null
          && declarationReturnsCanonicalParser(
            readerObservationId,
            parserObservationId,
            typescriptModel
          )) continue;
      candidates.push(Object.freeze({
        code: 'causal-relation-owner-bypass',
        subject: `${subject}:parser/readback`,
        paths: Object.freeze([
          readback.intent.symbol.path,
          ...matchingParsers.map(({ intent }) => intent.symbol.path)
        ].sort(compareCodeUnits)),
        reason: matchingParsers.length !== 1
          ? 'readback relation lacks one canonical parser owned by the semantic subject declaration owner for the same operation requirement'
          : 'not every normal readback return is causally derived from the canonical owner parser',
        observationClass: matchingParsers.length === 1 ? 'derived' : 'unknown'
      }));
    }
  }
  for (const embedded of executableSourceLiteralPaths(semanticModel)) {
    candidates.push(Object.freeze({
      code: 'production-embeds-executable-source-text',
      subject: embedded.digest,
      paths: Object.freeze([embedded.ownerPath]),
      reason: 'production module embeds executable source bytes in a string; use the canonical source/template/AST owner and derive emitted bytes instead of creating a hidden second source graph',
      observationClass: 'derived'
    }));
  }
  for (const entrypoint of entrypoints) {
    if (
      entrypoint.kind !== 'package-bin'
      || entrypoint.observationClass !== 'unknown'
      || entrypoint.targetPaths.length === 0
    ) continue;
    candidates.push(Object.freeze({
      code: 'generated-output-unresolved',
      subject: entrypointAddress(entrypoint.kind, entrypoint.path, entrypoint.name),
      paths: Object.freeze([
        entrypoint.path,
        ...entrypoint.targetPaths
      ].sort(compareCodeUnits)),
      reason: `package bin ${entrypoint.name} points outside the observed source snapshot; a canonical generated-artifact source/build binding is required before closure can be complete`,
      observationClass: 'unknown'
    }));
  }
  const exportedOperationsByModule = new Map<string, Set<string>>();
  const declaredCapabilityOperationsByModule = new Map<string, Set<string>>();
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported) continue;
    const owner = input.moduleMembership.moduleForPath(declaration.path);
    if (owner === null) continue;
    const operations = exportedOperationsByModule.get(owner.moduleId) ?? new Set<string>();
    operations.add(declaration.name);
    exportedOperationsByModule.set(owner.moduleId, operations);
  }
  for (const descriptor of input.moduleMembership.descriptors) {
    const exportedOperations = exportedOperationsByModule.get(descriptor.moduleId) ?? new Set<string>();
    const declaredCapabilityOperations = declaredCapabilityOperationsByModule.get(descriptor.moduleId)
      ?? new Set<string>();
    for (const provider of descriptor.capabilityProviders) {
      for (const operation of provider.operations) {
        declaredCapabilityOperations.add(operation);
        if (exportedOperations.has(operation)) continue;
        candidates.push(Object.freeze({
          code: 'capability-provider-operation-unresolved',
          subject: `${provider.capability}:${operation}`,
          paths: Object.freeze([`${descriptor.root}/module.json`]),
          reason: `provider ${descriptor.moduleId} declares an operation with no exported implementation in its module`,
          observationClass: 'unknown'
        }));
      }
    }
    declaredCapabilityOperationsByModule.set(descriptor.moduleId, declaredCapabilityOperations);
  }
  const roleBindings = input.moduleMembership.descriptors.flatMap((descriptor) => (
    descriptor.capabilityProviders.flatMap((provider) => (
      provider.operationRoles.map((binding) => Object.freeze({
        descriptor,
        provider,
        binding
      }))
    ))
  ));
  for (const { descriptor, provider, binding } of roleBindings) {
    const ownerDeclarations = typescriptModel.declarations.filter((declaration) => (
      declaration.exported
      && declaration.moduleId === descriptor.moduleId
      && declaration.name === binding.operation
    ));
    if (ownerDeclarations.length === 1) continue;
    const foreignDeclarations = typescriptModel.declarations.filter((declaration) => (
      declaration.exported
      && declaration.moduleId !== descriptor.moduleId
      && declaration.name === binding.operation
    ));
    candidates.push(Object.freeze({
      code: 'operation-issuer-role-outside-owner',
      subject: `${binding.role}:${provider.capability}:${binding.operation}`,
      paths: Object.freeze([
        `${descriptor.root}/module.json`,
        ...new Set(foreignDeclarations.map(({ path: declarationPath }) => declarationPath))
      ].sort(compareCodeUnits)),
      reason: ownerDeclarations.length === 0
        ? `issuer role ${binding.role} has no exact exported declaration in owner ${descriptor.moduleId}`
        : `issuer role ${binding.role} resolves to multiple exported declarations in owner ${descriptor.moduleId}`,
      observationClass: foreignDeclarations.length === 1 ? 'derived' : 'unknown'
    }));
  }
  for (const settlement of roleBindings.filter(({ binding }) => (
    binding.role === 'provider-settlement-issuer'
  ))) {
    const conflictingReadback = roleBindings.find(({ descriptor, binding }) => (
      descriptor.moduleId === settlement.descriptor.moduleId
      && binding.role === 'readback-issuer'
      && binding.semanticOperation === settlement.binding.semanticOperation
      && binding.requirementId === settlement.binding.requirementId
    ));
    if (conflictingReadback === undefined) continue;
    candidates.push(Object.freeze({
      code: 'operation-issuer-role-conflict',
      subject: `${settlement.binding.semanticOperation}:${settlement.binding.requirementId}`,
      paths: Object.freeze([`${settlement.descriptor.root}/module.json`]),
      reason: 'one module cannot issue provider settlement and independent domain readback for the same semantic operation requirement',
      observationClass: 'derived'
    }));
  }
  for (const descriptor of input.moduleMembership.descriptors) {
    for (const obligation of descriptor.operationObligations) {
      const operation = obligation.operation;
      if (operation.kind !== 'capability' || obligation.effect.kinds.length === 0) continue;
      const exactOperationRoles = roleBindings.filter(({ descriptor: owner, provider, binding }) => (
        owner.moduleId === descriptor.moduleId
        && provider.capability === operation.capability
        && binding.operation === operation.operation
      ));
      const exactDomainOwner = exactOperationRoles.find(({ binding }) => (
        binding.role === 'domain-owner' && binding.requirementId === null
      ));
      if (exactDomainOwner !== undefined) continue;
      const exactTerminalIssuers = exactOperationRoles.filter(({ binding }) => (
        binding.role === 'terminal-issuer' && binding.requirementId === null
      ));
      const terminalDomainOwners = exactTerminalIssuers.length === 1
        ? roleBindings.filter(({ descriptor: owner, provider, binding }) => (
            owner.moduleId === descriptor.moduleId
            && provider.capability === operation.capability
            && binding.role === 'domain-owner'
            && binding.semanticOperation === exactTerminalIssuers[0]!.binding.semanticOperation
            && binding.requirementId === null
          ))
        : [];
      if (terminalDomainOwners.length === 1) continue;
      const exactIssuer = exactOperationRoles.length === 1
          && (exactOperationRoles[0]!.binding.role === 'grant-issuer'
            || exactOperationRoles[0]!.binding.role === 'readback-issuer')
        ? exactOperationRoles[0]
        : undefined;
      const semanticDomainOwners = exactIssuer === undefined ? [] : roleBindings.filter(({ binding }) => (
        binding.role === 'domain-owner'
        && binding.semanticOperation === exactIssuer.binding.semanticOperation
        && binding.requirementId === null
      ));
      if (exactIssuer !== undefined && semanticDomainOwners.length === 1) continue;
      candidates.push(Object.freeze({
        code: 'operation-critical-role-unresolved',
        subject: `${operation.capability}:${operation.operation}`,
        paths: Object.freeze([`${descriptor.root}/module.json`]),
        reason: exactTerminalIssuers.length === 1
          ? 'effectful terminal operation has no unique domain owner in the same module, capability, and semantic operation'
          : exactIssuer !== undefined
            ? `effectful ${exactIssuer.binding.role} operation has no unique domain owner for semantic operation ${exactIssuer.binding.semanticOperation}`
            : 'effectful public semantic operation has no exact issuer role or domain owner bound to its declared provider operation',
        observationClass: 'unknown'
      }));
    }
  }
  const recoveryRoleBindings = roleBindings.filter(({ binding }) => (
    binding.role === 'recovery-issuer'
  ));
  for (const { descriptor, provider, binding } of roleBindings.filter(({ binding }) => (
    binding.role === 'durable-worker'
  ))) {
    const recovery = binding.recovery;
    const recoveryMatches = recovery === null ? [] : recoveryRoleBindings.filter((candidate) => (
      candidate.provider.capability === recovery.capability
      && candidate.binding.operation === recovery.operation
      && candidate.binding.semanticOperation === recovery.semanticOperation
      && candidate.binding.semanticOperation === binding.semanticOperation
    ));
    if (recovery === null
        || recoveryMatches.length !== 1
        || recoveryMatches[0]!.descriptor.moduleId === descriptor.moduleId) {
      candidates.push(Object.freeze({
        code: 'operation-recovery-binding-unresolved',
        subject: `${provider.capability}:${binding.operation}`,
        paths: Object.freeze([
          `${descriptor.root}/module.json`,
          ...recoveryMatches.map(({ descriptor: owner }) => `${owner.root}/module.json`)
        ].sort(compareCodeUnits)),
        reason: recovery === null
          ? 'durable worker has no recovery issuer binding'
          : recoveryMatches.length !== 1
            ? 'durable worker recovery binding does not resolve to one recovery issuer'
            : 'durable worker and recovery issuer must be owned by distinct modules',
        observationClass: recoveryMatches.length > 1 ? 'derived' : 'unknown'
      }));
    }
    const declarations = typescriptModel.declarations.filter((declaration) => (
      declaration.exported
      && declaration.moduleId === descriptor.moduleId
      && declaration.name === binding.operation
    ));
    if (declarations.length !== 1) continue;
    const declaration = declarations[0]!;
    const inputObservation = observeDurableWorkerInput(typescriptModel, declaration);
    const inputRisk = inputObservation.status === 'resolved'
      ? inputObservation.risk
      : 'unresolved' as const;
    if (inputRisk !== null) {
      candidates.push(Object.freeze({
        code: 'durable-worker-generic-input-exposed',
        subject: `${provider.capability}:${binding.operation}`,
        paths: Object.freeze([declaration.path]),
        reason: inputRisk === 'argv'
          ? 'durable worker exposes raw string-array command selectors'
          : inputRisk === 'callback'
            ? 'durable worker exposes a caller-supplied callback'
            : 'durable worker input contract is not proven capability-only by the exact declaration',
        observationClass: inputRisk === 'unresolved' ? 'unknown' : 'derived'
      }));
    }
    const domainOwnerModules = new Set(roleBindings
      .filter(({ binding: candidate }) => candidate.role === 'domain-owner')
      .map(({ descriptor: owner }) => owner.moduleId));
    const domainImports = semanticModel.references.filter((reference) => {
      if (reference.path !== declaration.path
          || (reference.kind !== 'import' && reference.kind !== 'reexport')
          || reference.targetPath === null) return false;
      const targetOwner = input.moduleMembership.moduleForPath(reference.targetPath);
      return targetOwner !== null && domainOwnerModules.has(targetOwner.moduleId);
    });
    if (domainImports.length > 0) {
      candidates.push(Object.freeze({
        code: 'durable-worker-domain-import',
        subject: `${provider.capability}:${binding.operation}`,
        paths: Object.freeze([
          declaration.path,
          ...new Set(domainImports.flatMap(({ targetPath }) => targetPath === null ? [] : [targetPath]))
        ].sort(compareCodeUnits)),
        reason: 'generic durable worker imports a module that owns domain semantics',
        observationClass: domainImports.some(({ observationClass }) => observationClass === 'unknown')
          ? 'unknown'
          : 'derived'
      }));
    }
  }
  const nativeProcessProviders = input.moduleMembership.descriptors.flatMap((descriptor) => (
    descriptor.capabilityProviders.flatMap((provider) => (
      provider.capability === 'process.native'
        ? [Object.freeze({ descriptor, provider })]
        : []
    ))
  ));
  const nativeProcessOwners = new Set(nativeProcessProviders.map(({ descriptor }) => (
    descriptor.moduleId
  )));
  const publicProcessOperations = nativeProcessProviders.flatMap(({ descriptor, provider }) => (
    provider.operations.flatMap((operation) => (
      provider.ownerInternalOperations.includes(operation)
        ? []
        : [Object.freeze({ descriptor, operation })]
    ))
  ));
  const observesNativeProcessTransport = capabilities.some((capability) => (
    capability.capability === 'process'
    && (capability.transport === 'native-runtime'
      || capability.providerCapability === 'process.native')
  ));
  if ((nativeProcessProviders.length > 0 || observesNativeProcessTransport)
      && (nativeProcessProviders.length !== 1 || publicProcessOperations.length !== 1)) {
    const boundaryPaths = nativeProcessProviders.length > 0
      ? nativeProcessProviders.map(({ descriptor }) => `${descriptor.root}/module.json`)
      : capabilities.flatMap((capability) => (
          capability.capability === 'process' && capability.transport === 'native-runtime'
            ? [capability.path]
            : []
        ));
    candidates.push(Object.freeze({
      code: 'process-resource-session-boundary-unresolved',
      subject: 'process.native',
      paths: Object.freeze([...new Set(boundaryPaths)].sort(compareCodeUnits)),
      reason: nativeProcessProviders.length !== 1
        ? `native process transport must have one physical owner, observed ${nativeProcessProviders.length}`
        : `native process transport must expose one owner-issued resource session and keep every other operation owner-internal, observed ${publicProcessOperations.length} public operations`,
      observationClass: 'derived'
    }));
  }
  type DirectNativeProcessObservation = Readonly<{
    operation: string;
    subject: string | null;
    source: 'import' | 'invocation';
  }>;
  const directNativeProcessByPath = new Map<string, DirectNativeProcessObservation[]>();
  const recordDirectNativeProcess = (
    invocationPath: string,
    observation: DirectNativeProcessObservation
  ): void => {
    const group = directNativeProcessByPath.get(invocationPath) ?? [];
    if (!group.some((candidate) => candidate.operation === observation.operation
        && candidate.subject === observation.subject
        && candidate.source === observation.source)) {
      group.push(observation);
      directNativeProcessByPath.set(invocationPath, group);
    }
  };
  for (const invocation of capabilities) {
    if (invocation.capability !== 'process' || invocation.surface !== 'production') continue;
    const providerDescriptor = invocation.providerModuleId === null
      ? null
      : input.moduleMembership.descriptors.find(({ moduleId }) => (
          moduleId === invocation.providerModuleId
        )) ?? null;
    const provider = invocation.providerCapability === null
      ? null
      : providerDescriptor?.capabilityProviders.find(({ capability }) => (
          capability === invocation.providerCapability
        )) ?? null;
    const crossesOwnerInternalProviderBoundary = invocation.transport === 'repository-provider'
      && provider !== null
      && provider.ownerInternalOperations.includes(invocation.operation)
      && invocation.moduleId !== invocation.providerModuleId;
    const isNativeTransportOutsideOwner = invocation.transport === 'native-runtime'
      && (invocation.moduleId === null || !nativeProcessOwners.has(invocation.moduleId));
    if (!crossesOwnerInternalProviderBoundary && !isNativeTransportOutsideOwner) continue;
    recordDirectNativeProcess(invocation.path, Object.freeze({
      operation: invocation.operation,
      subject: invocation.subject,
      source: 'invocation'
    }));
  }
  const declarationByObservationId = new Map(typescriptModel.declarations.map((declaration) => (
    [declaration.observationId, declaration] as const
  )));
  for (const reference of semanticModel.references) {
    if (sourceProgramSurfaceForPath(reference.path) !== 'production'
        || reference.targetObservationId === null) continue;
    const target = declarationByObservationId.get(reference.targetObservationId);
    if (target === undefined || target.moduleId === null) continue;
    const providerBinding = nativeProcessProviders.find(({ descriptor, provider }) => (
      descriptor.moduleId === target.moduleId
      && provider.ownerInternalOperations.includes(target.name)
    ));
    const sourceModuleId = input.moduleMembership.moduleForPath(reference.path)?.moduleId ?? null;
    if (providerBinding === undefined || sourceModuleId === target.moduleId) continue;
    recordDirectNativeProcess(reference.path, Object.freeze({
      operation: target.name,
      subject: null,
      source: 'import'
    }));
  }
  for (const [invocationPath, invocations] of directNativeProcessByPath) {
    const subjects = [...new Set(invocations.map(({ subject, operation }) => subject ?? operation))]
      .sort(compareCodeUnits);
    const importedOperations = [...new Set(invocations
      .filter(({ source }) => source === 'import')
      .map(({ operation }) => operation))].sort(compareCodeUnits);
    const invocationCount = invocations.filter(({ source }) => source === 'invocation').length;
    candidates.push(Object.freeze({
      code: 'direct-process-transport-outside-owner',
      subject: invocationPath,
      paths: Object.freeze([invocationPath]),
      reason: `${invocationCount} native or owner-internal process transport call(s) and ${importedOperations.length} raw owner-internal import(s) (${subjects.join(', ')}) are outside sole owner ${[...nativeProcessOwners].sort(compareCodeUnits).join(', ') || '<unresolved>'}; static descriptor, budget and TCB observation prove inventory only, never transport authority`,
      observationClass: 'derived'
    }));
  }
  const entrypointsByCommand = new Map<string, SourceProgramEntrypoint[]>();
  for (const entrypoint of entrypoints) {
    if (entrypoint.command === null) continue;
    if (entrypoint.kind === 'cli-command'
        && sourceProgramSurfaceForPath(entrypoint.path) === 'test') continue;
    const group = entrypointsByCommand.get(entrypoint.command) ?? [];
    group.push(entrypoint);
    entrypointsByCommand.set(entrypoint.command, group);
    if (entrypoint.observationClass === 'unknown') {
      candidates.push(Object.freeze({
        code: 'entrypoint-resolution-unknown',
        subject: entrypoint.name,
        paths: Object.freeze([entrypoint.path]),
        reason: `command relation is unresolved: ${entrypoint.command}`,
        observationClass: 'unknown'
      }));
    }
  }
  for (const [command, group] of entrypointsByCommand) {
    if (group.length < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-entrypoint-command',
      subject: command,
      paths: Object.freeze([...new Set(group.map(({ path: entryPath }) => entryPath))].sort(compareCodeUnits)),
      reason: `same command is projected by ${group.map(({ name }) => name).sort(compareCodeUnits).join(', ')}`,
      observationClass: 'derived'
    }));
  }
  for (const dependency of dependencies) {
    if (dependency.consumerPaths.length > 0) continue;
    candidates.push(Object.freeze({
      code: 'declared-dependency-without-source-consumer',
      subject: dependency.name,
      paths: Object.freeze([dependency.manifestPath]),
      reason: 'manifest declaration has no supported source import; generated, config, executable, or external consumers remain possible',
      observationClass: 'unknown'
    }));
  }
  const fileSurface = new Map(files.map((file) => [file.path, file.surface]));
  const literalsByPath = new Map<string, typeof semanticModel.literals[number][]>();
  for (const literal of semanticModel.literals) {
    const pathLiterals = literalsByPath.get(literal.path) ?? [];
    pathLiterals.push(literal);
    literalsByPath.set(literal.path, pathLiterals);
  }
  const referencesByTarget = new Map<string, typeof semanticModel.references[number][]>();
  const productionNamespaceImportTargets = new Set(
    semanticModel.references
      .filter((reference) => reference.kind === 'import'
        && reference.name === '*'
        && reference.targetPath !== null
        && fileSurface.get(reference.path) === 'production')
      .map(({ targetPath }) => targetPath!)
  );
  for (const reference of semanticModel.references) {
    if (reference.targetObservationId === null) continue;
    const group = referencesByTarget.get(reference.targetObservationId) ?? [];
    group.push(reference);
    referencesByTarget.set(reference.targetObservationId, group);
  }
  const declarationsByOwnerAndName = new Map<string, SourceProgramDeclaration[]>();
  const declarationsByPathAndName = new Map<string, SourceProgramDeclaration[]>();
  const versionedDeclarationsByOwnerAndBase = new Map<string, Readonly<{
    baseName: string;
    owner: string;
    versions: Map<number, SourceProgramDeclaration[]>;
  }>>();
  for (const declaration of typescriptModel.declarations) {
    if (fileSurface.get(declaration.path) !== 'production') continue;
    const owner = declaration.exported
      ? declaration.moduleId ?? declaration.path
      : declaration.path;
    const declarationKey = `${owner}\u0000${declaration.name}`;
    const sameName = declarationsByOwnerAndName.get(declarationKey) ?? [];
    sameName.push(declaration);
    declarationsByOwnerAndName.set(declarationKey, sameName);
    const pathDeclarationKey = `${declaration.path}\u0000${declaration.name}`;
    const samePathName = declarationsByPathAndName.get(pathDeclarationKey) ?? [];
    samePathName.push(declaration);
    declarationsByPathAndName.set(pathDeclarationKey, samePathName);
    const match = VERSIONED_DECLARATION_NAME.exec(declaration.name);
    if (match === null || match[1] === undefined || match[2] === undefined) continue;
    const groupKey = `${owner}\u0000${match[1]}`;
    const group = versionedDeclarationsByOwnerAndBase.get(groupKey) ?? Object.freeze({
      baseName: match[1],
      owner,
      versions: new Map<number, SourceProgramDeclaration[]>()
    });
    const version = Number(match[2]);
    const declarations = group.versions.get(version) ?? [];
    declarations.push(declaration);
    group.versions.set(version, declarations);
    versionedDeclarationsByOwnerAndBase.set(groupKey, group);
  }
  for (const group of versionedDeclarationsByOwnerAndBase.values()) {
    if (group.versions.size > 1) continue;
    const canonicalDeclarations = declarationsByOwnerAndName.get(
      `${group.owner}\u0000${group.baseName}`
    ) ?? [];
    if (canonicalDeclarations.length === 0) continue;
    for (const declaration of [...group.versions.values()].flat()) {
      const productionConsumers = (referencesByTarget.get(declaration.observationId) ?? [])
        .filter(({ path: consumerPath }) => fileSurface.get(consumerPath) === 'production');
      if (productionConsumers.length === 0
        && !productionNamespaceImportTargets.has(declaration.path)) continue;
      candidates.push(Object.freeze({
        code: 'versioned-declaration-conflicts-with-canonical-name',
        subject: declaration.name,
        paths: Object.freeze([...new Set([
          declaration.path,
          ...canonicalDeclarations.map(({ path: canonicalPath }) => canonicalPath),
          ...new Set(productionConsumers.map(({ path: consumerPath }) => consumerPath))
        ])].sort(compareCodeUnits)),
        reason: `versioned declaration and canonical declaration coexist without a second version; reconcile behavior into ${group.baseName} instead of retaining a compatibility-shaped duplicate`,
        observationClass: 'derived'
      }));
    }
  }
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported || fileSurface.get(declaration.path) !== 'production') continue;
    const declarationOwner = input.moduleMembership.moduleForPath(declaration.path);
    const ownsDeclaredCapability = declarationOwner !== null
      && declaredCapabilityOperationsByModule
        .get(declarationOwner.moduleId)
        ?.has(declaration.name) === true;
    if (ownsDeclaredCapability) continue;
    const consumers = referencesByTarget.get(declaration.observationId) ?? [];
    if (consumers.length === 0 && !productionNamespaceImportTargets.has(declaration.path)) {
      candidates.push(Object.freeze({
        code: IDENTITY_TOKEN_NAME.test(declaration.name)
          ? 'identity-token-without-consumer'
          : 'production-declaration-without-consumer',
        subject: declaration.name,
        paths: Object.freeze([declaration.path]),
        reason: IDENTITY_TOKEN_NAME.test(declaration.name)
          ? 'exported version/schema/format identity has no supported source consumer'
          : 'exported production declaration has no supported source consumer; external or dynamic consumers remain possible until its entrypoint closure is proven',
        observationClass: 'unknown'
      }));
    } else if (consumers.length > 0
      && !productionNamespaceImportTargets.has(declaration.path)
      && consumers.every(({ path: consumerPath }) => fileSurface.get(consumerPath) === 'test')) {
      candidates.push(Object.freeze({
        code: 'production-declaration-only-test-consumers',
        subject: declaration.name,
        paths: Object.freeze([
          declaration.path,
          ...new Set(consumers.map(({ path: consumerPath }) => consumerPath))
        ].sort(compareCodeUnits)),
        reason: 'supported references are all test-surface references; runtime, external, or dynamic consumers remain possible',
        observationClass: 'unknown'
      }));
    }
  }
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported
      || fileSurface.get(declaration.path) !== 'production'
      || !IDENTITY_TOKEN_NAME.test(declaration.name)) continue;
    const ownedValues = new Set((literalsByPath.get(declaration.path) ?? [])
      .filter((literal) => literal.path === declaration.path
        && literal.context === 'producer'
        && literal.span.start >= declaration.span.start
        && literal.span.end <= declaration.span.end)
      .map(({ value }) => value));
    if (ownedValues.size === 0) continue;
    const identityField = identityFieldName(declaration.name);
    const semanticTargets = [
      declaration,
      ...(identityField === null
        ? []
        : declarationsByPathAndName.get(`${declaration.path}\u0000${identityField}`) ?? [])
    ];
    const testReferences = semanticTargets.flatMap((target) =>
      referencesByTarget.get(target.observationId) ?? [])
      .filter(({ kind, path: consumerPath }) =>
        kind !== 'import' && fileSurface.get(consumerPath) === 'test');
    const mirrors = testReferences.flatMap((reference) =>
      (literalsByPath.get(reference.path) ?? []).filter((literal) =>
        literal.context === 'assertion'
        && literal.contextSpan !== null
        && reference.span.start >= literal.contextSpan.start
        && reference.span.end <= literal.contextSpan.end
        && ownedValues.has(literal.value)));
    if (mirrors.length === 0) continue;
    candidates.push(Object.freeze({
      code: 'test-mirrors-production-identity-literal',
      subject: declaration.name,
      paths: Object.freeze([
        declaration.path,
        ...new Set(mirrors.map(({ path: mirrorPath }) => mirrorPath))
      ].sort(compareCodeUnits)),
      reason: 'test assertion repeats a production schema/version/revision literal instead of exercising its reader or rejection boundary',
      observationClass: 'derived'
    }));
  }
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported
      || fileSurface.get(declaration.path) !== 'production'
      || declaration.kind !== 'VariableDeclaration'
      || IDENTITY_TOKEN_NAME.test(declaration.name)) continue;
    const ownedValues = new Set((literalsByPath.get(declaration.path) ?? [])
      .filter((literal) => literal.path === declaration.path
        && literal.value.length > 0
        && literal.span.start >= declaration.span.start
        && literal.span.end <= declaration.span.end)
      .map(({ value }) => value));
    if (ownedValues.size < 3) continue;
    const testReferences = (referencesByTarget.get(declaration.observationId) ?? [])
      .filter(({ kind, path: consumerPath }) =>
        kind !== 'import' && fileSurface.get(consumerPath) === 'test');
    const directTestConsumers = new Set(
      testReferences.map(({ path: consumerPath }) => consumerPath)
    );
    if (directTestConsumers.size === 0) continue;
    const mirrorsByPath = new Map<string, Set<string>>();
    const testReferencesByPath = new Map<string, typeof testReferences>();
    for (const reference of testReferences) {
      const pathReferences = testReferencesByPath.get(reference.path) ?? [];
      pathReferences.push(reference);
      testReferencesByPath.set(reference.path, pathReferences);
    }
    for (const consumerPath of directTestConsumers) {
      const pathReferences = testReferencesByPath.get(consumerPath) ?? [];
      for (const literal of literalsByPath.get(consumerPath) ?? []) {
        if (literal.context !== 'assertion'
          || literal.contextSpan === null
          || !pathReferences.some((reference) =>
            reference.span.start >= literal.contextSpan!.start
            && reference.span.end <= literal.contextSpan!.end)
          || !ownedValues.has(literal.value)) continue;
        const values = mirrorsByPath.get(literal.path) ?? new Set<string>();
        values.add(literal.value);
        mirrorsByPath.set(literal.path, values);
      }
    }
    const mirrorPaths = [...mirrorsByPath]
      .filter(([, values]) => values.size >= 3 && values.size / ownedValues.size >= 0.6)
      .map(([mirrorPath]) => mirrorPath)
      .sort(compareCodeUnits);
    if (mirrorPaths.length === 0) continue;
    const mirroredValueCount = Math.max(...mirrorPaths.map((mirrorPath) =>
      mirrorsByPath.get(mirrorPath)?.size ?? 0));
    candidates.push(Object.freeze({
      code: 'test-mirrors-production-literal-collection',
      subject: declaration.name,
      paths: Object.freeze([
        declaration.path,
        ...mirrorPaths
      ].sort(compareCodeUnits)),
      reason: `one test file repeats up to ${mirroredValueCount}/${ownedValues.size} literals owned by one production collection instead of observing its behavior or consuming its canonical projection`,
      observationClass: 'derived'
    }));
  }
  const productionSourcePaths = new Set(files
    .filter(({ path: repositoryPath, surface }) => surface === 'production'
      && /^src\//u.test(repositoryPath)
      && /\.[cm]?[jt]sx?$/u.test(repositoryPath))
    .map(({ path: repositoryPath }) => repositoryPath));
  const derivedSourceAddressPaths = new Set<string>();
  for (const entrypoint of entrypoints) {
    for (const targetPath of entrypoint.targetPaths) {
      if (productionSourcePaths.has(targetPath)) derivedSourceAddressPaths.add(targetPath);
    }
    const commandPath = entrypoint.command?.match(
      /(?:^|\s)(?:\.\/)?(src\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?)(?:\s|$)/u
    )?.[1];
    if (commandPath !== undefined && productionSourcePaths.has(commandPath)) {
      derivedSourceAddressPaths.add(commandPath);
    }
  }
  for (const dispatcher of input.reviewedProcessDispatchers ?? []) {
    const separator = dispatcher.indexOf('::');
    const dispatcherPath = separator < 0 ? null : dispatcher.slice(0, separator);
    if (dispatcherPath !== null && productionSourcePaths.has(dispatcherPath)) {
      derivedSourceAddressPaths.add(dispatcherPath);
    }
  }
  const productionReferencesByDeclaration = new Map<string, number>();
  for (const reference of semanticModel.references) {
    if (reference.targetObservationId === null || fileSurface.get(reference.path) !== 'production') continue;
    productionReferencesByDeclaration.set(
      reference.targetObservationId,
      (productionReferencesByDeclaration.get(reference.targetObservationId) ?? 0) + 1
    );
  }
  const declarationsByPathAndSpan = new Map(
    typescriptModel.declarations.map((declaration) => [
      `${declaration.path}\0${declaration.span.start}\0${declaration.span.end}`,
      declaration
    ] as const)
  );
  for (const literal of semanticModel.literals) {
    if (literal.context !== 'producer' || literal.contextSpan === null) continue;
    const normalizedValue = literal.value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (!productionSourcePaths.has(normalizedValue)) continue;
    const declaration = declarationsByPathAndSpan.get(
      `${literal.path}\0${literal.contextSpan.start}\0${literal.contextSpan.end}`
    );
    if (declaration?.exported === true
        && (productionReferencesByDeclaration.get(declaration.observationId) ?? 0) > 0) {
      derivedSourceAddressPaths.add(normalizedValue);
    }
  }
  const productionSourcePathMirrors = new Map<string, Set<string>>();
  for (const literal of semanticModel.literals) {
    if (fileSurface.get(literal.path) !== 'production') continue;
    const normalizedValue = literal.value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (normalizedValue === literal.path
      || !productionSourcePaths.has(normalizedValue)
      || derivedSourceAddressPaths.has(normalizedValue)) continue;
    const mirrorPaths = productionSourcePathMirrors.get(normalizedValue) ?? new Set<string>();
    mirrorPaths.add(literal.path);
    productionSourcePathMirrors.set(normalizedValue, mirrorPaths);
  }
  for (const [sourcePath, mirrorPaths] of productionSourcePathMirrors) {
    candidates.push(Object.freeze({
      code: 'production-mirrors-source-path',
      subject: sourcePath,
      paths: Object.freeze([sourcePath, ...mirrorPaths].sort(compareCodeUnits)),
      reason: 'production code repeats another source file address instead of deriving the relation from an entrypoint, module, capability, or artifact owner',
      observationClass: 'derived'
    }));
    if (mirrorPaths.size < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-production-source-path-owner',
      subject: sourcePath,
      paths: Object.freeze([sourcePath, ...mirrorPaths].sort(compareCodeUnits)),
      reason: `${mirrorPaths.size} production modules repeat one source address; derive the relation from one module, entrypoint, capability, or artifact owner`,
      observationClass: 'derived'
    }));
  }

  const identityOwnersByLiteral = new Map<string, SourceProgramDeclaration[]>();
  for (const declaration of typescriptModel.declarations) {
    if (!declaration.exported
      || fileSurface.get(declaration.path) !== 'production'
      || !IDENTITY_TOKEN_NAME.test(declaration.name)) continue;
    const ownedIdentityLiterals = new Set((literalsByPath.get(declaration.path) ?? [])
      .filter((literal) => literal.path === declaration.path
        && literal.context === 'producer'
        && literal.value.length >= 8
        && /[-:]/u.test(literal.value)
        && literal.span.start >= declaration.span.start
        && literal.span.end <= declaration.span.end)
      .map(({ value }) => value));
    for (const value of ownedIdentityLiterals) {
      const owners = identityOwnersByLiteral.get(value) ?? [];
      owners.push(declaration);
      identityOwnersByLiteral.set(value, owners);
    }
  }
  for (const [value, owners] of identityOwnersByLiteral) {
    const ownerPaths = [...new Set(owners.map(({ path: ownerPath }) => ownerPath))]
      .sort(compareCodeUnits);
    if (owners.length < 2 || ownerPaths.length < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-production-identity-token',
      subject: value,
      paths: Object.freeze(ownerPaths),
      reason: `one schema/version/revision token is produced by ${owners.length} declarations; retain one canonical owner and derive or retire the others`,
      observationClass: 'derived'
    }));
  }

  const endpointPathsByLiteral = new Map<string, Set<string>>();
  for (const literal of semanticModel.literals) {
    if (fileSurface.get(literal.path) !== 'production'
      || !/^https?:\/\/[^\s]+$/iu.test(literal.value)) continue;
    const ownerPaths = endpointPathsByLiteral.get(literal.value) ?? new Set<string>();
    ownerPaths.add(literal.path);
    endpointPathsByLiteral.set(literal.value, ownerPaths);
  }
  for (const [endpoint, ownerPaths] of endpointPathsByLiteral) {
    if (ownerPaths.size < 2) continue;
    candidates.push(Object.freeze({
      code: 'duplicate-production-endpoint-literal',
      subject: endpoint,
      paths: Object.freeze([...ownerPaths].sort(compareCodeUnits)),
      reason: 'one external endpoint is hard-coded by multiple production modules instead of one provider or configuration owner',
      observationClass: 'derived'
    }));
  }

  const sourcePathMirrors = new Map<string, Set<string>>();
  for (const literal of semanticModel.literals) {
    if (fileSurface.get(literal.path) !== 'test' || literal.context !== 'assertion') continue;
    const normalizedValue = literal.value.replaceAll('\\', '/').replace(/^\.\//u, '');
    if (!productionSourcePaths.has(normalizedValue)) continue;
    const mirrorPaths = sourcePathMirrors.get(normalizedValue) ?? new Set<string>();
    mirrorPaths.add(literal.path);
    sourcePathMirrors.set(normalizedValue, mirrorPaths);
  }
  for (const [sourcePath, mirrorPaths] of sourcePathMirrors) {
    candidates.push(Object.freeze({
      code: 'test-mirrors-production-source-path',
      subject: sourcePath,
      paths: Object.freeze([sourcePath, ...mirrorPaths].sort(compareCodeUnits)),
      reason: 'test assertion repeats a production source path; observe a public behavior/contract or derive the path from the source-program owner instead of freezing repository layout',
      observationClass: 'derived'
    }));
  }
  const deduplicatedCandidates = [...new Map(candidates.map((candidate) => [
    sha256(candidate),
    candidate
  ] as const)).values()];
  deduplicatedCandidates.sort((left, right) =>
    compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.subject, right.subject)
    || compareCodeUnits(left.paths.join('\0'), right.paths.join('\0'))
  );
  const canonicalModel = {
    sourceRevision: typescriptModel.sourceRevision,
    providers: Object.freeze([
      ...typescriptModel.providers,
      Object.freeze({ id: 'ecmascript-json', revision: process.versions.bun })
    ]),
    files: Object.freeze(files),
    declarations: typescriptModel.declarations,
    references: Object.freeze([...semanticModel.references, ...embeddedReferences]),
    returnProvenances: typescriptModel.returnProvenances,
    literals: semanticModel.literals,
    entrypoints: Object.freeze(entrypoints),
    entrypointClosures: Object.freeze(entrypointClosures),
    packages: Object.freeze(packages),
    dependencies: Object.freeze(dependencies),
    capabilities,
    candidates: Object.freeze(deduplicatedCandidates),
    unknowns: Object.freeze(unknowns)
  };
  const model: SourceProgramModel = Object.freeze({
    ...canonicalModel,
    modelDigest: sha256(canonicalModel)
  });
  compiledRepositoryModels.add(model);
  return model;
}

export function compileRepositoryModel(
  input: RepositoryModelInput
): SourceProgramModel {
  return compileRepositoryModelInternal(input);
}

export function compileRepositoryModelFromSnapshot(
  input: RepositoryModelInput,
  repositoryCompilation: WorkspaceSourceSnapshot
): SourceProgramModel {
  repositoryCompilation.assertMatches(input);
  return compileRepositoryModelInternal({ ...input, repositoryCompilation });
}

function countTopologyValues(values: readonly string[]): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.freeze(Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => compareCodeUnits(left, right))
  ));
}

/** Compact decision surface for a complete Source Program Model. */
export function summarizeRepositoryTopology(
  model: SourceProgramModel
): SourceProgramTopologySummary {
  const entrypointByObservationId = new Map(model.entrypoints.map((entrypoint) => [
    entrypoint.observationId,
    entrypoint
  ]));
  const entrypointRole = (entrypoint: SourceProgramEntrypoint): string => {
    if (entrypoint.kind === 'package-bin') {
      return entrypoint.path === 'bun.lock'
        ? 'dependency-executable'
        : 'package-executable';
    }
    if (entrypoint.kind === 'package-script') return 'package-operation';
    if (entrypoint.kind === 'cli-command') return 'product-cli-operation';
    if (entrypoint.kind === 'module-entrypoint') return 'module-process-boundary';
    return entrypoint.kind === 'git-hook' ? 'host-hook' : 'host-workflow';
  };
  const declaredPackageNames = new Set(model.dependencies.map(({ name }) => name));
  const capabilityAuthorityClass = (
    capability: SourceProgramModel['capabilities'][number]
  ): SourceProgramCapabilityAuthorityClass => {
    if (capability.providerModuleId !== null) return 'repository-provider';
    // A raw native process call remains unresolved even when its import is a
    // runtime builtin: builtin provenance does not provide process authority.
    if (capability.capability === 'process' && capability.transport === 'native-runtime') {
      return 'unresolved-transport';
    }
    if (
      capability.transport === 'runtime-built-in-api'
      && capability.moduleSpecifier !== null
    ) return 'runtime-built-in-api';
    if (
      capability.transport === 'package-api'
      && capability.moduleSpecifier !== null
      && declaredPackageNames.has(dependencyPackageName(capability.moduleSpecifier))
    ) return 'external-package-api';
    return 'unresolved-transport';
  };
  const capabilityProviderModule = (
    capability: SourceProgramModel['capabilities'][number]
  ): string => {
    if (capability.providerModuleId !== null) return capability.providerModuleId;
    if (capability.capability === 'process' && capability.transport === 'native-runtime') {
      return '<unresolved>';
    }
    if (
      capability.transport === 'runtime-built-in-api'
      && capability.moduleSpecifier !== null
    ) return capability.moduleSpecifier;
    if (
      capability.transport === 'package-api'
      && capability.moduleSpecifier !== null
      && declaredPackageNames.has(dependencyPackageName(capability.moduleSpecifier))
    ) return dependencyPackageName(capability.moduleSpecifier);
    return '<unresolved>';
  };
  return Object.freeze({
    packages: model.packages.length,
    dependencyScopes: countTopologyValues(model.dependencies.map(({ scope }) => scope)),
    entrypointKinds: countTopologyValues(model.entrypoints.map(({ kind }) => kind)),
    entrypointRoles: countTopologyValues(model.entrypoints.map(entrypointRole)),
    entrypointHandlerModules: countTopologyValues(model.entrypointClosures.flatMap(
      (closure) => {
        if (closure.handlerModuleIds.length > 0) return closure.handlerModuleIds;
        const entrypoint = entrypointByObservationId.get(closure.entrypointObservationId);
        if (closure.targetPackages.length > 0) return ['<external-package>'];
        if (entrypoint?.kind === 'git-hook' || entrypoint?.kind === 'workflow') {
          return ['<host-adapter>'];
        }
        return ['<unresolved>'];
      }
    )),
    entrypointObservationClasses: countTopologyValues(
      model.entrypointClosures.map(({ observationClass }) => observationClass)
    ),
    capabilityKinds: countTopologyValues(model.capabilities.map(({ capability }) => capability)),
    capabilityTransports: countTopologyValues(model.capabilities.map(({ transport }) => transport)),
    capabilityAuthorityClasses: countTopologyValues(
      model.capabilities.map(capabilityAuthorityClass)
    ),
    providerModules: countTopologyValues(model.capabilities.map(capabilityProviderModule)),
    candidateCodes: countTopologyValues(model.candidates.map(({ code }) => code)),
    unknownCodes: countTopologyValues(model.unknowns.map(({ code }) => code)),
    directProcessTransportPaths: new Set(model.candidates
      .filter(({ code }) => code === 'direct-process-transport-outside-owner')
      .flatMap(({ paths }) => paths)).size
  });
}
