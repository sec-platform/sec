import { beforeAll, expect, test } from 'bun:test';

import {
  projectArchitectureView,
  projectScenarioView,
  projectStateView
} from '../../platform/compiler/index.ts';
import { buildWorkspaceEngineeringIR } from '../../platform/orchestrator.ts';
import type { EngineeringIR } from '../../platform/shared/engineering-ir-types.ts';
import { INSPECTOR_SECTION_IDS } from '../../platform/shared/semantic-view-types.ts';
import { prepareResolvedWorkspace } from '../testkit/workspace.ts';

let ticketIR: EngineeringIR;

beforeAll(async () => {
  const workspaceRoot = await prepareResolvedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-projections-'
  });
  ticketIR = await buildWorkspaceEngineeringIR(workspaceRoot);
}, 15_000);

test('architecture projection collapses operation effects and permissions into responsibility edges', () => {
  const view = projectArchitectureView(ticketIR, 'responsibility:ticket:TicketLifecycle');

  const lifecycle = view.nodes.find((node) => node.entityId === 'responsibility:ticket:TicketLifecycle');
  expect(lifecycle?.badges).toEqual(expect.arrayContaining(['stateful', 'io', 'permission']));
  expect(view.edges.some((edge) =>
    edge.source === 'responsibility:ticket:TicketLifecycle' &&
    edge.target === 'effect:ticket:ticket-db-write' &&
    edge.relation === 'PERFORMS_EFFECT' &&
    edge.references.some((reference) => reference.kind === 'fact')
  )).toBe(true);
  expect(view.edges.some((edge) =>
    edge.source === 'responsibility:ticket:TicketQuery' &&
    edge.target === 'responsibility:tenant:TenantScopeGuard' &&
    edge.relation === 'DEPENDS_ON'
  )).toBe(true);
  expect(view.inspector.map((section) => section.id)).toEqual([...INSPECTOR_SECTION_IDS]);
  expect(view.overlays[0]?.entries.length).toBeGreaterThan(0);
});

test('scenario projection derives from canonical Facts and ignores a tampered Scenario cache', () => {
  const original = ticketIR.scenarios.find((scenario) => scenario.id === 'scenario:ticket:create-ticket')!;
  const canonicalView = projectScenarioView(ticketIR, original.id);
  const scenarioIR: EngineeringIR = {
    ...ticketIR,
    scenarios: ticketIR.scenarios.map((scenario) => scenario.id === original.id
      ? {
          ...scenario,
          steps: [
            ...scenario.steps,
            {
              id: 'transition',
              operationEntityId: 'operation:ticket:transitionTicketStatus',
              afterStepIds: ['create'],
              awaits: true
            }
          ]
        }
      : scenario)
  };

  const view = projectScenarioView(scenarioIR, original.id);
  expect(view).toEqual(canonicalView);
  expect(view.nodes.map((node) => node.id)).toEqual(['scenario:ticket:create-ticket#step:create']);
  expect(view.nodes[0]?.references).toContainEqual({
    kind: 'entity',
    ref: 'scenario:ticket:create-ticket#step:create'
  });
});

test('state projection exposes owner, backing field, mutator, and transition loops', () => {
  const view = projectStateView(ticketIR, 'state:ticket:ticket-status');

  expect(view.nodes.map((node) => node.entityId)).toEqual(expect.arrayContaining([
    'state:ticket:ticket-status',
    'responsibility:ticket:TicketStateMachine',
    'field:ticket:Ticket.status',
    'operation:ticket:transitionTicketStatus'
  ]));
  expect(view.edges.filter((edge) => edge.relation === 'TRANSITIONS_TO').map((edge) => edge.label).sort()).toEqual([
    'closed → open by transitionTicketStatus',
    'in_progress → closed by transitionTicketStatus',
    'open → in_progress by transitionTicketStatus'
  ]);
  expect(view.edges.some((edge) =>
    edge.source === 'operation:ticket:transitionTicketStatus' &&
    edge.target === 'state:ticket:ticket-status' &&
    edge.relation === 'MUTATES'
  )).toBe(true);
});
