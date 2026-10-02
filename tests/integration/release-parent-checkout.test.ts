import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { runObservedCommand } from '../../src/adapters/runtime-state/physical/runtime/observed-process-stdin.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// This executes the shell of the Linux-only release workflow. Other platforms
// retain the portable CI contract cases; skipping this case is not qualification.
test.skipIf(process.platform !== 'linux')('release parent checkout is locally complete and rejects wrong or missing objects', async () => {
  const release = parseYaml(await readCompilerFile('.github/workflows/compiler-release-validation.yml'));
  const script: unknown = release.jobs['compiler-release-verification'].steps.find(
    (step: { name?: string }) => step.name === 'Verify checked-out release parent and tree'
  )?.run;
  if (typeof script !== 'string') throw new Error('Missing local release-parent check.');
  await withTempWorkspace(async root => {
    const source = path.join(root, 'source');
    const checkout = path.join(root, 'checkout');
    const shallow = path.join(root, 'shallow');
    const execute = async (cwd: string, command: string, args: string[], env: Record<string, string> = {}) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const outcome = await runObservedCommand(command, args, {
        cwd,
        envMode: 'replace',
        env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0', ...env },
        timeoutMs: 10_000,
        terminationGraceMs: 100,
        terminationDeadlineMs: 2_000,
        maxObservedOutputBytes: 64 * 1024,
        onOutput: (stream, chunk) => (stream === 'stdout' ? stdout : stderr).push(Buffer.from(chunk))
      });
      if (!outcome.termination.treeClosed || !outcome.termination.childCloseObserved
        || !outcome.termination.streamsDrained || outcome.status !== 'exited') {
        throw new Error(`Release fixture process did not settle normally at ${root}: ${outcome.status}`);
      }
      return { status: outcome.exitCode, stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8') };
    };
    const git = async (cwd: string, args: string[]) => {
      const result = await execute(cwd, 'git', args);
      if (result.status !== 0) throw new Error(`Git fixture failed: ${result.stderr}`);
      return result.stdout;
    };
    mkdirSync(source);
    await git(source, ['init', '--quiet']);
    await git(source, ['config', 'user.email', 'release-parent@sec.invalid']);
    await git(source, ['config', 'user.name', 'SEC Release Parent Test']);
    const commits: string[] = [];
    for (const value of ['root', 'base', 'head']) {
      writeFileSync(path.join(source, 'value.txt'), value);
      await git(source, ['add', 'value.txt']);
      await git(source, ['commit', '--quiet', '-m', value]);
      commits.push(await git(source, ['rev-parse', 'HEAD']));
    }
    const [ancestor, base, head] = commits as [string, string, string];
    await git(root, ['clone', '--quiet', '--no-local', '--depth=2', '--no-tags', source, checkout]);
    await git(root, ['clone', '--quiet', '--no-local', '--depth=1', '--no-tags', source, shallow]);
    expect(await git(checkout, ['rev-parse', '--is-shallow-repository'])).toBe('true');
    expect(await git(checkout, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await git(checkout, ['cat-file', '-t', `${base}^{tree}`])).toBe('tree');
    // An unusable origin makes any renewed fetch fail; the selected parent remains local.
    for (const cwd of [checkout, shallow]) await git(cwd, ['remote', 'set-url', 'origin', path.join(root, 'absent-origin')]);
    const verify = (cwd: string, expectedHead: string, expectedBase: string) => execute(cwd, 'bash', [
      '--noprofile', '--norc', '-c', script
    ], { SEC_EXPECTED_HEAD_SHA: expectedHead, SEC_CHANGED_BASE: expectedBase });
    expect((await verify(checkout, head, base)).status).toBe(0);
    expect((await verify(checkout, base, base)).status).not.toBe(0);
    expect((await verify(checkout, head, head)).status).not.toBe(0);
    expect((await verify(checkout, head, ancestor)).status).not.toBe(0);
    expect((await verify(shallow, head, base)).status).not.toBe(0);

    const headTree = await git(source, ['rev-parse', `${head}^{tree}`]);
    const merge = await git(source, ['commit-tree', headTree, '-p', head, '-p', base, '-m', 'merge fixture']);
    await git(source, ['update-ref', 'HEAD', merge, head]);
    expect((await verify(source, merge, head)).status).not.toBe(0);
    await git(source, ['update-ref', 'HEAD', head, merge]);

    // Removing only this fixture's loose base tree leaves the parent commit
    // available, distinguishing tree availability from ancestry and commit checks.
    const baseTree = await git(source, ['rev-parse', `${base}^{tree}`]);
    rmSync(path.join(source, '.git', 'objects', baseTree.slice(0, 2), baseTree.slice(2)));
    expect(await git(source, ['cat-file', '-t', base])).toBe('commit');
    expect((await verify(source, head, base)).status).not.toBe(0);
  }, 'sec-release-parent-', { retainOnCallbackFailure: true });
}, 20_000);
