import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';

import { LINUX_DOCKER_STATIC_TOOLCHAIN } from '../contract/linux-static-toolchain.ts';
import {
  decodeLinuxDockerStaticArchiveMember,
  LinuxDockerStaticPublicationError,
  publishLinuxDockerStaticToolchain,
  resolveLinuxDockerStaticAssetRedirect,
  selectLinuxDockerStaticTarMember
} from './linux-static-toolchain-publisher.ts';

function header(name: string, size = 0, type = '0'): Buffer {
  const result = Buffer.alloc(512);
  result.write(name, 0, 100, 'ascii');
  result.write('0000755\0', 100, 'ascii');
  result.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
  result.write(type, 156, 'ascii');
  result.write('ustar  \0', 257, 'ascii');
  checksum(result);
  return result;
}

function checksum(value: Buffer): void {
  value.fill(32, 148, 156);
  const sum = value.reduce((total, byte) => total + byte, 0);
  value.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
}

function archive(...headers: Buffer[]): Buffer {
  return Buffer.concat([...headers, Buffer.alloc(1024)]);
}

const future = (): number => Date.now() + 30_000;

test('static publisher rejects expired or cancelled input before network or physical publication', async () => {
  await expect(publishLinuxDockerStaticToolchain({ deadlineAtUnixMs: 0 })).rejects.toThrow();
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(publishLinuxDockerStaticToolchain({ deadlineAtUnixMs: future(), signal: cancelled.signal })).rejects.toThrow();
});

test('static archive rejects missing member and malformed framing', () => {
  expect(() => selectLinuxDockerStaticTarMember(Buffer.alloc(1024), future())).toThrow('lacks its unique');
  expect(() => selectLinuxDockerStaticTarMember(Buffer.alloc(1023), future())).toThrow('framing');
  expect(() => selectLinuxDockerStaticTarMember(Buffer.alloc(1024), 0)).toThrow('budget');
});

test('static archive rejects duplicate entries before selecting any CLI bytes', () => {
  const repeated = archive(header('docker/other'), header('docker/other'));
  expect(() => selectLinuxDockerStaticTarMember(repeated, future())).toThrow('repeats');
});

for (const name of ['../docker', '/docker/docker', 'docker/../docker', 'docker/.', 'docker/..', 'docker\\docker']) {
  test(`static archive rejects unsafe member ${name}`, () => {
    expect(() => selectLinuxDockerStaticTarMember(archive(header(name)), future())).toThrow('escapes');
  });
}

for (const type of ['1', '2', '3', '4', '6', 'x', 'g', 'L', 'K', 'S']) {
  test(`static archive rejects nonordinary or extended type ${type}`, () => {
    expect(() => selectLinuxDockerStaticTarMember(archive(header('docker/other', 0, type)), future())).toThrow('ordinary');
  });
}

test('static archive checks header checksum, exact numeric grammar, member bounds and link fields', () => {
  const corrupt = header('docker/other');
  corrupt[0] = 1;
  expect(() => selectLinuxDockerStaticTarMember(archive(corrupt), future())).toThrow('checksum');
  const invalidSize = header('docker/other');
  invalidSize.fill(255, 124, 136);
  checksum(invalidSize);
  expect(() => selectLinuxDockerStaticTarMember(archive(invalidSize), future())).toThrow('octal');
  expect(() => selectLinuxDockerStaticTarMember(archive(header('docker/other', 4096)), future())).toThrow('size');
  const link = header('docker/other');
  link.write('docker/docker', 157, 'ascii');
  checksum(link);
  expect(() => selectLinuxDockerStaticTarMember(archive(link), future())).toThrow('links');
});

test('static archive rejects member padding, incomplete EOF and trailing bytes', () => {
  const padding = Buffer.alloc(512);
  padding[1] = 1;
  expect(() => selectLinuxDockerStaticTarMember(archive(header('docker/other', 1), padding), future())).toThrow('padding');
  const incomplete = Buffer.concat([header('docker/other'), Buffer.alloc(512)]);
  expect(() => selectLinuxDockerStaticTarMember(incomplete, future())).toThrow('EOF');
  const trailing = archive(header('docker/other'));
  trailing[trailing.length - 1] = 1;
  expect(() => selectLinuxDockerStaticTarMember(trailing, future())).toThrow('trailing');
});

