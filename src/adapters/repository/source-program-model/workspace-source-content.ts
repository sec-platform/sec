import { rawSha256, compareCodeUnits, sha256 } from '../../../contracts/canonical.ts';
import { normalizeRepositoryModulePath } from '../architecture/contract.ts';
import { type SourceProgramFileInput } from './contract.ts';

export type WorkspaceSourceFileMode = '100644' | '100755';

export type WorkspaceSourceFile = SourceProgramFileInput & Readonly<{
  mode: WorkspaceSourceFileMode;
}>;

export function canonicalFiles(
  files: readonly (SourceProgramFileInput & Readonly<{ mode?: WorkspaceSourceFileMode }>)[]
): readonly WorkspaceSourceFile[] {
  const canonical = files.map((file) => {
    const repositoryPath = normalizeRepositoryModulePath(file.path);
    if (repositoryPath !== file.path || repositoryPath.length === 0) {
      throw new Error(`Workspace source snapshot path is not canonical: ${file.path}`);
    }
    if (rawSha256(file.source) !== file.contentDigest) {
      throw new Error(`Workspace source snapshot digest does not bind source bytes: ${file.path}`);
    }
    const mode = file.mode ?? '100644';
    if (mode !== '100644' && mode !== '100755') {
      throw new Error(`Workspace source snapshot mode is not canonical: ${file.path}`);
    }
    return Object.freeze({
      path: repositoryPath,
      mode,
      source: file.source,
      contentDigest: file.contentDigest
    });
  }).sort((left, right) => compareCodeUnits(left.path, right.path));
  for (let index = 1; index < canonical.length; index += 1) {
    if (canonical[index - 1]!.path === canonical[index]!.path) {
      throw new Error(`Workspace source snapshot contains duplicate path: ${canonical[index]!.path}`);
    }
  }
  return Object.freeze(canonical);
}

export function sourceGeneration(files: readonly WorkspaceSourceFile[]): `sha256:${string}` {
  return sha256({
    schema: 'sec-workspace-source-generation-v1',
    files: files.map(({ path, mode, contentDigest }) => ({ path, mode, contentDigest }))
  }) as `sha256:${string}`;
}

/** Compile the only source revision grammar used by workspace snapshots and downstream receipts. */
export function compileWorkspaceSourceRevision(
  files: readonly (SourceProgramFileInput & Readonly<{ mode?: WorkspaceSourceFileMode }>)[]
): `sha256:${string}` {
  return sourceGeneration(canonicalFiles(files));
}
