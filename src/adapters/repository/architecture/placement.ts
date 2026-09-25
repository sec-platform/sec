
import { rawSha256Hex } from '../../../contracts/canonical.ts';
import {
  compileRepositoryModuleTopologyProjection,
  isRepositoryNodeDependencyAllowed,
  normalizeRepositoryModulePath,
  type RepositoryModuleBoundaryViolation,
  type RepositoryModuleGraph,
  type RepositoryModuleMembership,
  type RepositoryModuleSourceProgramFacts,
  type RepositoryNodeResponsibility
} from './contract.ts';

type Sha256 = `sha256:${string}`;

type RepositoryDeclarationResponsibilityReason =
  | 'bounded-semantic-evidence-conflict'
  | 'bounded-semantic-evidence-missing'
  | 'compiler-observed-capability'
  | 'compiler-observed-contract-declaration'
  | 'compiler-observed-entrypoint'
  | 'compiler-observed-local-computation'
  | 'descriptor-causal-relation'
  | 'descriptor-operation-role'
  | 'descriptor-owner-internal-capability'
  | 'semantic-responsibility-binding';

type RepositoryDeclarationResponsibilityProjection = Readonly<{
  readonly nodeId: string;
  readonly declarationDigest: string;
  readonly path: string;
  readonly moduleId: string;
  readonly name: string;
  readonly exported: boolean;
  readonly status: 'bounded-unknown' | 'resolved';
  readonly responsibility: RepositoryNodeResponsibility | null;
  readonly reason: RepositoryDeclarationResponsibilityReason;
  readonly criticality: readonly ('authority-mint' | 'effect' | 'public')[];
  readonly evidenceDigest: Sha256;
}>;

type RepositoryModulePlacementMetrics = Readonly<{
  readonly ownerEdges: number;
  readonly cyclicOwners: number;
  readonly reciprocalPairs: number;
  readonly aggregateFacades: number;
  readonly boundedUnknownDeclarations: number;
  /** Cross-owner source-line maintenance weight; null means the canonical snapshot omitted metrics. */
  readonly crossOwnerSourceLines: number | null;
  readonly publicOperationClosureDigest: Sha256;
  readonly publicOperations: number;
}>;

export type RepositoryModulePlacementAdmission = Readonly<{
  readonly responsibilityFrontier: readonly RepositoryDeclarationResponsibilityProjection[];
  readonly current: RepositoryModulePlacementMetrics;
  readonly violations: readonly RepositoryModuleBoundaryViolation[];
  readonly admissionDigest: Sha256;
}>;

type PlacementFacts = Omit<RepositoryModuleSourceProgramFacts, 'files'> & Readonly<{
  readonly files: readonly (RepositoryModuleSourceProgramFacts['files'][number] & Readonly<{
    readonly sourceLines?: number;
  }>)[];
}>;

type ResponsibilityCandidate = Readonly<{
  responsibility: RepositoryNodeResponsibility;
  reason: RepositoryDeclarationResponsibilityReason;
  evidence: unknown;
}>;

function digest(value: unknown): Sha256 {
  return `sha256:${rawSha256Hex(JSON.stringify(value))}`;
}

function textOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function relationResponsibility(
  relation: string,
  operation: unknown
): RepositoryNodeResponsibility {
  if (operation !== null) return 'operation';
  if (relation === 'declares') return 'contract';
  if (relation === 'writes' || relation === 'executes' || relation === 'settles'
      || relation === 'reads-back' || relation === 'recovers' || relation === 'migrates'
      || relation === 'retires') return 'operation';
  return 'computation';
}

function semanticTargetResponsibility(kind: string): RepositoryNodeResponsibility {
  if (kind === 'entity') return 'contract';
  if (kind === 'effect') return 'capability';
  if (kind === 'operation') return 'operation';
  return 'workflow';
}

function semanticEvidenceDeclarationKey(input: Readonly<{
  path: string;
  name: string;
  observationId: string | null | undefined;
  declarationDigest: string | null | undefined;
  moduleId: string | null | undefined;
}>): string {
  const exact = (value: string | null | undefined): readonly [string, string?] => (
    value === undefined ? ['undefined'] : value === null ? ['null'] : ['value', value]
  );
  return JSON.stringify([
    input.path,
    input.name,
    exact(input.observationId),
    exact(input.declarationDigest),
    exact(input.moduleId)
  ]);
}

const CONTRACT_DECLARATION_KINDS = new Set([
  'EnumDeclaration',
  'InterfaceDeclaration',
  'TypeAliasDeclaration'
]);

