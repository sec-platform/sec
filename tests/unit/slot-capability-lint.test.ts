import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { lintSlotCapabilities } from '../../platform/compiler/verify/slot-capability-lint.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function createMockLock(sourcePath: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'test-app',
      name: 'test-app',
      stack: 'nextjs-ts-prisma-sqlite',
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
    await expect(lintSlotCapabilities(workspaceRoot, lock)).rejects.toMatchObject({ code });
  });
}

describe('Custom Slot static capability lint', () => {
  test('allows erased type-only imports for the current pure reference shape', async () => {
    await withSlotSource(
      `import type { CustomerInput } from '../../../project/src/runtime/database.ts';\n` +
      `export function normalizeCustomerInput(input: CustomerInput) { return String(input); }\n`,
      async (workspaceRoot, lock) => {
        await expect(lintSlotCapabilities(workspaceRoot, lock)).resolves.toBeUndefined();
      }
    );
  });

  test('fails closed on runtime package imports without transitive capability proof', async () => {
    await expectLintCode(
      `import { changeCase } from 'change-case';\nexport const value = changeCase('x');\n`,
      'SLOT-LINT-005'
    );
  });

  test('fails closed on direct host runtime modules', async () => {
    await expectLintCode(
      `import { execSync } from 'child_process';\nexport const value = () => execSync('echo x');\n`,
      'SLOT-LINT-002'
    );
  });

  test('fails closed on createRequire and other module-loader capabilities', async () => {
    await expectLintCode(
      `import { createRequire } from 'node:module';\nexport const value = createRequire(import.meta.url);\n`,
      'SLOT-LINT-002'
    );
  });

  test('fails closed on non-literal require and dynamic import', async () => {
    await expectLintCode(
      `export function load(name: string) { return require(name); }\n`,
      'SLOT-LINT-003'
    );
    await expectLintCode(
      `export async function load(name: string) { return import(name); }\n`,
      'SLOT-LINT-003'
    );
  });

  test('fails closed on literal dynamic host imports', async () => {
    await expectLintCode(
      `export async function load() { return import('node:vm'); }\n`,
      'SLOT-LINT-002'
    );
  });

  test('fails closed on direct runtime capability roots', async () => {
    await expectLintCode(
      `export function run() { return Bun.spawn(['echo', 'x']); }\n`,
      'SLOT-LINT-004'
    );
    await expectLintCode(
      `export async function run() { return fetch('https://example.invalid'); }\n`,
      'SLOT-LINT-004'
    );
    await expectLintCode(
      `export function run() { return globalThis['process']; }\n`,
      'SLOT-LINT-004'
    );
  });

  test('fails closed when an active Slot source is missing', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      await fs.mkdir(path.join(workspaceRoot, 'source', 'code', 'slots'), { recursive: true });
      await expect(lintSlotCapabilities(
        workspaceRoot,
        createMockLock('source/code/slots/missing.ts')
      )).rejects.toMatchObject({ code: 'SLOT-LINT-001' });
    }, 'slot-capability-lint-missing-');
  });

  test('fails closed when the Slot source parent is reached through a symlink', async () => {
    if (process.platform !== 'linux') return;
    await withTempWorkspace(async (workspaceRoot) => {
      const externalRoot = await fs.mkdtemp('/tmp/sec-slot-capability-external-');
      try {
        await fs.mkdir(path.join(workspaceRoot, 'source'), { recursive: true });
        await fs.mkdir(path.join(externalRoot, 'slots'), { recursive: true });
        await fs.writeFile(path.join(externalRoot, 'slots', 'mock_slot.ts'), 'export const value = 1;\n', 'utf8');
        await fs.symlink(path.join(externalRoot, 'slots'), path.join(workspaceRoot, 'source', 'code'));
        await expect(lintSlotCapabilities(
          workspaceRoot,
          createMockLock('source/code/mock_slot.ts')
        )).rejects.toMatchObject({ code: 'SLOT-LINT-001' });
      } finally {
        await fs.rm(externalRoot, { recursive: true, force: true });
      }
    }, 'slot-capability-lint-symlink-');
  });
});
