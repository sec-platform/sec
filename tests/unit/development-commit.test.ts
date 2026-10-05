import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'bun:test';

import { createHostGitReadSessionForTests } from '../../src/adapters/providers/git-read/runtime/session.ts';
import {
  issueDevelopmentCommitAdmission,
  type DevelopmentCommitAdmission,
  type DevelopmentCommitRequest
} from '../../src/adapters/self-hosting/development/commit-admission/operation.ts';
import {
  acknowledgeDevelopmentCommitResult,
  readDevelopmentCommitOutcome,
  retireSupersededLocalDevelopmentCommitJournals,
  runDevelopmentCommit,
  settleDevelopmentCommitJournalsForRef
} from '../../src/adapters/self-hosting/development/commit/operation.ts';
import { IMPORT_NORMALIZATION_OPERATION } from '../../src/adapters/self-hosting/development/import-normalization/contract.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixture(prefix = 'sec-development-commit-'): Promise<Readonly<{
  root: string;
  request: DevelopmentCommitRequest;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  const moduleRoot = path.join(
    root,
    'src',
    'adapters',
    'self-hosting',
    'development',
    'import-normalization'
  );
  await mkdir(moduleRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true}}\n'),
    writeFile(path.join(moduleRoot, 'kernel.ts'), 'export function normalize(): void {}\n'),
    writeFile(
      path.join(moduleRoot, 'runtime.ts'),
      "export { normalize as verifyCandidateImportNormalization } from './kernel.ts';\n"
    ),
    writeFile(path.join(moduleRoot, 'module.json'), `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/adapters/self-hosting/development/import-normalization/runtime.ts'],
      capabilityProviders: [{
        capability: IMPORT_NORMALIZATION_OPERATION.capability,
        operations: [IMPORT_NORMALIZATION_OPERATION.operation]
      }]
    })}\n`)
  ]);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  await writeFile(path.join(root, 'next.txt'), 'next\n');
  git(root, ['add', 'next.txt']);
  return Object.freeze({
    root,
    request: Object.freeze({
      repositoryRoot: path.resolve(root),
      message: 'apply staged candidate\n',
      author: Object.freeze({
        name: 'SEC Tests',
        email: 'tests@example.com',
        date: '1700000100 +0000'
      }),
      committer: Object.freeze({
        name: 'SEC Tests',
        email: 'tests@example.com',
        date: '1700000100 +0000'
      })
    })
  });
}

