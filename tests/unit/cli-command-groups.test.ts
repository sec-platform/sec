import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { commandFromRoot, commandPath, jsonOpts, optionalModeCommand } from '../../src/entry/cli/command-options.ts';
import { registerInspectionCommands } from '../../src/bootstrap/cli/register-inspection-commands.ts';
import { registerWorkspaceCommands } from '../../src/bootstrap/cli/register-workspace-commands.ts';

function program() {
  let output = '';
  const command = new Command().name('sec').exitOverride().configureOutput({
    writeOut: (value) => { output += value; }, writeErr: (value) => { output += value; }
  });
  registerWorkspaceCommands(command);
  registerInspectionCommands(command);
  return { command, output: () => output };
}

test('workspace and inspection help do not load their execution or artifact readers', async () => {
  const names = ['', ...program().command.commands.map((command) => command.name())];
  for (const name of names) {
    const { command, output } = program();
    await assert.rejects(command.parseAsync([...(name ? [name] : []), '--help'], { from: 'user' }),
      (error: unknown) => (error as { code?: string }).code === 'commander.helpDisplayed');
    assert.match(output(), /Usage:/);
  }
});

for (const name of ['verify', 'repair', 'upgrade', 'lock', 'explain', 'artifacts', 'policy', 'acceptance', 'runtime', 'verification', 'provenance', 'review', 'demo', 'overview', 'install', 'blocks', 'postgres']) {
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

test('command paths use the actual root name and parent chain', () => {
  const root=new Command().name('renamed');
  const child=root.command('parent').command('child');
  assert.equal(commandPath(child), 'renamed parent child');
  assert.equal(commandFromRoot(child, 'verify'), 'renamed verify');
});

test('optional argument choice registration does not mutate its caller-owned list', () => {
  const choices=Object.freeze(['inspect', 'list']);
  const command=optionalModeCommand(new Command().name('sample'), 'mode', choices);
  assert.deepEqual(command.registeredArguments[0]!.argChoices, ['inspect','list']);
  assert.deepEqual(choices,['inspect','list']);
});

test('JSON output flags retain ordinary CLI booleans', () => {
  assert.deepEqual(jsonOpts({}), { json:false, compact:false });
  assert.deepEqual(jsonOpts({json:true}), {json:true, compact:false});
  assert.deepEqual(jsonOpts({json:true,compact:true}), {json:true,compact:true});
});
