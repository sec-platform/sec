import { describe, expect, test } from 'bun:test';
import { runPolicyAlgebraGate, type PolicyRule } from '../../platform/compiler/verify/policy-algebra.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';

describe('Policy Algebra Predicate & Scope Deadlock Solver', () => {
  const mockLock: LockFile = {
    formatVersion: '1',
    app: {
      name: 'test-app',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'multi-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    generatedPaths: [],
    acceptancePlan: [],
    passStatus: {} as any
  };

  test('successfully passes when there are no conflicting rules', async () => {
    const rules: PolicyRule[] = [
      {
        id: 'tenant_scoped_rule',
        blockId: 'tenant/basic-workspace',
        targetEntity: 'Customer',
        scope: 'tenant',
        effect: 'allow',
        predicates: [
          { field: 'tenantId', operator: 'eq', value: 'currentTenant' }
        ]
      }
    ];

    const report = await runPolicyAlgebraGate('/tmp', mockLock, rules);
    expect(report.status).toBe('passed');
    expect(report.conflicts).toHaveLength(0);
  });

  test('throws POLICY-CONFLICT-003 when scope lockout deadlock occurs', async () => {
    const rules: PolicyRule[] = [
      {
        id: 'tenant_scoped_rule',
        blockId: 'tenant/basic-workspace',
        targetEntity: 'Customer',
        scope: 'tenant',
        effect: 'allow',
        predicates: [
          { field: 'tenantId', operator: 'eq', value: 'currentTenant' }
        ]
      },
      {
        id: 'global_audit_rule',
        blockId: 'audit/basic',
        targetEntity: 'Customer',
        scope: 'global',
        effect: 'allow',
        predicates: [
          { field: 'tenantId', operator: 'eq', value: '*' }
        ]
      }
    ];

    // 预期因为 scope 冲突（tenant vs global）而强行抛出编译阻断
    await expect(runPolicyAlgebraGate('/tmp', mockLock, rules)).rejects.toThrow(
      /Scope Lockout Deadlock/
    );
  });

  test('resolves deadlock when rule declares an exemption bridge', async () => {
    const rules: PolicyRule[] = [
      {
        id: 'tenant_scoped_rule',
        blockId: 'tenant/basic-workspace',
        targetEntity: 'Customer',
        scope: 'tenant',
        effect: 'allow',
        predicates: [
          { field: 'tenantId', operator: 'eq', value: 'currentTenant' }
        ]
      },
      {
        id: 'global_audit_rule',
        blockId: 'audit/basic',
        targetEntity: 'Customer',
        scope: 'global',
        effect: 'allow',
        predicates: [
          { field: 'tenantId', operator: 'eq', value: '*' }
        ],
        exemptions: ['tenant_scoped_rule'] // 声明豁免桥，解决冲突
      }
    ];

    const report = await runPolicyAlgebraGate('/tmp', mockLock, rules);
    expect(report.status).toBe('passed');
    expect(report.conflicts).toHaveLength(0);
  });
});
