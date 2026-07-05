import { expect, test } from 'bun:test';

import {
  projectArchitectureView,
  projectScenarioView,
  projectStateView
} from '../../platform/compiler/index.ts';
import type { EngineeringIR } from '../../platform/shared/engineering-ir-types.ts';
import { INSPECTOR_SECTION_IDS } from '../../platform/shared/semantic-view-types.ts';
import {
  addBlock,
  buildWorkspaceEngineeringIR,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function buildTicketIR(workspaceRoot: string): Promise<EngineeringIR> {
  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  await resolveWorkspace(workspaceRoot);
  return buildWorkspaceEngineeringIR(workspaceRoot);
}

test('architecture projection collapses operation effects and permissions into responsibility edges', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const ir = await buildTicketIR(workspaceRoot);
    const view = projectArchitectureView(ir, 'responsibility:ticket:TicketLifecycle');

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
      edge.target === 'responsibility:ticket:TenantScopeGuard' &&
      edge.relation === 'DEPENDS_ON'
    )).toBe(true);
    expect(view.inspector.map((section) => section.id)).toEqual([...INSPECTOR_SECTION_IDS]);
    expect(view.overlays[0]?.entries.length).toBeGreaterThan(0);
  }, 'engineering-compiler-architecture-view-');
});

test('scenario projection preserves repeated execution steps and local ordering', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const ir = await buildTicketIR(workspaceRoot);
    const original = ir.scenarios.find((scenario) => scenario.id === 'scenario:ticket:create-ticket')!;
    const scenarioIR: EngineeringIR = {
      ...ir,
      scenarios: ir.scenarios.map((scenario) => scenario.id === original.id
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
    expect(view.nodes.map((node) => node.id)).toContain('scenario:ticket:create-ticket#step:create');
    expect(view.nodes.map((node) => node.id)).toContain('scenario:ticket:create-ticket#step:transition');
    expect(view.edges).toContainEqual(expect.objectContaining({
      source: 'scenario:ticket:create-ticket#step:create',
      target: 'scenario:ticket:create-ticket#step:transition',
      relation: 'SCENARIO_PRECEDES',
      label: 'await'
    }));
  }, 'engineering-compiler-scenario-view-');
});

test('state projection exposes owner, backing field, mutator, and transition loops', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const ir = await buildTicketIR(workspaceRoot);
    const view = projectStateView(ir, 'state:ticket:ticket-status');

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
  }, 'engineering-compiler-state-view-');
});
