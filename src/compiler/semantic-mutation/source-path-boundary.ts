import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION, type SemanticMutationSourcePathEvidence, type SemanticMutationWindowsFileAttributes } from '../../semantics/mutation/types.ts';
import {
  SemanticMutationContractError,
  canonicalEquals,
  cloneAndDeepFreeze,
  mutationDiagnostic,
  sha256
} from './canonical.ts';
import { readSemanticMutationWindowsFileAttributes } from './windows-file-attributes.ts';

type FileIdentity = {
  readonly dev: string;
  readonly ino: string;
  readonly nlink: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
};

export interface ReadSemanticMutationSourceResult {
  readonly bytes: Uint8Array;
  readonly pathEvidence: SemanticMutationSourcePathEvidence;
  readonly fileMode: number;
  readonly windowsFileAttributes: SemanticMutationWindowsFileAttributes | null;
}

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function pathFailure(message: string, relativePath: string): never {
  throw new SemanticMutationContractError(mutationDiagnostic(
    'SEMANTIC-MUTATION-005',
    'path',
    message,
    { relativePath }
  ));
}

function casFailure(message: string, relativePath: string): never {
  throw new SemanticMutationContractError(mutationDiagnostic(
    'SEMANTIC-MUTATION-007',
    'cas',
    message,
    { relativePath }
  ));
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.length === 0 || normalized !== relativePath || path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) || normalized.includes('\0')) {
    pathFailure('Source path must be a canonical relative POSIX path', relativePath);
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    pathFailure('Source path contains an empty or traversal segment', relativePath);
  }
  for (const segment of segments) {
    if (segment.includes(':')) pathFailure('Source path contains an NTFS alternate data stream', relativePath);
    const trimmed = segment.replace(/[ .]+$/u, '');
    if (trimmed.length === 0 || WINDOWS_DEVICE_NAME.test(trimmed)) {
      pathFailure('Source path contains a reserved Windows device segment', relativePath);
    }
  }
  if (!normalized.endsWith('.yaml')) {
    pathFailure('Source path is outside the YAML adapter format allowlist', relativePath);
  }
  return normalized;
}

function safeRelative(root: string, target: string): string | undefined {
  const relative = path.relative(root, target);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return relative;
  }
  return undefined;
}

function identity(stat: Awaited<ReturnType<typeof lstat>>): FileIdentity {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    nlink: Number(stat.nlink),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    mode: Number(stat.mode)
  };
}

function identityDigest(domain: string, stat: Awaited<ReturnType<typeof lstat>>, canonicalPath: string): string {
  return sha256({ domain, canonicalPath, identity: identity(stat) });
}

async function exactEntryName(parent: string, requested: string, relativePath: string): Promise<string> {
  const entries = await readdir(parent);
  const folded = requested.toLocaleLowerCase('en-US');
  const matches = entries.filter((entry) => entry.toLocaleLowerCase('en-US') === folded);
  if (matches.length !== 1 || matches[0] !== requested) {
    pathFailure('Source path has a missing, case-mismatched, or case-fold-colliding segment', relativePath);
  }
  return matches[0]!;
}

async function assertTreePath(
  root: string,
  relativePath: string,
  expectedTarget: 'file' | 'directory'
): Promise<{ target: string; parent: string; targetStat: Awaited<ReturnType<typeof lstat>> }> {
  const segments = relativePath === '' ? [] : relativePath.split(path.sep);
  let current = root;
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    pathFailure('Workspace root must be a real directory', relativePath.replaceAll(path.sep, '/'));
  }
  for (const segment of segments) {
    await exactEntryName(current, segment, relativePath.replaceAll(path.sep, '/'));
    current = path.join(current, segment);
    const entryStat = await lstat(current);
    if (entryStat.isSymbolicLink()) {
      pathFailure('Source path crosses a symbolic link, junction, or reparse point', relativePath.replaceAll(path.sep, '/'));
    }
    if (current !== path.join(root, ...segments) && !entryStat.isDirectory()) {
      pathFailure('A source path parent is not a directory', relativePath.replaceAll(path.sep, '/'));
    }
  }
  const targetStat = await lstat(current);
  if ((expectedTarget === 'file' && !targetStat.isFile()) ||
    (expectedTarget === 'directory' && !targetStat.isDirectory()) || targetStat.isSymbolicLink()) {
    pathFailure(`Source path target must be a real ${expectedTarget}`, relativePath.replaceAll(path.sep, '/'));
  }
  return { target: current, parent: path.dirname(current), targetStat };
}

