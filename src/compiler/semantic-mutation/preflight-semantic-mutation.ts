import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import { SEMANTIC_MUTATION_CONTRACT_VERSION, SEMANTIC_MUTATION_EXPECTATION_REVISION, SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION, type SemanticMutationBase, type SemanticMutationDiagnostic, type SemanticMutationPreflight, type SemanticMutationPreflightInput } from '../../semantics/mutation/types.ts';
import {
  canonicalDiagnostics,
  cloneAndDeepFreeze,
  diagnosticRevision,
  exactOwnKeys,
  isPlainObject,
  mutationDiagnostic,
  SemanticMutationContractError,
  sha256
} from './canonical.ts';
import {
  matchSemanticMutationConditions,
  mergeSemanticMutationConditions
} from './match-conditions.ts';
import {
  normalizeSemanticMutationAuthorization,
  normalizeSemanticMutationRequest
} from './normalize-request.ts';
import { validateSemanticMutationOperations } from './operation-registry.ts';

function safeRequestId(value: unknown): string | undefined {
  if (!isPlainObject(value) || typeof value.requestId !== 'string') return undefined;
  const requestId = value.requestId.trim();
  return requestId.length > 0 && requestId === value.requestId ? requestId : undefined;
}

function minimalRequestRejection(
  request: unknown,
  diagnostics: readonly SemanticMutationDiagnostic[]
): SemanticMutationPreflight {
  const canonical = canonicalDiagnostics(diagnostics.length > 0 ? diagnostics : [
    mutationDiagnostic('SEMANTIC-MUTATION-001', 'request', 'Semantic mutation input is invalid')
  ]);
  const requestId = safeRequestId(request);
  return cloneAndDeepFreeze({
    contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
    status: 'rejected',
    rejectedAt: 'request',
    ...(requestId === undefined ? {} : { requestId }),
    diagnostics: canonical,
    diagnosticRevision: diagnosticRevision(canonical)
  });
}

function endpointBase(endpoint: FactDeltaEndpointContext): SemanticMutationBase {
  return {
    transactionId: endpoint.transactionId,
    inputRevision: endpoint.inputRevision,
    semanticRevision: endpoint.semanticRevision
  };
}

function preflightRevision(input: {
  readonly status: 'ready' | 'rejected';
  readonly rejectedAt: string;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly base: SemanticMutationBase;
  readonly diagnostics: readonly SemanticMutationDiagnostic[];
}): string {
  return sha256({
    domain: 'semantic-mutation-preflight-v2',
    requestRevision: input.requestRevision,
    authorizationRevision: input.authorizationRevision,
    base: input.base,
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    expectationRevision: SEMANTIC_MUTATION_EXPECTATION_REVISION,
    status: input.status,
    rejectedAt: input.rejectedAt,
    diagnostics: input.diagnostics
  });
}

function baseDiagnostics(
  request: ReturnType<typeof normalizeSemanticMutationRequest>,
  endpoint: FactDeltaEndpointContext
): SemanticMutationDiagnostic[] {
  if (!isPlainObject(endpoint) || !exactOwnKeys(endpoint, ['transactionId', 'inputRevision', 'semanticRevision', 'snapshot']) ||
    !isPlainObject(endpoint.snapshot) || !isPlainObject(endpoint.snapshot.ir)) {
    return [mutationDiagnostic('SEMANTIC-MUTATION-002', 'base', 'Trusted base must be a complete FactDeltaEndpointContext')];
  }
  const ir = endpoint.snapshot.ir;
  const matches = endpoint.transactionId === request.base.transactionId &&
    endpoint.inputRevision === request.base.inputRevision &&
    endpoint.semanticRevision === request.base.semanticRevision &&
    ir.graphId === request.graphId &&
    ir.appId === request.appId &&
    ir.inputRevision === endpoint.inputRevision &&
    ir.semanticRevision === endpoint.semanticRevision;
  return matches ? [] : [mutationDiagnostic(
    'SEMANTIC-MUTATION-002',
    'base',
    'Request graph, app, and base revisions must exactly bind the trusted before context',
    {
      details: {
        requestGraphId: request.graphId,
        requestAppId: request.appId,
        requestBase: request.base,
        endpointBase: endpointBase(endpoint),
        endpointGraphId: ir.graphId,
        endpointAppId: ir.appId
      }
    }
  )];
}

