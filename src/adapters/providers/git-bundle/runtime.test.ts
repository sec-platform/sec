import { afterEach, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResourceCompositeSettlementError } from '../../../execution/resource-settlement.ts';
import { isGitCandidateBundleByteLength } from '../../runtime-state/physical/contract/git-bundle.ts';

import {
  assertGitCandidateBundleCurrent,
  assertGitCandidateBundleReceipt,
  assertGitCandidateCheckoutCurrent,
  assertGitCandidateCheckoutTreeInventory,
  closeGitCandidateBundle,
  createGitCandidateBundle,
  GitCandidateCheckoutCleanupUnknownError,
  readGitCandidateCheckout,
  withGitCandidateCheckout,
  type GitCandidateBundle,
  type GitCandidateCheckout
} from './runtime.ts';

const roots: string[] = [];

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `sec-git-bundle-${label}-`));
  roots.push(root);
  return root;
}

function git(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0'
    },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  if (result.exitCode !== 0) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  return new TextDecoder().decode(result.stdout).trim();
}

function repositoryFixture(): Readonly<{
  root: string;
  baseSha: string;
  headSha: string;
}> {
  const root = temporaryRoot('repository');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'SEC Test']);
  git(root, ['config', 'user.email', 'sec-test@example.invalid']);
  writeFileSync(path.join(root, 'value.txt'), 'base\n');
  git(root, ['add', '--', 'value.txt']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(root, 'value.txt'), 'head\n');
  git(root, ['commit', '--quiet', '-am', 'head']);
  return Object.freeze({ root, baseSha, headSha: git(root, ['rev-parse', 'HEAD']) });
}

