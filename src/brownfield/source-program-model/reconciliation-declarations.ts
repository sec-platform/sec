import { compareCodeUnits } from '../../contracts/canonical.ts';
import type { SourceProgramDeclaration } from './contract.ts';

type Relation = Readonly<{ subject: string; relation: string; declaration: SourceProgramDeclaration | null }>;
type Pair = Readonly<{ before: SourceProgramDeclaration; after: SourceProgramDeclaration }>;

export function compareSourceProgramDeclarations(left: SourceProgramDeclaration, right: SourceProgramDeclaration): number {
  return left.span.start - right.span.start || left.span.end - right.span.end
    || compareCodeUnits(left.declarationDigest, right.declarationDigest)
    || compareCodeUnits(left.observationId, right.observationId);
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const group = map.get(key);
  if (group === undefined) map.set(key, [value]); else group.push(value);
}

function relationGroups(relations: readonly Relation[]): Map<string, Map<string, SourceProgramDeclaration>> {
  const groups = new Map<string, Map<string, SourceProgramDeclaration>>();
  for (const { subject, relation, declaration } of relations) {
    if (declaration === null) continue;
    const key = JSON.stringify([subject, relation]);
    let group = groups.get(key);
    if (group === undefined) { group = new Map(); groups.set(key, group); }
    group.set(declaration.observationId, declaration);
  }
  return groups;
}

function stableKey(declaration: SourceProgramDeclaration): string {
  return JSON.stringify([declaration.moduleId, declaration.name, declaration.kind, declaration.exported]);
}

function addressKey(declaration: SourceProgramDeclaration): string {
  return JSON.stringify([declaration.moduleId, declaration.path, declaration.name, declaration.kind, declaration.exported]);
}

function visibilityAddressKey(declaration: SourceProgramDeclaration): string {
  return JSON.stringify([declaration.moduleId, declaration.path, declaration.name, declaration.kind]);
}

/** Derive a one-to-one correspondence, not a supersession/retirement proof.
 * Relations may suggest a rename/move only when both ends are unambiguous.
 * Many-to-one merges and one-to-many splits remain explicit removals/additions
 * unless an exact retained address identifies a survivor. A relation must not
 * silently hide a removed declaration from the retirement owner. */
export function pairSourceProgramDeclarations(
  before: readonly SourceProgramDeclaration[], after: readonly SourceProgramDeclaration[],
  beforeRelations: readonly Relation[], afterRelations: readonly Relation[]
): ReadonlyMap<string, Pair> {
  const pairs = new Map<string, Pair>(), pairedAfter = new Set<string>();
  const pair = (old: SourceProgramDeclaration, current: SourceProgramDeclaration): void => {
    if (pairs.has(old.observationId) || pairedAfter.has(current.observationId)) {
      throw new Error('Declaration correspondence is not one-to-one');
    }
    pairs.set(old.observationId, Object.freeze({ before: old, after: current }));
    pairedAfter.add(current.observationId);
  };
  const oldRelations = relationGroups(beforeRelations), newRelations = relationGroups(afterRelations);
  const proposals = new Map<string, Map<string, SourceProgramDeclaration>>();
  const predecessors = new Map<string, Set<string>>();
  for (const [key, oldGroup] of oldRelations) {
    const newGroup = newRelations.get(key);
    if (oldGroup.size !== 1 || newGroup?.size !== 1) continue;
    const old = oldGroup.values().next().value!, current = newGroup.values().next().value!;
    let targets = proposals.get(old.observationId);
    if (targets === undefined) { targets = new Map(); proposals.set(old.observationId, targets); }
    targets.set(current.observationId, current);
    let sources = predecessors.get(current.observationId);
    if (sources === undefined) { sources = new Set(); predecessors.set(current.observationId, sources); }
    sources.add(old.observationId);
  }
  for (const old of before) {
    const targets = proposals.get(old.observationId);
    if (targets?.size !== 1) continue;
    const current = targets.values().next().value!;
    if (predecessors.get(current.observationId)?.size === 1) pair(old, current);
  }

  const oldAddresses = new Map<string, SourceProgramDeclaration[]>(), newAddresses = new Map<string, SourceProgramDeclaration[]>();
  for (const old of before) if (!pairs.has(old.observationId)) append(oldAddresses, addressKey(old), old);
  for (const current of after) if (!pairedAfter.has(current.observationId)) append(newAddresses, addressKey(current), current);
  for (const [key, group] of oldAddresses) {
    const oldGroup = [...group].sort(compareSourceProgramDeclarations);
    const newGroup = [...newAddresses.get(key) ?? []].sort(compareSourceProgramDeclarations);
    const byDigest = new Map<string, SourceProgramDeclaration[]>();
    const nextByDigest = new Map<string, number>();
    for (const current of newGroup) append(byDigest, current.declarationDigest, current);
    // Preserve first-exact-match order without a full .find for every old item.
    for (const old of oldGroup) {
      const cursor = nextByDigest.get(old.declarationDigest) ?? 0;
      const current = byDigest.get(old.declarationDigest)?.[cursor];
      if (current === undefined) continue;
      nextByDigest.set(old.declarationDigest, cursor + 1); pair(old, current);
    }
    const remaining = newGroup.filter(current => !pairedAfter.has(current.observationId));
    let cursor = 0;
    for (const old of oldGroup) {
      if (pairs.has(old.observationId)) continue;
      const current = remaining[cursor++];
      if (current === undefined) break;
      pair(old, current);
    }
  }

  const oldVisibilityAddresses = new Map<string, SourceProgramDeclaration[]>();
  const newVisibilityAddresses = new Map<string, SourceProgramDeclaration[]>();
  for (const old of before) {
    if (!pairs.has(old.observationId)) append(oldVisibilityAddresses, visibilityAddressKey(old), old);
  }
  for (const current of after) {
    if (!pairedAfter.has(current.observationId)) {
      append(newVisibilityAddresses, visibilityAddressKey(current), current);
    }
  }
  for (const [key, oldGroup] of oldVisibilityAddresses) {
    const newGroup = newVisibilityAddresses.get(key);
    if (oldGroup.length !== 1 || newGroup?.length !== 1
        || oldGroup[0]!.exported === newGroup[0]!.exported) continue;
    pair(oldGroup[0]!, newGroup[0]!);
  }

  const oldStable = new Map<string, SourceProgramDeclaration[]>(), newStable = new Map<string, SourceProgramDeclaration[]>();
  for (const old of before) if (!pairs.has(old.observationId)) append(oldStable, stableKey(old), old);
  for (const current of after) if (!pairedAfter.has(current.observationId)) append(newStable, stableKey(current), current);
  for (const [key, oldGroup] of oldStable) {
    const newGroup = newStable.get(key);
    // A unique target alone is insufficient: several old declarations with
    // the same name cannot be disambiguated by their incidental array order.
    if (oldGroup.length === 1 && newGroup?.length === 1) pair(oldGroup[0]!, newGroup[0]!);
  }
  return pairs;
}
