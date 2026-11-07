import path from 'node:path';

import { expect, test } from 'bun:test';

import { parseNativeCargoBinaryArtifact, parseNativeCargoTestBinaryArtifact } from './native-cargo-artifact.ts';

const root = path.resolve('native-artifact-fixture');
const expected = { manifestPath: path.join(root, 'crate', 'Cargo.toml'),
  targetName: 'gift-author-kernel', targetDirectory: path.join(root, 'owned-target') };
const executable = path.join(expected.targetDirectory, 'debug', process.platform === 'win32' ? 'gift-author-kernel.exe' : 'gift-author-kernel');
const completed = { reason: 'build-finished', success: true };

function artifact() {
  return { reason: 'compiler-artifact', package_id: 'path+file:///fixture#gift-author-kernel@0.1.0',
    manifest_path: expected.manifestPath, target: { name: expected.targetName, kind: ['bin'] },
    profile: { test: false }, filenames: [executable], executable, fresh: false };
}

function stream(...messages: unknown[]): Uint8Array {
  return new TextEncoder().encode(`${messages.map(message => JSON.stringify(message)).join('\n')}\n`);
}

test('selects one ordinary binary emitted by the current successful Cargo build', () => {
  expect(parseNativeCargoBinaryArtifact(stream(artifact(), completed), expected)).toBe(executable);
  expect(parseNativeCargoBinaryArtifact(stream({ ...artifact(), fresh: true }, completed), expected)).toBe(executable);
  const crlf = new TextEncoder().encode(`\r\n${JSON.stringify(artifact())}\r\n${JSON.stringify(completed)}\r\n`);
  expect(parseNativeCargoBinaryArtifact(crlf, expected)).toBe(executable);
});

test('dependency binaries, libraries and test harnesses cannot substitute for the requested binary', () => {
  const dependency = { ...artifact(), manifest_path: path.join(root, 'dependency', 'Cargo.toml') };
  const harness = { ...artifact(), profile: { test: true } };
  const library = { ...artifact(), target: { name: expected.targetName, kind: ['lib'] }, executable: null };
  for (const other of [dependency, harness, library, { ...artifact(), target: { name: 'other-binary', kind: ['bin'] } }]) {
    expect(() => parseNativeCargoBinaryArtifact(stream(other, completed), expected)).toThrow('no matching binary artifact');
    expect(parseNativeCargoBinaryArtifact(stream(other, artifact(), completed), expected)).toBe(executable);
  }
});

test('absent artifacts and failed or absent completion never recover a pre-existing pathname', () => {
  expect(() => parseNativeCargoBinaryArtifact(stream(completed), expected)).toThrow('no matching binary artifact');
  expect(() => parseNativeCargoBinaryArtifact(stream(artifact()), expected)).toThrow('no successful build-finished');
  expect(() => parseNativeCargoBinaryArtifact(stream(artifact(), { ...completed, success: false }), expected))
    .toThrow('did not finish successfully');
  expect(() => parseNativeCargoBinaryArtifact(new Uint8Array(), expected)).toThrow('no successful build-finished');
});

test('duplicate artifacts and repeated or out-of-order completion are rejected', () => {
  expect(() => parseNativeCargoBinaryArtifact(stream(artifact(), artifact(), completed), expected)).toThrow('multiple matching');
  expect(() => parseNativeCargoBinaryArtifact(stream(artifact(), { ...artifact(), fresh: true }, completed), expected))
    .toThrow('multiple matching');
  expect(() => parseNativeCargoBinaryArtifact(stream(artifact(), completed, completed), expected)).toThrow('after build-finished');
  expect(() => parseNativeCargoBinaryArtifact(stream(completed, artifact()), expected)).toThrow('after build-finished');
});

test('selected executable must be a canonical output strictly inside the owned target directory', () => {
  for (const candidate of [root, expected.targetDirectory, path.join(`${expected.targetDirectory}-sibling`, 'binary')]) {
    expect(() => parseNativeCargoBinaryArtifact(stream({ ...artifact(), executable: candidate,
      filenames: [candidate] }, completed), expected)).toThrow('outside its owned target');
  }
  for (const candidate of ['relative/binary', `${expected.targetDirectory}${path.sep}debug${path.sep}..${path.sep}binary`, `${executable}\0`]) {
    expect(() => parseNativeCargoBinaryArtifact(stream({ ...artifact(), executable: candidate,
      filenames: [candidate] }, completed), expected)).toThrow();
  }
  expect(() => parseNativeCargoBinaryArtifact(stream({ ...artifact(), executable: null }, completed), expected)).toThrow('no matching executable output');
  expect(() => parseNativeCargoBinaryArtifact(stream({ ...artifact(), filenames: [] }, completed), expected)).toThrow('no matching executable output');
});

