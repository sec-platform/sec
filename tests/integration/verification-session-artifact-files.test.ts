import { afterEach, expect, spyOn, test } from 'bun:test';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as leafObservation from '../../src/adapters/runtime-state/physical/runtime/physical-leaf-observation.ts';
import * as physical from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  readJson,
  readSessionArtifactBytes,
  readSessionArtifactText,
  writeCanonicalDurable,
  writeDurable
} from '../../src/adapters/verification/platform/ci/runtime/session-artifact-files.ts';
import { verificationSessionCli } from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';

const roots: string[] = [];
const restoredSpies: Array<{ mockRestore(): void }> = [];
function fixture(): { root: string; parent: string; target: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-session-artifact-'));
  roots.push(root);
  const parent = path.join(root, 'artifacts');
  mkdirSync(parent);
  return { root, parent, target: path.join(parent, 'artifact.json') };
}
afterEach(() => {
  for (const spy of restoredSpies.splice(0)) spy.mockRestore();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('VerificationSession artifact consumer preserves exact pretty and canonical bytes through create and replace', () => {
  const { target } = fixture();
  writeDurable(target, { z: '雪😀e\u0301\uFFFD', a: 1 });
  expect(readFileSync(target, 'utf8')).toBe('{\n  "z": "雪😀e\u0301\uFFFD",\n  "a": 1\n}\n');
  expect(readJson<{ z: string; a: number }>(target)).toEqual({ z: '雪😀e\u0301\uFFFD', a: 1 });
  writeCanonicalDurable(target, { z: '雪😀e\u0301\uFFFD', a: 2 });
  expect(readFileSync(target, 'utf8')).toBe('{"a":2,"z":"雪😀e\u0301\uFFFD"}\n');
  expect(readSessionArtifactText(target)).toBe('{"a":2,"z":"雪😀e\u0301\uFFFD"}\n');
});

test('VerificationSession artifact JSON consumers reject malformed UTF-8 before parsing', async () => {
  const { target } = fixture();
  const bytes = Buffer.concat([Buffer.from('{"value":"'), Buffer.from([0xc3, 0x28]), Buffer.from('"}\n')]);
  writeFileSync(target, bytes);
  // Replacement decoding would turn this into parseable JSON with a changed value.
  expect(JSON.parse(bytes.toString('utf8'))).toEqual({ value: '\uFFFD(' });
  expect(readSessionArtifactBytes(target)).toEqual(bytes);
  expect(() => readSessionArtifactText(target)).toThrow(TypeError);
  expect(() => readJson(target)).toThrow(TypeError);
  await expect(verificationSessionCli(['artifact-status', '--artifact', target])).rejects.toBeInstanceOf(TypeError);
});

test('VerificationSession artifact text preserves a BOM and JSON still rejects it', () => {
  const { target } = fixture();
  const source = '\uFEFF{"value":"雪"}\n';
  writeFileSync(target, source, 'utf8');
  expect(readSessionArtifactText(target)).toBe(source);
  expect(() => readJson(target)).toThrow(SyntaxError);
});

test('VerificationSession artifact consumer rejects a parent substituted after its physical observation', () => {
  const { root, parent, target } = fixture();
  writeFileSync(target, '{"owner":"original"}\n');
  const originalRetain = physical.retainNoFollowOrdinaryFile;
  const savedParent = path.join(root, 'saved');
  const spy = spyOn(physical, 'retainNoFollowOrdinaryFile').mockImplementation((...args) => {
    renameSync(parent, savedParent);
    mkdirSync(parent);
    writeFileSync(target, '{"owner":"substitute"}\n');
    return originalRetain(...args);
  });
  restoredSpies.push(spy);
  expect(() => readJson(target)).toThrow(physical.PhysicalNoFollowError);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(readFileSync(path.join(savedParent, 'artifact.json'), 'utf8')).toBe('{"owner":"original"}\n');
  expect(readFileSync(target, 'utf8')).toBe('{"owner":"substitute"}\n');
});

test('VerificationSession artifact replacement rejects a substituted leaf before effect', () => {
  const { root, target } = fixture();
  writeFileSync(target, '{"owner":"original"}\n');
  const saved = path.join(root, 'saved.json');
  const originalReplace = physical.replaceDurableCanonicalFile;
  const spy = spyOn(physical, 'replaceDurableCanonicalFile').mockImplementation((input) => {
    renameSync(target, saved);
    writeFileSync(target, '{"owner":"substitute"}\n');
    return originalReplace(input);
  });
  restoredSpies.push(spy);
  expect(() => writeDurable(target, { owner: 'new' })).toThrow(physical.PhysicalNoFollowError);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(readFileSync(saved, 'utf8')).toBe('{"owner":"original"}\n');
  expect(readFileSync(target, 'utf8')).toBe('{"owner":"substitute"}\n');
});

test('VerificationSession artifact consumer rejects hardlinked files and CLI rejects a symlink artifact', async () => {
  const { root, target } = fixture();
  writeFileSync(target, '{"owner":"original"}\n');
  const alias = path.join(root, 'alias.json');
  linkSync(target, alias);
  expect(() => readJson(target)).toThrow('exactly one link');
  expect(() => writeCanonicalDurable(target, { owner: 'new' })).toThrow('exactly one link');
  expect(readFileSync(alias, 'utf8')).toBe('{"owner":"original"}\n');
  const symlink = path.join(root, 'linked.json');
  symlinkSync(target, symlink);
  await expect(verificationSessionCli(['artifact-status', '--artifact', symlink]))
    .rejects.toBeInstanceOf(physical.PhysicalNoFollowError);
});

test('VerificationSession artifact consumer does not report success after Physical final readback fails', () => {
  const { parent, target } = fixture();
  writeFileSync(target, '{"owner":"original"}\n');
  const originalRead = leafObservation.readNoFollowOrdinaryFile;
  let finalReadbackObserved = false;
  const spy = spyOn(leafObservation, 'readNoFollowOrdinaryFile').mockImplementation((...args) => {
    const bytes = originalRead(...args);
    if (args[0].path === parent && args[1] === 'artifact.json') {
      finalReadbackObserved = true;
      return Buffer.from('{"readback":"corrupt"}\n');
    }
    return bytes;
  });
  restoredSpies.push(spy);
  expect(() => writeDurable(target, { owner: 'new' })).toThrow('final readback differs');
  expect(finalReadbackObserved).toBe(true);
  // The effect happened; failure is not misreported as pre-effect rejection.
  expect(existsSync(target)).toBe(true);
  expect(readFileSync(target, 'utf8')).toBe('{\n  "owner": "new"\n}\n');
});

test.skipIf(process.platform !== 'win32')('VerificationSession artifact write settles an interrupted Windows preimage quarantine before replacing', () => {
  const { parent, target } = fixture();
  writeFileSync(target, '{"owner":"original"}\n');
  const admittedParent = physical.inspectNoFollowDirectoryChain(parent, 'artifact recovery fixture').target;
  const current = physical.inspectNoFollowOrdinaryFileEntry(admittedParent, 'artifact.json')!;
  const interruptedBytes = Buffer.from('{"owner":"interrupted"}\n');
  expect(() => physical.replaceDurableCanonicalFile({
    parent: admittedParent,
    name: 'artifact.json',
    bytes: interruptedBytes,
    expectedExisting: { device: current.device, inode: current.inode },
    rejectExistingHardLinks: true,
    validate: (bytes) => {
      if (!Buffer.from(bytes).equals(interruptedBytes)) throw new Error('fixture bytes changed');
    },
    windowsInterruptionActor: physical.createWindowsDurableCanonicalFileReplacementInterruptionActorForTests(
      'after-preimage-quarantine'
    )
  })).toThrow('interrupted at after-preimage-quarantine');
  expect(existsSync(target)).toBe(false);
  const interruptedNames = readdirSync(parent).sort();
  expect(interruptedNames.length).toBeGreaterThan(0);
  // Ordinary artifact reads must not gain recovery effects from this cutover.
  expect(() => readJson(target)).toThrow(physical.PhysicalNoFollowError);
  expect(readdirSync(parent).sort()).toEqual(interruptedNames);
  expect(existsSync(target)).toBe(false);

  writeDurable(target, { owner: 'recovered' });
  expect(readFileSync(target, 'utf8')).toBe('{\n  "owner": "recovered"\n}\n');
  expect(readdirSync(parent)).toEqual(['artifact.json']);
  writeCanonicalDurable(target, { owner: 'next' });
  expect(readFileSync(target, 'utf8')).toBe('{"owner":"next"}\n');
  expect(readdirSync(parent)).toEqual(['artifact.json']);
});
