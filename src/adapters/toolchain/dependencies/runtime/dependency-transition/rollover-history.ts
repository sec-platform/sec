import path from 'node:path';
import { FailureError } from '../../../../../contracts/failure.ts';
import { sameGeneratedStateIdentity } from './contract.ts';
import type { DependencyTransitionRolloverIntent } from './rollover-phase.ts';
import {
  DEPENDENCY_ROLLOVER_PHASES, assertRolloverPhaseAdvance, matchesRolloverPhaseState,
  rolloverMayOwnNextResidue, rolloverPhaseIndex
} from './rollover-phase.ts';

type Intent = DependencyTransitionRolloverIntent;
type History = Readonly<{ active: Intent | null; latestComplete: Intent | null }>;

/** One linear index for a complete already-decoded census. No filesystem cache,
 * record issuer or repair permission. The owning caller supplies its active
 * budget check; failures and missing history are never skipped or normalized.
 */
export function analyzeRolloverHistory(
  receipts: readonly Intent[],
  residueNames: readonly string[],
  assertActive: () => void
): History {
  const fail = (message: string): never => { throw new FailureError('RUNTIME-DEPS-004', message); };
  assertActive();
  const epochs = new Map<string, Array<Intent | undefined>>();
  for (const receipt of receipts) {
    assertActive();
    const index = rolloverPhaseIndex(receipt.phase);
    if (index < 0 || !matchesRolloverPhaseState(receipt)) fail('Dependency rollover receipt phase is invalid');
    const phases = epochs.get(receipt.intentDigest) ?? [];
    if (phases[index] !== undefined) fail('Dependency transition rollover phase is duplicated');
    phases[index] = receipt;
    epochs.set(receipt.intentDigest, phases);
  }
  const latest = new Map<string, Intent>();
  const referencedNames = new Set<string>();
  for (const phases of epochs.values()) {
    assertActive();
    if (phases[0] === undefined) fail('Dependency transition rollover chain has no prepared phase');
    let previous: Intent | undefined;
    for (let index = 0; index < phases.length; index++) {
      assertActive();
      const phase = phases[index];
      if (phase === undefined || phase.phase !== DEPENDENCY_ROLLOVER_PHASES[index]?.phase) {
        fail('Dependency transition rollover chain skips a phase');
      }
      if (previous !== undefined) assertRolloverPhaseAdvance(previous, phase!);
      previous = phase;
    }
    const tip = previous!;
    latest.set(tip.intentDigest, tip);
    if (!tip.retiredRecordsDisposed) referencedNames.add(path.basename(tip.retiredRecordsPath));
    // prepared already owns its deterministic next path. A crash between mkdir
    // and publishing staged is not an unowned residue or a reason to get stuck.
    if (rolloverMayOwnNextResidue(tip.phase)) referencedNames.add(path.basename(tip.nextRecordsPath));
  }
  for (const name of residueNames) {
    assertActive();
    if (!referencedNames.has(name)) fail('Dependency transition rollover residue is foreign and preserved');
  }
  if (latest.size === 0) { assertActive(); return Object.freeze({ active: null, latestComplete: null }); }
  const children = new Map<string, Intent>();
  let root: Intent | undefined;
  for (const intent of latest.values()) {
    assertActive();
    if (intent.previousIntentDigest === null) {
      if (root !== undefined || intent.sequence !== 1) fail('Dependency transition rollover receipts have multiple or invalid roots');
      root = intent;
      continue;
    }
    const predecessor = latest.get(intent.previousIntentDigest);
    if (predecessor === undefined || predecessor.sequence !== intent.sequence - 1) {
      fail('Dependency transition rollover predecessor is missing or has an invalid sequence');
    }
    if (children.has(intent.previousIntentDigest)) fail('Dependency transition rollover predecessor has a forked child');
    if (predecessor!.phase !== 'complete') fail('An incomplete rollover cannot have a successor epoch');
    if (predecessor!.publishedRecordsRootPhysical === null ||
        !sameGeneratedStateIdentity(predecessor!.publishedRecordsRootPhysical!, intent.sourceRecordsRootPhysical) ||
        !sameGeneratedStateIdentity(predecessor!.ownerRootPhysical, intent.ownerRootPhysical) ||
        predecessor!.ownerRoot !== intent.ownerRoot || predecessor!.recordsRootPath !== intent.recordsRootPath) {
      fail('Dependency rollover epochs do not link the same physical records generation');
    }
    children.set(intent.previousIntentDigest, intent);
  }
  if (root === undefined) fail('Dependency transition rollover receipts have no root');
  const visited = new Set<string>();
  let cursor: Intent | undefined = root;
  let tip: Intent | undefined;
  let latestComplete: Intent | null = null;
  while (cursor !== undefined) {
    assertActive();
    if (visited.has(cursor.intentDigest)) fail('Dependency transition rollover receipts contain a cycle');
    visited.add(cursor.intentDigest);
    if (cursor.phase === 'complete') latestComplete = cursor;
    tip = cursor;
    cursor = children.get(cursor.intentDigest);
  }
  if (visited.size !== latest.size) fail('Dependency transition rollover receipts contain a disconnected epoch');
  assertActive();
  return Object.freeze({ active: tip!.phase === 'complete' ? null : tip!, latestComplete });
}
