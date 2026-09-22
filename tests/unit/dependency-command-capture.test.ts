import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The delayed domain records only; no real dependency cleanup is performed.
// Native cwd changes and the actual Commander action execute in a child.
for (const [name, changeRoot] of [
  ['doctor', true], ['status', true], ['warmup', true], ['relink', true],
  ['clean', true], ['clean', false]
] as const) {
  test(`dependency ${name} captures request with cwd change=${changeRoot}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-dependency-command-'));
    const repo = fileURLToPath(new URL('../../', import.meta.url));
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
        const name = ${JSON.stringify(name)};
        const args = name === 'doctor' ? ['doctor', '--json'] : ['deps', name, ...(name === 'clean' ? ['--project'] : ['--json'])];
        const pending = program.parseAsync(args, { from: 'user' });
        await loading;
        if (${changeRoot}) process.chdir(${JSON.stringify(decoy)});
        if (name === 'clean') {
          const clean = program.commands.find(c => c.name() === 'deps').commands.find(c => c.name() === 'clean');
          Object.assign(clean.opts(), { project: false, all: true, force: true });
        }
        release({ getDoctorReport: record, getDependencyEnvironmentStatus: record,
          warmupDependencyEnvironment: record, relinkProjectDependencies: record,
          cleanDependencyEnvironment: record });
        try { await pending; throw new Error('unexpected success'); }
        catch (error) { if (error !== primary) throw error; }
        if (observed.root !== ${JSON.stringify(root)}) throw new Error('dependency operation target changed during loading');
        if (name === 'clean' && (observed.options.project !== true || observed.options.all || observed.options.force))
          throw new Error('cleanup scope was expanded during loading');
        console.log('original target and scope retained');
      `);
      const child = Bun.spawn([process.execPath, script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code, stderr).toBe(0); expect(stdout.trim()).toBe('original target and scope retained');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
