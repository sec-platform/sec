import { expect, test } from 'bun:test';
import { Command } from 'commander';
import { registerInspectionQuery } from '../../../src/entry/cli/inspection-query.ts';
import { runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const legacyModes = [
  ['policy', 'report'], ['acceptance', 'coverage'], ['runtime', 'report'],
  ['verification', 'report'], ['provenance', 'registry'], ['demo', 'checklist']
] as const;

for (const [command, mode] of legacyModes) {
  test(`${command} ${mode} preserves default routing for its available result`, async () => {
    await withTempWorkspace(async root => {
      // Output options are admitted first; missing reports reject in read() before view/render.
      const outputModes = command === 'demo' ? [[], ['--json'], ['--json', '--compact']] : [[]];
      for (const options of outputModes) {
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

test('explicit default mode invokes one read and the registered view', async () => {
  const root = new Command('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
  const failure = Object.freeze({ kind: 'view-result' });
  const events: string[] = [];
  const definition = {
    defaultMode: 'summary', read: () => { events.push('read'); return 7; },
    view: (value: number) => { expect(value).toBe(7); events.push('view'); throw failure; }
  };
  registerInspectionQuery(root.command('sample'), definition);
  await expect(root.parseAsync(['sample', 'summary'], { from: 'user' })).rejects.toBe(failure);
  expect(events).toEqual(['read', 'view']);
});
