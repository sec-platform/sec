import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { login } from '../../../../src/installed/auth/session.ts';
import { getSessionCookieName, serializeSession } from '../../../../lib/session.ts';

export async function POST(request: Request) {
  const payload = await request.json() as { username?: string; password?: string };

  try {
    const session = login(String(payload.username ?? ''), String(payload.password ?? ''));
    const cookieStore = await cookies();
    cookieStore.set(getSessionCookieName(), serializeSession(session), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/'
    });
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid credentials' }, { status: 401 });
  }
}
