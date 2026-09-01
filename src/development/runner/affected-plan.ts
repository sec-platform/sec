import type { SecBoundSemanticOperation } from '../../system-architecture/operation/semantic.ts';
import {
  affectedTestPlanExitCode,
  buildLocalAffectedCheckPlan
} from './affected-plan-contract.ts';
import { resolveAffectedTestExecution } from './test-runner.ts';

export * from './affected-plan-contract.ts';

/**
 * Zero-Effect affected-plan observation. It may consume an already-published
 * compiler generation, but it never materializes, repairs or retains one. The
 * effectful runner remains downstream of the pure affected-plan contract.
 */
export async function runLocalAffectedPlan(
  operation: SecBoundSemanticOperation
): Promise<number> {
  const { observeCompilerDependencyExecutionGenerationAuthority } = await import(
    '../../toolchain/dependencies/runtime.ts'
  );
  const dependencyAuthority = await observeCompilerDependencyExecutionGenerationAuthority();
  if (dependencyAuthority === null) {
    console.error(
      'Affected plan source projection is unavailable: compiler dependencies are not already materialized.'
    );
    return 1;
  }
  const { issueCheckAffectedTestImpactProjection } = await import('./check-affected-source.ts');
  const affectedExecution = await resolveAffectedTestExecution({
    operation,
    issueTestImpactProjection: issueCheckAffectedTestImpactProjection,
    verifyAtResolution: true
  });
  if (affectedExecution === null) {
    console.error('Failed to detect affected test files.');
    return 1;
  }
  const plan = buildLocalAffectedCheckPlan(affectedExecution.plan);
  console.log(JSON.stringify(plan, null, 2));
  return affectedTestPlanExitCode(affectedExecution.plan);
}
