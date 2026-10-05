import type { LockFile, PlanFile } from '../compiler/contract.ts';
import type { PassId } from '../compiler/contract/pass-status.ts';
import type { RegistryManifestResolution } from '../contracts/registry-source.ts';

export interface WorkspaceResolutionResult {
  lock: LockFile;
  registryResolutions: RegistryManifestResolution[];
}

type ResolutionInput<Selection> = Readonly<{ plan: PlanFile; selection: Selection }>;

export interface WorkspaceResolutionOperations<Selection> {
  readInput(): Promise<ResolutionInput<Selection>>;
  align(input: ResolutionInput<Selection>): void | Promise<void>;
  resolve(selection: Selection): Promise<WorkspaceResolutionResult>;
  validateTemplates(lock: LockFile): Promise<void>;
  persistLock(lock: LockFile): Promise<void>;
  runPass<T>(pass: Extract<PassId, 'parse' | 'align' | 'resolve'>, execute: () => T | Promise<T>): Promise<T>;
}

/** Order one resolution request. The host retains the transaction, write lease,
 * commit fence and failure settlement; this use case neither retries nor
 * reports completion before template validation and lock persistence return. */
export async function resolveWorkspacePlan<Selection>(
  operations: WorkspaceResolutionOperations<Selection>
): Promise<WorkspaceResolutionResult & { plan: PlanFile }> {
  const { readInput, align, resolve, validateTemplates, persistLock, runPass } = operations;
  if ([readInput, align, resolve, validateTemplates, persistLock, runPass]
      .some(operation => typeof operation !== 'function')) {
    throw new TypeError('Workspace resolution operations must be callable');
  }
  // Capture methods once while retaining their original receivers.
  const pass: WorkspaceResolutionOperations<Selection>['runPass'] = runPass.bind(operations);
  const input = await pass('parse', () => readInput.call(operations));
  await pass('align', () => align.call(operations, input));
  const result = await pass('resolve', async () => {
    const resolved = await resolve.call(operations, input.selection);
    await validateTemplates.call(operations, resolved.lock);
    await persistLock.call(operations, resolved.lock);
    return resolved;
  });
  return { plan: input.plan, ...result };
}
