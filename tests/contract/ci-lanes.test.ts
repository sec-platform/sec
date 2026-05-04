import { expect, test } from 'bun:test';

import { buildCiContract, formatCiContract } from '../../platform/shared/ci-contract.ts';

test('CI contract separates PR fast lane commands from full lane commands', () => {
  const contract = buildCiContract();

  expect(contract.prFastLaneCommands).toEqual([
    'bun install --frozen-lockfile',
    'bun run imports:organize',
    'bun scripts/ci-pr-gate.ts'
  ]);
  expect(contract.fullLaneCommands).toEqual([
    'bun install --frozen-lockfile',
    'bun run imports:organize',
    'bun run typecheck',
    'bun run platform -- test budget --json --compact',
    'bun run test:contract-freeze',
    'bun run test:slow -- --suite upgrade',
    'bun run test:slow -- --suite runtime',
    'bun run test:slow -- --suite pipeline',
    'bun run test:slow -- --suite repair',
    'bun run test:slow -- --suite registry',
    'bun run test:slow -- --suite explain',
    'bun run test:slow -- --suite other',
    'bun run platform -- benchmark suite --json --compact',
    'bun run platform -- deps warmup',
    'bun run platform -- resolve',
    'bun run platform -- compose',
    'bun run platform -- adapt',
    'bun run platform -- verify --lane all --json --compact',
    'bun run platform -- lock',
    'bun run platform -- explain',
    'bun run platform -- reference check --json --compact'
  ]);
});

test('CI contract defines PR full lane commands for impact-selected slow suites', () => {
  const contract = buildCiContract();

  expect(contract.prFullLaneCommands).toEqual([
    'bun install --frozen-lockfile',
    'bun scripts/ci-full-gate.ts'
  ]);
  expect(contract.prFullLaneCommandCount).toBe(2);
});

test('CI PR fast lane contract avoids full validation commands', () => {
  const contract = buildCiContract();

  expect(contract.prFastLaneCommands).toContain('bun scripts/ci-pr-gate.ts');
  expect(contract.prFastLaneCommands).toContain('bun run imports:organize');
  expect(contract.prFastLaneCommands).not.toContain('bun run imports:check');
  expect(contract.prFastLaneCommands).not.toContain('bun run platform -- verify --json --compact');
  expect(contract.prFastLaneCommands).not.toContain('bun run platform -- verify --lane all --json --compact');
  expect(contract.prFastLaneCommands).not.toContain('bun run test:slow');
});

test('CI full lane contract keeps complete validation coverage', () => {
  const contract = buildCiContract();

  expect(contract.fullLaneCommands).toContain('bun run typecheck');
  expect(contract.fullLaneCommands).toContain('bun run test:contract-freeze');
  expect(contract.fullLaneCommands).toContain('bun run test:slow -- --suite upgrade');
  expect(contract.fullLaneCommands).toContain('bun run test:slow -- --suite other');
  expect(contract.fullLaneCommands).toContain('bun run platform -- verify --lane all --json --compact');
  expect(contract.fullLaneCommands).toContain('bun run platform -- reference check --json --compact');
});

test('CI contract text exposes lane command split for workflow audits', () => {
  const formatted = formatCiContract(buildCiContract());

  expect(formatted).toContain('PR fast lane command count: 3');
  expect(formatted).toContain('PR fast lane commands: bun install --frozen-lockfile, bun run imports:organize, bun scripts/ci-pr-gate.ts');
  expect(formatted).toContain('PR full lane command count: 2');
  expect(formatted).toContain('PR full lane commands: bun install --frozen-lockfile, bun scripts/ci-full-gate.ts');
  expect(formatted).toContain('Full lane command count: 21');
  expect(formatted).toContain('Full lane commands: bun install --frozen-lockfile, bun run imports:organize, bun run typecheck');
});
