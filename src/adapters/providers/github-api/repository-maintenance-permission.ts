/** Qualify a role produced by the canonical GitHub repository permission decoder. */
export function isRepositoryMaintenancePermission(role: unknown): role is 'admin' | 'maintain' {
  return role === 'admin' || role === 'maintain';
}
