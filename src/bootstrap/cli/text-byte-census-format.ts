import {
  TEXT_BYTE_ANOMALIES,
  type TextByteCensusReport,
  type TextByteClassification
} from '../../adapters/runtime-state/text-byte-census.ts';

export function formatTextByteCensusReport(report: TextByteCensusReport): string {
  const lines = [
    'Text Byte Census',
    `  totalFiles: ${report.totalFiles}`,
    `  failClosed: ${report.failClosed}`,
    '  classifications:'
  ];
  const classifications: readonly TextByteClassification[] = [
    'canonical-lf',
    'explicit-crlf',
    'binary',
    'preserve-external',
    'unknown'
  ];
  for (const classification of classifications) {
    if (report.classificationCounts[classification] > 0) {
      lines.push(`    ${classification}: ${report.classificationCounts[classification]}`);
    }
  }
  lines.push('  anomalies:');
  const presentAnomalies = TEXT_BYTE_ANOMALIES.filter(
    (anomaly) => report.anomalyCounts[anomaly] > 0
  );
  if (presentAnomalies.length === 0) {
    lines.push('    (none)');
  } else {
    for (const anomaly of presentAnomalies) {
      lines.push(`    ${anomaly}: ${report.anomalyCounts[anomaly]}`);
    }
  }
  if (report.flaggedEntries.length > 0) {
    lines.push(`  flagged: ${report.flaggedEntries.length} file(s)`);
    const displayedEntries = report.flaggedEntries.slice(0, 20);
    for (const entry of displayedEntries) {
      lines.push(
        `    ${entry.path} [${entry.classification}] ${entry.anomalies.length === 0 ? '(none)' : entry.anomalies.join(', ')}`
      );
    }
    if (displayedEntries.length < report.flaggedEntries.length) {
      lines.push(`    ... and ${report.flaggedEntries.length - displayedEntries.length} more`);
    }
  }
  return lines.join('\n');
}