test('static archive enforces its entry bound and fixed CLI length', () => {
  const tooMany = archive(...Array.from({ length: 33 }, (_, index) => header(`docker/member-${index}`)));
  expect(() => selectLinuxDockerStaticTarMember(tooMany, future())).toThrow('unsupported');
  expect(() => selectLinuxDockerStaticTarMember(archive(header('docker/docker')), future())).toThrow('CLI size');
});

test('static tar framing returns only the exact member bytes, without minting generation authority', () => {
  const size = LINUX_DOCKER_STATIC_TOOLCHAIN.docker.executableBytes;
  const paddedSize = Math.ceil(size / 512) * 512;
  const tar = Buffer.alloc(512 + 512 + paddedSize + 1024);
  header('docker/', 0, '5').copy(tar);
  header('docker/docker', size).copy(tar, 512);
  tar[1024] = 42;
  const selected = selectLinuxDockerStaticTarMember(tar, future());
  expect(selected.byteLength).toBe(size);
  expect(selected[0]).toBe(42);
  expect('generation' in selected).toBe(false);
});

test('static vendor redirect permits only the single official GitHub asset namespace', () => {
  const exact = 'https://release-assets.githubusercontent.com/github-production-release-asset/177210627/12345678-abcd-1234-abcd-123456789012?token=fixture';
  expect(resolveLinuxDockerStaticAssetRedirect(exact).href).toBe(exact);
  for (const bad of [
    '/relative', 'http://release-assets.githubusercontent.com/github-production-release-asset/1/id',
    'https://example.com/github-production-release-asset/1/id',
    'https://user:password@release-assets.githubusercontent.com/github-production-release-asset/1/id',
    'https://release-assets.githubusercontent.com:8443/github-production-release-asset/1/id',
    'https://release-assets.githubusercontent.com/other/1/id',
    'https://release-assets.githubusercontent.com/github-production-release-asset/1/id#fragment'
  ]) expect(() => resolveLinuxDockerStaticAssetRedirect(bad)).toThrow();
});

test('publication errors retain the exact phase, recovery identity and even undefined primary failure', () => {
  const residue = Object.freeze({ path: '/tmp/sec-docker-static-fixture', finalPath: '/tmp/sec-docker-static-fixture', device: '1', inode: '2', objectId: 'fixture' });
  const error = new LinuxDockerStaticPublicationError('retire', residue, undefined);
  expect(error.phase).toBe('retire');
  expect(error.residue).toBe(residue);
  expect(Object.hasOwn(error, 'cause')).toBe(true);
  expect(error.cause).toBeUndefined();
});


test('static gzip decoder rejects corruption, truncation and cancellation before publication', async () => {
  const encoded = gzipSync(archive(header('docker/other')));
  const corrupt = Buffer.from(encoded);
  corrupt[corrupt.length - 8] ^= 1;
  await expect(decodeLinuxDockerStaticArchiveMember(corrupt, future(), new AbortController().signal)).rejects.toThrow('gzip');
  await expect(decodeLinuxDockerStaticArchiveMember(encoded.subarray(0, encoded.length - 4), future(), new AbortController().signal)).rejects.toThrow('gzip');
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(decodeLinuxDockerStaticArchiveMember(encoded, future(), cancelled.signal)).rejects.toThrow();
});


test('publisher observes native cancellation and rejects live accessor overrides without invoking them', async () => {
  const aborted = new AbortController();
  const reason = new Error('native cancellation');
  aborted.abort(reason);
  Object.defineProperty(aborted.signal, 'aborted', { value: false });
  await expect(publishLinuxDockerStaticToolchain({ deadlineAtUnixMs: future(), signal: aborted.signal })).rejects.toBe(reason);
  const live = new AbortController();
  let calls = 0;
  Object.defineProperty(live.signal, 'aborted', { get: () => { calls += 1; return false; } });
  await expect(publishLinuxDockerStaticToolchain({ deadlineAtUnixMs: future(), signal: live.signal })).rejects.toThrow('native state accessors');
  expect(calls).toBe(0);
});
