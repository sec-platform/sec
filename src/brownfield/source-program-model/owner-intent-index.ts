/** Narrow input views. Source Program still owns the declarations and all semantics. */
interface Declaration {
  readonly observationId: string;
  readonly path: string;
  readonly moduleId: string | null;
  readonly name: string;
  readonly exported: boolean;
}
interface Entrypoint {
  readonly observationId: string;
  readonly targetPaths: readonly string[];
}
interface Closure {
  readonly entrypointObservationId: string;
  readonly handlerModuleIds: readonly string[];
}
interface Capability {
  readonly path: string;
  readonly surface: string;
  readonly capability: string;
  readonly observationClass: string;
  readonly transport: string;
}
interface Reference {
  readonly path: string;
  readonly observationClass: string;
  readonly targetObservationId: string | null;
  readonly targetPath: string | null;
}

function append<Key, Value>(index: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = index.get(key);
  if (values === undefined) index.set(key, [value]);
  else values.push(value);
}

const EMPTY: readonly never[] = Object.freeze([]);

function lazyIndex<Value extends object>(build: () => Value): () => Value {
  let value: Value | undefined;
  // Publish only after successful construction; a failing source read cannot
  // leave a half-built reusable index. The closure dies with this projection.
  return () => value ??= build();
}

function freezeBuckets<Key, Value>(index: Map<Key, Value[]>): Map<Key, Value[]> {
  for (const values of index.values()) Object.freeze(values);
  return index;
}

/**
 * One ephemeral index per owner-intent projection over a stable Source Program
 * generation. Build only demanded views, once. Only direct relations are
 * indexed: no transitive closure matrix, persistent cache, reconstructed graph,
 * source parsing, or new semantic decision. Nested input records remain owned
 * by Source Program and are neither copied nor frozen by this view.
 */
export function indexOwnerIntentInputs<
  D extends Declaration, E extends Entrypoint, C extends Closure, F extends Capability
