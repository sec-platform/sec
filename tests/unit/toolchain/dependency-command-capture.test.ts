import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';

// The delayed domain records only; no real dependency cleanup is performed.
// Native cwd changes and the actual Commander action execute in a child.
test('dependency clean captures request before delayed loading and cwd change', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-dependency-command-'));
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  try {
    const decoy = path.join(root, 'decoy'); await mkdir(decoy);
    const script = path.join(root, 'capture.ts');
    await writeFile(script, `
      import { Command } from ${JSON.stringify(path.join(repo, 'node_modules/commander/index.js'))};
      import { registerCommands } from ${JSON.stringify(path.join(repo, 'src/bootstrap/cli/register-commands.ts'))};
      const primary = Object.freeze({ result: 'recorded' });
      let observed, release, started;
      const loading = new Promise(resolve => { started = resolve; });
      const pendingDomain = new Promise(resolve => { release = resolve; });
      const record = async (root, options) => { observed = { root, options }; throw primary; };
      const program = new Command('sec').exitOverride();
      registerCommands(program, { loadDependencyEnvironmentDomain: () => { started(); return pendingDomain; } });
      const args = ['deps', 'clean', '--project'];
      const pending = program.parseAsync(args, { from: 'user' });
      await loading;
      process.chdir(${JSON.stringify(decoy)});
      {
        const clean = program.commands.find(c => c.name() === 'deps').commands.find(c => c.name() === 'clean');
        Object.assign(clean.opts(), { project: false, all: true, force: true });
      }
      release({ cleanDependencyEnvironment: record });
      try { await pending; throw new Error('unexpected success'); }
      catch (error) { if (error !== primary) throw error; }
      if (observed.root !== ${JSON.stringify(root)}) throw new Error('dependency operation target changed during loading');
      if (observed.options.project !== true || observed.options.all || observed.options.force)
        throw new Error('cleanup scope was expanded during loading');
      console.log('original target and scope retained');
    `);
    const { code, stdout, stderr } = await runRetainedBunTestCommand([script], { cwd: root });
    expect(code, stderr).toBe(0); expect(stdout.trim()).toBe('original target and scope retained');
  } finally { await rm(root, { recursive: true, force: true }); }
});
