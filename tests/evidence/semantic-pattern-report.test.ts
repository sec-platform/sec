import { expect, test } from 'bun:test';

import { fixedCiArtifactPaths } from '../../platform/shared/ci-artifact-contract.ts';
import {
  ENGINEERING_PATTERN_KINDS,
  SEMANTIC_PATTERN_OVERLAY_PATH,
  SEMANTIC_PATTERN_REPORT_PATH,
  buildSemanticPatternOverlay,
  buildSemanticPatternReport
} from '../../platform/shared/semantic-pattern-report.ts';
import { buildToolEvidenceReport, type ToolEvidenceDiagnosticInput } from '../../platform/shared/tool-evidence-contract.ts';

const expectedPatterns = [
  'read-validate-build-write',
  'query-guard-map-return',
  'build-write-artifact'
] as const;

const semanticDiagnostics: ToolEvidenceDiagnosticInput[] = [
  {
    id: 'read-validate-build-write-candidate',
    severity: 'info',
    title: 'Read validate build write candidate',
    message: 'load manifest, validate inputs, build report, write artifact',
    filePaths: ['platform/compiler/emit/ci-artifacts.ts'],
    evidence: ['readJson', 'validateResolvedTemplates', 'buildCiArtifactManifest', 'writeFile']
  },
  {
    id: 'query-guard-map-return-candidate',
    severity: 'info',
    title: 'Query guard map return candidate',
    message: 'query registry, guard missing entries, map rows, return result',
    filePaths: ['platform/compiler/parse/load-manifest.ts'],
    evidence: ['queryRegistry', 'guardMissingBlock', 'mapResolvedBlock', 'returnLock']
  },
  {
    id: 'build-write-artifact-candidate',
    severity: 'info',
    title: 'Build write artifact candidate',
    message: 'build view model and write artifact file',
    filePaths: ['platform/compiler/emit/write-local-views.ts'],
    evidence: ['buildViewModel', 'writeArtifact', 'artifact=review-view']
  },
  {
    id: 'format-only-candidate',
    severity: 'info',
    title: 'Format only helper',
    message: 'format labels and join lines',
    filePaths: ['platform/shared/strings.ts'],
    evidence: ['formatLabel', 'joinLines']
  }
];

const semanticEvidence = buildToolEvidenceReport({
  kind: 'semantic-pattern',
  toolId: 'discover-all',
  rawReportPaths: ['report/discover.json'],
  diagnostics: semanticDiagnostics
});

function expectedPatternCounts() {
  return ENGINEERING_PATTERN_KINDS.map((id) => ({
    id,
    count: expectedPatterns.filter((pattern) => pattern === id).length
  }));
}

test('builds low-confidence engineering pattern suggestions without auto refactor', () => {
  const report = buildSemanticPatternReport(semanticEvidence);

  expect(report).toMatchObject({
    formatVersion: '1',
    path: SEMANTIC_PATTERN_REPORT_PATH,
    stableArtifact: false,
    sourceToolId: semanticEvidence.toolId,
    sourceDiagnosticCount: semanticEvidence.diagnostics.length,
    summary: {
      status: 'attention',
      suggestionCount: expectedPatterns.length,
      lowConfidenceCount: expectedPatterns.length,
      autoRefactorCount: 0,
      patternCounts: expectedPatternCounts()
    }
  });
  expect(report.suggestions.map((suggestion) => suggestion.pattern)).toHaveLength(0);
  expect(report.suggestions.every((suggestion) => suggestion.confidence === 'low')).toBe(true);
  expect(report.suggestions.every((suggestion) => suggestion.autoRefactor === false)).toBe(true);
  expect(report.suggestions.map((suggestion) => suggestion.sourceDiagnosticId)).not.toContain('format-only-candidate');
});

test('builds semantic pattern overlay edges to file nodes', () => {
  const report = buildSemanticPatternReport(semanticEvidence);
  const overlay = buildSemanticPatternOverlay(report);
  const expectedEdgeCount = report.suggestions.reduce((count, suggestion) => count + suggestion.filePaths.length, 0);

  expect(overlay).toMatchObject({
    formatVersion: '1',
    path: SEMANTIC_PATTERN_OVERLAY_PATH,
    stableArtifact: false,
    sourceReportPath: SEMANTIC_PATTERN_REPORT_PATH,
    nodeCount: report.suggestions.length,
    edgeCount: expectedEdgeCount
  });
  expect(overlay.nodes.map((node) => node.pattern)).toHaveLength(0);
  expect(overlay.edges).toContainEqual({
    from: 'semantic-pattern:read-validate-build-write-candidate',
    to: 'file:platform/compiler/emit/ci-artifacts.ts',
    type: 'suggests_review_of'
  });
});

test('keeps semantic pattern report and overlay outside stable artifact paths', () => {
  expect(fixedCiArtifactPaths()).not.toEqual(expect.arrayContaining([
    SEMANTIC_PATTERN_REPORT_PATH,
    SEMANTIC_PATTERN_OVERLAY_PATH
  ]));
});
