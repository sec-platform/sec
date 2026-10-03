import { compareCodeUnits, deepFreeze, isPlainObject, sha256 } from '../../../contracts/canonical.ts';
import { requireSourceProgramCandidateAnalysis, type SourceProgramCandidate, type SourceProgramCandidateAnalysis } from './contract.ts';
import { repositoryAnalysisPolicyDigest } from './repository-analysis-policy.ts';
import {
  assertRepositorySourceProgramCompilationReceipt,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import {
  SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES,
  type SourceProgramTestFinding, type SourceProgramTestValueCompilation
} from './test-value.ts';

type Digest = `sha256:${string}`;
type Snapshot = Pick<RepositorySourceProgramCompilationReceipt<SourceProgramCandidateAnalysis>,
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
  const beforeGroups = groups(requireSourceProgramCandidateAnalysis(before.model.candidates)), afterGroups = groups(requireSourceProgramCandidateAnalysis(after.model.candidates));
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


type TestFindingSnapshot = Readonly<{
  sourceProgram: RepositorySourceProgramCompilationReceipt<SourceProgramCandidateAnalysis>;
  tests: SourceProgramTestValueCompilation;
}>;

type TestFindingCoverage = Readonly<{
  sourceRevision: string;
  modelDigest: string;
  compilationReceiptDigest: Digest;
  testCompilationDigest: string;
  runtimeIsolation: 'unassessed' | null;
  findingsDigest: Digest;
  selectedPaths: readonly string[];
  unobservedPaths: readonly string[];
  localUnobservedInputs: readonly Readonly<{ path: string; inputDigest: string | null }>[];
  moduleMembershipDigest: string;
  sharedContextUnobserved: boolean;
  context: Readonly<Record<string, string | null>>;
  contextDigest: Digest;
  incompleteContextFields: readonly string[];
}>;

type TestFindingDeltaEntry = Readonly<{
  identityDigest: Digest;
  code: SourceProgramTestFinding['code'];
  path: string;
  status: SourceProgramFindingDeltaStatus;
  beforeFindingDigests: readonly string[];
  afterFindingDigests: readonly string[];
  beforeSubjectDigest: Digest | null;
  afterSubjectDigest: Digest | null;
}>;

/** Observed finding persistence is not test equivalence, coverage, a debt
 * waiver or retirement permission. Unknown frontiers remain in both cuts. */
export type SourceProgramTestFindingDelta = Readonly<{
  before: TestFindingCoverage;
  after: TestFindingCoverage;
  contextComparable: boolean;
  changedContextFields: readonly string[];
  changedSharedInputPaths: readonly string[];
  scope: Readonly<{
    addedPaths: readonly string[];
    removedPaths: readonly string[];
    regressedPaths: readonly string[];
  }>;
  entries: readonly TestFindingDeltaEntry[];
  counts: Readonly<Record<SourceProgramFindingDeltaStatus, number>>;
  deltaDigest: Digest;
}>;

function testReadEnvelopeDigest(
  snapshot: TestFindingSnapshot,
  envelopes: readonly Readonly<{ root: string; descendants: boolean }>[]
): Digest {
  // Include previously absent children of directory/read envelopes. Comparing
  // only the old dependency list would miss a new fixture or negative read.
  return sha256(snapshot.sourceProgram.workspaceSnapshot.files
    .filter(({ path }) => envelopes.some(({ root, descendants }) => path === root
      || descendants && (root === '.' || path.startsWith(`${root}/`))))
    .map(({ path, contentDigest }) => ({ path, contentDigest }))
    .sort((left, right) => compareCodeUnits(left.path, right.path))) as Digest;
}

function testFindingCoverage(snapshot: TestFindingSnapshot): TestFindingCoverage {
  assertRepositorySourceProgramCompilationReceipt(snapshot.sourceProgram);
  const { tests, sourceProgram } = snapshot;
  const observations = sourceProgram.testObservations;
  if (tests.sourceRevision !== sourceProgram.sourceRevision
      || sha256(tests.definitionInputs) !== sha256(observations.definitionInputs)
      || sha256(tests.definitionContext) !== sha256(observations.definitionContext)) {
    throw new Error('Test finding reconciliation requires the exact compiled test observations');
  }
  const sourceCoverage = coverage(sourceProgram);
  const definitions = new Map(tests.definitionInputs.map((inputs) => [inputs.path, inputs] as const));
  if (definitions.size !== tests.definitionInputs.length) {
    throw new Error('Test finding reconciliation repeats a definition-input path');
  }
  const selectedPaths = sorted(observations.testPaths);
  const unknownPaths = new Set(sourceCoverage.unobservedPaths);
  // The snapshot membership digest includes every selected file. Preserve it
  // below as inventory evidence, not shared semantic context: relevant owner
  // descriptors already bind every local/shared definition input moduleDigest.
  const { moduleMembershipDigest, ...sharedAnalysisContext } = sourceCoverage.context;
  const context = Object.freeze({ ...sharedAnalysisContext,
    testDefinitionContextDigest: tests.definitionContext?.contextDigest ?? null,
    testDefinitionContextReadSetDigest: tests.definitionContext === null ? null
      : testReadEnvelopeDigest(snapshot, tests.definitionContext.readEnvelopes) });
  const localUnobservedPaths = sorted(selectedPaths.filter(path => {
    const inputs = definitions.get(path);
    return inputs === undefined || unknownPaths.has(path)
      || inputs.unresolved.length > 0
      || tests.records.some(record => record.path === path && record.unknowns.length > 0)
      || tests.findings.some(finding => finding.path === path
        && finding.code === 'test-observation-receipt-unresolved');
  }));
  const localUnobservedInputs = Object.freeze(localUnobservedPaths.map(path => Object.freeze({
    path, inputDigest: definitions.get(path)?.inputDigest ?? null
  })));
  const sharedContextUnobserved = tests.definitionContext === null
    || tests.definitionContext.unresolved.length > 0 || tests.definitionContext.hasUnknownReadScope;
  const unobservedPaths = sharedContextUnobserved ? selectedPaths : localUnobservedPaths;
  return deepFreeze({
    sourceRevision: sourceProgram.sourceRevision,
    modelDigest: sourceProgram.model.modelDigest,
    compilationReceiptDigest: sourceProgram.receiptDigest,
    testCompilationDigest: tests.compilationDigest,
    runtimeIsolation: tests.definitionContext?.runtimeIsolation ?? null,
    findingsDigest: sha256(tests.findings.map(finding => sha256(finding)).sort(compareCodeUnits)) as Digest,
    selectedPaths, unobservedPaths, localUnobservedInputs, sharedContextUnobserved,
    moduleMembershipDigest: moduleMembershipDigest!, context,
    contextDigest: sha256(context) as Digest,
    incompleteContextFields: sorted([...sourceCoverage.incompleteContextFields,
      ...(tests.definitionContext === null ? ['testDefinitionContextDigest'] : [])])
  });
}

function testFindingGroups(snapshot: TestFindingSnapshot) {
  const { tests } = snapshot;
  const definitions = new Map(tests.definitionInputs.map(inputs => [inputs.path, inputs] as const));
  const readSets = new Map<string, Digest>();
  const result = new Map<string, {
    code: SourceProgramTestFinding['code']; path: string;
    findingDigests: string[]; subjectDigests: string[];
  }>();
  for (const finding of tests.findings) {
    const key = JSON.stringify([finding.code, finding.path]);
    let group = result.get(key);
    if (group === undefined) {
      group = { code: finding.code, path: finding.path, findingDigests: [], subjectDigests: [] };
      result.set(key, group);
    }
    group.findingDigests.push(sha256(finding));
    // The containing registration and full conservative module/read closure
    // bind helpers, fixtures, imported subjects and negative inputs. A matching
    // code/path/detail alone cannot grandfather a newly changed bad oracle.
    const registrations = tests.records.filter(record => record.path === finding.path
      && (finding.span === null || record.span.start <= finding.span.start
        && record.span.end >= finding.span.end));
    const definition = definitions.get(finding.path);
    if (definition !== undefined && !readSets.has(finding.path)) {
      readSets.set(finding.path, testReadEnvelopeDigest(snapshot, definition.readEnvelopes));
    }
    group.subjectDigests.push(sha256({
      definitionInputDigest: definition?.inputDigest ?? null,
      readSetDigest: readSets.get(finding.path) ?? null,
      registrations: registrations.map(record => sha256(record)).sort(compareCodeUnits)
    }));
  }
  for (const group of result.values()) {
    group.findingDigests.sort(compareCodeUnits);
    group.subjectDigests.sort(compareCodeUnits);
  }
  return result;
}

/** Exact finite shared-input intersection, including excluded/negative paths.
 * The source producer supplies the real Git delta; no input values are read. */
export function sourceProgramTestChangedSharedInputPaths(
  contexts: readonly SourceProgramTestValueCompilation['definitionContext'][],
  changedPaths: readonly string[]
): readonly string[] {
  const paths = new Set(contexts.flatMap(context => context?.inputs.map(({ path }) => path) ?? []));
  const envelopes = contexts.flatMap(context => context?.readEnvelopes ?? []);
  return sorted(changedPaths.filter(path => paths.has(path)
    || envelopes.some(({ root, descendants }) => path === root
      || descendants && (root === '.' || path.startsWith(`${root}/`)))));
}

function regressedTestFindingCoveragePaths(
  before: TestFindingCoverage, after: TestFindingCoverage, changedSharedInputPaths: readonly string[]
): readonly string[] {
  const beforeLocal = new Map(before.localUnobservedInputs.map(input => [input.path, input.inputDigest] as const));
  const afterLocal = new Map(after.localUnobservedInputs.map(input => [input.path, input.inputDigest] as const));
  const unchangedSharedDebt = before.sharedContextUnobserved && after.sharedContextUnobserved
    && before.contextDigest === after.contextDigest && changedSharedInputPaths.length === 0;
  return sorted(after.unobservedPaths.filter(path => {
    // Aggregate unknown membership is not frontier identity. New/changed local
    // uncertainty cannot hide behind an old shared-context unknown flag.
    if (afterLocal.has(path) && (!beforeLocal.has(path)
        || afterLocal.get(path) !== beforeLocal.get(path))) return true;
    return after.sharedContextUnobserved && !unchangedSharedDebt;
  }));
}

/** Reconcile actual baseline/current compilations, never a synthetic empty
 * baseline or a Supersession status. Exact unchanged unknown observations are
 * retained inventory; their disappearance is unobserved, not resolution. */
export function compileSourceProgramTestFindingDelta(
  before: TestFindingSnapshot,
  after: TestFindingSnapshot,
  changedPaths: readonly string[]
): SourceProgramTestFindingDelta {
  const changedSharedInputPaths = sourceProgramTestChangedSharedInputPaths(
    [before.tests.definitionContext, after.tests.definitionContext], changedPaths);
  const beforeCoverage = testFindingCoverage(before), afterCoverage = testFindingCoverage(after);
  const changedContextFields = sorted(Object.keys(beforeCoverage.context).filter(key =>
    beforeCoverage.context[key] !== afterCoverage.context[key]));
  const contextComparable = changedContextFields.length === 0 && changedSharedInputPaths.length === 0
    && beforeCoverage.incompleteContextFields.length === 0
    && afterCoverage.incompleteContextFields.length === 0;
  const beforePaths = new Set(beforeCoverage.selectedPaths), afterPaths = new Set(afterCoverage.selectedPaths);
  const beforeUnknown = new Set(beforeCoverage.unobservedPaths), afterUnknown = new Set(afterCoverage.unobservedPaths);
  const beforeGroups = testFindingGroups(before), afterGroups = testFindingGroups(after);
  const entries: TestFindingDeltaEntry[] = [];
  const counts: Record<SourceProgramFindingDeltaStatus, number> = {
    introduced: 0, persistent: 0, changed: 0, absent: 0, 'out-of-scope': 0, unobserved: 0
  };
  for (const key of sorted([...beforeGroups.keys(), ...afterGroups.keys()])) {
    const old = beforeGroups.get(key), current = afterGroups.get(key), identity = current ?? old!;
    const oldSubjectDigest = old === undefined ? null : sha256(old.subjectDigests) as Digest;
    const currentSubjectDigest = current === undefined ? null : sha256(current.subjectDigests) as Digest;
    let status: SourceProgramFindingDeltaStatus;
    if (old === undefined) status = 'introduced';
    else if (current !== undefined) status = contextComparable
      && sha256(old.findingDigests) === sha256(current.findingDigests)
      && oldSubjectDigest === currentSubjectDigest ? 'persistent' : 'changed';
    else if (!afterPaths.has(identity.path)) status = 'out-of-scope';
    else if (!contextComparable || !beforePaths.has(identity.path)
      || beforeUnknown.has(identity.path) || afterUnknown.has(identity.path)) status = 'unobserved';
    else status = 'absent';
    counts[status] += 1;
    entries.push(deepFreeze({
      identityDigest: sha256({ code: identity.code, path: identity.path }) as Digest,
      code: identity.code, path: identity.path, status,
      beforeFindingDigests: old?.findingDigests ?? [], afterFindingDigests: current?.findingDigests ?? [],
      beforeSubjectDigest: oldSubjectDigest, afterSubjectDigest: currentSubjectDigest
    }));
  }
  const unsigned = deepFreeze({
    before: beforeCoverage, after: afterCoverage, contextComparable, changedContextFields, changedSharedInputPaths,
    scope: {
      addedPaths: sorted([...afterPaths].filter(path => !beforePaths.has(path))),
      removedPaths: sorted([...beforePaths].filter(path => !afterPaths.has(path))),
      regressedPaths: regressedTestFindingCoveragePaths(beforeCoverage, afterCoverage, changedSharedInputPaths)
    }, entries, counts
  });
  return deepFreeze({ ...unsigned, deltaDigest: sha256(unsigned) as Digest });
}

/** A fact projection may cross the authenticated producer boundary. Validate
 * its complete canonical comparison, never treat its hash as author authority. */
export function assertSourceProgramTestFindingDelta(
  input: unknown,
  findings?: readonly SourceProgramTestFinding[]
): asserts input is SourceProgramTestFindingDelta {
  const fail = (): never => { throw new Error('Test finding reconciliation is not an exact canonical comparison'); };
  const exact = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!isPlainObject(value) || sha256(Object.keys(value).sort(compareCodeUnits)) !== sha256([...keys].sort(compareCodeUnits))) fail();
    return value as Record<string, unknown>;
  };
  const digest = (value: unknown): value is Digest => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
  const strings = (value: unknown, unique = true): value is readonly string[] =>
    Array.isArray(value) && value.every(entry => typeof entry === 'string' && entry.length > 0)
      && (!unique || new Set(value).size === value.length)
      && sha256(value) === sha256([...value].sort(compareCodeUnits));
  const contextKeys = ['analysisPolicyDigest', 'compilerRevision', 'providerRevision', 'compilerConfigDigest',
    'dependencyGenerationDigest', 'environmentDigest', 'projectConfigDigest',
    'providersDigest', 'testDefinitionContextDigest', 'testDefinitionContextReadSetDigest'];
  const cut = (value: unknown): TestFindingCoverage => {
    const record = exact(value, ['sourceRevision', 'modelDigest', 'compilationReceiptDigest', 'testCompilationDigest',
      'runtimeIsolation', 'findingsDigest', 'selectedPaths', 'unobservedPaths', 'localUnobservedInputs', 'sharedContextUnobserved', 'moduleMembershipDigest', 'context', 'contextDigest', 'incompleteContextFields']);
    for (const key of ['sourceRevision', 'modelDigest', 'compilationReceiptDigest', 'testCompilationDigest', 'findingsDigest', 'contextDigest', 'moduleMembershipDigest']) {
      if (!digest(record[key])) fail();
    }
    if (!Array.isArray(record.localUnobservedInputs)) fail();
    const localInputs = (record.localUnobservedInputs as unknown[]).map(value => {
      const input = exact(value, ['path', 'inputDigest']);
      if (typeof input.path !== 'string' || input.path.length === 0
          || input.inputDigest !== null && !digest(input.inputDigest)) fail();
      return input as { path: string; inputDigest: string | null };
    });
    const localPaths = localInputs.map(({ path }) => path);
    const context = exact(record.context, contextKeys);
    if (Object.values(context).some(entry => entry !== null && (typeof entry !== 'string' || entry.length === 0))
        || record.contextDigest !== sha256(context)
        || !strings(record.selectedPaths) || !strings(record.unobservedPaths)
        || !strings(localPaths) || typeof record.sharedContextUnobserved !== 'boolean'
        || !strings(record.incompleteContextFields)
        || record.unobservedPaths.some(path => !(record.selectedPaths as readonly string[]).includes(path))
        || localPaths.some(path => !(record.selectedPaths as readonly string[]).includes(path))
        || sha256(record.unobservedPaths) !== sha256(record.sharedContextUnobserved
          ? record.selectedPaths : localPaths)) fail();
    const incomplete = sorted([
      ...(context.analysisPolicyDigest === null ? ['analysisPolicyDigest'] : []),
      ...(context.testDefinitionContextDigest === null ? ['testDefinitionContextDigest'] : [])
    ]);
    if (sha256(record.incompleteContextFields) !== sha256(incomplete)
        || record.runtimeIsolation !== (context.testDefinitionContextDigest === null ? null : 'unassessed')
        || (context.testDefinitionContextDigest === null) !== (context.testDefinitionContextReadSetDigest === null)) fail();
    return record as unknown as TestFindingCoverage;
  };
  const record = exact(input, ['before', 'after', 'contextComparable', 'changedContextFields', 'changedSharedInputPaths', 'scope', 'entries', 'counts', 'deltaDigest']);
  if (!strings(record.changedSharedInputPaths)) fail();
  const changedSharedInputPaths = record.changedSharedInputPaths as readonly string[];
  const before = cut(record.before), after = cut(record.after);
  const changedContextFields = sorted(contextKeys.filter(key => before.context[key] !== after.context[key]));
  const contextComparable = changedContextFields.length === 0 && changedSharedInputPaths.length === 0
    && before.incompleteContextFields.length === 0 && after.incompleteContextFields.length === 0;
  if (record.contextComparable !== contextComparable
      || sha256(record.changedContextFields) !== sha256(changedContextFields)
      || !Array.isArray(record.entries) || !digest(record.deltaDigest)) fail();
  const beforePaths = new Set(before.selectedPaths), afterPaths = new Set(after.selectedPaths);
  const beforeUnknown = new Set(before.unobservedPaths), afterUnknown = new Set(after.unobservedPaths);
  const scope = exact(record.scope, ['addedPaths', 'removedPaths', 'regressedPaths']);
  const expectedScope = {
    addedPaths: sorted([...afterPaths].filter(path => !beforePaths.has(path))),
    removedPaths: sorted([...beforePaths].filter(path => !afterPaths.has(path))),
    regressedPaths: regressedTestFindingCoveragePaths(before, after, changedSharedInputPaths)
  };
  if (sha256(scope) !== sha256(expectedScope)) fail();
  const counts: Record<SourceProgramFindingDeltaStatus, number> = {
    introduced: 0, persistent: 0, changed: 0, absent: 0, 'out-of-scope': 0, unobserved: 0
  };
  const keys: string[] = [], oldDigests: string[] = [], currentDigests: string[] = [];
  for (const raw of record.entries as readonly unknown[]) {
    const entry = exact(raw, ['identityDigest', 'code', 'path', 'status', 'beforeFindingDigests', 'afterFindingDigests',
      'beforeSubjectDigest', 'afterSubjectDigest']);
    if (!(SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES as readonly unknown[]).includes(entry.code)
        || typeof entry.path !== 'string' || entry.path.length === 0
        || !strings(entry.beforeFindingDigests, false) || !strings(entry.afterFindingDigests, false)
        || !entry.beforeFindingDigests.every(digest) || !entry.afterFindingDigests.every(digest)
        || entry.beforeFindingDigests.length + entry.afterFindingDigests.length === 0
        || (entry.beforeFindingDigests.length === 0 ? entry.beforeSubjectDigest !== null : !digest(entry.beforeSubjectDigest))
        || (entry.afterFindingDigests.length === 0 ? entry.afterSubjectDigest !== null : !digest(entry.afterSubjectDigest))
        || entry.identityDigest !== sha256({ code: entry.code, path: entry.path })) fail();
    const fact = entry as unknown as TestFindingDeltaEntry;
    const status = fact.beforeFindingDigests.length === 0 ? 'introduced'
      : fact.afterFindingDigests.length > 0 ? contextComparable
        && sha256(fact.beforeFindingDigests) === sha256(fact.afterFindingDigests)
        && fact.beforeSubjectDigest === fact.afterSubjectDigest ? 'persistent' : 'changed'
      : !afterPaths.has(fact.path) ? 'out-of-scope'
      : !contextComparable || !beforePaths.has(fact.path) || beforeUnknown.has(fact.path) || afterUnknown.has(fact.path)
        ? 'unobserved' : 'absent';
    if (fact.status !== status) fail();
    counts[status] += 1;
    keys.push(JSON.stringify([fact.code, fact.path]));
    oldDigests.push(...fact.beforeFindingDigests);
    currentDigests.push(...fact.afterFindingDigests);
  }
  if (!strings(keys) || before.findingsDigest !== sha256(oldDigests.sort(compareCodeUnits))
      || after.findingsDigest !== sha256(currentDigests.sort(compareCodeUnits))
      || sha256(exact(record.counts, Object.keys(counts))) !== sha256(counts)) fail();
  const { deltaDigest: _deltaDigest, ...unsigned } = record;
  if (record.deltaDigest !== sha256(unsigned)) fail();
  if (findings === undefined) return;
  const remaining = new Map<string, number>();
  for (const value of currentDigests) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  for (const finding of findings) {
    const value = sha256(finding), count = remaining.get(value) ?? 0;
    if (count === 0) {
      throw new Error('Test disposition finding is outside the exact current observation multiset');
    }
    remaining.set(value, count - 1);
  }
}

