#!/usr/bin/env bun
/**
 * Compatibility CLI adapter for the provider-neutral SEC development tool.
 * Canonical implementation: tooling/sec-dev/text/text-byte-census.ts
 */

import type { TextByteClassification } from '../../platform/shared/text-byte-census-contract.ts';
import {
  formatTextByteCensusReport,
  runCensus
} from '../../tooling/sec-dev/text/text-byte-census.ts';

export { runCensus } from '../../tooling/sec-dev/text/text-byte-census.ts';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const compact = args.includes('--compact');
  const failOnIndex = args.indexOf('--fail-on');
  const failOn = failOnIndex >= 0 ? args[failOnIndex + 1] : undefined;

  if (compact && !json) {
    throw new Error('Usage: text-byte-census [--json [--compact]] [--fail-on <class>]');
  }

  const report = await runCensus();
  if (json) {
    if (compact) {
      console.log(JSON.stringify({
        schema: report.schema,
        totalFiles: report.totalFiles,
        failClosed: report.failClosed,
        classificationCounts: report.classificationCounts,
        anomalyCounts: report.anomalyCounts,
        flaggedCount: report.flaggedEntries.length
      }));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
  } else {
    console.log(formatTextByteCensusReport(report));
  }

  if (failOn === 'any' && report.failClosed) {
    process.exit(1);
  } else if (
    failOn &&
    failOn !== 'any' &&
    report.classificationCounts[failOn as TextByteClassification] > 0
  ) {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
