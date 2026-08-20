import { expect, test } from 'bun:test';
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  readCompilerTypeScriptMutationFixtureSync
} from '../helpers/compiler-fixtures.ts';

import { sha256 } from '../../platform/shared/canonical-primitives.ts';
import {
  PhysicalNoFollowError,
  assertSameNoFollowDirectoryIdentityV1,
  createExclusiveNoFollowDirectoryV1,
  createNoFollowDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  relocateRetainedNoFollowDirectoryV1,
  replaceDurableCanonicalFileV1,
  scanNoFollowDirectoryTreeInventoryV1,
  scanNoFollowDirectoryTreeMetadataV1,
  scanNoFollowDirectoryTreeV1
} from '../../platform/shared/physical-no-follow.ts';

function fixtureRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'sec-physical-no-follow-'));
}

function expectPhysicalCode(action: () => unknown, code: PhysicalNoFollowError['code']): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PhysicalNoFollowError);
    expect((error as PhysicalNoFollowError).code).toBe(code);
    return;
  }
  throw new Error(`Expected PhysicalNoFollowError ${code}.`);
}

test('no-follow directory inspection returns an ordered physical chain and only ENOENT means absent', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'ordinary', 'target');
    mkdirSync(target, { recursive: true });
    const observed = inspectNoFollowDirectoryChainV1(target, 'test target');
    expect(observed.target.path).toBe(path.resolve(target));
    expect(observed.ancestors.at(-1)).toEqual(observed.target);
    expect(observed.ancestors.length).toBeGreaterThan(1);
    expect(inspectExactNoFollowDirectoryPresenceV1(path.join(root, 'missing'))).toEqual({ state: 'absent' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no-follow inspection rejects a symlink/junction target and a symlink/junction ancestor', () => {
  const root = fixtureRoot();
  try {
    const ordinary = path.join(root, 'ordinary');
    const external = path.join(root, 'external');
    const alias = path.join(root, 'alias');
    const dangling = path.join(root, 'dangling');
    mkdirSync(ordinary);
    mkdirSync(external);
    symlinkSync(external, alias, process.platform === 'win32' ? 'junction' : 'dir');
    symlinkSync(path.join(root, 'missing-target'), dangling, process.platform === 'win32' ? 'junction' : 'dir');

    expectPhysicalCode(
      () => inspectNoFollowDirectoryChainV1(alias, 'alias target'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    expectPhysicalCode(
      () => inspectNoFollowDirectoryChainV1(path.join(alias, 'child'), 'alias child'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    // A dangling link is unsafe, not the only allowed "absent" outcome.
    expectPhysicalCode(
      () => inspectExactNoFollowDirectoryPresenceV1(dangling, 'dangling alias'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    expect(inspectNoFollowDirectoryChainV1(ordinary).target.path).toBe(path.resolve(ordinary));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('same-identity readback rejects replacement rather than accepting same lexical bytes', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const retained = path.join(root, 'retained');
    mkdirSync(target);
    const original = inspectNoFollowDirectoryChainV1(target, 'replace target').target;
    renameSync(target, retained);
    mkdirSync(target);
    expectPhysicalCode(
      () => assertSameNoFollowDirectoryIdentityV1(original, 'replace target'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained child inspection is create-free and exclusive creation never adopts a collision', () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'parent');
    const displacedParent = path.join(root, 'parent-displaced');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChainV1(parentPath).target;

    expect(inspectNoFollowDirectoryChildV1(parent, 'child')).toBeNull();
    expect(existsSync(path.join(parentPath, 'child'))).toBe(false);
    const child = createExclusiveNoFollowDirectoryV1(parent, 'child');
    expect(inspectNoFollowDirectoryChildV1(parent, 'child')).toEqual(child);
    expectPhysicalCode(
      () => createExclusiveNoFollowDirectoryV1(parent, 'child'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );

    renameSync(parentPath, displacedParent);
    mkdirSync(parentPath);
    expectPhysicalCode(
      () => createExclusiveNoFollowDirectoryV1(parent, 'replacement-child'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(existsSync(path.join(parentPath, 'replacement-child'))).toBe(false);
    expect(existsSync(path.join(displacedParent, 'child'))).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux directory-create transaction rejects parent, ancestor, and child replacement races', async () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const mirrorRoot = path.join(root, 'mirror');
    const mirrorShared = path.join(mirrorRoot, 'platform', 'shared');
    mkdirSync(mirrorShared, { recursive: true });
    let source = readCompilerTypeScriptMutationFixtureSync(
      'platform/shared/physical-no-follow.ts',
      'hostile-mutation'
    );
    const importNeedle = '  lstatSync,\n';
    const transactionNeedle =
      '): LinuxDirectoryCreateTransactionV1 {\n  const rootFd = linuxOpenRoot(label);\n';
    const ancestorNeedle =
      '      const nextFd = linuxOpenAt(currentFd, segment, `${label} ancestor`);\n';
    const witnessNeedle =
      '    linuxAssertDirectoryCreateWitness(\n' +
      '      input.witness,\n' +
      '      linuxReadDirectoryMutationEvents(input.witness, input.label),\n' +
      '      input.name,\n' +
      '      created,\n';
    expect(source.split(importNeedle).length).toBe(2);
    expect(source.split(transactionNeedle).length).toBe(2);
    expect(source.split(ancestorNeedle).length).toBe(2);
    expect(source.split(witnessNeedle).length).toBe(2);
    source = source.replace(
      importNeedle,
      `${importNeedle}  mkdirSync as linuxRaceMkdirSync,\n  renameSync as linuxRaceRenameSync,\n`
    ).replace(
      transactionNeedle,
      `): LinuxDirectoryCreateTransactionV1 {\n` +
      `  if (process.env.SEC_PHYSICAL_PARENT_RACE_TARGET === expected.target.path) {\n` +
      `    const displaced = process.env.SEC_PHYSICAL_PARENT_RACE_DISPLACED;\n` +
      `    if (displaced === undefined) throw new Error('Missing deterministic Linux parent displacement.');\n` +
      `    linuxRaceRenameSync(expected.target.path, displaced);\n` +
      `    linuxRaceMkdirSync(expected.target.path);\n` +
      `  }\n` +
      `  const rootFd = linuxOpenRoot(label);\n`
    ).replace(
      ancestorNeedle,
      ancestorNeedle +
      `      if (process.env.SEC_PHYSICAL_ANCESTOR_RACE_TARGET === nextPath) {\n` +
      `        const displaced = process.env.SEC_PHYSICAL_ANCESTOR_RACE_DISPLACED;\n` +
      `        if (displaced === undefined) throw new Error('Missing deterministic Linux ancestor displacement.');\n` +
      `        linuxRaceRenameSync(nextPath, displaced);\n` +
      `        linuxRaceMkdirSync(nextPath);\n` +
      `      }\n`
    ).replace(
      witnessNeedle,
      `    if (process.env.SEC_PHYSICAL_CREATE_RACE_TARGET === input.absolutePath) {\n` +
      `      const displaced = process.env.SEC_PHYSICAL_CREATE_RACE_DISPLACED;\n` +
      `      if (displaced === undefined) throw new Error('Missing deterministic Linux race displacement.');\n` +
      `      linuxRaceRenameSync(input.absolutePath, displaced);\n` +
      `      linuxRaceMkdirSync(input.absolutePath);\n` +
      `    }\n` + witnessNeedle
    );
    const raceModulePath = path.join(mirrorShared, 'physical-no-follow-race.ts');
    writeFileSync(raceModulePath, source, 'utf8');
    writeFileSync(
      path.join(mirrorShared, 'canonical-primitives.ts'),
      readCompilerTypeScriptMutationFixtureSync(
        'platform/shared/canonical-primitives.ts',
        'hostile-mutation'
      ),
      'utf8'
    );
    const racePhysical = await import(`${pathToFileURL(raceModulePath).href}?race=${Date.now()}`);
    const expectRaceRejected = (action: () => unknown): void => {
      try {
        action();
      } catch (error) {
        expect((error as { code?: unknown }).code).toBe('PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED');
        return;
      }
      throw new Error('Expected the deterministic Linux create replacement to fail closed.');
    };

    const exclusiveParentPath = path.join(root, 'exclusive-parent');
    mkdirSync(exclusiveParentPath);
    const exclusiveParent = racePhysical.inspectNoFollowDirectoryChainV1(exclusiveParentPath).target;
    const exclusiveTarget = path.join(exclusiveParentPath, 'child');
    const exclusiveDisplaced = path.join(exclusiveParentPath, 'child-displaced');
    process.env.SEC_PHYSICAL_CREATE_RACE_TARGET = exclusiveTarget;
    process.env.SEC_PHYSICAL_CREATE_RACE_DISPLACED = exclusiveDisplaced;
    expectRaceRejected(() => racePhysical.createExclusiveNoFollowDirectoryV1(exclusiveParent, 'child'));
    expect(lstatSync(exclusiveTarget).isDirectory()).toBe(true);
    expect(lstatSync(exclusiveDisplaced).isDirectory()).toBe(true);

    const chainParentPath = path.join(root, 'chain-parent');
    mkdirSync(chainParentPath);
    const chainParent = racePhysical.inspectNoFollowDirectoryChainV1(chainParentPath).target;
    const chainTarget = path.join(chainParentPath, 'operation-root');
    const chainDisplaced = path.join(chainParentPath, 'operation-root-displaced');
    process.env.SEC_PHYSICAL_CREATE_RACE_TARGET = chainTarget;
    process.env.SEC_PHYSICAL_CREATE_RACE_DISPLACED = chainDisplaced;
    expectRaceRejected(
      () => racePhysical.createNoFollowDirectoryChainV1(chainParent, ['operation-root', 'generation-one'])
    );
    expect(lstatSync(chainTarget).isDirectory()).toBe(true);
    expect(lstatSync(chainDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(chainTarget, 'generation-one'))).toBe(false);
    expect(existsSync(path.join(chainDisplaced, 'generation-one'))).toBe(false);

    delete process.env.SEC_PHYSICAL_CREATE_RACE_TARGET;
    delete process.env.SEC_PHYSICAL_CREATE_RACE_DISPLACED;
    const prewatchExclusiveParent = path.join(root, 'prewatch-exclusive-parent');
    const prewatchExclusiveDisplaced = path.join(root, 'prewatch-exclusive-parent-displaced');
    mkdirSync(prewatchExclusiveParent);
    const prewatchExclusiveIdentity = racePhysical.inspectNoFollowDirectoryChainV1(
      prewatchExclusiveParent
    ).target;
    process.env.SEC_PHYSICAL_PARENT_RACE_TARGET = prewatchExclusiveParent;
    process.env.SEC_PHYSICAL_PARENT_RACE_DISPLACED = prewatchExclusiveDisplaced;
    expectRaceRejected(
      () => racePhysical.createExclusiveNoFollowDirectoryV1(prewatchExclusiveIdentity, 'child')
    );
    expect(lstatSync(prewatchExclusiveParent).isDirectory()).toBe(true);
    expect(lstatSync(prewatchExclusiveDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(prewatchExclusiveParent, 'child'))).toBe(false);
    expect(existsSync(path.join(prewatchExclusiveDisplaced, 'child'))).toBe(false);

    delete process.env.SEC_PHYSICAL_PARENT_RACE_TARGET;
    delete process.env.SEC_PHYSICAL_PARENT_RACE_DISPLACED;
    const ancestorExclusiveScope = path.join(root, 'ancestor-exclusive-scope');
    const ancestorExclusiveParent = path.join(ancestorExclusiveScope, 'run', 'parent');
    const ancestorExclusiveDisplaced = path.join(root, 'ancestor-exclusive-scope-displaced');
    mkdirSync(ancestorExclusiveParent, { recursive: true });
    const ancestorExclusiveIdentity = racePhysical.inspectNoFollowDirectoryChainV1(
      ancestorExclusiveParent
    ).target;
    process.env.SEC_PHYSICAL_ANCESTOR_RACE_TARGET = ancestorExclusiveScope;
    process.env.SEC_PHYSICAL_ANCESTOR_RACE_DISPLACED = ancestorExclusiveDisplaced;
    expectRaceRejected(
      () => racePhysical.createExclusiveNoFollowDirectoryV1(ancestorExclusiveIdentity, 'child')
    );
    expect(lstatSync(ancestorExclusiveScope).isDirectory()).toBe(true);
    expect(lstatSync(ancestorExclusiveDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(ancestorExclusiveScope, 'run', 'parent', 'child'))).toBe(false);
    expect(existsSync(path.join(ancestorExclusiveDisplaced, 'run', 'parent', 'child'))).toBe(false);

    const ancestorChainScope = path.join(root, 'ancestor-chain-scope');
    const ancestorChainParent = path.join(ancestorChainScope, 'run', 'parent');
    const ancestorChainDisplaced = path.join(root, 'ancestor-chain-scope-displaced');
    mkdirSync(ancestorChainParent, { recursive: true });
    const ancestorChainIdentity = racePhysical.inspectNoFollowDirectoryChainV1(ancestorChainParent).target;
    process.env.SEC_PHYSICAL_ANCESTOR_RACE_TARGET = ancestorChainScope;
    process.env.SEC_PHYSICAL_ANCESTOR_RACE_DISPLACED = ancestorChainDisplaced;
    expectRaceRejected(
      () => racePhysical.createNoFollowDirectoryChainV1(
        ancestorChainIdentity,
        ['operation-root', 'generation-one']
      )
    );
    expect(lstatSync(ancestorChainScope).isDirectory()).toBe(true);
    expect(lstatSync(ancestorChainDisplaced).isDirectory()).toBe(true);
    expect(existsSync(path.join(ancestorChainScope, 'run', 'parent', 'operation-root'))).toBe(false);
    expect(existsSync(path.join(ancestorChainDisplaced, 'run', 'parent', 'operation-root'))).toBe(false);
  } finally {
    delete process.env.SEC_PHYSICAL_CREATE_RACE_TARGET;
    delete process.env.SEC_PHYSICAL_CREATE_RACE_DISPLACED;
    delete process.env.SEC_PHYSICAL_PARENT_RACE_TARGET;
    delete process.env.SEC_PHYSICAL_PARENT_RACE_DISPLACED;
    delete process.env.SEC_PHYSICAL_ANCESTOR_RACE_TARGET;
    delete process.env.SEC_PHYSICAL_ANCESTOR_RACE_DISPLACED;
    rmSync(root, { recursive: true, force: true });
  }
});

test('operation directory creation is retained-parent relative and returns exact created identities', () => {
  const root = fixtureRoot();
  try {
    const retained = inspectNoFollowDirectoryChainV1(root, 'directory creation root').target;
    const created = createNoFollowDirectoryChainV1(retained, ['operation-root', 'generation-one']);
    expect(created.path).toBe(path.join(root, 'operation-root', 'generation-one'));
    expect(inspectNoFollowDirectoryChainV1(created.path, 'created directory').target.inode).toBe(created.inode);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ordinary no-follow reader rejects dangling/reparse leaves and a replaced retained parent', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'parent');
    mkdirSync(parentPath);
    writeFileSync(path.join(parentPath, 'ordinary.json'), '{"safe":true}\n', 'utf8');
    symlinkSync(path.join(root, 'missing.json'), path.join(parentPath, 'dangling.json'), 'file');
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'reader parent').target;
    expect(Buffer.from(readNoFollowOrdinaryFileV1(parent, 'ordinary.json')!).toString('utf8')).toBe('{"safe":true}\n');
    expectPhysicalCode(
      () => readNoFollowOrdinaryFileV1(parent, 'dangling.json'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
    const moved = `${parentPath}-moved`;
    renameSync(parentPath, moved);
    mkdirSync(parentPath);
    writeFileSync(path.join(parentPath, 'ordinary.json'), '{"replaced":true}\n', 'utf8');
    expectPhysicalCode(
      () => readNoFollowOrdinaryFileV1(parent, 'ordinary.json'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(readFileSync(path.join(moved, 'ordinary.json'), 'utf8')).toBe('{"safe":true}\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact ordinary leaf observation does not scan unrelated parent entries', () => {
  const root = fixtureRoot();
  try {
    writeFileSync(path.join(root, 'fence.json'), '{"safe":true}\n', 'utf8');
    writeFileSync(path.join(root, 'unrelated-large.bin'), Buffer.alloc(65 * 1024 * 1024));
    const parent = inspectNoFollowDirectoryChainV1(root, 'exact leaf parent').target;

    const entry = inspectNoFollowOrdinaryFileEntryV1(parent, 'fence.json');

    expect(entry?.relativePath).toBe('fence.json');
    expect(entry?.kind).toBe('file');
    expect(entry?.size).toBe(Buffer.byteLength('{"safe":true}\n'));
    expect(Buffer.from(entry?.bytes ?? []).toString('utf8')).toBe('{"safe":true}\n');
    if (process.platform === 'linux') {
      const metadata = lstatSync(path.join(root, 'fence.json'), { bigint: true });
      expect(entry?.device).toBe(String(metadata.dev));
      expect(entry?.inode).toBe(String(metadata.ino));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact ordinary leaf observation enforces the same selected-leaf bound', () => {
  const root = fixtureRoot();
  try {
    writeFileSync(path.join(root, 'oversized-fence.json'), Buffer.alloc(65 * 1024 * 1024));
    const parent = inspectNoFollowDirectoryChainV1(root, 'oversized leaf parent').target;
    expectPhysicalCode(
      () => inspectNoFollowOrdinaryFileEntryV1(parent, 'oversized-fence.json'),
      'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exact ordinary leaf identity follows the retained physical file rather than its name or bytes', () => {
  const root = fixtureRoot();
  try {
    const originalPath = path.join(root, 'original.json');
    const aliasPath = path.join(root, 'alias.json');
    writeFileSync(originalPath, '{"same":true}\n', 'utf8');
    linkSync(originalPath, aliasPath);
    const parent = inspectNoFollowDirectoryChainV1(root, 'identity leaf parent').target;
    const original = inspectNoFollowOrdinaryFileEntryV1(parent, 'original.json');
    const alias = inspectNoFollowOrdinaryFileEntryV1(parent, 'alias.json');
    expect(alias?.device).toBe(original?.device);
    expect(alias?.inode).toBe(original?.inode);
    expect(alias?.size).toBe(original?.size);
    expect(Buffer.from(alias?.bytes ?? [])).toEqual(Buffer.from(original?.bytes ?? []));

    rmSync(aliasPath);
    writeFileSync(aliasPath, '{"same":true}\n', 'utf8');
    const replacement = inspectNoFollowOrdinaryFileEntryV1(parent, 'alias.json');
    expect(`${replacement?.device}:${replacement?.inode}`).not.toBe(`${original?.device}:${original?.inode}`);
    expect(Buffer.from(replacement?.bytes ?? [])).toEqual(Buffer.from(original?.bytes ?? []));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux exact ordinary leaf rejects a FIFO without a blocking open', async () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  const fifoPath = path.join(root, 'retirement-fence.json');
  try {
    const created = Bun.spawnSync({ cmd: ['mkfifo', fifoPath], stdout: 'pipe', stderr: 'pipe' });
    expect(created.exitCode).toBe(0);
    const moduleUrl = new URL('../../platform/shared/physical-no-follow.ts', import.meta.url).href;
    const child = Bun.spawn({
      cmd: [process.execPath, '-e', `
        import { inspectNoFollowDirectoryChainV1, inspectNoFollowOrdinaryFileEntryV1 } from ${JSON.stringify(moduleUrl)};
        const parent = inspectNoFollowDirectoryChainV1(${JSON.stringify(root)}, 'fifo parent').target;
        try {
          inspectNoFollowOrdinaryFileEntryV1(parent, 'retirement-fence.json');
          process.exit(2);
        } catch (error) {
          process.exit(error?.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH' ? 0 : 3);
        }
      `],
      stdout: 'pipe',
      stderr: 'pipe'
    });
    const result = await Promise.race([
      child.exited.then((exitCode) => ({ exitCode, timedOut: false })),
      new Promise<{ exitCode: number; timedOut: true }>((resolve) => setTimeout(() => resolve({ exitCode: -1, timedOut: true }), 3_000))
    ]);
    if (result.timedOut) {
      child.kill('SIGKILL');
      await child.exited;
    }
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 5_000);

test('retained directory relocation makes the original path absent and rejects a substituted tombstone', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'keep.txt'), 'bound-to-target\n', 'utf8');
    const original = inspectNoFollowDirectoryChainV1(target, 'relocation source').target;
    const moved = relocateRetainedNoFollowDirectoryV1({ directory: original, tombstoneName: 'target-tombstone' });
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(path.join(moved.path, 'keep.txt'), 'utf8')).toBe('bound-to-target\n');
    mkdirSync(target);
    expectPhysicalCode(
      () => assertSameNoFollowDirectoryIdentityV1(original, 'rebuilt original path'),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(existsSync(target)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('Linux relocation preserves the retained identity without replacement', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'renameat-target');
    mkdirSync(target);
    const original = inspectNoFollowDirectoryChainV1(target, 'Linux renameat source').target;
    const moved = relocateRetainedNoFollowDirectoryV1({ directory: original, tombstoneName: 'renameat-tombstone' });
    expect(moved.inode).toBe(original.inode);
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tree scan records a child link as an unsafe leaf and never traverses it', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const external = path.join(root, 'external');
    mkdirSync(target);
    mkdirSync(external);
    symlinkSync(external, path.join(target, 'child-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const entries = scanNoFollowDirectoryTreeV1(inspectNoFollowDirectoryChainV1(target, 'scan target').target);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ relativePath: 'child-link', kind: 'link' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'linux')('Linux tree inventory returns exact retained-link targets', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    symlinkSync('../external-target', path.join(target, 'relative-link'), 'file');
    symlinkSync(path.join(root, 'missing-target'), path.join(target, 'absolute-link'), 'file');
    const entries = new Map(scanNoFollowDirectoryTreeInventoryV1(
      inspectNoFollowDirectoryChainV1(target, 'retained link inventory target').target
    ).map((entry) => [entry.relativePath, entry]));
    expect(entries.get('relative-link')).toMatchObject({
      kind: 'link', linkTarget: '../external-target'
    });
    expect(entries.get('absolute-link')).toMatchObject({
      kind: 'link', linkTarget: path.join(root, 'missing-target')
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('streaming tree inventory preserves the canonical digest domain beyond the bounded byte reader', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    const smallBytes = Buffer.from('canonical-small-content\n', 'utf8');
    writeFileSync(path.join(target, 'small.txt'), smallBytes);
    const largePath = path.join(target, 'large.bin');
    const largeSize = 64 * 1024 * 1024 + 4096;
    writeFileSync(largePath, '');
    truncateSync(largePath, largeSize);
    const largeHandle = openSync(largePath, 'r+');
    try {
      writeSync(largeHandle, Buffer.from('large-start'), 0, 11, 0);
      writeSync(largeHandle, Buffer.from('large-end'), 0, 9, largeSize - 9);
    } finally {
      closeSync(largeHandle);
    }
    const identity = inspectNoFollowDirectoryChainV1(target, 'streaming inventory target').target;
    expect(() => scanNoFollowDirectoryTreeV1(identity)).toThrow('exceeds the bounded no-follow read size');
    const first = new Map(scanNoFollowDirectoryTreeInventoryV1(identity).map((entry) => [entry.relativePath, entry]));
    const second = new Map(scanNoFollowDirectoryTreeInventoryV1(identity).map((entry) => [entry.relativePath, entry]));
    expect(first.get('small.txt')?.contentDigest).toBe(
      sha256({ bytes: smallBytes.toString('hex') }) as `sha256:${string}`
    );
    expect(first.get('large.bin')).toMatchObject({ kind: 'file', size: largeSize });
    expect(first.get('large.bin')?.contentDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(second.get('large.bin')?.contentDigest).toBe(first.get('large.bin')?.contentDigest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('metadata inventory does not read sparse file bytes and enforces entry and deadline bounds', () => {
  if (process.platform !== 'win32' && process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    const sparse = path.join(target, 'large-sparse.bin');
    const second = path.join(target, 'second.txt');
    closeSync(openSync(sparse, 'w'));
    truncateSync(sparse, 512 * 1024 * 1024);
    writeFileSync(second, 'small');
    const identity = inspectNoFollowDirectoryChainV1(target, 'metadata target').target;

    const startedAt = performance.now();
    const inventory = new Map(scanNoFollowDirectoryTreeMetadataV1(identity, {
      deadlineAtMs: startedAt + 2_000,
      maximumEntries: 2
    }).map((entry) => [entry.relativePath, entry]));
    expect(inventory.get('large-sparse.bin')).toMatchObject({
      kind: 'file',
      size: 512 * 1024 * 1024,
      contentDigest: null
    });
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expectPhysicalCode(
      () => scanNoFollowDirectoryTreeMetadataV1(identity, {
        deadlineAtMs: performance.now() + 2_000,
        maximumEntries: 1
      }),
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
    );
    expectPhysicalCode(
      () => scanNoFollowDirectoryTreeMetadataV1(identity, {
        deadlineAtMs: performance.now() - 1,
        maximumEntries: 10
      }),
      'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('exclusive durable canonical publication is idempotent and refuses a conflicting existing value', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'durable');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'durable parent').target;
    const bytes = Buffer.from('{"schema":"test-v1"}\n', 'utf8');
    const validate = (value: Uint8Array): void => {
      const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as { schema?: unknown };
      if (parsed.schema !== 'test-v1') throw new Error('invalid test canonical bytes');
    };
    const publish = () => publishExclusiveDurableCanonicalFileV1({ parent, name: 'authorization.json', bytes, validate });
    const first = publish();
    expect(first.created).toBe(true);
    expect(readFileSync(first.path)).toEqual(bytes);
    const second = publishExclusiveDurableCanonicalFileV1({ parent, name: 'authorization.json', bytes, validate });
    expect(second).toEqual({ ...first, created: false });
    expectPhysicalCode(
      () => publishExclusiveDurableCanonicalFileV1({
        parent,
        name: 'authorization.json',
        bytes: Buffer.from('{"schema":"different"}\n', 'utf8'),
        validate: () => undefined
      }),
      'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'
    );
    expect(existsSync(path.join(parentPath, '.authorization.json.candidate'))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable canonical replacement uses retained-parent publication and exact final readback', () => {
  const root = fixtureRoot();
  try {
    const parentPath = path.join(root, 'replacement');
    mkdirSync(parentPath);
    const parent = inspectNoFollowDirectoryChainV1(parentPath, 'replacement parent').target;
    const validate = (value: Uint8Array): void => {
      if (!JSON.parse(Buffer.from(value).toString('utf8')).schema) throw new Error('invalid replacement bytes');
    };
    const first = Buffer.from('{"schema":"one"}\n', 'utf8');
    const second = Buffer.from('{"schema":"two"}\n', 'utf8');
    replaceDurableCanonicalFileV1({ parent, name: 'latest.json', bytes: first, validate });
    const replaced = replaceDurableCanonicalFileV1({ parent, name: 'latest.json', bytes: second, validate });
    expect(readFileSync(replaced.path)).toEqual(second);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Windows retained-handle deletion removes authorized file directory and reparse leaf and rejects a replaced parent', () => {
  if (process.platform !== 'win32') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const external = path.join(root, 'external');
    mkdirSync(target);
    mkdirSync(external);
    const authorizedFile = path.join(target, 'authorized-file.txt');
    const survivingReadonlyLink = path.join(external, 'surviving-readonly-link.txt');
    writeFileSync(authorizedFile, 'only-this-file\n', 'utf8');
    linkSync(authorizedFile, survivingReadonlyLink);
    chmodSync(authorizedFile, 0o444);
    expect(lstatSync(survivingReadonlyLink).mode & 0o222).toBe(0);
    mkdirSync(path.join(target, 'authorized-directory'));
    symlinkSync(external, path.join(target, 'authorized-link'), 'junction');
    const identity = inspectNoFollowDirectoryChainV1(target, 'retained target').target;
    const entries = new Map(scanNoFollowDirectoryTreeV1(identity).map((entry) => [entry.relativePath, entry]));
    for (const name of ['authorized-file.txt', 'authorized-directory', 'authorized-link']) {
      const entry = entries.get(name)!;
      deleteRetainedNoFollowEntryV1({
        root: identity,
        relativePath: entry.relativePath,
        kind: entry.kind,
        device: entry.device,
        inode: entry.inode,
        ancestorDirectories: []
      });
      expect(existsSync(path.join(target, name))).toBe(false);
    }
    expect(readFileSync(survivingReadonlyLink, 'utf8')).toBe('only-this-file\n');
    expect(lstatSync(survivingReadonlyLink).mode & 0o222).toBe(0);
    mkdirSync(path.join(target, 'replacement-parent'));
    writeFileSync(path.join(target, 'replacement-parent', 'retain.txt'), 'old\n', 'utf8');
    const original = inspectNoFollowDirectoryChainV1(path.join(target, 'replacement-parent'), 'original parent').target;
    const old = `${original.path}-old`;
    renameSync(original.path, old);
    mkdirSync(original.path);
    expectPhysicalCode(
      () => deleteRetainedNoFollowEntryV1({
        root: original,
        relativePath: 'retain.txt',
        kind: 'file',
        device: 'not-used-after-root-fence',
        inode: 'not-used-after-root-fence',
        ancestorDirectories: []
      }),
      'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
    );
    expect(readFileSync(path.join(old, 'retain.txt'), 'utf8')).toBe('old\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux retained openat leaf deletion covers an ordinary file directory and dangling link', () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'authorized-file.txt'), 'only-this-file\n', 'utf8');
    mkdirSync(path.join(target, 'authorized-directory'));
    symlinkSync(path.join(root, 'does-not-exist'), path.join(target, 'authorized-link'), 'file');
    const identity = inspectNoFollowDirectoryChainV1(target, 'retained target').target;
    const entries = new Map(scanNoFollowDirectoryTreeV1(identity).map((entry) => [entry.relativePath, entry]));
    for (const name of ['authorized-file.txt', 'authorized-directory', 'authorized-link']) {
      const entry = entries.get(name)!;
      deleteRetainedNoFollowEntryV1({
        root: identity,
        relativePath: entry.relativePath,
        kind: entry.kind,
        device: entry.device,
        inode: entry.inode,
        ancestorDirectories: []
      });
      expect(existsSync(path.join(target, name))).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('retained deletion rejects a replaced inventoried ancestor before touching a hard-linked leaf', () => {
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    const parent = path.join(target, 'parent');
    mkdirSync(parent, { recursive: true });
    writeFileSync(path.join(parent, 'leaf.txt'), 'authorized inode\n', 'utf8');
    const targetIdentity = inspectNoFollowDirectoryChainV1(target, 'ancestor target').target;
    const inventory = new Map(scanNoFollowDirectoryTreeV1(targetIdentity).map((entry) => [entry.relativePath, entry]));
    const authorizedParent = inventory.get('parent')!;
    const authorizedLeaf = inventory.get('parent/leaf.txt')!;
    const retainedParent = `${parent}-retained`;
    renameSync(parent, retainedParent);
    mkdirSync(parent);
    linkSync(path.join(retainedParent, 'leaf.txt'), path.join(parent, 'leaf.txt'));
    expectPhysicalCode(() => deleteRetainedNoFollowEntryV1({
      root: targetIdentity,
      relativePath: 'parent/leaf.txt',
      kind: 'file',
      device: authorizedLeaf.device,
      inode: authorizedLeaf.inode,
      ancestorDirectories: [{ relativePath: 'parent', device: authorizedParent.device, inode: authorizedParent.inode }]
    }), 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED');
    expect(readFileSync(path.join(retainedParent, 'leaf.txt'), 'utf8')).toBe('authorized inode\n');
    expect(readFileSync(path.join(parent, 'leaf.txt'), 'utf8')).toBe('authorized inode\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Linux retained deletion accepts selected-name absence when another hard link survives', () => {
  if (process.platform !== 'linux') return;
  const root = fixtureRoot();
  try {
    const target = path.join(root, 'target');
    mkdirSync(target);
    writeFileSync(path.join(target, 'selected.txt'), 'shared inode\n', 'utf8');
    linkSync(path.join(target, 'selected.txt'), path.join(root, 'surviving-link.txt'));
    const identity = inspectNoFollowDirectoryChainV1(target, 'hard-link target').target;
    const selected = scanNoFollowDirectoryTreeV1(identity).find((entry) => entry.relativePath === 'selected.txt')!;
    deleteRetainedNoFollowEntryV1({
      root: identity,
      relativePath: selected.relativePath,
      kind: 'file',
      device: selected.device,
      inode: selected.inode,
      ancestorDirectories: []
    });
    expect(existsSync(path.join(target, 'selected.txt'))).toBe(false);
    expect(readFileSync(path.join(root, 'surviving-link.txt'), 'utf8')).toBe('shared inode\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
