import { expect, test } from 'bun:test';
import { chmod, link, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertLinuxDockerPluginDenyFile,
  assertLinuxDockerPluginSearch,
  openLinuxDockerPluginSearch,
  retainLinuxDockerPluginDenyFile,
  type LinuxDockerPluginSearch
} from './linux-plugin-search.ts';
import type { RetainedLinuxDockerStaticToolchain } from './linux-static-toolchain.ts';

const linuxTest = test.skipIf(process.platform !== 'linux');

test('copied plugin search observations cannot execute their caller assertions', () => {
  let asserted = false;
  expect(() => assertLinuxDockerPluginSearch({ assertCurrent() { asserted = true; } } as unknown as LinuxDockerPluginSearch))
    .toThrow('not owner-issued');
  expect(asserted).toBe(false);
});

test('plugin search rejects a forged static supply before filesystem discovery or creation', () => {
  let asserted = false;
  expect(() => openLinuxDockerPluginSearch({
    toolchain: { assertCurrent() { asserted = true; } } as unknown as RetainedLinuxDockerStaticToolchain,
    denyDirectory: { path: '/must-not-be-opened' } as never,
    privateConfig: { path: '/must-not-be-opened' } as never,
    deadlineAtUnixMs: Date.now() + 10_000
  })).toThrow('not owner-issued');
  expect(asserted).toBe(false);
});

linuxTest('real deny producer publishes only empty non-executable single-link files and rejects replacement', async () => {
  const root = await mkdtemp('/tmp/sec-plugin-deny-test-');
  const directory = inspectNoFollowDirectoryChain(root).target;
  const marker = retainLinuxDockerPluginDenyFile({ directory, name: 'docker-compose', deadlineAtUnixMs: Date.now() + 10_000 });
  try {
    const file = path.join(root, 'docker-compose');
    const metadata = await stat(file);
    expect(metadata.isFile()).toBe(true);
    expect(metadata.mode & 0o7777).toBe(0o400);
    expect(metadata.nlink).toBe(1);
    expect((await readFile(file)).length).toBe(0);
    assertLinuxDockerPluginDenyFile(marker);
    expect(() => assertLinuxDockerPluginDenyFile({ ...marker })).toThrow('not owner-issued');
    expect(() => retainLinuxDockerPluginDenyFile({ directory, name: 'docker-compose', deadlineAtUnixMs: Date.now() + 10_000 })).toThrow();
    await chmod(file, 0o500);
    expect(() => assertLinuxDockerPluginDenyFile(marker)).toThrow();
    await chmod(file, 0o600);
    await writeFile(file, '#!/bin/sh\nexit 0\n');
    expect(() => assertLinuxDockerPluginDenyFile(marker)).toThrow();
  } finally { marker.dispose(); await rm(root, { recursive: true, force: true }); }
});

linuxTest('deny files reject added hard links and invalid names before publication', async () => {
  const root = await mkdtemp('/tmp/sec-plugin-deny-link-test-');
  const directory = inspectNoFollowDirectoryChain(root).target;
  const marker = retainLinuxDockerPluginDenyFile({ directory, name: 'docker-test', deadlineAtUnixMs: Date.now() + 10_000 });
  try {
    await link(path.join(root, 'docker-test'), path.join(root, 'alias'));
    expect(() => assertLinuxDockerPluginDenyFile(marker)).toThrow();
    for (const name of ['docker-buildx', 'docker-../evil', 'docker-Compose', 'docker-', 'docker-a-b']) {
      expect(() => retainLinuxDockerPluginDenyFile({ directory, name, deadlineAtUnixMs: Date.now() + 10_000 })).toThrow('name or original deadline');
    }
    expect(() => retainLinuxDockerPluginDenyFile({ directory, name: 'docker-expired', deadlineAtUnixMs: Date.now() - 1 })).toThrow('original deadline');
  } finally { marker.dispose(); await rm(root, { recursive: true, force: true }); }
});
