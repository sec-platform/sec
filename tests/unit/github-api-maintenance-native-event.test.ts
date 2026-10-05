import { expect, test } from 'bun:test';
import { linkSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMaintenanceNativeEvent } from '../../src/adapters/providers/github-api/internal/maintenance-native-event.ts';

async function fixture(operation: (input: { repositoryRoot: string; repository: string; advertisedEventPath: string }, root: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-native-maintenance-event-'));
  const repositoryRoot = path.join(root, 'work', 'sec', 'sec');
  const advertisedEventPath = path.join(root, 'work', '_temp', '_github_workflow', 'event.json');
  mkdirSync(repositoryRoot, { recursive: true });
  mkdirSync(path.dirname(advertisedEventPath), { recursive: true });
  writeFileSync(advertisedEventPath, '{"inputs":{"request":"fixed"}}');
  try { await operation({ repositoryRoot, repository: 'sec-platform/sec', advertisedEventPath }, root); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test('native event scope accepts the runner default layout under independent work prefixes', async () => {
  for (let index = 0; index < 2; index += 1) await fixture(async input => {
    const bytes = await readMaintenanceNativeEvent(input);
    expect(new TextDecoder().decode(bytes)).toBe('{"inputs":{"request":"fixed"}}');
  });
});

for (const locator of ['absent', 'foreign', 'relative', 'traversal'] as const) {
  test(`native event rejects ${locator} advertised locator without using it as a file selector`, async () => {
    await fixture(async (input, root) => {
      const advertisedEventPath = locator === 'absent' ? undefined : locator === 'foreign'
        ? path.join(root, 'secrets.json') : locator === 'relative' ? 'event.json'
          : path.dirname(input.advertisedEventPath) + '/../_github_workflow/event.json';
      await expect(readMaintenanceNativeEvent({ ...input, advertisedEventPath })).rejects.toThrow('locator differs');
    });
  });
}

test('native event rejects unsupported custom checkout scope', async () => {
  await fixture(async (input, root) => {
    const repositoryRoot = path.join(root, 'custom-checkout'); mkdirSync(repositoryRoot);
    await expect(readMaintenanceNativeEvent({ ...input, repositoryRoot })).rejects.toThrow('default host checkout scope');
  });
});

for (const alias of ['leaf-symlink', 'parent-symlink', 'repository-symlink', 'hardlink'] as const) {
  test(`native event rejects ${alias} aliases`, async () => {
    await fixture(async (input, root) => {
      if (alias === 'repository-symlink') {
        const real = input.repositoryRoot + '-real'; renameSync(input.repositoryRoot, real); symlinkSync(real, input.repositoryRoot);
      } else if (alias === 'parent-symlink') {
        const parent = path.dirname(input.advertisedEventPath), real = parent + '-real';
        renameSync(parent, real); symlinkSync(real, parent);
      } else {
        const target = path.join(root, 'other.json'); writeFileSync(target, 'unrelated');
        rmSync(input.advertisedEventPath);
        if (alias === 'hardlink') linkSync(target, input.advertisedEventPath);
        else symlinkSync(target, input.advertisedEventPath);
      }
      await expect(readMaintenanceNativeEvent(input)).rejects.toThrow();
    });
  });
}

for (const size of [0, 256 * 1024 + 1, 64 * 1024 * 1024]) {
  test(`native event rejects initial ${size}-byte file before admitting its contents`, async () => {
    await fixture(async input => {
      truncateSync(input.advertisedEventPath, size);
      await expect(readMaintenanceNativeEvent(input)).rejects.toThrow('byte bound');
    });
  });
}

test('native event accepts exactly its finite byte ceiling', async () => {
  await fixture(async input => {
    writeFileSync(input.advertisedEventPath, Buffer.alloc(256 * 1024, 0x20));
    expect((await readMaintenanceNativeEvent(input)).byteLength).toBe(256 * 1024);
  });
});

for (const drift of ['replacement', 'growth', 'parent-replacement'] as const) {
  test(`native event rejects ${drift} after retention and before bounded consumption`, async () => {
    await fixture(async input => {
      const pending = readMaintenanceNativeEvent(input);
      // withAcquiredResource has retained the native file before its await boundary.
      if (drift === 'growth') truncateSync(input.advertisedEventPath, 256 * 1024 + 1);
      else if (drift === 'replacement') {
        renameSync(input.advertisedEventPath, input.advertisedEventPath + '.old');
        writeFileSync(input.advertisedEventPath, 'replacement');
      } else {
        const parent = path.dirname(input.advertisedEventPath);
        renameSync(parent, parent + '-old'); mkdirSync(parent); writeFileSync(input.advertisedEventPath, 'replacement');
      }
      await expect(pending).rejects.toThrow();
    });
  });
}

test('native event rejects a non-ordinary directory leaf', async () => {
  await fixture(async input => {
    rmSync(input.advertisedEventPath); mkdirSync(input.advertisedEventPath);
    await expect(readMaintenanceNativeEvent(input)).rejects.toThrow();
  });
});
