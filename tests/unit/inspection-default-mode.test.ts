import { expect, test } from 'bun:test';
import { Command } from 'commander';
import { inspectionValue, registerInspectionQuery } from '../../src/entry/cli/inspection-query.ts';
import { runCliInProcess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const legacyModes = [
  ['policy', 'report'], ['acceptance', 'coverage'], ['runtime', 'report'],
  ['verification', 'report'], ['provenance', 'registry'], ['demo', 'checklist']
] as const;

for (const [command, mode] of legacyModes) {
  test(`${command} ${mode} preserves default routing and output in every output mode`, async () => {
    await withTempWorkspace(async root => {
      for (const options of [[], ['--json'], ['--json', '--compact']]) {
        const implicit = await runCliInProcess(root, [command, ...options]);
        const explicit = await runCliInProcess(root, [command, mode, ...options]);
        expect(explicit).toEqual(implicit);
        if (command === 'demo') expect(explicit.code).toBe(0);
        else {
          expect(explicit.code).toBe(1);
          expect(explicit.stderr).toContain('not found');
          expect(explicit.stderr).not.toContain('commander.');
        }
      }
    });
  });
}

test('default mode is captured once and invokes one read and the original view', async () => {
  const root = new Command('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
  const failure = Object.freeze({ kind: 'view-result' });
  const events: string[] = [];
  const definition = {
    defaultMode: 'summary', read: () => { events.push('read'); return 7; },
    view: (value: number) => { expect(value).toBe(7); events.push('view'); throw failure; }
  };
  registerInspectionQuery(root.command('sample'), definition);
  definition.defaultMode = 'changed';
  await expect(root.parseAsync(['sample', 'summary'], { from: 'user' })).rejects.toBe(failure);
  expect(events).toEqual(['read', 'view']);
});

test('invalid or conflicting default modes fail before command registration is mutated', () => {
  for (const defaultMode of ['', 7, 'detail']) {
    const command = new Command('sample');
    expect(() => registerInspectionQuery(command, {
      defaultMode: defaultMode as string, read: () => 1, view: v => inspectionValue(v, String),
      modes: { detail: v => inspectionValue(v, String) }
    })).toThrow(TypeError);
    expect(command.options).toHaveLength(0);
    expect(command.registeredArguments).toHaveLength(0);
  }
});
