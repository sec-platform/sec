import { validateResolvedTemplates as validateWithComposition } from '../../adapters/verification/validate-resolved-templates.ts';
import type { LockFile } from '../../compiler/contract.ts';
import type { CommitFence } from '../../contracts/commit-fence.ts';
import type { DependencyProjectOperationFactory } from '../../execution/dependency-materialization.ts';
import { composeProject } from './project-composition.ts';

/** Bind the temporary validation scope to the application composition use case.
 * The host still owns allocation, typecheck and failure/cleanup settlement. */
export function validateResolvedTemplates(
  workspaceRoot: string,
  lock: LockFile,
  commitFence: CommitFence | undefined,
  dependencies: DependencyProjectOperationFactory
): Promise<void> {
  return validateWithComposition(workspaceRoot, lock, commitFence, dependencies,
    (root, selectedLock, semantic, fence) => composeProject(root, selectedLock, semantic, {
      commitFence: fence,
      opaqueModuleMaterializationMode: 'workspace-link'
    }));
}
