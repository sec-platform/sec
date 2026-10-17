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
    const rendered = formatPostgresContract(view);
    expect(rendered).toMatch(/(?:^|\s)postgres(?=\s|$)/u);
    expect(rendered).toMatch(/(?:^|\s)mode=database(?=;|\s|$)/u);
    expect(rendered).toMatch(/(?:^|\s)tables=2(?=;|\s|$)/u);
    expect(rendered).toMatch(/(?:^|\s)tenantScoped=1(?=;|\s|$)/u);
    expect(rendered).toMatch(/^Table list:\s*tickets\s*,\s*customers\s*$/mu);
  });
});
