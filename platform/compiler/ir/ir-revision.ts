import { createHash } from 'node:crypto';

import {
  ENGINEERING_IR_FORMAT_VERSION,
  type ScenarioDefinition,
  type SemanticEntity,
  type SemanticFact
} from '../../shared/engineering-ir-types.ts';

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function revisionPayload(
  graphId: string,
  appId: string,
  entities: readonly SemanticEntity[],
  facts: readonly SemanticFact[],
  scenarios: readonly ScenarioDefinition[]
): string {
  return JSON.stringify({
    formatVersion: ENGINEERING_IR_FORMAT_VERSION,
    graphId,
    appId,
    entities,
    facts: facts.map(({ validFrom: _validFrom, validTo: _validTo, ...fact }) => fact),
    scenarios
  });
}
