import { expect, test } from 'bun:test';
import { assertMainHealthHostRuntime, type MainHealthHostRuntime } from '../../src/adapters/runtime-state/physical/runtime/main-health-host-runtime.ts';
import { assertMainHealthFastCommandBytes } from '../../src/bootstrap/development/main-health-fast.ts';

test('MainHealth command file is fixed data and cannot supply shell or alternate argv', () => {
  for (const command of ['bun run test -- --scope fast', 'bun run test -- --scope fast\n']) {
    expect(() => assertMainHealthFastCommandBytes(Buffer.from(command))).not.toThrow();
  }
  for (const command of ['bun run test -- --scope fast; echo substituted',
    'bun run test -- --scope fast\necho substituted', 'bun run test -- --scope fast --update-snapshots',
    'bun run test -- --scope fast\n\n', 'bun run test -- --scope fast\0',
    'bun run test -- --scope fаst', '', 'bun run test -- --scope fast\r\n']) {
    expect(() => assertMainHealthFastCommandBytes(Buffer.from(command))).toThrow(/fixed fast command/u);
  }
});

test('runtime manifest data cannot reconstruct MainHealth physical input authority', () => {
  const copied = { runtime: { root: { path: '/synthetic', device: '1', inode: '2' },
    manifest: { schema: 'sec-main-health-host-runtime-manifest-v1', platform: 'linux/amd64', files: [] },
    manifestDigest: `sha256:${'a'.repeat(64)}` }, source: { root: '/synthetic', headSha: 'b'.repeat(40), treeSha: 'c'.repeat(40) } };
  expect(() => assertMainHealthHostRuntime(copied as unknown as MainHealthHostRuntime)).toThrow(/owner-issued/u);
});
