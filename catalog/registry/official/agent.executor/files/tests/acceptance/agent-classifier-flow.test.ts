import assert from 'node:assert/strict';
import { autoExecuteAgentFlow } from '../../src/installed/agent/executor-service.ts';
import { registerAgent } from '../../src/installed/agent/harness-service.ts';
import type { Session } from '../../src/installed/auth/session.ts';
import { createTicket } from '../../src/installed/ticket/ticket-service.ts';
import { createDatabase } from '../../src/runtime/database.ts';

export async function runSuite() {
  const db = createDatabase();
  const tenant1Session: Session = {
    userId: 'user-1',
    username: 'Alice',
    tenantId: 'tenant-alpha',
    role: 'admin'
  };

  // 1. Register an AI Classifier Agent to tenant-alpha
  const agent = registerAgent(db, tenant1Session, {
    name: 'BrainyAgent',
    role: 'classifier',
    allowedZones: 'tickets,comments'
  });

  assert.ok(agent.id);
  assert.equal(agent.tenantId, 'tenant-alpha');

  // 2. Create a ticket in tenant-alpha
  const onboardingTicket = createTicket(db, tenant1Session, {
    title: 'Critical Login and Onboarding error',
    description: 'User cannot finish onboarding steps after login'
  });

  // 3. Trigger Agent flow
  const result = autoExecuteAgentFlow(db, tenant1Session, onboardingTicket.id);

  // 4. Verify the deterministic classifier result and its stored ticket/comment effects
  assert.equal(result.agentName, 'BrainyAgent');
  assert.equal(result.ticket.id, onboardingTicket.id);
  assert.ok(result.commentBody.includes('onboarding bottleneck'));
  assert.equal(result.ticket.status, 'in_progress');

  assert.equal(db.tickets.find((ticket) => ticket.id === onboardingTicket.id)?.status, 'in_progress');
  assert.equal(db.ticketComments.length, 1);
  const storedComment = db.ticketComments[0]!;
  assert.ok(storedComment.body.includes('[AI Assistant - BrainyAgent]'));
  assert.equal(storedComment.body, result.commentBody);
  assert.equal(storedComment.ticketId, onboardingTicket.id);
  assert.equal(storedComment.authorId, `agent-${agent.id}`);
  assert.equal(storedComment.tenantId, 'tenant-alpha');

  // 5. Tenant beta cannot borrow tenant alpha's active agent
  const tenant2Session: Session = {
    userId: 'user-2',
    username: 'Bob',
    tenantId: 'tenant-beta',
    role: 'admin'
  };

  const betaTicket = createTicket(db, tenant2Session, {
    title: 'Simple question',
    description: 'How to use this platform'
  });

  assert.throws(() => {
    autoExecuteAgentFlow(db, tenant2Session, betaTicket.id);
  }, /No active AI Agent found in this tenant/);
  assert.equal(betaTicket.status, 'open');
  assert.equal(db.ticketComments.length, 1);
}

