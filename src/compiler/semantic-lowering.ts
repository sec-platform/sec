import path from 'node:path';

import type { SemanticGeneratorPlanTask, SemanticGeneratorTask, StateTransitionMapGeneratorPlanTask } from '../semantic/generation/contract/types.ts';
import { compareCodeUnits, uniqueSorted } from '../system-architecture/foundation/runtime/canonical.ts';
import { writeText, type CommitFence } from '../workspace/files.ts';
import {
  isCanonicalWorkspaceArtifactPath,
  resolvePathInside,
  resolveWorkspaceArtifactPath
} from '../workspace/runtime/paths.ts';
import { CodeBuilder } from './codegen/code-builder.ts';
import { CompilerError } from './errors.ts';
import { indexValidatedEngineeringIR } from './ir/index-engineering-ir.ts';
import type { PipelineSemanticContext } from './pipeline/types.ts';

function constantPrefix(stateId: string): string {
  return stateId.replace(/[^a-zA-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').toUpperCase();
}

export function renderStateTransitionMapSource(
  task: StateTransitionMapGeneratorPlanTask
): string {
  const prefix = constantPrefix(task.stateId);
  const boundType = task.typeBinding.name;
  const nextByValue = new Map(task.transitions.map((transition) => [transition.from, transition.to]));
  const values = [...task.stateValues].sort(compareCodeUnits);
  const transitions = [...task.transitions]
    .map(({ operationEntityId: _operationEntityId, ...transition }) => transition)
    .sort((left, right) =>
      compareCodeUnits(`${left.from}:${left.to}:${left.by}`, `${right.from}:${right.to}:${right.by}`)
    );

  const valueInitializer = `${JSON.stringify(values)} as const satisfies readonly ${boundType}[]`;
  const transitionInitializer = `${JSON.stringify(transitions, null, 2)} as const`;
  const nextEntries = values.map((value) => [value, nextByValue.get(value)!] as const);
  const nextInitializer = `${JSON.stringify(
    Object.fromEntries(nextEntries),
    null,
    2
  )} as const satisfies Record<${boundType}, ${boundType}>`;

  return new CodeBuilder(task.target)
    .addFileComment(`@generated semantic-task:${task.id} contract:${task.contractId} state:${task.stateId}`)
    .addImport({
      moduleSpecifier: task.typeBinding.importFrom,
      namedImports: [boundType],
      isTypeOnly: true
    })
    .addVariable({ name: `${prefix}_VALUES`, initializer: valueInitializer, isExported: true })
    .addVariable({ name: `${prefix}_TRANSITIONS`, initializer: transitionInitializer, isExported: true })
    .addVariable({ name: `NEXT_${prefix}`, initializer: nextInitializer, isExported: true })
    .getText();
}

export interface SemanticLoweringResult {
  generatedPaths: string[];
  tasks: SemanticGeneratorTask[];
}

function assertPlanOwnership(context: PipelineSemanticContext): void {
  const plan = context.generatorPlan;
  if (
    plan.inputRevision !== context.inputRevision ||
    plan.semanticRevision !== context.semanticRevision ||
    context.snapshot.ir.inputRevision !== context.inputRevision ||
    context.snapshot.ir.semanticRevision !== context.semanticRevision
  ) {
    throw new CompilerError(
      'GENERATOR-LOWER-006',
      `Compilation transaction "${context.transactionId}" does not own the Generator Plan revisions`
    );
  }

  const index = indexValidatedEngineeringIR(context.snapshot);
  for (const task of plan.tasks) {
    if (task.inputRevision !== context.inputRevision || task.semanticRevision !== context.semanticRevision) {
      throw new CompilerError('GENERATOR-LOWER-006', `Generator task "${task.id}" has stale IR revisions`);
    }
    if (index.entityById.get(task.generatorEntityId)?.kind !== 'generator') {
      throw new CompilerError('GENERATOR-LOWER-007', `Generator Entity "${task.generatorEntityId}" is unavailable`);
    }
    if (index.entityById.get(task.artifactEntityId)?.kind !== 'artifact') {
      throw new CompilerError('GENERATOR-LOWER-008', `Artifact Entity "${task.artifactEntityId}" is unavailable`);
    }
  }
}

function renderTask(task: SemanticGeneratorPlanTask): string {
  switch (task.kind) {
    case 'generate-state-transition-map':
      return renderStateTransitionMapSource(task);
  }
}

export async function lowerSemanticTasks(
  workspaceRoot: string,
  context: PipelineSemanticContext,
  commitFence?: CommitFence
): Promise<SemanticLoweringResult> {
  assertPlanOwnership(context);
  const generatedPaths: string[] = [];
  const tasks: SemanticGeneratorTask[] = [];

  for (const task of context.generatorPlan.tasks) {
    const targetPath = isCanonicalWorkspaceArtifactPath(task.target)
      ? resolveWorkspaceArtifactPath(workspaceRoot, task.target)
      : resolvePathInside(workspaceRoot, task.target);
    if (!targetPath) {
      throw new CompilerError('GENERATOR-LOWER-004', `Task "${task.id}" target escapes native workspace root`);
    }

    await writeText(targetPath, renderTask(task), commitFence);
    generatedPaths.push(path.relative(workspaceRoot, targetPath).replaceAll(path.sep, '/'));
    tasks.push({
      ...structuredClone(task),
      status: 'generated',
      artifactBinding: {
        generatorEntityId: task.generatorEntityId,
        artifactEntityId: task.artifactEntityId,
        semanticRevision: context.semanticRevision,
        compilationTransactionId: context.transactionId
      }
    });
  }

  return {
    generatedPaths: uniqueSorted(generatedPaths),
    tasks
  };
}
