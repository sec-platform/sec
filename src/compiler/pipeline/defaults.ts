import type { PassStatus } from '../contract.ts';

export const PASS_SEQUENCE = [
  'parse',
  'align',
  'resolve',
  'build-ir',
  'compose',
  'adapt',
  'verify',
  'repair',
  'lock',
  'emit'
] as const;

export const PASS_STATUS_PENDING: PassStatus = Object.freeze({
  parse: 'pending',
  align: 'pending',
  resolve: 'pending',
  'build-ir': 'pending',
  compose: 'pending',
  adapt: 'pending',
  verify: 'pending',
  repair: 'skipped',
  lock: 'pending',
  emit: 'pending'
});
