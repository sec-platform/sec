import type { SemanticGeneratorPlan, SemanticGeneratorPlanTask } from '../semantics/generation/types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../semantics/engineering-ir/validated-types.ts';
import { deepFreeze } from '../contracts/canonical.ts';
import { CompilerError } from './errors.ts';
import { indexValidatedEngineeringIR } from './ir/index-engineering-ir.ts';
import { assertUniqueSemanticOutputPaths } from './semantic-output-paths.ts';
import { assertStateTransitionFunctions } from './state-transition-plan.ts';

export interface SemanticLoweringInput {
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly generatorPlan: SemanticGeneratorPlan;
}

/** Plan admission is pure. A prepared value neither grants a workspace write
 * nor claims that a target has been built, checked, published or executed. */
export function prepareSemanticLowering(input: SemanticLoweringInput) {
  const { inputRevision, semanticRevision, snapshot, generatorPlan } = input;
  if ([inputRevision, semanticRevision].some(value => typeof value !== 'string' || value.length === 0)) {
    throw new CompilerError('GENERATOR-LOWER-006', 'Semantic lowering requires non-empty revision identities');
  }
  const capturedIr = snapshot.ir;
  const plan = deepFreeze(structuredClone(generatorPlan));
  if (snapshot.ir !== capturedIr || plan.inputRevision !== inputRevision
      || plan.semanticRevision !== semanticRevision || capturedIr.inputRevision !== inputRevision
      || capturedIr.semanticRevision !== semanticRevision) {
    throw new CompilerError('GENERATOR-LOWER-006', 'Generator Plan does not own the supplied IR revisions');
  }
  const index = indexValidatedEngineeringIR(snapshot);
  for (const task of plan.tasks) {
    if (task.inputRevision !== inputRevision || task.semanticRevision !== semanticRevision) {
      throw new CompilerError('GENERATOR-LOWER-006', `Generator task "${task.id}" has stale IR revisions`);
    }
    if (index.entityById.get(task.generatorEntityId)?.kind !== 'generator') {
      throw new CompilerError('GENERATOR-LOWER-007', `Generator Entity "${task.generatorEntityId}" is unavailable`);
    }
    if (index.entityById.get(task.artifactEntityId)?.kind !== 'artifact') {
      throw new CompilerError('GENERATOR-LOWER-008', `Artifact Entity "${task.artifactEntityId}" is unavailable`);
    }
  }
  for (const task of plan.tasks) {
    if (task.kind !== 'generate-state-transition-map') {
      throw new CompilerError('GENERATOR-LOWER-009', 'Unsupported Semantic Generator task kind');
    }
  }
  assertUniqueSemanticOutputPaths(plan.tasks);
  assertStateTransitionFunctions(plan.tasks);
  return Object.freeze({ inputRevision, semanticRevision, snapshot, capturedIr, tasks: plan.tasks });
}

export type PreparedSemanticLowering = ReturnType<typeof prepareSemanticLowering>;

/** Recheck the retained value, never a caller's replacement context. */
export function assertSemanticLoweringCurrent(prepared: PreparedSemanticLowering): void {
  if (prepared.snapshot.ir !== prepared.capturedIr
      || prepared.capturedIr.inputRevision !== prepared.inputRevision
      || prepared.capturedIr.semanticRevision !== prepared.semanticRevision) {
    throw new CompilerError('GENERATOR-LOWER-006', 'Semantic lowering IR revision changed during publication');
  }
}

export interface SemanticArtifactMember {
  readonly task: SemanticGeneratorPlanTask;
  readonly source: string;
}

export interface SemanticArtifactSet {
  /** The set covers the selected semantic tasks, not an entire native package. */
  readonly scope: 'semantic-tasks';
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly members: readonly SemanticArtifactMember[];
}

/** Pure target generation. The target implementation is supplied by bootstrap;
 * a missing implementation is an error, not an empty success artifact. */
export function renderSemanticArtifacts(
  prepared: PreparedSemanticLowering,
  render: (task: SemanticGeneratorPlanTask) => string
): SemanticArtifactSet {
  if (typeof render !== 'function') throw new TypeError('Semantic target renderer must be callable');
  assertSemanticLoweringCurrent(prepared);
  const members = prepared.tasks.map(task => {
    const source = render(task);
    if (typeof source !== 'string') throw new TypeError('Semantic target renderer must return source text');
    assertSemanticLoweringCurrent(prepared);
    return Object.freeze({ task, source });
  });
  return Object.freeze({ scope: 'semantic-tasks', inputRevision: prepared.inputRevision,
    semanticRevision: prepared.semanticRevision, members: Object.freeze(members) });
}
