import { createAuthorWorkspace } from '../workspace/author-candidate.ts';
import type { SemanticCompilationInput } from '../compiler/semantic-compiler.ts';
import { createRuntimeQueryScope } from '../execution/runtime-query-scope.ts';
import { evaluateSemanticQuery, prepareSemanticQuery, type SemanticQueryRequest, type SemanticQueryResult, type SemanticRuntime, type SemanticRuntimeOptions } from '../application/semantic-query.ts';

/** Assemble the current pure compiler and target. Workspace source belongs to
 * workspace; request semantics to application; admission/drain to execution. */
export function createRuntime(options: SemanticRuntimeOptions = {}): SemanticRuntime {
  const { maximumPendingQueries = 1 } = options;
  const scope = createRuntimeQueryScope(maximumPendingQueries);
  // Analysis does not load the optional TypeScript generation implementation.
  let target: Promise<typeof import('../adapters/targets/typescript/state-transition-source.ts')> | undefined;
  const capabilities: SemanticRuntime['capabilities'] = Object.freeze({
    input: 'captured-semantic-values',
    purposes: Object.freeze(['analyze', 'generate'] as const),
    target: 'typescript-runtime-contract',
    maximumPendingQueries: scope.maximumPendingQueries
  });

  const handle = (request: SemanticQueryRequest): Promise<SemanticQueryResult> => scope.run(
    () => prepareSemanticQuery(request),
    async query => {
      if (query.purpose === 'analyze') return evaluateSemanticQuery(query);
      target ??= import('../adapters/targets/typescript/state-transition-source.ts');
      const { renderTypeScriptSemanticTask } = await target;
      return evaluateSemanticQuery(query, renderTypeScriptSemanticTask);
    }
  );

  return Object.freeze({
    capabilities,
    workspace: (input: SemanticCompilationInput) => {
      scope.assertAccepting();
      const workspace = createAuthorWorkspace(input);
      scope.assertAccepting();
      return workspace;
    },
    handle,
    close: scope.close
  });
}

export type { SemanticQueryRequest, SemanticQueryResult, SemanticRuntime, SemanticRuntimeOptions } from '../application/semantic-query.ts';
export type { SemanticCompilationInput } from '../compiler/semantic-compiler.ts';
export type { AuthorCandidate, AuthorSavePlan, AuthorWorkspace } from '../workspace/author-candidate.ts';