afterEach(() => {
  for (const root of roots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Git candidate bundle effect', () => {
  test('shares the inclusive complete-history byte boundary with the native input consumer', () => {
    expect(isGitCandidateBundleByteLength(1)).toBe(true);
    expect(isGitCandidateBundleByteLength(16 * 1024 * 1024)).toBe(true);
    for (const invalid of [0, -1, 0.5, 16 * 1024 * 1024 + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isGitCandidateBundleByteLength(invalid)).toBe(false);
    }
  });

  test('retains complete history larger than eight MiB even when the current tree is small', async () => {
    const repository = repositoryFixture();
    const oldFile = path.join(repository.root, 'historical.bin');
    writeFileSync(oldFile, randomBytes(9 * 1024 * 1024));
    git(repository.root, ['add', '--', 'historical.bin']);
    git(repository.root, ['commit', '--quiet', '-m', 'historical content']);
    const historySha = git(repository.root, ['rev-parse', 'HEAD']);
    rmSync(oldFile);
    git(repository.root, ['commit', '--quiet', '-am', 'remove current content']);
    const headSha = git(repository.root, ['rev-parse', 'HEAD']);
    const outputRoot = temporaryRoot('complete-history');
    const bundle = await createGitCandidateBundle({ sourceRoot: repository.root,
      temporaryRoot: outputRoot, baseSha: headSha, headSha });
    try {
      expect(bundle.bundleSize).toBeGreaterThan(8 * 1024 * 1024);
      const restored = temporaryRoot('restored-history');
      git(restored, ['init', '--quiet']);
      git(restored, ['fetch', '--quiet', bundle.bundlePath, 'refs/sec/head']);
      expect(git(restored, ['rev-parse', 'FETCH_HEAD'])).toBe(headSha);
      expect(git(restored, ['cat-file', '-s', `${historySha}:historical.bin`])).toBe(String(9 * 1024 * 1024));
      expect(git(restored, ['ls-tree', '--name-only', 'FETCH_HEAD'])).not.toContain('historical.bin');
    } finally {
      assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
    }
  });

  test('rejects history exceeding sixteen MiB without publishing a partial bundle', async () => {
    const repository = repositoryFixture();
    writeFileSync(path.join(repository.root, 'large.bin'), randomBytes(17 * 1024 * 1024));
    git(repository.root, ['add', '--', 'large.bin']);
    git(repository.root, ['commit', '--quiet', '-m', 'oversized history']);
    const headSha = git(repository.root, ['rev-parse', 'HEAD']);
    const outputRoot = temporaryRoot('oversized-history');
    await expect(createGitCandidateBundle({ sourceRoot: repository.root,
      temporaryRoot: outputRoot, baseSha: headSha, headSha })).rejects.toThrow('stdout exceeded 16777216 bytes');
    expect(existsSync(path.join(outputRoot, 'candidate.bundle'))).toBe(false);
    expect(git(repository.root, ['cat-file', '-s', `${headSha}:large.bin`])).toBe(String(17 * 1024 * 1024));
  });

  test('publishes one verified retained bundle for the exact base and head', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('output');
    let bundle: GitCandidateBundle | null = null;
    try {
      bundle = await createGitCandidateBundle({
        sourceRoot: repository.root,
        temporaryRoot: outputRoot,
        baseSha: repository.baseSha,
        headSha: repository.headSha
      });
      expect(bundle.bundlePath).toBe(path.join(outputRoot, 'candidate.bundle'));
      expect(bundle.bundleSize).toBeGreaterThan(0);
      expect(bundle.bundleDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
      const borrowed = assertGitCandidateBundleCurrent(bundle);
      expect(borrowed.digest().byteDigest).toBe(bundle.bundleDigest);
      expect(assertGitCandidateBundleCurrent(bundle)).toBe(borrowed);
      expect(() => assertGitCandidateBundleCurrent(Object.freeze({ ...bundle! })))
        .toThrow('current owner-issued retained capability');
      const heads = git(outputRoot, ['bundle', 'list-heads', bundle.bundlePath]);
      expect(heads.split('\n').sort()).toEqual([
        `${repository.baseSha} refs/sec/base`,
        `${repository.headSha} refs/sec/head`
      ].sort());

      const receipt = closeGitCandidateBundle(bundle);
      assertGitCandidateBundleReceipt(receipt, bundle);
      expect(() => assertGitCandidateBundleCurrent(bundle!))
        .toThrow('current owner-issued retained capability');
      expect(readFileSync(bundle.bundlePath).byteLength).toBe(bundle.bundleSize);
      expect(() => assertGitCandidateBundleReceipt(receipt, Object.freeze({ ...bundle! }))).toThrow(
        'owner-issued terminal settlement'
      );
      expect(closeGitCandidateBundle(bundle)).toBe(receipt);
      bundle = null;
    } finally {
      if (bundle !== null) closeGitCandidateBundle(bundle);
    }
  });

  test('rejects an occupied fixed output without replacing its bytes', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('occupied');
    const occupied = path.join(outputRoot, 'candidate.bundle');
    writeFileSync(occupied, 'foreign\n');

    await expect(createGitCandidateBundle({
      sourceRoot: repository.root,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha,
      headSha: repository.headSha
    })).rejects.toThrow('file target must be absent');
    expect(readFileSync(occupied, 'utf8')).toBe('foreign\n');
    expect(() => readFileSync(path.join(outputRoot, 'bundle-source.git'))).toThrow();
  });

  test('reads a linked worktree through its retained common directory instead of mutable pointer files', async () => {
    const repository = repositoryFixture();
    const worktreeParent = temporaryRoot('worktree-parent');
    const sourceRoot = path.join(worktreeParent, 'source');
    git(repository.root, ['worktree', 'add', '--quiet', '--detach', sourceRoot, repository.headSha]);
    const outputRoot = temporaryRoot('worktree-output');
    const bundle = await createGitCandidateBundle({
      sourceRoot,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha,
      headSha: repository.headSha
    });
    try {
      expect(git(outputRoot, ['bundle', 'list-heads', bundle.bundlePath]).split('\n').sort()).toEqual([
        `${repository.baseSha} refs/sec/base`,
        `${repository.headSha} refs/sec/head`
      ].sort());
    } finally {
      assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle);
    }
  });

  test('rejects noncanonical revisions and forged retained capabilities before Git effects', async () => {
    const repository = repositoryFixture();
    const outputRoot = temporaryRoot('invalid');
    await expect(createGitCandidateBundle({
      sourceRoot: repository.root,
      temporaryRoot: outputRoot,
      baseSha: repository.baseSha.toUpperCase(),
      headSha: repository.headSha
    })).rejects.toThrow('input is not canonical');
    expect(() => closeGitCandidateBundle(Object.freeze({
      bundlePath: path.join(outputRoot, 'candidate.bundle'),
      bundleSize: 1,
      bundleDigest: `sha256:${'0'.repeat(64)}`,
      baseSha: repository.baseSha,
      headSha: repository.headSha,
      objectFormat: 'sha1',
      materializationIdentityDigest: `sha256:${'1'.repeat(64)}`
    }))).toThrow('owner-issued retained capability');
  });
});


