import path from 'node:path';
import type { ManifestEntry } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import { compareCodeUnits } from '../../../contracts/canonical.ts';
import { isSafeRelativePath, posixPath } from '../../../contracts/relative-path.ts';
import { normalizeSemanticContract } from '../../../semantics/definitions/normalize.ts';
import type { LoadedSemanticContract, SemanticContract } from '../../../semantics/definitions/types.ts';
import { isYamlParseFailure, parseYamlValue } from '../../formats/yaml.ts';
import { readManifestResourceFileUtf8 } from './read-manifest-resource.ts';

export const SEMANTIC_CONTRACT_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const SEMANTIC_CONTRACT_YAML_MAX_ALIAS_COUNT = 100;

function stableContractPath(entry: ManifestEntry, absolutePath: string): string {
  const relative = posixPath(path.relative(entry.registryRoot, absolutePath));
  return posixPath(path.posix.join(posixPath(entry.registryPath), relative));
}

export async function loadSemanticContractsForManifestEntry(entry: ManifestEntry): Promise<LoadedSemanticContract[]> {
  const seenPaths = new Set<string>();
  const loaded: LoadedSemanticContract[] = [];

  for (const reference of [...entry.manifest.contracts].sort((left, right) => compareCodeUnits(left.path, right.path))) {
    if (!reference?.path || !isSafeRelativePath(reference.path)) {
      throw new CompilerError('CONTRACT-SEMANTIC-015', `Manifest "${entry.manifest.id}" contract paths must stay inside the block root`);
    }
    if (seenPaths.has(reference.path)) {
      throw new CompilerError('CONTRACT-SEMANTIC-016', `Manifest "${entry.manifest.id}" repeats contract path "${reference.path}"`);
    }
    seenPaths.add(reference.path);

    const source = readManifestResourceFileUtf8(entry, reference.path);
    if (source === null) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-015',
        `Manifest "${entry.manifest.id}" contract resource "${reference.path}" is absent`
      );
    }
    let parsed: unknown;
    try {
      parsed = parseYamlValue(source.raw, {
        label: `Manifest ${entry.manifest.id} semantic contract ${reference.path}`,
        maximumInputBytes: SEMANTIC_CONTRACT_YAML_MAX_INPUT_BYTES,
        maximumAliasCount: SEMANTIC_CONTRACT_YAML_MAX_ALIAS_COUNT
      });
    } catch (error) {
      if (!isYamlParseFailure(error)) throw error;
      throw new CompilerError(
        'CONTRACT-SEMANTIC-023',
        `Manifest "${entry.manifest.id}" contract resource "${reference.path}" is not valid bounded YAML`,
        { yamlFailureCode: error.code, yamlFailureKind: error.kind },
        { cause: error }
      );
    }
    const contract = normalizeSemanticContract(parsed as SemanticContract);
    loaded.push({
      blockId: entry.manifest.id,
      contractPath: stableContractPath(entry, source.path),
      contract
    });
  }

  return loaded.sort((left, right) => compareCodeUnits(`${left.blockId}:${left.contract.id}`, `${right.blockId}:${right.contract.id}`));
}
