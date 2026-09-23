import { compareCodeUnits, deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import type { SourceProgramCandidate } from './contract.ts';
import { repositoryAnalysisPolicyDigest } from './repository-analysis-policy.ts';
import type { RepositorySourceProgramCompilationReceipt } from './repository-compilation.ts';

type Digest = `sha256:${string}`;
type Snapshot = Pick<RepositorySourceProgramCompilationReceipt,
  'sourceRevision' | 'model' | 'projectGeneration' | 'moduleMembershipDigest' | 'workspaceSnapshot'>
  & Partial<Pick<RepositorySourceProgramCompilationReceipt, 'analysisPolicy'>>;

type SourceProgramFindingDeltaStatus =
  | 'introduced' | 'persistent' | 'changed' | 'absent' | 'out-of-scope' | 'unobserved';

type SourceProgramFindingDeltaEntry = Readonly<{
  identityDigest: Digest;
  code: SourceProgramCandidate['code'];
  subject: string;
  status: SourceProgramFindingDeltaStatus;
  beforePaths: readonly string[];
  afterPaths: readonly string[];
  beforeCount: number;
  afterCount: number;
  beforeEvidenceDigest: Digest | null;
  afterEvidenceDigest: Digest | null;
}>;

type SourceProgramFindingCoverage = Readonly<{
  sourceRevision: string;
  modelDigest: string;
  selectedPaths: readonly string[];
  selectedFilesDigest: Digest;
  unobservedPaths: readonly string[];
  unexpectedObservedPaths: readonly string[];
  context: Readonly<Record<string, string | null>>;
  contextDigest: Digest;
  incompleteContextFields: readonly string[];
}>;

export type SourceProgramFindingDelta = Readonly<{
  before: SourceProgramFindingCoverage;
  after: SourceProgramFindingCoverage;
  contextComparable: boolean;
  changedContextFields: readonly string[];
  scope: Readonly<{
    addedPaths: readonly string[];
    removedPaths: readonly string[];
    regressedPaths: readonly string[];
  }>;
  entries: readonly SourceProgramFindingDeltaEntry[];
  counts: Readonly<Record<SourceProgramFindingDeltaStatus, number>>;
  deltaDigest: Digest;
}>;

function sorted(values: Iterable<string>): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareCodeUnits));
}

function coverage(snapshot: Snapshot): SourceProgramFindingCoverage {
  const selected = new Map<string, string>();
  for (const { path, contentDigest } of snapshot.workspaceSnapshot.files) {
    if (selected.has(path)) throw new Error(`Finding coverage repeats a selected source path: ${path}`);
    selected.set(path, contentDigest);
  }
  const observed = new Map<string, Snapshot['model']['files'][number]>();
  for (const file of snapshot.model.files) {
    if (observed.has(file.path)) throw new Error(`Finding coverage repeats an observed source path: ${file.path}`);
    observed.set(file.path, file);
  }
  const unknownPaths = new Set(snapshot.model.unknowns.map(({ path }) => path));
  const unobservedPaths = sorted([...selected].flatMap(([path, digest]) => {
    const file = observed.get(path);
    return file === undefined || file.contentDigest !== digest
      || file.semanticObservationClass === 'unknown' || unknownPaths.has(path) ? [path] : [];
  }));
  const generation = snapshot.projectGeneration;
  // Compare the actual compiler/provider/configuration context, not the source
  // revision or the ordered source set: edits are precisely what is compared.
  // This binds only settings represented by the existing compilation receipt;
  // it neither creates an exception grant nor certifies unseen review policies.
  const context = Object.freeze({
    analysisPolicyDigest: repositoryAnalysisPolicyDigest(snapshot.analysisPolicy),
    compilerRevision: generation.compilerRevision,
    providerRevision: generation.providerRevision,
    compilerConfigDigest: generation.compilerConfigDigest,
    dependencyGenerationDigest: generation.dependencyGenerationDigest,
    environmentDigest: generation.environmentDigest,
    projectConfigDigest: generation.projectConfigDigest,
    moduleMembershipDigest: snapshot.moduleMembershipDigest,
    providersDigest: sha256([...snapshot.model.providers].sort((left, right) =>
      compareCodeUnits(left.id, right.id) || compareCodeUnits(left.revision, right.revision)))
  });
  return deepFreeze({
    sourceRevision: snapshot.sourceRevision,
    modelDigest: snapshot.model.modelDigest,
    selectedPaths: sorted(selected.keys()),
    selectedFilesDigest: sha256([...selected].sort(([left], [right]) => compareCodeUnits(left, right))) as Digest,
    unobservedPaths,
    unexpectedObservedPaths: sorted([...observed.keys()].filter(path => !selected.has(path))),
    context,
    incompleteContextFields: context.analysisPolicyDigest === null ? ['analysisPolicyDigest'] : [],
    contextDigest: sha256(context) as Digest
  });
}

type FindingGroup = {
  code: SourceProgramCandidate['code'];
  subject: string;
  paths: Set<string>;
  observations: Array<Readonly<{ paths: readonly string[]; reason: string; observationClass: 'derived' | 'unknown' }>>;
};

function groups(candidates: readonly SourceProgramCandidate[]): Map<string, FindingGroup> {
  const result = new Map<string, FindingGroup>();
  for (const candidate of candidates) {
    // Location/detail/revision evidence does not define the rule/subject. A
    // moved or changed observation is not automatically a resolved old defect.
    const key = JSON.stringify([candidate.code, candidate.subject]);
    let group = result.get(key);
    if (group === undefined) {
      group = { code: candidate.code, subject: candidate.subject, paths: new Set(), observations: [] };
      result.set(key, group);
    }
    const paths = sorted(candidate.paths);
    for (const path of paths) group.paths.add(path);
    // Keep occurrence multiplicity: duplicated producer output is observable.
    group.observations.push(Object.freeze({ paths, reason: candidate.reason,
      observationClass: candidate.observationClass }));
  }
  return result;
}

