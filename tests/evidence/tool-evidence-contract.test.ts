import { expect, test } from 'vitest';

import { fixedCiArtifactPaths } from '../../platform/shared/ci-artifact-contract.ts';
import {
  buildToolEvidenceReport,
  formatToolEvidenceReport,
  TOOL_EVIDENCE_REPORT_KINDS,
  type ToolEvidenceReportInput
} from '../../platform/shared/tool-evidence-contract.ts';

const sampleDiagnostics: ToolEvidenceReportInput['diagnostics'] = [
  {
    id: 'duplicate-customer-form-flow',
    severity: 'warning',
    title: 'Duplicate customer form flow',
    message: 'Two UI paths share the same submit/validate/render shape.',
    filePaths: [
      'project/components/customer-form.tsx',
      'project/app/customers/page.tsx',
      'project/components/customer-form.tsx'
    ],
    evidence: ['jscpd:customer-form', 'structure:submit-validate-render']
  },
  {
    id: 'compiler-imports-generated-project',
    severity: 'error',
    title: 'Compiler boundary imports generated project',
    message: 'A compiler module must not depend on generated project files.',
    filePaths: ['platform/compiler/emit/write-local-views.ts'],
    evidence: ['dependency-cruiser:compiler-to-project']
  },
  {
    id: 'read-validate-build-write-candidate',
    severity: 'info',
    title: 'Read validate build write candidate',
    message: 'Repeated engineering pattern candidate for future helper extraction.',
    filePaths: ['platform/compiler/emit/ci-artifacts.ts'],
    evidence: ['discover-all:read-validate-build-write']
  }
];

function expectedAffectedFiles(diagnostics = sampleDiagnostics): string[] {
  return [...new Set(diagnostics.flatMap((diagnostic) => diagnostic.filePaths))].sort();
}

test('builds draft tool evidence reports with derived summaries', () => {
  const reportInputs: ToolEvidenceReportInput[] = TOOL_EVIDENCE_REPORT_KINDS.map((kind) => ({
    kind,
    toolId: `${kind}-fixture`,
    rawReportPaths: [`control/evidence/${kind}-raw.json`],
    diagnostics: sampleDiagnostics
  }));

  for (const input of reportInputs) {
    const report = buildToolEvidenceReport(input);

    expect(report).toMatchObject({
      formatVersion: '1',
      kind: input.kind,
      toolId: input.toolId,
      stableArtifact: false,
      rawReportPathCount: input.rawReportPaths.length,
      rawReportPaths: input.rawReportPaths,
      summary: {
        status: 'failed',
        diagnosticCount: input.diagnostics.length,
        errorCount: input.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
        warningCount: input.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
        infoCount: input.diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length,
        affectedFileCount: expectedAffectedFiles(input.diagnostics).length,
        affectedFiles: expectedAffectedFiles(input.diagnostics)
      }
    });
    expect(report.diagnostics[0]?.filePaths).toEqual([
      'project/app/customers/page.tsx',
      'project/components/customer-form.tsx'
    ]);
  }
});

test('formats tool evidence reports as inspectable draft output', () => {
  const report = buildToolEvidenceReport({
    kind: 'architecture-boundary',
    toolId: 'dependency-cruiser-fixture',
    rawReportPaths: ['control/evidence/dependency-cruiser-raw.json'],
    diagnostics: sampleDiagnostics
  });

  const formatted = formatToolEvidenceReport(report);

  expect(formatted).toContain('Tool evidence architecture-boundary failed');
  expect(formatted).toContain('Stable artifact: false');
  expect(formatted).toContain(`Diagnostics: ${report.summary.diagnosticCount}`);
  expect(formatted).toContain(`Affected files: ${report.summary.affectedFileCount}`);
  expect(formatted).toContain('Diagnostic compiler-imports-generated-project; severity=error');
});

test('keeps draft tool evidence outside stable artifact paths', () => {
  const stableArtifactPaths = fixedCiArtifactPaths();
  const draftEvidencePaths = TOOL_EVIDENCE_REPORT_KINDS.map((kind) => `control/evidence/${kind}-report.json`);

  expect(stableArtifactPaths).not.toEqual(expect.arrayContaining(draftEvidencePaths));
});
