import { cloneAndDeepFreeze } from '../contracts/canonical.ts';
import { readAuthorCandidate, type AuthorCandidate, type AuthorWorkspace } from '../workspace/author-candidate.ts';
import { assertNativeAbortSignal, throwIfNativeAborted } from '../contracts/native-abort.ts';
import { SecError } from '../contracts/failure.ts';
import { compileSemanticInput, type SemanticCompilation, type SemanticCompilationInput } from '../compiler/semantic-compiler.ts';
import { prepareSemanticLowering, renderSemanticArtifacts, type SemanticArtifactSet } from '../compiler/semantic-artifacts.ts';
import type { SemanticGeneratorPlanTask } from '../semantics/generation/types.ts';

export type SemanticQueryPurpose = 'analyze' | 'generate';
export type SemanticQueryRequest = Readonly<{
  purpose: SemanticQueryPurpose;
  signal?: AbortSignal;
}> & (
  | Readonly<{ input: SemanticCompilationInput; candidate?: never }>
  | Readonly<{ candidate: AuthorCandidate<SemanticCompilationInput>; input?: never }>
);
export type SemanticQueryResult =
  | Readonly<{ purpose: 'analyze'; compilation: SemanticCompilation }>
  | Readonly<{ purpose: 'generate'; compilation: SemanticCompilation; artifacts: SemanticArtifactSet }>;

export function requireSemanticQueryPurpose(value: unknown): SemanticQueryPurpose {
  if (value === 'analyze' || value === 'generate') return value;
  throw new SecError('SEMANTIC-QUERY-001', 'Semantic query must select analyze or generate');
}

/** Own source values at the request boundary; retain the original live signal.
 * This prepared query carries no workspace locator or publication permission. */
export function prepareSemanticQuery(request: SemanticQueryRequest) {
  const { purpose: requestedPurpose, input, candidate, signal } = request;
  const purpose = requireSemanticQueryPurpose(requestedPurpose);
  if (signal !== undefined) assertNativeAbortSignal(signal);
  throwIfNativeAborted(signal);
  if ((input === undefined) === (candidate === undefined)) {
    throw new SecError('SEMANTIC-QUERY-004', 'Semantic query requires exactly one input or candidate');
  }
  // A workspace candidate is already owned and immutable. Reuse its source;
  // one-shot callers still transfer a copy at this boundary.
  const captured = candidate === undefined ? cloneAndDeepFreeze(input!) : readAuthorCandidate(candidate);
  throwIfNativeAborted(signal);
  return Object.freeze({ purpose, input: captured, signal });
}
export type PreparedSemanticQuery = ReturnType<typeof prepareSemanticQuery>;

export function evaluateSemanticQuery(
  query: PreparedSemanticQuery,
  render?: (task: SemanticGeneratorPlanTask) => string
): SemanticQueryResult {
  throwIfNativeAborted(query.signal);
  if (query.purpose === 'generate' && typeof render !== 'function') {
    throw new SecError('SEMANTIC-QUERY-002', 'The requested semantic target is not assembled');
  }
  const compilation = compileSemanticInput(query.input);
  throwIfNativeAborted(query.signal);
  if (query.purpose === 'analyze') return Object.freeze({ purpose: 'analyze', compilation });
  const artifacts = renderSemanticArtifacts(prepareSemanticLowering({
    snapshot: compilation.snapshot,
    inputRevision: compilation.snapshot.ir.inputRevision,
    semanticRevision: compilation.snapshot.ir.semanticRevision,
    generatorPlan: compilation.generatorPlan
  }), task => {
    throwIfNativeAborted(query.signal);
    const source = render!(task);
    throwIfNativeAborted(query.signal);
    return source;
  });
  return Object.freeze({ purpose: 'generate', compilation, artifacts });
}

export interface SemanticRuntimeOptions {
  /** Finite in-flight admission, including source capture. The synchronous
   * compiler profile defaults to one call; excess work is rejected, not queued. */
  readonly maximumPendingQueries?: number;
}

/** The current pure semantic profile. It advertises only its real operations;
 * save, build, execute and verification remain separate effectful use cases. */
export interface SemanticRuntime {
  readonly capabilities: Readonly<{
    input: 'captured-semantic-values';
    purposes: readonly SemanticQueryPurpose[];
    target: 'typescript-runtime-contract';
    maximumPendingQueries: number;
  }>;
  workspace(input: SemanticCompilationInput): AuthorWorkspace<SemanticCompilationInput>;
  handle(request: SemanticQueryRequest): Promise<SemanticQueryResult>;
  close(): Promise<void>;
}
