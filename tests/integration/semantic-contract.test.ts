import { expect, test } from 'bun:test';

import { loadManifestById } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { loadSemanticContractsForManifestEntry } from '../../src/adapters/workspace/sources/load-semantic-contract.ts';
import { CompilerError } from '../../src/compiler/errors.ts';
import { normalizeSemanticContract } from '../../src/semantics/definitions/normalize.ts';
import type { SemanticContract } from '../../src/semantics/definitions/types.ts';

function minimalContract(): SemanticContract {
  return {
    formatVersion: '1',
    id: 'minimal',
    namespace: 'minimal',
    entities: [{ id: 'Item', fields: [{ id: 'state', type: 'string' }] }],
    states: [],
    responsibilities: [{ id: 'Owner', role: 'Own item', owns: ['Item'], implements: ['readItem'], dependsOn: [] }],
    operations: [{
      id: 'readItem',
      responsibility: 'Owner',
      inputs: [],
      reads: ['Item'],
      writes: [],
      mutates: [],
      requiresPolicies: [],
      requiresPermissions: [],
      performsEffects: [],
      emits: [],
      invokes: [],
      awaits: []
    }],
    events: [],
    policies: [],
    permissions: [],
    effects: [],
    scenarios: []
  };
}

test('ticket/basic loads one normalized semantic contract', async () => {
  const manifestEntry = await loadManifestById('ticket/basic');
  const contracts = await loadSemanticContractsForManifestEntry(manifestEntry);

  expect(contracts).toHaveLength(1);
  expect(contracts[0]?.blockId).toBe('ticket/basic');
  expect(contracts[0]?.contractPath).toBe('catalog/registry/official/ticket.basic/contracts/ticket.yaml');
  expect(contracts[0]?.contract.id).toBe('ticket-core');
  expect(contracts[0]?.contract.imports).toEqual([{
    alias: 'tenant',
    namespace: 'tenant',
    contractId: 'tenant-core'
  }]);
  expect(contracts[0]?.contract.entities.map((entity) => entity.id)).toEqual([
    'Ticket',
    'TicketAttachment',
    'TicketComment'
  ]);
  expect(contracts[0]?.contract.responsibilities.map((entry) => entry.id)).toEqual([
    'TicketLifecycle',
    'TicketQuery',
    'TicketStateMachine'
  ]);
  expect(contracts[0]?.contract.scenarios.map((scenario) => scenario.id)).toEqual([
    'create-ticket',
    'list-tenant-tickets',
    'transition-ticket-status'
  ]);
  expect(manifestEntry.manifest.generators?.map((entry) => entry.id)).toEqual([
    'ticket-status-runtime-contract'
  ]);
});

test('tenant/basic-workspace owns the imported responsibility and explicit policy mapping', async () => {
  const manifestEntry = await loadManifestById('tenant/basic-workspace');
  const contracts = await loadSemanticContractsForManifestEntry(manifestEntry);

  expect(contracts).toHaveLength(1);
  expect(contracts[0]?.contract).toMatchObject({
    id: 'tenant-core',
    namespace: 'tenant',
    responsibilities: [{ id: 'TenantScopeGuard' }],
    policies: [{
      id: 'tenant-scope',
      verifiedBy: ['tenant-scope-required']
    }]
  });
});

test('semantic contract normalization preserves operation input order and duplicates', () => {
  const contract = minimalContract();
  contract.operations[0]!.inputs = ['number', 'string', 'number'];

  const normalized = normalizeSemanticContract(contract);

  expect(normalized.operations[0]!.inputs).toEqual(['number', 'string', 'number']);
});

test('semantic contract validation rejects unknown target references', () => {
  const contract = minimalContract();
  contract.operations[0]!.reads = ['Missing.field'];

  expect(() => normalizeSemanticContract(contract)).toThrow(CompilerError);
  try {
    normalizeSemanticContract(contract);
  } catch (error) {
    expect((error as CompilerError).code).toBe('CONTRACT-SEMANTIC-004');
  }
});
