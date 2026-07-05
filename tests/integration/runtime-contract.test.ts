import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  addBlock,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('ticket state contract produces the runtime transition contract', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot, { reset: true });
    await addBlock(workspaceRoot, 'ticket/basic');
    const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);

    expect(resolvedLock.semanticLoweringTasks).toHaveLength(1);
    expect(resolvedLock.semanticLoweringTasks?.[0]).toMatchObject({
      contractId: 'ticket-core',
      stateId: 'ticket-status',
      target: 'src/installed/ticket/ticket-semantic-contract.ts',
      status: 'pending'
    });

    const { lock: composedLock } = await composeWorkspace(workspaceRoot);
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const runtimeContract = await fs.readFile(
      path.join(projectRoot, 'src', 'installed', 'ticket', 'ticket-semantic-contract.ts'),
      'utf8'
    );
    const ticketForm = await fs.readFile(
      path.join(projectRoot, 'components', 'ticket-status-form.tsx'),
      'utf8'
    );

    expect(composedLock.semanticLoweringTasks?.[0]?.status).toBe('generated');
    expect(composedLock.generatedPaths).toContain('src/installed/ticket/ticket-semantic-contract.ts');
    expect(runtimeContract).toContain('export const TICKET_STATUS_VALUES');
    expect(runtimeContract).toContain('export const TICKET_STATUS_TRANSITIONS');
    expect(runtimeContract).toContain('export const NEXT_TICKET_STATUS');
    expect(runtimeContract).toContain('satisfies Record<TicketStatus, TicketStatus>');
    expect(runtimeContract).toContain('"closed": "open"');
    expect(runtimeContract).toContain('"in_progress": "closed"');
    expect(runtimeContract).toContain('"open": "in_progress"');
    expect(ticketForm).toContain('NEXT_TICKET_STATUS[currentStatus]');
    expect(ticketForm).not.toContain('const NEXT_STATUS');
  }, 'engineering-compiler-runtime-contract-');
});
