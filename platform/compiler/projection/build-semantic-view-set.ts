import type { ValidatedEngineeringIRSnapshot } from '../../shared/engineering-ir-types.ts';
import {
  SEMANTIC_VIEW_SET_FORMAT_VERSION,
  type SemanticViewSet
} from '../../shared/semantic-view-types.ts';
import { projectArchitectureView } from './project-architecture-view.ts';
import { projectScenarioView } from './project-scenario-view.ts';
import { projectStateView } from './project-state-view.ts';

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function buildSemanticViewSet(
  snapshot: ValidatedEngineeringIRSnapshot
): SemanticViewSet {
  const { ir } = snapshot;
  const scenarioIds = ir.entities
    .filter((entity) => entity.kind === 'scenario')
    .map((entity) => entity.id)
    .sort((left, right) => left.localeCompare(right));
  const stateIds = ir.entities
    .filter((entity) => entity.kind === 'state')
    .map((entity) => entity.id)
    .sort((left, right) => left.localeCompare(right));

  return deepFreeze({
    formatVersion: SEMANTIC_VIEW_SET_FORMAT_VERSION,
    inputRevision: ir.inputRevision,
    semanticRevision: ir.semanticRevision,
    views: [
      projectArchitectureView(snapshot),
      ...scenarioIds.map((scenarioId) => projectScenarioView(snapshot, scenarioId)),
      ...stateIds.map((stateId) => projectStateView(snapshot, stateId))
    ]
  });
}
