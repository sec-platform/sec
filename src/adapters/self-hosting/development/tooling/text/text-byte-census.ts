import path from 'node:path';

import { sha256 } from '../../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../../../../execution/operation/semantic.ts';
import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import {
  type GitReadSession,
  type GitReadSessionBudget
} from '../../../../providers/git-read/runtime/session.ts';
import {
  TEXT_BYTE_ANOMALIES,
  TEXT_BYTE_CENSUS_SCHEMA,
  classifyBlobBytes,
  createEmptyCensusReport,
  type TextByteCensusEntry,
  type TextByteCensusReport
} from '../../../../runtime-state/text-byte-census.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  chunkBlobEntries,
  readBlobEntryBatch,
  readCommitBlobInventory,
  resolveExactHeadCommit,
  withIsolatedTextAttributeReader
} from '../git/git-read.ts';

const DEFAULT_REPOSITORY_ROOT = process.cwd();
const CENSUS_BLOB_BATCH_MAX_BYTES = 24 * 1024 * 1024;
const CENSUS_BLOB_BATCH_MAX_ITEMS = 1024;

interface CensusOptions {
  readonly deadlineAtUnixMs?: number;
  readonly signal?: AbortSignal;
}

type TextByteCensusOperationEnvelope = Readonly<{
  operation: BoundSemanticOperation;
  budget: GitReadSessionBudget;
  deadlineAtUnixMs: number;
}>;

const TEXT_BYTE_CENSUS_OPERATION = 'development.text-byte-census';
const TEXT_BYTE_CENSUS_REQUIREMENT = 'repository.text-byte-census';

function compileTextByteCensusOperation(
  repositoryRoot: string,
  requestedDeadlineAtUnixMs: number | undefined
): TextByteCensusOperationEnvelope {
  const startedAtUnixMs = Date.now();
  const localDeadlineAtUnixMs = startedAtUnixMs + GIT_READ_OPERATION_BUDGET.deadlineMs;
  const deadlineAtUnixMs = Math.min(
    requestedDeadlineAtUnixMs ?? localDeadlineAtUnixMs,
    localDeadlineAtUnixMs
  );
  const durationMs = deadlineAtUnixMs - startedAtUnixMs;
  if (!Number.isSafeInteger(deadlineAtUnixMs)
      || !Number.isSafeInteger(durationMs)
      || durationMs < 1) {
    throw new Error('Text byte census requires one future absolute deadline.');
  }
  const budget = Object.freeze({
    ...GIT_READ_OPERATION_BUDGET,
    deadlineMs: durationMs
  });
  const admittedProcessOutputBytes = budget.maxProcesses
    * (budget.maxCommandStdoutBytes + budget.maxCommandStderrBytes);
  if (!Number.isSafeInteger(admittedProcessOutputBytes)) {
    throw new Error('Text byte census process output envelope is not representable.');
  }
  const contractDigest = sha256({
    operation: TEXT_BYTE_CENSUS_OPERATION,
    resultSchema: TEXT_BYTE_CENSUS_SCHEMA,
    observation: 'exact-commit-blob-bytes-and-text-attributes'
  }) as OperationDigest;
  const providerIdentityDigest = sha256({
    provider: 'external-capabilities.git-read',
    capability: 'exact-repository-observation'
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: TEXT_BYTE_CENSUS_OPERATION,
    intentDigest: sha256({ repositoryRoot }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: budget.maxStdinBytes },
      // The process owner reserves each child's complete output ceiling before
      // spawn. GitRead independently accounts actual cumulative stdout/stderr,
      // so this aggregate is the exact worst-case admission for one session,
      // not a second runtime ledger.
      { resource: 'output-bytes', maximum: admittedProcessOutputBytes },
      { resource: 'processes', maximum: budget.maxProcesses },
      { resource: 'records', maximum: budget.maxRecords }
    ],
    requirements: [{
      id: TEXT_BYTE_CENSUS_REQUIREMENT,
      contractDigest,
      effectKinds: ['process', 'provider'],
      failureKinds: [
        'provider.cancelled',
        'provider.deadline-exhausted',
        'provider.drift',
        'provider.unavailable',
        'provider.unverified'
      ]
    }]
  });
  return Object.freeze({
    operation: bindSemanticOperation(plan, [compileCapabilityBinding({
      requirementId: TEXT_BYTE_CENSUS_REQUIREMENT,
      contractDigest,
      providerIdentityDigest
    })]),
    budget,
    deadlineAtUnixMs
  });
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function runCensusWithSession(
  session: GitReadSession,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT
): Promise<TextByteCensusReport> {
  const root = path.resolve(repositoryRoot);
  const sourceCommit = await resolveExactHeadCommit(session);
  const files = await readCommitBlobInventory(session, sourceCommit);
  const gitattributesBlobSha = files.find((entry) => entry.path === '.gitattributes')?.objectId ?? null;
  const base = createEmptyCensusReport();
  const flaggedEntries: TextByteCensusEntry[] = [];

  await withIsolatedTextAttributeReader(session, sourceCommit, async (readAttributes) => {
    for (const batch of chunkBlobEntries(files, {
      maxBytes: CENSUS_BLOB_BATCH_MAX_BYTES,
      maxItems: CENSUS_BLOB_BATCH_MAX_ITEMS
    })) {
      const blobs = await readBlobEntryBatch(session, batch);
      const attributes = await readAttributes(batch.map((entry) => entry.path));
      for (const file of batch) {
        const bytes = blobs.get(file.objectId);
        const attrs = attributes.get(file.path);
        if (bytes === undefined) {
          throw new Error(`Text byte census did not receive blob bytes for ${file.path}`);
        }
        if (attrs === undefined) {
          throw new Error(`Text byte census did not receive attributes for ${file.path}`);
        }
        const { classification, lineEnding, anomalies } = classifyBlobBytes({
          path: file.path,
          bytes: new Uint8Array(bytes),
          textAttr: attrs.textAttr,
          eolAttr: attrs.eolAttr
        });
        const entry: TextByteCensusEntry = {
          path: file.path,
          classification,
          byteSize: bytes.byteLength,
          blobSha: file.objectId,
          lineEnding,
          anomalies
        };
        base.classificationCounts[classification] += 1;
        for (const anomaly of anomalies) base.anomalyCounts[anomaly] += 1;
        if (anomalies.length > 0 || classification === 'unknown') flaggedEntries.push(entry);
      }
    }
  });

  const failClosed = base.classificationCounts.unknown > 0
    || TEXT_BYTE_ANOMALIES.some((anomaly) => base.anomalyCounts[anomaly] > 0);
  flaggedEntries.sort((left, right) => compareCodeUnits(left.path, right.path));

  return {
    schema: TEXT_BYTE_CENSUS_SCHEMA,
    generatedAt: new Date().toISOString(),
    repositoryRoot: root,
    gitattributesBlobSha,
    totalFiles: files.length,
    classificationCounts: base.classificationCounts,
    anomalyCounts: base.anomalyCounts,
    flaggedEntries,
    failClosed
  };
}

export async function runCensus(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  options: CensusOptions = {}
): Promise<TextByteCensusReport> {
  const root = path.resolve(repositoryRoot);
  const envelope = compileTextByteCensusOperation(root, options.deadlineAtUnixMs);
  return withAuthorityGitReadSession(
    {
      cwd: root,
      operation: envelope.operation,
      budget: envelope.budget,
      deadlineAtUnixMs: envelope.deadlineAtUnixMs,
      ...(options.signal === undefined ? {} : { signal: options.signal })
    },
    (session) => runCensusWithSession(session, root)
  );
}
