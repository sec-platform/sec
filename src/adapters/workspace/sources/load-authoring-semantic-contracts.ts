import { buildSemanticContractSourceCandidate } from '../../../semantics/provenance/source-candidate.ts';
import { AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH } from '../../../workspace/contract/authoring-index.ts';
import { validateAuthoringSemanticContractIndex } from '../../../compiler/contract/authoring-semantic-index.ts';
import path from 'node:path';
import type { LoadedSemanticContract, SemanticContract } from '../../../semantics/definitions/types.ts';
import type { SemanticMutationLoadedSourceCandidate } from '../../../semantics/mutation/types.ts';
import { mapTaskGroup } from '../../../execution/task-group.ts';
import { getErrorCode } from '../../../contracts/failure-inspection.ts';
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import { readYaml } from '../yaml.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { normalizeSemanticContract } from '../../../semantics/definitions/normalize.ts';
import { SEMANTIC_CONTRACT_YAML_MAX_ALIAS_COUNT, SEMANTIC_CONTRACT_YAML_MAX_INPUT_BYTES } from './load-semantic-contract.ts';

export const AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_INPUT_BYTES = 1024 * 1024;
export const AUTHORING_SEMANTIC_CONTRACT_INDEX_MAX_ALIAS_COUNT = 100;

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
  const index = validateAuthoringSemanticContractIndex(raw, selectedBlockIds);
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
