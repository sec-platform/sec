import { planGeneratedStateCleanup } from '../../src/application/generated-state/inventory.ts';
import { createGeneratedStateRegistrationBootstrap } from '../../src/bootstrap/runtime-state/generated-state.ts';
import type { GeneratedStateCleanupOperationSession } from '../../src/execution/generated-state/cleanup-budget.ts';

/** Test call-shape helper only. Every mutation and receipt comes from the same
 * production bootstrap, native resource and execution issuer as real callers. */
type Options = Omit<Parameters<typeof createGeneratedStateRegistrationBootstrap>[0], 'workspaceRoot'> &
  Readonly<{ clock?: () => Date; beforeCleanupEffect?: (relativePath: string) => void | Promise<void>;
    afterQuarantineEffect?: (relativePath: string) => void | Promise<void> }>;
type Scope = Readonly<{ repositoryRoot: string; workspaceRoot?: string }>;
function boot(scope: Scope, options: Options) { return createGeneratedStateRegistrationBootstrap({
  ...options, workspaceRoot: scope.workspaceRoot ?? scope.repositoryRoot }); }
export function generatedStateProducerHooks(scope: Scope, options: Options = {}) {
  return boot(scope, options).createProducerHooks(scope.repositoryRoot, options.clock);
}
export function inspectGeneratedState(input: Scope & Readonly<{ relativePaths?: readonly string[] }>, options: Options = {}) {
  return boot(input, options).inspect(input.repositoryRoot, input.relativePaths);
}
export function settleGeneratedState(input: Parameters<ReturnType<typeof createGeneratedStateRegistrationBootstrap>['settle']>[0], options: Options = {}) {
  return boot(input, options).settle(input, options);
}
export function settleGeneratedStateForWorktreeRetirement(input: Parameters<ReturnType<typeof createGeneratedStateRegistrationBootstrap>['settleForWorktreeRetirement']>[0], options: Options = {}) {
  return boot(input, options).settleForWorktreeRetirement(input);
}
export function continueGeneratedStateCleanup(input: Scope & Readonly<{ profile: 'safe' | 'automatic' | 'all-rebuildable';
  lifecycleOptions?: Options; relativePaths: readonly string[]; operation: GeneratedStateCleanupOperationSession }>, options: Options = input.lifecycleOptions ?? {}) {
  return boot(input, options).continueCleanup({ ...input, workspaceRoot: input.workspaceRoot ?? input.repositoryRoot }, options);
}
export function ensureGeneratedStateRegistrationLedger(input: Scope, options: Options = {}) {
  return boot(input, options).ensureLedger();
}
export { planGeneratedStateCleanup };