test('inherited bundle expiry and cancellation reject before source reads or output effects', async () => {
  const outputRoot = temporaryRoot('inherited-bound');
  const input = { sourceRoot: path.join(outputRoot, 'unread-source'), temporaryRoot: outputRoot,
    baseSha: '1'.repeat(40), headSha: '2'.repeat(40) };
  await expect(createGitCandidateBundle({ ...input, deadlineAtUnixMs: Date.now() - 1 }))
    .rejects.toThrow('inherited deadline is exhausted');
  expect(readdirSync(outputRoot)).toEqual([]);
  const controller = new AbortController();
  const reason = new Error('parent source cancelled'); controller.abort(reason);
  await expect(createGitCandidateBundle({ ...input, deadlineAtUnixMs: Date.now() + 2_000, signal: controller.signal }))
    .rejects.toBe(reason);
  expect(readdirSync(outputRoot)).toEqual([]);
});


describe('private candidate Git input lifetime', () => {
  test('preflights exact expanded tree bytes, directories and reserved materializer paths', () => {
    const entry = (size: string, name: string, mode = '100644') => `${mode} blob ${'1'.repeat(40)} ${size}\t${name}\0`;
    expect(() => assertGitCandidateCheckoutTreeInventory(entry('134217728', 'maximum'))).not.toThrow();
    expect(() => assertGitCandidateCheckoutTreeInventory(entry('3', 'link', '120000'))).not.toThrow();
    for (const invalid of [entry('134217729', 'oversize'), entry('9007199254740993', 'unsafe'),
      entry('1', '../escape'), entry('1', 'a/.git/config'), entry('1', '.sec-trusted-input/candidate.bundle'),
      entry('1', 'node_modules/x'), entry('1', 'x') + entry('1', 'x'),
      entry('1', 'a') + entry('1', 'a/b'), entry('1', 'a/b') + entry('1', 'a'),
      entry('1', 'x').slice(0, -1), entry('1', 'x', '160000')]) {
      expect(() => assertGitCandidateCheckoutTreeInventory(invalid)).toThrow();
    }
    expect(() => assertGitCandidateCheckoutTreeInventory(Array.from({ length: 100_001 },
      (_, index) => entry('0', `d${index}/file`)).join(''))).toThrow('bound exceeded');
  });

  test('expired, cancelled and noncanonical acquisition never reaches its borrower', async () => {
    const root = temporaryRoot('checkout-preflight');
    const input = { sourceRoot: path.join(root, 'unread'), baseSha: '1'.repeat(40), headSha: '2'.repeat(40),
      purpose: 'activation-static' as const, deadlineAtUnixMs: Date.now() + 60_000 };
    let calls = 0;
    const callback = async () => { calls += 1; };
    for (const delta of [{ deadlineAtUnixMs: Date.now() - 1 }, { baseSha: 'main' }, { headSha: 'A'.repeat(40) }]) {
      await expect(withGitCandidateCheckout({ ...input, ...delta }, callback)).rejects.toThrow();
    }
    const controller = new AbortController(), reason = new Error('caller revoked');
    controller.abort(reason);
    await expect(withGitCandidateCheckout({ ...input, signal: controller.signal }, callback)).rejects.toBe(reason);
    expect(calls).toBe(0);
    expect(readdirSync(root)).toEqual([]);
  });

  test('acquires an independent Git config and refs, keeps exact history, then retires its own generation', async () => {
    const repository = repositoryFixture();
    let borrowed: GitCandidateCheckout | undefined, generation = '';
    const value = await withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      borrowed = checkout; generation = path.dirname(checkout.candidateRoot);
      expect(checkout.candidateRoot).not.toBe(repository.root);
      expect(git(checkout.candidateRoot, ['rev-parse', '--absolute-git-dir'])).toBe(path.join(checkout.candidateRoot, '.git'));
      expect(git(checkout.candidateRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
        .toBe(path.join(checkout.candidateRoot, '.git'));
      expect(git(checkout.candidateRoot, ['rev-parse', 'HEAD'])).toBe(repository.headSha);
      expect(git(checkout.candidateRoot, ['rev-parse', 'HEAD^'])).toBe(repository.baseSha);
      expect(git(checkout.candidateRoot, ['for-each-ref', '--format=%(refname)'])).toBe('');
      expect(readFileSync(path.join(checkout.candidateRoot, '.git/config'), 'utf8')).not.toContain('SEC Test');
      expect(existsSync(path.join(checkout.candidateRoot, '.git/objects/info/alternates'))).toBe(false);
      expect(() => assertGitCandidateCheckoutCurrent({ ...checkout })).toThrow('original scope');
      // The original source may change after immutable acquisition. It is not
      // shared backing storage for this private callback's source or Git refs.
      writeFileSync(path.join(repository.root, 'value.txt'), 'borrowed source changed\n');
      expect(readFileSync(path.join(checkout.candidateRoot, 'value.txt'), 'utf8')).toBe('head\n');
      assertGitCandidateCheckoutCurrent(checkout);
      await Promise.resolve();
      assertGitCandidateCheckoutCurrent(checkout);
      return 'joined';
    });
    expect(value).toBe('joined');
    expect(existsSync(generation)).toBe(false);
    expect(() => assertGitCandidateCheckoutCurrent(borrowed!)).toThrow('original scope');
    expect(readFileSync(path.join(repository.root, 'value.txt'), 'utf8')).toBe('borrowed source changed\n');
  });

  test('same HEAD and tree cannot hide tracked bytes, config, extra refs or replacement common-directory drift', async () => {
    for (const mutation of ['source', 'config', 'ref', 'git-directory', 'source-mode', 'config-mode', 'root-mode'] as const) {
      const repository = repositoryFixture();
      await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
        purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        if (mutation === 'root-mode') chmodSync(checkout.candidateRoot, 0o755);
        if (mutation === 'source-mode') chmodSync(path.join(checkout.candidateRoot, 'value.txt'), 0o755);
        if (mutation === 'config-mode') chmodSync(path.join(checkout.candidateRoot, '.git/config'), 0o700);
        if (mutation === 'source') writeFileSync(path.join(checkout.candidateRoot, 'value.txt'), 'changed\n');
        if (mutation === 'config') writeFileSync(path.join(checkout.candidateRoot, '.git/config'),
          readFileSync(path.join(checkout.candidateRoot, '.git/config'), 'utf8') + '\n[core]\n\tignorecase = true\n');
        if (mutation === 'ref') git(checkout.candidateRoot, ['update-ref', 'refs/heads/foreign', repository.headSha]);
        if (mutation === 'git-directory') {
          renameSync(path.join(checkout.candidateRoot, '.git'), path.join(checkout.candidateRoot, 'moved-git'));
          writeFileSync(path.join(checkout.candidateRoot, '.git'), 'gitdir: moved-git\n');
        }
        {
          expect(git(checkout.candidateRoot, ['rev-parse', 'HEAD'])).toBe(repository.headSha);
          expect(git(checkout.candidateRoot, ['rev-parse', 'HEAD^{tree}'])).toBe(checkout.headTreeSha);
        }
        expect(() => assertGitCandidateCheckoutCurrent(checkout)).toThrow();
      })).rejects.toThrow();
    }
  });

  test('only the exact Action transport files and matching refs may be added by the borrower', async () => {
    const repository = repositoryFixture();
    for (const purpose of ['activation-static', 'action-materialization'] as const) {
      const run = withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
        purpose, deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        const trustedInput = path.join(checkout.candidateRoot, '.sec-trusted-input');
        mkdirSync(trustedInput);
        writeFileSync(path.join(trustedInput, 'candidate.bundle'), 'test transport bytes');
        writeFileSync(path.join(trustedInput, 'dependency-closure.json'), '{}\n');
        git(checkout.candidateRoot, ['update-ref', 'refs/sec/base', repository.baseSha]);
        git(checkout.candidateRoot, ['update-ref', 'refs/sec/head', repository.headSha]);
        assertGitCandidateCheckoutCurrent(checkout);
      });
      if (purpose === 'action-materialization') await run;
      else await expect(run).rejects.toThrow();
    }
    for (const mutation of ['foreign-file', 'wrong-ref', 'nested-directory'] as const) {
      await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
        purpose: 'action-materialization', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        if (mutation === 'wrong-ref') git(checkout.candidateRoot, ['update-ref', 'refs/sec/base', repository.headSha]);
        else {
          const trustedInput = path.join(checkout.candidateRoot, '.sec-trusted-input'); mkdirSync(trustedInput);
          if (mutation === 'foreign-file') writeFileSync(path.join(trustedInput, 'foreign'), 'x');
          else mkdirSync(path.join(trustedInput, 'candidate.bundle'));
        }
      })).rejects.toThrow();
    }
  });

  test('callback failure is preserved after cleanup, including an undefined thrown value', async () => {
    const repository = repositoryFixture();
    let generation = '';
    await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      generation = path.dirname(checkout.candidateRoot); throw undefined;
    })).rejects.toBeUndefined();
    expect(existsSync(generation)).toBe(false);
  });

  test('root drift cannot erase the original callback failure or authorize retirement by a fresh path', async () => {
    const repository = repositoryFixture(), primary = new Error('borrower failed before retirement');
    let original = '', moved = '';
    let observed: unknown;
    try {
      await withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
        purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        original = path.dirname(checkout.candidateRoot); moved = `${original}-moved`;
        renameSync(original, moved); roots.push(moved);
        throw primary;
      });
    } catch (error) { observed = error; }
    expect(observed).toBeInstanceOf(GitCandidateCheckoutCleanupUnknownError);
    const failure = observed as GitCandidateCheckoutCleanupUnknownError;
    expect(failure.recovery.generation.path).toBe(original);
    expect(failure.recovery.parent.path).toBe(path.dirname(original));
    expect(failure.recovery.baseSha).toBe(repository.baseSha);
    expect(failure.recovery.headSha).toBe(repository.headSha);
    expect(failure.failure).toBeInstanceOf(ResourceCompositeSettlementError);
    expect((failure.failure as ResourceCompositeSettlementError).errors).toContain(primary);
    expect(existsSync(original)).toBe(false);
    expect(existsSync(moved)).toBe(true);
  });

  test('cleanup uncertainty retains exact owned generation and every original failure', () => {
    const primary = new Error('borrower failed'), cleanup = new Error('retirement unknown');
    const failure = new ResourceCompositeSettlementError([{ label: 'borrower', error: primary }, { label: 'retirement', error: cleanup }]);
    const parent = Object.freeze({ path: '/parent', finalPath: '/parent', objectId: '1:2', device: '1', inode: '2' });
    const generation = Object.freeze({ path: '/parent/generation', finalPath: '/parent/generation', objectId: '1:3', device: '1', inode: '3' });
    const recovery = Object.freeze({ parent, generation, baseSha: '1'.repeat(40), headSha: '2'.repeat(40),
      purpose: 'activation-static' as const, deadlineAtUnixMs: 1_000 });
    const error = new GitCandidateCheckoutCleanupUnknownError(recovery, failure);
    expect(error.recovery).toBe(recovery);
    expect(error.cause).toBe(failure);
    expect(error.failure).toBe(failure);
    expect(failure.errors).toEqual([primary, cleanup]);
  });
});


