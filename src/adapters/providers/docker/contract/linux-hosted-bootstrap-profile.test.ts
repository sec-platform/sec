import { expect, test } from 'bun:test';
import { rawSha256 } from '../../../../contracts/canonical.ts';
import { canonicalHostedSandboxRoots, compileHostedSutAppArmorProfile, LINUX_HOSTED_BOOTSTRAP_PROFILE } from './linux-hosted-bootstrap-profile.ts';

const profileName = `sec-sut-${'1'.repeat(32)}`;
const root = `/tmp/sec-sut-${'2'.repeat(16)}-${'3'.repeat(32)}`;
test('bootstrap policy is exact and phase reuse does not restart an already-enabled daemon', () => {
  expect(LINUX_HOSTED_BOOTSTRAP_PROFILE.laterPhase).toContain('without-restart');
  const input = [root];
  const roots = canonicalHostedSandboxRoots(input);
  input[0] = '/tmp/foreign';
  expect(roots).toEqual([root]);
  expect(Object.isFrozen(roots)).toBe(true);
  for (const bad of ['/tmp/**', '/tmp/sec-sut-1234-x', root + '/..', root + '\nmount,']) {
    expect(() => canonicalHostedSandboxRoots([bad])).toThrow();
  }
  expect(() => canonicalHostedSandboxRoots([root, root])).toThrow();
  let calls = 0;
  const accessor = [root];
  Object.defineProperty(accessor, '0', { get() { calls++; return root; } });
  expect(() => canonicalHostedSandboxRoots(accessor)).toThrow();
  expect(calls).toBe(0);
});
test('SUT profile keeps Docker restrictions and grants only exact mount destinations', () => {
  const profile = compileHostedSutAppArmorProfile({ profileName, sandboxRoots: [root] });
  expect(profile.digest).toBe(rawSha256(Buffer.from(profile.bytes)));
  expect(profile.bytes).toContain('deny /proc/sysrq-trigger rwklx,');
  expect(profile.bytes).toContain('deny /sys/kernel/security/** rwklx,');
  expect(profile.bytes).toContain(`peer=${profileName}`);
  expect(profile.bytes).toContain(` /dev/null -> ${root}/dev/null,`);
  expect(profile.bytes).not.toContain('deny mount,');
  expect(profile.bytes).not.toContain('\n  mount,');
  expect(profile.bytes).not.toContain('\n  umount,');
  expect(profile.bytes).not.toContain('#include');
  expect(profile.bytes).not.toContain('/tmp/**');
  expect(() => compileHostedSutAppArmorProfile({ profileName: 'docker-default', sandboxRoots: [root] })).toThrow();
  expect(() => compileHostedSutAppArmorProfile({ profileName, sandboxRoots: [] })).toThrow();
});
