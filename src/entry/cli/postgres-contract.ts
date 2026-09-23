import type { PostgresContractView } from '../../application/postgres-contract.ts';
import { formatFields, formatList } from './format-utils.ts';

export function formatPostgresContract(view: PostgresContractView): string {
  return [
    `Postgres contract ${view.provider}`,
    formatFields([
      `mode=${view.persistenceMode}`,
      `tables=${view.tableCount}`,
      `tenantScoped=${view.tenantScopedCount}`
    ]),
    `Table list: ${formatList([...view.tableNames])}`
  ].join('\n');
}