/**
 * Compile one total declaration frontier from the canonical Source Program and
 * descriptor intent. Paths only locate compiler facts; neither a directory nor
 * a filename can grant a responsibility.
 */
function compileRepositoryDeclarationResponsibilityFrontier(
  membership: RepositoryModuleMembership,
  facts: PlacementFacts
): readonly RepositoryDeclarationResponsibilityProjection[] {
  const productionPaths = new Set(facts.files
    .filter(({ surface }) => surface === 'production')
    .map(({ path }) => normalizeRepositoryModulePath(path)));
  const declarations = [...(facts.declarations ?? [])]
    .map((declaration) => ({ ...declaration, path: normalizeRepositoryModulePath(declaration.path) }))
    .filter(({ path }) => productionPaths.has(path))
    .sort((left, right) => textOrder(left.path, right.path)
      || textOrder(left.observationId ?? '', right.observationId ?? ''));
  const fileFacts = new Map(facts.files.map((file) => (
    [normalizeRepositoryModulePath(file.path), file] as const
  )));
  const declarationIdentityCounts = new Map<string, number>();
  for (const declaration of declarations) {
    const identity = declaration.observationId ?? '';
    declarationIdentityCounts.set(identity, (declarationIdentityCounts.get(identity) ?? 0) + 1);
  }
  const unknownPaths = new Set<string>();
  for (const file of facts.files) {
    if (file.semanticObservationClass === 'unknown') {
      unknownPaths.add(normalizeRepositoryModulePath(file.path));
    }
  }

  const observedConsumerOwnersByTarget = new Map<
    string | null | undefined,
    Set<string | undefined>
  >();
  for (const reference of facts.references ?? []) {
    if (reference.observationClass === 'unknown') continue;
    const targetObservationId = reference.targetObservationId;
    let owners = observedConsumerOwnersByTarget.get(targetObservationId);
    if (owners === undefined) {
      owners = new Set();
      observedConsumerOwnersByTarget.set(targetObservationId, owners);
    }
    owners.add(membership.moduleForPath(
      normalizeRepositoryModulePath(reference.path)
    )?.moduleId);
  }

  type ResponsibilityEvidence = NonNullable<PlacementFacts['responsibilityEvidence']>[number];
  const semanticEvidenceByDeclaration = new Map<string, ResponsibilityEvidence[]>();
  for (const evidence of facts.responsibilityEvidence ?? []) {
    if (evidence.observationClass !== 'observed'
        || evidence.reason !== 'validated'
        || evidence.sourceRevision !== facts.sourceRevision
        || evidence.semanticRevision !== facts.semanticRevision) continue;
    const key = semanticEvidenceDeclarationKey({
      path: evidence.declaration.path,
      name: evidence.declaration.exportName,
      observationId: evidence.declaration.observationId,
      declarationDigest: evidence.declaration.declarationDigest,
      moduleId: evidence.declaration.moduleId
    });
    const values = semanticEvidenceByDeclaration.get(key) ?? [];
    values.push(evidence);
    semanticEvidenceByDeclaration.set(key, values);
  }

  const productionCapabilitiesByDeclaration = new Map<string | null | undefined, number>();
  for (const capability of facts.capabilities ?? []) {
    if (capability.surface !== 'production') continue;
    const identity = capability.owningDeclarationObservationId;
    productionCapabilitiesByDeclaration.set(
      identity,
      (productionCapabilitiesByDeclaration.get(identity) ?? 0) + 1
    );
  }

  type EntrypointFact = PlacementFacts['entrypoints'][number];
  const entrypointsByTargetPath = new Map<string, EntrypointFact[]>();
  for (const entrypoint of facts.entrypoints) {
    if (entrypoint.observationClass === 'unknown') continue;
    const uniqueTargetPaths = new Set((entrypoint.targetPaths ?? [])
      .map((path) => normalizeRepositoryModulePath(path)));
    for (const targetPath of uniqueTargetPaths) {
      const values = entrypointsByTargetPath.get(targetPath) ?? [];
      values.push(entrypoint);
      entrypointsByTargetPath.set(targetPath, values);
    }
  }
  const exportedDeclarationCountByPath = new Map<string, number>();
  for (const declaration of declarations) {
    if (!declaration.exported) continue;
    exportedDeclarationCountByPath.set(
      declaration.path,
      (exportedDeclarationCountByPath.get(declaration.path) ?? 0) + 1
    );
  }

  return Object.freeze(declarations.map((declaration) => {
    const owner = membership.moduleForPath(declaration.path);
    const candidates: ResponsibilityCandidate[] = [];
    const criticality = new Set<'authority-mint' | 'effect' | 'public'>();
    const consumerOwners = observedConsumerOwnersByTarget.get(declaration.observationId);
    const hasCrossOwnerConsumer = consumerOwners !== undefined
      && (consumerOwners.size > 1 || !consumerOwners.has(owner?.moduleId));
    if (declaration.exported && hasCrossOwnerConsumer) criticality.add('public');

    const exactSemanticEvidence = semanticEvidenceByDeclaration.get(
      semanticEvidenceDeclarationKey({
        path: declaration.path,
        name: declaration.name,
        observationId: declaration.observationId,
        declarationDigest: declaration.declarationDigest,
        moduleId: owner?.moduleId
      })
    ) ?? [];
    for (const evidence of exactSemanticEvidence) {
      candidates.push(Object.freeze({
        responsibility: semanticTargetResponsibility(evidence.target.kind),
        reason: 'semantic-responsibility-binding',
        evidence: evidence.evidenceDigest
      }));
    }

    for (const provider of owner?.capabilityProviders ?? []) {
      if (!provider.operations.includes(declaration.name) || !declaration.exported) continue;
      criticality.add('authority-mint');
      criticality.add('public');
      const role = provider.operationRoles.find(({ operation }) => operation === declaration.name);
      if (role !== undefined) {
        candidates.push(Object.freeze({
          responsibility: 'operation',
          reason: 'descriptor-operation-role',
          evidence: { capability: provider.capability, role }
        }));
      } else if (provider.ownerInternalOperations.includes(declaration.name)) {
        candidates.push(Object.freeze({
          responsibility: 'capability',
          reason: 'descriptor-owner-internal-capability',
          evidence: { capability: provider.capability, operation: declaration.name }
        }));
      }
    }

    for (const relation of owner?.causalRelations ?? []) {
      if (normalizeRepositoryModulePath(relation.symbol.path) !== declaration.path
          || relation.symbol.name !== declaration.name) continue;
      candidates.push(Object.freeze({
        responsibility: relationResponsibility(relation.relation, relation.operation),
        reason: 'descriptor-causal-relation',
        evidence: relation
      }));
    }

    const capabilityFactCount = productionCapabilitiesByDeclaration.get(
      declaration.observationId
    ) ?? 0;
    if (capabilityFactCount > 0) criticality.add('effect');

    const entrypointFacts = entrypointsByTargetPath.get(declaration.path) ?? [];
    if (entrypointFacts.length > 0) criticality.add('public');
    if (entrypointFacts.length > 0 && declaration.exported
        && exportedDeclarationCountByPath.get(declaration.path) === 1) {
      candidates.push(Object.freeze({
        responsibility: 'interface',
        reason: 'compiler-observed-entrypoint',
        evidence: entrypointFacts.map(({ observationId }) => observationId)
      }));
    }

    if (declaration.kind !== undefined && CONTRACT_DECLARATION_KINDS.has(declaration.kind)) {
      candidates.push(Object.freeze({
        responsibility: 'contract',
        reason: 'compiler-observed-contract-declaration',
        evidence: declaration.kind
      }));
    } else if (!declaration.exported && capabilityFactCount === 0
        && !unknownPaths.has(declaration.path)) {
      candidates.push(Object.freeze({
        responsibility: 'computation',
        reason: 'compiler-observed-local-computation',
        evidence: declaration.kind ?? null
      }));
    }

    const responsibilities = [...new Set(candidates.map(({ responsibility }) => responsibility))];
    const identityResolved = declaration.observationId !== undefined
      && declaration.observationId.length > 0
      && declaration.declarationDigest !== undefined
      && declaration.declarationDigest.length > 0
      && declarationIdentityCounts.get(declaration.observationId) === 1
      && declaration.moduleId === owner?.moduleId;
    const resolved = owner !== null && identityResolved && responsibilities.length === 1
      && fileFacts.get(declaration.path)?.semanticKind !== 'pure-reexport'
      && fileFacts.get(declaration.path)?.semanticObservationClass !== 'unknown';
    const reason: RepositoryDeclarationResponsibilityReason = resolved
      ? candidates[0]!.reason
      : candidates.length > 0
        ? 'bounded-semantic-evidence-conflict'
        : 'bounded-semantic-evidence-missing';
    const decision = {
      declarationDigest: declaration.declarationDigest ?? '',
      exported: declaration.exported,
      moduleId: owner?.moduleId ?? '',
      name: declaration.name,
      nodeId: declaration.observationId ?? '',
      path: declaration.path,
      responsibility: resolved ? responsibilities[0]! : null,
      status: resolved ? 'resolved' as const : 'bounded-unknown' as const,
      reason,
      criticality: Object.freeze([...criticality].sort(textOrder)),
      candidateEvidence: candidates.map(({ responsibility, reason: candidateReason, evidence }) => ({
        responsibility, reason: candidateReason, evidence
      }))
    };
    return Object.freeze({
      nodeId: decision.nodeId,
      declarationDigest: decision.declarationDigest,
      path: decision.path,
      moduleId: decision.moduleId,
      name: decision.name,
      exported: decision.exported,
      status: decision.status,
      responsibility: decision.responsibility,
      reason: decision.reason,
      criticality: decision.criticality,
      evidenceDigest: digest(decision)
    });
  }));
}

