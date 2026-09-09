import path from 'node:path';
import { z } from 'zod';

import type { LoadedSemanticContract, SemanticContract } from '../../semantic/contracts/contract/types.ts';
import type { SemanticMutationLoadedSourceCandidate, SemanticMutationSourceKind } from '../../semantic/mutation/contract/types.ts';
import { compareCodeUnits, deepFreeze, digest } from '../../system-architecture/foundation/runtime/canonical.ts';
import { mapTaskGroup } from '../../system-architecture/foundation/runtime/concurrency.ts';
import { getErrorCode } from '../../system-architecture/foundation/runtime/failure-inspection.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import { isSafeRelativePath, posixPath, resolvePathInside } from '../../workspace/runtime/paths.ts';
import { readYaml } from '../../workspace/yaml.ts';
import { CompilerError } from '../errors.ts';
import { normalizeSemanticContract, SEMANTIC_CONTRACT_YAML_MAX_ALIAS_COUNT, SEMANTIC_CONTRACT_YAML_MAX_INPUT_BYTES } from './load-semantic-contract.ts';

export const AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH =
  `${modelRelativePath}/semantic-contracts.yaml` as const;
export const AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION =
  'authoring-semantic-contract-index-v1' as const;

export const AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES = 1024 * 1024;
export const AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_ALIAS_COUNT = 100;

// Private structure with one consumer: keep it here instead of creating another
// cross-domain registry. Resolved Block membership and source paths remain the
// existing semantic checks, not decisions made by a shape decoder.
const indexEntrySchema = z.object({ blockId: z.string(), path: z.string() }).strict();
const indexSchema = z.object({
  formatRevision: z.literal(AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION),
  contracts: z.array(indexEntrySchema)
}).strict();
type AuthoringSemanticContractIndexEntry = z.infer<typeof indexEntrySchema>;

export function semanticContractSourceRevision(
  sourceKind: SemanticMutationSourceKind,
  loadedContract: LoadedSemanticContract
): string {
  const payload = JSON.stringify({
    domain: 'semantic-mutation-loaded-source-v1',
    sourceKind,
    blockId: loadedContract.blockId,
    contractPath: loadedContract.contractPath,
    contract: loadedContract.contract
  });
  return `sha256:${digest(payload)}`;
}

export function buildSemanticContractSourceCandidate(
  sourceKind: SemanticMutationSourceKind,
  loadedContract: LoadedSemanticContract
): SemanticMutationLoadedSourceCandidate {
  const captured = structuredClone(loadedContract);
  // Fingerprint the same snapshot we return, not a second read of the caller.
  // The existing digest format and field order are deliberately unchanged.
  return deepFreeze({
    sourceKind,
    loadedContract: captured,
    sourceRevision: semanticContractSourceRevision(sourceKind, captured)
  });
}

function validateIndex(
  value: unknown,
  resolvedBlockIds: ReadonlySet<string>
): AuthoringSemanticContractIndexEntry[] {
  const decoded = indexSchema.safeParse(value);
  if (!decoded.success) {
    const issue = decoded.error.issues[0]!;
    const entryFailure = issue.path[0] === 'contracts' && typeof issue.path[1] === 'number';
    throw new CompilerError(entryFailure ? 'CONTRACT-SEMANTIC-020' : 'CONTRACT-SEMANTIC-019',
      entryFailure ? 'Every authoring semantic contract index entry requires only blockId and path'
        : `Authoring semantic contract index must use ${AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION}`,
      {}, { cause: decoded.error });
  }
  const seenPaths = new Set<string>();
  return decoded.data.contracts.map((entry) => {
    const contractPath = posixPath(entry.path);
    if (!entry.blockId.trim() || !resolvedBlockIds.has(entry.blockId)) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-020',
        `Authoring semantic contract block "${entry.blockId}" must be resolved in the workspace`
      );
    }
    if (contractPath !== entry.path || !isSafeRelativePath(contractPath) ||
      !contractPath.startsWith(`${modelRelativePath}/`) ||
      !contractPath.endsWith('.yaml') || contractPath === AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-021',
        `Authoring semantic contract path "${contractPath}" must be a YAML file under ${modelRelativePath}/`
      );
    }
    if (seenPaths.has(contractPath)) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-022',
        `Authoring semantic contract index repeats path "${contractPath}"`
      );
    }
    seenPaths.add(contractPath);
    return { blockId: entry.blockId, path: contractPath };
  }).sort((left, right) => compareCodeUnits(left.path, right.path));
}

export async function loadAuthoringSemanticContractSources(
  workspaceRoot: string,
  resolvedBlockIds: ReadonlySet<string>
): Promise<SemanticMutationLoadedSourceCandidate[]> {
  workspaceRoot = path.resolve(workspaceRoot);
  const selectedBlockIds = new Set(resolvedBlockIds);
  const indexPath = path.resolve(workspaceRoot, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
  let raw: unknown;
  try {
    // Observe optional absence once. A separate access check cannot prove the
    // later read still exists, and all non-absence failures must propagate.
    raw = await readYaml(indexPath, {
      maximumInputBytes: AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES,
      maximumAliasCount: AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_ALIAS_COUNT,
      stringKeys: true
    });
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const index = validateIndex(raw, selectedBlockIds);
  return mapTaskGroup(index, async (entry) => {
    const absolutePath = resolvePathInside(workspaceRoot, entry.path);
    if (!absolutePath) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-021',
        `Authoring semantic contract path "${entry.path}" escapes the workspace`
      );
    }
    const loadedContract: LoadedSemanticContract = {
      blockId: entry.blockId,
      contractPath: entry.path,
      contract: normalizeSemanticContract(await readYaml<SemanticContract>(absolutePath, {
        maximumInputBytes: SEMANTIC_CONTRACT_YAML_MAX_INPUT_BYTES,
        maximumAliasCount: SEMANTIC_CONTRACT_YAML_MAX_ALIAS_COUNT,
        stringKeys: true
      }))
    };
    return buildSemanticContractSourceCandidate('workspace-authoring', loadedContract);
  });
}
