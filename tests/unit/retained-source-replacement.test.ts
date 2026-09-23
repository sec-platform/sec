import { expect, test } from 'bun:test';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSemanticMutationSource } from '../../src/adapters/mutation/source-path-boundary.ts';
import { applySemanticMutationWindowsFileAttributes, readSemanticMutationWindowsFileAttributes } from '../../src/adapters/mutation/windows-file-attributes.ts';
import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertNoSourceReplacementResidue,
  createSourceReplacementTestActorForTests,
  replaceRetainedNoFollowSourceFile,
  settleRetainedNoFollowSourceReplacementResidue,
  SourceReplacementFailure,
  type SourceReplacementTestActor
} from '../../src/adapters/runtime-state/physical/runtime/retained-source-replacement.ts';

const supported = process.platform === 'linux' || process.platform === 'win32';
const original = Buffer.from('state: original\n');
const successor = Buffer.from('state: successor\n');

async function fixture(run: (value: {
  root: string;
  sourceRoot: string;
  targetRoot: string;
  target: string;
  replace: (actor?: SourceReplacementTestActor, options?: Partial<Parameters<typeof replaceRetainedNoFollowSourceFile>[0]>) => Promise<void>;
}) => Promise<void>): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-replacement-'));
  const sourceRoot = path.join(root, 'transaction');
  const targetRoot = path.join(root, 'author');
  const target = path.join(targetRoot, 'model.yaml');
  mkdirSync(sourceRoot); mkdirSync(targetRoot); writeFileSync(target, original);
  const sourceParent = inspectNoFollowDirectoryChain(sourceRoot).target;
  const targetParent = inspectNoFollowDirectoryChain(targetRoot).target;
  try {
    await run({
      root, sourceRoot, targetRoot, target,
      replace: async (testOnlyActor, options = {}) => {
        const attributes = await readSemanticMutationWindowsFileAttributes(target);
        const expectedWindowsAttributes = attributes === null ? null :
          (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
          (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);
        await replaceRetainedNoFollowSourceFile({
          sourceParent, targetParent, targetName: 'model.yaml', expectedBytes: original,
          bytes: successor, expectedMode: statSync(target).mode & 0o7777,
          expectedWindowsAttributes, direction: 'publish', commitFence: async () => {},
          testOnlyActor, ...options
        });
      }
    });
  } finally {
    if (process.platform === 'win32' && existsSync(target)) {
      await applySemanticMutationWindowsFileAttributes(target, {
        readOnly: false, hidden: false, system: false, archive: false
      });
    }
    rmSync(root, { recursive: true, force: true });
  }
}

test.skipIf(!supported)('retained replacement publishes and restores exact bytes without temporary residue', async () => {
  await fixture(async ({ target, sourceRoot, replace }) => {
    const initial = statSync(target, { bigint: true }).ino;
    await replace();
    expect(readFileSync(target)).toEqual(successor);
    expect(statSync(target, { bigint: true }).ino).not.toBe(initial);
    expect(readdirSync(sourceRoot)).toEqual([]);
    await replace(undefined, { expectedBytes: successor, bytes: original, direction: 'restore' });
    expect(readFileSync(target)).toEqual(original);
    expect(readdirSync(sourceRoot)).toEqual([]);
  });
});

test.skipIf(process.platform !== 'linux')('retained replacement preserves readonly POSIX permissions on its new inode', async () => {
  await fixture(async ({ target, replace }) => {
    chmodSync(target, 0o444);
    await replace();
    expect(statSync(target).mode & 0o7777).toBe(0o444);
    expect(readFileSync(target)).toEqual(successor);
  });
});

test.skipIf(process.platform !== 'win32')('retained replacement preserves all four Windows attributes and flushes after readonly', async () => {
  await fixture(async ({ target, sourceRoot, replace }) => {
    const attributes = { readOnly: true, hidden: true, system: true, archive: true };
    await applySemanticMutationWindowsFileAttributes(target, attributes);
    await replace();
    expect(readFileSync(target)).toEqual(successor);
    expect(await readSemanticMutationWindowsFileAttributes(target)).toEqual(attributes);
    expect(readdirSync(sourceRoot)).toEqual([]);
  });
});

test.skipIf(!supported)('replacement rejects foreign actors and wrong byte preimages before publication', async () => {
  await fixture(async ({ target, sourceRoot, replace }) => {
    await expect(replace({})).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_CAPABILITY_UNAVAILABLE' });
    await expect(replace(undefined, { expectedBytes: Buffer.from('wrong\n') })).rejects.toMatchObject({ namespaceChanged: false });
    expect(readFileSync(target)).toEqual(original);
    expect(readdirSync(sourceRoot)).toEqual([]);
  });
});

test.skipIf(!supported)('replacement snapshots caller byte buffers before the first awaited fence', async () => {
  await fixture(async ({ target, replace }) => {
    const mutable = Buffer.from(successor);
    await replace(undefined, {
      bytes: mutable,
      commitFence: async () => { mutable.fill(0); await Promise.resolve(); }
    });
    expect(readFileSync(target)).toEqual(successor);
  });
});

