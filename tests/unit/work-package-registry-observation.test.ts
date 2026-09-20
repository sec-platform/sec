import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseOpenPullRequestList,
  projectWorkPackageRegistry as project,
  type WorkPackageRegistryGitRead
} from '../../src/adapters/verification/platform/session/runtime/work-package-registry.ts';
import {
  parseVerificationRegistryProjection,
  type VerificationRegistryEntry
} from '../../src/adapters/verification/platform/session/contract/session.ts';

function projectWorkPackageRegistry(input: Parameters<typeof project>[0], read: WorkPackageRegistryGitRead,
  consumeRecords: (count: number) => void = () => {}, maxCommandStdoutBytes = 32 * 1024 * 1024): Promise<string> {
  return project(input, read, { consumeRecords, maxCommandStdoutBytes });
}
const defaultBlob = 'e'.repeat(40), prBlob = 'f'.repeat(40);
const contents = new Map([[defaultBlob, Buffer.from('default\r\n')], [prBlob, Buffer.from('candidate\n')]]);
function batchReply(args: readonly string[], input: Uint8Array | undefined, blobs: ReadonlyMap<string, Buffer> = contents) {
  assert.ok(input, 'batch requests must be delivered as stdin');
  const ids = Buffer.from(input).toString('ascii').trimEnd().split('\n');
  return reply(Buffer.concat(ids.flatMap(id => {
    const bytes = blobs.get(id); assert.ok(bytes, 'unknown blob ' + id);
    const header = Buffer.from(`${id} blob ${bytes.length}\n`);
    return args[1] === '--batch-check' ? [header] : [header, bytes, Buffer.from('\n')];
  })));
}
const defaultTree = 'a'.repeat(40), prTree = 'b'.repeat(40), headSha = 'c'.repeat(40);
const defaultPath = 'config/repository/work-packages/default.md';
const prPath = 'config/repository/work-packages/candidate.md';
const rawDigest = (bytes: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const request = {
  observedAt: '2026-09-20T00:00:00.000Z', repository: 'owner/repository',
  defaultBranch: 'main', defaultRef: 'main'
};
const prResponse = {
  number: 9, headRefName: 'candidate', headRefOid: headSha,
  baseRefName: 'main', baseRefOid: 'd'.repeat(40), body: `Work-Package: ${prPath}`
};
function reply(stdout: string | Buffer, status: number | null = 0, stderr = '') {
  return { status, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) };
}
function reader(events: string[][]): WorkPackageRegistryGitRead {
  return async (args, input) => {
    events.push([...args]);
    assert.ok(Object.isFrozen(args));
    if (args[0] === 'rev-parse') return reply(args.slice(3).map(ref =>
      ref === 'main^{tree}' ? defaultTree : ref.endsWith('^{tree}') ? prTree : prBlob).join('\n') + '\n');
    if (args[0] === 'ls-tree') return reply(`100644 blob ${defaultBlob}\t${defaultPath}\0`);
    if (args[0] === 'cat-file') return args[1] === 'blob' ? reply(contents.get(args[2]!)!) : batchReply(args, input);
    assert.fail('Unexpected observation command');
  };
}

test('registry bytes preserve default and PR identities, exact manifest hashes and command order', async () => {
  const events: string[][] = [];
  const source = await projectWorkPackageRegistry({
    ...request, openPullRequests: parseOpenPullRequestList(JSON.stringify([prResponse]))
  }, reader(events));
  const projection = parseVerificationRegistryProjection(source);
  assert.equal(projection.defaultTreeSha, defaultTree);
  assert.deepEqual(projection.entries, [
    { manifestPath: defaultPath, manifestDigest: rawDigest('default\r\n'), source: 'default',
      prNumber: null, baseSha: null, headSha: null, headTreeSha: null },
    { manifestPath: prPath, manifestDigest: rawDigest('candidate\n'), source: 'open-pr',
      prNumber: 9, baseSha: prResponse.baseRefOid, headSha, headTreeSha: prTree }
  ]);
  assert.deepEqual(events, [
    ['rev-parse', '--revs-only', '--end-of-options', 'main^{tree}', `${headSha}^{tree}`, `${headSha}:${prPath}`],
    ['ls-tree', '-r', '-z', '--full-tree', defaultTree, '--', 'config/repository/work-packages'],
    ['cat-file', '--batch-check'],
    ['cat-file', '--batch']
  ]);
});

