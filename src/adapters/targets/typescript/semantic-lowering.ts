import path from 'node:path';

import { CompilerError } from '../../../compiler/errors.ts';
import type { PipelineSemanticContext } from '../../../compiler/pipeline/semantic-context.ts';
import { assertSemanticLoweringCurrent, prepareSemanticLowering } from '../../../compiler/semantic-artifacts.ts';
import { uniqueSorted } from '../../../contracts/canonical.ts';
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import type { SemanticGeneratorTask } from '../../../semantics/generation/types.ts';
import { writeText } from "../../filesystem/files.ts";
import { inspectNoFollowDirectoryChain, PhysicalNoFollowError, retainNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { isCanonicalWorkspaceArtifactPath, resolveWorkspaceArtifactPath } from "../../workspace-context.ts";
import { renderTypeScriptSemanticTask } from './state-transition-source.ts';
export { renderStateTransitionMapSource } from './state-transition-source.ts';

export interface SemanticLoweringResult {
  generatedPaths: string[];
  tasks: SemanticGeneratorTask[];
}

async function retainUnchangedSemanticTarget(targetPath: string, source: string, fence: CommitFence): Promise<boolean> {
  let target: ReturnType<typeof retainNoFollowOrdinaryFile>;
  try {
    target = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(targetPath), 'Semantic lowering target parent'),
      path.basename(targetPath), undefined, 'Semantic lowering target'
    );
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return false;
    throw error;
  }
  let unchanged = false;
  try {
    // Equal bytes do not discharge writeText's foreign hard-link detachment.
    if (target.linkCount === 1 && target.size === Buffer.byteLength(source, 'utf8')
        && Buffer.from(target.readBytes()).equals(Buffer.from(source, 'utf8'))) {
      await fence();
      target.assertCurrent();
      unchanged = true;
    }
  } catch (error) {
    try { target.dispose(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Semantic lowering no-op and retained target cleanup failed', { cause: error });
    }
    throw error;
  }
  target.dispose();
  return unchanged;
}

export async function lowerSemanticTasks(
  workspaceRoot: string,
  context: PipelineSemanticContext,
  commitFence?: CommitFence
): Promise<SemanticLoweringResult> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Semantic lowering fence must be callable');
  const { transactionId, inputRevision, semanticRevision, snapshot, generatorPlan } = context;
  if ([transactionId, inputRevision, semanticRevision].some(value => typeof value !== 'string' || value.length === 0)) {
    throw new CompilerError('GENERATOR-LOWER-006', 'Semantic lowering requires non-empty transaction and revision identities');
  }
  const lowering = prepareSemanticLowering({ inputRevision, semanticRevision, snapshot, generatorPlan });
  // All path/identity/state decisions are admitted before the first write.
  // Rendering stays per-file: this is not a claim of crash-atomic batch output.
  const prepared = lowering.tasks.map(task => {
    const targetPath = isCanonicalWorkspaceArtifactPath(task.target)
      ? resolveWorkspaceArtifactPath(workspaceRoot, task.target)
      : resolvePathInside(workspaceRoot, task.target);
    if (!targetPath) throw new CompilerError('GENERATOR-LOWER-004', `Task "${task.id}" target escapes native workspace root`);
    return Object.freeze({ task, targetPath });
  });
  const generatedPaths: string[] = [];
  const tasks: SemanticGeneratorTask[] = [];
  const fence: CommitFence = async () => {
    await commitFence?.();
    assertSemanticLoweringCurrent(lowering);
  };
  for (const { task, targetPath } of prepared) {
    const source = renderTypeScriptSemanticTask(task);
    if (!await retainUnchangedSemanticTarget(targetPath, source, fence)) {
      await writeText(targetPath, source, fence);
    }
    generatedPaths.push(path.relative(workspaceRoot, targetPath).replaceAll(path.sep, '/'));
    tasks.push({
      ...structuredClone(task),
      status: 'generated',
      artifactBinding: {
        generatorEntityId: task.generatorEntityId,
        artifactEntityId: task.artifactEntityId,
        semanticRevision,
        compilationTransactionId: transactionId
      }
    });
  }
  return { generatedPaths: uniqueSorted(generatedPaths), tasks };
}
