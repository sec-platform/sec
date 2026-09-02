import { createHash } from 'node:crypto';

import {
  compileSecRepositoryModuleTopologyProjection,
  isSecRepositoryNodeDependencyAllowed,
  normalizeSecRepositoryPath,
  type SecModuleOperationIdentity,
  type SecRepositoryModuleBoundaryViolation,
  type SecRepositoryModuleGraph,
  type SecRepositoryModuleMembership,
  type SecRepositoryModuleSourceProgramFacts,
  type SecRepositoryNodeResponsibility
} from './contract.ts';

type Sha256 = `sha256:${string}`;

export type SecRepositoryDeclarationResponsibilityReason =
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

export type SecRepositoryDeclarationResponsibilityProjection = Readonly<{
  readonly nodeId: string;
  readonly declarationDigest: string;
  readonly path: string;
  readonly moduleId: string;
  readonly name: string;
  readonly exported: boolean;
  readonly status: 'bounded-unknown' | 'resolved';
  readonly responsibility: SecRepositoryNodeResponsibility | null;
  readonly reason: SecRepositoryDeclarationResponsibilityReason;
  readonly criticality: readonly ('authority-mint' | 'effect' | 'public')[];
  readonly evidenceDigest: Sha256;
}>;

export type SecRepositoryModulePlacementProposal = Readonly<{
  readonly proposalId: string;
  /** Exact compiler-issued declaration observation ids; paths are not proposal authority. */
  readonly sourceNodeIds: readonly string[];
  readonly targetOwnerId: string;
  readonly targetObligation: Readonly<{
    readonly ownerId: string;
    readonly operation: SecModuleOperationIdentity;
  }>;
}>;

