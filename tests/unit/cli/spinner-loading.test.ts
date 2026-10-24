import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';

// Isolate loader failure from the other tests' module cache. The production
// wrapper, not a replacement execution function, owns the fallback boundary.
test('unavailable optional progress dependency cannot block or retry the requested action', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-spinner-load-'));
  try {
    const spinner = fileURLToPath(new URL('../../../src/bootstrap/cli/runtime/spinner.ts', import.meta.url));
    const script = path.join(root, 'spinner-loading.ts');
    await Bun.write(script, `
      import { mock } from 'bun:test';
      mock.module(${JSON.stringify(import.meta.resolve('ora'))}, () => { throw new Error('optional display unavailable'); });
      const { withSpinner } = await import(${JSON.stringify(spinner)});
      let calls = 0;
      const value = Object.freeze({ ok: true });
      if (await withSpinner('work', async () => { calls++; return value; }) !== value)
        throw new Error('result identity changed');
      const primary = Object.freeze({ failure: 'work' });
      for (const execute of [
        () => { calls++; throw primary; },
        async () => { calls++; throw primary; }
      ]) {
        try { await withSpinner('work', execute); throw new Error('unexpected success'); }
        catch (error) { if (error !== primary) throw new Error('primary failure replaced'); }
      }
      if (calls !== 3) throw new Error('action was omitted or repeated');
      console.log('completed once per request');
    `);
    const { code, stdout: out, stderr: err } = await runRetainedBunTestCommand([script], { cwd: root });
    expect(code, err).toBe(0);
    expect(out.trim()).toBe('completed once per request');
  } finally { await rm(root, { recursive: true, force: true }); }
});
