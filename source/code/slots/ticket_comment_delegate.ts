import type { Database, TicketCommentInput, TicketCommentRecord } from '../../../project/src/runtime/database.ts';
import type { Session } from '../../../project/src/installed/auth/session.ts';
import { addTicketComment, listTicketComments } from '../../../project/src/installed/comment/comment-service.ts';

export function addTicketCommentDelegate(db: Database, session: Session, input: TicketCommentInput): TicketCommentRecord {
  return addTicketComment(db, session, input);
}

export function listTicketCommentsDelegate(db: Database, session: Session, ticketId: number): TicketCommentRecord[] {
  return listTicketComments(db, session, ticketId);
}
