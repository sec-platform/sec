import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertDocumentationSourceReadback, materializeDocumentationPackage, readDocumentationSource } from '../../src/adapters/release/documentation-source.ts';
import { digest } from '../../src/contracts/canonical.ts';
import {
  DOCUMENTATION_BASELINE,
  DOCUMENTATION_FIGURES,
  DOCUMENTATION_LIMITS, DOCUMENTATION_NON_SOURCE,
  DOCUMENTATION_REQUIREMENTS,
  DOCUMENTATION_SOURCE_MANIFEST,
  documentationSourceDigest
} from '../../src/contracts/documentation-source.ts';
import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';

async function withSource(action: (root: string, sourceDigest: string) => Promise<void>, sourceRoots = ['.documentation', 'docs']): Promise<void> {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'sec-documentation-capture-'));
  try {
    const root = await fs.realpath(directory);
    await fs.mkdir(path.join(root, '.documentation'));
    await fs.mkdir(path.join(root, 'docs'));
    const baseline = Buffer.from(JSON.stringify({
      schema: 'sec.documentation-baseline/2', source_root: '..',
      source_roots: sourceRoots, source_manifest: 'source-manifest.json',
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

test.serial('capture rejects undeclared namespace members without changing the declared boundary', async () => {
  await withSource(async root => {
    await fs.writeFile(path.join(root, 'docs/undeclared.md'), '# Undeclared source\n');
    await expect(readDocumentationSource(root)).rejects.toThrow('Undeclared documentation namespace member');
  }, ['.documentation', 'docs/main.md']);
});

test.serial('capture rejects changed source bytes with an unchanged manifest', async () => {
  await withSource(async root => {
    await fs.writeFile(path.join(root, 'docs/main.md'), '# Changed source\n');
    await expect(readDocumentationSource(root)).rejects.toThrow('Documentation source member differs from its manifest: docs/main.md');
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

test.serial('capture preserves declared byte identity while streaming source and audit directories', async () => {
  await withSource(async (root, sourceDigest) => {
    const readdir = spyOn(fs, 'readdir').mockImplementation(async () => {
      throw new Error('Whole-directory materialization is not admitted');
    });
    try {
      const result = await readDocumentationSource(root);
      expect(result.sourceSetSha256).toBe(sourceDigest);
      expect(result.members.map(member => member.path)).toEqual([DOCUMENTATION_BASELINE, 'docs/main.md']);
    } finally {
      readdir.mockRestore();
    }
  });
});

for (const failClose of [false, true]) {
  test.serial(`directory read failure preserves its cause and closes (close failure: ${failClose})`, async () => {
    await withSource(async root => {
      const nativeOpen = fs.opendir.bind(fs);
      const readFailure = new Error('directory read failed');
      const closeFailure = new Error('directory close failed');
      let closes = 0;
      const open = spyOn(fs, 'opendir').mockImplementation(async (...args: Parameters<typeof fs.opendir>) => {
        if (args[0] !== path.join(root, 'docs')) return nativeOpen(...args);
        return {
          read: async () => { throw readFailure; },
          close: async () => { closes += 1; if (failClose) throw closeFailure; }
        } as unknown as Awaited<ReturnType<typeof fs.opendir>>;
      });
      try {
        const outcome = await readDocumentationSource(root).then(
          () => ({ ok: true as const }), error => ({ ok: false as const, error })
        );
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('Capture unexpectedly succeeded');
        if (failClose) {
          expect(outcome.error).toBeInstanceOf(ResourceCompositeSettlementError);
          expect((outcome.error as ResourceCompositeSettlementError).failures).toEqual([
            { label: 'documentation directory traversal', error: readFailure },
            { label: 'documentation directory handle', error: closeFailure }
          ]);
        } else expect(outcome.error).toBe(readFailure);
        expect(closes).toBe(1);
      } finally {
        open.mockRestore();
      }
    });
  });
}

test.serial('directory fan-out is rejected while enqueuing, not after an unbounded read', async () => {
  await withSource(async root => {
    const nativeOpen = fs.opendir.bind(fs);
    let reads = 0;
    let closes = 0;
    const open = spyOn(fs, 'opendir').mockImplementation(async (...args: Parameters<typeof fs.opendir>) => {
      if (args[0] !== path.join(root, 'docs')) return nativeOpen(...args);
      return {
        read: async () => {
          if (++reads > DOCUMENTATION_LIMITS.members + 1) throw new Error('Missing admission bound');
          return { name: `member-${reads}.md` };
        },
        close: async () => { closes += 1; }
      } as unknown as Awaited<ReturnType<typeof fs.opendir>>;
    });
    try {
      await expect(readDocumentationSource(root)).rejects.toThrow('traversal budget exceeded');
      expect(reads).toBeLessThanOrEqual(DOCUMENTATION_LIMITS.members);
      expect(closes).toBe(1);
    } finally {
      open.mockRestore();
    }
  });
});

test.serial('nonempty staging is rejected before copying source files', async () => {
  await withSource(async root => {
    const target = path.join(root, 'staging');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'unexpected'), 'preserve this file');
    await expect(materializeDocumentationPackage(root, target)).rejects.toThrow('staging root must be empty');
    expect(await fs.readdir(target)).toEqual(['unexpected']);
    expect(await fs.readFile(path.join(target, 'unexpected'), 'utf8')).toBe('preserve this file');
  });
});

test.serial('an absent selected attachment never hides a missing source ancestor before writes', async () => {
  await withSource(async root => {
    const target = path.join(root, 'staging');
    await fs.mkdir(target);
    const nativeStat = fs.lstat.bind(fs);
    const missingParent = Object.assign(new Error('source metadata parent disappeared'), { code: 'ENOENT' });
    let parentMissing = false;
    const lstat = spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      if (args[0] === path.join(root, DOCUMENTATION_FIGURES)) {
        parentMissing = true;
        throw Object.assign(new Error('optional output lookup failed'), { code: 'ENOENT' });
      }
      if (parentMissing && args[0] === path.join(root, '.documentation')) throw missingParent;
      return nativeStat(...args);
    }) as typeof fs.lstat);
    const write = spyOn(fs, 'writeFile');
    try {
      await expect(materializeDocumentationPackage(root, target)).rejects.toBe(missingParent);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      lstat.mockRestore();
    }
  });
});

for (const localOutputs of ['absent', 'corrupt'] as const) {
  test.serial(`materialization derives sealed outputs from source with ${localOutputs} local projections`, async () => {
    await withSource(async root => {
      const requirementPath = 'docs/产品/产品要求与工作约束.md';
      await fs.mkdir(path.join(root, 'docs/产品'));
      await fs.writeFile(path.join(root, requirementPath), '<a id="req001"></a>\n\n### REQ001｜Fixture\n\nRequired behavior.\n');
      if (localOutputs === 'absent') await fs.unlink(path.join(root, DOCUMENTATION_SOURCE_MANIFEST));
      else {
        await fs.writeFile(path.join(root, DOCUMENTATION_SOURCE_MANIFEST), Buffer.from([0xff]));
        await fs.writeFile(path.join(root, DOCUMENTATION_REQUIREMENTS), 'not JSON');
      }
      const target = path.join(root, 'staging');
      await fs.mkdir(target);
      const contract = await materializeDocumentationPackage(root, target);
      expect((await readDocumentationSource(target)).sourceSetSha256).toBe(contract.sourceSetSha256);
      const requirements = JSON.parse(await fs.readFile(path.join(target, DOCUMENTATION_REQUIREMENTS), 'utf8'));
      expect(requirements.items).toHaveLength(1);
      expect(requirements.items[0]).toEqual({
        id: 'REQ001', path: requirementPath, fragment: 'req001',
        body_sha256: digest('### REQ001｜Fixture\n\nRequired behavior.')
      });
      const files = [...contract.members, { path: DOCUMENTATION_SOURCE_MANIFEST }, { path: DOCUMENTATION_REQUIREMENTS }];
      await assertDocumentationSourceReadback(target, `sha256:${contract.sourceSetSha256}`, files);
      await fs.writeFile(path.join(target, DOCUMENTATION_REQUIREMENTS), JSON.stringify({ ...requirements, items: [] }));
      await expect(assertDocumentationSourceReadback(target, `sha256:${contract.sourceSetSha256}`, files))
        .rejects.toThrow('Requirement projection is stale or malformed');
      await fs.unlink(path.join(target, DOCUMENTATION_REQUIREMENTS));
      await expect(assertDocumentationSourceReadback(target, `sha256:${contract.sourceSetSha256}`, files))
        .rejects.toThrow('Requirement projection is stale or malformed');
      await fs.unlink(path.join(target, DOCUMENTATION_SOURCE_MANIFEST));
      await expect(readDocumentationSource(target)).rejects.toThrow();
      if (localOutputs === 'absent') {
        await expect(fs.lstat(path.join(root, DOCUMENTATION_SOURCE_MANIFEST))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.lstat(path.join(root, DOCUMENTATION_REQUIREMENTS))).rejects.toMatchObject({ code: 'ENOENT' });
      } else {
        expect(await fs.readFile(path.join(root, DOCUMENTATION_SOURCE_MANIFEST))).toEqual(Buffer.from([0xff]));
        expect(await fs.readFile(path.join(root, DOCUMENTATION_REQUIREMENTS), 'utf8')).toBe('not JSON');
      }
    });
  });
}

test.serial('materialization rejects a source change during copy without accepting a new final identity', async () => {
  await withSource(async root => {
    const target = path.join(root, 'staging');
    await fs.mkdir(target);
    const nativeOpen = fs.open.bind(fs);
    let sourceReads = 0;
    const open = spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
      if (args[0] === path.join(root, 'docs/main.md') && ++sourceReads === 3) {
        await fs.writeFile(path.join(root, 'docs/main.md'), '# Changed after capture\n');
      }
      return nativeOpen(...args);
    });
    try {
      await expect(materializeDocumentationPackage(root, target)).rejects.toThrow('Source drift: docs/main.md');
    } finally {
      open.mockRestore();
    }
  });
});
