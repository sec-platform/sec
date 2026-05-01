import { expect, test } from 'vitest';

import {
  buildDependencyCruiserEvidenceReport,
  buildDiscoverEvidenceReport,
  buildJscpdEvidenceReport,
  type DependencyCruiserReport,
  type DiscoverStructureReport,
  type JscpdReport
} from '../../platform/shared/tool-evidence-adapters.ts';

const jscpdDuplicates = [
  {
    format: 'typescript',
    lines: 14,
    tokens: 96,
    firstFile: { name: 'platform/compiler/emit/ci-artifacts.ts', start: 10, end: 24 },
    secondFile: { name: 'platform/compiler/emit/lock-project.ts', start: 30, end: 44 }
  },
  {
    format: 'typescript',
    lines: 8,
    tokens: 61,
    firstFile: { name: 'platform/orchestrator/emit-orchestrator.ts', start: 50, end: 58 },
    secondFile: { name: 'platform/orchestrator/verify-orchestrator.ts', start: 70, end: 78 }
  }
] satisfies NonNullable<JscpdReport['duplicates']>;

const depCruiseViolations = [
  {
    rule: { name: 'shared-no-reverse-deps', severity: 'error' },
    from: 'platform/shared/paths.ts',
    to: 'platform/compiler/emit/write-local-views.ts',
    comment: 'shared must not import compiler'
  },
  {
    rule: { name: 'no-circular', severity: 'warn' },
    from: 'platform/compiler/emit/ci-artifacts.ts',
    to: 'platform/shared/lock-utils.ts',
    cycle: ['platform/compiler/emit/ci-artifacts.ts', 'platform/shared/lock-utils.ts']
  }
] satisfies NonNullable<NonNullable<DependencyCruiserReport['summary']>['violations']>;

const discoverDuplicates = [
  {
    hash: 'read-validate-build-write',
    count: 2,
    functions: [
      { file: 'compiler/emit/ci-artifacts.ts', name: 'emitCiArtifacts', line: 12, kind: 'function' },
      { file: 'compiler/emit/lock-project.ts', name: 'emitLockProject', line: 44, kind: 'function' }
    ]
  }
] satisfies DiscoverStructureReport['duplicates'];

function uniqueFiles(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

test('converts jscpd duplicates into code-quality evidence', () => {
  const raw: JscpdReport = { duplicates: jscpdDuplicates };
  const report = buildJscpdEvidenceReport(raw, {
    rawReportPath: 'report/jscpd/jscpd-report.json'
  });

  const expectedFiles = uniqueFiles(jscpdDuplicates.flatMap((duplicate) => [
    duplicate.firstFile.name,
    duplicate.secondFile.name
  ]));

  expect(report.kind).toBe('code-quality');
  expect(report.toolId).toBe('jscpd');
  expect(report.stableArtifact).toBe(false);
  expect(report.rawReportPaths).toEqual(['report/jscpd/jscpd-report.json']);
  expect(report.summary).toMatchObject({
    status: 'attention',
    diagnosticCount: jscpdDuplicates.length,
    warningCount: jscpdDuplicates.length,
    affectedFileCount: expectedFiles.length,
    affectedFiles: expectedFiles
  });
  expect(report.diagnostics[0]).toMatchObject({
    id: 'jscpd-duplicate-1',
    severity: 'warning',
    filePaths: [
      jscpdDuplicates[0].firstFile.name,
      jscpdDuplicates[0].secondFile.name
    ]
  });
});

test('converts dependency-cruiser violations into architecture-boundary evidence', () => {
  const raw: DependencyCruiserReport = { summary: { violations: depCruiseViolations } };
  const report = buildDependencyCruiserEvidenceReport(raw, {
    rawReportPath: 'report/depcruise.json'
  });

  const expectedFiles = uniqueFiles(depCruiseViolations.flatMap((violation) => [
    violation.from,
    violation.to,
    ...(violation.cycle ?? [])
  ]));

  expect(report.kind).toBe('architecture-boundary');
  expect(report.toolId).toBe('dependency-cruiser');
  expect(report.summary).toMatchObject({
    status: 'failed',
    diagnosticCount: depCruiseViolations.length,
    errorCount: depCruiseViolations.filter((violation) => violation.rule.severity === 'error').length,
    warningCount: depCruiseViolations.filter((violation) => violation.rule.severity === 'warn').length,
    affectedFiles: expectedFiles
  });
  expect(report.diagnostics.map((diagnostic) => diagnostic.id)).toEqual([
    'depcruise-shared-no-reverse-deps-1',
    'depcruise-no-circular-2'
  ]);
});

test('converts discover structural duplicates into semantic-pattern evidence', () => {
  const raw: DiscoverStructureReport = {
    duplicates: discoverDuplicates,
    calls: [],
    filesScanned: 42,
    timestamp: '2026-05-01T00:00:00.000Z'
  };
  const report = buildDiscoverEvidenceReport(raw, {
    rawReportPath: 'report/discover.json'
  });

  const expectedFiles = uniqueFiles(discoverDuplicates.flatMap((duplicate) => (
    duplicate.functions.map((fn) => fn.file)
  )));

  expect(report.kind).toBe('semantic-pattern');
  expect(report.toolId).toBe('discover-all');
  expect(report.summary).toMatchObject({
    status: 'attention',
    diagnosticCount: discoverDuplicates.length,
    warningCount: discoverDuplicates.length,
    affectedFiles: expectedFiles
  });
  expect(report.diagnostics[0]).toMatchObject({
    id: 'discover-duplicate-read-validate-build-write',
    severity: 'warning',
    evidence: [
      'filesScanned=42',
      'function=emitCiArtifacts@compiler/emit/ci-artifacts.ts:12',
      'function=emitLockProject@compiler/emit/lock-project.ts:44',
      'hash=read-validate-build-write'
    ]
  });
});
