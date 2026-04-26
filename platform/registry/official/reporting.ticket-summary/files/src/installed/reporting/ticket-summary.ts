import type { TicketRecord, TicketStatus } from '../../runtime/database.ts';

export interface TicketSummary {
  total: number;
  byStatus: Record<TicketStatus, number>;
  byAssignee: Array<{ assigneeId: string; count: number }>;
}

export function summarizeTickets(tickets: TicketRecord[]): TicketSummary {
  const byStatus: Record<TicketStatus, number> = {
    open: 0,
    in_progress: 0,
    closed: 0
  };
  const assigneeCounts = new Map<string, number>();

  for (const ticket of tickets) {
    byStatus[ticket.status] += 1;
    assigneeCounts.set(ticket.assigneeId, (assigneeCounts.get(ticket.assigneeId) ?? 0) + 1);
  }

  return {
    total: tickets.length,
    byStatus,
    byAssignee: [...assigneeCounts.entries()]
      .map(([assigneeId, count]) => ({ assigneeId, count }))
      .sort((left, right) => left.assigneeId.localeCompare(right.assigneeId))
  };
}
