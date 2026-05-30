import { CompilerError } from '../../shared/errors.ts';
import type { LockFile } from '../../shared/lock-types.ts';

// 声明式 ABAC 谓词表达式接口
export interface PolicyPredicate {
  field: string;
  operator: 'eq' | 'neq' | 'in' | 'contains';
  value: string;
}

// 策略结构定义
export interface PolicyRule {
  id: string;
  blockId: string;
  targetEntity: string;
  scope: 'tenant' | 'global';
  effect: 'allow' | 'deny';
  predicates: PolicyPredicate[];
  exemptions?: string[]; // 允许妥协豁免的外部策略 ID 列表
}

// 策略冲突报告接口
export interface PolicyAlgebraReport {
  status: 'passed' | 'failed' | 'compromised';
  conflicts: Array<{
    entity: string;
    rules: string[];
    reason: string;
    compromiseSuggestion: string;
  }>;
}

/**
 * 策略妥协代数求解器 (Policy Algebra Conflict Solver)
 * 分析已 Resolved/Composed 图谱中跨能力块缝合时的 ABAC 策略引脚，诊断策略死锁并输出妥协冲突报告
 */
export function solvePolicyAlgebra(
  lock: LockFile,
  rules: PolicyRule[]
): PolicyAlgebraReport {
  const conflicts: PolicyAlgebraReport['conflicts'] = [];
  
  // 1. 按数据实体 (Entity) 对生效的策略规则进行聚合分组
  const entityGroups = new Map<string, PolicyRule[]>();
  for (const rule of rules) {
    if (!entityGroups.has(rule.targetEntity)) {
      entityGroups.set(rule.targetEntity, []);
    }
    entityGroups.get(rule.targetEntity)!.push(rule);
  }

  // 2. 逐一求解每个实体上生效的策略谓词，判定是否存在连通死锁 (Policy Deadlock)
  for (const [entity, activeRules] of entityGroups.entries()) {
    if (activeRules.length < 2) continue;

    for (let i = 0; i < activeRules.length; i++) {
      for (let j = i + 1; j < activeRules.length; j++) {
        const ruleA = activeRules[i];
        const ruleB = activeRules[j];

        // 如果策略互相声明了妥协豁免 (Exemption Bridge)，则免于死锁判定
        if (ruleA.exemptions?.includes(ruleB.id) || ruleB.exemptions?.includes(ruleA.id)) {
          continue;
        }

        // 检查两个策略在同一字段上的谓词排他性 (Predicate Exclusivity)
        for (const predA of ruleA.predicates) {
          for (const predB of ruleB.predicates) {
            if (predA.field === predB.field) {
              // 典型死锁场景一：一个是 tenant 租户行级强制隔离，另一个是 global 全局越界提取
              if (ruleA.scope !== ruleB.scope) {
                conflicts.push({
                  entity,
                  rules: [ruleA.id, ruleB.id],
                  reason: `Scope Lockout Deadlock: Policy "${ruleA.id}" (block: ${ruleA.blockId}) enforces "${ruleA.scope}" scope, but Policy "${ruleB.id}" (block: ${ruleB.blockId}) attempts "${ruleB.scope}" scope. Both assert control on entity "${entity}.${predA.field}" without an explicit exemption bridge.`,
                  compromiseSuggestion: `Introduce an exemption bridge inside workbench override or block manifest: Add rule "${ruleA.id}" to the exemptions list of "${ruleB.id}".`
                });
                break;
              }

              // 典型死锁场景二：同字段操作符排他（如 eq 'tenantId' 与 neq 'tenantId'）
              const isMutuallyExclusive = 
                (predA.operator === 'eq' && predB.operator === 'neq' && predA.value === predB.value) ||
                (predA.operator === 'eq' && predB.operator === 'eq' && predA.value !== predB.value);

              if (isMutuallyExclusive && ruleA.effect === 'allow' && ruleB.effect === 'allow') {
                conflicts.push({
                  entity,
                  rules: [ruleA.id, ruleB.id],
                  reason: `Predicate Exclusivity Deadlock: Both rules require 'allow' but assert mutually exclusive values on "${entity}.${predA.field}". A mandates "${predA.operator} ${predA.value}" while B mandates "${predB.operator} ${predB.value}".`,
                  compromiseSuggestion: `Refactor the logic inside Custom Slot to map discrete workspaces, or append override policies.`
                });
                break;
              }
            }
          }
        }
      }
    }
  }

  return {
    status: conflicts.length === 0 ? 'passed' : 'failed',
    conflicts
  };
}

/**
 * 在 verify 阶段触发策略妥协代数门校验，如果检测到不可豁免的策略冲突则抛出 CompilerError
 */
export async function runPolicyAlgebraGate(
  workspaceRoot: string,
  lock: LockFile,
  rules: PolicyRule[]
): Promise<PolicyAlgebraReport> {
  const report = solvePolicyAlgebra(lock, rules);
  
  if (report.status === 'failed') {
    const errorDetails = report.conflicts.map(c => `[Entity: ${c.entity}] Rules: ${c.rules.join(', ')} -> ${c.reason}`).join('\n');
    throw new CompilerError(
      'POLICY-CONFLICT-003',
      `Policy Algebra Deadlock detected during block stitching:\n${errorDetails}\nPlatform compilation blocked due to unhandled logical safety deadlocks.`
    );
  }

  return report;
}
