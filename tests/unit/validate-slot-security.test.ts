import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSlotSecurity } from '../../platform/compiler/verify/validate-slot-security.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

describe('Custom Slot static AST security audit (AST Guard Pass)', () => {
  const createMockLock = (sourcePath: string): LockFile => ({
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
    slotTasks: [
      {
        id: 'mock_slot',
        block: 'entity/customer-basic',
        target: 'custom/mock_slot.ts',
        sourcePath,
        symbol: 'normalizeCustomerInput',
        kind: 'adapter',
        status: 'filled',
        writableZones: ['source/code/slots/'],
        provenanceHints: {
          generator: 'test',
          verifiedBy: []
        }
      }
    ],
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
  });

  test('passes audit when Custom Slot is clean and has no dangerous imports', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const slotsDir = path.join(workspaceRoot, 'source', 'code', 'slots');
      await fs.mkdir(slotsDir, { recursive: true });

      const slotFile = path.join(slotsDir, 'mock_slot.ts');
      await fs.writeFile(
        slotFile,
        `
      import { changeCase } from 'change-case';
      
      export function normalizeCustomerInput(input: any) {
        return {
          name: input.name,
          email: input.email.toLowerCase()
        };
      }
      `,
        'utf8'
      );

      const lock = createMockLock('source/code/slots/mock_slot.ts');

      // 执行安全审查，预期平滑通过，不抛出任何异常
      await expect(validateSlotSecurity(workspaceRoot, lock)).resolves.toBeUndefined();
    }, 'slot-security-clean-');
  });

  test('throws SLOT-SECURITY-002 when Slot imports forbidden child_process module', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const slotsDir = path.join(workspaceRoot, 'source', 'code', 'slots');
      await fs.mkdir(slotsDir, { recursive: true });

      const slotFile = path.join(slotsDir, 'mock_slot.ts');
      await fs.writeFile(
        slotFile,
        `
      import { execSync } from 'child_process';
      
      export function maliciousSlot(input: any) {
        execSync('rm -rf /');
        return input;
      }
      `,
        'utf8'
      );

      const lock = createMockLock('source/code/slots/mock_slot.ts');

      // 执行安全审查，预期强行拦截并抛出指定错误码
      await expect(validateSlotSecurity(workspaceRoot, lock)).rejects.toThrow(
        /Forbidden system module import "child_process" detected in Custom Slot/
      );
    }, 'slot-security-forbidden-import-');
  });

  test('throws SLOT-SECURITY-002 when Slot utilizes dynamic require() on forbidden fs module', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const slotsDir = path.join(workspaceRoot, 'source', 'code', 'slots');
      await fs.mkdir(slotsDir, { recursive: true });

      const slotFile = path.join(slotsDir, 'mock_slot.ts');
      await fs.writeFile(
        slotFile,
        `
      export function maliciousSlot(input: any) {
        const fs = require('fs');
        const data = fs.readFileSync('/etc/passwd', 'utf8');
        return data;
      }
      `,
        'utf8'
      );

      const lock = createMockLock('source/code/slots/mock_slot.ts');

      await expect(validateSlotSecurity(workspaceRoot, lock)).rejects.toThrow(
        /Forbidden dynamic require\("fs"\) call detected in Custom Slot/
      );
    }, 'slot-security-dynamic-require-');
  });

  test('throws SLOT-SECURITY-002 when Slot utilizes dynamic import() on node:vm', async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const slotsDir = path.join(workspaceRoot, 'source', 'code', 'slots');
      await fs.mkdir(slotsDir, { recursive: true });

      const slotFile = path.join(slotsDir, 'mock_slot.ts');
      await fs.writeFile(
        slotFile,
        `
      export async function maliciousSlot(input: any) {
        const vm = await import('node:vm');
        vm.runInNewContext('1 + 1');
        return input;
      }
      `,
        'utf8'
      );

      const lock = createMockLock('source/code/slots/mock_slot.ts');

      await expect(validateSlotSecurity(workspaceRoot, lock)).rejects.toThrow(
        /Forbidden dynamic import\("node:vm"\) call detected in Custom Slot/
      );
    }, 'slot-security-dynamic-import-');
  });
});
