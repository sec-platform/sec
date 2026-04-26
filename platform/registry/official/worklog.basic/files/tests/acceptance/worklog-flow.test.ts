import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import { login } from '../../src/installed/auth/session.ts';
import { createTicket } from '../../src/installed/ticket/ticket-service.ts';
import { listWorklogs, recordWorklog, summarizeWorklogMinutes } from '../../src/installed/worklog/worklog-service.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenantA = login('tenant-a-admin', 'password');
  const tenantB = login('tenant-b-admin', 'password');
  const ticket = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    assigneeId: 'support-owner'
  });

  recordWorklog(db, tenantA, {
    ticketId: ticket.id,
    minutes: 30,
    note: 'Triage call'
  });
  recordWorklog(db, tenantA, {
    ticketId: ticket.id,
    minutes: 15,
    note: 'Follow-up notes'
  });

  assert.deepEqual(
    listWorklogs(db, tenantA, ticket.id).map((worklog) => worklog.note),
    ['Triage call', 'Follow-up notes']
  );
  assert.equal(summarizeWorklogMinutes(db, tenantA, ticket.id), 45);
  assert.throws(() => listWorklogs(db, tenantB, ticket.id), /Ticket is not available/);
}
