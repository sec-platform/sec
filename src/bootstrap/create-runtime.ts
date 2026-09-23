import { executeSemanticQuery, prepareSemanticQuery, type SemanticQueryRequest, type SemanticQueryResult, type SemanticRuntime, type SemanticRuntimeOptions } from '../application/semantic-query.ts';
import type { SemanticCompilationInput } from '../compiler/semantic-compiler.ts';
import type { StructuredIdentityRuntime } from '../contracts/structured-identity.ts';
import { createRuntimeQueryScope } from '../execution/runtime-query-scope.ts';
import { createAuthorWorkspace } from '../workspace/author-candidate.ts';

/** Assemble the current pure compiler and target. Workspace source belongs to
 * workspace; request semantics to application; admission/drain to execution. */
export function createRuntime(options: SemanticRuntimeOptions = {}): SemanticRuntime {
  const { maximumPendingQueries = 1 } = options;
  const scope = createRuntimeQueryScope(maximumPendingQueries);
  // Analysis loads neither the optional target nor the physical content-hash
  // provider. Generation assembles both lazily and reuses them for this runtime.
  let target: Promise<typeof import('../adapters/targets/typescript/state-transition-source.ts')> | undefined;
  let artifactIdentity: Promise<StructuredIdentityRuntime> | undefined;
  const capabilities: SemanticRuntime['capabilities'] = Object.freeze({
    input: 'captured-semantic-values',
    purposes: Object.freeze(['analyze', 'generate'] as const),
    target: 'typescript-runtime-contract',
    maximumPendingQueries: scope.maximumPendingQueries
  });

  const handle = (request: SemanticQueryRequest): Promise<SemanticQueryResult> => scope.run(
    () => prepareSemanticQuery(request),
    query => executeSemanticQuery(query, {
      loadGenerator: async () => {
        target ??= import('../adapters/targets/typescript/state-transition-source.ts');
        const { renderTypeScriptSemanticTask } = await target;
        return renderTypeScriptSemanticTask;
      },
      loadArtifactIdentity: async () => {
        artifactIdentity ??= import('./content-identity-runtime.ts')
          .then(({ createContentIdentityRuntime }) => createContentIdentityRuntime().identity);
        return artifactIdentity;
      }
    })
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

export type { SemanticRuntime, SemanticRuntimeOptions } from '../application/semantic-query.ts';
;
;
