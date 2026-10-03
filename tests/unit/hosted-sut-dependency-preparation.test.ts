import { expect, test } from 'bun:test';

import type { NoFollowDirectoryTreeInventoryEntry } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertHostedSutExtractedArchiveProjection,
  captureHostedSutDependencyPreparationBinding,
  runHostedSutDependencyPreparationFromTrustedLauncher,
  validateHostedSutArchiveInventory,
  type HostedActionArchiveInventoryEntry
} from '../../src/adapters/verification/platform/ci/hosted-sut-dependency-preparation.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const contentDigest = (text: string) => sha256({ bytes: Buffer.from(text).toString('hex') });
const directory = (name: string): HostedActionArchiveInventoryEntry => ({
  path: name, type: 'directory', size: 0, mode: 0o755,
  linkTarget: null, physicalContentDigest: null, contentDigest: null
});
const file = (name: string, text: string): HostedActionArchiveInventoryEntry => ({
  path: name, type: 'file', size: Buffer.byteLength(text), mode: 0o644,
  linkTarget: null, physicalContentDigest: contentDigest(text), contentDigest: null
});
const entries = [directory('node_modules'), directory('node_modules/example'),
  file('node_modules/example/package.json', '{"name":"example","version":"1.0.0"}'),
  file('node_modules/example/index.js', 'export const result = 1;')];
const observation = (entry: HostedActionArchiveInventoryEntry): NoFollowDirectoryTreeInventoryEntry => ({
  relativePath: entry.path, kind: entry.type === 'directory' ? 'directory' : entry.type === 'symlink' ? 'link' : 'file',
  device: '1', inode: String(entries.indexOf(entry) + 10), size: entry.size,
  contentDigest: entry.physicalContentDigest, linkTarget: entry.linkTarget,
  permissionMode: entry.mode
});
const binding = {
  schema: 'sec-hosted-sut-dependency-preparation-v1',
  baseSha: 'a'.repeat(40), baseTreeSha: 'b'.repeat(40), headSha: 'c'.repeat(40), headTreeSha: 'd'.repeat(40),
  archiveDigest: sha256('archive'), inventoryDigest: sha256('inventory'), entryCount: 4, totalFileBytes: 123,
  dependencyClosureDigest: sha256('deps'), gitBundleDigest: sha256('git'), deadlineAtUnixMs: 1000
};

test('the original inventory remains the single bounded path and link validator', () => {
  const validated = validateHostedSutArchiveInventory(entries, 1024);
  expect(validated.entries).toHaveLength(4);
  expect(() => validateHostedSutArchiveInventory(entries, 1)).toThrow('byte');
  expect(() => validateHostedSutArchiveInventory([...entries, entries[0]], 1024)).toThrow('duplicate');
  expect(() => validateHostedSutArchiveInventory([file('../escape', 'x')], 1024)).toThrow('canonical');
  expect(() => validateHostedSutArchiveInventory([{ ...entries[3], mode: 0o4755 }], 1024)).toThrow('set-id');
});

test('same package name and version cannot authenticate substituted executable bytes', () => {
  const observed = entries.map(observation);
  expect(() => assertHostedSutExtractedArchiveProjection(entries, observed)).not.toThrow();
  expect(() => assertHostedSutExtractedArchiveProjection(entries, observed.map(entry =>
    entry.relativePath.endsWith('/index.js') ? { ...entry, contentDigest: contentDigest('export const result = 2;') } : entry
  ))).toThrow('file differs');
});

test('complete archive comparison rejects omissions additions size and executable-mode drift', () => {
  const observed = entries.map(observation);
  expect(() => assertHostedSutExtractedArchiveProjection(entries, observed.slice(1))).toThrow('membership');
  expect(() => assertHostedSutExtractedArchiveProjection(entries, [...observed, observation(file('extra', 'x'))])).toThrow('membership');
  for (const change of [{ size: 1 }, { permissionMode: 0o755 }]) {
    expect(() => assertHostedSutExtractedArchiveProjection(entries, observed.map(entry =>
      entry.relativePath.endsWith('/index.js') ? { ...entry, ...change } : entry
    ))).toThrow('file differs');
  }
});

test('relocation rejects dependency links escaping node_modules even within the archive', () => {
  const source = [...entries, file('outside', 'x'), {
    path: 'node_modules/escape', type: 'symlink' as const, linkTarget: 'outside',
    mode: 0o777, size: 0, physicalContentDigest: null, contentDigest: null
  }];
  expect(() => assertHostedSutExtractedArchiveProjection(source, source.map(observation))).toThrow('escapes');
});

test('binding parsing freezes only bounded correlation and rejects extra authority fields', () => {
  const captured = captureHostedSutDependencyPreparationBinding(JSON.stringify(binding));
  expect(Object.isFrozen(captured)).toBe(true);
  expect(captured.archiveDigest).toBe(binding.archiveDigest);
  expect(() => captureHostedSutDependencyPreparationBinding(JSON.stringify({ ...binding, proofText: '{}' }))).toThrow('exactly');
  expect(() => captureHostedSutDependencyPreparationBinding(JSON.stringify({ ...binding, entryCount: 250001 }))).toThrow('invalid');
  expect(() => captureHostedSutDependencyPreparationBinding(JSON.stringify({ ...binding, archiveDigest: 'chosen' }))).toThrow('invalid');
});

test('a self-consistent caller DTO cannot invoke the fixed trusted launcher entry', async () => {
  await expect(runHostedSutDependencyPreparationFromTrustedLauncher(JSON.stringify({
    ...binding, deadlineAtUnixMs: Date.now() + 60_000
  }))).rejects.toThrow('fixed trusted pre-candidate launcher');
});


test('extraction retains hardlink object identity while the original copier may materialize independent bytes', () => {
  const target = file('target', 'x');
  const linked: HostedActionArchiveInventoryEntry = { ...target, path: 'linked', type: 'hardlink', linkTarget: 'target', size: 0 };
  const source = [target, linked];
  const observed = [{ ...observation(target), inode: '40' }, { ...observation(linked), inode: '40', size: 1, linkTarget: null }];
  expect(() => assertHostedSutExtractedArchiveProjection(source, observed)).not.toThrow();
  const copied = [observed[0]!, { ...observed[1]!, inode: '41' }];
  expect(() => assertHostedSutExtractedArchiveProjection(source, copied)).toThrow('hardlink object');
  expect(() => assertHostedSutExtractedArchiveProjection(source, copied, 'copied-bytes')).not.toThrow();
});
