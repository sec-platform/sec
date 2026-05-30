'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useRef, useState } from 'react';

interface CustomerAttachmentFormProps {
  customerId: number;
  customerName: string;
}

export function CustomerAttachmentForm({ customerId, customerName }: CustomerAttachmentFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch(`/api/customers/${customerId}/attachments`, {
      method: 'POST',
      body: new FormData(event.currentTarget)
    });

    if (!response.ok) {
      const payload = await response.json() as { error?: string };
      setError(payload.error ?? 'Unable to upload attachment');
      setPending(false);
      return;
    }

    formRef.current?.reset();
    setPending(false);
    router.refresh();
  }

  return (
    <form ref={formRef} className="row" onSubmit={handleSubmit}>
      <label style={{ flex: 1 }}>
        Attachment
        <input aria-label={`Attachment for ${customerName}`} name="file" type="file" />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Uploading...' : `Upload attachment for ${customerName}`}</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
