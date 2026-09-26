import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  classifySemanticMutationTransactionRoot,
  semanticMutationStateRoot,
  semanticMutationTransactionRootForLayout,
  semanticMutationTransactionsRoot,
  type SemanticMutationStateLayout
} from '../../workspace/contract/semantic-mutation/state-layout.ts';
import { isSemanticMutationWindowsReparsePoint } from './windows-file-attributes.ts';

const SHA256_PREFIX = 'sha256:';
const TRANSACTION_NAME_PATTERN = /^[0-9a-f]{64}$/u;

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

function semanticMutationRequestIdentityDigestFromTransactionName(name: string): string {
  if (!TRANSACTION_NAME_PATTERN.test(name)) transactionRootFailure();
  return `${SHA256_PREFIX}${name}`;
}

function transactionLocation(transactionRoot: string) {
  const location = classifySemanticMutationTransactionRoot(transactionRoot);
  if (location === null) transactionRootFailure();
  semanticMutationRequestIdentityDigestFromTransactionName(location.transactionName);
  return location;
}

export function semanticMutationWorkspaceRootFromTransactionRoot(transactionRoot: string): string {
  return transactionLocation(transactionRoot).workspaceRoot;
}

export function semanticMutationTransactionLayout(transactionRoot: string): SemanticMutationStateLayout {
  return transactionLocation(transactionRoot).layout;
}

export async function assertSemanticMutationTransactionRoot(
  workspaceRoot: string,
  transactionRoot: string,
  requestIdentityDigest?: string
): Promise<void> {
  const location = transactionLocation(transactionRoot);
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedTransactionRoot = path.resolve(transactionRoot);
  const boundDigest = semanticMutationRequestIdentityDigestFromTransactionName(location.transactionName);
  if (!samePath(location.workspaceRoot, resolvedWorkspaceRoot) ||
    (requestIdentityDigest !== undefined && requestIdentityDigest !== boundDigest)) {
    transactionRootFailure();
  }

  const transactionsParent = semanticMutationTransactionsRoot(resolvedWorkspaceRoot, location.layout);
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

  const relative = path.relative(resolvedWorkspaceRoot, resolvedTransactionRoot);
  let currentPath = resolvedWorkspaceRoot;
  let expectedRealPath = workspaceReal;
  for (const segment of relative.split(path.sep)) {
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
  const location = transactionLocation(transactionRoot);
  await assertSemanticMutationTransactionRoot(location.workspaceRoot, transactionRoot, requestIdentityDigest);
  const expectedJournalRoot = semanticMutationJournalRoot(location.workspaceRoot, location.layout);
  const transactionJournalRoot = path.dirname(path.dirname(path.resolve(transactionRoot)));
  if (!samePath(expectedJournalRoot, transactionJournalRoot)) journalDirectoryFailure();
  const directory = path.join(expectedJournalRoot, 'terminal-order');
  await assertCanonicalJournalDirectoryChain(location.workspaceRoot, directory);
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
  return semanticMutationTransactionRootForLayout(workspaceRoot, transactionName);
}

export function semanticMutationLegacyTransactionRoot(
  workspaceRoot: string,
  requestIdentityDigest: string
): string {
  const transactionName = requestIdentityDigest.slice(SHA256_PREFIX.length);
  if (semanticMutationRequestIdentityDigestFromTransactionName(transactionName) !== requestIdentityDigest) {
    transactionRootFailure();
  }
  return semanticMutationTransactionRootForLayout(workspaceRoot, transactionName, 'legacy');
}

export function semanticMutationJournalRoot(
  workspaceRoot: string,
  layout: SemanticMutationStateLayout = 'current'
): string {
  return semanticMutationStateRoot(workspaceRoot, layout);
}
