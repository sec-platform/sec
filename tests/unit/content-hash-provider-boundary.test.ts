import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');
const PHYSICAL_PROVIDER =
  'src/adapters/providers/content-hash/awasm-wasm-simd.ts';

function sourceFiles(root: string): string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile() && /\.(?:ts|mts|cts|js|mjs|cjs)$/u.test(entry.name)) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

test('physical awasm hashing stays behind the single content-hash adapter', () => {
  const packageImports: string[] = [];
  const threadedReferences: string[] = [];
  for (const absolute of sourceFiles(SOURCE_ROOT)) {
    const relative = path.relative(REPOSITORY_ROOT, absolute)
      .split(path.sep).join('/');
    const source = readFileSync(absolute, 'utf8');
    if (/from\s+['"]@awasm\/noble(?:['"/])/u.test(source)
        || /import\s*\(\s*['"]@awasm\/noble(?:['"/])/u.test(source)) {
      packageImports.push(relative);
    }
    if (source.includes('@awasm/noble/wasm_threads')) {
      threadedReferences.push(relative);
    }
  }

  assert.deepEqual(packageImports, [PHYSICAL_PROVIDER]);
  assert.deepEqual(threadedReferences, []);
});

test('semantic runtime loads the physical identity composition only for generation', () => {
  const source = readFileSync(
    path.join(REPOSITORY_ROOT, 'src/bootstrap/create-runtime.ts'),
    'utf8'
  );
  assert.equal(
    /from\s+['"]\.\/content-identity-runtime\.ts['"]/u.test(source),
    false
  );
  assert.match(source, /import\('\.\/content-identity-runtime\.ts'\)/u);
});

test('contracts and execution remain independent of the physical hash package', () => {
  for (const root of ['src/contracts', 'src/execution', 'src/bootstrap']) {
    for (const absolute of sourceFiles(path.join(REPOSITORY_ROOT, root))) {
      if (/\.test\.[cm]?[jt]s$/u.test(absolute)) continue;
      const source = readFileSync(absolute, 'utf8');
      assert.equal(
        source.includes('@awasm/noble'),
        false,
        `${path.relative(REPOSITORY_ROOT, absolute)} must not bind the physical hash package`
      );
    }
  }
});
