import path from 'node:path';

import {
  TEXT_BYTE_CENSUS_SCHEMA,
  classifyBlobBytes,
  createEmptyCensusReport,
  type TextByteAnomaly,
  type TextByteCensusEntry,
  type TextByteCensusReport,
  type TextByteClassification
} from '../../../runtime-state/text-byte-census.ts';
import {
  GIT_READ_OPERATION_BUDGET,
  chunkBlobEntries,
  readBlobEntryBatch,
  readCommitBlobInventory,
  resolveExactHeadCommit,
  withIsolatedTextAttributeReader
} from '../git/git-read.ts';
import { withAuthorityGitReadSession } from '../../../external-capabilities/git-read/authority.ts';
import { type GitReadSession } from '../../../external-capabilities/git-read/runtime/session.ts';

const DEFAULT_REPOSITORY_ROOT = process.cwd();
const CENSUS_BLOB_BATCH_MAX_BYTES = 24 * 1024 * 1024;
const CENSUS_BLOB_BATCH_MAX_ITEMS = 1024;

interface CensusOptions {
  readonly deadlineAtUnixMs?: number;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function formatTextByteCensusReport(report: TextByteCensusReport): string {
  const lines: string[] = [];
  lines.push('Text Byte Census Report');
  lines.push('  schema: ' + report.schema);
  lines.push('  generatedAt: ' + report.generatedAt);
  lines.push('  repositoryRoot: ' + report.repositoryRoot);
  lines.push('  gitattributesBlobSha: ' + (report.gitattributesBlobSha ?? '<none>'));
  lines.push('  totalFiles: ' + report.totalFiles);
  lines.push('');
  lines.push('  Classification counts:');
  const classifications: TextByteClassification[] = ['canonical-lf', 'explicit-crlf', 'binary', 'preserve-external', 'unknown'];
  for (const classification of classifications) {
    lines.push('    ' + classification + ': ' + report.classificationCounts[classification]);
  }
  lines.push('');
  lines.push('  Anomaly counts:');
  const anomalies: TextByteAnomaly[] = [
    'crlf-in-canonical-lf-blob',
    'lf-in-explicit-crlf-blob',
    'mixed-endings',
    'utf8-bom',
    'nul-byte',
    'unknown-encoding',
    'attributes-missing',
    'attributes-conflict'
  ];
  let anyAnomaly = false;
  for (const anomaly of anomalies) {
    const count = report.anomalyCounts[anomaly];
    if (count > 0) {
      lines.push('    ' + anomaly + ': ' + count);
      anyAnomaly = true;
    }
  }
  if (!anyAnomaly) lines.push('    (none)');
  lines.push('');
  lines.push('  failClosed: ' + report.failClosed);
  if (report.flaggedEntries.length > 0) {
    lines.push('');
    lines.push('  Flagged entries (' + report.flaggedEntries.length + '):');
    const maxShow = Math.min(report.flaggedEntries.length, 50);
    for (let index = 0; index < maxShow; index += 1) {
      const entry = report.flaggedEntries[index]!;
      lines.push('    ' + entry.path + ' [' + entry.classification + '/' + entry.lineEnding + '] anomalies: ' + (entry.anomalies.length === 0 ? '(none)' : entry.anomalies.join(', ')));
    }
    if (report.flaggedEntries.length > maxShow) {
      lines.push('    ... and ' + (report.flaggedEntries.length - maxShow) + ' more');
    }
  }
  return lines.join('\n');
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
    || base.anomalyCounts['crlf-in-canonical-lf-blob'] > 0
    || base.anomalyCounts['mixed-endings'] > 0
    || base.anomalyCounts['unknown-encoding'] > 0
    || base.anomalyCounts['attributes-missing'] > 0;
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
  return withAuthorityGitReadSession(
    {
      cwd: root,
      budget: GIT_READ_OPERATION_BUDGET,
      ...(options.deadlineAtUnixMs === undefined
        ? {}
        : { deadlineAtUnixMs: options.deadlineAtUnixMs })
    },
    (session) => runCensusWithSession(session, root)
  );
}
