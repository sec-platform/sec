import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createExclusiveNoFollowDirectory,
  createLinuxNoFollowDirectoryCreateRaceActorForTests,
  inspectNoFollowDirectoryChain
} from './physical-no-follow.ts';

test.skipIf(process.platform !== 'linux')('ancestor race actor rejects a foreign chain before either tree is mutated', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ancestor-race-target-'));
  try {
    const own = path.join(root, 'own');
    const other = path.join(root, 'other');
    const displaced = path.join(root, 'other-displaced');
    mkdirSync(own); mkdirSync(other);
    const ownIdentity = inspectNoFollowDirectoryChain(own).target;
    const otherIdentity = inspectNoFollowDirectoryChain(other).target;
    const actor = createLinuxNoFollowDirectoryCreateRaceActorForTests({
      point: 'after-ancestor-open', targetPath: other, displacedPath: displaced
    });
    expect(() => createExclusiveNoFollowDirectory(ownIdentity, 'child', actor))
      .toThrow('target is outside the retained ancestor chain');
    expect(inspectNoFollowDirectoryChain(own).target).toEqual(ownIdentity);
    expect(inspectNoFollowDirectoryChain(other).target).toEqual(otherIdentity);
    expect(existsSync(displaced)).toBe(false);
    expect(existsSync(path.join(own, 'child'))).toBe(false);
    // The rejected admission did not consume or execute the actor. Its actual
    // target now injects a race and the canonical witness rejects the effect.
    let rejection: unknown;
    try { createExclusiveNoFollowDirectory(otherIdentity, 'child', actor); }
    catch (error) { rejection = error; }
    expect(rejection).toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' });
    expect(existsSync(displaced)).toBe(true);
    expect(existsSync(path.join(other, 'child'))).toBe(false);
    expect(existsSync(path.join(displaced, 'child'))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