test('captured PR and supplied-entry input cannot drift while the read transport is suspended', async () => {
  const openPullRequests = parseOpenPullRequestList(JSON.stringify([prResponse]));
  const supplied: VerificationRegistryEntry = {
    source: 'open-pr', manifestPath: 'config/repository/work-packages/supplied.md',
    manifestDigest: rawDigest('supplied'), prNumber: 3, headSha, baseSha: prResponse.baseRefOid, headTreeSha: prTree
  };
  const sourceInput = { ...request, openPullRequests, pullRequestEntries: [supplied] };
  const events: string[][] = [], read = reader(events);
  let first = true;
  const source = await projectWorkPackageRegistry(sourceInput, async (args, input) => {
    if (first) {
      first = false;
      sourceInput.repository = 'other/repository';
      sourceInput.defaultRef = 'changed';
      openPullRequests[0]!.body = 'invalid late mutation';
      openPullRequests.length = 0;
      supplied.manifestPath = 'config/repository/work-packages/replaced.md';
      sourceInput.pullRequestEntries.length = 0;
      await Promise.resolve();
    }
    return read(args, input);
  });
  const projection = parseVerificationRegistryProjection(source);
  assert.equal(projection.repository, request.repository);
  assert.deepEqual(projection.entries.map(entry => entry.manifestPath), [defaultPath, 'config/repository/work-packages/supplied.md', prPath]);
});

test('duplicate paths across registry sources fail rather than returning a partial projection', async () => {
  const openPullRequests = parseOpenPullRequestList(JSON.stringify([
    { ...prResponse, body: `Work-Package: ${defaultPath}` }
  ]));
  await assert.rejects(projectWorkPackageRegistry({ ...request, openPullRequests }, reader([])),
    /duplicate manifest paths across sources/);
});

test('read failure stops the same observation instead of starting a fallback command provider', async () => {
  let calls = 0;
  await assert.rejects(projectWorkPackageRegistry(request, async () => {
    calls++;
    return reply('', null, 'existing operation budget exhausted');
  }), /tree readback failed: existing operation budget exhausted/);
  assert.equal(calls, 1);
});

test('NUL-containing references are rejected before dispatch to a supplied transport', async () => {
  await assert.rejects(projectWorkPackageRegistry({ ...request, defaultRef: 'main\0elsewhere' }, () => {
    assert.fail('must not dispatch');
  }), /argument contains NUL/);
});

test('invalid tree readback fails before listing or hashing any manifests', async () => {
  let calls = 0;
  await assert.rejects(projectWorkPackageRegistry(request, () => { calls++; return reply('not-a-tree'); }),
    /Tree\/blob readback for main is invalid/);
  assert.equal(calls, 1);
});

for (const input of ['{}', '[null]', '[[]]', JSON.stringify([{ ...prResponse, number: 0 }]),
  JSON.stringify([{ ...prResponse, headRefOid: 'main' }]), JSON.stringify([{ ...prResponse, body: null }])]) {
  test(`open PR decoder rejects unsupported identity input ${input}`, () => {
    assert.throws(() => parseOpenPullRequestList(input), /Open PR/);
  });
}

