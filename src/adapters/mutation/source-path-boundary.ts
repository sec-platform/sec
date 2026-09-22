import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { SEMANTIC_MUTATION_SOURCE_PATH_EVIDENCE_REVISION, type SemanticMutationSourcePathEvidence, type SemanticMutationWindowsFileAttributes } from '../../semantics/mutation/types.ts';
import {
  SemanticMutationContractError,
  canonicalEquals,
  cloneAndDeepFreeze,
  mutationDiagnostic,
  sha256
} from '../../compiler/semantic-mutation/canonical.ts';
import { assertNoSourceReplacementResidue, SourceReplacementResidueError } from '../runtime-state/physical/runtime/retained-source-replacement.ts';
import { readSemanticMutationWindowsFileAttributes } from './windows-file-attributes.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';

const SOURCE_READ_MAXIMUM_BYTES = 64 * 1024 * 1024;

interface SourceReadBudget {
  assertCurrent(): void;
  consumeEntry(): void;
}

function sourceReadBudget(relativePath: string): SourceReadBudget {
  const deadlineAtMs = performance.now() + 30_000;
  let remainingEntries = 300_000;
  const fail = (errorCode: string): never => {
    throw new SemanticMutationContractError(mutationDiagnostic(
      'SEMANTIC-MUTATION-005', 'path', 'Source path read exceeded its resource budget',
      { relativePath, details: { errorCode } }
    ));
  };
  const assertCurrent = (): void => {
    if (performance.now() >= deadlineAtMs) fail('SOURCE_READ_DEADLINE');
  };
  return {
    assertCurrent,
    consumeEntry(): void {
      assertCurrent();
      if (remainingEntries === 0) fail('SOURCE_READ_ENTRY_LIMIT');
      remainingEntries -= 1;
    }
  };
}

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

async function exactEntryName(
  parent: string,
  requested: string,
  relativePath: string,
  budget: SourceReadBudget
): Promise<string> {
  budget.assertCurrent();
  const chain = inspectNoFollowDirectoryChain(parent, 'Source case census parent');
  const boundary = retainNoFollowDirectoryForChildProcess(chain, 4, 'Source case census');
  let directory: Awaited<ReturnType<typeof opendir>> | undefined;
  let exact = false;
  let matches = 0;
  try {
    // Linux enumerates the already-open directory object. Windows pins every
    // ancestor of the lexical spelling for this same bounded enumeration.
    const enumerationPath = boundary.stdioSourceDescriptor === null
      ? boundary.childPath
      : '/proc/self/fd/' + boundary.stdioSourceDescriptor;
    directory = await opendir(enumerationPath);
    const folded = requested.toLocaleLowerCase('en-US');
    for (;;) {
      budget.assertCurrent();
      const entry = await directory.read();
      budget.assertCurrent();
      if (entry === null) break;
      budget.consumeEntry();
      if (entry.name.toLocaleLowerCase('en-US') === folded) {
        matches += 1;
        exact = entry.name === requested;
        if (matches > 1) break;
      }
    }
    boundary.assertCurrent();
    assertSameNoFollowDirectoryIdentity(chain.target, 'Source case census parent');
    if (matches !== 1 || !exact) {
      pathFailure('Source path has a missing, case-mismatched, or case-fold-colliding segment', relativePath);
    }
    return requested;
  } finally {
    try { await directory?.close(); } finally { boundary.dispose(); }
  }
}

