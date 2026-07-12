import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from 'bun:test';

import { prepareTicketSemanticRuntime } from '../testkit/semantic-runtime.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function expectTransition(source: string, from: string, to: string): void {
  expect(source).toMatch(new RegExp(`["']?${from}["']?:\\s*["']${to}["']`));
}

test('ticket semantic contract lowers into the runtime transition contract', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixture = await prepareTicketSemanticRuntime(workspaceRoot);
    const semanticContext = fixture.compilation.semanticContext!;

    expect(fixture.resolvedLock.semanticLoweringTasks).toBeUndefined();
    expect(Object.isFrozen(semanticContext.snapshot)).toBe(true);
    expect(Object.isFrozen(semanticContext.snapshot.ir)).toBe(true);
    expect(semanticContext.snapshot.ir.facts.some((fact) =>
      fact.subject === 'responsibility:ticket:TicketQuery' &&
      fact.predicate === 'DEPENDS_ON' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'responsibility:tenant:TenantScopeGuard'
    )).toBe(true);
    expect(semanticContext.generatorPlan.tasks[0]).toMatchObject({
      contractId: 'ticket-core',
      stateId: 'ticket-status',
      target: fixture.runtimeTarget,
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: `artifact:${fixture.runtimeTarget}`
    });
    expect(semanticContext.generatorPlan).toMatchObject({
      inputRevision: semanticContext.snapshot.ir.inputRevision,
      semanticRevision: semanticContext.snapshot.ir.semanticRevision
    });
    expect(semanticContext.semanticViews).toMatchObject({
      inputRevision: semanticContext.snapshot.ir.inputRevision,
      semanticRevision: semanticContext.snapshot.ir.semanticRevision
    });
    expect(Object.isFrozen(semanticContext.semanticViews)).toBe(true);
    expect(new Set(semanticContext.semanticViews.views.map((view) => view.viewKind))).toEqual(
      new Set(['architecture', 'scenario', 'state'])
    );
    const sharedFactId = semanticContext.snapshot.ir.facts.find((fact) =>
      fact.subject === 'operation:ticket:transitionTicketStatus' &&
      fact.predicate === 'MUTATES' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'state:ticket:ticket-status'
    )!.id;
    for (const view of [
      semanticContext.semanticViews.views.find((candidate) => candidate.viewKind === 'architecture')!,
      semanticContext.semanticViews.views.find((candidate) => candidate.subject === 'scenario:ticket:transition-ticket-status')!,
      semanticContext.semanticViews.views.find((candidate) => candidate.subject === 'state:ticket:ticket-status')!
    ]) {
      expect(view.nodes.some((node) => node.references.some((reference) => (
        reference.kind === 'fact' && reference.ref === sharedFactId
      )))).toBe(true);
    }
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
    expect(fixture.ticketService).toContain("import { NEXT_TICKET_STATUS } from './ticket-semantic-contract.ts'");
    expect(fixture.ticketService).toContain('Invalid ticket status transition');
    expect(fixture.runtimeContractProvenance).toMatchObject({
      originType: 'generated',
      originId: 'generator:ticket/basic:ticket-status-runtime-contract',
      sourceBlock: 'ticket/basic',
      sourcePath: 'platform/registry/official/ticket.basic/contracts/ticket.yaml',
      runtimeTarget: fixture.runtimeTarget,
      generatedByPass: 'compose',
      generatorTaskId: 'generator:ticket/basic:ticket-status-runtime-contract',
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: `artifact:${fixture.runtimeTarget}`,
      semanticRevision: semanticContext.semanticRevision,
      compilationTransactionId: fixture.compilation.transactionId,
      overrideStatus: 'none'
    });
    expect(fixture.runtimeContractProvenance?.hash).toBeDefined();

    const ticketSuite = await import(
      `${pathToFileURL(path.join(fixture.projectRoot, 'tests', 'shared', 'ticket-service-suite.ts')).href}?transaction=${fixture.compilation.transactionId}`
    );
    await ticketSuite.runTicketServiceSuite();
    await ticketSuite.runTicketFlowSuite();
  }, 'engineering-compiler-semantic-runtime-contract-');
}, 120000);