test.skipIf(!supported)('pre-effect interruption retires only the created candidate and preserves the cause', async () => {
  await fixture(async ({ target, sourceRoot, replace }) => {
    const injected = Object.assign(new Error('fixture interruption'), { code: 'EACCES' });
    await expect(replace(createSourceReplacementTestActorForTests({ beforeReplace: () => { throw injected; } })))
      .rejects.toMatchObject({ namespaceChanged: false, phase: 'atomic-replace', cause: injected });
    expect(readFileSync(target)).toEqual(original);
    expect(readdirSync(sourceRoot)).toEqual([]);
  });
});

test.skipIf(process.platform !== 'linux')('a replaced target inode is preserved rather than overwritten', async () => {
  await fixture(async ({ target, sourceRoot, replace }) => {
    await expect(replace(createSourceReplacementTestActorForTests({
      beforeReplace: () => { renameSync(target, `${target}.displaced`); writeFileSync(target, 'foreign\n'); }
    }))).rejects.toMatchObject({ namespaceChanged: false });
    expect(readFileSync(target, 'utf8')).toBe('foreign\n');
    expect(readFileSync(`${target}.displaced`)).toEqual(original);
    expect(readdirSync(sourceRoot)).toEqual([]);
  });
});

test.skipIf(process.platform !== 'linux')('candidate substitution cannot redirect writes or authorize cleanup of a foreign link', async () => {
  await fixture(async ({ root, target, replace }) => {
    const outside = path.join(root, 'outside'); writeFileSync(outside, 'untouched\n');
    let substituted = '';
    await expect(replace(createSourceReplacementTestActorForTests({
      beforeReplace: ({ sourcePath }) => {
        substituted = sourcePath;
        renameSync(sourcePath, `${sourcePath}.saved`);
        symlinkSync(outside, sourcePath);
      }
    }))).rejects.toBeInstanceOf(SourceReplacementFailure);
    expect(readFileSync(outside, 'utf8')).toBe('untouched\n');
    expect(readFileSync(target)).toEqual(original);
    expect(existsSync(substituted)).toBe(true);
  });
});

test.skipIf(process.platform !== 'linux')('post-exchange interruption preserves both generations for recovery', async () => {
  await fixture(async ({ target, replace }) => {
    let displaced = '';
    await expect(replace(createSourceReplacementTestActorForTests({
      afterReplace: ({ sourcePath }) => { displaced = sourcePath; throw new Error('interrupted after exchange'); }
    }))).rejects.toMatchObject({ namespaceChanged: true });
    expect(readFileSync(target)).toEqual(successor);
    expect(readFileSync(displaced)).toEqual(original);
  });
});

test.skipIf(process.platform !== 'linux')('cleanup refuses a substituted displaced-preimage name', async () => {
  await fixture(async ({ target, replace }) => {
    let foreign = '';
    await expect(replace(createSourceReplacementTestActorForTests({
      beforeCleanup: ({ sourcePath }) => {
        foreign = sourcePath; renameSync(sourcePath, `${sourcePath}.saved`);
        writeFileSync(sourcePath, 'foreign cleanup slot\n');
      }
    }))).rejects.toMatchObject({ namespaceChanged: true });
    expect(readFileSync(target)).toEqual(successor);
    expect(readFileSync(foreign, 'utf8')).toBe('foreign cleanup slot\n');
    expect(readFileSync(`${foreign}.saved`)).toEqual(original);
  });
});

test.skipIf(process.platform !== 'linux')('retained replacement refuses hard-linked preimages', async () => {
  await fixture(async ({ target, root, replace }) => {
    const alias = path.join(root, 'alias'); linkSync(target, alias);
    await expect(replace()).rejects.toMatchObject({ namespaceChanged: false });
    expect(readFileSync(target)).toEqual(original);
    expect(readFileSync(alias)).toEqual(original);
  });
});


test.skipIf(process.platform !== 'linux')('an interrupted exchange blocks byte-only readback and a second replacement', async () => {
  await fixture(async ({ root, target, sourceRoot, replace }) => {
    let retainedPreimage = '';
    await expect(replace(createSourceReplacementTestActorForTests({
      afterReplace: ({ sourcePath }) => { retainedPreimage = sourcePath; throw new Error('crash boundary'); }
    }))).rejects.toMatchObject({ namespaceChanged: true });
    expect(readFileSync(target)).toEqual(successor);
    await expect(readSemanticMutationSource(root, sourceRoot, 'author/model.yaml')).rejects.toMatchObject({
      diagnostic: { code: 'SEMANTIC-MUTATION-012', details: { errorCode: 'SOURCE_REPLACEMENT_UNSETTLED' } }
    });
    await expect(replace(undefined, { expectedBytes: successor, bytes: original, direction: 'restore' }))
      .rejects.toMatchObject({ namespaceChanged: false });
    expect(readFileSync(target)).toEqual(successor);
    expect(readFileSync(retainedPreimage)).toEqual(original);
    expect(readdirSync(sourceRoot)).toHaveLength(1);
  });
});

