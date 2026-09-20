import type { LoadedSemanticContract } from '../../semantics/definitions/types.ts';
import type { FactDeltaEndpointContext } from '../../semantics/engineering-ir/delta-types.ts';
import type { FactProvenance } from '../../semantics/engineering-ir/fact-types.ts';
import { SEMANTIC_CONTRACT_YAML_ADAPTER_ID, SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION, type NormalizedSemanticMutationRequest, type SemanticMutationAuthorizationContext, type SemanticMutationDiagnostic, type SemanticMutationLoadedSourceCandidate, type SemanticMutationOperation, type SemanticMutationSourceKind } from '../../semantics/mutation/types.ts';
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH } from "../../workspace/contract/authoring-index.ts";
import { semanticContractSourceRevision } from "../../semantics/provenance/source-candidate.ts";
import { cloneAndDeepFreeze, exactOwnKeys, isPlainObject, mutationDiagnostic, sha256 } from './canonical.ts';
import { validateSemanticMutationOperations } from './operation-registry.ts';

export interface SemanticMutationResolvedSource {
  readonly sourceKind: 'workspace-authoring';
  readonly ownerId: string;
  readonly writable: true;
  readonly adapterId: typeof SEMANTIC_CONTRACT_YAML_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION;
  readonly relativePath: string;
  readonly sourceRevision: string;
  readonly sourceResolutionRevision: string;
  readonly loadedContract: LoadedSemanticContract;
  readonly operations: readonly SemanticMutationOperation[];
}

export type SemanticMutationSourceResolution =
  | { readonly status: 'resolved'; readonly source: SemanticMutationResolvedSource }
  | { readonly status: 'rejected'; readonly diagnostics: readonly SemanticMutationDiagnostic[] };

type SemanticMutationSourceRejection = Extract<
  SemanticMutationSourceResolution,
  { readonly status: 'rejected' }
>;

/** @internal Shared Compiler authority seam; not part of the public facade. */
export interface SemanticMutationResolvedSourceAuthority {
  readonly sourceKind: 'workspace-authoring';
  readonly ownerId: string;
  readonly writablePathPrefix: string;
  readonly adapterId: typeof SEMANTIC_CONTRACT_YAML_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION;
  readonly relativePath: string;
  readonly sourceRevision: string;
  readonly loadedContract: LoadedSemanticContract;
}

/** @internal Shared Compiler authority seam; not part of the public facade. */
export type SemanticMutationSourceAuthorityResolution =
  | { readonly status: 'resolved'; readonly authority: SemanticMutationResolvedSourceAuthority }
  | SemanticMutationSourceRejection;

type ProvenanceTuple = {
  readonly sourceId: string;
  readonly sourcePath: string;
};

type SourceAdapterDescriptor = {
  readonly sourceKind: SemanticMutationSourceKind;
  readonly writable: boolean;
  readonly relativePathPrefix: string;
  readonly adapterId: typeof SEMANTIC_CONTRACT_YAML_ADAPTER_ID;
  readonly adapterRevision: typeof SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION;
};

const AUTHORING_SOURCE_ROOT = AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.slice(
  0,
  AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.indexOf('/') + 1
);
if (AUTHORING_SOURCE_ROOT.length <= 1 || !AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.startsWith(AUTHORING_SOURCE_ROOT)) {
  throw new Error('Authoring semantic contract index must identify one rooted workspace source.');
}

const SOURCE_ADAPTERS: Readonly<Record<SemanticMutationSourceKind, SourceAdapterDescriptor>> =
  cloneAndDeepFreeze({
    'workspace-authoring': {
      sourceKind: 'workspace-authoring',
      writable: true,
      relativePathPrefix: AUTHORING_SOURCE_ROOT,
      adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION
    },
    'workspace-registry': {
      sourceKind: 'workspace-registry',
      writable: false,
      relativePathPrefix: '',
      adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION
    },
    'compiler-registry': {
      sourceKind: 'compiler-registry',
      writable: false,
      relativePathPrefix: '',
      adapterId: SEMANTIC_CONTRACT_YAML_ADAPTER_ID,
      adapterRevision: SEMANTIC_CONTRACT_YAML_ADAPTER_REVISION
    }
  });

