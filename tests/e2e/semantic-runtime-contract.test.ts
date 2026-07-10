import { expect, test } from 'bun:test';

import { prepareTicketSemanticRuntime } from '../testkit/semantic-runtime.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function expectTransition(source: string, from: string, to: string): void {
  expect(source).toMatch(new RegExp(`["']?${from}["']?:\\s*["']${to}["']`));
}

test('ticket semantic contract lowers into the runtime transition contract', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixture = await prepareTicketSemanticRuntime(workspaceRoot);

    expect(fixture.resolvedLock.semanticLoweringTasks?.[0]).toMatchObject({
      contractId: 'ticket-core',
      stateId: 'ticket-status',
      target: fixture.runtimeTarget,
      status: 'pending'
    });
    expect(fixture.composedLock.semanticLoweringTasks?.[0]?.status).toBe('generated');
    expect(fixture.composedLock.generatedPaths).toContain(fixture.runtimeTarget);
    expect(fixture.runtimeContract).toContain('export const TICKET_STATUS_VALUES');
    expect(fixture.runtimeContract).toContain('export const TICKET_STATUS_TRANSITIONS');
    expect(fixture.runtimeContract).toContain('export const NEXT_TICKET_STATUS');
    expect(fixture.runtimeContract).toContain('satisfies Record<TicketStatus, TicketStatus>');
    expectTransition(fixture.runtimeContract, 'closed', 'open');
    expectTransition(fixture.runtimeContract, 'in_progress', 'closed');
    expectTransition(fixture.runtimeContract, 'open', 'in_progress');
    expect(fixture.ticketForm).toContain('NEXT_TICKET_STATUS[currentStatus]');
    expect(fixture.ticketForm).not.toContain('const NEXT_STATUS');
    expect(fixture.runtimeContractProvenance).toMatchObject({
      originType: 'generated',
      originId: 'generator:ticket/basic:ticket-status-runtime-contract',
      sourceBlock: 'ticket/basic',
      sourcePath: 'platform/registry/official/ticket.basic/contracts/ticket.yaml',
      runtimeTarget: fixture.runtimeTarget,
      generatedByPass: 'compose',
      generatorTaskId: 'generator:ticket/basic:ticket-status-runtime-contract',
      overrideStatus: 'none'
    });
    expect(fixture.runtimeContractProvenance?.hash).toBeDefined();
  }, 'engineering-compiler-semantic-runtime-contract-');
}, 120000);