>(model: Readonly<{
  files: readonly Readonly<{ path: string; surface: string }>[];
  declarations: readonly D[];
  entrypoints: readonly E[];
  entrypointClosures: readonly C[];
  capabilities: readonly F[];
  references: readonly Reference[];
}>) {
  const declarations = lazyIndex(() => {
    const byPath = new Map<string, D[]>();
    const exportsByOwner = new Map<string, Map<string, D[]>>();
    for (const declaration of model.declarations) {
      append(byPath, declaration.path, declaration);
      if (!declaration.exported || declaration.moduleId === null) continue;
      let names = exportsByOwner.get(declaration.moduleId);
      if (names === undefined) { names = new Map(); exportsByOwner.set(declaration.moduleId, names); }
      append(names, declaration.name, declaration);
    }
    freezeBuckets(byPath);
    for (const names of exportsByOwner.values()) freezeBuckets(names);
    return { byPath, exportsByOwner };
  });

  const entrypoints = lazyIndex(() => {
    // Existing consumers use Map(last) for envelopes and find(first) for
    // reachable paths. Preserve both even for duplicate observations.
    const firstClosure = new Map<string, C>();
    const lastClosure = new Map<string, C>();
    for (const closure of model.entrypointClosures) {
      if (!firstClosure.has(closure.entrypointObservationId)) firstClosure.set(closure.entrypointObservationId, closure);
      lastClosure.set(closure.entrypointObservationId, closure);
    }
    const byTarget = new Map<string, E[]>();
    const byOwner = new Map<string, Array<Readonly<{ entrypoint: E; closure: C }>>>();
    for (const entrypoint of model.entrypoints) {
      for (const target of new Set(entrypoint.targetPaths)) append(byTarget, target, entrypoint);
      const closure = lastClosure.get(entrypoint.observationId);
      if (closure === undefined) continue;
      const pair = Object.freeze({ entrypoint, closure });
      for (const owner of new Set(closure.handlerModuleIds)) append(byOwner, owner, pair);
    }
    return { firstClosure, byTarget: freezeBuckets(byTarget), byOwner: freezeBuckets(byOwner) };
  });

  const capabilitySummaries = lazyIndex(() => {
    const byPath = new Map<string, {
      kinds: Set<F['capability']>;
      hasUnknown: boolean;
    }>();
    for (const fact of model.capabilities) {
      if (fact.surface !== 'production') continue;
      let summary = byPath.get(fact.path);
      if (summary === undefined) {
        summary = { kinds: new Set(), hasUnknown: false };
        byPath.set(fact.path, summary);
      }
      // Preserve both original projections: an unknown transport prevents
      // completeness, but does not erase a kind with a known observation.
      const observationClass = fact.observationClass;
      if (observationClass !== 'unknown') summary.kinds.add(fact.capability);
      if (observationClass === 'unknown' || fact.transport === 'unknown') {
        summary.hasUnknown = true;
      }
    }
    return byPath;
  });

  const consumers = lazyIndex(() => {
    const productionPaths = new Set(model.files.filter(({ surface }) => surface === 'production').map(({ path }) => path));
    const byDeclaration = new Map<string, Set<string>>();
    const byUnresolvedTargetPath = new Map<string, Set<string>>();
    for (const reference of model.references) {
      if (reference.observationClass === 'unknown' || !productionPaths.has(reference.path)) continue;
      // A resolved declaration ID must never fall back to a coincident path.
      const index = reference.targetObservationId === null ? byUnresolvedTargetPath : byDeclaration;
      const key = reference.targetObservationId === null ? reference.targetPath : reference.targetObservationId;
      if (key === null) continue;
      let paths = index.get(key);
      if (paths === undefined) { paths = new Set(); index.set(key, paths); }
      paths.add(reference.path);
    }
    return { byDeclaration, byUnresolvedTargetPath };
  });

  return Object.freeze({
    declarationsForPath: (path: string): readonly D[] => declarations().byPath.get(path) ?? EMPTY,
    declarationsForCapability: (owner: string, name: string): readonly D[] =>
      declarations().exportsByOwner.get(owner)?.get(name) ?? EMPTY,
    entrypointsForOwner: (owner: string): readonly Readonly<{ entrypoint: E; closure: C }>[] =>
      entrypoints().byOwner.get(owner) ?? EMPTY,
    entrypointsForTarget: (path: string): readonly E[] => entrypoints().byTarget.get(path) ?? EMPTY,
    firstClosureForEntrypoint: (id: string): C | undefined => entrypoints().firstClosure.get(id),
    capabilitySummaryForPaths: (paths: ReadonlySet<string>): Readonly<{
      observedKinds: readonly F['capability'][];
      hasUnknown: boolean;
    }> => {
      const kinds = new Set<F['capability']>();
      let hasUnknown = false;
      if (paths.size > 0) {
        const byPath = capabilitySummaries();
        for (const path of paths) {
          const summary = byPath.get(path);
          if (summary === undefined) continue;
          for (const kind of summary.kinds) kinds.add(kind);
          hasUnknown ||= summary.hasUnknown;
        }
      }
      // Caller retains policy and canonical order. Return only the sufficient
      // statistics it uses, not a misleading sample of the underlying facts.
      return Object.freeze({ observedKinds: Object.freeze([...kinds]), hasUnknown });
    },
    consumerPaths: (ids: ReadonlySet<string>, paths: ReadonlySet<string>): ReadonlySet<string> => {
      const result = new Set<string>();
      if (ids.size === 0 && paths.size === 0) return result;
      const { byDeclaration, byUnresolvedTargetPath } = consumers();
      for (const id of ids) for (const path of byDeclaration.get(id) ?? EMPTY) result.add(path);
      for (const target of paths) for (const path of byUnresolvedTargetPath.get(target) ?? EMPTY) result.add(path);
      return result;
    }
  });
}
