import { compareCodeUnits } from '../../contracts/canonical.ts';
import { FailureError as CompilerError, fail } from '../../contracts/failure.ts';
import type { LoadedSemanticContract, SemanticContract, SemanticContractEntity, SemanticContractImport, SemanticContractResponsibilityBinding } from './types.ts';

type SymbolKind =
  | 'entity'
  | 'responsibility'
  | 'operation'
  | 'event'
  | 'policy'
  | 'permission'
  | 'effect'
  | 'scenario';

interface ContractRegistryEntry {
  loaded: LoadedSemanticContract;
  entities: ReadonlyMap<string, SemanticContractEntity>;
  fieldIdsByEntity: Map<SemanticContractEntity, ReadonlySet<string>>;
  symbols: Readonly<Record<SymbolKind, ReadonlySet<string>>>;
}

function contractOrderKey(entry: LoadedSemanticContract): string {
  return [
    entry.contract.namespace,
    entry.contract.id,
    entry.blockId,
    entry.contractPath
  ].join('\u0000');
}

function contractIdentity(entry: LoadedSemanticContract): string {
  return `${entry.contract.namespace}\u0000${entry.contract.id}`;
}

function exactContractIdentity(entry: LoadedSemanticContract): string {
  return JSON.stringify(entry);
}

function registryEntry(loaded: LoadedSemanticContract): ContractRegistryEntry {
  const contract = loaded.contract;
  return {
    loaded,
    entities: new Map(contract.entities.map((entity) => [entity.id, entity])),
    fieldIdsByEntity: new Map(),
    symbols: {
      entity: new Set(contract.entities.map((entry) => entry.id)),
      responsibility: new Set(contract.responsibilities.map((entry) => entry.id)),
      operation: new Set(contract.operations.map((entry) => entry.id)),
      event: new Set(contract.events.map((entry) => entry.id)),
      policy: new Set(contract.policies.map((entry) => entry.id)),
      permission: new Set(contract.permissions.map((entry) => entry.id)),
      effect: new Set(contract.effects.map((entry) => entry.id)),
      scenario: new Set(contract.scenarios.map((entry) => entry.id))
    }
  };
}

function importedRegistry(
  owner: ContractRegistryEntry,
  registryByIdentity: ReadonlyMap<string, ContractRegistryEntry>
): ReadonlyMap<string, ContractRegistryEntry> {
  const byAlias = new Map<string, ContractRegistryEntry>();
  for (const entry of owner.loaded.contract.imports ?? []) {
    if (byAlias.has(entry.alias)) {
      fail(
        'SEMANTIC-LINK-002',
        `Semantic import alias "${entry.alias}" is ambiguous in contract "${owner.loaded.contract.id}"`,
        { ownerNamespace: owner.loaded.contract.namespace, alias: entry.alias }
      );
    }
    const target = registryByIdentity.get(`${entry.namespace}\u0000${entry.contractId}`);
    if (!target) {
      fail(
        'SEMANTIC-LINK-003',
        `Semantic import "${entry.alias}" cannot resolve ${entry.namespace}::${entry.contractId}`,
        {
          ownerNamespace: owner.loaded.contract.namespace,
          alias: entry.alias,
          targetNamespace: entry.namespace,
          targetContractId: entry.contractId
        }
      );
    }
    if (target === owner) {
      fail(
        'SEMANTIC-LINK-005',
        `Semantic contract "${owner.loaded.contract.id}" cannot import itself as "${entry.alias}"`,
        { ownerNamespace: owner.loaded.contract.namespace, alias: entry.alias }
      );
    }
    byAlias.set(entry.alias, target);
  }
  return byAlias;
}

function referenceParts(reference: string): { qualifier?: string; id: string } {
  const parts = reference.split('::');
  return parts.length === 2
    ? { qualifier: parts[0]!, id: parts[1]! }
    : { id: reference };
}

function targetEntry(
  owner: ContractRegistryEntry,
  imports: ReadonlyMap<string, ContractRegistryEntry>,
  reference: string,
  context: string
): { target: ContractRegistryEntry; id: string } {
  const { qualifier, id } = referenceParts(reference);
  if (!qualifier) return { target: owner, id };
  const target = imports.get(qualifier);
  if (!target) {
    fail(
      'SEMANTIC-LINK-004',
      `${context} uses undeclared semantic import alias "${qualifier}"`,
      { ownerNamespace: owner.loaded.contract.namespace, reference, qualifier }
    );
  }
  return { target, id };
}

function resolveSymbol(
  owner: ContractRegistryEntry,
  imports: ReadonlyMap<string, ContractRegistryEntry>,
  reference: string,
  kind: SymbolKind,
  context: string
): string {
  const { target, id } = targetEntry(owner, imports, reference, context);
  if (!target.symbols[kind].has(id)) {
    fail(
      'SEMANTIC-LINK-004',
      `${context} cannot resolve ${kind} reference "${reference}"`,
      {
        ownerNamespace: owner.loaded.contract.namespace,
        targetNamespace: target.loaded.contract.namespace,
        kind,
        reference
      }
    );
  }
  return `${target.loaded.contract.namespace}::${id}`;
}