function sourceOwnerId(namespace: string, contractId: string): string {
  return `semantic-contract-owner:${encodeURIComponent(namespace)}:${encodeURIComponent(contractId)}`;
}

function authoritativeContractProvenance(provenance: readonly FactProvenance[]): ProvenanceTuple[] {
  return provenance
    .filter((entry) => entry.kind === 'contract' && entry.sourcePath !== undefined)
    .map((entry) => ({ sourceId: entry.sourceId, sourcePath: entry.sourcePath! }));
}

function pathAllowed(relativePath: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => {
    if (prefix.length === 0 || prefix.includes('\\') || prefix.includes('\0') ||
      pathSegmentsInvalid(prefix)) return false;
    const boundary = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return relativePath === prefix.replace(/\/$/u, '') || relativePath.startsWith(boundary);
  });
}

function pathSegmentsInvalid(value: string): boolean {
  const withoutTrailingSlash = value.endsWith('/') ? value.slice(0, -1) : value;
  return withoutTrailingSlash.startsWith('/') || withoutTrailingSlash.includes(':') ||
    withoutTrailingSlash.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..');
}

function candidateMatches(
  candidate: SemanticMutationLoadedSourceCandidate,
  operation: SemanticMutationOperation,
  provenance: ProvenanceTuple
): boolean {
  const { loadedContract } = candidate;
  return loadedContract.contract.namespace === operation.contract.namespace &&
    loadedContract.contract.id === operation.contract.contractId &&
    loadedContract.contractPath === provenance.sourcePath &&
    provenance.sourceId === `semantic-contract:${loadedContract.contract.id}`;
}

function candidateLooksValid(candidate: unknown): candidate is SemanticMutationLoadedSourceCandidate {
  return isPlainObject(candidate) && exactOwnKeys(candidate, [
    'sourceKind', 'loadedContract', 'sourceRevision'
  ]) && (candidate.sourceKind === 'workspace-authoring' || candidate.sourceKind === 'workspace-registry' ||
    candidate.sourceKind === 'compiler-registry') && isPlainObject(candidate.loadedContract) &&
    exactOwnKeys(candidate.loadedContract, ['blockId', 'contractPath', 'contract']) &&
    typeof candidate.loadedContract.blockId === 'string' && typeof candidate.loadedContract.contractPath === 'string' &&
    isPlainObject(candidate.loadedContract.contract) && typeof candidate.sourceRevision === 'string' &&
    candidate.sourceRevision === semanticContractSourceRevision(candidate.sourceKind, candidate.loadedContract as unknown as LoadedSemanticContract);
}

function reject(message: string, details?: Readonly<Record<string, unknown>>): SemanticMutationSourceRejection {
  return {
    status: 'rejected',
    diagnostics: [mutationDiagnostic(
      'SEMANTIC-MUTATION-004',
      'source-resolution',
      message,
      details === undefined ? undefined : { details }
    )]
  };
}

