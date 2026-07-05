from pathlib import Path

TARGETS = (
    'tests/contract/reference.test.ts',
    'tests/integration/overview.test.ts',
    'tests/contract/ci-contract.test.ts',
    'tests/testkit/contracts.ts',
    'tests/contract/benchmark-budget.test.ts',
    'tests/e2e/demo-doctor.test.ts',
    'tests/unit/project-overview.test.ts',
    'tests/contract/error-protocol.test.ts',
)

OLD = 'bun run platform --'
NEW = 'bun run sec --'

changed = []
for relative_path in TARGETS:
    path = Path(relative_path)
    source = path.read_text(encoding='utf-8')
    migrated = source.replace(OLD, NEW)
    if migrated != source:
        path.write_text(migrated, encoding='utf-8')
        changed.append(relative_path)

print(f'migrated canonical CLI literals in {len(changed)} files')
for relative_path in changed:
    print(relative_path)
