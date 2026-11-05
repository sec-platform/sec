import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

import { runObservedCommand } from '../../../src/adapters/runtime-state/physical/runtime/observed-process-stdin.ts';
import { readCompilerFile } from '../../helpers/compiler-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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
    const execute = async (cwd: string, command: string, args: string[], env: Record<string, string> = {}, input?: Uint8Array) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const outcome = await runObservedCommand(command, args, {
        cwd,
        envMode: 'replace',
        env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_TERMINAL_PROMPT: '0', ...env },
        ...(input === undefined ? {} : { input, maxStdinBytes: 16 * 1024 }),
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
    const git = async (cwd: string, args: string[], input?: Uint8Array) => {
      // Keep native author/committer identity scoped to every fixture Git
      // operation, including commit-tree, without mutable local config setup.
      const result = await execute(cwd, 'git', [
        '-c', 'user.email=release-parent@sec.invalid',
        '-c', 'user.name=SEC Release Parent Test',
        ...args
      ], {}, input);
      if (result.status !== 0) throw new Error(`Git fixture failed: ${result.stderr}`);
      return result.stdout;
    };
    mkdirSync(source);
    await git(source, ['init', '--quiet', '--initial-branch=main']);
    // One bounded native import establishes the three-commit parent graph.
    // Each fixture retains its own index, refs and loose worktree; the actual
    // shallow-checkout and release-script observations still use native Git.
    const history = ['root', 'base', 'head'] as const;
    const importRecords: string[] = [];
    for (const [index, value] of history.entries()) {
      importRecords.push(
        'commit refs/heads/main\n',
        `mark :${index + 1}\n`,
        `author SEC Release Parent Test <release-parent@sec.invalid> ${index + 1} +0000\n`,
        `committer SEC Release Parent Test <release-parent@sec.invalid> ${index + 1} +0000\n`,
        `data ${Buffer.byteLength(value)}\n${value}\n`,
        'M 100644 inline value.txt\n',
        `data ${Buffer.byteLength(value)}\n${value}\n`
      );
    }
    await git(source, ['fast-import', '--quiet'], Buffer.from(importRecords.join(''), 'utf8'));
    await git(source, ['read-tree', 'HEAD']);
    writeFileSync(path.join(source, 'value.txt'), history[history.length - 1]);
    const commitsNewestFirst = (await git(source, ['rev-list', '--max-count=3', 'HEAD'])).split('\n');
    expect(commitsNewestFirst).toHaveLength(3);
    const [head, base, ancestor] = commitsNewestFirst as [string, string, string];
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

    const [headTree, baseTree] = (await git(source, ['rev-parse', `${head}^{tree}`, `${base}^{tree}`])).split('\n');
    if (!headTree || !baseTree) throw new Error('Missing exact head or parent tree');
    const merge = await git(source, ['commit-tree', headTree, '-p', head, '-p', base, '-m', 'merge fixture']);
    await git(source, ['update-ref', 'HEAD', merge, head]);
    expect((await verify(source, merge, head)).status).not.toBe(0);
    await git(source, ['update-ref', 'HEAD', head, merge]);

    // Removing only this fixture's loose base tree leaves the parent commit
    // available, distinguishing tree availability from ancestry and commit checks.
    rmSync(path.join(source, '.git', 'objects', baseTree.slice(0, 2), baseTree.slice(2)));
    expect(await git(source, ['cat-file', '-t', base])).toBe('commit');
    expect((await verify(source, head, base)).status).not.toBe(0);
  }, 'sec-release-parent-', { retainOnCallbackFailure: true });
}, 20_000);