test('malformed or spoofing stdout is refused even beside an otherwise valid artifact', () => {
  const valid = new TextDecoder().decode(stream(artifact(), completed));
  for (const prefix of ['macro printed arbitrary stdout\n', '{}\n', '[]\n', '{"reason":\n',
    '{"reason":"build-finished","reason":"compiler-artifact","success":true}\n']) {
    expect(() => parseNativeCargoBinaryArtifact(new TextEncoder().encode(prefix + valid), expected)).toThrow();
  }
  const badUtf8 = Uint8Array.from([0xc3, 0x28]);
  expect(() => parseNativeCargoBinaryArtifact(badUtf8, expected)).toThrow('not exact UTF-8');
  expect(() => parseNativeCargoBinaryArtifact(new TextEncoder().encode(`\ufeff${valid}`), expected)).toThrow('malformed JSON');
  for (const change of [
    { fresh: 'true' }, { profile: { test: 'false' } }, { target: { name: expected.targetName, kind: ['bin', 'bin'] } },
    { filenames: null }, { manifest_path: 'Cargo.toml' }
  ]) {
    expect(() => parseNativeCargoBinaryArtifact(stream({ ...artifact(), ...change }, artifact(), completed), expected)).toThrow();
  }
});

test('ordinary Cargo diagnostics and build-script records preserve the selected artifact', () => {
  const diagnostic = { reason: 'compiler-message', package_id: 'fixture', manifest_path: expected.manifestPath,
    target: { name: expected.targetName, kind: ['bin'] }, message: { message: 'a compiler warning', level: 'warning' } };
  const buildScript = { reason: 'build-script-executed', package_id: 'fixture-build-script' };
  expect(parseNativeCargoBinaryArtifact(stream(diagnostic, buildScript, artifact(), completed), expected)).toBe(executable);
});

test('Cargo test selects its ordinary binary before returning the exact libtest output', () => {
  const testOutput = new TextEncoder().encode('\nrunning 2 tests\ntest first ... ok\ntest second ... ok\n');
  const stdout = Buffer.concat([stream(artifact(), completed), testOutput]);
  const parsed = parseNativeCargoTestBinaryArtifact(stdout, expected);
  expect(parsed.executable).toBe(executable);
  expect(Buffer.from(parsed.testOutput)).toEqual(Buffer.from(testOutput));
  const crlf = new TextEncoder().encode(`\r\n${JSON.stringify(artifact())}\r\n${JSON.stringify(completed)}\r\n`);
  expect(Buffer.from(parseNativeCargoTestBinaryArtifact(Buffer.concat([crlf, testOutput]), expected).testOutput)).toEqual(Buffer.from(testOutput));
  const withoutFinalNewline = new TextEncoder().encode(`${JSON.stringify(artifact())}\n${JSON.stringify(completed)}`);
  const noTail = parseNativeCargoTestBinaryArtifact(withoutFinalNewline, expected);
  expect(noTail.executable).toBe(executable);
  expect(noTail.testOutput.byteLength).toBe(0);
});

test('test-program JSON cannot replace or invalidate the artifact chosen by Cargo', () => {
  const fakeExecutable = path.join(expected.targetDirectory, 'forged-binary');
  const testOutput = stream({ ...artifact(), executable: fakeExecutable, filenames: [fakeExecutable] },
    { ...completed, success: false }, completed, { reason: 'not-a-cargo-message' });
  const parsed = parseNativeCargoTestBinaryArtifact(Buffer.concat([stream(artifact(), completed), testOutput]), expected);
  expect(parsed.executable).toBe(executable);
  expect(Buffer.from(parsed.testOutput)).toEqual(Buffer.from(testOutput));
  expect(() => parseNativeCargoTestBinaryArtifact(Buffer.concat([stream(completed), testOutput]), expected))
    .toThrow('no matching binary artifact');
  expect(() => parseNativeCargoTestBinaryArtifact(stream(artifact(), { ...completed, success: false }, artifact(), completed), expected))
    .toThrow('did not finish successfully');
});

