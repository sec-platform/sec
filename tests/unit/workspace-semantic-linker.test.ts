import { expect, test } from 'bun:test';

import {
  buildEngineeringIR,
  type BuildEngineeringIRInput,
  linkWorkspaceSemanticContracts,
  normalizeSemanticContract
} from '../../platform/compiler/index.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import type {
  LoadedSemanticContract,
  SemanticContract
} from '../../platform/shared/semantic-contract-types.ts';

function contract(
  blockId: string,
  contractPath: string,
  definition: SemanticContract
): LoadedSemanticContract {
  return { blockId, contractPath, contract: definition };
}

function providerContract(): LoadedSemanticContract {
  return contract('tenant/basic', 'registry/tenant.basic/contracts/tenant.yaml', {
    formatVersion: '1',
    id: 'tenant-core',
    namespace: 'tenant',
    imports: [],
    entities: [{
      id: 'TenantContext',
      fields: [{ id: 'tenantId', type: 'string', required: true }]
    }],
    states: [],
    responsibilities: [{
      id: 'TenantScopeGuard',
      role: 'Own tenant scope enforcement',
      owns: ['TenantContext.tenantId'],
      implements: ['enforceTenantScope'],
      dependsOn: []
    }],
    operations: [{
      id: 'enforceTenantScope',
      responsibility: 'TenantScopeGuard',
      inputs: [],
      reads: ['TenantContext.tenantId'],
      writes: [],
      mutates: [],
      requiresPolicies: ['tenant-access'],
      requiresPermissions: [],
      performsEffects: [],
      emits: [],
      invokes: [],
      awaits: []
    }],
    events: [],
    policies: [{
      id: 'tenant-access',
      rule: 'tenant_context_must_flow_to_query',
      verifiedBy: ['tenant-scope-required']
    }],
    permissions: [],
    effects: [],
    scenarios: []
  });
}

function consumerContract(): LoadedSemanticContract {
  return contract('ticket/basic', 'registry/ticket.basic/contracts/ticket.yaml', {
    formatVersion: '1',
    id: 'ticket-core',
    namespace: 'ticket',
    imports: [{ alias: 'tenant', namespace: 'tenant', contractId: 'tenant-core' }],
    entities: [{
      id: 'Ticket',
      fields: [{ id: 'tenantId', type: 'string', required: true }]
    }],
    states: [],
    responsibilities: [{
      id: 'TicketQuery',
      role: 'List tenant tickets',
      owns: ['Ticket'],
      implements: ['listTickets'],
      dependsOn: ['tenant::TenantScopeGuard']
    }],
    operations: [{
      id: 'listTickets',
      responsibility: 'TicketQuery',
      inputs: [],
      reads: ['Ticket.tenantId', 'tenant::TenantContext.tenantId'],
      writes: [],
      mutates: [],
      requiresPolicies: ['tenant::tenant-access'],
      requiresPermissions: [],
      performsEffects: [],
      emits: [],
      invokes: ['tenant::enforceTenantScope'],
      awaits: []
    }],
    events: [],
    policies: [],
    permissions: [],
    effects: [],
    scenarios: []
  });
}

function input(semanticContracts = [providerContract(), consumerContract()]): BuildEngineeringIRInput {
  return {
    app: { id: 'semantic-linker', name: 'Semantic Linker' },
    resolvedBlocks: semanticContracts.map((entry, installOrder) => ({
      id: entry.blockId,
      version: '0.1.0',
      kind: 'capability',
      installOrder,
      manifestPath: `registry/${entry.blockId}/block.manifest.yaml`,
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry'
    })),
    manifests: [],
    slotTasks: [],
    acceptanceIds: [],
    policyDeclarations: [{
      id: 'tenant-scope-required',
      severity: 'error',
      appliesTo: ['ticket/basic'],
      rule: 'tenant_context_must_flow_to_query'
    }],
    semanticContracts
  };
}

function expectCompilerError(run: () => unknown, code: string): CompilerError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return error as CompilerError;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

test('explicit imports link cross-Block responsibility, data, operation, and policy Facts', () => {
  const ir = buildEngineeringIR(input());

  expect(ir.facts).toEqual(expect.arrayContaining([
    expect.objectContaining({
      subject: 'responsibility:ticket:TicketQuery',
      predicate: 'DEPENDS_ON',
      object: { kind: 'entity', entityId: 'responsibility:tenant:TenantScopeGuard' }
    }),
    expect.objectContaining({
      subject: 'operation:ticket:listTickets',
      predicate: 'READS',
      object: { kind: 'entity', entityId: 'field:tenant:TenantContext.tenantId' }
    }),
    expect.objectContaining({
      subject: 'operation:ticket:listTickets',
      predicate: 'INVOKES',
      object: { kind: 'entity', entityId: 'operation:tenant:enforceTenantScope' }
    }),
    expect.objectContaining({
      subject: 'policy:tenant-scope-required',
      predicate: 'ENFORCES',
      object: { kind: 'entity', entityId: 'policy:tenant:tenant-access' }
    }),
    expect.objectContaining({
      subject: 'policy:tenant:tenant-access',
      predicate: 'VERIFIED_BY',
      object: { kind: 'entity', entityId: 'policy:tenant-scope-required' }
    })
  ]));
});

test('workspace linking is deterministic across contract enumeration order', () => {
  const first = buildEngineeringIR(input());
  const second = buildEngineeringIR(input([consumerContract(), providerContract()]));

  expect(second.entities).toEqual(first.entities);
  expect(second.facts).toEqual(first.facts);
  expect(second.semanticRevision).toBe(first.semanticRevision);
  expect(second.inputRevision).toBe(first.inputRevision);
});

