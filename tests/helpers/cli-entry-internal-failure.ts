import { runCli } from '../../src/entry/cli/cli.ts';

await runCli({
  version: '0.0.0',
  register(program) {
    program.command('fail').action(() => {
      throw new Error('usage-contract-internal-failure');
    });
  }
});
