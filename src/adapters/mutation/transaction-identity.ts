import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SemanticMutationRequestIdentity } from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationBase } from '../../semantics/mutation/types.ts';
import {
  semanticMutationRequestIdentityDigest,
  semanticMutationStagedTransactionId
} from '../../compiler/semantic-mutation/identity.ts';
export {
  semanticMutationRequestIdentityDigest,
  semanticMutationStagedTransactionId
} from '../../compiler/semantic-mutation/identity.ts';
import { isSemanticMutationWindowsReparsePoint } from './windows-file-attributes.ts';

const SHA256_PREFIX = 'sha256:';
const TRANSACTION_NAME_PATTERN = /^[0-9a-f]{64}$/u;
const TRANSACTION_PARENT_SEGMENTS = ['.sec', 'semantic-mutation', 'v1', 'transactions'] as const;

export type SemanticMutationCommitFence = () => Promise<void>;

function transactionRootFailure(): never {
  throw new Error('Semantic Mutation transaction root binding is invalid');
}

function journalDirectoryFailure(): never {
  throw new Error('Semantic Mutation journal directory binding is invalid');
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function pathStaysWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function assertCanonicalJournalDirectoryChain(
  workspaceRoot: string,
  directory: string
): Promise<void> {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedDirectory = path.resolve(directory);
  if (!pathStaysWithin(resolvedWorkspaceRoot, resolvedDirectory)) journalDirectoryFailure();

  let workspaceStat: Awaited<ReturnType<typeof lstat>>;
  let workspaceReal: string;
  try {
    workspaceStat = await lstat(resolvedWorkspaceRoot);
    workspaceReal = await realpath(resolvedWorkspaceRoot);
  } catch {
    journalDirectoryFailure();
  }
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() ||
    await isSemanticMutationWindowsReparsePoint(resolvedWorkspaceRoot) ||
    !samePath(workspaceReal, resolvedWorkspaceRoot)) {
    journalDirectoryFailure();
  }

  const relative = path.relative(resolvedWorkspaceRoot, resolvedDirectory);
  let currentPath = resolvedWorkspaceRoot;
  let expectedRealPath = workspaceReal;
  for (const segment of relative === '' ? [] : relative.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    expectedRealPath = path.join(expectedRealPath, segment);
    let currentStat: Awaited<ReturnType<typeof lstat>>;
    try {
      currentStat = await lstat(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      journalDirectoryFailure();
    }
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink() ||
      await isSemanticMutationWindowsReparsePoint(currentPath)) {
      journalDirectoryFailure();
    }
    let currentReal: string;
    try {
      currentReal = await realpath(currentPath);
    } catch {
      journalDirectoryFailure();
    }
    if (!samePath(currentReal, expectedRealPath) || !pathStaysWithin(workspaceReal, currentReal)) {
      journalDirectoryFailure();
    }
  }
}

export function semanticMutationRequestIdentityDigestFromTransactionName(name: string): string {
  if (!TRANSACTION_NAME_PATTERN.test(name)) transactionRootFailure();
  return `${SHA256_PREFIX}${name}`;
}

export function semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot: string): string {
  if (!path.isAbsolute(transactionRoot) || path.normalize(transactionRoot) !== transactionRoot) {
    transactionRootFailure();
  }
  const resolvedRoot = path.resolve(transactionRoot);
  const name = path.basename(resolvedRoot);
  semanticMutationRequestIdentityDigestFromTransactionName(name);
  let current = path.dirname(resolvedRoot);
  for (const expected of [...TRANSACTION_PARENT_SEGMENTS].reverse()) {
    if (path.basename(current) !== expected) transactionRootFailure();
    current = path.dirname(current);
  }
  const expectedRoot = path.join(current, ...TRANSACTION_PARENT_SEGMENTS, name);
  if (!samePath(resolvedRoot, expectedRoot)) transactionRootFailure();
  return current;
}

