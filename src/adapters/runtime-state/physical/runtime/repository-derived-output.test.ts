import { expect, test } from 'bun:test';
import { access, link, mkdir, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectNoFollowDirectoryChain } from './physical-no-follow.ts';
import { armRepositoryChangeObserver, repositoryInputZeroWritesProven, settleRepositoryChangeObserver } from './repository-change-observer.ts';
import {
  createRepositoryDerivedOutput,
  retireRepositoryDerivedOutput,
  type RepositoryDerivedOutput
} from './repository-derived-output.ts';
import { armWindowsRepositoryChangeObserver, settleWindowsRepositoryChangeObserver } from './windows-repository-change-observer.ts';

async function fixture(run: (root: string, outputParent: string, git: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-derived-output-'));
  try {
    const outputParent = path.join(root, 'outputs');
    const git = path.join(root, '.git');
    await mkdir(outputParent);
    await mkdir(git);
    await run(root, outputParent, git);
  } finally {
    expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root).startsWith('sec-derived-output-')).toBe(true);
    await rm(root, { recursive: true, force: true });
  }
}

function arm(root: string, derivedOutput: RepositoryDerivedOutput, git?: string) {
  return armRepositoryChangeObserver({ roots: git === undefined ? [root] : [root, git],
    deadlineAtUnixMs: Date.now() + 20_000, derivedOutput });
}

test.skipIf(process.platform !== 'win32')('derived output ignores only its owned descendants and can retire after one observation', async () => {
  await fixture(async (root, outputParent, git) => {
    const output = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    const resolution = await arm(root, output, git);
    expect(resolution.status).toBe('ready');
    if (resolution.status !== 'ready') throw new Error('Observer did not arm');
    expect(() => retireRepositoryDerivedOutput(output)).toThrow('pending');
    expect(await arm(root, output, git)).toEqual({ status: 'unavailable', reason: 'invalid-input' });
    await mkdir(path.join(output.path, 'nested'));
    for (let index = 0; index < 250; index += 1) {
      await writeFile(path.join(output.path, 'nested', `output-${index}.txt`), 'derived');
    }
    const settlement = await settleRepositoryChangeObserver(resolution.observer);
    expect(settlement.status, JSON.stringify(settlement)).toBe('zero-events');
    expect(settlement.rootIdentityDigest).toBe(resolution.observer.rootIdentityDigest);
    expect(await arm(root, output, git)).toEqual({ status: 'unavailable', reason: 'invalid-input' });
    expect(retireRepositoryDerivedOutput(output).status).toBe('physically-absent');
    await expect(access(output.path)).rejects.toThrow();
    expect(() => retireRepositoryDerivedOutput(output)).toThrow('owner-issued');
  });
});

test.skipIf(process.platform !== 'win32')('derived output does not hide sibling source or Git writes', async () => {
  await fixture(async (root, outputParent, git) => {
    const output = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    const sibling = `${output.path}-sibling`;
    await mkdir(sibling);
    const resolution = await arm(root, output, git);
    if (resolution.status !== 'ready') throw new Error('Observer did not arm');
    await writeFile(path.join(output.path, 'derived.txt'), 'allowed');
    await writeFile(path.join(sibling, 'source.txt'), 'observed');
    await writeFile(path.join(root, 'source.ts'), 'export {};');
    await writeFile(path.join(git, 'index'), 'observed');
    const settlement = await settleRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') throw new Error('Input writes were not observed');
    expect(settlement.events.some(event => event.path.includes(`${path.basename(sibling)}/source.txt`))).toBe(true);
    expect(settlement.events.some(event => event.path === 'source.ts')).toBe(true);
    expect(settlement.events.some(event => event.path === 'index' || event.path === '.git/index')).toBe(true);
    expect(settlement.events.some(event => event.path.endsWith('/derived.txt'))).toBe(false);
    retireRepositoryDerivedOutput(output);
  });
});

test.skipIf(process.platform !== 'win32')('forged nonempty overlapping and never-armed scopes cannot grant an exclusion', async () => {
  await fixture(async (root, outputParent, git) => {
    const forged = { path: outputParent, root: inspectNoFollowDirectoryChain(outputParent).target } as RepositoryDerivedOutput;
    expect(await arm(root, forged)).toEqual({ status: 'unavailable', reason: 'invalid-input' });
    expect(() => retireRepositoryDerivedOutput(forged)).toThrow('owner-issued');
    const nonempty = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    await writeFile(path.join(nonempty.path, 'preexisting.txt'), 'not fresh');
    expect(await arm(root, nonempty)).toEqual({ status: 'unavailable', reason: 'invalid-input' });
    expect(retireRepositoryDerivedOutput(nonempty).status).toBe('physically-absent');
    const overlap = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(git));
    expect(await arm(root, overlap, git)).toEqual({ status: 'unavailable', reason: 'invalid-input' });
    retireRepositoryDerivedOutput(overlap);
    const fresh = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    expect(await armRepositoryChangeObserver({ roots: [root], deadlineAtUnixMs: Date.now() - 1, derivedOutput: fresh }))
      .toEqual({ status: 'unavailable', reason: 'invalid-input' });
    const resolution = await arm(root, fresh);
    if (resolution.status !== 'ready') throw new Error('Never-armed scope was consumed');
    expect((await settleRepositoryChangeObserver(resolution.observer)).status).toBe('zero-events');
    retireRepositoryDerivedOutput(fresh);
  });
});

