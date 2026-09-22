export type PostgresContractProjectionSource = Readonly<{
  provider: string;
  persistenceMode: string;
  tables: readonly Readonly<{
    name: string;
    tenantScoped: boolean;
  }>[];
}>;

export type PostgresContractView = Readonly<{
  provider: string;
  persistenceMode: string;
  tableCount: number;
  tenantScopedCount: number;
  tableNames: readonly string[];
}>;

export function projectPostgresContract(source: PostgresContractProjectionSource): PostgresContractView {
  return {
    provider: source.provider,
    persistenceMode: source.persistenceMode,
    tableCount: source.tables.length,
    tenantScopedCount: source.tables.filter((table) => table.tenantScoped).length,
    tableNames: source.tables.map((table) => table.name)
  };
}
