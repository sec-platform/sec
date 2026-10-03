import { expect, test } from 'bun:test';
import { chmodSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, statSync, writeSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { release, tmpdir } from 'node:os';
import path from 'node:path';

import { settleResourcesAsync, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { observeCompilerDependencyExecutionGenerationAuthority, observeCompilerDependencyMaterializationInput } from '../../../toolchain/dependencies/runtime.ts';
import { compilerRoot } from '../../../workspace-context.ts';
import {
  armStandaloneLinuxImmutableRepositoryInput,
  disposeLinuxImmutableRepositoryInput,
  linuxImmutableRepositoryInputPrerequisites,
  parseLinuxImmutableInputMounts,
  prepareLinuxImmutableRepositoryInput,
  settleLinuxImmutableRepositoryInput,
  type LinuxImmutableRepositoryInput
} from './linux-immutable-repository-input.ts';
import { linuxRetainedFilesystemObservation } from './physical-no-follow-native.ts';

// Deliberately no platform skip or caller switch: this frozen branch is a
// one-time physical qualification. An absent real capability is a failure.
const root = '/sec-qualification';
const input = `${root}/input`;
const base = '145f63743fcf7f4ec181d16ff89f18777187a754';
// One absolute deadline for every case; neither settlement nor reuse renews it.
const deadlineAtUnixMs = Date.now() + 120_000;

function git(...args: string[]): string {
  const result = Bun.spawnSync(['/usr/bin/git', ...args], {
    cwd: input, stdout: 'pipe', stderr: 'pipe', timeout: 10_000
  });
  expect(result.exitCode).toBe(0);
  return new TextDecoder().decode(result.stdout).trim();
}

function threadFacts() {
  const ids = readdirSync('/proc/self/task').sort();
  expect(ids.length).toBeGreaterThan(0);
  const facts = ids.map(id => {
    const status = readFileSync(`/proc/self/task/${id}/status`, 'utf8');
    for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
      expect(status).toMatch(new RegExp(`^${field}:\\s+0+$`, 'mu'));
    }
    expect(status).toMatch(/^NoNewPrivs:\s+1$/mu);
    expect(status).toMatch(/^Uid:\s+65532\s+65532\s+65532\s+65532$/mu);
    expect(status).toMatch(/^Gid:\s+65532\s+65532\s+65532\s+65532$/mu);
    expect(status).toMatch(/^Groups:[ \t]*$/mu);
    const count = /^Seccomp_filters:\s+([0-9]+)$/mu.exec(status)?.[1];
    expect(count).toBeDefined();
    return { id, filters: Number(count),
      seccomp: Number(/^Seccomp:\s+([0-9]+)$/mu.exec(status)?.[1]),
      mountNamespace: readlinkSync(`/proc/self/task/${id}/ns/mnt`),
      userNamespace: readlinkSync(`/proc/self/task/${id}/ns/user`) };
  });
  expect(readdirSync('/proc/self/task').sort()).toEqual(ids);
  return facts;
}

async function withInput(body: (capability: LinuxImmutableRepositoryInput) => void | Promise<void>): Promise<void> {
  const capability = prepareLinuxImmutableRepositoryInput([input, `${input}/.git`]);
  let primary: ResourceSettlementFailure | undefined;
  let armed = false;
  try {
    armStandaloneLinuxImmutableRepositoryInput(capability, deadlineAtUnixMs);
    armed = true;
    await body(capability);
  } catch (error) { primary = { label: 'physical-qualification-body', error }; }
  await settleResourcesAsync({ primary, cleanup: [
    { label: 'immutable-input-settlement', settle: () => {
      if (armed) expect(settleLinuxImmutableRepositoryInput(capability).status).toBe('immutable-input');
    } },
    { label: 'immutable-input-disposal', settle: () => disposeLinuxImmutableRepositoryInput(capability) }
  ] });
}

function expectReadOnly(operation: () => void): void {
  let observed: unknown;
  let threw = false;
  try { operation(); } catch (error) { threw = true; observed = error; }
  expect(threw).toBe(true);
  expect((observed as NodeJS.ErrnoException | undefined)?.code).toBe('EROFS');
}

function attemptWrite(file: string): void {
  const fd = openSync(file, constants.O_WRONLY);
  try { writeSync(fd, 'qualification must not modify input'); }
  finally { closeSync(fd); }
}

test('physical identity binds B145 source, dependencies, Bun and kernel prerequisites', async () => {
  expect(process.platform).toBe('linux');
  expect(process.arch).toBe('x64');
  expect(Bun.version).toBe('1.4.0');
  expect(compilerRoot).toBe(input);
  expect(linuxImmutableRepositoryInputPrerequisites()).toBe(true);
  const identity = JSON.parse(readFileSync(`${root}/source-identity.json`, 'utf8')) as {
    base: string; baseTree: string; head: string; tree: string;
    baseBlobs: Record<string, string>; qualificationBlobs: Record<string, string>;
  };
  expect(identity.base).toBe(base);
  expect(identity.baseTree).toBe('588c94ea67c1c67f2ac30aa93b8cc3c630a4c13f');
  expect(git('rev-parse', 'HEAD')).toBe(identity.head);
  expect(git('rev-parse', 'HEAD^')).toBe(base);
  expect(git('rev-parse', 'HEAD^{tree}')).toBe(identity.tree);
  expect(Object.keys(identity.baseBlobs)).toHaveLength(23);
  expect(Object.keys(identity.qualificationBlobs)).toHaveLength(3);
  for (const [file, blob] of Object.entries({ ...identity.baseBlobs, ...identity.qualificationBlobs })) {
    expect(git('hash-object', file)).toBe(blob);
  }
  expect(git('diff', '--name-only', base, 'HEAD').split('\n').sort())
    .toEqual(Object.keys(identity.qualificationBlobs).sort());
  expect(git('status', '--porcelain', '--untracked-files=all')).toBe('');
  const dependencyInput = await observeCompilerDependencyMaterializationInput(input);
  const dependencies = await observeCompilerDependencyExecutionGenerationAuthority({ deadlineAtUnixMs }, input);
  expect(dependencies).not.toBeNull();
  expect(dependencyInput.toolchain.bunVersion).toBe(Bun.version);
  expect(dependencyInput.toolchain.architecture).toBe(process.arch);
  expect(dependencyInput.toolchain.declaredBunVersion).toBe('1.4.0');
  const fd = openSync(input, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let filesystem: ReturnType<typeof linuxRetainedFilesystemObservation>;
  try { filesystem = linuxRetainedFilesystemObservation(fd); }
  finally { closeSync(fd); }
  expect(filesystem.type).toBe(0x01021994n);
  expect(filesystem.flags & 1n).toBe(1n);
  const mounts = parseLinuxImmutableInputMounts(readFileSync('/proc/self/mountinfo', 'utf8'));
  const source = mounts.find(mount => mount.target === input)!;
  expect(source.filesystem).toBe('tmpfs');
  expect(source.options).toContain('ro');
  expect(source.superOptions).toContain('ro');
  expect(source.optional).toHaveLength(0);
  for (const ancestor of ['/', root]) {
    const metadata = lstatSync(ancestor);
    expect(metadata.uid).toBe(0);
    expect(metadata.mode & 0o022).toBe(0);
  }
  expect(statSync(input).uid).toBe(65532);
  console.log('QUALIFICATION kernel and identity', JSON.stringify({
    kernel: release(), arch: process.arch, bun: Bun.version, source: identity,
    dependencyInput, dependencyGeneration: dependencies?.generationDigest,
    dependencyRoot: realpathSync(`${input}/node_modules`),
    filesystem: { type: String(filesystem.type), flags: String(filesystem.flags), id: filesystem.filesystemId },
    mounts: mounts.filter(mount => mount.target.startsWith(root) || mount.target === '/tmp'),
    threads: threadFacts(), networkNamespace: readlinkSync('/proc/self/ns/net'),
    routes: readFileSync('/proc/net/route', 'utf8')
  }));
});

test('physical prepare and arm synchronizes seccomp across the exact thread census', async () => {
  const capability = prepareLinuxImmutableRepositoryInput([input, `${input}/.git`]);
  let primary: ResourceSettlementFailure | undefined;
  let armed = false;
  try {
    const before = threadFacts();
    armStandaloneLinuxImmutableRepositoryInput(capability, deadlineAtUnixMs);
    armed = true;
    const after = threadFacts();
    expect(after.map(item => item.id)).toEqual(before.map(item => item.id));
    for (let index = 0; index < before.length; index++) {
      expect(after[index]!.filters).toBe(before[index]!.filters + 1);
      expect(after[index]!.seccomp).toBe(2);
      expect(after[index]!.mountNamespace).toBe(before[index]!.mountNamespace);
      expect(after[index]!.userNamespace).toBe(before[index]!.userNamespace);
    }
    console.log('QUALIFICATION actual TSYNC filter delta', JSON.stringify({ before, after }));
  } catch (error) { primary = { label: 'actual-seccomp-tsync', error }; }
  await settleResourcesAsync({ primary, cleanup: [
    { label: 'tsync-input-settlement', settle: () => {
      if (armed) expect(settleLinuxImmutableRepositoryInput(capability).status).toBe('immutable-input');
    } },
    { label: 'tsync-input-disposal', settle: () => disposeLinuxImmutableRepositoryInput(capability) }
  ] });
});

test('physical immutable input rejects write chmod rename and alias write with EROFS', async () => {
  await withInput(() => {
    const file = `${input}/package.json`;
    const before = readFileSync(file);
    const metadata = lstatSync(file, { bigint: true });
    expectReadOnly(() => attemptWrite(file));
    expectReadOnly(() => chmodSync(file, 0o600));
    expectReadOnly(() => renameSync(file, `${input}/package.qualification-renamed.json`));
    expectReadOnly(() => attemptWrite(`${root}/input-alias/package.json`));
    expect(readFileSync(file)).toEqual(before);
    expect(lstatSync(file, { bigint: true })).toEqual(metadata);
    expect(existsSync(`${input}/package.qualification-renamed.json`)).toBe(false);
    console.log('QUALIFICATION EROFS: write chmod rename and same-superblock alias write');
  });
});

test('physical disjoint fixture supports write read and complete cleanup', async () => {
  await withInput(async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), 'immutable-qualification-'));
    let primary: ResourceSettlementFailure | undefined;
    try {
      expect(realpathSync(fixture).startsWith(`${input}/`)).toBe(false);
      expect(statSync(fixture).dev).not.toBe(statSync(input).dev);
      const file = path.join(fixture, 'ordinary.txt');
      await writeFile(file, 'ordinary independent fixture\n');
      expect(await readFile(file, 'utf8')).toBe('ordinary independent fixture\n');
      await writeFile(file, 'ordinary second write\n');
      expect(await readFile(file, 'utf8')).toBe('ordinary second write\n');
    } catch (error) { primary = { label: 'ordinary-fixture-operation', error }; }
    await settleResourcesAsync({ primary, cleanup: [
      { label: 'ordinary-fixture-cleanup', settle: () => rm(fixture, { recursive: true }) }
    ] });
    expect(existsSync(fixture)).toBe(false);
    console.log('QUALIFICATION disjoint write/read/cleanup settled');
  });
});

