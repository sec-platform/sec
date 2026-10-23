import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { registerInspectionCommands } from '../../../src/bootstrap/cli/register-inspection-commands.ts';
import { registerWorkspaceCommands } from '../../../src/bootstrap/cli/register-workspace-commands.ts';
import { optionalModeCommand } from '../../../src/entry/cli/command-options.ts';

function program() {
  let output = '';
  const command = new Command().name('sec').exitOverride().configureOutput({
    writeOut: (value) => { output += value; }, writeErr: (value) => { output += value; }
  });
  registerWorkspaceCommands(command);
  registerInspectionCommands(command);
  return { command, output: () => output };
}

test('workspace and inspection commands expose native help', async () => {
  const names = ['', ...program().command.commands.map((command) => command.name())];
  for (const name of names) {
    const { command, output } = program();
    await assert.rejects(command.parseAsync([...(name ? [name] : []), '--help'], { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === 'commander.helpDisplayed');
    assert.match(output(), /Usage:/);
  }
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

test('verification rejects an unknown lane before loading its executor', async () => {
  const { command } = program();
  await assert.rejects(command.parseAsync(['verify', '--lane', 'unknown'], { from: 'user' }),
    (error: unknown) => (error as { code?: string }).code === 'CLI-USAGE-001');
});

for (const name of ['repair','lock','explain','artifacts','policy','acceptance','runtime','review','contract']) {
  test(`${name} rejects an invalid mode through the existing argument parser`, async () => {
    const { command } = program();
    await assert.rejects(command.parseAsync([name, 'not-a-mode'], { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === 'commander.invalidArgument');
  });
}

test('optional argument choice registration does not mutate its caller-owned list', () => {
  const choices=Object.freeze(['inspect', 'list']);
  const command=optionalModeCommand(new Command().name('sample'), 'mode', choices);
  assert.deepEqual(command.registeredArguments[0]!.argChoices, ['inspect','list']);
  assert.deepEqual(choices,['inspect','list']);
});
