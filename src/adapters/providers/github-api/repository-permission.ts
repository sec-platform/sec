export type GitHubRepositoryPermission = 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';

/**
 * Normalize the GET collaborator-permission response, without granting authority
 * or changing its raw evidence. GitHub maps maintain to write and triage to read
 * in the legacy permission field; role_name can also name a custom role.
 * https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user
 * Missing role_name retains the existing legacy response contract. A supplied
 * role must be an exact, consistent built-in pair; custom names are unqualified.
 */
export function normalizeGitHubRepositoryPermission(value: unknown): GitHubRepositoryPermission | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const permission = source.permission;
  if (permission !== 'admin' && permission !== 'maintain' && permission !== 'write'
      && permission !== 'triage' && permission !== 'read' && permission !== 'none') return null;
  const role = source.role_name;
  if (role === undefined) return permission;
  if (permission === 'write' && role === 'maintain') return 'maintain';
  if (permission === 'read' && role === 'triage') return 'triage';
  return role === permission ? permission : null;
}
