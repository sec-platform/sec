import { cloneAndDeepFreeze } from '../contracts/canonical.ts';
import { assertNativeAbortSignal, throwIfNativeAborted } from '../contracts/native-abort.ts';
import { SecError } from '../contracts/failure.ts';
import { compileSemanticInput, type SemanticCompilation, type SemanticCompilationInput } from '../compiler/semantic-compiler.ts';
import { prepareSemanticLowering, renderSemanticArtifacts, type SemanticArtifactSet } from '../compiler/semantic-artifacts.ts';
import type { SemanticGeneratorPlanTask } from '../semantics/generation/types.ts';

export type SemanticQueryPurpose = 'analyze' | 'generate';
export interface SemanticQueryRequest {
  readonly purpose: SemanticQueryPurpose;
  readonly input: SemanticCompilationInput;
  readonly signal?: AbortSignal;
}
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
  const { purpose: requestedPurpose, input, signal } = request;
  const purpose = requireSemanticQueryPurpose(requestedPurpose);
  if (signal !== undefined) assertNativeAbortSignal(signal);
  throwIfNativeAborted(signal);
  const captured = cloneAndDeepFreeze(input);
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

/** The current pure semantic profile. It advertises only its real operations;
 * save, build, execute and verification remain separate effectful use cases. */
export interface SemanticRuntime {
  readonly capabilities: Readonly<{
    input: 'captured-semantic-values';
    purposes: readonly SemanticQueryPurpose[];
    target: 'typescript-runtime-contract';
  }>;
  handle(request: SemanticQueryRequest): Promise<SemanticQueryResult>;
  close(): Promise<void>;
}
