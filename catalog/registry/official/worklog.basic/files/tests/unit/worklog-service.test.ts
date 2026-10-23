import assert from 'node:assert/strict';
import { createTicket } from '../../src/installed/ticket/ticket-service.ts';
import { recordWorklog, summarizeWorklogMinutes } from '../../src/installed/worklog/worklog-service.ts';
import { createTenantRuntimeFixture } from '../shared/tenant-runtime-fixture.ts';

export async function runSuite() {
  const { db, tenantA } = createTenantRuntimeFixture();
  const ticket = createTicket(db, tenantA, {
    title: 'Escalate onboarding issue',
    assigneeId: 'support-owner'
  });

  const worklog = recordWorklog(db, tenantA, {
    ticketId: ticket.id,
    minutes: 17,
    note: 'Investigated customer setup logs'
  });

  assert.equal(worklog.authorId, 'user-tenant-a-admin');
  assert.equal(worklog.minutes, 17);
  assert.equal(worklog.note, 'Investigated customer setup logs');
  assert.equal(summarizeWorklogMinutes(db, tenantA, ticket.id), 17);
  assert.throws(() => recordWorklog(db, tenantA, { ticketId: ticket.id, minutes: 0 }), /Worklog minutes must be positive/);
  assert.throws(
    () => recordWorklog(db, tenantA, { ticketId: ticket.id, minutes: Number.NaN }),
    /Worklog minutes must be positive/
  );
}
