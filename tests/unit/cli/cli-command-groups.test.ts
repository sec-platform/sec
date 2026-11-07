import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { registerInspectionCommands } from '../../../src/bootstrap/cli/register-inspection-commands.ts';
import { registerWorkspaceCommands } from '../../../src/bootstrap/cli/register-workspace-commands.ts';

function program(name = 'sec') {
  let output = '';
  const command = new Command().name(name).exitOverride().configureOutput({
    writeOut: (value) => { output += value; }, writeErr: (value) => { output += value; }
  });
  registerWorkspaceCommands(command);
  registerInspectionCommands(command);
  return { command, output: () => output };
}

test('workspace and inspection commands expose native help', async () => {
  // Explicit public entrypoint inventory: deriving this from registered
  // commands would silently skip a command accidentally removed by production.
  const names = [
    '', 'init', 'add', 'resolve', 'compose', 'verify',
    'repair', 'upgrade', 'lock', 'explain', 'artifacts',
    'policy', 'acceptance', 'runtime', 'verification', 'provenance',
    'review', 'demo', 'overview', 'install', 'blocks', 'contract', 'postgres'
  ];
  const { command, output } = program();
  assert.deepEqual(
    command.commands.map(command => command.name()).sort(),
    names.filter(Boolean).sort(),
    'every accepted public CLI command must remain registered'
  );
  const contract = command.commands.find(command => command.name() === 'contract');
  assert.deepEqual(contract?.registeredArguments[0]?.argChoices, ['errors', 'ci'],
    'both public contract inspection selectors must stay reachable');
  // The explicit inventory above owns reachability. Replaying Commander help
  // for every name adds no command-specific output or execution observation.
  await assert.rejects(command.parseAsync(['--help'], { from: 'user' }),
    (error: unknown) => (error as { code?: string }).code === 'commander.helpDisplayed');
  assert.match(output(), /Usage:/);
});

// Policy represents the standard inspection family, whose shared query registrar
// always installs output admission. Lock and explain share one registration loop.
// Keep the other independently wired registration sites exercised here.
for (const name of ['verify', 'repair', 'upgrade', 'lock', 'artifacts', 'policy', 'postgres']) {
  test(`${name} rejects compact-only output before reading a workspace`, async () => {
    const { command } = program();
    await assert.rejects(command.parseAsync([name, '--compact'], { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === 'CLI-USAGE-001');
  });
}

// The shared verify lane parser is already covered by
// tests/unit/verification/verification-lane-policy.test.ts; native invalid
// lane CLI transport is covered by tests/contract/cli/usage.test.ts.
// This suite keeps distinct Commander registrations, not another echo.
// Shared inspection/named-query rejection is exercised at its actual registrar;
// lock/explain are one loop. Keep the independent mutation/manifest grammars.
for (const [args, expectedCode] of [
  ...['repair','lock','artifacts']
    .map(name => [[name, 'not-a-mode'], 'commander.invalidArgument'] as const),
  [['upgrade', '--dry-run'], 'CLI-USAGE-001'],
  [['upgrade', 'a-block', '--dry-run'], 'CLI-USAGE-001']
] as const) {
  test(`${args.join(' ')} rejects incomplete or invalid arguments before loading a domain`, async () => {
    const renamedRoot = args[0] === 'upgrade' && args[1] === '--dry-run';
    const { command } = program(renamedRoot ? 'custom' : 'sec');
    await assert.rejects(command.parseAsync([...args], { from: 'user' }),
      (error: unknown) => {
        if ((error as { code?: string }).code !== expectedCode) return false;
        if (args[0] === 'upgrade') {
          assert.match((error as Error).message, renamedRoot ? /^Usage: custom upgrade /u : /^Usage: sec upgrade /u);
        }
        return true;
      });
  });
}