test('physical readonly bind over a writable superblock is rejected', async () => {
  await withInput(() => {
    const mounts = parseLinuxImmutableInputMounts(readFileSync('/proc/self/mountinfo', 'utf8'));
    const bind = mounts.find(mount => mount.target === `${root}/readonly-bind`)!;
    const writable = mounts.find(mount => mount.target === `${root}/writable-superblock`)!;
    expect(bind.options).toContain('ro');
    expect(bind.superOptions).toContain('rw');
    expect(bind.device).toBe(writable.device);
    const file = `${root}/writable-superblock/fixture.txt`;
    const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND);
    try { writeSync(fd, 'actual writable superblock\n'); } finally { closeSync(fd); }
    expect(readFileSync(`${root}/readonly-bind/fixture.txt`, 'utf8')).toContain('actual writable superblock');
    expectReadOnly(() => attemptWrite(`${root}/readonly-bind/fixture.txt`));
    expect(() => prepareLinuxImmutableRepositoryInput([`${root}/readonly-bind`])).toThrow('superblock');
    console.log('QUALIFICATION actual RO-bind/RW-superblock rejected', JSON.stringify({ bind, writable }));
  });
});

test('physical capabilities reject forgery reuse and post-disposal use', async () => {
  const capability = prepareLinuxImmutableRepositoryInput([input]);
  let primary: ResourceSettlementFailure | undefined;
  try {
    const forged = { ...capability } as LinuxImmutableRepositoryInput;
    expect(() => armStandaloneLinuxImmutableRepositoryInput(forged, deadlineAtUnixMs)).toThrow('owner-issued');
    expect(() => settleLinuxImmutableRepositoryInput(forged)).toThrow('owner-issued');
    expect(() => disposeLinuxImmutableRepositoryInput(forged)).toThrow('owner-issued');
    expect(settleLinuxImmutableRepositoryInput(capability).status).toBe('discontinuous');
    armStandaloneLinuxImmutableRepositoryInput(capability, deadlineAtUnixMs);
    expect(() => armStandaloneLinuxImmutableRepositoryInput(capability, deadlineAtUnixMs)).toThrow('already consumed');
    expect(settleLinuxImmutableRepositoryInput(capability).status).toBe('immutable-input');
    expect(settleLinuxImmutableRepositoryInput(capability).status).toBe('discontinuous');
    disposeLinuxImmutableRepositoryInput(capability);
    disposeLinuxImmutableRepositoryInput(capability); // The production contract is idempotent disposal.
    expect(() => settleLinuxImmutableRepositoryInput(capability)).toThrow('live owner-issued');
    expect(() => armStandaloneLinuxImmutableRepositoryInput(capability, deadlineAtUnixMs)).toThrow('live owner-issued');
  } catch (error) { primary = { label: 'physical-capability-lifecycle', error }; }
  await settleResourcesAsync({ primary, cleanup: [
    { label: 'lifecycle-input-disposal', settle: () => disposeLinuxImmutableRepositoryInput(capability) }
  ] });
  console.log('QUALIFICATION capability forgery/reuse/disposal rejection settled');
});
