import { expect, test } from 'bun:test';
import { closeSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { appendExistingNoFollowOrdinaryFile, inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess } from './physical-no-follow.ts';
import { linuxOpenAppendLeafAt } from './physical-no-follow-native.ts';
import { writeSync } from 'node:fs';

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-physical-append-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const append = (root: string, name = 'output', maximumFileBytes = 1024) => appendExistingNoFollowOrdinaryFile({
  parent: inspectNoFollowDirectoryChain(root), name, bytes: Buffer.from('value=ok\n'), maximumFileBytes
});

test.skipIf(process.platform !== 'linux')('retained append preserves existing bytes and rejects a bounded overflow before writing', () => fixture(root => {
  writeFileSync(path.join(root, 'output'), 'before\n');
  append(root);
  expect(readFileSync(path.join(root, 'output'), 'utf8')).toBe('before\nvalue=ok\n');
  expect(() => append(root, 'output', 16)).toThrow();
  expect(readFileSync(path.join(root, 'output'), 'utf8')).toBe('before\nvalue=ok\n');
  expect(() => append(root, '../outside')).toThrow();
}));

test.skipIf(process.platform !== 'linux')('retained append never writes through a symlink, hardlink, directory or FIFO', () => fixture(root => {
  const victim = path.join(root, 'victim'); writeFileSync(victim, 'original');
  symlinkSync(victim, path.join(root, 'link')); linkSync(victim, path.join(root, 'hardlink'));
  mkdirSync(path.join(root, 'directory'));
  const fifo = path.join(root, 'fifo');
  const made = Bun.spawnSync(['mkfifo', fifo], { stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
  expect(made.exitCode).toBe(0);
  for (const name of ['link', 'hardlink', 'directory', 'fifo']) expect(() => append(root, name)).toThrow();
  expect(readFileSync(victim, 'utf8')).toBe('original');
}));

test.skipIf(process.platform !== 'linux')('append rejects a parent replacement against its captured chain', () => fixture(root => {
  const parent = path.join(root, 'parent'); mkdirSync(parent); writeFileSync(path.join(parent, 'output'), 'owned');
  const observed = inspectNoFollowDirectoryChain(parent);
  renameSync(parent, path.join(root, 'original')); mkdirSync(parent); writeFileSync(path.join(parent, 'output'), 'replacement');
  expect(() => appendExistingNoFollowOrdinaryFile({ parent: observed, name: 'output', bytes: Buffer.from('bad'), maximumFileBytes: 1024 })).toThrow();
  expect(readFileSync(path.join(parent, 'output'), 'utf8')).toBe('replacement');
  expect(readFileSync(path.join(root, 'original/output'), 'utf8')).toBe('owned');
}));

test.skipIf(process.platform !== 'linux')('native append is relative to the retained parent even after its pathname is replaced', () => fixture(root => {
  const parent = path.join(root, 'parent'); mkdirSync(parent); writeFileSync(path.join(parent, 'output'), 'owned');
  const retained = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(parent), 3);
  try {
    renameSync(parent, path.join(root, 'original')); mkdirSync(parent); writeFileSync(path.join(parent, 'output'), 'replacement');
    const fd = linuxOpenAppendLeafAt(retained.stdioSourceDescriptor!, 'output', 'append fixture');
    try { writeSync(fd, Buffer.from('+append')); } finally { closeSync(fd); }
    expect(readFileSync(path.join(root, 'original/output'), 'utf8')).toBe('owned+append');
    expect(readFileSync(path.join(parent, 'output'), 'utf8')).toBe('replacement');
  } finally { retained.dispose(); }
}));