test('exact duplicate contracts are idempotent and import declaration order is canonical', () => {
  const provider = providerContract();
  const consumer = consumerContract();
  consumer.contract.imports!.push({
    alias: 'tenantAlternate',
    namespace: 'tenant',
    contractId: 'tenant-core'
  });
  const reorderedConsumer = structuredClone(consumer);
  reorderedConsumer.contract.imports!.reverse();

  const baseline = buildEngineeringIR(input([provider, consumer]));
  const duplicatedInput = input([structuredClone(reorderedConsumer), structuredClone(provider)]);
  duplicatedInput.semanticContracts = [
    structuredClone(reorderedConsumer),
    structuredClone(provider),
    structuredClone(provider)
  ];
  const duplicated = buildEngineeringIR(duplicatedInput);

  expect(duplicated.entities).toEqual(baseline.entities);
  expect(duplicated.facts).toEqual(baseline.facts);
  expect(duplicated.semanticRevision).toBe(baseline.semanticRevision);
  expect(duplicated.inputRevision).toBe(baseline.inputRevision);
});

test('state entity and field references link across an explicit import', () => {
  const consumer = consumerContract();
  consumer.contract.states = [{
    id: 'tenant-binding',
    entity: 'tenant::TenantContext',
    field: 'tenantId',
    owner: 'TicketQuery',
    values: ['bound'],
    transitions: []
  }];

  const linked = linkWorkspaceSemanticContracts([providerContract(), consumer], [
    'tenant-scope-required'
  ]);
  const state = linked.find((entry) => entry.contract.namespace === 'ticket')?.contract.states[0];

  expect(state?.entity).toBe('tenant::TenantContext');
  expect(state?.field).toBe('tenantId');
  expect(state?.owner).toBe('ticket::TicketQuery');
});

test('same-name Semantic and Verification Policies do not link without verifiedBy', () => {
  const provider = providerContract();
  provider.contract.policies[0] = {
    id: 'tenant-scope-required',
    rule: 'semantic policy with the same display identity'
  };
  provider.contract.operations[0]!.requiresPolicies = ['tenant-scope-required'];
  const consumer = consumerContract();
  consumer.contract.operations[0]!.requiresPolicies = ['tenant::tenant-scope-required'];
  const ir = buildEngineeringIR(input([provider, consumer]));

  expect(ir.facts.some((fact) =>
    (fact.predicate === 'ENFORCES' || fact.predicate === 'VERIFIED_BY') &&
    fact.subject.includes('tenant-scope-required')
  )).toBe(false);
});

test('linker emits deterministic diagnostics for namespace, import, reference, and policy failures', () => {
  const duplicateNamespace = consumerContract();
  duplicateNamespace.contract.namespace = 'tenant';
  const duplicateDiagnostic = expectCompilerError(
    () => buildEngineeringIR(input([providerContract(), duplicateNamespace])),
    'SEMANTIC-LINK-001'
  );
  const reversedDuplicateDiagnostic = expectCompilerError(
    () => buildEngineeringIR(input([duplicateNamespace, providerContract()])),
    'SEMANTIC-LINK-001'
  );
  expect({
    message: reversedDuplicateDiagnostic.message,
    details: reversedDuplicateDiagnostic.details
  }).toEqual({
    message: duplicateDiagnostic.message,
    details: duplicateDiagnostic.details
  });

  const ambiguousAlias = consumerContract();
  ambiguousAlias.contract.imports!.push({ alias: 'tenant', namespace: 'tenant', contractId: 'tenant-core' });
  expectCompilerError(
    () => buildEngineeringIR(input([providerContract(), ambiguousAlias])),
    'SEMANTIC-LINK-002'
  );

  const unresolvedImport = consumerContract();
  unresolvedImport.contract.imports![0]!.contractId = 'missing-contract';
  expectCompilerError(
    () => buildEngineeringIR(input([providerContract(), unresolvedImport])),
    'SEMANTIC-LINK-003'
  );

  const unresolvedReference = consumerContract();
  unresolvedReference.contract.responsibilities[0]!.dependsOn = ['tenant::MissingResponsibility'];
  expectCompilerError(
    () => buildEngineeringIR(input([providerContract(), unresolvedReference])),
    'SEMANTIC-LINK-004'
  );

  const selfImport = providerContract();
  selfImport.contract.imports = [{ alias: 'self', namespace: 'tenant', contractId: 'tenant-core' }];
  expectCompilerError(
    () => buildEngineeringIR(input([selfImport, consumerContract()])),
    'SEMANTIC-LINK-005'
  );

  const crossOwner = consumerContract();
  crossOwner.contract.responsibilities[0]!.implements = ['tenant::enforceTenantScope'];
  expectCompilerError(
    () => buildEngineeringIR(input([providerContract(), crossOwner])),
    'SEMANTIC-LINK-005'
  );

  const qualifiedOperationOwner = consumerContract();
  qualifiedOperationOwner.contract.operations[0]!.responsibility = 'tenant::TenantScopeGuard';
  qualifiedOperationOwner.contract = normalizeSemanticContract(qualifiedOperationOwner.contract);
  expectCompilerError(
    () => buildEngineeringIR(input([providerContract(), qualifiedOperationOwner])),
    'SEMANTIC-LINK-005'
  );

  const missingVerificationPolicy = providerContract();
  missingVerificationPolicy.contract.policies[0]!.verifiedBy = ['missing-verification-policy'];
  expectCompilerError(
    () => buildEngineeringIR(input([missingVerificationPolicy, consumerContract()])),
    'SEMANTIC-LINK-006'
  );
});
