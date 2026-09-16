import type { ValidatedEngineeringIRSnapshot } from '../../semantic/engineering-ir/contract/validated-types.ts';
import { SEMANTIC_VIEW_SET_FORMAT_VERSION, type SemanticViewSet } from '../../semantic/projection/contract/types.ts';
import { compareCodeUnits, deepFreeze } from '../../system-architecture/foundation/runtime/canonical.ts';
import { projectArchitectureView } from './project-architecture-view.ts';
import { projectScenarioView } from './project-scenario-view.ts';
import { projectStateView } from './project-state-view.ts';

export function buildSemanticViewSet(
  snapshot: ValidatedEngineeringIRSnapshot
): SemanticViewSet {
  const { ir } = snapshot;
  const scenarioIds = ir.entities
    .filter((entity) => entity.kind === 'scenario')
    .map((entity) => entity.id)
    .sort(compareCodeUnits);
  const stateIds = ir.entities
    .filter((entity) => entity.kind === 'state')
    .map((entity) => entity.id)
    .sort(compareCodeUnits);

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
