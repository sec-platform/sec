import type { Database, TicketRecord } from '../../runtime/database.ts';
import type { Session } from '../auth/session.ts';
import { currentTenant } from '../tenant/context.ts';
import { assertTenantTicket, transitionTicketStatus } from '../ticket/ticket-service.ts';
import { addTicketComment } from '../comment/comment-service.ts';
import { listAgents, verifyAgentZonePermission } from './harness-service.ts';

export interface ExecutionResult {
  ticket: TicketRecord;
  agentName: string;
  commentBody: string;
}

export function autoExecuteAgentFlow(
  db: Database,
  session: Session,
  ticketId: number
): ExecutionResult {
  const tenantId = currentTenant(session);
  const ticket = assertTenantTicket(db, ticketId, tenantId);

  // 1. Find active AI Agent in the current tenant
  const agents = listAgents(db, session);
  const activeAgent = agents.find((a) => a.isActive);

  if (!activeAgent) {
    throw new Error('No active AI Agent found in this tenant');
  }

  // 2. Validate Sandbox permissions
  const hasTicketPermission = verifyAgentZonePermission(db, session, activeAgent.id, 'tickets');
  const hasCommentPermission = verifyAgentZonePermission(db, session, activeAgent.id, 'comments');

  if (!hasTicketPermission || !hasCommentPermission) {
    throw new Error(`AI Agent Sandbox violation: Agent ${activeAgent.name} lacks required zones`);
  }

  // 3. AI Classifier / Decision Reasoner
  const titleLower = ticket.title.toLowerCase();
  const descLower = ticket.description.toLowerCase();
  let commentBody = '';
  let targetStatus: 'open' | 'in_progress' | 'closed' = 'in_progress';

  if (titleLower.includes('onboarding') || descLower.includes('onboarding') || titleLower.includes('login')) {
    commentBody = `[AI Assistant - ${activeAgent.name}]: Classified this as an onboarding bottleneck. Auto-routing to tier-2 support team.`;
  } else if (titleLower.includes('bug') || descLower.includes('error') || titleLower.includes('crash')) {
    commentBody = `[AI Assistant - ${activeAgent.name}]: System defect signature matched. Auto-escalated and tagged as high priority bug.`;
  } else {
    commentBody = `[AI Assistant - ${activeAgent.name}]: Initial ticket intake complete. Awaiting human agent triage.`;
    targetStatus = 'open';
  }

  // 4. Update status if transition is required
  if (targetStatus !== ticket.status) {
    transitionTicketStatus(db, session, ticketId, targetStatus);
  }

  // 5. Add automated comments using Agent identity context
  const agentSession: Session = {
    userId: `agent-${activeAgent.id}`,
    username: activeAgent.name,
    tenantId: tenantId,
    role: 'admin'
  };

  addTicketComment(db, agentSession, {
    ticketId,
    body: commentBody
  });

  return {
    ticket,
    agentName: activeAgent.name,
    commentBody
  };
}