async function assertTreePath(
  root: string,
  relativePath: string,
  expectedTarget: 'file' | 'directory',
  budget: SourceReadBudget
): Promise<{ target: string; parent: string; targetStat: Awaited<ReturnType<typeof lstat>> }> {
  const segments = relativePath === '' ? [] : relativePath.split(path.sep);
  let current = root;
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    pathFailure('Workspace root must be a real directory', relativePath.replaceAll(path.sep, '/'));
  }
  for (const segment of segments) {
    await exactEntryName(current, segment, relativePath.replaceAll(path.sep, '/'), budget);
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
  requestedRelativePath: string,
  budget: SourceReadBudget
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
    budget.assertCurrent();
    const sourceInspection = await assertTreePath(root, relativePath.split('/').join(path.sep), 'file', budget);
    if (Number(sourceInspection.targetStat.nlink) !== 1) {
      pathFailure('Source target must not have hard-link aliases', relativePath);
    }
    await assertTreePath(root, transactionRelative, 'directory', budget);
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

export async function readSemanticMutationSource(
  workspaceRoot: string,
  transactionDirectory: string,
  relativePath: string
): Promise<ReadSemanticMutationSourceResult> {
  const normalized = normalizeRelativePath(relativePath);
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, ...normalized.split('/'));
  const transaction = path.resolve(transactionDirectory);
  const transactionRelative = safeRelative(root, transaction);
  if (safeRelative(root, target) === undefined || transactionRelative === undefined || transactionRelative === '') {
    pathFailure('Source and transaction paths must stay inside their workspace', relativePath);
  }
  const budget = sourceReadBudget(relativePath);
  let source: RetainedNoFollowOrdinaryFile | undefined;
  let transactionBoundary: RetainedNoFollowChildProcessDirectory | undefined;
  let result: ReadSemanticMutationSourceResult | undefined;
  let admission = true;
  const failures: unknown[] = [];
  try {
    // The retained leaf precedes both legacy evidence observations. The
    // evidence schema remains stable, but it no longer authorizes a second
    // lexical open for the bytes. Windows also excludes concurrent writers.
    source = retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(target), 'Mutation source parent'),
      path.basename(target), undefined, 'Mutation source'
    );
    if (source.linkCount !== 1) pathFailure('Source target must not have hard-link aliases', relativePath);
    if (source.size > SOURCE_READ_MAXIMUM_BYTES) {
      pathFailure('Source target exceeds the bounded ordinary-file read domain', relativePath);
    }
    const transactionChain = inspectNoFollowDirectoryChain(transaction, 'Mutation source transaction');
    transactionBoundary = retainNoFollowDirectoryForChildProcess(transactionChain, 4, 'Mutation source transaction');
    const assertSettlement = (): void => {
      try { assertNoSourceReplacementResidue(transactionChain.target); }
      catch (error) {
        if (!(error instanceof SourceReplacementResidueError)) throw error;
        throw new SemanticMutationContractError(mutationDiagnostic(
          'SEMANTIC-MUTATION-012', 'rollback',
          'Source replacement residue requires identity-bound recovery',
          { relativePath, details: { errorCode: 'SOURCE_REPLACEMENT_UNSETTLED' } }
        ));
      }
    };
    assertSettlement();
    const assertCurrent = (): void => {
      budget.assertCurrent();
      source!.assertCurrent();
      transactionBoundary!.assertCurrent();
      assertSameNoFollowDirectoryIdentity(transactionChain.target, 'Mutation source transaction');
    };
    assertCurrent();
    const beforeBoundary = await inspectPathBoundary(root, transaction, normalized, budget);
    assertCurrent();
    admission = false;
    const bytes = new Uint8Array(source.readBytes());
    assertCurrent();
    const afterBoundary = await inspectPathBoundary(root, transaction, normalized, budget);
    assertCurrent();
    if (!canonicalEquals(beforeBoundary.evidence, afterBoundary.evidence) ||
        !canonicalEquals(beforeBoundary.windowsFileAttributes, afterBoundary.windowsFileAttributes) ||
        beforeBoundary.fileMode !== afterBoundary.fileMode || bytes.byteLength !== source.size) {
      casFailure('Source path identity changed during boundary validation', relativePath);
    }
    assertSettlement();
    result = Object.freeze({
      bytes,
      pathEvidence: afterBoundary.evidence,
      fileMode: afterBoundary.fileMode,
      windowsFileAttributes: afterBoundary.windowsFileAttributes
    });
  } catch (error) {
    failures.push(error instanceof SemanticMutationContractError ? error : new SemanticMutationContractError(
      mutationDiagnostic(
        admission ? 'SEMANTIC-MUTATION-005' : 'SEMANTIC-MUTATION-007',
        admission ? 'path' : 'cas',
        admission ? 'Source path boundary could not be retained safely' : 'Source target could not be read with stable identity',
        { relativePath }
      )
    ));
  } finally {
    for (const retained of [source, transactionBoundary]) {
      try { retained?.dispose(); } catch {
        failures.push(new SemanticMutationContractError(mutationDiagnostic(
          'SEMANTIC-MUTATION-007', 'cas', 'Source read handle settlement failed', { relativePath }
        )));
      }
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Source read and retained handle settlement failed');
  return result!;
}
