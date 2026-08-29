import type { Session } from '../auth/session.ts';

export function currentTenant(session: Session): string {
  if (!session?.tenantId) {
    throw new Error('Unauthenticated session');
  }
  return session.tenantId;
}