/** Consume an already-qualified disposition without rewriting observation
 * history. The disposition/retirement owner, not this comparison, authorizes
 * removal; every remaining new or changed finding retains its blocker. */
export function sourceProgramTestFindingDeltaHasRegression(
  delta: SourceProgramTestFindingDelta,
  findings: readonly SourceProgramTestFinding[]
): boolean {
  assertSourceProgramTestFindingDelta(delta, findings);
  const retained = new Set<string>(findings.map(finding => sha256(finding)));
  return delta.entries.some(entry => (entry.status === 'introduced' || entry.status === 'changed')
    && entry.afterFindingDigests.some(digest => retained.has(digest)));
}

export function summarizeSourceProgramTestFindingDelta(delta: SourceProgramTestFindingDelta) {
  const compact = (cut: TestFindingCoverage) => ({
    sourceRevision: cut.sourceRevision, modelDigest: cut.modelDigest,
    compilationReceiptDigest: cut.compilationReceiptDigest, testCompilationDigest: cut.testCompilationDigest,
    findingsDigest: cut.findingsDigest, contextDigest: cut.contextDigest, runtimeIsolation: cut.runtimeIsolation,
    incompleteContextFields: cut.incompleteContextFields,
    unobservedPaths: cut.unobservedPaths, localUnobservedInputs: cut.localUnobservedInputs,
    moduleMembershipDigest: cut.moduleMembershipDigest,
    sharedContextUnobserved: cut.sharedContextUnobserved
  });
  return deepFreeze({
    before: compact(delta.before), after: compact(delta.after),
    contextComparable: delta.contextComparable, changedContextFields: delta.changedContextFields,
    changedSharedInputPaths: delta.changedSharedInputPaths,
    scope: delta.scope, counts: delta.counts, deltaDigest: delta.deltaDigest
  });
}

export function sourceProgramTestFindingDeltaIsUnresolved(
  delta: SourceProgramTestFindingDelta,
  authorAssessedCurrentPaths: ReadonlySet<string> = new Set()
): boolean {
  // Scoped author judgment can continue explicit uncertainty; it never turns
  // these entries into observed coverage or waives a known violation. Missing
  // compiler/protocol context remains unconditionally blocked.
  return delta.before.incompleteContextFields.length > 0 || delta.after.incompleteContextFields.length > 0
    || delta.scope.regressedPaths.some(path => !authorAssessedCurrentPaths.has(path))
    || delta.entries.some(entry => entry.status === 'unobserved'
      && (entry.code === 'test-observation-receipt-unresolved' || !authorAssessedCurrentPaths.has(entry.path)));
}
