import type { SemanticEntity, SemanticEntityId } from './entity-types.ts';
import type { SemanticFact } from './fact-types.ts';
import type { ScenarioDefinition } from './scenario-types.ts';

export const ENGINEERING_IR_FORMAT_VERSION = '1' as const;

export interface EngineeringIR {
  formatVersion: typeof ENGINEERING_IR_FORMAT_VERSION;
  graphId: string;
  revision: string;
  appId: SemanticEntityId;
  entities: SemanticEntity[];
  facts: SemanticFact[];
  scenarios: ScenarioDefinition[];
}
