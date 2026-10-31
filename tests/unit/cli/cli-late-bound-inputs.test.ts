import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRetainedBunTestWorkspace } from '../../testkit/process-resource.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const source = (relative: string) => JSON.stringify(path.join(repo, relative));
async function runCase(body: (root: string, decoy: string) => string) {
  await runRetainedBunTestWorkspace('sec-cli-input-', async root => {
    const decoy = path.join(root, 'decoy'); await mkdir(decoy);
    const script = path.join(root, 'case.ts');
    await writeFile(script, body(root, decoy));
    return { args: [script], observe: ({ code, stdout, stderr }) => {
      expect(code, stderr).toBe(0); expect(stdout.trim()).toBe('bound request retained');
    } };
  });
}

test('dependency root and output format are fixed before asynchronous domain loading', async () => {
  await runCase((root, decoy) => `
    import { Command } from ${source('node_modules/commander/index.js')};
    import { deepStrictEqual } from 'node:assert';
    import { format } from 'node:util';
    import { registerCommands } from ${source('src/bootstrap/cli/register-commands.ts')};
    const outputs = [], originalLog = console.log;
    console.log = (...args) => outputs.push(format(...args));
    const value = { result: 'captured' }, read = async () => value;
    const rootedRead = async (workspaceRoot) => {
      deepStrictEqual(workspaceRoot, ${JSON.stringify(root)});
      return value;
    };
    const domain = { getDoctorReport: rootedRead, getDependencyEnvironmentStatus: rootedRead,
      getDependencyFreshness: read, warmupDependencyEnvironment: rootedRead,
      relinkProjectDependencies: rootedRead };
    for (const name of ['doctor', 'status', 'freshness', 'warmup', 'relink']) {
      process.chdir(${JSON.stringify(root)});
      const program = new Command('sec').exitOverride();
      registerCommands(program, { loadDependencyEnvironmentDomain: async () => {
        await Promise.resolve();
        process.chdir(${JSON.stringify(decoy)});
        const command = name === 'doctor' ? program.commands.find(c => c.name() === name)
          : program.commands.find(c => c.name() === 'deps').commands.find(c => c.name() === name);
        command.opts().json = false;
        return domain;
      }});
      await program.parseAsync(name === 'doctor' ? [name, '--json'] : ['deps', name, '--json'], { from: 'user' });
      deepStrictEqual(JSON.parse(outputs.join('\\n')), { result: 'captured' });
      outputs.length = 0;
    }
    originalLog('bound request retained');
  `);
});

for (const operation of ['census', 'settlement']) {
  test(`${operation} keeps its captured request during asynchronous execution`, async () => {
    await runCase((root, decoy) => `
      import { mock } from 'bun:test';
      import { Command } from ${source('node_modules/commander/index.js')};
      const primary = Object.freeze({ result: 'recorded' });
      let observed, program;
      const perturb = () => {
        process.chdir(${JSON.stringify(decoy)});
        program.commands.find(c => c.name() === 'environment').commands.find(c => c.name() === 'settle').opts().fix = true;
      };
      const record = async (root, options) => {
        if (${operation === 'settlement'}) { await Promise.resolve(); perturb(); }
        observed = { root, options };
        throw primary;
      };
      const domains = await import(${source('src/bootstrap/cli/lazy-command-domains.ts')});
      mock.module(${source('src/bootstrap/cli/lazy-command-domains.ts')}, () => ({
        ...domains, runCensus: record, runSettlement: record
      }));
      mock.module(${source('src/bootstrap/cli/runtime/spinner.ts')}, () => ({
        withSpinner: async (text, execute) => {
          perturb();
          return execute();
        }
      }));
      const { registerCommands } = await import(${source('src/bootstrap/cli/register-commands.ts')});
      program = new Command('sec').exitOverride(); registerCommands(program);
      try {
        await program.parseAsync(${JSON.stringify(operation === 'census' ? ['text', 'census'] : ['environment', 'settle'])}, { from: 'user' });
        throw new Error('unexpected success');
      } catch (error) { if (error !== primary) throw error; }
      if (process.cwd() !== ${JSON.stringify(decoy)}) throw new Error('late input mutation did not occur');
      if (observed.root !== ${JSON.stringify(root)}) throw new Error('captured target changed');
      if (${operation === 'settlement'} && observed.options.fix !== false) throw new Error('fix scope expanded');
      console.log('bound request retained');
    `);
  });
}