test.skipIf(process.platform !== 'linux')('unexplained legacy and link slots are blockers, not deletion authority', async () => {
  await fixture(async ({ target, sourceRoot, replace }) => {
    const residue = path.join(sourceRoot, '.restore-legacy.tmp');
    symlinkSync('/nonexistent-source-replacement-fixture', residue);
    const identity = inspectNoFollowDirectoryChain(sourceRoot).target;
    expect(() => assertNoSourceReplacementResidue(identity)).toThrow('unsettled physical residue');
    await expect(replace()).rejects.toMatchObject({ namespaceChanged: false });
    expect(readFileSync(target)).toEqual(original);
    expect(readdirSync(sourceRoot)).toEqual(['.restore-legacy.tmp']);
  });
});

test.skipIf(process.platform !== 'linux')('a target-parent substitution cannot redirect a retained replacement', async () => {
  await fixture(async ({ targetRoot, target, sourceRoot, replace }) => {
    await expect(replace(createSourceReplacementTestActorForTests({
      beforeReplace: () => {
        renameSync(targetRoot, `${targetRoot}.saved`);
        mkdirSync(targetRoot);
        writeFileSync(target, 'foreign parent generation\n');
      }
    }))).rejects.toMatchObject({ namespaceChanged: false });
    expect(readFileSync(target, 'utf8')).toBe('foreign parent generation\n');
    expect(readFileSync(path.join(`${targetRoot}.saved`, 'model.yaml'))).toEqual(original);
    // Losing the authority fence preserves the candidate for explicit recovery.
    expect(readdirSync(sourceRoot)).toHaveLength(1);
  });
});

test.skipIf(process.platform !== 'win32')('Windows residue admission recognizes case-insensitive native slot aliases', async () => {
  await fixture(async ({ sourceRoot, replace }) => {
    writeFileSync(path.join(sourceRoot, '.PUBLISH-legacy.tmp'), 'unsettled');
    await expect(replace()).rejects.toMatchObject({ namespaceChanged: false });
    expect(readdirSync(sourceRoot)).toEqual(['.PUBLISH-legacy.tmp']);
  });
});


test.skipIf(!supported)(
  'identity-bound recovery settles only the exact original/staged residue pair',
  async () => {
    await fixture(async ({ target, sourceRoot, targetRoot, replace }) => {
      await expect(replace(createSourceReplacementTestActorForTests({
        afterReplace: () => { throw new Error('crash after namespace transition'); }
      }))).rejects.toMatchObject({ namespaceChanged: true });

      const sourceParent = inspectNoFollowDirectoryChain(sourceRoot).target;
      const targetParent = inspectNoFollowDirectoryChain(targetRoot).target;
      const attributes = await readSemanticMutationWindowsFileAttributes(target);
      const expectedWindowsAttributes = attributes === null ? null :
        (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
        (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);

      const settled = await settleRetainedNoFollowSourceReplacementResidue({
        sourceParent,
        targetParent,
        targetName: 'model.yaml',
        originalBytes: original,
        stagedBytes: successor,
        expectedMode: statSync(target).mode & 0o7777,
        expectedWindowsAttributes,
        commitFence: async () => {}
      });
      expect(settled).toEqual(process.platform === 'win32'
        ? { status: 'clean' }
        : { status: 'settled', liveGeneration: 'staged' });
      expect(readFileSync(target)).toEqual(successor);
      expect(readdirSync(sourceRoot)).toEqual([]);
    });
  }
);

test.skipIf(!supported)(
  'identity-bound recovery preserves foreign and ambiguous residue',
  async () => {
    await fixture(async ({ target, sourceRoot, targetRoot }) => {
      const sourceParent = inspectNoFollowDirectoryChain(sourceRoot).target;
      const targetParent = inspectNoFollowDirectoryChain(targetRoot).target;
      const attributes = await readSemanticMutationWindowsFileAttributes(target);
      const expectedWindowsAttributes = attributes === null ? null :
        (attributes.readOnly ? 1 : 0) | (attributes.hidden ? 2 : 0) |
        (attributes.system ? 4 : 0) | (attributes.archive ? 32 : 0);

      const foreign = path.join(
        sourceRoot,
        '.publish-11111111-1111-4111-8111-111111111111.tmp'
      );
      writeFileSync(foreign, 'foreign\n');
      await expect(settleRetainedNoFollowSourceReplacementResidue({
        sourceParent,
        targetParent,
        targetName: 'model.yaml',
        originalBytes: original,
        stagedBytes: successor,
        expectedMode: statSync(target).mode & 0o7777,
        expectedWindowsAttributes,
        commitFence: async () => {}
      })).rejects.toThrow('unsettled physical residue');
      expect(readFileSync(foreign, 'utf8')).toBe('foreign\n');
      expect(readFileSync(target)).toEqual(original);
    });
  }
);
