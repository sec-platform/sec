from pathlib import Path

register = Path('src/bootstrap/cli/register-inspection-commands.ts')
text = register.read_text()
old_import = "import type { PostgresContract } from './formatters.ts';\n"
new_import = "import type { PostgresContractProjectionSource } from '../../application/postgres-contract.ts';\n"
assert text.count(old_import) == 1
text = text.replace(old_import, new_import)

start = text.index("  addJsonFlags(program.command('postgres')).action(")
end = text.index("\n  });\n}", start) + len("\n  });")
old_block = text[start:end]
assert "formatPostgresContract } = await import('./formatters.ts')" in old_block
assert "printGeneratedContract<PostgresContract>" in old_block
replacement = """  addJsonFlags(program.command('postgres')).action(async (rawOptions: Record<string, unknown>, cmd: Command) => {
    const cwd = process.cwd();
    const output = jsonOpts(captureJsonOutputInput(rawOptions, 'own-enumerable'));
    const missingMessage = `Postgres contract not found; run ${commandFromRoot(cmd, 'compose')} first`;
    const { projectPostgresContract } = await import('../../application/postgres-contract.ts');
    const { formatPostgresContract } = await import('../../entry/cli/postgres-contract.ts');
    const { printGeneratedContract } = await import('./artifact-command-read.ts');
    await printGeneratedContract<PostgresContractProjectionSource>(
      cwd,
      missingMessage,
      output,
      (contract) => formatPostgresContract(projectPostgresContract(contract)),
      (contract) => contract.provider === 'postgres'
    );
  });"""
register.write_text(text[:start] + replacement + text[end:])

formatters = Path('src/bootstrap/cli/formatters.ts')
text = formatters.read_text()
type_start = text.index('export type PostgresContract = {')
type_end = text.index('type RuntimeStepInspect = {', type_start)
text = text[:type_start] + text[type_end:]
fn_start = text.index('export function formatPostgresContract(')
fn_end = text.index('export function formatLockInspect(', fn_start)
text = text[:fn_start] + text[fn_end:]
assert 'export type PostgresContract' not in text
assert 'export function formatPostgresContract' not in text
formatters.write_text(text)
