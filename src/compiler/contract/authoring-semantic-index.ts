import { z } from 'zod';

import { compareCodeUnits } from '../../contracts/canonical.ts';
import { isSafeRelativePath, posixPath } from '../../contracts/relative-path.ts';
import {
  AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH,
  AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION
} from '../../workspace/contract/authoring-index.ts';
import { modelRelativePath } from '../../workspace/contract/types.ts';
import { CompilerError } from '../errors.ts';

const indexEntrySchema = z.object({
  blockId: z.string(),
  path: z.string()
}).strict();
const indexSchema = z.object({
  formatRevision: z.literal(AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION),
  contracts: z.array(indexEntrySchema)
}).strict();

export type AuthoringSemanticContractIndexEntry = z.infer<typeof indexEntrySchema>;

/** Validate one decoded authoring semantic-contract index against the selected workspace graph. */
export function validateAuthoringSemanticContractIndex(
  value: unknown,
  resolvedBlockIds: ReadonlySet<string>
): AuthoringSemanticContractIndexEntry[] {
  const decoded = indexSchema.safeParse(value);
  if (!decoded.success) {
    const issue = decoded.error.issues[0]!;
    const entryFailure = issue.path[0] === 'contracts' &&
      typeof issue.path[1] === 'number';
    throw new CompilerError(
      entryFailure ? 'CONTRACT-SEMANTIC-020' : 'CONTRACT-SEMANTIC-019',
      entryFailure
        ? 'Every authoring semantic contract index entry requires only blockId and path'
        : `Authoring semantic contract index must use ${AUTHORING_SEMANTIC_CONTRACT_INDEX_REVISION}`,
      {},
      { cause: decoded.error }
    );
  }

  const seenPaths = new Set<string>();
  return decoded.data.contracts.map(entry => {
    const contractPath = posixPath(entry.path);
    if (!entry.blockId.trim() || !resolvedBlockIds.has(entry.blockId)) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-020',
        `Authoring semantic contract block "${entry.blockId}" must be resolved in the workspace`
      );
    }
    if (contractPath !== entry.path ||
        !isSafeRelativePath(contractPath) ||
        !contractPath.startsWith(`${modelRelativePath}/`) ||
        !contractPath.endsWith('.yaml') ||
        contractPath === AUTHORING_SEMANTIC_CONTRACT_INDEX_PATH) {
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
