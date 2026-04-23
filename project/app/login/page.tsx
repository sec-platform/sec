import { redirect } from 'next/navigation';
import { LoginForm } from '../../components/login-form.tsx';
import { getCurrentSession } from '../../lib/session.ts';

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session) {
    redirect('/workspace');
  }

  return (
    <main className="stack">
      <section className="card stack">
        <div className="stack">
          <h1>Customer Admin</h1>
          <p>Sign in with <strong>tenant-a-admin</strong> or <strong>tenant-b-admin</strong>. Password: <strong>password</strong>.</p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
