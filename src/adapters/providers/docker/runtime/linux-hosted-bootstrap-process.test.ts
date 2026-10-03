import { expect, test } from 'bun:test';
import { assertHostedSudoMetadata, parseHostedBootstrapPhysicalReadback } from './linux-hosted-bootstrap-process.ts';

test('sudo metadata qualification is distinct from generic sealed executable bytes', () => {
  const input = { uid: 0n, mode: 0o104755n, nlink: 1n, noNewPrivileges: '0', mountOptions: ['rw'] };
  expect(() => assertHostedSudoMetadata(input)).not.toThrow();
  for (const replacement of [{ uid: 1001n }, { mode: 0o100755n }, { mode: 0o104777n }, { nlink: 2n },
    { noNewPrivileges: '1' }, { mountOptions: ['rw', 'nosuid'] }, { mountOptions: ['noexec'] }]) {
    expect(() => assertHostedSudoMetadata({ ...input, ...replacement })).toThrow('privilege prerequisites');
  }
});
test('physical readback decoder rejects foreign profiles and incomplete physical identities', () => {
  const name = `sec-sut-${'1'.repeat(32)}`;
  const digest = `sha256:${'2'.repeat(64)}` as const;
  const expected = { profileName: name, profileInputDigest: digest, profileState: 'enforce' as const };
  const fixture = { kind: 'result', id: '3'.repeat(32), config: { device: '1', inode: '2', mode: 0o644, gid: 0, digest },
    restarted: false, profile: name, profileInputDigest: digest, profileState: 'enforce',
    daemonId: 'daemon-id', daemonVersion: '28.0.4', daemonPeer: { pid: 100, start: '1234', uid: 0, device: '1', inode: '3' } };
  const parsed = parseHostedBootstrapPhysicalReadback(fixture, expected);
  expect(parsed.config.inode).toBe('2');
  expect(Object.isFrozen(parsed.config)).toBe(true);
  for (const replacement of [{ profile: 'docker-default' }, { profileState: 'absent' }, { daemonId: '' },
    { config: { ...fixture.config, inode: null } }, { daemonPeer: { ...fixture.daemonPeer, pid: 0 } }]) {
    expect(() => parseHostedBootstrapPhysicalReadback({ ...fixture, ...replacement }, expected)).toThrow();
  }
  // This parser produces data only; it never enters the bootstrap issuance map.
});
