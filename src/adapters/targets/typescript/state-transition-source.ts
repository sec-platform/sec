import { CompilerError } from '../../../compiler/errors.ts';
import type { SemanticGeneratorPlanTask, StateTransitionMapGeneratorPlanTask } from '../../../semantics/generation/types.ts';
import { compareCodeUnits } from '../../../contracts/canonical.ts';
import { assertStateTransitionFunctions } from '../../../compiler/state-transition-plan.ts';
import { CodeBuilder } from './code-builder.ts';

// Pure generation is independent of workspace mutation and retained providers.
// The lowering owner still owns plan/IR admission, paths, writes and readback.
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


/** Shared target method for in-memory generation and workspace publication. */
export function renderTypeScriptSemanticTask(task: SemanticGeneratorPlanTask): string {
  switch (task.kind) {
    case 'generate-state-transition-map': return renderStateTransitionMapSource(task);
    default: throw new CompilerError('GENERATOR-LOWER-009', 'Unsupported Semantic Generator task kind');
  }
}
