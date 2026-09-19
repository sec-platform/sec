import type { AcceptanceCoverageReport } from '../assurance/acceptance/coverage.ts';
import type { CanonicalVerificationArtifactSet } from '../assurance/verification/artifact/contract/artifact.ts';
import type { VerificationReport } from '../assurance/verification/contract/types.ts';
import type { ReviewSummary } from '../assurance/verification/review/contract/types.ts';
import type { LockFile } from '../compiler/contract.ts';
import { assertPassStatus } from '../compiler/contract/lock-schema.ts';
import { CompilerError } from '../compiler/errors.ts';
import type { ExplainGraph } from '../semantics/projection/explain.ts';
import type { ProvenanceFile } from '../semantics/provenance/types.ts';

type Awaitable<T> = T | PromiseLike<T>;
export interface ReviewPublisher {
  publishReview(lock: LockFile, provenance: ProvenanceFile, report: VerificationReport,
    coverage: AcceptanceCoverageReport): Awaitable<ReviewSummary>;
}
export interface ExplanationOperations extends ReviewPublisher {
  readLock(): LockFile;
  readProvenance(label: string): Awaitable<ProvenanceFile>;
  readVerification(): CanonicalVerificationArtifactSet;
  publishGraph(lock: LockFile, provenance: ProvenanceFile): Awaitable<ExplainGraph>;
}

/** An effectful explanation, not a pure query: read current prerequisites,
 * publish the graph, refresh its provenance, publish review, then read back Lock.
 * The caller owns one lease and the original fenced physical implementations. */
export async function explainWorkspaceResult(operations: ExplanationOperations) {
  const { readLock, readProvenance, readVerification, publishGraph, publishReview } = operations;
  if ([readLock, readProvenance, readVerification, publishGraph, publishReview].some(fn => typeof fn !== 'function')) {
    throw new TypeError('Explanation operations must be callable');
  }
  const lock = readLock.call(operations);
  assertPassStatus(lock, 'lock', 'succeeded', new CompilerError('EXPLAIN-BLOCKED-001', 'lock must succeed before explain'));
  const provenance = await readProvenance.call(operations, 'Provenance report');
  const { verificationReport: report, acceptanceCoverage: coverage } = readVerification.call(operations);
  const graph = await publishGraph.call(operations, lock, provenance);
  const refreshedProvenance = await readProvenance.call(operations, 'Refreshed Provenance report');
  const reviewSummary = await publishReview.call(operations, lock, refreshedProvenance, report, coverage);
  const finalLock = readLock.call(operations);
  return { lock: finalLock, provenance: refreshedProvenance, report, graph, reviewSummary };
}

export interface ReviewRefreshSources {
  readonly graph: ExplainGraph;
  readonly provenance: ProvenanceFile;
  readonly verification: CanonicalVerificationArtifactSet;
}
export interface ReviewRefreshOperations extends ReviewPublisher {
  prepareRead(): Awaitable<() => ReviewRefreshSources | null>;
  isCurrent(lock: LockFile, graph: ExplainGraph): boolean;
}

export async function refreshWorkspaceReview(lock: LockFile, operations: ReviewRefreshOperations): Promise<ReviewSummary | null> {
  const { prepareRead, isCurrent, publishReview } = operations;
  if ([prepareRead, isCurrent, publishReview].some(fn => typeof fn !== 'function')) {
    throw new TypeError('Review refresh operations must be callable');
  }
  const read = await prepareRead.call(operations);
  if (lock.passStatus.lock !== 'succeeded' || lock.passStatus.emit !== 'succeeded') return null;
  const sources = read();
  if (sources === null || !isCurrent.call(operations, lock, sources.graph)) return null;
  return publishReview.call(operations, lock, sources.provenance,
    sources.verification.verificationReport, sources.verification.acceptanceCoverage);
}

export interface WorkspaceArtifactPublicationOperations<Manifest> {
  fence(): Awaitable<void>;
  publishManifest(): Awaitable<Manifest>;
  readLock(): LockFile;
  refreshReview(lock: LockFile): Awaitable<ReviewSummary | null>;
}

export async function publishWorkspaceArtifactSet<Manifest>(operations: WorkspaceArtifactPublicationOperations<Manifest>) {
  const { fence, publishManifest, readLock, refreshReview } = operations;
  if ([fence, publishManifest, readLock, refreshReview].some(fn => typeof fn !== 'function')) {
    throw new TypeError('Artifact publication operations must be callable');
  }
  await fence.call(operations);
  const manifest = await publishManifest.call(operations);
  const lock = readLock.call(operations);
  await fence.call(operations);
  const reviewSummary = await refreshReview.call(operations, lock);
  return { manifest, reviewSummary };
}
