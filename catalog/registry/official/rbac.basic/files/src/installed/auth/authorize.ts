import type { Session } from './session.ts';

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
}

export function assertAdmin(session: Session): void {
  if (session.role !== 'admin') {
    throw new Error('Forbidden');
  }
}

export function canAccessWorkspace(session: Session, tenantId: string): AuthorizationDecision {
  if (session.role !== 'admin') {
    return { allowed: false, reason: 'role-not-authorized' };
  }
  if (session.tenantId !== tenantId) {
    return { allowed: false, reason: 'tenant-mismatch' };
  }
  return { allowed: true, reason: 'allowed' };
}
