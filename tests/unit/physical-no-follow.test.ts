import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runRetainedGitWriteTreeProbeV1 } from '../helpers/retained-git-write-tree-probe.ts';

import type { LinuxNoFollowDirectoryCreateRaceActor, LinuxNoFollowDirectoryCreateRacePoint } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { PhysicalNoFollowError, assertRetainedNoFollowCapability, assertSameNoFollowDirectoryIdentity, createExclusiveNoFollowDirectory, createLinuxNoFollowDirectoryCreateRaceActorForTests, createNoFollowDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryChild, inspectNoFollowLinkEntry, inspectNoFollowOrdinaryFileDigest, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, relocateRetainedNoFollowDirectory, replaceDurableCanonicalFile, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, retainNoFollowOrdinaryFileForChildProcess, scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';

function fixtureRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'sec-physical-no-follow-'));
}

function expectPhysicalCode(action: () => unknown, code: PhysicalNoFollowError['code']): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PhysicalNoFollowError);
    expect((error as PhysicalNoFollowError).code).toBe(code);
    return;
  }
  throw new Error(`Expected PhysicalNoFollowError ${code}.`);
}

test('no-follow directory inspection returns an ordered physical chain and only ENOENT means absent', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'ordinary', 'target');
    mkdirSync(target, { recursive: true });
    const observed = inspectNoFollowDirectoryChain(target, 'test target');
    expect(observed.target.path).toBe(path.resolve(target));
    expect(observed.ancestors.at(-1)).toEqual(observed.target);
    expect(observed.ancestors.length).toBeGreaterThan(1);
    expect(inspectExactNoFollowDirectoryPresence(path.join(root, 'missing'))).toEqual({ state: 'absent' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no-follow inspection rejects a symlink/junction target and a symlink/junction ancestor', () => {
  const root = fixtureRoot();
  try {
    const ordinary = path.join(root, 'ordinary');
    const external = path.join(root, 'external');
    const alias = path.join(root, 'alias');
    const dangling = path.join(root, 'dangling');
    mkdirSync(ordinary);
    mkdirSync(external);
    symlinkSync(external, alias, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(path.join(root, 'missing-target'), dangling, process.platform === 'win32' ? 'junction' : 'dir');

    expectPhysicalCode(
      () => inspectNoFollowDirectoryChain(alias, 'alias target'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    expectPhysicalCode(
      () => inspectNoFollowDirectoryChain(path.join(alias, 'child'), 'alias child'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    // A dangling link is unsafe, not the only allowed "absent" outcome.
    expectPhysicalCode(
      () => inspectExactNoFollowDirectoryPresence(dangling, 'dangling alias'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    expect(inspectNoFollowDirectoryChain(ordinary).target.path).toBe(path.resolve(ordinary));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'Windows wrong-kind link inspection closes its opened native handle before returning the typed failure',
  () => {
    const root = fixtureRoot();
    try {
      const parentPath = path.join(root, 'parent');
      const childPath = path.join(parentPath, 'ordinary-child');
      const movedParent = path.join(root, 'parent-moved');
      mkdirSync(childPath, { recursive: true });
      const parent = inspectNoFollowDirectoryChain(parentPath, 'wrong-kind parent').target;

      expectPhysicalCode(
        () => inspectNoFollowLinkEntry(parent, 'ordinary-child'),
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
      );

      // The relative open succeeds before link-kind validation rejects this
      // ordinary directory.  A failed validator must close that native handle
      // before ownership can return to the caller, or Windows pins this whole
      // ancestor namespace until process exit.
      renameSync(parentPath, movedParent);
      renameSync(movedParent, parentPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('same-identity readback rejects replacement rather than accepting same lexical bytes', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const retained = path.join(root, 'retained');
    mkdirSync(target);
    const original = inspectNoFollowDirectoryChain(target, 'replace target').target;
    renameSync(target, retained);
    mkdirSync(target);
    expectPhysicalCode(
      () => assertSameNoFollowDirectoryIdentity(original, 'replace target'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained child inspection is create-free and exclusive creation never adopts a collision', () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'parent');
    const displacedParent = path.join(root, 'parent-displaced');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChain(parentPath).target;

    expect(inspectNoFollowDirectoryChild(parent, 'child')).toBeNull();
    expect(existsSync(path.join(parentPath, 'child'))).toBe(false);
    const child = createExclusiveNoFollowDirectory(parent, 'child');
    expect(inspectNoFollowDirectoryChild(parent, 'child')).toEqual(child);
    expectPhysicalCode(
      () => createExclusiveNoFollowDirectory(parent, 'child'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );

    renameSync(parentPath, displacedParent);
    mkdirSync(parentPath);
    expectPhysicalCode(
      () => createExclusiveNoFollowDirectory(parent, 'replacement-child'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(existsSync(path.join(parentPath, 'replacement-child'))).toBe(false);
    expect(existsSync(path.join(displacedParent, 'child'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux directory-create transaction rejects parent, ancestor, and child replacement races', () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const expectRaceRejected = (
      point: LinuxNoFollowDirectoryCreateRacePoint,
      targetPath: string,
      displacedPath: string,
      action: (actor: LinuxNoFollowDirectoryCreateRaceActor) => unknown
    ): void => {
      const actor = createLinuxNoFollowDirectoryCreateRaceActorForTests({
        point,
        targetPath,
        displacedPath
      });
      expectPhysicalCode(() => action(actor), 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED');
    };

    const exclusiveParentPath = path.join(root, 'exclusive-parent');
    mkdirSync(exclusiveParentPath);
    const exclusiveParent = inspectNoFollowDirectoryChain(exclusiveParentPath).target;
    const exclusiveTarget = path.join(exclusiveParentPath, 'child');
    const exclusiveDisplaced = path.join(exclusiveParentPath, 'child-displaced');
    expectRaceRejected(
      'before-child-witness',
      exclusiveTarget,
      exclusiveDisplaced,
      (actor) => createExclusiveNoFollowDirectory(exclusiveParent, 'child', actor)
    );
    expect(lstatSync(exclusiveTarget).isDirectory()).toBe(true);
    expect(lstatSync(exclusiveDisplaced).isDirectory()).toBe(true);

    const chainParentPath = path.join(root, 'chain-parent');
    mkdirSync(chainParentPath);
    const chainParent = inspectNoFollowDirectoryChain(chainParentPath).target;
    const chainTarget = path.join(chainParentPath, 'operation-root');
    const chainDisplaced = path.join(chainParentPath, 'operation-root-displaced');
    expectRaceRejected(
      'before-child-witness',
      chainTarget,
      chainDisplaced,
      (actor) => createNoFollowDirectoryChain(
        chainParent,
        ['operation-root', 'generation-one'],
        actor
      )
    );
    expect(lstatSync(chainTarget).isDirectory()).toBe(true);
    expect(lstatSync(chainDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(chainTarget, 'generation-one'))).toBe(false);
    expect(existsSync(path.join(chainDisplaced, 'generation-one'))).toBe(false);

    const prewatchExclusiveParent = path.join(root, 'prewatch-exclusive-parent');
    const prewatchExclusiveDisplaced = path.join(root, 'prewatch-exclusive-parent-displaced');
    mkdirSync(prewatchExclusiveParent);
    const prewatchExclusiveIdentity = inspectNoFollowDirectoryChain(
      prewatchExclusiveParent
    ).target;
    expectRaceRejected(
      'before-canonical-chain-open',
      prewatchExclusiveParent,
      prewatchExclusiveDisplaced,
      (actor) => createExclusiveNoFollowDirectory(prewatchExclusiveIdentity, 'child', actor)
    );
    expect(lstatSync(prewatchExclusiveParent).isDirectory()).toBe(true);
    expect(lstatSync(prewatchExclusiveDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(prewatchExclusiveParent, 'child'))).toBe(false);
    expect(existsSync(path.join(prewatchExclusiveDisplaced, 'child'))).toBe(false);

    const ancestorExclusiveScope = path.join(root, 'ancestor-exclusive-scope');
    const ancestorExclusiveParent = path.join(ancestorExclusiveScope, 'run', 'parent');
    const ancestorExclusiveDisplaced = path.join(root, 'ancestor-exclusive-scope-displaced');
    mkdirSync(ancestorExclusiveParent, { recursive: true });
    const ancestorExclusiveIdentity = inspectNoFollowDirectoryChain(
      ancestorExclusiveParent
    ).target;
    expectRaceRejected(
      'after-ancestor-open',
      ancestorExclusiveScope,
      ancestorExclusiveDisplaced,
      (actor) => createExclusiveNoFollowDirectory(ancestorExclusiveIdentity, 'child', actor)
    );
    expect(lstatSync(ancestorExclusiveScope).isDirectory()).toBe(true);
    expect(lstatSync(ancestorExclusiveDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(ancestorExclusiveScope, 'run', 'parent', 'child'))).toBe(false);
    expect(existsSync(path.join(ancestorExclusiveDisplaced, 'run', 'parent', 'child'))).toBe(false);

    const ancestorChainScope = path.join(root, 'ancestor-chain-scope');
    const ancestorChainParent = path.join(ancestorChainScope, 'run', 'parent');
    const ancestorChainDisplaced = path.join(root, 'ancestor-chain-scope-displaced');
    mkdirSync(ancestorChainParent, { recursive: true });
    const ancestorChainIdentity = inspectNoFollowDirectoryChain(ancestorChainParent).target;
    expectRaceRejected(
      'after-ancestor-open',
      ancestorChainScope,
      ancestorChainDisplaced,
      (actor) => createNoFollowDirectoryChain(
        ancestorChainIdentity,
        ['operation-root', 'generation-one'],
        actor
      )
    );
    expect(lstatSync(ancestorChainScope).isDirectory()).toBe(true);
    expect(lstatSync(ancestorChainDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(ancestorChainScope, 'run', 'parent', 'operation-root'))).toBe(false);
    expect(existsSync(path.join(ancestorChainDisplaced, 'run', 'parent', 'operation-root'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('operation directory creation is retained-parent relative and returns exact created identities', () => {
  const root = fixtureRoot();
  try {
    const retained = inspectNoFollowDirectoryChain(root, 'directory creation root').target;
    const created = createNoFollowDirectoryChain(retained, ['operation-root', 'generation-one']);
    expect(created.path).toBe(path.join(root, 'operation-root', 'generation-one'));
    expect(inspectNoFollowDirectoryChain(created.path, 'created directory').target.inode).toBe(created.inode);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary no-follow reader rejects dangling/reparse leaves and a replaced retained parent', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'parent');
    mkdirSync(parentPath);
    writeFileSync(path.join(parentPath, 'ordinary.json'), '{"safe":true}\n', 'utf8');
    symlinkSync(path.join(root, 'missing.json'), path.join(parentPath, 'dangling.json'), 'file');
    const parent = inspectNoFollowDirectoryChain(parentPath, 'reader parent').target;
    expect(Buffer.from(readNoFollowOrdinaryFile(parent, 'ordinary.json')!).toString('utf8')).toBe('{"safe":true}\n');
    expectPhysicalCode(
      () => readNoFollowOrdinaryFile(parent, 'dangling.json'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    const moved = `${parentPath}-moved`;
    renameSync(parentPath, moved);
    mkdirSync(parentPath);
    writeFileSync(path.join(parentPath, 'ordinary.json'), '{"replaced":true}\n', 'utf8');
    expectPhysicalCode(
      () => readNoFollowOrdinaryFile(parent, 'ordinary.json'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(readFileSync(path.join(moved, 'ordinary.json'), 'utf8')).toBe('{"safe":true}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained child-process directory reads the authorized inode after lexical replacement', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const displaced = path.join(root, 'target-displaced');
    mkdirSync(target);
    writeFileSync(path.join(target, 'value.txt'), 'authorized\n', 'utf8');
    const capability = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(target, 'retained child directory'),
      3,
      'retained child directory'
    );
    try {
      if (process.platform === 'linux') {
        expect(capability.stdioSourceDescriptor).toEqual(expect.any(Number));
        expect(capability.stdioSourceDescriptor!).toBeGreaterThanOrEqual(5);
      }
      if (process.platform === 'linux') {
        renameSync(target, displaced);
        mkdirSync(target);
        writeFileSync(path.join(target, 'value.txt'), 'replacement\n', 'utf8');
      } else if (process.platform === 'win32') {
        expect(() => renameSync(target, displaced)).toThrow();
      }
      const stdio: Array<'ignore' | 'pipe' | number> = [
        'ignore',
        'pipe',
        'pipe',
        capability.stdioSourceDescriptor ?? 'ignore'
      ];
      const child = spawnSync(process.execPath, [
        '-e',
        'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))',
        path.join(capability.childPath, 'value.txt')
      ], {
        encoding: 'utf8',
        stdio
      });
      expect(child.status).toBe(0);
      expect(child.stdout).toBe('authorized\n');
      capability.assertCurrent();
    } finally {
      capability.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows retained child-process boundary blocks relocation above its pinned parent', () => {
  if (process.platform !== 'win32') return;
  const root = fixtureRoot();
  try {
    const ancestor = path.join(root, 'ancestor');
    const parent = path.join(ancestor, 'parent');
    const target = path.join(parent, 'target');
    const displaced = path.join(root, 'ancestor-displaced');
    mkdirSync(target, { recursive: true });
    const capability = retainNoFollowDirectoryForChildProcess(
      inspectNoFollowDirectoryChain(target, 'retained descendant boundary'),
      3,
      'retained descendant boundary'
    );
    try {
      expect(() => renameSync(ancestor, displaced)).toThrow();
      capability.assertCurrent();
    } finally {
      capability.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained child-process file reads the observed inode after leaf replacement', () => {
  const root = fixtureRoot();
  try {
    const filePath = path.join(root, 'index');
    const displaced = path.join(root, 'index-displaced');
    writeFileSync(filePath, 'authorized-index\n', 'utf8');
    const parent = inspectNoFollowDirectoryChain(root, 'retained file parent');
    const entry = inspectNoFollowOrdinaryFileEntry(parent.target, 'index')!;
    const capability = retainNoFollowOrdinaryFileForChildProcess(
      parent,
      entry,
      3,
      'retained index file'
    );
    try {
      expect(capability.physical).toEqual({ device: entry!.device, inode: entry!.inode });
      expect(capability.size).toBe(Buffer.byteLength('authorized-index\n'));
      if (process.platform === 'linux') {
        expect(capability.stdioSourceDescriptor).toEqual(expect.any(Number));
        expect(capability.stdioSourceDescriptor!).toBeGreaterThanOrEqual(5);
      } else {
        expect(capability.stdioSourceDescriptor).toBeNull();
      }
      if (process.platform === 'linux') {
        renameSync(filePath, displaced);
        writeFileSync(filePath, 'replacement-index\n', 'utf8');
      } else if (process.platform === 'win32') {
        expect(() => renameSync(filePath, displaced)).toThrow();
      }
      const child = spawnSync(process.execPath, [
        '-e',
        'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))',
        capability.childPath
      ], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe', capability.stdioSourceDescriptor ?? 'ignore']
      });
      expect(child.status).toBe(0);
      expect(child.stdout).toBe('authorized-index\n');
      expect(capability.digest().byteDigest).toBe(
        `sha256:${createHash('sha256').update('authorized-index\n').digest('hex')}`
      );
      capability.assertCurrent();
    } finally {
      capability.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained Git index and object directories support write-tree without lexical reopen', () => {
  expect(runRetainedGitWriteTreeProbeV1()).toMatch(/^[0-9a-f]{40}$/u);
});

test('exact ordinary leaf observation does not scan unrelated parent entries', () => {
  const root = fixtureRoot();
  try {
    writeFileSync(path.join(root, 'fence.json'), '{"safe":true}\n', 'utf8');
    writeFileSync(path.join(root, 'unrelated-large.bin'), Buffer.alloc(65 * 1024 * 1024));
    const parent = inspectNoFollowDirectoryChain(root, 'exact leaf parent').target;

    const entry = inspectNoFollowOrdinaryFileEntry(parent, 'fence.json');

    expect(entry?.relativePath).toBe('fence.json');
    expect(entry?.kind).toBe('file');
    expect(entry?.size).toBe(Buffer.byteLength('{"safe":true}\n'));
    expect(Buffer.from(entry?.bytes ?? []).toString('utf8')).toBe('{"safe":true}\n');
    if (process.platform === 'linux') {
      const metadata = lstatSync(path.join(root, 'fence.json'), { bigint: true });
      expect(entry?.device).toBe(String(metadata.dev));
      expect(entry?.inode).toBe(String(metadata.ino));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact ordinary leaf observation enforces the same selected-leaf bound', () => {
  const root = fixtureRoot();
  try {
    writeFileSync(path.join(root, 'oversized-fence.json'), Buffer.alloc(65 * 1024 * 1024));
    const parent = inspectNoFollowDirectoryChain(root, 'oversized leaf parent').target;
    expectPhysicalCode(
      () => inspectNoFollowOrdinaryFileEntry(parent, 'oversized-fence.json'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact ordinary leaf identity follows the retained physical file rather than its name or bytes', () => {
  const root = fixtureRoot();
  try {
    const originalPath = path.join(root, 'original.json');
    const aliasPath = path.join(root, 'alias.json');
    writeFileSync(originalPath, '{"same":true}\n', 'utf8');
    linkSync(originalPath, aliasPath);
    const parent = inspectNoFollowDirectoryChain(root, 'identity leaf parent').target;
    const original = inspectNoFollowOrdinaryFileEntry(parent, 'original.json');
    const alias = inspectNoFollowOrdinaryFileEntry(parent, 'alias.json');
    expect(alias?.device).toBe(original?.device);
    expect(alias?.inode).toBe(original?.inode);
    expect(alias?.size).toBe(original?.size);
    expect(Buffer.from(alias?.bytes ?? [])).toEqual(Buffer.from(original?.bytes ?? []));

    rmSync(aliasPath);
    writeFileSync(aliasPath, '{"same":true}\n', 'utf8');
    const replacement = inspectNoFollowOrdinaryFileEntry(parent, 'alias.json');
    expect(`${replacement?.device}:${replacement?.inode}`).not.toBe(`${original?.device}:${original?.inode}`);
    expect(Buffer.from(replacement?.bytes ?? [])).toEqual(Buffer.from(original?.bytes ?? []));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux exact ordinary leaf rejects a FIFO without a blocking open', async () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  const fifoPath = path.join(root, 'retirement-fence.json');
  try {
    const created = Bun.spawnSync({ cmd: ['mkfifo', fifoPath], stdout: 'pipe', stderr: 'pipe' });
    expect(created.exitCode).toBe(0);
    const moduleUrl = new URL('../../src/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
    const child = Bun.spawn({
      cmd: [process.execPath, '-e', `
        import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry } from ${JSON.stringify(moduleUrl)};
        const parent = inspectNoFollowDirectoryChain(${JSON.stringify(root)}, 'fifo parent').target;
        try {
          inspectNoFollowOrdinaryFileEntry(parent, 'retirement-fence.json');
          process.exit(2);
        } catch (error) {
          process.exit(error?.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' ? 0 : 3);
        }
      `],
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const result = await Promise.race([
      child.exited.then((exitCode) => ({ exitCode, timedOut: false })),
      new Promise<{ exitCode: number; timedOut: true }>((resolve) => setTimeout(() => resolve({ exitCode: -1, timedOut: true }), 3_000))
    ]);
    if (result.timedOut) {
      child.kill('SIGKILL');
      await child.exited;
    }
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 5_000);

test('retained directory relocation makes the original path absent and rejects a substituted tombstone', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'keep.txt'), 'bound-to-target\n', 'utf8');
    const original = inspectNoFollowDirectoryChain(target, 'relocation source').target;
    const moved = relocateRetainedNoFollowDirectory({ directory: original, tombstoneName: 'target-tombstone' });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(path.join(moved.path, 'keep.txt'), 'utf8')).toBe('bound-to-target\n');
    mkdirSync(target);
    expectPhysicalCode(
      () => assertSameNoFollowDirectoryIdentity(original, 'rebuilt original path'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(existsSync(target)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('Linux relocation preserves the retained identity without replacement', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'renameat-target');
    mkdirSync(target);
    const original = inspectNoFollowDirectoryChain(target, 'Linux renameat source').target;
    const moved = relocateRetainedNoFollowDirectory({ directory: original, tombstoneName: 'renameat-tombstone' });
    expect(moved.inode).toBe(original.inode);
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tree scan records a child link as an unsafe leaf and never traverses it', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const external = path.join(root, 'external');
    mkdirSync(target);
    mkdirSync(external);
    symlinkSync(external, path.join(target, 'child-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const entries = scanNoFollowDirectoryTree(inspectNoFollowDirectoryChain(target, 'scan target').target);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ relativePath: 'child-link', kind: 'link' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('Linux tree inventory returns exact retained-link targets', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    symlinkSync('../external-target', path.join(target, 'relative-link'), 'file');
    symlinkSync(path.join(root, 'missing-target'), path.join(target, 'absolute-link'), 'file');
    const entries = new Map(scanNoFollowDirectoryTreeInventory(
      inspectNoFollowDirectoryChain(target, 'retained link inventory target').target
    ).map((entry) => [entry.relativePath, entry]));
    expect(entries.get('relative-link')).toMatchObject({
      kind: 'link', linkTarget: '../external-target'
    });
    expect(entries.get('absolute-link')).toMatchObject({
      kind: 'link', linkTarget: path.join(root, 'missing-target')
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('streaming tree inventory preserves the canonical digest domain beyond the bounded byte reader', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    const smallBytes = Buffer.from('canonical-small-content\n', 'utf8');
    writeFileSync(path.join(target, 'small.txt'), smallBytes);
    const largePath = path.join(target, 'large.bin');
    const largeSize = 64 * 1024 * 1024 + 4096;
    writeFileSync(largePath, '');
    truncateSync(largePath, largeSize);
    const largeHandle = openSync(largePath, 'r+');
    try {
      writeSync(largeHandle, Buffer.from('large-start'), 0, 11, 0);
      writeSync(largeHandle, Buffer.from('large-end'), 0, 9, largeSize - 9);
    } finally {
      closeSync(largeHandle);
    }
    const identity = inspectNoFollowDirectoryChain(target, 'streaming inventory target').target;
    expect(() => scanNoFollowDirectoryTree(identity)).toThrow('exceeds the bounded no-follow read size');
    const first = new Map(scanNoFollowDirectoryTreeInventory(identity).map((entry) => [entry.relativePath, entry]));
    const second = new Map(scanNoFollowDirectoryTreeInventory(identity).map((entry) => [entry.relativePath, entry]));
    expect(first.get('small.txt')?.contentDigest).toBe(
      sha256({ bytes: smallBytes.toString('hex') }) as `sha256:${string}`
    );
    expect(inspectNoFollowOrdinaryFileDigest(identity, 'small.txt')).toEqual({
      size: smallBytes.byteLength,
      byteDigest: `sha256:${createHash('sha256').update(smallBytes).digest('hex')}`
    });
    expect(first.get('large.bin')).toMatchObject({ kind: 'file', size: largeSize });
    expect(first.get('large.bin')?.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second.get('large.bin')?.contentDigest).toBe(first.get('large.bin')?.contentDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained ordinary-file capability binds raw digest, size, and leaf identity to one handle', () => {
  if (process.platform !== 'linux' && process.platform !== 'win32') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const filePath = path.join(target, 'executable.bin');
    const bytes = Buffer.from('retained executable bytes\n', 'utf8');
    mkdirSync(target);
    writeFileSync(filePath, bytes);
    const parentChain = inspectNoFollowDirectoryChain(target, 'retained executable parent');
    const entry = inspectNoFollowOrdinaryFileEntry(parentChain.target, 'executable.bin');
    expect(entry).not.toBeNull();
    const capability = retainNoFollowOrdinaryFile(
      parentChain,
      'executable.bin',
      { device: entry!.device, inode: entry!.inode },
      'retained executable'
    );
    try {
      assertRetainedNoFollowCapability(capability, 'ordinary-file', 'retained executable test');
      expect(() => assertRetainedNoFollowCapability(capability, 'executable', 'forged executable role'))
        .toThrow('was not issued by the physical no-follow owner');
      expect(() => assertRetainedNoFollowCapability({ ...capability }, 'ordinary-file', 'forged capability'))
        .toThrow('was not issued by the physical no-follow owner');
      expect(capability.size).toBe(bytes.byteLength);
      expect(capability.physical).toEqual({ device: entry!.device, inode: entry!.inode });
      expect(Buffer.from(capability.readBytes())).toEqual(bytes);
      const observed = capability.digest();
      expect(observed.size).toBe(bytes.byteLength);
      expect(observed.byteDigest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
      capability.assertCurrent();

      const displaced = path.join(target, 'executable-displaced.bin');
      if (process.platform === 'win32') {
        // The retained Windows handle withholds delete sharing, so a lexical
        // replacement is rejected by the kernel while the capability lives.
        expect(() => renameSync(filePath, displaced)).toThrow();
        capability.assertCurrent();
      } else {
        renameSync(filePath, displaced);
        writeFileSync(filePath, bytes);
        expectPhysicalCode(
          () => capability.assertCurrent(),
          'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
        );
      }
    } finally {
      capability.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained ordinary-file digest rejects a same-size in-place rewrite', () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const filePath = path.join(target, 'executable.bin');
    const original = Buffer.from('same-size-original\n', 'utf8');
    const replacement = Buffer.from('same-size-replaced\n', 'utf8');
    expect(replacement.byteLength).toBe(original.byteLength);
    mkdirSync(target);
    writeFileSync(filePath, original);
    const parent = inspectNoFollowDirectoryChain(target, 'same-size rewrite parent');
    const capability = retainNoFollowOrdinaryFile(
      parent,
      'executable.bin',
      undefined,
      'same-size rewrite capability',
      3,
      'executable'
    );
    try {
      const writer = openSync(filePath, 'r+');
      try {
        writeSync(writer, replacement, 0, replacement.byteLength, 0);
      } finally {
        closeSync(writer);
      }
      expectPhysicalCode(
        () => capability.digest(),
        'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
      );
    } finally {
      capability.dispose();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'Windows executable role excludes existing and future writers until disposal',
  () => {
  const root = fixtureRoot();
  let capability: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
  try {
    const target = path.join(root, 'target');
    const filePath = path.join(target, 'executable.bin');
    const displaced = path.join(target, 'executable-displaced.bin');
    const original = Buffer.from('role-bound-original\n', 'utf8');
    const replacement = Buffer.from('role-bound-replaced\n', 'utf8');
    expect(replacement.byteLength).toBe(original.byteLength);
    mkdirSync(target);
    writeFileSync(filePath, original);
    const parent = inspectNoFollowDirectoryChain(target, 'role admission parent');

    const existingWriter = openSync(filePath, 'r+');
    try {
      expectPhysicalCode(() => retainNoFollowOrdinaryFile(
        parent,
        'executable.bin',
        undefined,
        'writer-conflicted executable role admission',
        3,
        'executable'
      ), 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE');
    } finally {
      closeSync(existingWriter);
    }

    capability = retainNoFollowOrdinaryFile(
      parent,
      'executable.bin',
      undefined,
      'writer-excluded executable role admission',
      3,
      'executable'
    );
    assertRetainedNoFollowCapability(capability, 'executable', 'writer-excluded executable');
    const admittedDigest = capability.digest();

    expect(() => openSync(filePath, 'r+')).toThrow();
    expect(() => writeFileSync(filePath, replacement)).toThrow();
    expect(() => truncateSync(filePath, 0)).toThrow();
    expect(() => renameSync(filePath, displaced)).toThrow();
    expect(() => rmSync(filePath)).toThrow();
    expect(capability.digest()).toEqual(admittedDigest);

    capability.dispose();
    capability = undefined;
    writeFileSync(filePath, replacement);
    renameSync(filePath, displaced);
    expect(readFileSync(displaced)).toEqual(replacement);
  } finally {
    capability?.dispose();
    rmSync(root, { recursive: true, force: true });
  }
  }
);

test.skipIf(process.platform !== 'linux')(
  'executable role admission is typed-unavailable without sealed image support',
  () => {
    const root = fixtureRoot();
    try {
      const target = path.join(root, 'target');
      const filePath = path.join(target, 'executable.bin');
      mkdirSync(target);
      writeFileSync(filePath, 'role-bound executable\n');
      const parent = inspectNoFollowDirectoryChain(target, 'role admission parent');
      expect(() => retainNoFollowOrdinaryFile(
        parent,
        'executable.bin',
        undefined,
        'unsealed executable role admission',
        3,
        'executable'
      )).toThrow('sealed image or mandatory writer-exclusion primitive');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('metadata inventory does not read sparse file bytes and enforces entry and deadline bounds', () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    const sparse = path.join(target, 'large-sparse.bin');
    const second = path.join(target, 'second.txt');
    closeSync(openSync(sparse, 'w'));
    truncateSync(sparse, 512 * 1024 * 1024);
    writeFileSync(second, 'small');
    const identity = inspectNoFollowDirectoryChain(target, 'metadata target').target;

    const startedAt = performance.now();
    const inventory = new Map(scanNoFollowDirectoryTreeMetadata(identity, {
      deadlineAtMs: startedAt + 2_000,
      maximumEntries: 2
    }).map((entry) => [entry.relativePath, entry]));
    expect(inventory.get('large-sparse.bin')).toMatchObject({
      kind: 'file',
      size: 512 * 1024 * 1024,
      contentDigest: null
    });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expectPhysicalCode(
      () => scanNoFollowDirectoryTreeMetadata(identity, {
        deadlineAtMs: performance.now() + 2_000,
        maximumEntries: 1
      }),
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
    );
    expectPhysicalCode(
      () => scanNoFollowDirectoryTreeMetadata(identity, {
        deadlineAtMs: performance.now() - 1,
        maximumEntries: 10
      }),
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exclusive durable canonical publication is idempotent and refuses a conflicting existing value', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'durable');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChain(parentPath, 'durable parent').target;
    const bytes = Buffer.from('{"schema":"test-v1"}\n', 'utf8');
    const validate = (value: Uint8Array): void => {
      const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as { schema?: unknown };
      if (parsed.schema !== 'test-v1') throw new Error('invalid test canonical bytes');
    };
    const publish = () => publishExclusiveDurableCanonicalFile({ parent, name: 'authorization.json', bytes, validate });
    const first = publish();
    expect(first.created).toBe(true);
    expect(readFileSync(first.path)).toEqual(bytes);
    const second = publishExclusiveDurableCanonicalFile({ parent, name: 'authorization.json', bytes, validate });
    expect(second).toEqual({ ...first, created: false });
    expectPhysicalCode(
      () => publishExclusiveDurableCanonicalFile({
        parent,
        name: 'authorization.json',
        bytes: Buffer.from('{"schema":"different"}\n', 'utf8'),
        validate: (value) => {
          const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as { schema?: unknown };
          if (parsed.schema !== 'different') throw new Error('existing value belongs to another canonical identity');
        }
      }),
      'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'
    );
    expect(existsSync(path.join(parentPath, '.authorization.json.candidate'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable canonical replacement uses retained-parent publication and exact final readback', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'replacement');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChain(parentPath, 'replacement parent').target;
    const validate = (value: Uint8Array): void => {
      if (!JSON.parse(Buffer.from(value).toString('utf8')).schema) throw new Error('invalid replacement bytes');
    };
    const first = Buffer.from('{"schema":"one"}\n', 'utf8');
    const second = Buffer.from('{"schema":"two"}\n', 'utf8');
    replaceDurableCanonicalFile({ parent, name: 'latest.json', bytes: first, validate });
    const replaced = replaceDurableCanonicalFile({ parent, name: 'latest.json', bytes: second, validate });
    expect(readFileSync(replaced.path)).toEqual(second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows retained-handle deletion removes authorized file directory and reparse leaf and rejects a replaced parent', () => {
  if (process.platform !== 'win32') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const external = path.join(root, 'external');
    mkdirSync(target);
    mkdirSync(external);
    const authorizedFile = path.join(target, 'authorized-file.txt');
    const survivingReadonlyLink = path.join(external, 'surviving-readonly-link.txt');
    writeFileSync(authorizedFile, 'only-this-file\n', 'utf8');
    linkSync(authorizedFile, survivingReadonlyLink);
    chmodSync(authorizedFile, 0o444);
    expect(lstatSync(survivingReadonlyLink).mode & 0o222).toBe(0);
    mkdirSync(path.join(target, 'authorized-directory'));
    symlinkSync(external, path.join(target, 'authorized-link'), 'junction');
    const identity = inspectNoFollowDirectoryChain(target, 'retained target').target;
    const entries = new Map(scanNoFollowDirectoryTree(identity).map((entry) => [entry.relativePath, entry]));
    const authorizedLink = entries.get('authorized-link')!;
    expectPhysicalCode(
      () => deleteRetainedNoFollowEntry({
        root: identity,
        relativePath: authorizedLink.relativePath,
        kind: 'link',
        device: authorizedLink.device,
        inode: authorizedLink.inode,
        expectedLinkTarget: `${authorizedLink.linkTarget}-retargeted`,
        ancestorDirectories: []
      }),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(existsSync(path.join(target, 'authorized-link'))).toBe(true);
    for (const name of ['authorized-file.txt', 'authorized-directory', 'authorized-link']) {
      const entry = entries.get(name)!;
      deleteRetainedNoFollowEntry({
        root: identity,
        relativePath: entry.relativePath,
        kind: entry.kind,
        device: entry.device,
        inode: entry.inode,
        ...(entry.kind === 'link' ? { expectedLinkTarget: entry.linkTarget! } : {}),
        ancestorDirectories: []
      });
      expect(existsSync(path.join(target, name))).toBe(false);
    }
    expect(readFileSync(survivingReadonlyLink, 'utf8')).toBe('only-this-file\n');
    expect(lstatSync(survivingReadonlyLink).mode & 0o222).toBe(0);
    mkdirSync(path.join(target, 'replacement-parent'));
    writeFileSync(path.join(target, 'replacement-parent', 'retain.txt'), 'old\n', 'utf8');
    const original = inspectNoFollowDirectoryChain(path.join(target, 'replacement-parent'), 'original parent').target;
    const old = `${original.path}-old`;
    renameSync(original.path, old);
    mkdirSync(original.path);
    expectPhysicalCode(
      () => deleteRetainedNoFollowEntry({
        root: original,
        relativePath: 'retain.txt',
        kind: 'file',
        device: 'not-used-after-root-fence',
        inode: 'not-used-after-root-fence',
        ancestorDirectories: []
      }),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(readFileSync(path.join(old, 'retain.txt'), 'utf8')).toBe('old\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux retained openat leaf deletion covers an ordinary file directory and dangling link', () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'authorized-file.txt'), 'only-this-file\n', 'utf8');
    mkdirSync(path.join(target, 'authorized-directory'));
    symlinkSync(path.join(root, 'does-not-exist'), path.join(target, 'authorized-link'), 'file');
    const identity = inspectNoFollowDirectoryChain(target, 'retained target').target;
    const entries = new Map(scanNoFollowDirectoryTree(identity).map((entry) => [entry.relativePath, entry]));
    for (const name of ['authorized-file.txt', 'authorized-directory', 'authorized-link']) {
      const entry = entries.get(name)!;
      deleteRetainedNoFollowEntry({
        root: identity,
        relativePath: entry.relativePath,
        kind: entry.kind,
        device: entry.device,
        inode: entry.inode,
        ancestorDirectories: []
      });
      expect(existsSync(path.join(target, name))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained deletion rejects a replaced inventoried ancestor before touching a hard-linked leaf', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const parent = path.join(target, 'parent');
    mkdirSync(parent, { recursive: true });
    writeFileSync(path.join(parent, 'leaf.txt'), 'authorized inode\n', 'utf8');
    const targetIdentity = inspectNoFollowDirectoryChain(target, 'ancestor target').target;
    const inventory = new Map(scanNoFollowDirectoryTree(targetIdentity).map((entry) => [entry.relativePath, entry]));
    const authorizedParent = inventory.get('parent')!;
    const authorizedLeaf = inventory.get('parent/leaf.txt')!;
    const retainedParent = `${parent}-retained`;
    renameSync(parent, retainedParent);
    mkdirSync(parent);
    linkSync(path.join(retainedParent, 'leaf.txt'), path.join(parent, 'leaf.txt'));
    expectPhysicalCode(() => deleteRetainedNoFollowEntry({
      root: targetIdentity,
      relativePath: 'parent/leaf.txt',
      kind: 'file',
      device: authorizedLeaf.device,
      inode: authorizedLeaf.inode,
      ancestorDirectories: [{ relativePath: 'parent', device: authorizedParent.device, inode: authorizedParent.inode }]
    }), 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED');
    expect(readFileSync(path.join(retainedParent, 'leaf.txt'), 'utf8')).toBe('authorized inode\n');
    expect(readFileSync(path.join(parent, 'leaf.txt'), 'utf8')).toBe('authorized inode\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux retained deletion accepts selected-name absence when another hard link survives', () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'selected.txt'), 'shared inode\n', 'utf8');
    linkSync(path.join(target, 'selected.txt'), path.join(root, 'surviving-link.txt'));
    const identity = inspectNoFollowDirectoryChain(target, 'hard-link target').target;
    const selected = scanNoFollowDirectoryTree(identity).find((entry) => entry.relativePath === 'selected.txt')!;
    deleteRetainedNoFollowEntry({
      root: identity,
      relativePath: selected.relativePath,
      kind: 'file',
      device: selected.device,
      inode: selected.inode,
      ancestorDirectories: []
    });
    expect(existsSync(path.join(target, 'selected.txt'))).toBe(false);
    expect(readFileSync(path.join(root, 'surviving-link.txt'), 'utf8')).toBe('shared inode\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
