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
import { assertUniqueSemanticOutputPaths } from './semantic-output-paths.ts';
import { assertStateTransitionFunctions } from './state-transition-plan.ts';

function constantPrefix(stateId: string): string {
  return stateId.replace(/[^a-zA-Z0-9]+/gu, '_').replace(/^_+|_+$/gu, '').toUpperCase();
}

export function renderStateTransitionMapSource(
  task: StateTransitionMapGeneratorPlanTask
): string {
  assertStateTransitionFunctions([task]);
  const prefix = constantPrefix(task.stateId);
  const boundType = task.typeBinding.name;
  const nextByValue = new Map(task.transitions.map((transition) => [transition.from, transition.to]));
  const values = [...task.stateValues].sort(compareCodeUnits);
  const transitions = [...task.transitions]
    .map(({ operationEntityId: _operationEntityId, ...transition }) => transition)
    .sort((left, right) =>
      compareCodeUnits(left.from, right.from) || compareCodeUnits(left.to, right.to) || compareCodeUnits(left.by, right.by)
    );

  const valueInitializer = `${JSON.stringify(values)} as const satisfies readonly ${boundType}[]`;
  const transitionInitializer = `${JSON.stringify(transitions, null, 2)} as const`;
  const nextEntries = values.map((value) => [value, nextByValue.get(value)!] as const);
  // Object-literal __proto__ has special semantics. Emit that one property
  // as computed data; ordinary JSON key ordering and spelling stay unchanged.
  const nextProperties = Object.entries(Object.fromEntries(nextEntries)).map(([value, next]) =>
    `  ${value === '__proto__' ? `[${JSON.stringify(value)}]` : JSON.stringify(value)}: ${JSON.stringify(next)}`
  );
  const nextLiteral = nextProperties.length === 0 ? '{}' : `{\n${nextProperties.join(',\n')}\n}`;
  const nextInitializer = `${nextLiteral} as const satisfies Record<${boundType}, ${boundType}>`;

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

type LoweringContext = Pick<PipelineSemanticContext, 'transactionId' | 'inputRevision' | 'semanticRevision' | 'snapshot' | 'generatorPlan'>;

function assertPlanOwnership(context: LoweringContext): void {
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
    default:
      throw new CompilerError('GENERATOR-LOWER-009', 'Unsupported Semantic Generator task kind');
  }
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
  const capturedIr = snapshot.ir;
  // The declarative plan is copied once before effects. The validated IR stays
  // with its original owner; no cloned object pretends to carry IR authority.
  const plan = structuredClone(generatorPlan);
  const bound = Object.freeze({ transactionId, inputRevision, semanticRevision, snapshot, generatorPlan: plan });
  if (snapshot.ir !== capturedIr) throw new CompilerError('GENERATOR-LOWER-006', 'Semantic lowering IR identity changed during admission');
  assertPlanOwnership(bound);
  for (const task of plan.tasks) {
    if (task.kind !== 'generate-state-transition-map') {
      throw new CompilerError('GENERATOR-LOWER-009', 'Unsupported Semantic Generator task kind');
    }
  }
  assertUniqueSemanticOutputPaths(plan.tasks);
  assertStateTransitionFunctions(plan.tasks);
  // All path/identity/state decisions are admitted before the first write.
  // Rendering stays per-file: this is not a claim of crash-atomic batch output.
  const prepared = plan.tasks.map(task => {
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
    // Reuse the retained snapshot/revision, not the caller's possibly replaced
    // context fields. The full IR validator remains the snapshot owner's job.
    if (snapshot.ir !== capturedIr || capturedIr.inputRevision !== inputRevision || capturedIr.semanticRevision !== semanticRevision) {
      throw new CompilerError('GENERATOR-LOWER-006', 'Semantic lowering IR revision changed during publication');
    }
  };
  for (const { task, targetPath } of prepared) {
    await writeText(targetPath, renderTask(task), fence);
    generatedPaths.push(path.relative(workspaceRoot, targetPath).replaceAll(path.sep, '/'));
    tasks.push({
      ...task,
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