// These are real checkout-consumer regressions. They are source proposals;
// execution remains subject to the original selected test/native admission.
describe('trusted-root content observations through private Git metadata', () => {
  test('preserves the actual clean, staged, unstaged and untracked states', async () => {
    for (const state of ['clean', 'staged', 'unstaged', 'untracked'] as const) {
      const repository = repositoryFixture();
      if (state === 'staged' || state === 'unstaged') {
        writeFileSync(path.join(repository.root, 'value.txt'), 'real modified bytes\n');
      }
      if (state === 'staged') git(repository.root, ['add', '--', 'value.txt']);
      if (state === 'untracked') writeFileSync(path.join(repository.root, 'untracked.txt'), 'untracked\n');
      await withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
        purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        const result = await readGitCandidateCheckout(checkout, repository.root,
          ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
        expect(result.code).toBe(0);
        const status = Buffer.from(result.stdout).toString('utf8');
        if (state === 'clean') expect(status).toBe('');
        if (state === 'staged') expect(status).toMatch(/^1 M\. /u);
        if (state === 'unstaged') expect(status).toMatch(/^1 \.M /u);
        if (state === 'untracked') expect(status).toBe('? untracked.txt\0');
        const identity = await readGitCandidateCheckout(checkout, repository.root,
          ['rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir']);
        expect(Buffer.from(identity.stdout).toString('utf8'))
          .toBe(`${repository.root}\n${repository.root}/.git\n`);
      });
    }
  });

  test('rejects both optional clean and process conversions without executing a local driver', async () => {
    for (const driver of ['clean', 'process'] as const) {
      const repository = repositoryFixture();
      const marker = path.join(temporaryRoot('filter-marker'), 'executed');
      writeFileSync(path.join(repository.root, '.gitattributes'), '*.txt filter=sec-record\n');
      git(repository.root, ['add', '--', '.gitattributes']);
      git(repository.root, ['commit', '--quiet', '-m', 'attribute data']);
      const headSha = git(repository.root, ['rev-parse', 'HEAD']);
      git(repository.root, ['config', `filter.sec-record.${driver}`, `printf executed > '${marker}'; cat`]);
      writeFileSync(path.join(repository.root, 'value.txt'), 'changed after index stat capture\n');
      let entered = false;
      await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository, headSha,
        purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        entered = true;
        await readGitCandidateCheckout(checkout, repository.root,
          ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
      })).rejects.toThrow();
      expect(entered).toBe(true);
      expect(existsSync(marker)).toBe(false);
    }
  });

  test('never binds repo info attributes to the private config boundary', async () => {
    const repository = repositoryFixture();
    const marker = path.join(temporaryRoot('info-filter-marker'), 'executed');
    writeFileSync(path.join(repository.root, '.git/info/attributes'), '*.txt filter=sec-record\n');
    git(repository.root, ['config', 'filter.sec-record.clean', `printf executed > '${marker}'; cat`]);
    writeFileSync(path.join(repository.root, 'value.txt'), 'changed\n');
    let entered = false;
    await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async () => {
      entered = true;
    })).rejects.toThrow();
    expect(entered).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  test('does not rebaseline an index or attribute source changed after borrower admission', async () => {
    for (const mutation of ['index', 'attributes', 'head'] as const) {
      const repository = repositoryFixture();
      await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
        purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        if (mutation === 'index') {
          writeFileSync(path.join(repository.root, 'value.txt'), 'staged later\n');
          git(repository.root, ['add', '--', 'value.txt']);
        }
        if (mutation === 'attributes') {
          writeFileSync(path.join(repository.root, '.gitattributes'), '*.txt filter=late-driver\n');
        }
        if (mutation === 'head') git(repository.root, ['update-ref', 'HEAD', repository.baseSha, repository.headSha]);
        await readGitCandidateCheckout(checkout, repository.root,
          ['status', '--porcelain=v2', '-z', '--untracked-files=all']);
      })).rejects.toThrow();
    }
  });

  test('repo config includes acquired after admission cannot select a content helper', async () => {
    const repository = repositoryFixture();
    const hostile = temporaryRoot('late-config');
    const marker = path.join(hostile, 'executed');
    const included = path.join(hostile, 'included-config');
    writeFileSync(included, `[diff]\nexternal = printf executed > '${marker}'\n`);
    await withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      git(repository.root, ['config', 'include.path', included]);
      writeFileSync(path.join(repository.root, 'value.txt'), 'real dirty input\n');
      const result = await readGitCandidateCheckout(checkout, repository.root,
        ['diff', '--name-status', '-z', '--', 'value.txt']);
      expect(result.code).toBe(0);
      expect(Buffer.from(result.stdout).toString('utf8')).toBe('M\0value.txt\0');
      expect(existsSync(marker)).toBe(false);
    });
    expect(existsSync(marker)).toBe(false);
  });

  test('rejects a real-index gitlink rather than hiding submodule dirtiness', async () => {
    const repository = repositoryFixture();
    git(repository.root, ['update-index', '--add', '--cacheinfo', `160000,${repository.headSha},submodule`]);
    let entered = false;
    await expect(withGitCandidateCheckout({ sourceRoot: repository.root, ...repository,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async () => {
      entered = true;
    })).rejects.toThrow();
    expect(entered).toBe(false);
  });
});
