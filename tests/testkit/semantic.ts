import type { LoadedSemanticContract } from '../../platform/shared/semantic-contract-types.ts';
import type { SemanticGeneratorTask } from '../../platform/shared/semantic-generator-types.ts';

export function ticketSemanticGeneratorTask(): SemanticGeneratorTask {
  return {
    id: 'generator:ticket/basic:ticket-status-runtime-contract',
    blockId: 'ticket/basic',
    generatorId: 'ticket-status-runtime-contract',
    kind: 'generate-state-transition-map',
    contractId: 'ticket-core',
    contractPath: 'platform/registry/official/ticket.basic/contracts/ticket.yaml',
    contractNamespace: 'ticket',
    stateId: 'ticket-status',
    target: 'src/installed/ticket/ticket-semantic-contract.ts',
    consumes: ['state', 'transition'],
    produces: 'typescript-runtime-contract',
    typeBinding: {
      name: 'TicketStatus',
      importFrom: '../../runtime/database.ts'
    },
    verification: ['ticket_status_can_transition', 'typecheck'],
    registrySourceId: 'official',
    registryKind: 'official',
    registryLocation: 'compiler',
    registryPath: 'platform/registry/official/ticket.basic',
    status: 'pending'
  };
}

export function ticketLoadedContract(
  values = ['closed', 'in_progress', 'open'],
  transitions = [
    { from: 'closed', to: 'open', by: 'transitionTicketStatus' },
    { from: 'in_progress', to: 'closed', by: 'transitionTicketStatus' },
    { from: 'open', to: 'in_progress', by: 'transitionTicketStatus' }
  ]
): LoadedSemanticContract {
  return {
    blockId: 'ticket/basic',
    contractPath: ticketSemanticGeneratorTask().contractPath,
    contract: {
      formatVersion: '1',
      id: 'ticket-core',
      namespace: 'ticket',
      entities: [],
      states: [{
        id: 'ticket-status',
        entity: 'Ticket',
        field: 'status',
        owner: 'TicketStateMachine',
        values,
        transitions
      }],
      responsibilities: [],
      operations: [],
      events: [],
      policies: [],
      permissions: [],
      effects: [],
      scenarios: []
    }
  };
}
