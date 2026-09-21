import type { EngineeringIR } from './root-types.ts';

declare const validatedEngineeringIRSnapshotBrand: unique symbol;

export interface ValidatedEngineeringIRSnapshot {
  readonly ir: EngineeringIR;
  readonly [validatedEngineeringIRSnapshotBrand]: true;
}
