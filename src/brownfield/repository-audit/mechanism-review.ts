import {
  compareCodeUnits,
  deepFreeze,
  sha256,
  uniqueSorted
} from '../../system-architecture/foundation/runtime/canonical.ts';

/** Read-only view of facts already compiled by Source Program, not a second parser or graph. */
export interface MechanismReviewModel {
  readonly sourceRevision: string;
  readonly modelDigest: string;
  readonly files: readonly Readonly<{
    path: string; contentDigest: string; surface: string;
  }>[];
  readonly declarations: readonly Readonly<{
    observationId: string; path: string; moduleId: string | null;
  }>[];
  readonly references: readonly Readonly<{
    path: string; kind: string; sourceRelation: string;
    sourceObservationId: string | null; targetObservationId: string | null;
    observationClass: string; span: Readonly<{ start: number; end: number }>;
  }>[];
  readonly capabilities: readonly Readonly<{
    observationId: string; path: string; moduleId: string | null;
    capability: string; operation: string; transport: string;
    moduleSpecifier: string | null; owningDeclarationObservationId: string | null;
    observationClass: string; span: Readonly<{ start: number; end: number }>;
  }>[];
  readonly dependencies: readonly Readonly<{
    manifestPath: string; name: string; requirement: string; scope: string;
    consumerPaths: readonly string[]; observationClass: string;
  }>[];
}

// Review conditions, not admission policy. None of these structures proves a
// defect: recursion may be bounded, startup I/O intentional, and a coordinator
// may correctly combine effects. Retain the falsifying question with the rule.
export const MECHANISM_REVIEW_RULES = deepFreeze({
  'module-initialization-effect': {
    mechanism: 'Importing a module can perform an observed effect before an operation is selected.',
    review: 'Is eager work required for every consumer, or can the existing operation boundary load it on demand?'
  },
  'distributed-direct-transport': {
    mechanism: 'The same observed transport operation appears in more than one declared module.',
    review: 'Do those modules duplicate policy or lifecycle handling, or intentionally own independent effects?'
  },
  'mixed-effect-declaration': {
    mechanism: 'One declaration directly invokes more than one concrete effect family.',
    review: 'Separate policy from transport only if this is not the intended orchestration owner.'
  },
  'direct-recursive-call': {
    mechanism: 'A compiler-resolved call returns to its own enclosing declaration.',
    review: 'Prove an input depth bound or test deep inputs before considering an iterative implementation.'
  },
  'dependency-requirement-divergence': {
    mechanism: 'The same package has distinct declared requirements across dependency declarations.',
    review: 'Check actual resolution, required API coverage and deployment boundaries; different ranges need not conflict.'
  }
} as const);

export type MechanismReviewCode = keyof typeof MECHANISM_REVIEW_RULES;

export interface MechanismReviewSite {
  readonly path: string;
  readonly contentDigest: string;
  readonly start: number | null;
  readonly end: number | null;
  readonly observationId: string | null;
}

export interface MechanismReviewFinding {
  readonly code: MechanismReviewCode;
  readonly subject: string;
  readonly evidenceClass: 'derived-structure';
  readonly disposition: 'review-required';
  readonly sites: readonly MechanismReviewSite[];
  readonly related: readonly string[];
  readonly findingDigest: string;
}

export interface SourceProgramMechanismReview {
  readonly authority: 'none-diagnostic-only';
  readonly sourceRevision: string;
  readonly modelDigest: string;
  readonly coverage: Readonly<{
    scope: 'supplied-source-program';
    files: number;
    productionFiles: number;
    scannedCapabilities: number;
    scannedReferences: number;
    scannedDependencies: number;
    unresolvedCapabilities: number;
    unresolvedCallReferences: number;
    unresolvedDependencies: number;
    /** Findings are grouped without discarding any distinct evidence site. */
    findingUnit: 'rule-subject-context';
    unlocatedRecords: number;
    unassessedMechanisms: readonly string[];
  }>;
  readonly rules: typeof MECHANISM_REVIEW_RULES;
  readonly findings: readonly MechanismReviewFinding[];
  /** Number of review groups, not number of calls, defects or semantic kinds. */
  readonly counts: Readonly<Record<MechanismReviewCode, number>>;
  readonly reviewDigest: string;
}