export async function assertSemanticMutationTransactionRoot(
  workspaceRoot: string,
  transactionRoot: string,
  requestIdentityDigest?: string
): Promise<void> {
  const derivedWorkspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedTransactionRoot = path.resolve(transactionRoot);
  const transactionName = path.basename(resolvedTransactionRoot);
  const boundDigest = semanticMutationRequestIdentityDigestFromTransactionName(transactionName);
  if (!samePath(derivedWorkspaceRoot, resolvedWorkspaceRoot) ||
    (requestIdentityDigest !== undefined && requestIdentityDigest !== boundDigest)) {
    transactionRootFailure();
  }

  const transactionsParent = path.join(resolvedWorkspaceRoot, ...TRANSACTION_PARENT_SEGMENTS);
  if (!samePath(path.dirname(resolvedTransactionRoot), transactionsParent)) transactionRootFailure();

  let workspaceStat: Awaited<ReturnType<typeof lstat>>;
  let workspaceReal: string;
  try {
    workspaceStat = await lstat(resolvedWorkspaceRoot);
    workspaceReal = await realpath(resolvedWorkspaceRoot);
  } catch {
    transactionRootFailure();
  }
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink() ||
    await isSemanticMutationWindowsReparsePoint(resolvedWorkspaceRoot) ||
    !samePath(workspaceReal, resolvedWorkspaceRoot)) {
    transactionRootFailure();
  }

  let currentPath = resolvedWorkspaceRoot;
  let expectedRealPath = workspaceReal;
  for (const segment of [...TRANSACTION_PARENT_SEGMENTS, transactionName]) {
    currentPath = path.join(currentPath, segment);
    expectedRealPath = path.join(expectedRealPath, segment);
    let currentStat: Awaited<ReturnType<typeof lstat>>;
    try {
      currentStat = await lstat(currentPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      transactionRootFailure();
    }
    if (!currentStat.isDirectory() || currentStat.isSymbolicLink() ||
      await isSemanticMutationWindowsReparsePoint(currentPath)) {
      transactionRootFailure();
    }
    let currentReal: string;
    try {
      currentReal = await realpath(currentPath);
    } catch {
      transactionRootFailure();
    }
    if (!samePath(currentReal, expectedRealPath) || !pathStaysWithin(workspaceReal, currentReal)) {
      transactionRootFailure();
    }
  }
}

export async function assertSemanticMutationRecoveryRecordsDirectory(
  transactionRoot: string,
  requestIdentityDigest?: string
): Promise<string> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  const directory = path.join(path.resolve(transactionRoot), 'records');
  await assertCanonicalJournalDirectoryChain(workspaceRoot, directory);
  return directory;
}

export async function assertSemanticMutationTerminalOrderDirectory(
  transactionRoot: string,
  requestIdentityDigest?: string
): Promise<string> {
  const workspaceRoot = semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot);
  await assertSemanticMutationTransactionRoot(workspaceRoot, transactionRoot, requestIdentityDigest);
  const expectedJournalRoot = semanticMutationJournalRoot(workspaceRoot);
  const transactionJournalRoot = path.dirname(path.dirname(path.resolve(transactionRoot)));
  if (!samePath(expectedJournalRoot, transactionJournalRoot)) journalDirectoryFailure();
  const directory = path.join(expectedJournalRoot, 'terminal-order');
  await assertCanonicalJournalDirectoryChain(workspaceRoot, directory);
  return directory;
}

export function semanticMutationTransactionRoot(
  workspaceRoot: string,
  requestIdentityDigest: string
): string {
  const transactionName = requestIdentityDigest.slice(SHA256_PREFIX.length);
  if (semanticMutationRequestIdentityDigestFromTransactionName(transactionName) !== requestIdentityDigest) {
    transactionRootFailure();
  }
  return path.join(
    path.resolve(workspaceRoot),
    ...TRANSACTION_PARENT_SEGMENTS,
    transactionName
  );
}

export function semanticMutationJournalRoot(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), '.sec', 'semantic-mutation', 'v1');
}
