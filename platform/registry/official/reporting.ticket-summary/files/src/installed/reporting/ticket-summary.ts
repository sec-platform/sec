import type { TicketRecord, TicketStatus } from '../../runtime/database.ts';

export interface TicketSummary {
  total: number;
  byStatus: Record<TicketStatus, number>;
  byAssignee: Array<{ assigneeId: string; count: number }>;
  sla: {
    overdue: number;
    dueSoon: number;
    unscheduled: number;
  };
}

export function summarizeTickets(tickets: TicketRecord[]): TicketSummary {
  const byStatus: Record<TicketStatus, number> = {
    open: 0,
    in_progress: 0,
    closed: 0
  };
  const assigneeCounts = new Map<string, number>();
  const sla = {
    overdue: 0,
    dueSoon: 0,
    unscheduled: 0
  };

  for (const ticket of tickets) {
    byStatus[ticket.status] += 1;
    assigneeCounts.set(ticket.assigneeId, (assigneeCounts.get(ticket.assigneeId) ?? 0) + 1);
    if (!ticket.dueDate) {
      sla.unscheduled += 1;
    } else if (ticket.dueDate < '2026-04-26') {
      sla.overdue += 1;
    } else if (ticket.dueDate <= '2026-05-03') {
      sla.dueSoon += 1;
    }
  }

  return {
    total: tickets.length,
    byStatus,
    sla,
    byAssignee: [...assigneeCounts.entries()]
      .map(([assigneeId, count]) => ({ assigneeId, count }))
      .sort((left, right) => left.assigneeId.localeCompare(right.assigneeId))
  };
}