export function preflightSemanticMutation(
  input: SemanticMutationPreflightInput
): SemanticMutationPreflight {
  let request: ReturnType<typeof normalizeSemanticMutationRequest>;
  let authorization: ReturnType<typeof normalizeSemanticMutationAuthorization>;
  try {
    if (!isPlainObject(input) || !exactOwnKeys(input, ['request', 'base', 'authorization'])) {
      return minimalRequestRejection(
        isPlainObject(input) ? input.request : undefined,
        [mutationDiagnostic('SEMANTIC-MUTATION-001', 'request', 'Preflight input contains missing or unknown fields')]
      );
    }
    if (!isPlainObject(input.base) ||
      !exactOwnKeys(input.base, ['transactionId', 'inputRevision', 'semanticRevision', 'snapshot']) ||
      !isPlainObject(input.base.snapshot) || !isPlainObject(input.base.snapshot.ir) ||
      !Array.isArray(input.base.snapshot.ir.entities) ||
      !Array.isArray(input.base.snapshot.ir.facts) ||
      !Array.isArray(input.base.snapshot.ir.scenarios)) {
      return minimalRequestRejection(input.request, [mutationDiagnostic(
        'SEMANTIC-MUTATION-001',
        'request',
        'Trusted base input violates the FactDeltaEndpointContext shape'
      )]);
    }
    request = normalizeSemanticMutationRequest(input.request);
    authorization = normalizeSemanticMutationAuthorization(input.authorization);
  } catch (error) {
    return minimalRequestRejection(
      isPlainObject(input) ? input.request : undefined,
      [error instanceof SemanticMutationContractError
        ? error.diagnostic
        : mutationDiagnostic('SEMANTIC-MUTATION-001', 'request', error instanceof Error ? error.message : 'Invalid semantic mutation input')]
    );
  }

  const base = endpointBase(input.base);
  let preconditions;
  try {
    preconditions = mergeSemanticMutationConditions(
      authorization.requiredPreconditions,
      request.preconditions
    );
    mergeSemanticMutationConditions(
      authorization.requiredPostconditions,
      request.postconditions
    );
  } catch (error) {
    return minimalRequestRejection(request, [mutationDiagnostic(
      'SEMANTIC-MUTATION-001',
      'request',
      error instanceof Error ? error.message : 'Conflicting condition identity'
    )]);
  }
  let diagnostics = baseDiagnostics(request, input.base);
  let rejectedAt: '' | 'base' | 'precondition' | 'source-resolution' | 'transform' = '';
  if (diagnostics.length > 0) {
    rejectedAt = 'base';
  } else {
    diagnostics = matchSemanticMutationConditions(input.base.snapshot, preconditions, {
      code: 'SEMANTIC-MUTATION-003',
      stage: 'precondition'
    });
    if (diagnostics.length > 0) {
      rejectedAt = 'precondition';
    } else {
      const operationResult = validateSemanticMutationOperations(
        input.base.snapshot,
        request.operations,
        authorization
      );
      diagnostics = [...operationResult.diagnostics];
      if (diagnostics.length > 0) {
        rejectedAt = diagnostics.some((entry) => entry.stage === 'source-resolution')
          ? 'source-resolution'
          : 'transform';
      }
    }
  }

  const canonical = canonicalDiagnostics(diagnostics);
  const status = canonical.length === 0 ? 'ready' as const : 'rejected' as const;
  const revision = preflightRevision({
    status,
    rejectedAt,
    requestRevision: request.requestRevision,
    authorizationRevision: authorization.authorizationRevision,
    base,
    diagnostics: canonical
  });
  return cloneAndDeepFreeze({
    contractVersion: SEMANTIC_MUTATION_CONTRACT_VERSION,
    status,
    rejectedAt,
    requestId: request.requestId,
    requestRevision: request.requestRevision,
    authorizationRevision: authorization.authorizationRevision,
    base,
    operationRegistryRevision: SEMANTIC_MUTATION_OPERATION_REGISTRY_REVISION,
    expectationRevision: SEMANTIC_MUTATION_EXPECTATION_REVISION,
    preflightRevision: revision,
    diagnostics: canonical
  });
}
