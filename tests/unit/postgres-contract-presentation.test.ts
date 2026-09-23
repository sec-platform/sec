import { describe, expect, test } from 'bun:test';

import { projectPostgresContract } from '../../src/application/postgres-contract.ts';
import { formatPostgresContract } from '../../src/entry/cli/postgres-contract.ts';

describe('postgres contract presentation boundary', () => {
  test('application owns the finite projection and entry preserves table order while rendering', () => {
    const source = {
      provider: 'postgres',
      persistenceMode: 'database',
      tables: [
        { name: 'tickets', tenantScoped: true, columns: ['id', 'tenantId'] },
        { name: 'customers', tenantScoped: false, columns: ['id'] }
      ]
    };
    const view = projectPostgresContract(source);
    expect(view).toEqual({
      provider: 'postgres',
      persistenceMode: 'database',
      tableCount: 2,
      tenantScopedCount: 1,
      tableNames: ['tickets', 'customers']
    });
    expect(source.tables.map((table) => table.name)).toEqual(['tickets', 'customers']);
    expect(formatPostgresContract(view)).toBe([
      'Postgres contract postgres',
      'mode=database; tables=2; tenantScoped=1',
      'Table list: tickets, customers'
    ].join('\n'));
  });
});
