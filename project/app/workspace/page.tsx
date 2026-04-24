import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogoutButton } from '../../components/logout-button.tsx';
import { getCurrentSession } from '../../lib/session.ts';
import { routes } from '../../generated/routes.ts';
import { canAccessWorkspace } from '../../src/installed/auth/authorize.ts';

export default async function WorkspacePage() {
  const session = await getCurrentSession();
  if (!session) {
    redirect('/login');
  }

  const visibleRoutes = routes.filter((route) => route.path !== '/login');

  const ownWorkspaceDecision = canAccessWorkspace(session, session.tenantId);
  const otherTenantId = session.tenantId === 'tenant-a' ? 'tenant-b' : 'tenant-a';
  const otherWorkspaceDecision = canAccessWorkspace(session, otherTenantId);

  return (
    <main className="stack">
      <section className="card stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="stack">
            <h1>Workspace</h1>
            <p>{session.username} in tenant <strong>{session.tenantId}</strong></p>
          </div>
          <LogoutButton />
        </div>
        <div className="stack" aria-label="Authorization summary">
          <p>Authorization: {ownWorkspaceDecision.reason}</p>
          <p>Cross-tenant check: {otherWorkspaceDecision.reason}</p>
        </div>

        <nav className="row">
          {visibleRoutes.length === 0 ? <span>No block routes available for this workspace.</span> : null}
          {visibleRoutes.map((route) => (
            <Link key={route.path} href={route.path}>{route.path}</Link>
          ))}
        </nav>
      </section>
    </main>
  );
}
