import { expect, test } from 'bun:test';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  PhysicalNoFollowError,
  assertSameNoFollowDirectoryIdentityV1,
  createNoFollowDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  relocateRetainedNoFollowDirectoryV1,
  replaceDurableCanonicalFileV1,
  scanNoFollowDirectoryTreeV1
} from '../../platform/shared/physical-no-follow.ts';

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
    const observed = inspectNoFollowDirectoryChainV1(target, 'test target');
    expect(observed.target.path).toBe(path.resolve(target));
    expect(observed.ancestors.at(-1)).toEqual(observed.target);
    expect(observed.ancestors.length).toBeGreaterThan(1);
    expect(inspectExactNoFollowDirectoryPresenceV1(path.join(root, 'missing'))).toEqual({ state: 'absent' });
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
      () => inspectNoFollowDirectoryChainV1(alias, 'alias target'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    expectPhysicalCode(
      () => inspectNoFollowDirectoryChainV1(path.join(alias, 'child'), 'alias child'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    // A dangling link is unsafe, not the only allowed "absent" outcome.
    expectPhysicalCode(
      () => inspectExactNoFollowDirectoryPresenceV1(dangling, 'dangling alias'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    expect(inspectNoFollowDirectoryChainV1(ordinary).target.path).toBe(path.resolve(ordinary));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('same-identity readback rejects replacement rather than accepting same lexical bytes', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const retained = path.join(root, 'retained');
    mkdirSync(target);
    const original = inspectNoFollowDirectoryChainV1(target, 'replace target').target;
    renameSync(target, retained);
    mkdirSync(target);
    expectPhysicalCode(
      () => assertSameNoFollowDirectoryIdentityV1(original, 'replace target'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('operation directory creation is retained-parent relative and returns exact created identities', () => {
  const root = fixtureRoot();
  try {
    const retained = inspectNoFollowDirectoryChainV1(root, 'directory creation root').target;
    const created = createNoFollowDirectoryChainV1(retained, ['operation-root', 'generation-one']);
    expect(created.path).toBe(path.join(root, 'operation-root', 'generation-one'));
    expect(inspectNoFollowDirectoryChainV1(created.path, 'created directory').target.inode).toBe(created.inode);
    const source = readFileSync(path.join(import.meta.dir, '../../platform/shared/physical-no-follow.ts'), 'utf8');
    const start = source.indexOf('export function createNoFollowDirectoryChainV1(');
    const end = source.indexOf('\nfunction ensureLeafName(', start);
    const implementation = source.slice(start, end);
    expect(implementation).not.toContain('mkdirSync');
    expect(implementation).toContain('symbols.mkdirat(');
    expect(implementation).toContain('windowsOpenRelativeDirectory(');
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
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'reader parent').target;
    expect(Buffer.from(readNoFollowOrdinaryFileV1(parent, 'ordinary.json')!).toString('utf8')).toBe('{"safe":true}\n');
    expectPhysicalCode(
      () => readNoFollowOrdinaryFileV1(parent, 'dangling.json'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    const moved = `${parentPath}-moved`;
    renameSync(parentPath, moved);
    mkdirSync(parentPath);
    writeFileSync(path.join(parentPath, 'ordinary.json'), '{"replaced":true}\n', 'utf8');
    expectPhysicalCode(
      () => readNoFollowOrdinaryFileV1(parent, 'ordinary.json'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(readFileSync(path.join(moved, 'ordinary.json'), 'utf8')).toBe('{"safe":true}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained directory relocation makes the original path absent and rejects a substituted tombstone', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'keep.txt'), 'bound-to-target\n', 'utf8');
    const original = inspectNoFollowDirectoryChainV1(target, 'relocation source').target;
    const implementation = readFileSync(path.join(import.meta.dir, '../../platform/shared/physical-no-follow.ts'), 'utf8');
    if (process.platform === 'win32') {
      expect(implementation).toContain('NtSetInformationFile');
      expect(implementation).toContain('writeBigUInt64LE(targetParentHandle, 8)');
      expect(implementation).toContain('ensureLeafName(destinationLeafName)');
    }
    const moved = relocateRetainedNoFollowDirectoryV1({ directory: original, tombstoneName: 'target-tombstone' });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(path.join(moved.path, 'keep.txt'), 'utf8')).toBe('bound-to-target\n');
    mkdirSync(target);
    expectPhysicalCode(
      () => assertSameNoFollowDirectoryIdentityV1(original, 'rebuilt original path'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(existsSync(target)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux relocation uses retained-parent renameat2 no-replace capability (actual on Linux, static contract elsewhere)', () => {
  const source = readFileSync(path.join(import.meta.dir, '../../platform/shared/physical-no-follow.ts'), 'utf8');
  expect(source).toContain('renameat2:');
  expect(source).toContain('symbols.renameat2(');
  expect(source).toContain('LINUX_RENAME_NOREPLACE');
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'renameat-target');
    mkdirSync(target);
    const original = inspectNoFollowDirectoryChainV1(target, 'Linux renameat source').target;
    const moved = relocateRetainedNoFollowDirectoryV1({ directory: original, tombstoneName: 'renameat-tombstone' });
    expect(moved.inode).toBe(original.inode);
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux retained-parent publication creates a writable exclusive candidate', async () => {
  const source = await Bun.file(new URL('../../platform/shared/physical-no-follow.ts', import.meta.url)).text();
  const candidateStart = source.indexOf('function linuxCreateCandidateAt(');
  const candidateEnd = source.indexOf('\nexport function publishExclusiveDurableCanonicalFileV1', candidateStart + 1);
  expect(candidateStart).toBeGreaterThanOrEqual(0);
  expect(candidateEnd).toBeGreaterThan(candidateStart);
  const candidate = source.slice(candidateStart, candidateEnd);
  expect(candidate).toContain('LINUX_O_WRONLY | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC | LINUX_O_CREAT | LINUX_O_EXCL');
  expect(candidate).not.toContain('LINUX_O_RDONLY | LINUX_O_NOFOLLOW | LINUX_O_CLOEXEC | LINUX_O_CREAT');
  expect(candidate).toContain('writeFileSync(fd, expected)');
  const publicationStart = source.indexOf("if (process.platform === 'linux') {", candidateEnd);
  const publicationEnd = source.indexOf("if (process.platform !== 'win32')", publicationStart);
  const publication = source.slice(publicationStart, publicationEnd);
  expect(publication).toContain('Exclusive durable publication candidate cleanup failed');
  expect(publication).toContain('Exclusive durable publication candidate cleanup fsync failed');
  expect(publication).toContain('renameat2(');
  expect(publication).toContain('LINUX_RENAME_NOREPLACE');
  expect(publication).not.toContain('symbols.linkat(');
});

test('tree scan records a child link as an unsafe leaf and never traverses it', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const external = path.join(root, 'external');
    mkdirSync(target);
    mkdirSync(external);
    symlinkSync(external, path.join(target, 'child-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const entries = scanNoFollowDirectoryTreeV1(inspectNoFollowDirectoryChainV1(target, 'scan target').target);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ relativePath: 'child-link', kind: 'link' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exclusive durable canonical publication is idempotent and refuses a conflicting existing value', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'durable');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'durable parent').target;
    const bytes = Buffer.from('{"schema":"test-v1"}\n', 'utf8');
    const validate = (value: Uint8Array): void => {
      const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as { schema?: unknown };
      if (parsed.schema !== 'test-v1') throw new Error('invalid test canonical bytes');
    };
    const publish = () => publishExclusiveDurableCanonicalFileV1({ parent, name: 'authorization.json', bytes, validate });
    const first = publish();
    expect(first.created).toBe(true);
    expect(readFileSync(first.path)).toEqual(bytes);
    const second = publishExclusiveDurableCanonicalFileV1({ parent, name: 'authorization.json', bytes, validate });
    expect(second).toEqual({ ...first, created: false });
    expectPhysicalCode(
      () => publishExclusiveDurableCanonicalFileV1({
        parent,
        name: 'authorization.json',
        bytes: Buffer.from('{"schema":"different"}\n', 'utf8'),
        validate: () => undefined
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
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'replacement parent').target;
    const validate = (value: Uint8Array): void => {
      if (!JSON.parse(Buffer.from(value).toString('utf8')).schema) throw new Error('invalid replacement bytes');
    };
    const first = Buffer.from('{"schema":"one"}\n', 'utf8');
    const second = Buffer.from('{"schema":"two"}\n', 'utf8');
    replaceDurableCanonicalFileV1({ parent, name: 'latest.json', bytes: first, validate });
    const replaced = replaceDurableCanonicalFileV1({ parent, name: 'latest.json', bytes: second, validate });
    expect(readFileSync(replaced.path)).toEqual(second);
    if (process.platform === 'win32') {
      const implementation = readFileSync(path.join(import.meta.dir, '../../platform/shared/physical-no-follow.ts'), 'utf8');
      expect(implementation).toContain('NtCreateFile');
      expect(implementation).toContain('windowsRenameRetainedOrdinaryFile');
      expect(implementation).toContain('writeBigUInt64LE(targetParentHandle, 8)');
      expect(implementation).not.toContain('MoveFileExW');
    }
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
    writeFileSync(path.join(target, 'authorized-file.txt'), 'only-this-file\n', 'utf8');
    mkdirSync(path.join(target, 'authorized-directory'));
    symlinkSync(external, path.join(target, 'authorized-link'), 'junction');
    const identity = inspectNoFollowDirectoryChainV1(target, 'retained target').target;
    const entries = new Map(scanNoFollowDirectoryTreeV1(identity).map((entry) => [entry.relativePath, entry]));
    for (const name of ['authorized-file.txt', 'authorized-directory', 'authorized-link']) {
      const entry = entries.get(name)!;
      deleteRetainedNoFollowEntryV1({
        root: identity,
        relativePath: entry.relativePath,
        kind: entry.kind,
        device: entry.device,
        inode: entry.inode,
        ancestorDirectories: []
      });
      expect(existsSync(path.join(target, name))).toBe(false);
    }

    mkdirSync(path.join(target, 'replacement-parent'));
    writeFileSync(path.join(target, 'replacement-parent', 'retain.txt'), 'old\n', 'utf8');
    const original = inspectNoFollowDirectoryChainV1(path.join(target, 'replacement-parent'), 'original parent').target;
    const old = `${original.path}-old`;
    renameSync(original.path, old);
    mkdirSync(original.path);
    expectPhysicalCode(
      () => deleteRetainedNoFollowEntryV1({
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
    const identity = inspectNoFollowDirectoryChainV1(target, 'retained target').target;
    const entries = new Map(scanNoFollowDirectoryTreeV1(identity).map((entry) => [entry.relativePath, entry]));
    for (const name of ['authorized-file.txt', 'authorized-directory', 'authorized-link']) {
      const entry = entries.get(name)!;
      deleteRetainedNoFollowEntryV1({
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
    const targetIdentity = inspectNoFollowDirectoryChainV1(target, 'ancestor target').target;
    const inventory = new Map(scanNoFollowDirectoryTreeV1(targetIdentity).map((entry) => [entry.relativePath, entry]));
    const authorizedParent = inventory.get('parent')!;
    const authorizedLeaf = inventory.get('parent/leaf.txt')!;
    const retainedParent = `${parent}-retained`;
    renameSync(parent, retainedParent);
    mkdirSync(parent);
    linkSync(path.join(retainedParent, 'leaf.txt'), path.join(parent, 'leaf.txt'));
    expectPhysicalCode(() => deleteRetainedNoFollowEntryV1({
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
    const identity = inspectNoFollowDirectoryChainV1(target, 'hard-link target').target;
    const selected = scanNoFollowDirectoryTreeV1(identity).find((entry) => entry.relativePath === 'selected.txt')!;
    deleteRetainedNoFollowEntryV1({
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