/** @internal Shared by the trusted authorization ingress and the existing source resolver. */
export function resolveSemanticMutationSourceAuthority(
  request: NormalizedSemanticMutationRequest,
  base: FactDeltaEndpointContext,
  authorization: SemanticMutationAuthorizationContext,
  candidates: readonly SemanticMutationLoadedSourceCandidate[]
): SemanticMutationSourceAuthorityResolution {
  if (request.operations.length === 0) return reject('Semantic Mutation requires at least one source operation');

  if (!candidates.every(candidateLooksValid)) {
    return reject('Trusted loaded source candidates violate the frozen source provenance schema');
  }

  const validation = validateSemanticMutationOperations(base.snapshot, request.operations, authorization);
  if (validation.diagnostics.length > 0 || validation.operations.length !== request.operations.length) {
    return reject('Source resolution could not reproduce the preflight operation provenance');
  }

  const resolved = validation.operations.map((validated) => {
    const operation = validated.operation;
    const provenance = authoritativeContractProvenance(validated.contractProvenance);
    if (provenance.length !== 1) return { operation, provenance, matches: [] as SemanticMutationLoadedSourceCandidate[] };
    const matches = candidates.filter((candidate) => candidateMatches(candidate, operation, provenance[0]!));
    return { operation, provenance, matches };
  });

  if (resolved.some((entry) => entry.provenance.length !== 1 || entry.matches.length !== 1)) {
    return reject('Loaded contract provenance does not resolve to exactly one source owner', {
      operationIds: resolved.map((entry) => entry.operation.operationId),
      provenanceCounts: resolved.map((entry) => entry.provenance.length),
      candidateCounts: resolved.map((entry) => entry.matches.length)
    });
  }

  const firstCandidate = resolved[0]!.matches[0]!;
  const firstPath = firstCandidate.loadedContract.contractPath.replaceAll('\\', '/');
  if (firstPath !== firstCandidate.loadedContract.contractPath) {
    return reject('Resolved source path is not canonical POSIX text');
  }
  const sameSource = resolved.every((entry) => {
    const candidate = entry.matches[0]!;
    return candidate.sourceKind === firstCandidate.sourceKind &&
      candidate.loadedContract.contractPath.replaceAll('\\', '/') === firstPath &&
      candidate.loadedContract.contract.namespace === firstCandidate.loadedContract.contract.namespace &&
      candidate.loadedContract.contract.id === firstCandidate.loadedContract.contract.id;
  });
  if (!sameSource) return reject('A v1 mutation must resolve every operation to one canonical source file');

  const descriptor = SOURCE_ADAPTERS[firstCandidate.sourceKind];
  const ownerId = sourceOwnerId(
    firstCandidate.loadedContract.contract.namespace,
    firstCandidate.loadedContract.contract.id
  );
  if (firstCandidate.sourceKind !== 'workspace-authoring' || !descriptor.writable) {
    return reject('Resolved semantic contract source is read-only', {
      ownerId,
      sourceKind: firstCandidate.sourceKind
    });
  }
  if (!firstPath.startsWith(descriptor.relativePathPrefix)) {
    return reject('Resolved source is outside the writable adapter path and format allowlist', {
      ownerId,
      relativePath: firstPath
    });
  }

  return {
    status: 'resolved',
    authority: cloneAndDeepFreeze({
      sourceKind: firstCandidate.sourceKind,
      ownerId,
      writablePathPrefix: descriptor.relativePathPrefix,
      adapterId: descriptor.adapterId,
      adapterRevision: descriptor.adapterRevision,
      relativePath: firstPath,
      sourceRevision: firstCandidate.sourceRevision,
      loadedContract: firstCandidate.loadedContract
    })
  };
}

export function resolveSemanticMutationSource(
  request: NormalizedSemanticMutationRequest,
  base: FactDeltaEndpointContext,
  authorization: SemanticMutationAuthorizationContext,
  candidates: readonly SemanticMutationLoadedSourceCandidate[]
): SemanticMutationSourceResolution {
  const authorityResolution = resolveSemanticMutationSourceAuthority(
    request,
    base,
    authorization,
    candidates
  );
  if (authorityResolution.status === 'rejected') return authorityResolution;

  const authority = authorityResolution.authority;
  if (!authorization.allowedSourceOwnerIds.includes(authority.ownerId) ||
    !pathAllowed(authority.relativePath, authorization.allowedPathPrefixes)) {
    return reject('Resolved source owner or path is not authorized', {
      ownerId: authority.ownerId,
      relativePath: authority.relativePath
    });
  }

  return {
    status: 'resolved',
    source: cloneAndDeepFreeze((() => {
      const withoutRevision = {
        sourceKind: authority.sourceKind,
        ownerId: authority.ownerId,
        writable: true,
        adapterId: authority.adapterId,
        adapterRevision: authority.adapterRevision,
        relativePath: authority.relativePath,
        sourceRevision: authority.sourceRevision,
        loadedContract: authority.loadedContract,
        operations: request.operations
      } as const;
      return {
        ...withoutRevision,
        sourceResolutionRevision: sha256({ domain: 'semantic-mutation-source-resolution-v1', ...withoutRevision })
      };
    })())
  };
}
