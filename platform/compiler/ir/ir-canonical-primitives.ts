/**
 * Canonical comparison, hashing and normalization primitives — compiler IR
 * re-export surface.
 *
 * The single canonical owner lives at `../../shared/canonical-primitives.ts`
 * so that every platform layer (shared, compiler IR, semantic mutation,
 * verification, impact) shares one byte-stable implementation. This file
 * re-exports that owner for backward-compatible imports within the compiler
 * subsystem. New compiler code SHOULD import directly from the shared owner;
 * this re-export exists to keep the existing call sites stable.
 */

export {
  canonicalJson,
  cloneAndDeepFreeze,
  compareCodeUnits,
  deepFreeze,
  digest,
  isPlainObject,
  normalizedArtifactTarget,
  sha256,
  stableById,
  uniqueSorted,
  uniqueSortedByKey
} from '../../shared/canonical-primitives.ts';
