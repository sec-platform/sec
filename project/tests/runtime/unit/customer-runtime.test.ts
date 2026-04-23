import { beforeEach, describe, expect, it } from 'vitest';
import { login } from '../../../src/installed/auth/session.ts';
import { createCustomer, listCustomers } from '../../../src/installed/entity/customer-service.ts';
import { getDatabase, resetDatabase } from '../../../lib/store.ts';

describe('runtime customer service', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('creates a customer for tenant a and hides it from tenant b', () => {
    const database = getDatabase();
    const tenantA = login('tenant-a-admin', 'password');
    const tenantB = login('tenant-b-admin', 'password');

    const created = createCustomer(database, tenantA, {
      name: 'Acme',
      email: 'Sales@Acme.test',
      phone: '400-800-9000',
      company: ''
    });

    expect(created.company).toBe('Unknown');
    expect(listCustomers(database, tenantA)).toHaveLength(1);
    expect(listCustomers(database, tenantB)).toHaveLength(0);
  });
});