function fileResponsibilities(
  frontier: readonly RepositoryDeclarationResponsibilityProjection[]
): ReadonlyMap<string, RepositoryNodeResponsibility> {
  const candidates = new Map<string, RepositoryNodeResponsibility[]>();
  for (const node of frontier) {
    if (node.status !== 'resolved' || node.responsibility === null) continue;
    const values = candidates.get(node.path) ?? [];
    values.push(node.responsibility);
    candidates.set(node.path, values);
  }
  return new Map([...candidates].flatMap(([path, values]) => {
    const unique = [...new Set(values)];
    return unique.length === 1 ? [[path, unique[0]!] as const] : [];
  }));
}

function publicOperationClosure(
  membership: RepositoryModuleMembership,
  frontier: readonly RepositoryDeclarationResponsibilityProjection[],
  ownerForPath: (path: string) => string | null
): Readonly<{ digest: Sha256; count: number; unresolved: readonly string[] }> {
  const identities: unknown[] = [];
  const unresolved: string[] = [];
  for (const node of frontier) {
    if (!node.criticality.includes('authority-mint')) continue;
    const ownerId = ownerForPath(node.path);
    const descriptor = membership.descriptors.find(({ moduleId }) => moduleId === ownerId);
    const matches = descriptor?.capabilityProviders.flatMap((provider) => (
      provider.operations.includes(node.name)
        ? [{
            capability: provider.capability,
            operation: node.name,
            effects: provider.effectKinds,
            obligation: descriptor.operationObligations.find(({ operation }) => (
              operation.kind === 'capability'
              && operation.capability === provider.capability
              && operation.operation === node.name
            )) ?? null
          }]
        : []
    )) ?? [];
    if (matches.length !== 1) {
      unresolved.push(node.nodeId);
      continue;
    }
    identities.push(matches[0]);
  }
  const canonical = identities.sort((left, right) => textOrder(JSON.stringify(left), JSON.stringify(right)));
  return Object.freeze({
    digest: digest(canonical),
    count: canonical.length,
    unresolved: Object.freeze(unresolved.sort(textOrder))
  });
}

