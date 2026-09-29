import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

test('current-state keeps the live-main stable document-control entrypoint', () => {
  const state = readFileSync(path.join(root, 'config/repository/current-state.yaml'), 'utf8');
  assert.match(
    state,
    /^  command: bun src\/control\/documentation\/document-control-plane\.ts status --json$/mu
  );
  assert.equal(
    state.includes('src/adapters/self-hosting/control/documentation/document-control-plane.ts'),
    false
  );
});

test('stable document-control entrypoint is a zero-authority facade', () => {
  const facade = readFileSync(
    path.join(root, 'src/control/documentation/document-control-plane.ts'),
    'utf8'
  );
  assert.match(
    facade,
    /runDocumentControlPlaneCli.*adapters\/self-hosting\/control\/documentation\/document-control-plane\.ts/su
  );
  assert.equal(facade.includes('export *'), false);
  assert.equal(facade.includes('capability'), false);
  const descriptor = JSON.parse(readFileSync(
    path.join(root, 'src/control/documentation/module.json'),
    'utf8'
  )) as Record<string, unknown>;
  assert.deepEqual(descriptor, {
    importGraph: 'runtime',
    externalEntrypoints: ['src/control/documentation/document-control-plane.ts']
  });
});

test('physical documentation owner exports one reusable CLI runner', () => {
  const owner = readFileSync(
    path.join(root, 'src/adapters/self-hosting/control/documentation/document-control-plane.ts'),
    'utf8'
  );
  assert.match(owner, /export async function runDocumentControlPlaneCli\(\): Promise<void>/u);
  assert.match(owner, /if \(import\.meta\.main\) \{\s*await runDocumentControlPlaneCli\(\);\s*\}/su);
});
