import { expect, test } from 'bun:test';
import { assertMainHealthHostRuntime, type MainHealthHostRuntime } from '../../src/adapters/runtime-state/physical/runtime/main-health-host-runtime.ts';
import { assertMainHealthRuntimeCommandBytes } from '../../src/bootstrap/development/main-health-runtime.ts';

test('MainHealth command file is fixed data and cannot supply shell or alternate argv', () => {
  for (const command of ['bun --version', 'bun --version\n']) {
    expect(() => assertMainHealthRuntimeCommandBytes(Buffer.from(command))).not.toThrow();
  }
  for (const command of ['bun --version; echo substituted',
    'bun --version\necho substituted', 'bun --version --update-snapshots',
    'bun --version\n\n', 'bun --version\0',
    'bun --versiоn', '', 'bun --version\r\n', 'bun run test -- --scope fast']) {
    expect(() => assertMainHealthRuntimeCommandBytes(Buffer.from(command))).toThrow(/fixed runtime command/u);
  }
});

test('runtime manifest data cannot reconstruct MainHealth physical input authority', () => {
  const copied = { runtime: { root: { path: '/synthetic', device: '1', inode: '2' },
    manifest: { schema: 'sec-main-health-host-runtime-manifest-v1', platform: 'linux/amd64', files: [] },
    manifestDigest: `sha256:${'a'.repeat(64)}` }, source: { root: '/synthetic', headSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) } };
  expect(() => assertMainHealthHostRuntime(copied as unknown as MainHealthHostRuntime)).toThrow(/owner-issued/u);
});
