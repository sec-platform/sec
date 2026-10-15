import contract from '../../../generated/postgres-contract.json' with { type: 'json' };

type ReadonlyContract<T> = {
  readonly [Key in keyof T]: T[Key] extends object ? ReadonlyContract<T[Key]> : T[Key];
};

export type PostgresContract = ReadonlyContract<typeof contract>;

export const POSTGRES_CONTRACT: PostgresContract = contract;

export function listPostgresContractTables(): string[] {
  return POSTGRES_CONTRACT.tables.map((table) => table.name);
}
