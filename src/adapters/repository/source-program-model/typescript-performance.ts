

/** Monotonic diagnostic counters; writes do not confer compilation or verification authority. */
const typeScriptSourceProgramPerformance = {
  dependencyAdjacencyLookups: 0,
  dependencyReferenceVisits: 0,
  rawSourceHashBytes: 0,
  rawSourceHashOperations: 0,
  semanticScopeParseOperations: 0,
  semanticSymbolLookupOperations: 0,
  semanticSymbolLookupSkippedIdentifiers: 0
};

export interface TypeScriptPerformanceObservation {
  readonly dependencyAdjacencyLookups: number;
  readonly dependencyReferenceVisits: number;
  readonly rawSourceHashBytes: number;
  readonly rawSourceHashOperations: number;
  readonly semanticScopeParseOperations: number;
  readonly semanticSymbolLookupOperations: number;
  readonly semanticSymbolLookupSkippedIdentifiers: number;
}

/** Monotonic process-local diagnostics for focused performance tests only. */
export function observeTypeScriptPerformanceForTests():
TypeScriptPerformanceObservation {
  return Object.freeze({ ...typeScriptSourceProgramPerformance });
}

export function recordTypeScriptPerformance(counter: keyof TypeScriptPerformanceObservation, amount: number): void {
  typeScriptSourceProgramPerformance[counter] += amount;
}
