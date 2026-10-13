import { canonicalEquals } from '../contracts/canonical.ts';
import { CodedFailure } from '../contracts/failure.ts';
import { compileCompilerDependencyGeneratedStateReceipt, planCompilerDependencyGeneratedStateSettlement, type CompilerDependencyGeneratedStateSettlementPlan } from '../execution/dependency-generated-state.ts';
import type { GeneratedStateInventory, GeneratedStatePhysicalIdentity } from '../execution/generated-state/contract.ts';
export async function settleCompilerDependencyGeneratedState(plan: CompilerDependencyGeneratedStateSettlementPlan, ports: Readonly<{
  inspect(): Promise<GeneratedStateInventory>;
  observeWorkspace(workspaceRoot:string): GeneratedStatePhysicalIdentity;
  migrateJournal(workspaceRoot:string):Promise<unknown>;
}>) {
  const before=await ports.inspect();
  const currentPlan=planCompilerDependencyGeneratedStateSettlement({...plan, inventory:before, workspaceIdentity:ports.observeWorkspace(plan.workspaceRoot)});
  if(!canonicalEquals(currentPlan,plan)) throw new CodedFailure('RUNTIME-DEPS-004','Dependency generated-state settlement plan is stale, malformed, or foreign; current state is preserved',{currentPlanDigest:currentPlan.planDigest,planDigest:plan.planDigest});
  await ports.migrateJournal(plan.workspaceRoot);
  const after=await ports.inspect();
  return compileCompilerDependencyGeneratedStateReceipt(plan,before,after);
}
