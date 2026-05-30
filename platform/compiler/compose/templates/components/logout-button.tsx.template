'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/session/logout', {
      method: 'POST'
    });
    router.push('/login');
    router.refresh();
  }

  return <button type="button" className="secondary" onClick={handleLogout}>Sign out</button>;
}