async function inspectPathBoundary(
  workspaceRoot: string,
  transactionDirectory: string,
  requestedRelativePath: string
): Promise<{
  evidence: SemanticMutationSourcePathEvidence;
  target: string;
  targetIdentity: FileIdentity;
  fileMode: number;
  windowsFileAttributes: SemanticMutationWindowsFileAttributes | null;
}> {
  const relativePath = normalizeRelativePath(requestedRelativePath);
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, ...relativePath.split('/'));
  if (safeRelative(root, target) === undefined) pathFailure('Source path escapes the workspace root', relativePath);

  const transaction = path.resolve(transactionDirectory);
  const transactionRelative = safeRelative(root, transaction);
  if (transactionRelative === undefined || transactionRelative === '') {
    pathFailure('Transaction directory must be a dedicated directory inside the workspace', relativePath);
  }

  try {
    const rootReal = await realpath(root);
    const sourceInspection = await assertTreePath(root, relativePath.split('/').join(path.sep), 'file');
    if (Number(sourceInspection.targetStat.nlink) !== 1) {
      pathFailure('Source target must not have hard-link aliases', relativePath);
    }
    await assertTreePath(root, transactionRelative, 'directory');
    const targetReal = await realpath(sourceInspection.target);
    const parentReal = await realpath(sourceInspection.parent);
    const transactionReal = await realpath(transaction);
    const expectedTargetReal = path.resolve(rootReal, ...relativePath.split('/'));
    const folded = (value: string): string => path.resolve(value).toLocaleLowerCase('en-US');
    if (folded(targetReal) !== folded(expectedTargetReal) || safeRelative(rootReal, targetReal) === undefined ||
      safeRelative(rootReal, parentReal) === undefined || safeRelative(rootReal, transactionReal) === undefined) {
      pathFailure('Source or transaction realpath escapes or aliases the workspace root', relativePath);
    }
    const rootStat = await lstat(root);
    const parentStat = await lstat(sourceInspection.parent);
    const transactionStat = await lstat(transaction);
    const withoutRevision = {
      formatRevision: SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION,
      relativePath,
      workspaceIdentityDigest: identityDigest('semantic-mutation-workspace-identity-v1', rootStat, rootReal),
      transactionDirectoryIdentityDigest: identityDigest(
        'semantic-mutation-transaction-directory-identity-v1',
        transactionStat,
        transactionReal
      ),
      parentIdentityDigest: identityDigest('semantic-mutation-parent-identity-v1', parentStat, parentReal),
      targetIdentityDigest: identityDigest(
        'semantic-mutation-target-identity-v1',
        sourceInspection.targetStat,
        targetReal
      )
    } as const;
    const evidence = cloneAndDeepFreeze({
      ...withoutRevision,
      pathEvidenceRevision: sha256({ domain: 'semantic-mutation-source-path-evidence-v1', ...withoutRevision })
    });
    return {
      evidence,
      target: sourceInspection.target,
      targetIdentity: identity(sourceInspection.targetStat),
      fileMode: Number(sourceInspection.targetStat.mode) & 0o7777,
      windowsFileAttributes: await readSemanticMutationWindowsFileAttributes(sourceInspection.target)
    };
  } catch (error) {
    if (error instanceof SemanticMutationContractError) throw error;
    pathFailure('Source path boundary could not be proven', relativePath);
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return canonicalEquals(left, right);
}

export async function readSemanticMutationSource(
  workspaceRoot: string,
  transactionDirectory: string,
  relativePath: string
): Promise<ReadSemanticMutationSourceResult> {
  const beforeBoundary = await inspectPathBoundary(workspaceRoot, transactionDirectory, relativePath);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(beforeBoundary.target, 'r');
  } catch {
    casFailure('Source target changed before a stable read handle could be opened', relativePath);
  }
  try {
    const beforeRead = await handle.stat();
    if (!beforeRead.isFile()) casFailure('Source target changed before it could be read', relativePath);
    if (!sameIdentity(beforeBoundary.targetIdentity, identity(beforeRead))) {
      casFailure('Opened source handle does not match the inspected target identity', relativePath);
    }
    const bytes = new Uint8Array(await handle.readFile());
    const afterRead = await handle.stat();
    if (!sameIdentity(identity(beforeRead), identity(afterRead))) {
      casFailure('Source target changed while it was being read', relativePath);
    }
    const afterBoundary = await inspectPathBoundary(workspaceRoot, transactionDirectory, relativePath);
    if (beforeBoundary.evidence.targetIdentityDigest !== afterBoundary.evidence.targetIdentityDigest ||
      beforeBoundary.evidence.parentIdentityDigest !== afterBoundary.evidence.parentIdentityDigest ||
      beforeBoundary.evidence.workspaceIdentityDigest !== afterBoundary.evidence.workspaceIdentityDigest ||
      JSON.stringify(beforeBoundary.windowsFileAttributes) !==
        JSON.stringify(afterBoundary.windowsFileAttributes) ||
      beforeBoundary.evidence.transactionDirectoryIdentityDigest !==
        afterBoundary.evidence.transactionDirectoryIdentityDigest) {
      casFailure('Source path identity changed during boundary validation', relativePath);
    }
    return Object.freeze({
      bytes: new Uint8Array(bytes),
      pathEvidence: afterBoundary.evidence,
      fileMode: afterBoundary.fileMode,
      windowsFileAttributes: afterBoundary.windowsFileAttributes
    });
  } catch (error) {
    if (error instanceof SemanticMutationContractError) throw error;
    casFailure('Source target could not be read with stable identity', relativePath);
  } finally {
    await handle.close();
  }
}
