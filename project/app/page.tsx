import { redirect } from 'next/navigation';
import { getCurrentSession } from '../lib/session.ts';

export default async function HomePage() {
  const session = await getCurrentSession();
  redirect(session ? '/workspace' : '/login');
}
