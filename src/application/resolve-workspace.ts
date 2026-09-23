import type { LockFile, PlanFile } from '../compiler/contract.ts';
import type { PassId } from '../compiler/contract/pass-status.ts';

type ResolutionInput<Selection> = Readonly<{ plan: PlanFile; selection: Selection }>;

export interface WorkspaceResolutionOperations<Selection> {
  readInput(): Promise<ResolutionInput<Selection>>;
  align(input: ResolutionInput<Selection>): void | Promise<void>;
  resolve(selection: Selection): Promise<LockFile>;
  validateTemplates(lock: LockFile): Promise<void>;
  persistLock(lock: LockFile): Promise<void>;
  runPass<T>(pass: Extract<PassId, 'parse' | 'align' | 'resolve'>, execute: () => T | Promise<T>): Promise<T>;
}

/** Order one resolution request. The host retains the transaction, write lease,
 * commit fence and failure settlement; this use case neither retries nor
 * reports completion before template validation and lock persistence return. */
export async function resolveWorkspacePlan<Selection>(
  operations: WorkspaceResolutionOperations<Selection>
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const { readInput, align, resolve, validateTemplates, persistLock, runPass } = operations;
  if ([readInput, align, resolve, validateTemplates, persistLock, runPass]
      .some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace resolution operations must be callable');
  }
  // Capture methods once while retaining their original receivers.
  const pass: WorkspaceResolutionOperations<Selection>['runPass'] = runPass.bind(operations);
  const input = await pass('parse', () => readInput.call(operations));
  await pass('align', () => align.call(operations, input));
  const lock = await pass('resolve', async () => {
    const resolved = await resolve.call(operations, input.selection);
    await validateTemplates.call(operations, resolved);
    await persistLock.call(operations, resolved);
    return resolved;
  });
  return { plan: input.plan, lock };
}
