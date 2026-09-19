import { SecError } from '../contracts/failure.ts';
import { evaluateSemanticQuery, prepareSemanticQuery, type SemanticQueryRequest, type SemanticQueryResult, type SemanticRuntime } from '../application/semantic-query.ts';

/** Assemble the existing pure compiler and target, without a workspace, store,
 * watcher or effect provider. Every request owns its captured values. */
export function createRuntime(): SemanticRuntime {
  let accepting = true;
  let closed: Promise<void> | undefined;
  const pending = new Set<Promise<SemanticQueryResult>>();
  // Analysis does not load the optional TypeScript generation implementation.
  let target: Promise<typeof import('../adapters/targets/typescript/state-transition-source.ts')> | undefined;
  const capabilities: SemanticRuntime['capabilities'] = Object.freeze({
    input: 'captured-semantic-values',
    purposes: Object.freeze(['analyze', 'generate'] as const),
    target: 'typescript-runtime-contract'
  });

  const handle = (request: SemanticQueryRequest): Promise<SemanticQueryResult> => {
    if (!accepting) return Promise.reject(new SecError('RUNTIME-CLOSED-001', 'Semantic runtime is closed'));
    let query: ReturnType<typeof prepareSemanticQuery>;
    try { query = prepareSemanticQuery(request); }
    catch (error) { return Promise.reject(error); }
    // Preparing caller-owned values can run accessors. Recheck admission before
    // starting work if a reentrant close happened during source capture.
    if (!accepting) return Promise.reject(new SecError('RUNTIME-CLOSED-001', 'Semantic runtime is closed'));
    const result = Promise.resolve().then(async () => {
      if (query.purpose === 'analyze') return evaluateSemanticQuery(query);
      target ??= import('../adapters/targets/typescript/state-transition-source.ts');
      const { renderTypeScriptSemanticTask } = await target;
      return evaluateSemanticQuery(query, renderTypeScriptSemanticTask);
    });
    pending.add(result);
    const release = () => { pending.delete(result); };
    void result.then(release, release);
    return result;
  };

  return Object.freeze({
    capabilities,
    handle,
    close: () => {
      accepting = false;
      // Accepted calls retain their results and cancellation signal. Drain the
      // actual promises; do not mark a running query finished merely on close.
      closed ??= Promise.allSettled([...pending]).then(() => undefined);
      return closed;
    }
  });
}

export type { SemanticQueryRequest, SemanticQueryResult, SemanticRuntime } from '../application/semantic-query.ts';
export type { SemanticCompilationInput } from '../compiler/semantic-compiler.ts';
