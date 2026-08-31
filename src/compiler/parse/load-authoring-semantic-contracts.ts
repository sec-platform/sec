import { access } from 'node:fs/promises';
import path from 'node:path';

import type { LoadedSemanticContract, SemanticContract } from '../../semantic/contracts/contract/types.ts';
import type { SemanticMutationLoadedSourceCandidate, SemanticMutationSourceKind } from '../../semantic/mutation/contract/types.ts';
import { compareCodeUnits, digest } from '../../system-architecture/foundation/runtime/canonical.ts';
import { isSafeRelativePath, modelRelativePath, posixPath, resolvePathInside } from '../../workspace/paths.ts';
import { readYaml } from '../../workspace/yaml.ts';
import { CompilerError } from '../errors.ts';
import { normalizeSemanticContract } from './load-semantic-contract.ts';

export const AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH =
  `${modelRelativePath}/semantic-contracts.yaml` as const;
export const AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION =
  'authoring-semantic-contract-index-v1' as const;

interface AuthoringSemanticContractIndexEntry {
  readonly blockId: string;
  readonly path: string;
}

interface AuthoringSemanticContractIndex {
  readonly formatRevision: typeof AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION;
  readonly contracts: readonly AuthoringSemanticContractIndexEntry[];
}

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
  const candidate = {
    sourceKind,
    loadedContract: structuredClone(loadedContract),
    sourceRevision: semanticContractSourceRevision(sourceKind, loadedContract)
  };
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const nested of Object.values(value as Record<string, unknown>)) freeze(nested);
    Object.freeze(value);
  };
  freeze(candidate);
  return candidate;
}

function validateIndex(
  value: unknown,
  resolvedBlockIds: ReadonlySet<string>
): AuthoringSemanticContractIndexEntry[] {
  const exactKeys = (entry: unknown, keys: readonly string[]): entry is Record<string, unknown> =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) &&
    Object.keys(entry).length === keys.length && keys.every((key) => Object.hasOwn(entry, key));
  if (!exactKeys(value, ['formatRevision', 'contracts']) ||
    value.formatRevision !== AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION || !Array.isArray(value.contracts)) {
    throw new CompilerError(
      'CONTRACT-SEMANTIC-019',
      `Authoring semantic contract index must use ${AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION}`
    );
  }
  const seenPaths = new Set<string>();
  return value.contracts.map((entry) => {
    if (!exactKeys(entry, ['blockId', 'path']) || typeof entry.blockId !== 'string' ||
      typeof entry.path !== 'string') {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-020',
        'Every authoring semantic contract index entry requires only blockId and path'
      );
    }
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
  const indexPath = path.resolve(workspaceRoot, ...AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH.split('/'));
  try {
    await access(indexPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const index = validateIndex(await readYaml<AuthoringSemanticContractIndex>(indexPath), resolvedBlockIds);
  return Promise.all(index.map(async (entry) => {
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
      contract: normalizeSemanticContract(await readYaml<SemanticContract>(absolutePath))
    };
    return buildSemanticContractSourceCandidate('workspace-authoring', loadedContract);
  }));
}
