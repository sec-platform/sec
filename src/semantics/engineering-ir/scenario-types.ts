import type { SemanticEntityId } from './entity-types.ts';
import type { SemanticFactId } from './fact-types.ts';

export interface ScenarioStepDefinition {
  id: string;
  operationEntityId: SemanticEntityId;
  afterStepIds: string[];
  awaits: boolean;
  retryMaxAttempts?: number;
  onErrorStepId?: string;
}

export interface ScenarioDefinition {
  id: string;
  label: string;
  entryEntityId: SemanticEntityId;
  factIds: SemanticFactId[];
  steps: ScenarioStepDefinition[];
  acceptanceEntityIds: SemanticEntityId[];
}
