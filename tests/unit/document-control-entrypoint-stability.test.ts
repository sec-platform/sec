import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const canonicalEntrypoint = 'src/adapters/self-hosting/control/documentation/document-control-plane.ts';

test('current-state and package scripts use the canonical document-control entrypoint', () => {
  const state = readFileSync(path.join(root, 'config/repository/current-state.yaml'), 'utf8');
  assert.match(
    state,
    /^  command: bun src\/adapters\/self-hosting\/control\/documentation\/document-control-plane\.ts status --json$/mu
  );
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    packageJson.scripts?.['work:status'],
    `"$npm_execpath" ${canonicalEntrypoint} status`
  );
});

test('documentation control owner declares its canonical external entrypoint', () => {
  const descriptor = JSON.parse(readFileSync(
    path.join(root, 'src/adapters/self-hosting/control/documentation/module.json'),
    'utf8'
  )) as { externalEntrypoints?: string[] };
  assert.deepEqual(descriptor.externalEntrypoints, [canonicalEntrypoint]);

  const owner = readFileSync(path.join(root, canonicalEntrypoint), 'utf8');
  assert.match(owner, /export async function runDocumentControlPlaneCli\(\): Promise<void>/u);
  assert.match(owner, /if \(import\.meta\.main\) \{\s*await runDocumentControlPlaneCli\(\);\s*\}/su);
});
