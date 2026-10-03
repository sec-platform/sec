import { expect, test } from 'bun:test';
import {
  armLinuxImmutableRepositoryInput, assertLinuxImmutableInputMount,
  disposeLinuxImmutableRepositoryInput, parseLinuxImmutableInputMounts,
  settleLinuxImmutableRepositoryInput, type LinuxImmutableRepositoryInput
} from './linux-immutable-repository-input.ts';
import { compileLinuxRepositoryNamespaceFence } from './physical-no-follow-native.ts';

const base = '71 20 0:91 / /workspace ro,nosuid,nodev - tmpfs tmpfs ro,size=4096k\n';
const mount = (text: string, root = '/workspace') =>
  assertLinuxImmutableInputMount(parseLinuxImmutableInputMounts(text), '71', root);

test('immutable input requires kernel superblock RO, not a readonly bind or chmod projection', () => {
  expect(mount(base).superOptions).toContain('ro');
  expect(mount(base, '/workspace/src').id).toBe('71');
  for (const source of [
    base.replace('tmpfs ro,', 'tmpfs rw,'),
    base.replace('/workspace ro,', '/workspace rw,'),
    base.replace('0:91 / /workspace', '0:91 /subtree /workspace'),
    base.replace(' - tmpfs ', ' - ext4 '),
    base.replace(' - tmpfs ', ' shared:23 - tmpfs '),
    base + '72 20 0:91 / /alias rw - tmpfs tmpfs rw\n',
    base + '72 71 0:92 / /workspace/tmp rw - tmpfs tmpfs rw\n',
    base + '72 71 0:92 / /workspace ro - tmpfs tmpfs ro\n'
  ]) expect(() => mount(source)).toThrow();
  expect(() => mount(base, '/workspacex')).toThrow();
});

test('independent fixture/temp mounts outside input remain writable', () => {
  const independent = base + '72 20 0:92 / /tmp rw,nosuid,nodev - tmpfs tmpfs rw\n'
    + '73 20 0:93 / /home/sut/state rw,nosuid,nodev - tmpfs tmpfs rw\n';
  expect(mount(independent).target).toBe('/workspace');
  const sharedReadOnlyAlias = independent + '74 20 0:91 / /alias ro - tmpfs tmpfs ro\n';
  expect(mount(sharedReadOnlyAlias).id).toBe('71');
});

test('mount parser preserves escaped kernel path identity and rejects ambiguity', () => {
  expect(mount(base.replace('/workspace', '/work\\040space'), '/work space').target).toBe('/work space');
  for (const value of ['', base + base, 'bad row\n', base.replace(' - ', ' ')]) {
    expect(() => parseLinuxImmutableInputMounts(value)).toThrow();
  }
});

test('plain parsed fields cannot mint or reactivate the physical capability', () => {
  const forged = Object.freeze({ rootIdentityDigest: `sha256:${'a'.repeat(64)}`,
    providerBinding: Object.freeze({ requirementId: 'runtime-state.linux-immutable-repository-input.retained' }) }) as unknown as LinuxImmutableRepositoryInput;
  let consulted = false;
  const input = Object.defineProperties({ prepared: forged }, {
    operation: { get() { consulted = true; throw new Error('must not consume'); } },
    requirementBindingContext: { get() { consulted = true; throw new Error('must not consume'); } }
  }) as Parameters<typeof armLinuxImmutableRepositoryInput>[0];
  expect(() => armLinuxImmutableRepositoryInput(input)).toThrow('owner-issued');
  expect(() => settleLinuxImmutableRepositoryInput(forged)).toThrow('owner-issued');
  expect(() => disposeLinuxImmutableRepositoryInput(forged)).toThrow('owner-issued');
  expect(consulted).toBe(false);
});

// This pure evaluator tests the actual emitted cBPF bytes. It neither installs
// a filter nor calls a privileged operation in the ordinary source test lane.
function evaluate(number: number, flags = 0, arch = 0xc000003e): number {
  const filter = Buffer.from(compileLinuxRepositoryNamespaceFence());
  let accumulator = 0;
  for (let instruction = 0; instruction < filter.length / 8; instruction++) {
    const offset = instruction * 8;
    const code = filter.readUInt16LE(offset); const value = filter.readUInt32LE(offset + 4);
    const jt = filter[offset + 2]!; const jf = filter[offset + 3]!;
    if (code === 0x20) accumulator = value === 0 ? number >>> 0 : value === 4 ? arch >>> 0 : value === 16 ? flags >>> 0 : (() => { throw new Error('unknown seccomp data offset'); })();
    else if (code === 0x15) instruction += accumulator === value ? jt : jf;
    else if (code === 0x45) instruction += (accumulator & value) !== 0 ? jt : jf;
    else if (code === 0x06) return value;
    else throw new Error(`unsupported BPF opcode ${code}`);
  }
  throw new Error('filter has no terminal action');
}

test('namespace filter rejects compatibility ABIs, x32 and every selected escape without disabling ordinary I/O', () => {
  const denied = new Set([101, 155, 161, 165, 166, 272, 308, 311, 428, 429, 430, 431, 432, 433, 442]);
  for (let syscall = 0; syscall <= 1024; syscall++) {
    expect(evaluate(syscall)).toBe(denied.has(syscall) ? 0x00050001 : syscall === 435 ? 0x00050026 : 0x7fff0000);
    expect(evaluate(syscall | 0x40000000)).toBe(0x80000000);
    expect(evaluate(syscall, 0, 0x40000003)).toBe(0x80000000);
  }
  for (const flags of [0x00020000, 0x10000000, 0x10020000, 0xffffffff]) expect(evaluate(56, flags)).toBe(0x00050001);
  for (const flags of [0, 17, 0x50f00, 0x80000000]) expect(evaluate(56, flags)).toBe(0x7fff0000);
});
