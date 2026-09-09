import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { registerPipelineCommands } from '../../src/interface/cli/register-pipeline-commands.ts';

function program() {
  let text = '';
  const command = new Command().name('sec').exitOverride().configureOutput({
    writeOut: (value) => { text += value; }, writeErr: (value) => { text += value; }
  });
  registerPipelineCommands(command);
  return { command, output: () => text };
}

for (const args of [['--help'], ['compile', '--help'], ['pipeline', '--help'], ['pipeline', 'inspect', '--help']]) {
  test(`renders ${args.join(' ')} without executing a workspace action`, async () => {
    const { command, output } = program();
    await assert.rejects(command.parseAsync(args, { from: 'user' }), (error: unknown) => (error as { code?: string }).code === 'commander.helpDisplayed');
    assert.match(output(), /Usage:/);
  });
}

for (const [args, code] of [
  [['compile', '--from', 'unknown'], 'PIPELINE-USAGE-001'],
  [['compile', '--through', 'unknown'], 'PIPELINE-USAGE-001'],
  [['compile', '--lane', 'unknown'], 'PIPELINE-USAGE-002'],
  [['compile', '--compact'], 'PIPELINE-USAGE-003'],
  [['pipeline', 'inspect', '--compact'], 'PIPELINE-USAGE-003']
] as const) {
  test(`rejects ${args.join(' ')} before loading the requested executor`, async () => {
    const { command } = program();
    await assert.rejects(command.parseAsync([...args], { from: 'user' }), (error: unknown) => (error as { code?: string }).code === code);
  });
}

test('programmatic lane values do not execute their coercion hooks', async () => {
  const { command } = program();
  let converted = false;
  const compile = command.commands.find((child) => child.name() === 'compile')!;
  compile.setOptionValue('lane', { toString() { converted = true; return 'all'; } });
  await assert.rejects(command.parseAsync(['compile'], { from: 'user' }), (error: unknown) => (error as { code?: string }).code === 'PIPELINE-USAGE-002');
  assert.equal(converted, false);
});

test('programmatic string booleans cannot select a different output mode', async () => {
  const { command } = program();
  const compile = command.commands.find((child) => child.name() === 'compile')!;
  compile.setOptionValue('json', 'false');
  await assert.rejects(command.parseAsync(['compile'], { from: 'user' }), (error: unknown) => (error as { code?: string }).code === 'PIPELINE-USAGE-003');
});
