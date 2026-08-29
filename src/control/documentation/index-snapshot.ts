import path from 'node:path';

export const DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT = Object.freeze({
  schema: 'docs-doctor-index-snapshot-layout-v3',
  snapshotParentName: 'd3',
  snapshotTokenHexLength: 12,
  indexName: 'i',
  objectDirectoryName: 'o',
  windowsLegacyChildPathMax: 259,
  gitObjectIdHexLengths: Object.freeze({ sha1: 40, sha256: 64 }),
  /** Longer than Git's current tmp_obj_XXXXXX leaf without binding to it. */
  gitTemporaryObjectLeafBudget: 32
} as const);

export type DocsDoctorGitObjectFormat =
  keyof typeof DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT.gitObjectIdHexLengths;

export function docsDoctorGitObjectIdHexLength(
  objectFormat: DocsDoctorGitObjectFormat
): number {
  const length = DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT.gitObjectIdHexLengths[objectFormat];
  if (length === undefined) fail(`Git object format ${String(objectFormat)} is unsupported.`);
  return length;
}

export function isDocsDoctorGitObjectId(
  source: string,
  objectFormat: DocsDoctorGitObjectFormat
): boolean {
  return new RegExp(`^[0-9a-f]{${docsDoctorGitObjectIdHexLength(objectFormat)}}$`, 'u').test(source);
}

export interface DocsDoctorIndexSnapshotLayout {
  readonly snapshotParent: string;
  readonly snapshotRoot: string;
  readonly snapshotName: string;
  readonly indexPath: string;
  readonly objectDirectory: string;
  readonly childProcessPathBudget: Readonly<{
    readonly limit: number | null;
    readonly longestPath: string;
    readonly longestPathLength: number;
  }>;
}

function fail(message: string): never {
  throw new Error(`docs-doctor index snapshot layout: ${message}`);
}

/**
 * Pure owner for the disposable docs-doctor Git snapshot layout and the
 * complete Windows child-process path budget. The implementation may create
 * these paths only after this function has accepted them.
 */
export function compileDocsDoctorIndexSnapshotLayout(input: Readonly<{
  cacheRoot: string;
  objectFormat: DocsDoctorGitObjectFormat;
  platform: NodeJS.Platform;
  snapshotToken: string;
}>): DocsDoctorIndexSnapshotLayout {
  const policy = DOCS_DOCTOR_INDEX_SNAPSHOT_LAYOUT;
  if (!/^[0-9a-f]+$/u.test(input.snapshotToken)
      || input.snapshotToken.length !== policy.snapshotTokenHexLength) {
    fail(`snapshotToken must be exactly ${policy.snapshotTokenHexLength} lowercase hex characters.`);
  }
  const api = input.platform === 'win32' ? path.win32 : path.posix;
  if (!api.isAbsolute(input.cacheRoot)) fail('cacheRoot must be absolute.');
  const snapshotParent = api.join(input.cacheRoot, policy.snapshotParentName);
  const snapshotName = input.snapshotToken;
  const snapshotRoot = api.join(snapshotParent, snapshotName);
  const indexPath = api.join(snapshotRoot, policy.indexName);
  const objectDirectory = api.join(snapshotRoot, policy.objectDirectoryName);
  const objectIdHexLength = docsDoctorGitObjectIdHexLength(input.objectFormat);
  const gitObjectLeafBudget = Math.max(
    objectIdHexLength - 2,
    policy.gitTemporaryObjectLeafBudget
  );
  const candidatePaths = [
    `${indexPath}.lock`,
    api.join(
      objectDirectory,
      'ff',
      'f'.repeat(gitObjectLeafBudget)
    )
  ];
  const longestPath = candidatePaths.reduce((longest, candidate) =>
    candidate.length > longest.length ? candidate : longest);
  const limit = input.platform === 'win32'
    ? policy.windowsLegacyChildPathMax
    : null;
  if (limit !== null && longestPath.length > limit) {
    fail(
      `cacheRoot leaves ${longestPath.length} characters for a bounded Git write-tree path; `
      + `the Windows legacy child-process limit is ${limit}.`
    );
  }
  return Object.freeze({
    snapshotParent,
    snapshotRoot,
    snapshotName,
    indexPath,
    objectDirectory,
    childProcessPathBudget: Object.freeze({
      limit,
      longestPath,
      longestPathLength: longestPath.length
    })
  });
}
