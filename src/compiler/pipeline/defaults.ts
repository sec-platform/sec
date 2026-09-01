import type { PassStatus } from '../contract.ts';

export const PASS_SEQUENCE = [
  'parse',
  'align',
  'resolve',
  'build-ir',
  'compose',
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
  verify: 'pending',
  repair: 'skipped',
  lock: 'pending',
  emit: 'pending'
});
