import type { SemanticEntityId } from './entity-types.ts';
import type {
  FactAssertion,
  FactAssertionId,
  SemanticFact,
  SemanticFactId
} from './fact-types.ts';
import type { ENGINEERING_IR_FORMAT_VERSION } from './root-types.ts';
import type { ValidatedEngineeringIRSnapshot } from './validated-types.ts';

export const FACT_DELTA_CONTRACT_VERSION = '1' as const;
export const FACT_DELTA_SCOPE = 'fact-set' as const;

type FactDeltaContractVersion = typeof FACT_DELTA_CONTRACT_VERSION;
type FactDeltaScope = typeof FACT_DELTA_SCOPE;
export type FactAssertionUpdateField = 'confidence' | 'evidence';

export interface FactDeltaEndpoint {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
}

export interface FactDeltaEndpointContext extends FactDeltaEndpoint {
  readonly snapshot: ValidatedEngineeringIRSnapshot;
}

export interface FactAssertionUpdate {
  readonly assertionId: FactAssertionId;
  readonly changedFields: readonly FactAssertionUpdateField[];
  readonly before: Readonly<Pick<FactAssertion, 'confidence' | 'evidence'>>;
  readonly after: Readonly<Pick<FactAssertion, 'confidence' | 'evidence'>>;
}

export interface SemanticFactChange {
  readonly factId: SemanticFactId;
  readonly addedAssertions: readonly FactAssertion[];
  readonly removedAssertions: readonly FactAssertion[];
  readonly updatedAssertions: readonly FactAssertionUpdate[];
}

export interface FactDelta {
  readonly contractVersion: FactDeltaContractVersion;
  readonly scope: FactDeltaScope;
  readonly formatVersion: typeof ENGINEERING_IR_FORMAT_VERSION;
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly from: FactDeltaEndpoint;
  readonly to: FactDeltaEndpoint;
  readonly fromFactSetDigest: string;
  readonly toFactSetDigest: string;
  readonly added: readonly SemanticFact[];
  readonly removed: readonly SemanticFact[];
  readonly changed: readonly SemanticFactChange[];
  readonly deltaRevision: string;
}
