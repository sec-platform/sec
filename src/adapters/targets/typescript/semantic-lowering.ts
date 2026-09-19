import path from 'node:path';

import type { SemanticGeneratorTask } from '../../../semantics/generation/types.ts';
import { uniqueSorted } from '../../../contracts/canonical.ts';
import { writeText } from "../../filesystem/files.ts";
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { isCanonicalWorkspaceArtifactPath, resolveWorkspaceArtifactPath } from "../../workspace-context.ts";
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import { renderTypeScriptSemanticTask } from './state-transition-source.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { assertSemanticLoweringCurrent, prepareSemanticLowering } from '../../../compiler/semantic-artifacts.ts';
import type { PipelineSemanticContext } from '../../../compiler/pipeline/semantic-context.ts';
export { renderStateTransitionMapSource } from './state-transition-source.ts';

export interface SemanticLoweringResult {
  generatedPaths: string[];
  tasks: SemanticGeneratorTask[];
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
    await writeText(targetPath, renderTypeScriptSemanticTask(task), fence);
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
