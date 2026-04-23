'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const INITIAL_STATE = {
  name: '',
  email: '',
  phone: '',
  company: ''
};

export function CustomerForm() {
  const router = useRouter();
  const [form, setForm] = useState(INITIAL_STATE);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch('/api/customers', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(form)
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Unable to create customer');
      setPending(false);
      return;
    }

    setForm(INITIAL_STATE);
    setPending(false);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <div className="row">
        <label style={{ flex: 1 }}>
          Name
          <input aria-label="Name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label style={{ flex: 1 }}>
          Company
          <input aria-label="Company" value={form.company} onChange={(event) => setForm((current) => ({ ...current, company: event.target.value }))} />
        </label>
      </div>
      <div className="row">
        <label style={{ flex: 1 }}>
          Email
          <input aria-label="Email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} />
        </label>
        <label style={{ flex: 1 }}>
          Phone
          <input aria-label="Phone" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} />
        </label>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? 'Creating...' : 'Create Customer'}</button>
    </form>
  );
}