function evidence(group: FindingGroup | undefined): Digest | null {
  if (group === undefined) return null;
  // An order-independent multiset, not a set that discards repeated findings.
  return sha256(group.observations.map(value => sha256(value)).sort(compareCodeUnits)) as Digest;
}

/** Compare already-produced facts. This does not scan source, authorize
 * exceptions or issue repository-compilation receipts. The reconciliation
 * owner authenticates both receipts before invoking it. 'Absent' means not
 * reported under comparable covered inputs, never permission to delete code
 * or a proof that a semantic defect has been fixed. */
export function compileSourceProgramFindingDelta(before: Snapshot, after: Snapshot): SourceProgramFindingDelta {
  const beforeCoverage = coverage(before), afterCoverage = coverage(after);
  const changedContextFields = sorted(Object.keys(beforeCoverage.context).filter(key =>
    beforeCoverage.context[key] !== afterCoverage.context[key]));
  const contextComparable = changedContextFields.length === 0
    && beforeCoverage.incompleteContextFields.length === 0
    && afterCoverage.incompleteContextFields.length === 0;
  const beforePaths = new Set(beforeCoverage.selectedPaths), afterPaths = new Set(afterCoverage.selectedPaths);
  const beforeUnknown = new Set(beforeCoverage.unobservedPaths), afterUnknown = new Set(afterCoverage.unobservedPaths);
  const beforeGroups = groups(before.model.candidates), afterGroups = groups(after.model.candidates);
  const entries: SourceProgramFindingDeltaEntry[] = [];
  const counts: Record<SourceProgramFindingDeltaStatus, number> = {
    introduced: 0, persistent: 0, changed: 0, absent: 0, 'out-of-scope': 0, unobserved: 0
  };
  for (const key of sorted([...beforeGroups.keys(), ...afterGroups.keys()])) {
    const old = beforeGroups.get(key), current = afterGroups.get(key);
    const identity = current ?? old!;
    const oldPaths = sorted(old?.paths ?? []), currentPaths = sorted(current?.paths ?? []);
    const oldDigest = evidence(old), currentDigest = evidence(current);
    let status: SourceProgramFindingDeltaStatus;
    if (old === undefined) status = 'introduced';
    else if (current !== undefined) status = oldDigest === currentDigest ? 'persistent' : 'changed';
    else if (oldPaths.length > 0 && oldPaths.every(path => !afterPaths.has(path))) status = 'out-of-scope';
    else if (!contextComparable || oldPaths.length === 0
      || oldPaths.some(path => !beforePaths.has(path) || beforeUnknown.has(path)
        || !afterPaths.has(path) || afterUnknown.has(path))) status = 'unobserved';
    else status = 'absent';
    counts[status] += 1;
    entries.push(deepFreeze({ identityDigest: sha256({ code: identity.code, subject: identity.subject }) as Digest,
      code: identity.code, subject: identity.subject, status,
      beforePaths: oldPaths, afterPaths: currentPaths,
      beforeCount: old?.observations.length ?? 0, afterCount: current?.observations.length ?? 0,
      beforeEvidenceDigest: oldDigest, afterEvidenceDigest: currentDigest }));
  }
  const unsigned = deepFreeze({
    before: beforeCoverage, after: afterCoverage, contextComparable, changedContextFields,
    scope: {
      addedPaths: sorted([...afterPaths].filter(path => !beforePaths.has(path))),
      removedPaths: sorted([...beforePaths].filter(path => !afterPaths.has(path))),
      regressedPaths: sorted(afterCoverage.unobservedPaths.filter(path =>
        !beforePaths.has(path) || !beforeUnknown.has(path)))
    },
    entries, counts
  });
  return deepFreeze({ ...unsigned, deltaDigest: sha256(unsigned) as Digest });
}

/** Compact and full audit output carry the same comparison decisions. Only
 * the detailed records are projected out; coverage gaps are still explicit. */
export function summarizeSourceProgramFindingDelta(delta: SourceProgramFindingDelta) {
  return deepFreeze({
    before: { sourceRevision: delta.before.sourceRevision, modelDigest: delta.before.modelDigest,
      selectedFilesDigest: delta.before.selectedFilesDigest, contextDigest: delta.before.contextDigest,
      incompleteContextFields: delta.before.incompleteContextFields },
    after: { sourceRevision: delta.after.sourceRevision, modelDigest: delta.after.modelDigest,
      selectedFilesDigest: delta.after.selectedFilesDigest, contextDigest: delta.after.contextDigest,
      incompleteContextFields: delta.after.incompleteContextFields },
    contextComparable: delta.contextComparable, changedContextFields: delta.changedContextFields,
    scope: delta.scope, counts: delta.counts,
    unobservedPaths: delta.after.unobservedPaths,
    unexpectedObservedPaths: delta.after.unexpectedObservedPaths,
    deltaDigest: delta.deltaDigest
  });
}

/** A scope removal is disclosed but is not a deletion admission. Regressed
 * observations on selected input and unjustified disappearance are unresolved;
 * downstream retirement and known-violation policies remain independently active. */
export function sourceProgramFindingDeltaIsUnresolved(delta: SourceProgramFindingDelta): boolean {
  return delta.before.incompleteContextFields.length > 0 || delta.after.incompleteContextFields.length > 0
    || delta.scope.regressedPaths.length > 0 || delta.after.unexpectedObservedPaths.length > 0
    || delta.counts.unobserved > 0;
}
