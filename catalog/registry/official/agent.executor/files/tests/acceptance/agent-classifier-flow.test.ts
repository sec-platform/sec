import assert from 'node:assert/strict';
import { createDatabase } from '../../src/runtime/database.ts';
import type { Session } from '../../src/installed/auth/session.ts';
import { registerAgent } from '../../src/installed/agent/harness-service.ts';
import { createTicket } from '../../src/installed/ticket/ticket-service.ts';
import { autoExecuteAgentFlow } from '../../src/installed/agent/executor-service.ts';

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

  // 4. Verify AI execution logic
  assert.equal(result.agentName, 'BrainyAgent');
  assert.ok(result.commentBody.includes('onboarding bottleneck'));
  assert.equal(result.ticket.status, 'in_progress');

  const d = db as any;
  assert.equal(d.ticketComments.length, 1);
  assert.ok(d.ticketComments[0].body.includes('[AI Assistant - BrainyAgent]'));
  assert.equal(d.ticketComments[0].tenantId, 'tenant-alpha');

  // 5. Verify sandbox and tenant cross-access isolation
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
}

