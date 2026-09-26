import { parseExactGitBlobInfoBatch, parseExactGitBlobsBatch, parseExactGitTreeEntries } from '../../../../providers/git-read/exact-blob.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/budget.ts';
import {
  decodeBranchLifecycleChildError
} from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import {
  ParseWorkPackageLocator,
  WorkPackageManifestDigest
} from '../../../../self-hosting/control/task/contract/work-package.ts';
import {
  VERIFICATION_REGISTRY_PROJECTION_SCHEMA,
  type VerificationRegistryEntry
} from '../contract/session.ts';

export interface OpenPullRequestFact {
  number: number;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  body: string;
}

/** The caller binds its existing Git read transport, root and aggregate budget.
 * This read model neither opens another command provider nor issues authority. */
export type WorkPackageRegistryGitRead = (args: readonly string[], input?: Uint8Array) =>
  Readonly<{ status: number | null; stdout: Buffer; stderr: Buffer }> |
  Promise<Readonly<{ status: number | null; stdout: Buffer; stderr: Buffer }>>;

export type WorkPackageRegistryReadBudget = Readonly<{
  maxCommandStdoutBytes: number;
  consumeRecords: (count: number) => void;
}>;

export function parseOpenPullRequestList(source: string): OpenPullRequestFact[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) throw new Error('Open PR list must be an array.');
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Open PR entry ${index} must be an object.`);
    }
    const record = entry as Record<string, unknown>;
    const number = record.number;
    const headSha = record.headRefOid;
    const baseSha = record.baseRefOid;
    const headBranch = record.headRefName;
    const baseBranch = record.baseRefName;
    const body = record.body;
    if (
      !Number.isSafeInteger(number)
      || (number as number) <= 0
      || typeof headSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(headSha)
      || typeof baseSha !== 'string'
      || !/^[0-9a-f]{40}$/u.test(baseSha)
      || typeof headBranch !== 'string'
      || headBranch.length === 0
      || typeof baseBranch !== 'string'
      || baseBranch.length === 0
      || typeof body !== 'string'
    ) {
      throw new Error(`Open PR entry ${index} identity is invalid.`);
    }
    return { number: number as number, headBranch, headSha, baseBranch, baseSha, body };
  });
}

async function readBytes(
  readGit: WorkPackageRegistryGitRead, args: readonly string[], label: string, input?: Uint8Array
): Promise<Buffer> {
  if (args.some(arg => arg.includes('\0'))) {
    throw new Error('VerificationSession command argument contains NUL.');
  }
  const result = await readGit(Object.freeze([...args]), input);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return result.stdout;
}

type ManifestBlob = Readonly<{ blobSha: string; repositoryPath: string }>;

async function collectManifestDigests(
  readGit: WorkPackageRegistryGitRead, entries: readonly ManifestBlob[],
  consumeRecords: (count: number) => void, limit: number
): Promise<ReadonlyMap<string, `sha256:${string}`>> {
  // Identical bytes may serve different paths/PRs. Deduplicate transport only,
  // never registry records, ownership, source identities or duplicate diagnostics.
  const unique = [...new Map(entries.map(entry => [entry.blobSha, entry])).values()];
  const digests = new Map<string, `sha256:${string}`>();
  if (unique.length === 0) return digests;
  if (unique.length === 1) {
    // The common one-manifest case needs no size-preflight subprocess.
    const entry = unique[0]!;
    const bytes = await readBytes(readGit, ['cat-file', 'blob', entry.blobSha], 'manifest blob');
    consumeRecords(1);
    if (bytes.byteLength > limit) throw new Error(`Manifest blob ${entry.repositoryPath} exceeds the command byte limit.`);
    digests.set(entry.blobSha, WorkPackageManifestDigest(bytes) as `sha256:${string}`);
    return digests;
  }
  const input = Buffer.from(`${unique.map(entry => entry.blobSha).join('\n')}\n`, 'ascii');
  const sizes = parseExactGitBlobInfoBatch(unique,
    await readBytes(readGit, ['cat-file', '--batch-check'], 'manifest blob metadata', input));
  consumeRecords(sizes.length);
  let batch: typeof sizes[number][] = [], batchBytes = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const output = await readBytes(readGit, ['cat-file', '--batch'], 'manifest blob batch',
      Buffer.from(`${batch.map(entry => entry.blobSha).join('\n')}\n`, 'ascii'));
    const blobs = parseExactGitBlobsBatch(batch, output, limit);
    consumeRecords(blobs.length);
    for (let index = 0; index < blobs.length; index++) {
      const blob = blobs[index]!;
      if (blob.byteLength !== batch[index]!.byteLength) {
        throw new Error(`Manifest blob size readback differs for ${blob.repositoryPath}.`);
      }
      digests.set(blob.blobSha, WorkPackageManifestDigest(blob.bytes) as `sha256:${string}`);
    }
    batch = []; batchBytes = 0;
  };
  for (const entry of sizes) {
    if (entry.byteLength > limit) throw new Error(`Manifest blob ${entry.repositoryPath} exceeds the command byte limit.`);
    const responseBytes = Buffer.byteLength(`${entry.blobSha} blob ${entry.byteLength}\n`, 'ascii') + entry.byteLength + 1;
    if (batchBytes + responseBytes > limit) await flush();
    if (responseBytes > limit) {
      // Preserve the existing raw-blob ceiling for a single blob whose batch
      // framing alone would overflow it. Never raise/reset the caller's budget.
      const bytes = await readBytes(readGit, ['cat-file', 'blob', entry.blobSha], 'manifest blob');
      consumeRecords(1);
      if (bytes.byteLength !== entry.byteLength) throw new Error(`Manifest blob size readback differs for ${entry.repositoryPath}.`);
      digests.set(entry.blobSha, WorkPackageManifestDigest(bytes) as `sha256:${string}`);
    } else {
      batch.push(entry); batchBytes += responseBytes;
    }
  }
  await flush();
  return digests;
}

/** Capture before suspension, then observe immutable objects. The caller owns
 * the transport and record accounting; this function issues no authority. */
export async function projectWorkPackageRegistry(input: Readonly<{
  observedAt: string;
  repository: string;
  defaultBranch: string;
  defaultRef: string;
  pullRequestEntries?: readonly VerificationRegistryEntry[];
  openPullRequests?: readonly OpenPullRequestFact[];
}>, readGit: WorkPackageRegistryGitRead, budget: WorkPackageRegistryReadBudget): Promise<string> {
  if (typeof readGit !== 'function') throw new TypeError('Work Package registry Git reader must be callable.');
  const { consumeRecords, maxCommandStdoutBytes } = budget;
  if (!Number.isSafeInteger(maxCommandStdoutBytes) || maxCommandStdoutBytes <= 0
      || maxCommandStdoutBytes > GIT_READ_DEFAULT_OPERATION_BUDGET.maxCommandStdoutBytes) {
    throw new TypeError('Work Package registry command byte limit must narrow the canonical Git read ceiling.');
  }
  if (typeof consumeRecords !== 'function') throw new TypeError('Work Package registry record consumer must be callable.');
  const { observedAt, repository, defaultBranch, defaultRef } = input;
  const suppliedPrEntries = (input.pullRequestEntries ?? [])
    .filter(entry => entry.source === 'open-pr')
    .map(entry => ({ ...entry }));
  const openPullRequests = (input.openPullRequests ?? []).map(pullRequest => {
    const captured = { ...pullRequest };
    return { ...captured, manifestPath: ParseWorkPackageLocator(captured.body) };
  });
  const revisions = [`${defaultRef}^{tree}`, ...openPullRequests.flatMap(pr => [
    `${pr.headSha}^{tree}`, `${pr.headSha}:${pr.manifestPath}`
  ])];
  const resolved = (await readBytes(readGit,
    ['rev-parse', '--revs-only', '--end-of-options', ...revisions], 'tree readback')).toString('utf8').trim().split(/\r?\n/u);
  if (resolved.length !== revisions.length || resolved.some(value => !/^[0-9a-f]{40}$/u.test(value))) {
    throw new Error(`Tree/blob readback for ${defaultRef} is invalid.`);
  }
  consumeRecords(resolved.length);
  const defaultTreeSha = resolved[0]!;
  const tree = parseExactGitTreeEntries(await readBytes(readGit, [
    'ls-tree', '-r', '-z', '--full-tree', defaultTreeSha, '--', 'config/repository/work-packages'
  ], 'work package directory listing'));
  consumeRecords(tree.length);
  const manifests = tree.filter(entry => /^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(entry.repositoryPath))
    .sort((left, right) => left.repositoryPath < right.repositoryPath ? -1 : left.repositoryPath > right.repositoryPath ? 1 : 0);
  const prBlobs = openPullRequests.map((pr, index) => ({
    ...pr, headTreeSha: resolved[index * 2 + 1]!, blobSha: resolved[index * 2 + 2]!
  }));
  const digests = await collectManifestDigests(readGit, [
    ...manifests, ...prBlobs.map(pr => ({ blobSha: pr.blobSha, repositoryPath: pr.manifestPath }))
  ], consumeRecords, maxCommandStdoutBytes);
  const defaultEntries: VerificationRegistryEntry[] = manifests.map(entry => ({
    manifestPath: entry.repositoryPath, manifestDigest: digests.get(entry.blobSha)!,
    source: 'default', prNumber: null, baseSha: null, headSha: null, headTreeSha: null
  }));
  const discoveredPrEntries: Array<VerificationRegistryEntry & { prNumber: number }> = prBlobs.map(pr => ({
    manifestPath: pr.manifestPath, manifestDigest: digests.get(pr.blobSha)!, source: 'open-pr',
    prNumber: pr.number, baseSha: pr.baseSha, headSha: pr.headSha, headTreeSha: pr.headTreeSha
  }));
  discoveredPrEntries.sort((left, right) => left.prNumber - right.prNumber);
  const entries = [...defaultEntries, ...suppliedPrEntries, ...discoveredPrEntries];
  if (new Set(entries.map(entry => entry.manifestPath)).size !== entries.length) {
    throw new Error('Registry projection contains duplicate manifest paths across sources.');
  }
  return JSON.stringify({
    schema: VERIFICATION_REGISTRY_PROJECTION_SCHEMA,
    observedAt, repository, defaultBranch, defaultTreeSha, entries
  }, null, 2);
}
