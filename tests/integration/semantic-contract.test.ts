import { expect, test } from 'bun:test';

import { loadManifestById } from '../../platform/compiler/index.ts';
import { loadSemanticContractsForManifestEntry } from '../../platform/compiler/parse/load-semantic-contract.ts';
import { normalizeSemanticContract } from '../../platform/compiler/parse/load-semantic-contract.ts';
import { CompilerError } from '../../platform/shared/errors.ts';
import type { SemanticContract } from '../../platform/shared/semantic-contract-types.ts';

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
  expect(contracts[0]?.contractPath).toBe('platform/registry/official/ticket.basic/contracts/ticket.yaml');
  expect(contracts[0]?.contract.id).toBe('ticket-core');
  expect(contracts[0]?.contract.entities.map((entity) => entity.id)).toEqual([
    'Ticket',
    'TicketAttachment',
    'TicketComment'
  ]);
  expect(contracts[0]?.contract.responsibilities.map((entry) => entry.id)).toEqual([
    'TenantScopeGuard',
    'TicketLifecycle',
    'TicketQuery',
    'TicketStateMachine'
  ]);
  expect(contracts[0]?.contract.scenarios.map((scenario) => scenario.id)).toEqual([
    'create-ticket',
    'list-tenant-tickets',
    'transition-ticket-status'
  ]);
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