function placementMetrics(
  graph: RepositoryModuleGraph,
  membership: RepositoryModuleMembership,
  facts: PlacementFacts,
  frontier: readonly RepositoryDeclarationResponsibilityProjection[],
  reassignedOwners: ReadonlyMap<string, string>
): Readonly<{ metrics: RepositoryModulePlacementMetrics; unresolved: readonly string[] }> {
  const virtualMembership: RepositoryModuleMembership = Object.freeze({
    descriptors: membership.descriptors,
    graphRoots: membership.graphRoots,
    moduleRoots: membership.moduleRoots,
    moduleForPath: (path) => {
      const normalized = normalizeRepositoryModulePath(path);
      const ownerId = reassignedOwners.get(normalized);
      return ownerId === undefined
        ? membership.moduleForPath(normalized)
        : membership.descriptors.find(({ moduleId }) => moduleId === ownerId) ?? null;
    }
  });
  const topology = compileRepositoryModuleTopologyProjection(graph, virtualMembership);
  const pureReexports = new Set(facts.files.filter(({ semanticKind }) => semanticKind === 'pure-reexport')
    .map(({ path }) => normalizeRepositoryModulePath(path)));
  const aggregateFacades = new Set(topology.ownerEdges.flatMap(({ witnesses }) => (
    witnesses.flatMap(({ toPath }) => pureReexports.has(toPath) ? [toPath] : [])
  ))).size;
  const lineByPath = new Map(facts.files.map(({ path, sourceLines }) => (
    [normalizeRepositoryModulePath(path), sourceLines] as const
  )));
  const unresolved = new Set<string>();
  let sourceLinesResolved = true;
  let crossOwnerSourceLines = 0;
  for (const edge of topology.ownerEdges) {
    for (const witness of edge.witnesses) {
      const fromLines = lineByPath.get(witness.fromPath);
      const toLines = lineByPath.get(witness.toPath);
      if (fromLines === undefined || toLines === undefined) {
        sourceLinesResolved = false;
        unresolved.add(`source-lines:${fromLines === undefined ? witness.fromPath : witness.toPath}`);
      } else {
        crossOwnerSourceLines += fromLines + toLines;
      }
    }
  }
  const closure = publicOperationClosure(
    virtualMembership,
    frontier,
    (path) => virtualMembership.moduleForPath(path)?.moduleId ?? null
  );
  for (const nodeId of closure.unresolved) unresolved.add(`public-operation:${nodeId}`);
  return Object.freeze({
    metrics: Object.freeze({
      ownerEdges: topology.ownerEdges.length,
      cyclicOwners: new Set(topology.strongComponents.flatMap(({ ownerIds }) => ownerIds)).size,
      reciprocalPairs: topology.reciprocalPairs.length,
      aggregateFacades,
      boundedUnknownDeclarations: frontier.filter(({ status }) => status === 'bounded-unknown').length,
      crossOwnerSourceLines: sourceLinesResolved ? crossOwnerSourceLines : null,
      publicOperationClosureDigest: closure.digest,
      publicOperations: closure.count
    }),
    unresolved: Object.freeze([...unresolved].sort(textOrder))
  });
}

