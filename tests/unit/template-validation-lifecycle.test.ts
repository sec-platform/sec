import { test } from 'bun:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LockFile } from '../../src/compiler/contract.ts';
import { CompilerError } from '../../src/compiler/errors.ts';
import { validateResolvedTemplates } from '../../src/adapters/verification/validate-resolved-templates.ts';
import { ISOLATED_VERIFICATION_ENV_KEY } from '../../src/adapters/runtime-state/physical/runtime/process.ts';

// Native execution keeps real workspace providers. Interruption fences stop at
// the first temporary-workspace effect; fs.mkdtemp is wrapped only to observe
// allocations, not replaced with a fake directory. Local replay explicitly
// adapts the otherwise unavailable downstream provider imports.
async function using(run: (root: string, allocations: string[]) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-template-scope-'));
  const original = fs.mkdtemp, environment = process.env[ISOLATED_VERIFICATION_ENV_KEY];
  const allocations: string[] = [];
  delete process.env[ISOLATED_VERIFICATION_ENV_KEY];
  fs.mkdtemp = (async (...args: Parameters<typeof fs.mkdtemp>) => {
    const value = await original(...args);
    if (String(args[0]).includes('.engineering-compiler-template-')) allocations.push(String(value));
    return value;
  }) as typeof fs.mkdtemp;
  try { await run(root, allocations); }
  finally {
    fs.mkdtemp = original;
    if (environment === undefined) delete process.env[ISOLATED_VERIFICATION_ENV_KEY];
    else process.env[ISOLATED_VERIFICATION_ENV_KEY] = environment;
    for (const allocated of allocations) await fs.rm(allocated, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
}
function lock(registryPath?: string): LockFile {
  return { resolvedBlocks: registryPath === undefined ? [] : [{ registryLocation: 'workspace', registryPath }] } as unknown as LockFile;
}
async function absent(target: string): Promise<boolean> {
  try { await fs.lstat(target); return false; }
  catch (error) { if ((error as { code?: string }).code === 'ENOENT') return true; throw error; }
}

test('uncloneable input is rejected before allocating any temporary directory', async () => using(async (root, allocated) => {
  const input = Object.assign(lock(), { nonserializable() {} });
  await assert.rejects(validateResolvedTemplates(root, input));
  assert.deepEqual(allocated, []);
}));

test('malformed registry data is rejected before allocation or admission effects', async () => using(async (root, allocated) => {
  for (const registryPath of ['../escape', '/absolute', '', 'C:\\escape']) {
    await assert.rejects(validateResolvedTemplates(root, lock(registryPath), async () => assert.fail('invalid input fence')),
      error => (error as { code?: string }).code === 'TEMPLATE-BUILD-002');
  }
  assert.deepEqual(allocated, []);
}));

test('invalid callbacks and malformed resolved-block collections allocate no workspace', async () => using(async (root, allocated) => {
  await assert.rejects(validateResolvedTemplates(root, lock(), 0 as never), TypeError);
  await assert.rejects(validateResolvedTemplates(root, { resolvedBlocks: null } as never));
  assert.deepEqual(allocated, []);
}));

test('initial admission failure creates no temporary root and preserves its exact reason', async () => using(async (root, allocated) => {
  const reason = Object.freeze({ admission: 'refused' });
  await assert.rejects(validateResolvedTemplates(root, lock(), async () => { throw reason; }), error => error === reason);
  assert.deepEqual(allocated, []);
}));

test('a special validation failure survives successful cleanup unchanged', async () => using(async (root, allocated) => {
  const reason = new CompilerError('VERIFY-ISOLATION-003', 'selected refusal'); let refused = false;
  await assert.rejects(validateResolvedTemplates(root, lock(), async () => {
    if (allocated.length && !refused) { refused = true; throw reason; }
  }), error => error === reason);
  assert.equal(allocated.length, 1); assert.equal(await absent(allocated[0]!), true);
}));

test('input changes inside the first fence cannot move clone work outside the protected scope', async () => using(async (root, allocated) => {
  const input = lock(), reason = new CompilerError('VERIFY-ISOLATION-003', 'expected'); let refused = false;
  await assert.rejects(validateResolvedTemplates(root, input, async () => {
    if (allocated.length === 0) Object.assign(input, { laterFunction() {} });
    else if (!refused) { refused = true; throw reason; }
  }), error => error === reason);
  assert.equal(allocated.length, 1); assert.equal(await absent(allocated[0]!), true);
}));

for (const primary of [undefined, null, false, 0, Object.freeze({ failed: 'validation' })]) {
  test(`cleanup failure retains the original ${String(primary)} failure and the exact residual root`, async () => using(async (root, allocated) => {
    const cleanup = new Error('cleanup fence refused'); let refused = false;
    await assert.rejects(validateResolvedTemplates(root, lock(), async () => {
      if (!allocated.length) return;
      if (!refused) { refused = true; throw primary; }
      throw cleanup;
    }), error => {
      const e = error as CompilerError;
      assert.equal(e.code, 'TEMPLATE-BUILD-003');
      assert.ok(e.cause instanceof AggregateError);
      assert.deepEqual(e.cause.errors, [primary, cleanup]); assert.equal(e.cause.cause, primary);
      assert.deepEqual(e.details, { validationRoot: allocated[0], validationCompleted: false });
      return true;
    });
    assert.equal(allocated.length, 1); assert.equal(await absent(allocated[0]!), false);
  }));
}

test('hostile thrown values are preserved as causes after successful cleanup', async () => using(async (root, allocated) => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke(); let refused = false;
  await assert.rejects(validateResolvedTemplates(root, lock(), async () => {
    if (allocated.length && !refused) { refused = true; throw proxy; }
  }), error => {
    assert.equal((error as CompilerError).code, 'TEMPLATE-BUILD-001');
    assert.equal((error as Error).cause, proxy); return true;
  });
  assert.equal(await absent(allocated[0]!), true);
}));

test('isolated validation rejects a registry containing its temporary-root namespace before setup', async () => using(async (root, allocated) => {
  process.env[ISOLATED_VERIFICATION_ENV_KEY] = '1';
  await assert.rejects(validateResolvedTemplates(root, lock('.'), async () => assert.fail('invalid isolated setup')),
    error => (error as CompilerError).code === 'TEMPLATE-BUILD-002');
  assert.deepEqual(allocated, []);
}));
