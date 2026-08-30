import type { SemanticGeneratorTask } from '../../src/semantic/generation/contract/types.ts';

export function ticketSemanticGeneratorTask(): SemanticGeneratorTask {
  return {
    id: 'generator:ticket/basic:ticket-status-runtime-contract',
    blockId: 'ticket/basic',
    generatorId: 'ticket-status-runtime-contract',
    generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
    artifactEntityId: 'artifact:src/installed/ticket/ticket-semantic-contract.ts',
    inputRevision: 'sha256:test-input',
    semanticRevision: 'sha256:test-semantic',
    kind: 'generate-state-transition-map',
    contractId: 'ticket-core',
    contractPath: 'catalog/registry/official/ticket.basic/contracts/ticket.yaml',
    contractNamespace: 'ticket',
    stateId: 'ticket-status',
    stateEntityId: 'state:ticket:ticket-status',
    stateValues: ['closed', 'in_progress', 'open'],
    transitions: [
      { from: 'closed', to: 'open', by: 'transitionTicketStatus', operationEntityId: 'operation:ticket:transitionTicketStatus' },
      { from: 'in_progress', to: 'closed', by: 'transitionTicketStatus', operationEntityId: 'operation:ticket:transitionTicketStatus' },
      { from: 'open', to: 'in_progress', by: 'transitionTicketStatus', operationEntityId: 'operation:ticket:transitionTicketStatus' }
    ],
    target: 'src/installed/ticket/ticket-semantic-contract.ts',
    consumes: ['state', 'transition'],
    produces: 'typescript-runtime-contract',
    typeBinding: {
      name: 'TicketStatus',
      importFrom: '../../runtime/database.ts'
    },
    verification: ['ticket_status_can_transition', 'typecheck'],
    verifiedByEntityIds: ['acceptance:ticket_status_can_transition'],
    registrySourceId: 'official',
    registryKind: 'official',
    registryLocation: 'compiler',
    registryPath: 'catalog/registry/official/ticket.basic',
    status: 'pending'
  };
}
