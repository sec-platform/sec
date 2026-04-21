export interface Session {
  userId: string;
  username: string;
  tenantId: string;
  role: 'admin';
}

const USERS = new Map([
  [
    'tenant-a-admin',
    {
      userId: 'user-tenant-a-admin',
      username: 'tenant-a-admin',
      tenantId: 'tenant-a',
      role: 'admin'
    }
  ],
  [
    'tenant-b-admin',
    {
      userId: 'user-tenant-b-admin',
      username: 'tenant-b-admin',
      tenantId: 'tenant-b',
      role: 'admin'
    }
  ]
]);

export function login(username: string, password: string): Session {
  const user = USERS.get(username);
  if (!user || password !== 'password') {
    throw new Error('Invalid credentials');
  }
  return { ...user };
}