function requireLocalOwnershipReference(
  owner: ContractRegistryEntry,
  reference: string,
  context: string
): void {
  if (referenceParts(reference).qualifier) {
    fail(
      'SEMANTIC-LINK-005',
      `${context} cannot claim ownership of cross-contract reference "${reference}"`,
      { ownerNamespace: owner.loaded.contract.namespace, reference }
    );
  }
}

function entityFieldIds(
  owner: ContractRegistryEntry,
  entity: SemanticContractEntity
): ReadonlySet<string> {
  let fields = owner.fieldIdsByEntity.get(entity);
  if (fields === undefined) {
    fields = new Set(entity.fields.map((field) => field.id));
    owner.fieldIdsByEntity.set(entity, fields);
  }
  return fields;
}

function resolveEntityTarget(
  owner: ContractRegistryEntry,
  imports: ReadonlyMap<string, ContractRegistryEntry>,
  reference: string,
  context: string
): string {
  const { target, id } = targetEntry(owner, imports, reference, context);
  const [entityId, fieldId, ...rest] = id.split('.');
  const entity = target.entities.get(entityId ?? '');
  if (!entity || rest.length > 0 || (fieldId && !entityFieldIds(target, entity).has(fieldId))) {
    fail(
      'SEMANTIC-LINK-004',
      `${context} cannot resolve entity target "${reference}"`,
      {
        ownerNamespace: owner.loaded.contract.namespace,
        targetNamespace: target.loaded.contract.namespace,
        reference
      }
    );
  }
  return `${target.loaded.contract.namespace}::${id}`;
}

function canonicalImports(imports: readonly SemanticContractImport[] = []): SemanticContractImport[] {
  return [...imports]
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareCodeUnits(left.alias, right.alias));
}

function linkResponsibilityBinding(
  owner: ContractRegistryEntry,
  imports: ReadonlyMap<string, ContractRegistryEntry>,
  responsibilityId: string,
  binding: SemanticContractResponsibilityBinding
): SemanticContractResponsibilityBinding {
  requireLocalOwnershipReference(
    owner,
    binding.target.id,
    `Responsibility "${responsibilityId}" binding target`
  );
  return {
    target: {
      kind: binding.target.kind,
      id: resolveSymbol(
        owner,
        imports,
        binding.target.id,
        binding.target.kind,
        `Responsibility "${responsibilityId}" binding target`
      )
    },
    declaration: { ...binding.declaration }
  };
}

function linkState(
  owner: ContractRegistryEntry,
  imports: ReadonlyMap<string, ContractRegistryEntry>,
  state: SemanticContract['states'][number]
): SemanticContract['states'][number] {
  const linkedTarget = resolveEntityTarget(
    owner,
    imports,
    `${state.entity}.${state.field}`,
    `State "${state.id}" field`
  );
  const { id: targetId, ...targetReference } = referenceParts(linkedTarget);
  const [entityId, fieldId] = targetId.split('.');
  return {
    ...state,
    entity: `${targetReference.qualifier}::${entityId}`,
    field: fieldId!,
    owner: resolveSymbol(owner, imports, state.owner, 'responsibility', `State "${state.id}" owner`),
    transitions: state.transitions.map((transition) => ({
      ...transition,
      by: resolveSymbol(owner, imports, transition.by, 'operation', `State "${state.id}" transition`)
    }))
  };
}