test('Cargo test requires a complete unambiguous build prefix with a normal owned binary', () => {
  expect(() => parseNativeCargoTestBinaryArtifact(stream(artifact()), expected)).toThrow('no successful build-finished');
  expect(() => parseNativeCargoTestBinaryArtifact(new Uint8Array(), expected)).toThrow('no successful build-finished');
  expect(() => parseNativeCargoTestBinaryArtifact(stream(artifact(), artifact(), completed), expected)).toThrow('multiple matching');
  const outside = path.join(root, 'outside-binary');
  expect(() => parseNativeCargoTestBinaryArtifact(stream({ ...artifact(), executable: outside, filenames: [outside] }, completed), expected))
    .toThrow('outside its owned target');
  for (const other of [
    { ...artifact(), profile: { test: true } },
    { ...artifact(), manifest_path: path.join(root, 'another-crate', 'Cargo.toml') },
    { ...artifact(), target: { name: expected.targetName, kind: ['lib'] }, executable: null },
    { ...artifact(), target: { name: 'another-binary', kind: ['bin'] } }
  ]) {
    expect(() => parseNativeCargoTestBinaryArtifact(stream(other, completed), expected)).toThrow('no matching binary artifact');
    expect(parseNativeCargoTestBinaryArtifact(stream(other, artifact(), completed), expected).executable).toBe(executable);
  }
});

test('Cargo test rejects malformed UTF-8 and duplicate keys before its completion boundary', () => {
  const valid = stream(artifact(), completed);
  const duplicateProfile = JSON.stringify(artifact()).replace('"test":false', '"test":false,"test":false');
  for (const prefix of [
    'arbitrary compiler stdout\n',
    `\ufeff${JSON.stringify(artifact())}\n`
  ]) {
    expect(() => parseNativeCargoTestBinaryArtifact(Buffer.concat([Buffer.from(prefix), valid]), expected)).toThrow();
  }
  expect(() => parseNativeCargoTestBinaryArtifact(Buffer.concat([
    stream(artifact()), Buffer.from('{"reason":"build-finished","success":true,"success":true}\n')
  ]), expected)).toThrow('malformed JSON');
  expect(() => parseNativeCargoTestBinaryArtifact(Buffer.concat([
    Buffer.from(`${duplicateProfile}\n`), stream(completed)
  ]), expected)).toThrow('malformed JSON');
  expect(() => parseNativeCargoTestBinaryArtifact(Buffer.concat([
    stream(artifact()), Uint8Array.from([0xc3, 0x28, 0x0a]), stream(completed)
  ]), expected)).toThrow('not exact UTF-8');
  expect(() => parseNativeCargoTestBinaryArtifact(Buffer.concat([
    stream(artifact()), Buffer.from('{"reason":"build-finished","success":true'), Uint8Array.from([0xff])
  ]), expected)).toThrow('not exact UTF-8');
});

test('opaque test bytes need no UTF-8 and the returned tail owns its byte storage', () => {
  const tail = Uint8Array.from([0xff, 0xc3, 0x28, 0x00, 0x0a]);
  const stdout = Buffer.concat([stream(artifact(), completed), tail]);
  const surrounding = Buffer.concat([Uint8Array.of(0xff), stdout, Uint8Array.of(0xfe)]);
  const input = surrounding.subarray(1, surrounding.length - 1);
  const parsed = parseNativeCargoTestBinaryArtifact(input, expected);
  expect(parsed.executable).toBe(executable);
  expect(Buffer.from(parsed.testOutput)).toEqual(Buffer.from(tail));
  input.fill(0);
  expect(Buffer.from(parsed.testOutput)).toEqual(Buffer.from(tail));
  parsed.testOutput[0] = 1;
  expect(input[input.length - tail.length]).toBe(0);
  expect(() => parseNativeCargoTestBinaryArtifact(new Uint8Array(new SharedArrayBuffer(4)), expected)).toThrow();
});

test('strict Cargo build mode still refuses the same post-completion test tail', () => {
  const textTail = Buffer.concat([stream(artifact(), completed), Buffer.from('running 1 test\ntest example ... ok\n')]);
  expect(parseNativeCargoTestBinaryArtifact(textTail, expected).executable).toBe(executable);
  expect(() => parseNativeCargoBinaryArtifact(textTail, expected)).toThrow('after build-finished');
  const rawTail = Buffer.concat([stream(artifact(), completed), Uint8Array.from([0xff])]);
  expect(() => parseNativeCargoBinaryArtifact(rawTail, expected)).toThrow('not exact UTF-8');
  expect(() => parseNativeCargoBinaryArtifact(stream(artifact(), completed, completed), expected)).toThrow('after build-finished');
});
