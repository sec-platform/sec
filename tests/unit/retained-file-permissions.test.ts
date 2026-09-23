import { expect, test } from 'bun:test';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSemanticMutationWindowsFileAttributes } from '../../src/adapters/mutation/windows-file-attributes.ts';
import { inspectNoFollowDirectoryChain, publishExclusiveDurableCanonicalFile, retainNoFollowOrdinaryFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { copyRetainedNoFollowFilePermissions } from '../../src/adapters/runtime-state/physical/runtime/retained-file-permissions.ts';

async function fixture(mode = 0o444) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-retained-permissions-'));
  const original = path.join(root, 'original');
  writeFileSync(original, 'original bytes\n');
  chmodSync(original, mode);
  const chain = inspectNoFollowDirectoryChain(root);
  const source = retainNoFollowOrdinaryFile(chain, 'original');
  const bytes = Buffer.from('authorized edited bytes\n');
  const target = publishExclusiveDurableCanonicalFile({
    parent: chain.target, name: 'replacement', bytes, permissionMode: 0o600,
    validate(actual) { expect(Buffer.from(actual)).toEqual(bytes); }
  });
  const attributes = await readSemanticMutationWindowsFileAttributes(original);
  const expectedWindowsAttributes = attributes === null ? null :
    (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
    (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);
  return {
    root, source, target, bytes, attributes,
    input: { source, target, parent: chain.target, expectedSourceMode: statSync(original).mode & 0o7777, expectedWindowsAttributes },
    close() { source.dispose(); rmSync(root, { recursive: true, force: true }); }
  };
}

test('retained permissions preserve a readonly source mode on different authorized replacement bytes', async () => {
  const f = await fixture();
  try {
    const original = statSync(f.source.path, { bigint: true });
    const replacement = statSync(f.target.path, { bigint: true });
    await copyRetainedNoFollowFilePermissions(f.input);
    expect(readFileSync(f.target.path)).toEqual(f.bytes);
    expect(readFileSync(f.source.path, 'utf8')).toBe('original bytes\n');
    expect(statSync(f.source.path, { bigint: true }).ino).toBe(original.ino);
    expect(statSync(f.target.path, { bigint: true }).ino).toBe(replacement.ino);
    if (process.platform === 'linux') expect(statSync(f.target.path).mode & 0o7777).toBe(0o444);
    else expect(await readSemanticMutationWindowsFileAttributes(f.target.path)).toEqual(f.attributes);
  } finally { f.close(); }
});

test('retained permissions reject a structural receipt clone rather than treating it as publication authority', async () => {
  const f = await fixture();
  try {
    await expect(copyRetainedNoFollowFilePermissions({ ...f.input, target: { ...f.target } }))
      .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE' });
  } finally { f.close(); }
});

test('retained permissions reject a byte-identical replacement leaf with a different identity', async () => {
  const f = await fixture();
  try {
    renameSync(f.target.path, path.join(f.root, 'displaced'));
    writeFileSync(f.target.path, f.bytes);
    await expect(copyRetainedNoFollowFilePermissions(f.input)).rejects.toBeDefined();
    expect(readFileSync(f.target.path)).toEqual(f.bytes);
  } finally { f.close(); }
});

test('retained permissions reject changed receipt bytes before changing permissions', async () => {
  const f = await fixture();
  try {
    writeFileSync(f.target.path, 'foreign bytes\n');
    const mode = statSync(f.target.path).mode;
    await expect(copyRetainedNoFollowFilePermissions(f.input)).rejects.toBeDefined();
    expect(statSync(f.target.path).mode).toBe(mode);
    expect(readFileSync(f.target.path, 'utf8')).toBe('foreign bytes\n');
  } finally { f.close(); }
});

test('retained permissions do not change metadata through a hard-linked replacement', async () => {
  const f = await fixture();
  try {
    const alias = path.join(f.root, 'alias');
    linkSync(f.target.path, alias);
    const mode = statSync(alias).mode;
    await expect(copyRetainedNoFollowFilePermissions(f.input)).rejects.toBeDefined();
    expect(statSync(alias).mode).toBe(mode);
  } finally { f.close(); }
});

test.skipIf(process.platform !== 'linux')('retained permissions reject a stale planned source mode', async () => {
  const f = await fixture();
  try {
    await expect(copyRetainedNoFollowFilePermissions({ ...f.input, expectedSourceMode: 0o600 }))
      .rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' });
    expect(statSync(f.target.path).mode & 0o7777).toBe(0o600);
  } finally { f.close(); }
});

test.skipIf(process.platform !== 'linux')('retained permissions reject a substituted parent without changing its foreign leaf', async () => {
  const f = await fixture();
  const displaced = `${f.root}.displaced`;
  try {
    renameSync(f.root, displaced);
    mkdirSync(f.root);
    writeFileSync(f.target.path, 'foreign parent\n');
    await expect(copyRetainedNoFollowFilePermissions(f.input)).rejects.toBeDefined();
    expect(readFileSync(f.target.path, 'utf8')).toBe('foreign parent\n');
  } finally {
    f.source.dispose();
    rmSync(f.root, { recursive: true, force: true });
    rmSync(displaced, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('same-owner special POSIX bits are copied exactly instead of being silently stripped', async () => {
  const f = await fixture(0o2640);
  try {
    await copyRetainedNoFollowFilePermissions(f.input);
    expect(statSync(f.target.path).mode & 0o7777).toBe(0o2640);
  } finally { f.close(); }
});