/**
 * Join exact Source Program facts with descriptor intent and report the current
 * responsibility frontier. Prospective relocation is deliberately absent:
 * target placement must be recompiled from a compiler-issued post-placement
 * subject before any migration transaction may be admitted.
 */
export function compileRepositoryModulePlacementAdmission(input: Readonly<{
  readonly graph: RepositoryModuleGraph;
  readonly membership: RepositoryModuleMembership;
  readonly facts: PlacementFacts;
}>): RepositoryModulePlacementAdmission {
  const frontier = compileRepositoryDeclarationResponsibilityFrontier(
    input.membership,
    input.facts
  );
  const current = placementMetrics(
    input.graph,
    input.membership,
    input.facts,
    frontier,
    new Map()
  );
  const violations: RepositoryModuleBoundaryViolation[] = [];
  for (const node of frontier) {
    if (node.status !== 'bounded-unknown') continue;
    const effectful = node.criticality.includes('effect') || node.criticality.includes('authority-mint');
    const publicNode = node.criticality.includes('public');
    if (!effectful && !publicNode) continue;
    violations.push(Object.freeze({
      code: effectful
        ? 'repository-effectful-declaration-responsibility-unresolved'
        : 'repository-public-declaration-responsibility-unresolved',
      from: node.path,
      to: node.moduleId,
      detail: `${node.nodeId} has bounded responsibility evidence; reason=${node.reason}; evidence=${node.evidenceDigest}`
    }));
  }
  const responsibilities = fileResponsibilities(frontier);
  for (const reference of input.graph.references) {
    if (reference.resolvedTarget === null) continue;
    const fromPath = normalizeRepositoryModulePath(reference.from);
    const toPath = normalizeRepositoryModulePath(reference.resolvedTarget);
    const from = responsibilities.get(fromPath);
    const to = responsibilities.get(toPath);
    if (from === undefined || to === undefined || isRepositoryNodeDependencyAllowed(from, to)) continue;
    violations.push(Object.freeze({
      code: 'repository-node-responsibility-reverse-dependency',
      from: fromPath,
      to: toPath,
      detail: `${from} declaration depends on reverse responsibility ${to}`
    }));
  }
  const uniqueViolations = [...new Map(violations.map((violation) => [
    `${violation.code}\0${violation.from}\0${violation.to}\0${violation.detail}`,
    violation
  ] as const)).values()].sort((left, right) => textOrder(
    `${left.code}\0${left.from}\0${left.to}\0${left.detail}`,
    `${right.code}\0${right.from}\0${right.to}\0${right.detail}`
  ));
  const canonical = {
    responsibilityFrontier: frontier,
    current: current.metrics,
    violations: Object.freeze(uniqueViolations)
  };
  return Object.freeze({ ...canonical, admissionDigest: digest(canonical) });
}