function linkContract(
  owner: ContractRegistryEntry,
  imports: ReadonlyMap<string, ContractRegistryEntry>,
  verificationPolicyIds: ReadonlySet<string>
): LoadedSemanticContract {
  const contract = owner.loaded.contract;
  const linked: SemanticContract = {
    ...contract,
    imports: canonicalImports(contract.imports),
    states: contract.states.map((state) => linkState(owner, imports, state)),
    responsibilities: contract.responsibilities.map((responsibility) => {
      for (const reference of responsibility.implements) {
        requireLocalOwnershipReference(owner, reference, `Responsibility "${responsibility.id}" implements`);
      }
      return {
        ...responsibility,
        bindings: (responsibility.bindings ?? []).map((binding) =>
          linkResponsibilityBinding(owner, imports, responsibility.id, binding)),
        owns: responsibility.owns.map((reference) => resolveEntityTarget(owner, imports, reference, `Responsibility "${responsibility.id}" owns`)),
        implements: responsibility.implements.map((reference) => resolveSymbol(owner, imports, reference, 'operation', `Responsibility "${responsibility.id}" implements`)),
        dependsOn: responsibility.dependsOn.map((reference) => resolveSymbol(owner, imports, reference, 'responsibility', `Responsibility "${responsibility.id}" dependsOn`))
      };
    }),
    operations: contract.operations.map((operation) => {
      requireLocalOwnershipReference(owner, operation.responsibility, `Operation "${operation.id}" responsibility`);
      return {
      ...operation,
      responsibility: resolveSymbol(owner, imports, operation.responsibility, 'responsibility', `Operation "${operation.id}" responsibility`),
      reads: operation.reads.map((reference) => resolveEntityTarget(owner, imports, reference, `Operation "${operation.id}" reads`)),
      writes: operation.writes.map((reference) => resolveEntityTarget(owner, imports, reference, `Operation "${operation.id}" writes`)),
      mutates: operation.mutates.map((reference) => resolveEntityTarget(owner, imports, reference, `Operation "${operation.id}" mutates`)),
      requiresPolicies: operation.requiresPolicies.map((reference) => resolveSymbol(owner, imports, reference, 'policy', `Operation "${operation.id}" requiresPolicies`)),
      requiresPermissions: operation.requiresPermissions.map((reference) => resolveSymbol(owner, imports, reference, 'permission', `Operation "${operation.id}" requiresPermissions`)),
      performsEffects: operation.performsEffects.map((reference) => resolveSymbol(owner, imports, reference, 'effect', `Operation "${operation.id}" performsEffects`)),
      emits: operation.emits.map((reference) => resolveSymbol(owner, imports, reference, 'event', `Operation "${operation.id}" emits`)),
      invokes: operation.invokes.map((reference) => resolveSymbol(owner, imports, reference, 'operation', `Operation "${operation.id}" invokes`)),
      awaits: operation.awaits.map((reference) => resolveSymbol(owner, imports, reference, 'operation', `Operation "${operation.id}" awaits`))
      };
    }),
    policies: contract.policies.map((policy) => ({
      ...policy,
      verifiedBy: (policy.verifiedBy ?? []).map((verificationPolicyId) => {
        if (!verificationPolicyIds.has(verificationPolicyId)) {
          fail(
            'SEMANTIC-LINK-006',
            `Semantic policy "${contract.namespace}::${policy.id}" references unknown verification policy "${verificationPolicyId}"`,
            { semanticPolicyId: policy.id, namespace: contract.namespace, verificationPolicyId }
          );
        }
        return verificationPolicyId;
      })
    })),
    scenarios: contract.scenarios.map((scenario) => ({
      ...scenario,
      entry: resolveSymbol(owner, imports, scenario.entry, 'operation', `Scenario "${scenario.id}" entry`),
      steps: scenario.steps.map((step) => ({
        ...step,
        operation: resolveSymbol(owner, imports, step.operation, 'operation', `Scenario "${scenario.id}" step "${step.id}"`)
      }))
    }))
  };
  return { ...owner.loaded, contract: linked };
}

export function linkWorkspaceSemanticContracts(
  contracts: readonly LoadedSemanticContract[],
  verificationPolicyIds: readonly string[]
): LoadedSemanticContract[] {
  const registryByNamespace = new Map<string, ContractRegistryEntry>();
  const registryByIdentity = new Map<string, ContractRegistryEntry>();
  const ordered = [...contracts].sort((left, right) => compareCodeUnits(contractOrderKey(left), contractOrderKey(right)));

  for (const loaded of ordered) {
    const existing = registryByNamespace.get(loaded.contract.namespace);
    if (existing) {
      if (exactContractIdentity(existing.loaded) === exactContractIdentity(loaded)) continue;
      fail(
        'SEMANTIC-LINK-001',
        `Semantic namespace "${loaded.contract.namespace}" is owned by distinct contracts`,
        {
          namespace: loaded.contract.namespace,
          existingContract: existing.loaded.contract.id,
          incomingContract: loaded.contract.id,
          existingBlockId: existing.loaded.blockId,
          incomingBlockId: loaded.blockId
        }
      );
    }
    const entry = registryEntry(loaded);
    registryByNamespace.set(loaded.contract.namespace, entry);
    registryByIdentity.set(contractIdentity(loaded), entry);
  }

  const policyIds = new Set(verificationPolicyIds);
  return [...registryByNamespace.values()]
    .sort((left, right) => compareCodeUnits(contractOrderKey(left.loaded), contractOrderKey(right.loaded)))
    .map((owner) => linkContract(owner, importedRegistry(owner, registryByIdentity), policyIds));
}

export function splitLinkedSemanticReference(reference: string): { namespace: string; id: string } {
  const [namespace, id, ...rest] = reference.split('::');
  if (!namespace || !id || rest.length > 0) {
    throw new CompilerError(
      'SEMANTIC-LINK-007',
      `Linked semantic reference "${reference}" is not canonical`
    );
  }
  return { namespace, id };
}