test.skipIf(process.platform !== 'win32')('derived output root ABA remains observable even when final identity is restored', async () => {
  await fixture(async (root, outputParent) => {
    const output = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    const resolution = await arm(root, output);
    if (resolution.status !== 'ready') throw new Error('Observer did not arm');
    const aside = `${output.path}-aside`;
    await rename(output.path, aside);
    await rename(aside, output.path);
    const settlement = await settleRepositoryChangeObserver(resolution.observer);
    expect(settlement.status).toBe('events');
    if (settlement.status !== 'events') throw new Error('Output root ABA was hidden');
    expect(settlement.events.some(event => event.path === `outputs/${path.basename(output.path)}`)).toBe(true);
    retireRepositoryDerivedOutput(output);
  });
});

test.skipIf(process.platform !== 'win32')('replacing the derived output root changes identity and cannot retire the replacement', async () => {
  await fixture(async (root, outputParent) => {
    const output = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    const resolution = await arm(root, output);
    if (resolution.status !== 'ready') throw new Error('Observer did not arm');
    const original = `${output.path}-original`;
    await rename(output.path, original);
    await mkdir(output.path);
    await writeFile(path.join(output.path, 'replacement.txt'), 'foreign');
    expect((await settleRepositoryChangeObserver(resolution.observer)).status).toBe('identity-changed');
    expect(() => retireRepositoryDerivedOutput(output)).toThrow();
    await access(path.join(output.path, 'replacement.txt'));
    await access(original);
  });
});

test.skipIf(process.platform !== 'win32')('derived output namespace silence cannot prove source immutability through a hardlink alias', async () => {
  await fixture(async (root, outputParent) => {
    const source = path.join(root, 'source.txt');
    await writeFile(source, 'original');
    const output = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    const resolution = await arm(root, output);
    if (resolution.status !== 'ready') throw new Error('Observer did not arm');
    const alias = path.join(output.path, 'source-alias.txt');
    await link(source, alias);
    await writeFile(alias, 'changed');
    await writeFile(alias, 'original');
    await unlink(alias);
    const settlement = await settleRepositoryChangeObserver(resolution.observer);
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(settlement.status, JSON.stringify(settlement)).toBe('zero-events');
    expect(repositoryInputZeroWritesProven(settlement)).toBe(false);
    retireRepositoryDerivedOutput(output);
  });
});

test.skipIf(process.platform !== 'win32')('source junction alias writes and byte restoration inside derived output remain observable', async () => {
  await fixture(async (root, outputParent) => {
    const sourceDirectory = path.join(root, 'source-directory');
    await mkdir(sourceDirectory);
    const source = path.join(sourceDirectory, 'source.txt');
    await writeFile(source, 'original');
    const output = createRepositoryDerivedOutput(inspectNoFollowDirectoryChain(outputParent));
    const resolution = await arm(root, output);
    if (resolution.status !== 'ready') throw new Error('Observer did not arm');
    const alias = path.join(output.path, 'source-alias');
    await symlink(sourceDirectory, alias, 'junction');
    await writeFile(path.join(alias, 'source.txt'), 'changed');
    await writeFile(path.join(alias, 'source.txt'), 'original');
    await rm(alias, { recursive: true, force: true });
    const settlement = await settleRepositoryChangeObserver(resolution.observer);
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(settlement.status, JSON.stringify(settlement)).not.toBe('zero-events');
    retireRepositoryDerivedOutput(output);
  });
});

test.skipIf(process.platform !== 'win32')('unscoped namespace silence cannot prove source immutability through an outside hardlink', async () => {
  await fixture(async (privateRoot) => {
    const watched = path.join(privateRoot, 'watched');
    const sibling = path.join(privateRoot, 'unwatched-sibling');
    await mkdir(watched);
    await mkdir(sibling);
    const source = path.join(watched, 'source.txt');
    await writeFile(source, 'original');
    const resolution = await armWindowsRepositoryChangeObserver({
      roots: [watched], deadlineAtUnixMs: Date.now() + 20_000
    });
    if (resolution.status !== 'ready') throw new Error('Unscoped observer did not arm');
    const alias = path.join(sibling, 'source-alias.txt');
    await link(source, alias);
    await writeFile(alias, 'changed');
    await writeFile(alias, 'original');
    await unlink(alias);
    const settlement = await settleWindowsRepositoryChangeObserver(resolution.observer);
    expect(await readFile(source, 'utf8')).toBe('original');
    expect(settlement.status, JSON.stringify(settlement)).toBe('zero-events');
    expect(repositoryInputZeroWritesProven(settlement)).toBe(false);
  });
});
