import { expect, test } from 'bun:test';

import { normalizeGitHubRepositoryPermission } from '../../src/adapters/providers/github-api/repository-permission.ts';

test('repository permission normalization recognizes exact documented built-in pairs', () => {
  for (const [permission, role, expected] of [
    ['admin', 'admin', 'admin'],
    ['write', 'maintain', 'maintain'],
    ['write', 'write', 'write'],
    ['read', 'triage', 'triage'],
    ['read', 'read', 'read'],
    ['none', 'none', 'none']
  ] as const) {
    const source = Object.freeze({ permission, role_name: role });
    expect(normalizeGitHubRepositoryPermission(source)).toBe(expected);
    expect(source).toEqual({ permission, role_name: role });
  }
});

test('repository permission normalization preserves legacy values without elevating ordinary write', () => {
  for (const permission of ['admin', 'maintain', 'write', 'triage', 'read', 'none'] as const) {
    expect(normalizeGitHubRepositoryPermission({ permission })).toBe(permission);
  }
  expect(normalizeGitHubRepositoryPermission({ permission: 'write', role_name: 'write' })).toBe('write');
  expect(normalizeGitHubRepositoryPermission({ permission: 'maintain', role_name: 'maintain' })).toBe('maintain');
  expect(normalizeGitHubRepositoryPermission({ permission: 'triage', role_name: 'triage' })).toBe('triage');
});

test('custom, contradictory and malformed permission responses never normalize to privileged roles', () => {
  for (const source of [
    null, [], 'admin', {}, { permission: 'owner', role_name: 'admin' },
    { permission: 'write', role_name: 'custom-maintainer' },
    { permission: 'admin', role_name: 'custom-admin' },
    { permission: 'write', role_name: 'Maintain' },
    { permission: 'write', role_name: ' maintain ' },
    { permission: 'read', role_name: 'maintain' },
    { permission: 'write', role_name: 'admin' },
    { permission: 'admin', role_name: 'maintain' },
    { permission: 'maintain', role_name: 'write' },
    { permission: 'triage', role_name: 'read' },
    { permission: 'none', role_name: 'write' },
    { permission: 'admin', role_name: null }
  ]) expect(normalizeGitHubRepositoryPermission(source)).toBeNull();
});
