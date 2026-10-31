import { beforeAll, expect, test } from 'bun:test';

import { loadWorkspaceEngineeringIRBuildInput } from '../../../src/adapters/workspace/engineering-input.ts';
import { buildValidatedEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../../src/compiler/projection/project-architecture-view.ts';
import { projectScenarioView } from '../../../src/compiler/projection/project-scenario-view.ts';
import { projectStateView } from '../../../src/compiler/projection/project-state-view.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../src/semantics/engineering-ir/validated-types.ts';
import { INSPECTOR_SECTION_IDS } from '../../../src/semantics/projection/types.ts';
import { prepareResolvedWorkspace } from '../../testkit/workspace.ts';

let ticketSnapshot: ValidatedEngineeringIRSnapshot;

beforeAll(async () => {
  const workspaceRoot = await prepareResolvedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-projections-'
  });
  const ticketInput = (await loadWorkspaceEngineeringIRBuildInput(workspaceRoot)).engineeringIRInput;
  ticketSnapshot = buildValidatedEngineeringIR(ticketInput);
});

test('architecture projection preserves Responsibility, Port, Effect, and Permission Fact edges', () => {
  const view = projectArchitectureView(ticketSnapshot);
  expect(view.subject).toBe('app:customer-admin');
  expect(ticketSnapshot.ir.graphId).toBe('engineering-ir:customer-admin');

  const lifecycle = view.nodes.find((node) => node.entityId === 'responsibility:ticket:TicketLifecycle');
  expect(lifecycle?.badges).toEqual(expect.arrayContaining(['stateful']));
  expect(view.edges.some((edge) =>
    edge.source === 'responsibility:ticket:TicketLifecycle' &&
    edge.target === 'operation:ticket:createTicket' &&
    edge.relation === 'IMPLEMENTS' &&
    edge.references.some((reference) => reference.kind === 'fact')
  )).toBe(true);
  expect(view.edges.some((edge) =>
    edge.source === 'operation:ticket:createTicket' &&
    edge.target === 'effect:ticket:ticket-db-write' &&
    edge.relation === 'PERFORMS_EFFECT' &&
    edge.references.some((reference) => reference.kind === 'fact')
  )).toBe(true);
  expect(view.nodes.some((node) => node.entityKind === 'port')).toBe(true);
  expect(view.edges.some((edge) =>
    edge.source === 'responsibility:ticket:TicketQuery' &&
    edge.target === 'responsibility:tenant:TenantScopeGuard' &&
    edge.relation === 'DEPENDS_ON'
  )).toBe(true);
  expect(view.inspector.map((section) => section.id)).toEqual([...INSPECTOR_SECTION_IDS]);
  expect(view.overlays[0]?.entries.length).toBeGreaterThan(0);

  if (false) {
    // @ts-expect-error Projection consumers require a branded validated snapshot.
    projectArchitectureView(ticketSnapshot.ir);
  }
});

test('state projection exposes owner, backing field, mutator, and transition loops', () => {
  const view = projectStateView(ticketSnapshot, 'state:ticket:ticket-status');
  expect(view.subject).toBe('state:ticket:ticket-status');

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

test('scenario projection preserves canonical entity and Fact references', () => {
  const scenarioId = "scenario:ticket:create-ticket";
  const canonicalView = projectScenarioView(ticketSnapshot, scenarioId);
  expect(canonicalView.subject).toBe(scenarioId);
  expect(
    canonicalView.nodes.every((node) =>
      node.references.some(
        (reference) => reference.kind === "fact" || reference.kind === "entity",
      ),
    ),
  ).toBe(true);

  expect(canonicalView.nodes.find((node) => node.id === 'scenario:ticket:create-ticket#step:create')?.references).toContainEqual({
    kind: 'entity',
    ref: 'scenario:ticket:create-ticket#step:create'
  });
  expect(canonicalView.edges.filter((edge) => ['PRECEDES', 'AWAITS', 'RETRIES', 'HANDLES'].includes(edge.relation))
    .every((edge) => edge.references.some((reference) => reference.kind === 'fact'))).toBe(true);
});
