import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import type { SemanticPatternEvidenceReport, ToolEvidenceDiagnostic } from './tool-evidence-contract.ts';

export const SEMANTIC_PATTERN_REPORT_PATH = 'control/evidence/semantic-pattern-report.json' as const;
export const SEMANTIC_PATTERN_OVERLAY_PATH = 'control/graph/semantic-pattern-overlay.json' as const;

export const ENGINEERING_PATTERN_KINDS = [
  'read-validate-build-write',
  'query-guard-map-return',
  'build-write-artifact'
] as const;

export type EngineeringPatternKind = (typeof ENGINEERING_PATTERN_KINDS)[number];
export type EngineeringPatternConfidence = 'low';
export type SemanticPatternStatus = 'passed' | 'attention';

export interface SemanticPatternCount {
  id: EngineeringPatternKind;
  count: number;
}

export interface SemanticPatternSuggestion {
  id: string;
  pattern: EngineeringPatternKind;
  sourceDiagnosticId: string;
  confidence: EngineeringPatternConfidence;
  autoRefactor: false;
  title: string;
  message: string;
  filePathCount: number;
  filePaths: string[];
  evidenceCount: number;
  evidence: string[];
}

export interface SemanticPatternSummary {
  status: SemanticPatternStatus;
  suggestionCount: number;
  lowConfidenceCount: number;
  autoRefactorCount: number;
  patternCounts: SemanticPatternCount[];
}

export interface SemanticPatternReport {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  path: typeof SEMANTIC_PATTERN_REPORT_PATH;
  stableArtifact: false;
  sourceToolId: string;
  sourceRawReportPaths: string[];
  sourceDiagnosticCount: number;
  summary: SemanticPatternSummary;
  suggestions: SemanticPatternSuggestion[];
}

export interface SemanticPatternOverlayNode {
  id: string;
  type: 'semantic-pattern';
  pattern: EngineeringPatternKind;
  label: string;
  confidence: EngineeringPatternConfidence;
  autoRefactor: false;
}

export interface SemanticPatternOverlayEdge {
  from: string;
  to: string;
  type: 'suggests_review_of';
}

export interface SemanticPatternOverlay {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  path: typeof SEMANTIC_PATTERN_OVERLAY_PATH;
  stableArtifact: false;
  sourceReportPath: typeof SEMANTIC_PATTERN_REPORT_PATH;
  nodeCount: number;
  edgeCount: number;
  nodes: SemanticPatternOverlayNode[];
  edges: SemanticPatternOverlayEdge[];
}

type PatternDefinition = {
  id: EngineeringPatternKind;
  termGroups: readonly (readonly string[])[];
};

const PATTERN_DEFINITIONS: readonly PatternDefinition[] = [
  {
    id: 'read-validate-build-write',
    termGroups: [
      ['read', 'load'],
      ['validate', 'parse'],
      ['build', 'compose', 'create'],
      ['write', 'save', 'emit']
    ]
  },
  {
    id: 'query-guard-map-return',
    termGroups: [
      ['query', 'find', 'get', 'list'],
      ['guard', 'check', 'ensure'],
      ['map', 'transform'],
      ['return', 'respond']
    ]
  },
  {
    id: 'build-write-artifact',
    termGroups: [
      ['build', 'compose', 'render'],
      ['write', 'save', 'emit'],
      ['artifact', 'report', 'view']
    ]
  }
];

function diagnosticSearchText(diagnostic: ToolEvidenceDiagnostic): string {
  return [
    diagnostic.id,
    diagnostic.title,
    diagnostic.message,
    ...diagnostic.evidence
  ].join(' ').toLowerCase();
}

function matchesPattern(text: string, definition: PatternDefinition): boolean {
  return definition.termGroups.every((terms) => terms.some((term) => text.includes(term)));
}

function inferPattern(diagnostic: ToolEvidenceDiagnostic): EngineeringPatternKind | undefined {
  const text = diagnosticSearchText(diagnostic);
  return PATTERN_DEFINITIONS.find((definition) => matchesPattern(text, definition))?.id;
}

function buildPatternCounts(suggestions: readonly SemanticPatternSuggestion[]): SemanticPatternCount[] {
  return ENGINEERING_PATTERN_KINDS.map((id) => ({
    id,
    count: suggestions.filter((suggestion) => suggestion.pattern === id).length
  }));
}

function buildSuggestion(diagnostic: ToolEvidenceDiagnostic): SemanticPatternSuggestion | undefined {
  const pattern = inferPattern(diagnostic);
  if (!pattern) return undefined;

  return {
    id: `semantic-pattern:${diagnostic.id}`,
    pattern,
    sourceDiagnosticId: diagnostic.id,
    confidence: 'low',
    autoRefactor: false,
    title: diagnostic.title,
    message: diagnostic.message,
    filePathCount: diagnostic.filePathCount,
    filePaths: [...diagnostic.filePaths],
    evidenceCount: diagnostic.evidenceCount,
    evidence: [...diagnostic.evidence]
  };
}

export function buildSemanticPatternReport(evidenceReport: SemanticPatternEvidenceReport): SemanticPatternReport {
  const suggestions = evidenceReport.diagnostics
    .map(buildSuggestion)
    .filter((suggestion): suggestion is SemanticPatternSuggestion => Boolean(suggestion));

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    path: SEMANTIC_PATTERN_REPORT_PATH,
    stableArtifact: false,
    sourceToolId: evidenceReport.toolId,
    sourceRawReportPaths: [...evidenceReport.rawReportPaths],
    sourceDiagnosticCount: evidenceReport.diagnostics.length,
    summary: {
      status: suggestions.length > 0 ? 'attention' : 'passed',
      suggestionCount: suggestions.length,
      lowConfidenceCount: suggestions.length,
      autoRefactorCount: 0,
      patternCounts: buildPatternCounts(suggestions)
    },
    suggestions
  };
}

export function buildSemanticPatternOverlay(report: SemanticPatternReport): SemanticPatternOverlay {
  const nodes = report.suggestions.map<SemanticPatternOverlayNode>((suggestion) => ({
    id: suggestion.id,
    type: 'semantic-pattern',
    pattern: suggestion.pattern,
    label: suggestion.title,
    confidence: suggestion.confidence,
    autoRefactor: suggestion.autoRefactor
  }));
  const edges = report.suggestions.flatMap<SemanticPatternOverlayEdge>((suggestion) => (
    suggestion.filePaths.map((filePath) => ({
      from: suggestion.id,
      to: `file:${filePath}`,
      type: 'suggests_review_of'
    }))
  ));

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    path: SEMANTIC_PATTERN_OVERLAY_PATH,
    stableArtifact: false,
    sourceReportPath: SEMANTIC_PATTERN_REPORT_PATH,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes,
    edges
  };
}
