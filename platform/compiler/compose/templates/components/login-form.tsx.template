'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState('tenant-a-admin');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/session/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Login failed');
      setPending(false);
      return;
    }

    router.push('/workspace');
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        Username
        <input aria-label="Username" value={username} onChange={(event) => setUsername(event.target.value)} />
      </label>
      <label>
        Password
        <input aria-label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? 'Signing In...' : 'Sign In'}</button>
    </form>
  );
}