test('development.commit consumes one exact staged admission before publishing its Git Effect', async () => {
  const { root } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const prepared = await issueDevelopmentCommitAdmission({
      repositoryRoot: root,
      message: 'apply staged candidate\n'
    });
    const { request } = prepared;
    await expect(runDevelopmentCommit(
      request,
      { ...prepared.admission } as DevelopmentCommitAdmission
    )).rejects.toThrow('foreign or structurally reproduced');
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(preimage);

    const result = await runDevelopmentCommit(request, prepared.admission);
    expect(result.disposition).toBe('applied');
    expect(result.preimage).toBe(preimage);
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(result.target);
    expect(git(root, ['status', '--porcelain'])).toBe('');
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('already been consumed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

// Mocks are confined to a child; the actual command, issuer, Git provider and journal
// resources still perform their transitions. No parent cwd or module state changes.
async function commitCommandCase(mode: 'short-write' | 'zero-write' | 'write-error' | 'journal-drift' | 'not-applied' | 'unknown' | 'repeated'): Promise<void> {
  const { root } = await fixture('sec-development-commit-结果-');
  const harness = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-command-'));
  const modulePath = (relative: string) => JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)));
  try {
    const script = path.join(harness, 'case.ts');
    const report = path.join(harness, 'output.json');
    await writeFile(script, `
      import assert from 'node:assert/strict';
      import { spawnSync } from 'node:child_process';
      import * as fs from 'node:fs';
      import path from 'node:path';
      import { mock } from 'bun:test';
      const root = ${JSON.stringify(root)};
      const mode = ${JSON.stringify(mode)};
      const originalWrite = fs.writeSync;
      const git = (args) => {
        const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      const provider = await import(${modulePath('../../src/adapters/providers/git-read/runtime/session.ts')});
      const originalCompareAndSwap = provider.compareAndSwapAuthorityDevelopmentCommitRef;
      mock.module(${modulePath('../../src/adapters/providers/git-read/runtime/session.ts')}, () => ({
        ...provider,
        async compareAndSwapAuthorityDevelopmentCommitRef(input) {
          // A real Git lock makes the original provider fail without a ref transition.
          const lock = path.join(root, '.git', input.contract.ref + '.lock');
          if (mode === 'not-applied') fs.writeFileSync(lock, '', { flag: 'wx' });
          try {
            const settlement = await originalCompareAndSwap(input);
            assert.equal(settlement.status, mode === 'not-applied' ? 'cas-conflict' : 'completed');
            if (mode === 'unknown') {
              // The real ref effect completes but an independently changed index prevents applied readback.
              fs.writeFileSync(path.join(root, 'next.txt'), 'changed after ref transition\\n');
              git(['add', 'next.txt']);
            }
            return settlement;
          } finally {
            if (mode === 'not-applied') fs.unlinkSync(lock);
          }
        }
      }));
      const owner = await import(${modulePath('../../src/adapters/self-hosting/development/commit/operation.ts')});
      const originalRun = owner.runDevelopmentCommit;
      const originalAcknowledge = owner.acknowledgeDevelopmentCommitResult;
      const originalRecover = owner.recoverDevelopmentCommit;
      let issued;
      let issuedSource;
      let driftedSource;
      let delivered = Buffer.alloc(0);
      let writes = 0;
      let acknowledgments = 0;
      let returnedResults = 0;
      const events = [];
      const expectedOutput = [];
      const outputFailure = new Error('injected stdout write failure');
      mock.module(${modulePath('../../src/adapters/self-hosting/development/commit/operation.ts')}, () => ({
        ...owner,
        async runDevelopmentCommit(...args) {
          issued = await originalRun(...args);
          assert.equal(Object.isFrozen(issued), true);
          issuedSource = fs.readFileSync(issued.journalPath, 'utf8');
          returnedResults++;
          events.push('issued');
          return issued;
        },
        async acknowledgeDevelopmentCommitResult(result) {
          acknowledgments++;
          assert.equal(result, issued, 'the original issued result must reach its owner');
          assert.equal(delivered.toString('utf8'), JSON.stringify(result, null, 2) + '\\n');
          assert.equal(fs.existsSync(result.journalPath), true);
          assert.equal(events.at(-1), 'delivered');
          events.push('acknowledge');
          await originalAcknowledge(result);
          events.push('retired');
        }
      }));
      mock.module('node:fs', () => ({
        ...fs,
        writeSync(fd, buffer, offset, length, ...rest) {
          if (fd !== 1) return originalWrite(fd, buffer, offset, length, ...rest);
          assert.ok(issued, 'output must follow the real commit result');
          assert.equal(acknowledgments, 0, 'acknowledgment must follow complete output');
          assert.equal(fs.existsSync(issued.journalPath), true);
          assert.equal(Buffer.isBuffer(buffer), true);
          assert.equal(offset, delivered.byteLength);
          assert.equal(length, buffer.byteLength - offset);
          writes++;
          if (writes === 2 && mode === 'zero-write') return 0;
          if (writes === 2 && mode === 'write-error') throw outputFailure;
          const written = originalWrite(fd, buffer, offset, Math.min(length, 7), ...rest);
          delivered = Buffer.concat([delivered, buffer.subarray(offset, offset + written)]);
          if (delivered.byteLength === buffer.byteLength) {
            events.push('delivered');
            if (mode === 'journal-drift') {
              const journal = JSON.parse(issuedSource);
              journal.terminal = 'unknown';
              driftedSource = JSON.stringify(journal) + '\\n';
              fs.writeFileSync(issued.journalPath, driftedSource);
            }
          }
          return written;
        }
      }));
      const { runDevelopmentCommitCommand } = await import(${modulePath('../../src/adapters/self-hosting/development/runner/commit-command.ts')});
      const count = mode === 'repeated' ? 13 : 1;
      for (let index = 0; index < count; index++) {
        if (index > 0) {
          fs.writeFileSync(path.join(root, 'next.txt'), 'candidate ' + index + '\\n');
          git(['add', 'next.txt']);
        }
        delivered = Buffer.alloc(0); writes = 0; acknowledgments = 0; events.length = 0;
        let caught;
        let code;
        try { code = await runDevelopmentCommitCommand(['deliver candidate ' + index]); }
        catch (error) { caught = error; }
        expectedOutput.push(delivered.toString('utf8'));
        const expectedDisposition = mode === 'unknown' || mode === 'not-applied' ? mode : 'applied';
        assert.equal(issued.disposition, expectedDisposition);
        assert.equal(git(['rev-parse', issued.ref]), mode === 'not-applied' ? issued.preimage : issued.target);
        if (mode === 'zero-write' || mode === 'write-error') {
          assert.equal(code, undefined);
          if (mode === 'write-error') assert.equal(caught, outputFailure);
          else assert.match(caught.message, /delivery made no progress/);
          assert.equal(writes, 2);
          assert.equal(delivered.byteLength, 7);
          assert.equal(acknowledgments, 0);
          assert.equal(fs.readFileSync(issued.journalPath, 'utf8'), issuedSource);
        } else {
          assert.equal(delivered.toString('utf8'), JSON.stringify(issued, null, 2) + '\\n');
          assert.ok(writes > 1);
          assert.ok(delivered.byteLength > delivered.toString('utf8').length);
          if (mode === 'journal-drift') {
            assert.equal(code, undefined);
            assert.ok(caught, 'changed journal must fail the original acknowledgment');
            assert.equal(acknowledgments, 1);
            assert.notEqual(driftedSource, issuedSource);
            assert.equal(fs.readFileSync(issued.journalPath, 'utf8'), driftedSource);
          } else if (mode === 'not-applied' || mode === 'unknown') {
            assert.equal(caught, undefined);
            assert.equal(code, 1);
            assert.equal(acknowledgments, 0);
            assert.equal(fs.readFileSync(issued.journalPath, 'utf8'), issuedSource);
            await assert.rejects(originalAcknowledge(issued), /requires applied readback/);
            assert.equal(fs.readFileSync(issued.journalPath, 'utf8'), issuedSource);
          } else {
            assert.equal(caught, undefined);
            assert.equal(code, 0);
            assert.equal(acknowledgments, 1);
            assert.deepEqual(events, ['issued', 'delivered', 'acknowledge', 'retired']);
            assert.equal(fs.existsSync(issued.journalPath), false);
            assert.equal(fs.existsSync(path.dirname(issued.journalPath)), false);
            await assert.rejects(originalAcknowledge(issued), /owner-issued result/);
          }
        }
        // These pre-retirement faults retain a recoverable journal, without replaying the commit.
        if (mode === 'zero-write' || mode === 'write-error' || mode === 'journal-drift') {
          await assert.rejects(originalAcknowledge(JSON.parse(JSON.stringify(issued))), /owner-issued result/);
          const recovered = await originalRecover({ repositoryRoot: root, journalPath: issued.journalPath });
          assert.equal(recovered.result.disposition, 'applied');
          assert.equal(recovered.result.target, issued.target);
          await originalAcknowledge(recovered.result);
          assert.equal(fs.existsSync(issued.journalPath), false);
          assert.equal(git(['rev-parse', issued.ref]), issued.target);
        }
      }
      assert.equal(returnedResults, count);
      if (mode === 'repeated') assert.equal(git(['rev-list', '--count', 'HEAD']), '14');
      fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify(expectedOutput.join('')));
    `);
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, SEC_STATE_HOME: path.join(harness, 'state'), SEC_CACHE_HOME: path.join(harness, 'cache') },
      encoding: 'utf8', windowsHide: true, timeout: DEFAULT_TEST_TIMEOUT_MS
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(JSON.parse(await readFile(report, 'utf8')) as string);
  } finally {
    await rm(harness, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
}

for (const mode of ['short-write', 'zero-write', 'write-error', 'journal-drift', 'not-applied', 'unknown', 'repeated'] as const) {
  test(`development commit CLI preserves original delivery and retirement boundaries: ${mode}`, async () => {
    await commitCommandCase(mode);
  }, DEFAULT_TEST_TIMEOUT_MS);
}

test('development.commit retires only the exact owner-issued applied journal after delivery', async () => {
  const { root } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ repositoryRoot: root, message: 'apply staged candidate\n' });
    const result = await runDevelopmentCommit(prepared.request, prepared.admission);
    const source = await readFile(result.journalPath, 'utf8');
    expect(source).toContain('"terminal":"applied"');
    await expect(acknowledgeDevelopmentCommitResult({ ...result })).rejects.toThrow('owner-issued result');
    expect(await readFile(result.journalPath, 'utf8')).toBe(source);
    await acknowledgeDevelopmentCommitResult(result);
    await expect(lstat(result.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(path.dirname(result.journalPath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
      .toEqual({ ref: result.ref, observed: 0, retired: 0 });
    const foreign = path.join(path.dirname(result.journalPath), `.sec-journal-guard-${'f'.repeat(64)}.lock`);
    await mkdir(path.dirname(foreign));
    await writeFile(foreign, '{}');
    await expect(settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
      .rejects.toThrow('unrecognized owner residue');
    expect(await readFile(foreign, 'utf8')).toBe('{}');
    await expect(acknowledgeDevelopmentCommitResult(result)).rejects.toThrow('owner-issued result');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit classifies every exact-ref journal before retiring any', async () => {
  const { root } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ repositoryRoot: root, message: 'apply staged candidate\n' });
    const result = await runDevelopmentCommit(prepared.request, prepared.admission);
    const source = await readFile(result.journalPath, 'utf8');
    const unknown = { ...JSON.parse(source) as Record<string, unknown>,
      attempt: `sha256:${'a'.repeat(64)}`, target: 'b'.repeat(40), object: null, terminal: 'unknown' };
    const unknownPath = path.join(path.dirname(result.journalPath), `${'a'.repeat(64)}.json`);
    await writeFile(unknownPath, `${JSON.stringify(unknown)}\n`);
    await expect(settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
      .rejects.toThrow('requires applied readback');
    expect(await readFile(result.journalPath, 'utf8')).toBe(source);
    await rm(unknownPath);
    expect(await settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: result.ref }))
      .toEqual({ ref: result.ref, observed: 1, retired: 1 });
    await expect(lstat(result.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('development.commit retires verified applied attempts after a local ref rewrite', async () => {
  const { root } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ repositoryRoot: root, message: 'apply staged candidate\n' });
    const result = await runDevelopmentCommit(prepared.request, prepared.admission);
    const source = await readFile(result.journalPath, 'utf8');
    git(root, ['reset', '--mixed', result.preimage]);
    expect(git(root, ['rev-parse', result.ref])).toBe(result.preimage);
    const unknown = { ...JSON.parse(source) as Record<string, unknown>, terminal: 'unknown' };
    const unknownPath = path.join(path.dirname(result.journalPath), `${'a'.repeat(64)}.json`);
    await writeFile(unknownPath, `${JSON.stringify(unknown)}\n`);
    await expect(retireSupersededLocalDevelopmentCommitJournals({ repositoryRoot: root, ref: result.ref }))
      .rejects.toThrow('active or unknown');
    expect(await readFile(result.journalPath, 'utf8')).toBe(source);
    await rm(unknownPath);
    expect(await retireSupersededLocalDevelopmentCommitJournals({ repositoryRoot: root, ref: result.ref }))
      .toEqual({ ref: result.ref, observed: 1, retired: 1 });
    await expect(lstat(result.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(git(root, ['rev-parse', result.ref])).toBe(result.preimage);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('development.commit settles completed historical and current journals for one ref', async () => {
  const { root } = await fixture();
  try {
    const firstAdmission = await issueDevelopmentCommitAdmission({
      repositoryRoot: root, message: 'first staged candidate\n'
    });
    const first = await runDevelopmentCommit(firstAdmission.request, firstAdmission.admission);
    await writeFile(path.join(root, 'later.txt'), 'later\n');
    git(root, ['add', 'later.txt']);
    const secondAdmission = await issueDevelopmentCommitAdmission({
      repositoryRoot: root, message: 'second staged candidate\n'
    });
    const second = await runDevelopmentCommit(secondAdmission.request, secondAdmission.admission);
    expect(git(root, ['rev-list', '--walk-reflogs', second.ref]).split(/\r?\n/u).slice(0, 2))
      .toEqual([second.target, first.target]);
    expect(await settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref: second.ref }))
      .toEqual({ ref: second.ref, observed: 2, retired: 2 });
    await expect(lstat(first.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(second.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test('development.commit reports failed staged normalization without publishing the candidate', async () => {
  const { root, request } = await fixture();
  try {
    const kernelPath = 'src/adapters/self-hosting/development/import-normalization/kernel.ts';
    await writeFile(path.join(root, kernelPath),
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\n");
    git(root, ['add', '--', kernelPath]);
    const before = {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree'])
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(issueDevelopmentCommitAdmission({ request }))
        .rejects.toThrow('Candidate import normalization blocked commit: failed; action sha256:');
      expect({
        head: git(root, ['rev-parse', 'HEAD']),
        tree: git(root, ['write-tree'])
      }).toEqual(before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit rejects missing admission before repository Effect', async () => {
  const { root, request } = await fixture();
  try {
    const before = Object.freeze({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    });
    await expect(runDevelopmentCommit(
      request,
      Object.freeze({}) as DevelopmentCommitAdmission
    )).rejects.toThrow('foreign or structurally reproduced');
    expect({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    }).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development.commit keeps a failed reflog observation unknown instead of authorizing another effect', async () => {
  const { root } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    git(root, ['commit', '--quiet', '-m', 'detached target object']);
    const target = git(root, ['rev-parse', 'HEAD']);
    const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
    const ref = git(root, ['symbolic-ref', 'HEAD']);
    git(root, ['reset', '--soft', preimage]);
    const commonDirectory = path.resolve(root, git(root, ['rev-parse', '--git-common-dir']));
    const hostSession = createHostGitReadSessionForTests({ cwd: root });
    const session = Object.freeze({
      ...hostSession,
      run: (args: readonly string[]) => args[0] === 'rev-list' && args[1] === '--walk-reflogs'
        ? Promise.resolve(Object.freeze({
          kind: 'unresolved-git-read-session' as const,
          reason: 'command-error' as const,
          detail: 'independent reflog observation failure'
        }))
        : hostSession.run(args)
    });
    try {
      const journal: Parameters<typeof readDevelopmentCommitOutcome>[0]['journal'] = Object.freeze({
        schema: 'sec-development-commit-journal-v1',
        operation: `sha256:${'1'.repeat(64)}`,
        attempt: `sha256:${'2'.repeat(64)}`,
        ref,
        preimage,
        target,
        object: target,
        tree,
        terminal: null
      });
      const readback = await readDevelopmentCommitOutcome({
        session,
        commonDirectory,
        journal,
        normal: null
      });
      expect(readback.disposition).toBe('unknown');
    } finally {
      await hostSession.close?.();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development.commit rejects a real unfinished merge without publishing or consuming its state', async () => {
  const { root, request } = await fixture();
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    git(root, ['commit', '--quiet', '-m', 'current branch delta']);
    const currentBranch = git(root, ['symbolic-ref', '--short', 'HEAD']);
    git(root, ['switch', '--quiet', '-c', 'incoming', base]);
    await writeFile(path.join(root, 'incoming.txt'), 'incoming\n');
    git(root, ['add', 'incoming.txt']);
    git(root, ['commit', '--quiet', '-m', 'incoming delta']);
    git(root, ['switch', '--quiet', currentBranch]);
    git(root, ['merge', '--no-commit', '--no-ff', 'incoming']);
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    const observe = async () => ({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v']),
      mergeHead: await readFile(path.join(gitDirectory, 'MERGE_HEAD'), 'utf8')
    });
    const before = await observe();
    await expect(issueDevelopmentCommitAdmission({ request }))
      .rejects.toThrow('unfinished Git operation: MERGE_HEAD');
    expect(await observe()).toEqual(before);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit fences sequencer state introduced after admission', async () => {
  const { root, request } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ request });
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    await mkdir(path.join(gitDirectory, 'sequencer'));
    const before = {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    };
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('unfinished Git operation: sequencer');
    expect({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    }).toEqual(before);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
