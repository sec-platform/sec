import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';

import { CodedFailure } from '../../src/contracts/failure.ts';
import { addJsonFlags, jsonOpts } from '../../src/entry/cli/command-options.ts';
import { JSON_OUTPUT_OPTIONS, parseJsonOutputOptions, type JsonOutputIssue } from '../../src/entry/cli/json-output-options.ts';
import { parsePipelineOutputOptions } from '../../src/entry/cli/pipeline-command-input.ts';
import { registerPipelineCommands } from '../../src/entry/cli/register-pipeline-commands.ts';

const reject = (issue: JsonOutputIssue): never => { throw issue; };

const inertPipelineOperations = {
  compile: async () => { throw new Error('pipeline compile operation must not run'); },
  inspect: async () => { throw new Error('pipeline inspect operation must not run'); }
} as const;

test('shared output policy admits each boolean configuration', () => {
  for (const json of [undefined, false, true]) for (const compact of [undefined, false, true]) {
    if (compact === true && json !== true) continue;
    const input = { json, compact };
    const expected = { json: json ?? false, compact: compact ?? false };
    const actual = parseJsonOutputOptions(input, reject);
    assert.deepEqual(actual, expected);
    assert.ok(Object.isFrozen(actual));
  }
});

test('compact output requires JSON for both absent and disabled flags', () => {
  for (const json of [undefined, false]) {
    const input = { json, compact: true };
    assert.throws(() => parseJsonOutputOptions(input, reject),
      (issue: unknown) => (issue as JsonOutputIssue).kind === 'missing-dependency'
        && (issue as JsonOutputIssue).option === 'compact');
  }
});

test('shared non-boolean rejection retains each command diagnostic namespace', () => {
  for (const value of ['false', 'true', '', 0, 1, null, [], {}, new Boolean(false), Symbol('flag'), 1n, () => false]) {
    for (const field of ['json', 'compact']) {
      const input = { json: true, [field]: value };
      assert.throws(() => parseJsonOutputOptions(input, reject),
        (issue: unknown) => (issue as JsonOutputIssue).kind === 'invalid-boolean'
          && (issue as JsonOutputIssue).option === field);
    }
  }
  assert.throws(() => jsonOpts({ json: 'false' }),
    (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001');
  assert.throws(() => parsePipelineOutputOptions({ json: 'false' }),
    (error: unknown) => error instanceof CodedFailure && error.code === 'PIPELINE-USAGE-003');
});

test('owned input is read once, without enumerating unrelated properties', () => {
  let jsonReads = 0, compactReads = 0;
  const input = {
    get json() { jsonReads += 1; return true; },
    get compact() { compactReads += 1; return false; },
    get unrelated() { throw new Error('not output policy'); }
  };
  assert.deepEqual(parseJsonOutputOptions(input, reject), { json: true, compact: false });
  assert.equal(jsonReads, 1); assert.equal(compactReads, 1);
});

test('no conversion, serialization or valueOf hook participates in admission', () => {
  let conversions = 0;
  const input = { json: {
    toString() { conversions += 1; return 'true'; },
    valueOf() { conversions += 1; return true; },
    toJSON() { conversions += 1; return true; },
    [Symbol.toPrimitive]() { conversions += 1; return true; }
  } };
  assert.throws(() => parseJsonOutputOptions(input, reject));
  assert.equal(conversions, 0);
});

test('captured output is independent of later caller mutation', () => {
  const input = { json: true, compact: false };
  const output = jsonOpts(input);
  input.json = false;
  assert.equal(output.json, true);
  assert.equal(Reflect.set(output, 'compact', true), false);
});

test('defaults and dependency descriptions cannot be changed after registration', () => {
  assert.ok(Object.isFrozen(JSON_OUTPUT_OPTIONS));
  for (const definition of JSON_OUTPUT_OPTIONS) {
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.requires));
  }
});

test('real Commander action is not entered when a generic output flag is invalid', async () => {
  let effects = 0;
  const command = addJsonFlags(new Command().name('sample').exitOverride());
  command.action(() => { effects += 1; });
  command.setOptionValue('json', 'false');
  await assert.rejects(command.parseAsync([], { from: 'user' }),
    (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001');
  assert.equal(effects, 0);
});

test('generic compact dependency retains the real command path in its usage error', async () => {
  const program = new Command().name('renamed').exitOverride();
  addJsonFlags(program.command('parent').command('inspect')).action(() => assert.fail('not admitted'));
  await assert.rejects(program.parseAsync(['parent', 'inspect', '--compact'], { from: 'user' }),
    (error: unknown) => {
      assert.equal((error as { code: string }).code, 'CLI-USAGE-001');
      const message = (error as Error).message;
      assert.match(message, /renamed\s+parent\s+inspect/);
      assert.ok(message.includes('--json'));
      assert.ok(message.includes('--compact'));
      return true;
    });
});

test('valid flags execute the actual selected action exactly once', async () => {
  for (const args of [[], ['--json'], ['--json', '--compact']]) {
    let effects = 0;
    const command = addJsonFlags(new Command().name('sample').exitOverride());
    command.action((opts) => {
      effects += 1;
      assert.deepEqual(jsonOpts(opts), { json: args.includes('--json'), compact: args.includes('--compact') });
    });
    await command.parseAsync(args, { from: 'user' });
    assert.equal(effects, 1);
  }
});

test('pipeline registration consumes the same flags but preserves pipeline error codes', async () => {
  for (const path of [['compile'], ['pipeline', 'inspect']]) {
    const program = new Command().name('sec').exitOverride();
    registerPipelineCommands(program, inertPipelineOperations);
    let selected = program;
    for (const name of path) selected = selected.commands.find((child) => child.name() === name)!;
    selected.setOptionValue('json', 'false');
    await assert.rejects(program.parseAsync(path, { from: 'user' }),
      (error: unknown) => (error as { code: string }).code === 'PIPELINE-USAGE-003');
  }
});

test('diagnostic adapter preserves the original thrown value', () => {
  const reason = Object.freeze({ origin: 'caller diagnostic' });
  assert.throws(() => parseJsonOutputOptions({ json: 'invalid' }, () => { throw reason; }),
    (error: unknown) => error === reason);
});
