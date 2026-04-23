import { cookies } from 'next/headers';
import type { Session } from '../src/installed/auth/session.ts';

const SESSION_COOKIE_NAME = 'engineering-compiler-session';

function isSession(value: unknown): value is Session {
  return typeof value === 'object' && value !== null && 'userId' in value && 'tenantId' in value && 'username' in value;
}

export function serializeSession(session: Session): string {
  return Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
}

export function deserializeSession(raw: string | null | undefined): Session | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function getCurrentSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  return deserializeSession(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
