import { PASS_INITIAL_STATES, type PassId } from '../../../compiler/contract/pass-status.ts';

export const PASS_SEQUENCE: readonly PassId[] = Object.freeze(Object.keys(PASS_INITIAL_STATES) as PassId[]);
export const PASS_STATUS_PENDING = PASS_INITIAL_STATES;
