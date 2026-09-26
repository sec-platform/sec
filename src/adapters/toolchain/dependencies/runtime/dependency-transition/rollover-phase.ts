import { FailureError } from '../../../../../contracts/failure.ts';
import type { GeneratedStatePhysicalIdentity } from '../../../../runtime-state/generated-state/contract.ts';
import type { DependencyTransitionJournal } from './contract.ts';
import { sameGeneratedStateIdentity } from './contract.ts';

/** Ordered protocol decisions, not physical effects. Identity, filename grammar,
 * legal receipt shapes, history prefixes and recovery residue all derive here.
 * Published and retiring have equal shapes but remain distinct owner decisions.
 */
export const DEPENDENCY_ROLLOVER_PHASES = Object.freeze([
  Object.freeze({ phase: 'prepared', archive: false, next: false, published: false, disposed: false, nextResidue: true }),
  Object.freeze({ phase: 'staged', archive: false, next: true, published: false, disposed: false, nextResidue: true }),
  Object.freeze({ phase: 'backed-up', archive: true, next: true, published: false, disposed: false, nextResidue: true }),
  Object.freeze({ phase: 'published', archive: true, next: false, published: true, disposed: false, nextResidue: false }),
  Object.freeze({ phase: 'retiring', archive: true, next: false, published: true, disposed: false, nextResidue: false }),
  Object.freeze({ phase: 'retired', archive: false, next: false, published: true, disposed: true, nextResidue: false }),
  Object.freeze({ phase: 'complete', archive: false, next: false, published: true, disposed: true, nextResidue: false })
] as const);

export type DependencyTransitionRolloverPhase = (typeof DEPENDENCY_ROLLOVER_PHASES)[number]['phase'];
export const DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA = 'sec-dependency-transition-rollover-v1' as const;

export interface DependencyTransitionRolloverIntent {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA;
  readonly intentDigest: `sha256:${string}`;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly phase: DependencyTransitionRolloverPhase;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly recordsRootPath: string;
  readonly sourceRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly retiredRecordsPath: string;
  readonly retiredRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly retiredRecordsDisposed: boolean;
  readonly nextRecordsPath: string;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly publishedRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly terminalRecordDigest: `sha256:${string}`;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournal;
}


const phaseIndex = new Map<string, number>(DEPENDENCY_ROLLOVER_PHASES.map((state, index) => [state.phase, index]));
const intentName = new RegExp(`^rollover-[0-9a-f]{64}-(${DEPENDENCY_ROLLOVER_PHASES.map(state => state.phase).join('|')})\\.json$`, 'u');

export function rolloverPhaseIndex(value: unknown): number {
  return typeof value === 'string' ? phaseIndex.get(value) ?? -1 : -1;
}
export function isRolloverPhase(value: unknown): value is DependencyTransitionRolloverPhase {
  return rolloverPhaseIndex(value) >= 0;
}
export function rolloverIntentNameMatches(name: string): boolean { return intentName.test(name); }
export function rolloverMayOwnNextResidue(phase: DependencyTransitionRolloverPhase): boolean {
  return DEPENDENCY_ROLLOVER_PHASES[rolloverPhaseIndex(phase)]?.nextResidue === true;
}

export function matchesRolloverPhaseState(intent: DependencyTransitionRolloverIntent): boolean {
  const expected = DEPENDENCY_ROLLOVER_PHASES[rolloverPhaseIndex(intent.phase)];
  if (expected === undefined ||
      (intent.retiredRecordsPhysical !== null) !== expected.archive ||
      (intent.nextRecordsPhysical !== null) !== expected.next ||
      (intent.publishedRecordsRootPhysical !== null) !== expected.published ||
      intent.retiredRecordsDisposed !== expected.disposed) return false;
  // An archive is the source moved, never a new unrelated physical directory.
  return intent.retiredRecordsPhysical === null ||
    sameGeneratedStateIdentity(intent.retiredRecordsPhysical, intent.sourceRecordsRootPhysical);
}

function equalPhysical(
  left: DependencyTransitionRolloverIntent['nextRecordsPhysical'],
  right: DependencyTransitionRolloverIntent['nextRecordsPhysical']
): boolean {
  return left === null ? right === null : right !== null && sameGeneratedStateIdentity(left, right);
}

/** Each already-decoded receipt must continue the same physical generation.
 * Matching stable digests alone cannot authenticate phase-specific identities.
 */
export function assertRolloverPhaseAdvance(
  previous: DependencyTransitionRolloverIntent,
  next: DependencyTransitionRolloverIntent
): void {
  const fail = (): never => { throw new FailureError('RUNTIME-DEPS-004', 'Dependency transition rollover phase continuity is invalid'); };
  if (!matchesRolloverPhaseState(previous) || !matchesRolloverPhaseState(next) ||
      rolloverPhaseIndex(next.phase) !== rolloverPhaseIndex(previous.phase) + 1 ||
      next.intentDigest !== previous.intentDigest || next.sequence !== previous.sequence ||
      next.previousIntentDigest !== previous.previousIntentDigest ||
      next.ownerRoot !== previous.ownerRoot || next.recordsRootPath !== previous.recordsRootPath ||
      next.retiredRecordsPath !== previous.retiredRecordsPath || next.nextRecordsPath !== previous.nextRecordsPath ||
      next.terminalRecordDigest !== previous.terminalRecordDigest || next.ledgerDigest !== previous.ledgerDigest ||
      next.recordCount !== previous.recordCount || next.checkpoint.recordDigest !== previous.checkpoint.recordDigest ||
      !sameGeneratedStateIdentity(next.ownerRootPhysical, previous.ownerRootPhysical) ||
      !sameGeneratedStateIdentity(next.sourceRecordsRootPhysical, previous.sourceRecordsRootPhysical)) fail();
  if (previous.nextRecordsPhysical !== null) {
    // The staged directory survives the source move, then becomes canonical.
    const current = next.nextRecordsPhysical ?? next.publishedRecordsRootPhysical;
    if (!equalPhysical(previous.nextRecordsPhysical, current)) fail();
  }
  if (previous.publishedRecordsRootPhysical !== null &&
      !equalPhysical(previous.publishedRecordsRootPhysical, next.publishedRecordsRootPhysical)) fail();
  if (previous.retiredRecordsPhysical !== null && next.retiredRecordsPhysical !== null &&
      !equalPhysical(previous.retiredRecordsPhysical, next.retiredRecordsPhysical)) fail();
}
