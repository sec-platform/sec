import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative: string) => JSON.stringify(path.join(repo, relative));
async function runCase(body: (root: string, decoy: string) => string) {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-cli-input-'));
  try {
    const decoy = path.join(root, 'decoy'); await mkdir(decoy);
    const script = path.join(root, 'case.ts');
    await writeFile(script, body(root, decoy));
    const child = Bun.spawn([process.execPath, script], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0); expect(stdout.trim()).toBe('bound request retained');
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('dependency output format is fixed before asynchronous domain loading', async () => {
  await runCase(() => `
    import { Command } from ${source('node_modules/commander/index.js')};
    import { registerCommands } from ${source('src/bootstrap/cli/register-commands.ts')};
    const outputs = [], originalLog = console.log;
    console.log = value => outputs.push(value);
    const value = { result: 'captured' }, read = async () => value, format = () => 'late text';
    const domain = { getDoctorReport: read, getDependencyEnvironmentStatus: read,
      getDependencyFreshness: read, warmupDependencyEnvironment: read,
      relinkProjectDependencies: read, formatDoctorReport: format,
      formatDependencyEnvironmentStatus: format, formatDependencyFreshnessDecision: format };
    for (const name of ['doctor', 'status', 'freshness', 'warmup', 'relink']) {
      const program = new Command('sec').exitOverride();
      registerCommands(program, { loadDependencyEnvironmentDomain: async () => {
        const command = name === 'doctor' ? program.commands.find(c => c.name() === name)
          : program.commands.find(c => c.name() === 'deps').commands.find(c => c.name() === name);
        command.opts().json = false;
        return domain;
      }});
      await program.parseAsync(name === 'doctor' ? [name, '--json'] : ['deps', name, '--json'], { from: 'user' });
      if (outputs.pop() !== JSON.stringify(value, null, 2)) throw new Error(name + ' changed output mode after loading');
    }
    originalLog('bound request retained');
  `);
});

for (const operation of ['census', 'settlement']) {
  test(`${operation} keeps its target and fix flag across optional progress loading`, async () => {
    await runCase((root, decoy) => `
      import { mock } from 'bun:test';
      import { Command } from ${source('node_modules/commander/index.js')};
      const primary = Object.freeze({ result: 'recorded' });
      let observed, program;
      const record = async (root, options) => { observed = { root, options }; throw primary; };
      const domains = await import(${source('src/bootstrap/cli/lazy-command-domains.ts')});
      mock.module(${source('src/bootstrap/cli/lazy-command-domains.ts')}, () => ({
        ...domains, runCensus: record, runSettlement: record
      }));
      mock.module(${source('src/bootstrap/cli/runtime/spinner.ts')}, () => ({
        withSpinner: async (text, execute) => {
          process.chdir(${JSON.stringify(decoy)});
          program.commands.find(c => c.name() === 'environment').commands.find(c => c.name() === 'settle').opts().fix = true;
          return execute();
        }
      }));
      const { registerCommands } = await import(${source('src/bootstrap/cli/register-commands.ts')});
      program = new Command('sec').exitOverride(); registerCommands(program);
      try {
        await program.parseAsync(${JSON.stringify(operation === 'census' ? ['text', 'census'] : ['environment', 'settle'])}, { from: 'user' });
        throw new Error('unexpected success');
      } catch (error) { if (error !== primary) throw error; }
      if (observed.root !== ${JSON.stringify(root)}) throw new Error('target changed during progress loading');
      if (${operation === 'settlement'} && observed.options.fix !== false) throw new Error('fix scope expanded');
      console.log('bound request retained');
    `);
  });
}
