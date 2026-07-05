import { expect, test } from 'bun:test';

import {
  addBlock,
  buildWorkspaceEngineeringIR,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('workspace builds ticket semantic contract into one deterministic Engineering IR', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    await addBlock(workspaceRoot, 'ticket/basic');
    await resolveWorkspace(workspaceRoot);

    const first = await buildWorkspaceEngineeringIR(workspaceRoot);
    const second = await buildWorkspaceEngineeringIR(workspaceRoot);

    expect(second).toEqual(first);
    expect(first.entities.find((entity) => entity.id === 'responsibility:ticket:TicketLifecycle')?.kind).toBe('responsibility');
    expect(first.entities.find((entity) => entity.id === 'state:ticket:ticket-status')?.kind).toBe('state');
    expect(first.facts.some((fact) =>
      fact.subject === 'operation:ticket:listTickets' &&
      fact.predicate === 'REQUIRES_PERMISSION' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'permission:ticket:ticket-read'
    )).toBe(true);
    expect(first.scenarios.map((scenario) => scenario.id)).toEqual([
      'scenario:ticket:create-ticket',
      'scenario:ticket:list-tenant-tickets',
      'scenario:ticket:transition-ticket-status'
    ]);
  }, 'engineering-compiler-semantic-ir-');
});
