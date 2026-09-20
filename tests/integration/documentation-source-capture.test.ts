import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest } from '../../src/contracts/canonical.ts';
import {
  DOCUMENTATION_BASELINE, DOCUMENTATION_LIMITS, DOCUMENTATION_NON_SOURCE,
  DOCUMENTATION_SOURCE_MANIFEST, documentationSourceDigest
} from '../../src/contracts/documentation-source.ts';
import { readDocumentationSource } from '../../src/adapters/release/documentation-source.ts';

async function withSource(action: (root: string, sourceDigest: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sec-documentation-capture-'));
  try {
    const root = await fs.realpath(directory);
    await fs.mkdir(path.join(root, '.documentation'));
    await fs.mkdir(path.join(root, 'docs'));
    const baseline = Buffer.from(JSON.stringify({
      schema: 'sec.documentation-baseline/2', source_root: '..',
      source_roots: ['.documentation', 'docs'], source_manifest: 'source-manifest.json',
      audited_namespaces: ['docs'], non_documentation_roots: [],
      excluded_from_source_hash: DOCUMENTATION_NON_SOURCE,
      entry: '../docs/main.md', delivery_number: 'fixture', archive_name: 'fixture.zip',
      scope: 'Byte identity only', authority_limit: 'Not approval'
    }));
    const text = Buffer.from('# Captured source\n');
    const members = [
      { path: DOCUMENTATION_BASELINE, bytes: baseline.length, sha256: digest(baseline) },
      { path: 'docs/main.md', bytes: text.length, sha256: digest(text) }
    ];
    const sourceDigest = documentationSourceDigest(members);
    await fs.writeFile(path.join(root, DOCUMENTATION_BASELINE), baseline);
    await fs.writeFile(path.join(root, 'docs/main.md'), text);
    await fs.writeFile(path.join(root, DOCUMENTATION_SOURCE_MANIFEST), JSON.stringify({
      schema: 'sec.documentation-source-manifest/2', source_set_sha256: sourceDigest, members
    }));
    await action(root, sourceDigest);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test.serial('ordinary documentation capture keeps the declared byte identity', async () => {
  await withSource(async (root, sourceDigest) => {
    const result = await readDocumentationSource(root);
    expect(result.sourceSetSha256).toBe(sourceDigest);
    expect(result.members.map(member => member.path)).toEqual([DOCUMENTATION_BASELINE, 'docs/main.md']);
  });
});

for (const invalid of [
  { name: 'non-regular opened object', isFile: false, size: 0 },
  { name: 'oversized opened object', isFile: true, size: DOCUMENTATION_LIMITS.fileBytes + 1 }
]) {
  test.serial(`capture rejects ${invalid.name} before reading and settles its handle`, async () => {
    await withSource(async root => {
      const target = path.join(root, DOCUMENTATION_BASELINE);
      const nativeOpen = fs.open.bind(fs);
      let reads = 0;
      let closes = 0;
      const open = spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
        if (args[0] !== target) return nativeOpen(...args);
        return {
          stat: async () => ({ isFile: () => invalid.isFile, size: invalid.size }),
          read: async () => { reads += 1; throw new Error('Rejected handle must not be read'); },
          close: async () => { closes += 1; }
        } as unknown as Awaited<ReturnType<typeof fs.open>>;
      });
      try {
        await expect(readDocumentationSource(root)).rejects.toThrow('Invalid documentation file');
        expect(reads).toBe(0);
        expect(closes).toBe(1);
      } finally {
        open.mockRestore();
      }
    });
  });
}

test.serial('a same-byte replacement handle is not the checked pathname object', async () => {
  await withSource(async root => {
    const target = path.join(root, DOCUMENTATION_BASELINE);
    const replacement = path.join(root, 'replacement.json');
    await fs.writeFile(replacement, await fs.readFile(target));
    const nativeOpen = fs.open.bind(fs);
    const open = spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      return args[0] === target ? nativeOpen(replacement, args[1], args[2]) : nativeOpen(...args);
    });
    try {
      await expect(readDocumentationSource(root)).rejects.toThrow('changed before capture');
    } finally {
      open.mockRestore();
    }
  });
});