test('a native branch change after tree observation cannot mix a previous tree identity with new manifest bytes', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'sec-registry-tree-binding-'));
  function git(args: readonly string[], input?: Uint8Array) {
    const result = spawnSync('git', [...args], { cwd: root, input, encoding: 'buffer', windowsHide: true });
    if (result.error) throw result.error;
    return { status: result.status, stdout: Buffer.from(result.stdout ?? ''), stderr: Buffer.from(result.stderr ?? '') };
  }
  function command(args: readonly string[]): string {
    const result = git(args); assert.equal(result.status, 0, result.stderr.toString('utf8'));
    return result.stdout.toString('utf8').trim();
  }
  try {
    command(['init', '-b', 'main']);
    mkdirSync(path.dirname(path.join(root, defaultPath)), { recursive: true });
    writeFileSync(path.join(root, defaultPath), 'first\r\n');
    command(['add', '--', defaultPath]);
    command(['-c', 'user.name=Registry Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'first']);
    const first = command(['rev-parse', 'HEAD']);
    const firstTree = command(['rev-parse', 'HEAD^{tree}']);
    writeFileSync(path.join(root, defaultPath), 'second\n');
    command(['add', '--', defaultPath]);
    command(['-c', 'user.name=Registry Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'second']);
    const second = command(['rev-parse', 'HEAD']);
    command(['update-ref', 'refs/heads/main', first]);
    let changed = false;
    const source = await projectWorkPackageRegistry(request, async (args, input) => {
      const result = git(args, input);
      if (!changed && args[0] === 'rev-parse') {
        command(['update-ref', 'refs/heads/main', second]); changed = true;
      }
      return result;
    });
    const projection = parseVerificationRegistryProjection(source);
    assert.equal(changed, true);
    assert.equal(projection.defaultTreeSha, firstTree);
    assert.equal(projection.entries[0]!.manifestDigest, rawDigest('first\r\n'));
    assert.equal(command(['rev-parse', 'HEAD']), second);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function inventoryReader(files: ReadonlyArray<{ path: string; bytes: Buffer }>, events: string[][],
  maxOutputBytes = 32 * 1024 * 1024): WorkPackageRegistryGitRead {
  const blobs = new Map<string, Buffer>();
  const entries = files.map(file => {
    const id = createHash('sha1').update(`blob ${file.bytes.length}\0`).update(file.bytes).digest('hex');
    blobs.set(id, file.bytes);
    return { id, path: file.path };
  });
  return (args, input) => {
    events.push([...args]);
    let result;
    if (args[0] === 'rev-parse') result = reply(`${defaultTree}\n`);
    else if (args[0] === 'ls-tree') result = reply(entries.map(entry => `100644 blob ${entry.id}\t${entry.path}\0`).join(''));
    else if (args[1] === 'blob') {
      const bytes = blobs.get(args[2]!); assert.ok(bytes);
      result = reply(bytes);
    } else result = batchReply(args, input, blobs);
    assert.ok(result.stdout.length <= maxOutputBytes, `command output exceeds ${maxOutputBytes}`);
    return result;
  };
}

test('one thousand registry entries use four native reads and retain path identity for shared blobs', async () => {
  const files = Array.from({ length: 1000 }, (_, i) => ({
    path: `config/repository/work-packages/work-${String(1000 - i).padStart(4, '0')}.md`,
    bytes: Buffer.from(`source-${i % 11}\r\n原文\0`)
  }));
  const events: string[][] = [], debits: number[] = [];
  const source = await projectWorkPackageRegistry(request, inventoryReader(files, events), count => debits.push(count));
  const entries = parseVerificationRegistryProjection(source).entries;
  assert.equal(events.length, 4);
  assert.deepEqual(debits, [1, 1000, 11, 11]);
  assert.equal(entries.length, 1000);
  assert.deepEqual(entries.map(entry => entry.manifestPath), files.map(file => file.path).sort());
  const expected = new Map(files.map(file => [file.path, rawDigest(file.bytes)]));
  for (const entry of entries) assert.equal(entry.manifestDigest, expected.get(entry.manifestPath));
});

test('empty registry skips object metadata and content reads', async () => {
  const events: string[][] = [];
  const source = await projectWorkPackageRegistry(request, inventoryReader([], events));
  assert.equal(events.length, 2);
  assert.deepEqual(parseVerificationRegistryProjection(source).entries, []);
});

test('only canonical immediate manifest names are selected from the pinned tree', async () => {
  const files = [defaultPath, 'config/repository/work-packages/UPPER.md',
    'config/repository/work-packages/child/nested.md', 'config/repository/work-packages/other.txt']
    .map(path => ({ path, bytes: Buffer.from(path) }));
  const source = await projectWorkPackageRegistry(request, inventoryReader(files, []));
  assert.deepEqual(parseVerificationRegistryProjection(source).entries.map(entry => entry.manifestPath), [defaultPath]);
});

test('batch content is partitioned by exact framing bytes within the same caller-owned bound', async () => {
  const files = Array.from({ length: 3 }, (_, i) => ({
    path: `config/repository/work-packages/work-${i}.md`, bytes: Buffer.alloc(220, 65 + i)
  }));
  const events: string[][] = [];
  const source = await projectWorkPackageRegistry(request, inventoryReader(files, events, 512), () => {}, 512);
  assert.equal(events.filter(args => args[1] === '--batch').length, 3);
  assert.deepEqual(parseVerificationRegistryProjection(source).entries.map(entry => entry.manifestDigest),
    files.map(file => rawDigest(file.bytes)));
});

test('a raw blob at the command byte ceiling is not rejected merely for batch framing overhead', async () => {
  const files = [{ path: defaultPath, bytes: Buffer.alloc(512, 255) },
    { path: prPath, bytes: Buffer.from('small') }];
  const events: string[][] = [];
  const source = await projectWorkPackageRegistry(request, inventoryReader(files, events, 512), () => {}, 512);
  assert.equal(events.filter(args => args[1] === 'blob').length, 1);
  assert.equal(events.filter(args => args[1] === '--batch').length, 1);
  assert.equal(parseVerificationRegistryProjection(source).entries.find(entry => entry.manifestPath === defaultPath)!.manifestDigest, rawDigest(files[0]!.bytes));
});

test('oversized metadata stops before fetching content or opening another provider', async () => {
  const events: string[][] = [];
  await assert.rejects(projectWorkPackageRegistry(request,
    inventoryReader([{ path: defaultPath, bytes: Buffer.alloc(513) }, { path: prPath, bytes: Buffer.from('small') }], events, 512), () => {}, 512), /exceeds the command byte limit/);
  assert.deepEqual(events.at(-1), ['cat-file', '--batch-check']);
});

for (const stopAt of [1, 2, 3, 4]) {
  test(`record-budget rejection at debit ${stopAt} stops the current observation without retry`, async () => {
    const marker = new Error('shared record budget exhausted'), events: string[][] = [];
    let debits = 0;
    await assert.rejects(projectWorkPackageRegistry({ ...request, openPullRequests: parseOpenPullRequestList(JSON.stringify([prResponse])) }, reader(events), () => {
      if (++debits === stopAt) throw marker;
    }), error => error === marker);
    assert.equal(events.length, stopAt);
  });
}

for (const malformed of [
  `${'0'.repeat(40)} blob 9\n`, `${defaultBlob} tree 9\n`, `${defaultBlob} blob 09\n`,
  `${defaultBlob} blob 9007199254740992\n`, `${defaultBlob} blob 9`,
  `${defaultBlob} blob 9\nextra\n`
]) {
  test(`malformed batch metadata cannot produce a registry: ${JSON.stringify(malformed)}`, async () => {
    const events: string[][] = [], read = reader(events);
    await assert.rejects(projectWorkPackageRegistry({ ...request, openPullRequests: parseOpenPullRequestList(JSON.stringify([prResponse])) }, (args, input) => {
      if (args[1] === '--batch-check') return reply(malformed);
      return read(args, input);
    }), /Exact Git text batch/);
    assert.equal(events.some(args => args[1] === '--batch'), false);
  });
}

for (const malformed of [
  `${defaultBlob} blob 9\ndefault\r\n`, `${defaultBlob} blob 9\ndefault\r\n\ntrailing`,
  `${defaultBlob} blob 1\nx\n`
]) {
  test(`content framing and metadata size disagreement fail closed: ${JSON.stringify(malformed)}`, async () => {
    const read = reader([]);
    await assert.rejects(projectWorkPackageRegistry({ ...request, openPullRequests: parseOpenPullRequestList(JSON.stringify([prResponse])) }, (args, input) =>
      args[1] === '--batch' ? reply(malformed) : read(args, input)), /batch|size readback/);
  });
}

test('the body locator is captured exactly once even when source accessors change values', async () => {
  let reads = 0;
  const pr = parseOpenPullRequestList(JSON.stringify([prResponse]))[0]!;
  Object.defineProperty(pr, 'body', { enumerable: true, get: () => ++reads === 1 ? prResponse.body : 'invalid later body' });
  const source = await projectWorkPackageRegistry({ ...request, openPullRequests: [pr] }, reader([]));
  assert.equal(reads, 1);
  assert.equal(parseVerificationRegistryProjection(source).entries[1]!.manifestPath, prPath);
});

test('one manifest avoids an unnecessary size-preflight process', async () => {
  const events: string[][] = [], debits: number[] = [];
  await projectWorkPackageRegistry(request, reader(events), count => debits.push(count));
  assert.equal(events.length, 3);
  assert.deepEqual(events.at(-1), ['cat-file', 'blob', defaultBlob]);
  assert.deepEqual(debits, [1, 1, 1]);
});

for (const invalid of [0, -1, 1.5, Number.NaN, Infinity, 32 * 1024 * 1024 + 1]) {
  test(`invalid or widening byte budget ${invalid} fails before transport`, async () => {
    await assert.rejects(projectWorkPackageRegistry(request, () => { assert.fail('must not dispatch'); }, () => {}, invalid),
      /command byte limit must narrow/);
  });
}