/**
 * Relational mechanism search over existing semantic facts. No I/O, source
 * parsing, name-based authority inference, graph reconstruction or automatic
 * rewrite. A small/partial input model never establishes whole-repository
 * coverage. Unknown and missing joins are counted instead of treated as safe.
 */
export function compileSourceProgramMechanismReview(model: MechanismReviewModel): SourceProgramMechanismReview {
  const files = new Map(model.files.map((file) => [file.path, file]));
  if (files.size !== model.files.length) throw new Error('Mechanism review requires unique source file identities');
  const declarations = new Map(model.declarations.map((declaration) => [declaration.observationId, declaration]));
  if (declarations.size !== model.declarations.length) throw new Error('Mechanism review requires unique declaration identities');
  const production = new Set(model.files.filter((file) => file.surface === 'production').map((file) => file.path));
  type FindingGroup = {
    code: MechanismReviewCode; subject: string; related: readonly string[];
    firstSite: MechanismReviewSite; firstSiteKey: string;
    multipleSites?: Map<string, MechanismReviewSite>;
  };
  const findingGroups = new Map<string, FindingGroup>();
  let unresolvedCapabilities = 0;
  let unresolvedCallReferences = 0;
  let unresolvedDependencies = 0;
  let unlocatedRecords = 0;
  const resolvedObservation = (value: string): boolean => value === 'observed' || value === 'derived';
  const site = (
    path: string,
    span: Readonly<{ start: number; end: number }> | null,
    observationId: string | null
  ): MechanismReviewSite | null => {
    const file = files.get(path);
    if (file === undefined) { unlocatedRecords += 1; return null; }
    return {
      path, contentDigest: file.contentDigest,
      start: span?.start ?? null, end: span?.end ?? null, observationId
    };
  };
  const add = (code: MechanismReviewCode, subject: string, sites: readonly MechanismReviewSite[], related: readonly string[]): void => {
    const context = uniqueSorted(related);
    const key = JSON.stringify([code, subject, context]);
    let group = findingGroups.get(key);
    // Allocate an evidence index only for multi-site groups. A high-cardinality
    // vocabulary with one call per context does not need one Map per finding.
    for (const location of sites) {
      const locationKey = JSON.stringify(location);
      if (group === undefined) {
        group = { code, subject, related: context, firstSite: location, firstSiteKey: locationKey };
        findingGroups.set(key, group);
      } else if (locationKey !== group.firstSiteKey) {
        group.multipleSites ??= new Map([[group.firstSiteKey, group.firstSite]]);
        group.multipleSites.set(locationKey, location);
      }
    }
  };
  const transports = new Map<string, { modules: Set<string>; sites: MechanismReviewSite[] }>();
  const effectsByDeclaration = new Map<string, { families: Set<string>; sites: MechanismReviewSite[] }>();
  for (const capability of model.capabilities) {
    if (!files.has(capability.path)) { unlocatedRecords += 1; continue; }
    if (!production.has(capability.path)) continue;
    if (!resolvedObservation(capability.observationClass) || capability.transport === 'unknown') {
      unresolvedCapabilities += 1; continue;
    }
    const location = site(capability.path, capability.span, capability.observationId)!;
    const owner = capability.owningDeclarationObservationId;
    if (owner === null) {
      // Source Program reserves null enclosing scope for module initialization.
      add('module-initialization-effect', capability.path, [location], [`capability:${capability.capability}`, `operation:${capability.operation}`]);
    } else {
      const declaration = declarations.get(owner);
      if (declaration === undefined || declaration.path !== capability.path
          || declaration.moduleId !== capability.moduleId) {
        unresolvedCapabilities += 1;
        // An invalid ownership join is not evidence for either mixed effects
        // or distributed transport. Do not count it unresolved and then use it.
        continue;
      }
      if (capability.capability !== 'provider') {
        const group = effectsByDeclaration.get(owner) ?? { families: new Set(), sites: [] };
        group.families.add(capability.capability);
        group.sites.push(location);
        effectsByDeclaration.set(owner, group);
      }
    }
    if (capability.moduleId !== null && capability.moduleSpecifier !== null
        && capability.transport !== 'repository-provider') {
      const key = JSON.stringify([capability.capability, capability.moduleSpecifier, capability.operation, capability.transport]);
      const group = transports.get(key) ?? { modules: new Set(), sites: [] };
      group.modules.add(capability.moduleId);
      group.sites.push(location);
      transports.set(key, group);
    }
  }
  for (const [key, group] of transports) {
    if (group.modules.size > 1) add('distributed-direct-transport', key, group.sites, [...group.modules]);
  }
  for (const [key, group] of effectsByDeclaration) {
    if (group.families.size > 1) add('mixed-effect-declaration', key, group.sites, [...group.families]);
  }
  for (const reference of model.references) {
    if (!files.has(reference.path)) { unlocatedRecords += 1; continue; }
    if (!production.has(reference.path) || reference.kind !== 'call') continue;
    const source = reference.sourceObservationId;
    const target = reference.targetObservationId;
    const targetDeclaration = target === null ? undefined : declarations.get(target);
    if (!resolvedObservation(reference.observationClass) || targetDeclaration === undefined
        || !files.has(targetDeclaration.path)) {
      unresolvedCallReferences += 1; continue;
    }
    if (reference.sourceRelation === 'module-initialization' && source === null) {
      // This is a resolved top-level call, not a missing enclosing declaration.
      continue;
    }
    const sourceDeclaration = source === null ? undefined : declarations.get(source);
    if (reference.sourceRelation !== 'declaration' || sourceDeclaration === undefined
        || sourceDeclaration.path !== reference.path) {
      unresolvedCallReferences += 1; continue;
    }
    if (source === target) {
      add('direct-recursive-call', source!, [site(reference.path, reference.span, source)!], []);
    }
  }
  const dependencies = new Map<string, { requirements: Set<string>; sites: MechanismReviewSite[] }>();
  for (const dependency of model.dependencies) {
    const location = site(dependency.manifestPath, null, null);
    if (location === null) continue;
    if (!resolvedObservation(dependency.observationClass)) {
      unresolvedDependencies += 1; continue;
    }
    const group = dependencies.get(dependency.name) ?? { requirements: new Set(), sites: [] };
    group.requirements.add(dependency.requirement);
    group.sites.push(location);
    dependencies.set(dependency.name, group);
  }
  for (const [name, group] of dependencies) {
    if (group.requirements.size > 1) add('dependency-requirement-divergence', name, group.sites, [...group.requirements]);
  }
  const uniqueFindings: MechanismReviewFinding[] = [];
  for (const group of findingGroups.values()) {
    const located = group.multipleSites === undefined ? [group.firstSite]
      : [...group.multipleSites.entries()]
        .sort(([left], [right]) => compareCodeUnits(left, right)).map(([, location]) => location);
    const canonical = {
      code: group.code, subject: group.subject, evidenceClass: 'derived-structure' as const,
      disposition: 'review-required' as const, sites: located, related: group.related
    };
    uniqueFindings.push({ ...canonical, findingDigest: sha256(canonical) });
  }
  uniqueFindings.sort((left, right) => compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.subject, right.subject)
    || compareCodeUnits(left.findingDigest, right.findingDigest));
  const counts = Object.fromEntries(Object.keys(MECHANISM_REVIEW_RULES).map((code) => [code, 0])) as Record<MechanismReviewCode, number>;
  for (const finding of uniqueFindings) counts[finding.code] += 1;
  const canonical = {
    authority: 'none-diagnostic-only' as const,
    sourceRevision: model.sourceRevision,
    modelDigest: model.modelDigest,
    coverage: {
      scope: 'supplied-source-program' as const,
      files: files.size, productionFiles: production.size,
      scannedCapabilities: model.capabilities.length,
      scannedReferences: model.references.length,
      scannedDependencies: model.dependencies.length,
      unresolvedCapabilities, unresolvedCallReferences, unresolvedDependencies, unlocatedRecords,
      findingUnit: 'rule-subject-context' as const,
      unassessedMechanisms: [
        'parameter-value-flow-and-precedence', 'aggregate-budget-and-queue-bounds',
        'cancellation-and-cleanup-order', 'cache-freshness-and-capacity',
        'physical-races-and-crash-recovery', 'provider-contract-equivalence',
        'runtime-performance-and-allocation', 'indirect-recursion-and-dynamic-calls'
      ]
    },
    rules: MECHANISM_REVIEW_RULES,
    findings: uniqueFindings,
    counts
  };
  return deepFreeze({ ...canonical, reviewDigest: sha256(canonical) });
}
