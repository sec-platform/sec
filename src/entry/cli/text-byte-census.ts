import type { TextByteCensusView } from '../../application/text-byte-census.ts';

export function formatTextByteCensus(view: TextByteCensusView): string {
  const lines = [
    'Text Byte Census',
    `  totalFiles: ${view.totalFiles}`,
    `  failClosed: ${view.failClosed}`,
    '  classifications:'
  ];
  for (const classification of view.classifications) {
    lines.push(`    ${classification.id}: ${classification.count}`);
  }
  lines.push('  anomalies:');
  if (view.anomalies.length === 0) {
    lines.push('    (none)');
  } else {
    for (const anomaly of view.anomalies) {
      lines.push(`    ${anomaly.id}: ${anomaly.count}`);
    }
  }
  if (view.flaggedEntries.length > 0) {
    lines.push(`  flagged: ${view.flaggedEntries.length} file(s)`);
    const displayedEntries = view.flaggedEntries.slice(0, 20);
    for (const entry of displayedEntries) {
      lines.push(
        `    ${entry.path} [${entry.classification}] ${entry.anomalies.length === 0 ? '(none)' : entry.anomalies.join(', ')}`
      );
    }
    if (displayedEntries.length < view.flaggedEntries.length) {
      lines.push(`    ... and ${view.flaggedEntries.length - displayedEntries.length} more`);
    }
  }
  return lines.join('\n');
}
