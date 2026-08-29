import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { LockFile } from '../../src/compiler/contract.ts';
import { checkSlotDirectCapabilities } from '../../src/compiler/verify/slot-capability-lint.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function createMockLock(sourcePath: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'test-app',
      name: 'test-app',
      stack: 'typescript-library',
      mode: 'multi-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [{
      id: 'mock_slot',
      block: 'entity/customer-basic',
      target: 'custom/mock_slot.ts',
      sourcePath,
      symbol: 'normalizeCustomerInput',
      kind: 'adapter',
      status: 'filled',
      writableZones: ['source/code/slots/'],
      provenanceHints: { generator: 'test', verifiedBy: [] }
    }],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  };
}

async function withSlotSource(
  source: string,
  callback: (workspaceRoot: string, lock: LockFile) => Promise<void>
): Promise<void> {
  await withTempWorkspace(async (workspaceRoot) => {
    const slotsDir = path.join(workspaceRoot, 'source', 'code', 'slots');
    await fs.mkdir(slotsDir, { recursive: true });
    await fs.writeFile(path.join(slotsDir, 'mock_slot.ts'), source, 'utf8');
    await callback(workspaceRoot, createMockLock('source/code/slots/mock_slot.ts'));
  }, 'slot-capability-lint-');
}

async function expectLintCode(source: string, code: string): Promise<void> {
  await withSlotSource(source, async (workspaceRoot, lock) => {
    await expect(checkSlotDirectCapabilities(workspaceRoot, lock)).rejects.toMatchObject({ code });
  });
}

async function expectLintPass(source: string): Promise<void> {
  await withSlotSource(source, async (workspaceRoot, lock) => {
    await expect(checkSlotDirectCapabilities(workspaceRoot, lock)).resolves.toBeUndefined();
  });
}

describe('Custom Slot direct capability acquisition boundary', () => {
  test('admits source whose imports and re-exports are erased from runtime', async () => {
    await expectLintPass(
      `import type { CustomerInput } from '../../../project/src/runtime/database.ts';\n` +
      `export function normalizeCustomerInput(input: CustomerInput) { return String(input); }\n`
    );
    await expectLintPass(
      `import { type CustomerInput } from '../../../project/src/runtime/database.ts';\n` +
      `export { type CustomerInput } from '../../../project/src/runtime/database.ts';\n` +
      `export function normalizeCustomerInput(input: CustomerInput) { return String(input); }\n`
    );
  });

  test('rejects prohibited direct runtime module acquisition with a typed reason', async () => {
    const cases = [
      [`import { changeCase } from 'change-case';\nexport const value = changeCase('x');\n`, 'SLOT-LINT-005'],
      [`import { execSync } from 'child_process';\nexport const value = () => execSync('echo x');\n`, 'SLOT-LINT-002'],
      [`import { createRequire } from 'node:module';\nexport const value = createRequire(import.meta.url);\n`, 'SLOT-LINT-002'],
      [`export function load(name: string) { return require(name); }\n`, 'SLOT-LINT-003'],
      [`export async function load(name: string) { return import(name); }\n`, 'SLOT-LINT-003'],
      [`export async function load() { return import('node:vm'); }\n`, 'SLOT-LINT-002']
    ] as const;
    for (const [source, code] of cases) await expectLintCode(source, code);
  });

  test('rejects prohibited direct ambient runtime acquisition', async () => {
    for (const source of [
      `export function run() { return Bun.spawn(['echo', 'x']); }\n`,
      `export async function run() { return fetch('https://example.invalid'); }\n`,
      `export function run() { return globalThis['process']; }\n`,
      `export function run() { return process; }\n`,
      `export function run() { const callback = fetch; return callback; }\n`
    ]) await expectLintCode(source, 'SLOT-LINT-004');
  });

  test('local declarations do not acquire or impersonate host capabilities', async () => {
    await expectLintPass(
      `const process = { value: 1 };\n` +
      `const fetch = (value: string) => value;\n` +
      `const require = (value: string) => ({ value });\n` +
      `export function run() { return [process.value, fetch('x'), require('y').value]; }\n`
    );
  });

  test('missing retained source fails closed before capability observation', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await fs.mkdir(path.join(workspaceRoot, 'source', 'code', 'slots'), { recursive: true });
      await expect(checkSlotDirectCapabilities(
        workspaceRoot,
        createMockLock('source/code/slots/missing.ts')
      )).rejects.toMatchObject({ code: 'SLOT-LINT-001' });
    }, 'slot-capability-lint-missing-');
  });

  test('linked source parents fail closed before capability observation', async () => {
    if (process.platform !== 'linux') return;
    await withTempWorkspace(async (workspaceRoot) => {
      const externalRoot = await fs.mkdtemp('/tmp/sec-slot-capability-external-');
      try {
        await fs.mkdir(path.join(workspaceRoot, 'source'), { recursive: true });
        await fs.mkdir(path.join(externalRoot, 'slots'), { recursive: true });
        await fs.writeFile(path.join(externalRoot, 'slots', 'mock_slot.ts'), 'export const value = 1;\n', 'utf8');
        await fs.symlink(path.join(externalRoot, 'slots'), path.join(workspaceRoot, 'source', 'code'));
        await expect(checkSlotDirectCapabilities(
          workspaceRoot,
          createMockLock('source/code/mock_slot.ts')
        )).rejects.toMatchObject({ code: 'SLOT-LINT-001' });
      } finally {
        await fs.rm(externalRoot, { recursive: true, force: true });
      }
    }, 'slot-capability-lint-symlink-');
  });
});