export type SecRepositoryModulePlacementMetrics = Readonly<{
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

export type SecRepositoryModuleRelocationAtom = Readonly<{
  readonly atomId: Sha256;
  readonly sourceOwnerId: string;
  readonly sourceNodeIds: readonly string[];
  readonly sourcePaths: readonly string[];
  readonly target: Readonly<{
    readonly ownerId: string;
    readonly obligationDigest: Sha256;
    readonly operation: SecModuleOperationIdentity;
  }>;
}>;

export type SecRepositoryModulePlacementDecision = Readonly<{
  readonly proposalId: string;
  readonly status: 'accepted' | 'bounded-unknown' | 'dominated';
  readonly reasons: readonly string[];
  readonly before: SecRepositoryModulePlacementMetrics;
  readonly after: SecRepositoryModulePlacementMetrics | null;
  readonly relocationAtoms: readonly SecRepositoryModuleRelocationAtom[];
  readonly decisionDigest: Sha256;
}>;

export type SecRepositoryModulePlacementAdmission = Readonly<{
  readonly responsibilityFrontier: readonly SecRepositoryDeclarationResponsibilityProjection[];
  readonly current: SecRepositoryModulePlacementMetrics;
  readonly proposals: readonly SecRepositoryModulePlacementDecision[];
  readonly violations: readonly SecRepositoryModuleBoundaryViolation[];
  readonly admissionDigest: Sha256;
}>;

type PlacementFacts = Omit<SecRepositoryModuleSourceProgramFacts, 'files'> & Readonly<{
  readonly files: readonly (SecRepositoryModuleSourceProgramFacts['files'][number] & Readonly<{
    readonly sourceLines?: number;
  }>)[];
}>;

type ResponsibilityCandidate = Readonly<{
  responsibility: SecRepositoryNodeResponsibility;
  reason: SecRepositoryDeclarationResponsibilityReason;
  evidence: unknown;
}>;

function digest(value: unknown): Sha256 {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function textOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function operationIdentityKey(operation: SecModuleOperationIdentity): string {
  return operation.kind === 'capability'
    ? `capability\0${operation.capability}\0${operation.operation}`
    : `entrypoint\0${operation.path}`;
}

function relationResponsibility(
  relation: string,
  operation: unknown
): SecRepositoryNodeResponsibility {
  if (operation !== null) return 'operation';
  if (relation === 'declares') return 'contract';
  if (relation === 'writes' || relation === 'executes' || relation === 'settles'
      || relation === 'reads-back' || relation === 'recovers' || relation === 'migrates'
      || relation === 'retires') return 'operation';
  return 'computation';
}

function semanticTargetResponsibility(kind: string): SecRepositoryNodeResponsibility {
  if (kind === 'entity') return 'contract';
  if (kind === 'effect') return 'capability';
  if (kind === 'operation') return 'operation';
  return 'workflow';
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
function compileSecRepositoryDeclarationResponsibilityFrontier(
  membership: SecRepositoryModuleMembership,
  facts: PlacementFacts
): readonly SecRepositoryDeclarationResponsibilityProjection[] {
  const productionPaths = new Set(facts.files
    .filter(({ surface }) => surface === 'production')
    .map(({ path }) => normalizeSecRepositoryPath(path)));
  const declarations = [...(facts.declarations ?? [])]
    .map((declaration) => ({ ...declaration, path: normalizeSecRepositoryPath(declaration.path) }))
    .filter(({ path }) => productionPaths.has(path))
    .sort((left, right) => textOrder(left.path, right.path)
      || textOrder(left.observationId ?? '', right.observationId ?? ''));
  const declarationsByPath = new Map<string, typeof declarations>();
  for (const declaration of declarations) {
    const values = declarationsByPath.get(declaration.path) ?? [];
    values.push(declaration);
    declarationsByPath.set(declaration.path, values);
  }
  const fileFacts = new Map(facts.files.map((file) => (
    [normalizeSecRepositoryPath(file.path), file] as const
  )));
  const declarationIdentityCounts = new Map<string, number>();
  for (const declaration of declarations) {
    const identity = declaration.observationId ?? '';
    declarationIdentityCounts.set(identity, (declarationIdentityCounts.get(identity) ?? 0) + 1);
  }
  const unknownPaths = new Set<string>();
  for (const file of facts.files) {
    if (file.semanticObservationClass === 'unknown') {
      unknownPaths.add(normalizeSecRepositoryPath(file.path));
    }
  }

  return Object.freeze(declarations.map((declaration) => {
    const owner = membership.moduleForPath(declaration.path);
    const candidates: ResponsibilityCandidate[] = [];
    const criticality = new Set<'authority-mint' | 'effect' | 'public'>();
    const crossOwnerConsumers = (facts.references ?? []).filter((reference) => (
      reference.targetObservationId === declaration.observationId
      && reference.observationClass !== 'unknown'
      && membership.moduleForPath(normalizeSecRepositoryPath(reference.path))?.moduleId !== owner?.moduleId
    ));
    if (declaration.exported && crossOwnerConsumers.length > 0) criticality.add('public');

    const exactSemanticEvidence = (facts.responsibilityEvidence ?? []).filter((evidence) => (
      evidence.observationClass === 'observed'
      && evidence.reason === 'validated'
      && evidence.sourceRevision === facts.sourceRevision
      && evidence.semanticRevision === facts.semanticRevision
      && evidence.declaration.path === declaration.path
      && evidence.declaration.exportName === declaration.name
      && evidence.declaration.observationId === declaration.observationId
      && evidence.declaration.declarationDigest === declaration.declarationDigest
      && evidence.declaration.moduleId === owner?.moduleId
    ));
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
      if (normalizeSecRepositoryPath(relation.symbol.path) !== declaration.path
          || relation.symbol.name !== declaration.name) continue;
      candidates.push(Object.freeze({
        responsibility: relationResponsibility(relation.relation, relation.operation),
        reason: 'descriptor-causal-relation',
        evidence: relation
      }));
    }

    const capabilityFacts = (facts.capabilities ?? []).filter((capability) => (
      capability.surface === 'production'
      && capability.owningDeclarationObservationId === declaration.observationId
    ));
    if (capabilityFacts.length > 0) criticality.add('effect');

    const entrypointFacts = facts.entrypoints.filter((entrypoint) => (
      entrypoint.observationClass !== 'unknown'
      && (entrypoint.targetPaths ?? []).some((path) => normalizeSecRepositoryPath(path) === declaration.path)
    ));
    if (entrypointFacts.length > 0) criticality.add('public');
    const declarationsAtPath = declarationsByPath.get(declaration.path) ?? [];
    if (entrypointFacts.length > 0 && declaration.exported
        && declarationsAtPath.filter(({ exported }) => exported).length === 1) {
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
    } else if (!declaration.exported && capabilityFacts.length === 0
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
    const reason: SecRepositoryDeclarationResponsibilityReason = resolved
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
  frontier: readonly SecRepositoryDeclarationResponsibilityProjection[]
): ReadonlyMap<string, SecRepositoryNodeResponsibility> {
  const candidates = new Map<string, SecRepositoryNodeResponsibility[]>();
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
  membership: SecRepositoryModuleMembership,
  frontier: readonly SecRepositoryDeclarationResponsibilityProjection[],
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
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership,
  facts: PlacementFacts,
  frontier: readonly SecRepositoryDeclarationResponsibilityProjection[],
  reassignedOwners: ReadonlyMap<string, string>
): Readonly<{ metrics: SecRepositoryModulePlacementMetrics; unresolved: readonly string[] }> {
  const virtualMembership: SecRepositoryModuleMembership = Object.freeze({
    descriptors: membership.descriptors,
    graphRoots: membership.graphRoots,
    moduleRoots: membership.moduleRoots,
    moduleForPath: (path) => {
      const normalized = normalizeSecRepositoryPath(path);
      const ownerId = reassignedOwners.get(normalized);
      return ownerId === undefined
        ? membership.moduleForPath(normalized)
        : membership.descriptors.find(({ moduleId }) => moduleId === ownerId) ?? null;
    }
  });
  const topology = compileSecRepositoryModuleTopologyProjection(graph, virtualMembership);
  const pureReexports = new Set(facts.files.filter(({ semanticKind }) => semanticKind === 'pure-reexport')
    .map(({ path }) => normalizeSecRepositoryPath(path)));
  const aggregateFacades = new Set(topology.ownerEdges.flatMap(({ witnesses }) => (
    witnesses.flatMap(({ toPath }) => pureReexports.has(toPath) ? [toPath] : [])
  ))).size;
  const lineByPath = new Map(facts.files.map(({ path, sourceLines }) => (
    [normalizeSecRepositoryPath(path), sourceLines] as const
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

function isDominated(
  before: SecRepositoryModulePlacementMetrics,
  after: SecRepositoryModulePlacementMetrics
): boolean {
  if (before.publicOperationClosureDigest !== after.publicOperationClosureDigest
      || before.publicOperations !== after.publicOperations
      || before.crossOwnerSourceLines === null || after.crossOwnerSourceLines === null) return false;
  const beforeCosts = [before.ownerEdges, before.cyclicOwners, before.reciprocalPairs,
    before.aggregateFacades, before.boundedUnknownDeclarations, before.crossOwnerSourceLines];
  const afterCosts = [after.ownerEdges, after.cyclicOwners, after.reciprocalPairs,
    after.aggregateFacades, after.boundedUnknownDeclarations, after.crossOwnerSourceLines];
  return afterCosts.every((value, index) => value >= beforeCosts[index]!)
    && afterCosts.some((value, index) => value > beforeCosts[index]!);
}

function isStrictImprovement(
  before: SecRepositoryModulePlacementMetrics,
  after: SecRepositoryModulePlacementMetrics
): boolean {
  if (before.publicOperationClosureDigest !== after.publicOperationClosureDigest
      || before.publicOperations !== after.publicOperations
      || before.crossOwnerSourceLines === null || after.crossOwnerSourceLines === null) return false;
  const beforeCosts = [before.ownerEdges, before.cyclicOwners, before.reciprocalPairs,
    before.aggregateFacades, before.boundedUnknownDeclarations, before.crossOwnerSourceLines];
  const afterCosts = [after.ownerEdges, after.cyclicOwners, after.reciprocalPairs,
    after.aggregateFacades, after.boundedUnknownDeclarations, after.crossOwnerSourceLines];
  return afterCosts.every((value, index) => value <= beforeCosts[index]!)
    && afterCosts.some((value, index) => value < beforeCosts[index]!);
}

function exactObligation(
  membership: SecRepositoryModuleMembership,
  proposal: SecRepositoryModulePlacementProposal
) {
  const descriptor = membership.descriptors.find(({ moduleId }) => (
    moduleId === proposal.targetObligation.ownerId
  ));
  const key = operationIdentityKey(proposal.targetObligation.operation);
  const matches = descriptor?.operationObligations.filter(({ operation }) => (
    operationIdentityKey(operation) === key
  )) ?? [];
  return matches.length === 1 ? matches[0]! : null;
}

function compilePlacementDecision(
  graph: SecRepositoryModuleGraph,
  membership: SecRepositoryModuleMembership,
  facts: PlacementFacts,
  frontier: readonly SecRepositoryDeclarationResponsibilityProjection[],
  before: Readonly<{ metrics: SecRepositoryModulePlacementMetrics; unresolved: readonly string[] }>,
  proposal: SecRepositoryModulePlacementProposal,
  duplicateProposalId: boolean
): SecRepositoryModulePlacementDecision {
  const reasons = new Set<string>();
  if (!/^[a-z][a-z0-9.-]{1,127}$/u.test(proposal.proposalId)) reasons.add('proposal-id-invalid');
  if (duplicateProposalId) reasons.add('proposal-id-duplicate');
  for (const unresolved of before.unresolved) reasons.add(`current-${unresolved}`);
  if (proposal.sourceNodeIds.length === 0
      || new Set(proposal.sourceNodeIds).size !== proposal.sourceNodeIds.length) {
    reasons.add('source-node-set-invalid');
  }
  if (proposal.targetOwnerId !== proposal.targetObligation.ownerId) {
    reasons.add('target-obligation-owner-mismatch');
  }
  const targetOwner = membership.descriptors.find(({ moduleId }) => moduleId === proposal.targetOwnerId);
  if (targetOwner === undefined) reasons.add('target-owner-unresolved');
  const obligation = exactObligation(membership, proposal);
  if (obligation === null) reasons.add('target-obligation-unresolved');
  const frontierById = new Map(frontier.map((node) => [node.nodeId, node] as const));
  const selected = proposal.sourceNodeIds.flatMap((nodeId) => {
    const node = frontierById.get(nodeId);
    if (node === undefined) {
      reasons.add(`source-node-unresolved:${nodeId}`);
      return [];
    }
    if (node.status !== 'resolved') reasons.add(`source-node-responsibility-unresolved:${nodeId}`);
    return [node];
  });
  const sourceOwners = [...new Set(selected.map(({ moduleId }) => moduleId))];
  if (sourceOwners.length !== 1) reasons.add('source-owner-not-unique');
  if (sourceOwners[0] === proposal.targetOwnerId) reasons.add('target-owner-unchanged');
  const selectedIds = new Set(selected.map(({ nodeId }) => nodeId));
  const selectedPaths = [...new Set(selected.map(({ path }) => path))].sort(textOrder);
  for (const sourcePath of selectedPaths) {
    const allPathNodes = frontier.filter(({ path }) => path === sourcePath);
    if (allPathNodes.length === 0 || allPathNodes.some(({ nodeId }) => !selectedIds.has(nodeId))) {
      reasons.add(`partial-file-relocation:${sourcePath}`);
    }
  }
  if (obligation !== null) {
    const binds = selected.some((node) => obligation.operation.kind === 'capability'
      ? obligation.operation.operation === node.name
      : obligation.operation.path === node.path);
    if (!binds) reasons.add('target-obligation-does-not-bind-source');
  }
  const reassignedOwners = new Map(selectedPaths.map((sourcePath) => (
    [sourcePath, proposal.targetOwnerId] as const
  )));
  const after = reasons.size === 0
    ? placementMetrics(graph, membership, facts, frontier, reassignedOwners)
    : null;
  if (after !== null) {
    for (const unresolved of after.unresolved) reasons.add(unresolved);
    if (after.metrics.publicOperationClosureDigest !== before.metrics.publicOperationClosureDigest
        || after.metrics.publicOperations !== before.metrics.publicOperations) {
      reasons.add('public-operation-closure-changed');
    }
  }
  const dominated = reasons.size === 0 && after !== null && isDominated(before.metrics, after.metrics);
  if (dominated) reasons.add('lifecycle-cost-dominated');
  const strictImprovement = reasons.size === 0 && after !== null
    && isStrictImprovement(before.metrics, after.metrics);
  if (!dominated && reasons.size === 0 && !strictImprovement) {
    reasons.add('lifecycle-cost-not-strictly-improving');
  }
  const status = reasons.size === 0
    ? 'accepted' as const
    : dominated
      ? 'dominated' as const
      : 'bounded-unknown' as const;
  const relocationAtoms = status === 'accepted' && obligation !== null
    ? [Object.freeze({
        atomId: digest({
          proposalId: proposal.proposalId,
          sourceNodeIds: [...proposal.sourceNodeIds].sort(textOrder),
          targetOwnerId: proposal.targetOwnerId,
          obligation: digest(obligation)
        }),
        sourceOwnerId: sourceOwners[0]!,
        sourceNodeIds: Object.freeze([...proposal.sourceNodeIds].sort(textOrder)),
        sourcePaths: Object.freeze(selectedPaths),
        target: Object.freeze({
          ownerId: proposal.targetOwnerId,
          obligationDigest: digest(obligation),
          operation: obligation.operation
        })
      })]
    : [];
  const canonicalReasons = Object.freeze([...reasons].sort(textOrder));
  const decision = {
    proposalId: proposal.proposalId,
    status,
    reasons: canonicalReasons,
    before: before.metrics,
    after: after?.metrics ?? null,
    relocationAtoms: Object.freeze(relocationAtoms)
  };
  return Object.freeze({ ...decision, decisionDigest: digest(decision) });
}

/**
 * Evaluate placement proposals against the same compiled graph. This function
 * never reads source, invents a target path, or treats a proposal as Effect
 * authority. Accepted atoms are inputs for a separate generation transaction.
 */
export function compileSecRepositoryModulePlacementAdmission(input: Readonly<{
  readonly graph: SecRepositoryModuleGraph;
  readonly membership: SecRepositoryModuleMembership;
  readonly facts: PlacementFacts;
  readonly proposals?: readonly SecRepositoryModulePlacementProposal[];
}>): SecRepositoryModulePlacementAdmission {
  const frontier = compileSecRepositoryDeclarationResponsibilityFrontier(
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
  const proposalIds = new Map<string, number>();
  for (const proposal of input.proposals ?? []) {
    proposalIds.set(proposal.proposalId, (proposalIds.get(proposal.proposalId) ?? 0) + 1);
  }
  const proposals = Object.freeze([...(input.proposals ?? [])]
    .sort((left, right) => textOrder(left.proposalId, right.proposalId))
    .map((proposal) => compilePlacementDecision(
      input.graph,
      input.membership,
      input.facts,
      frontier,
      current,
      proposal,
      proposalIds.get(proposal.proposalId) !== 1
    )));
  const violations: SecRepositoryModuleBoundaryViolation[] = [];
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
    const fromPath = normalizeSecRepositoryPath(reference.from);
    const toPath = normalizeSecRepositoryPath(reference.resolvedTarget);
    const from = responsibilities.get(fromPath);
    const to = responsibilities.get(toPath);
    if (from === undefined || to === undefined || isSecRepositoryNodeDependencyAllowed(from, to)) continue;
    violations.push(Object.freeze({
      code: 'repository-node-responsibility-reverse-dependency',
      from: fromPath,
      to: toPath,
      detail: `${from} declaration depends on reverse responsibility ${to}`
    }));
  }
  for (const proposal of proposals) {
    if (proposal.status === 'accepted') continue;
    violations.push(Object.freeze({
      code: proposal.status === 'dominated'
        ? 'repository-placement-proposal-dominated'
        : 'repository-placement-proposal-unresolved',
      from: proposal.proposalId,
      to: '<prospective-placement>',
      detail: proposal.reasons.join(', ')
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
    proposals,
    violations: Object.freeze(uniqueViolations)
  };
  return Object.freeze({ ...canonical, admissionDigest: digest(canonical) });
}
