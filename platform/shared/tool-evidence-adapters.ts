import {
  buildToolEvidenceReport,
  type ArchitectureBoundaryEvidenceReport,
  type CodeQualityEvidenceReport,
  type SemanticPatternEvidenceReport,
  type ToolEvidenceDiagnosticInput,
  type ToolEvidenceSeverity
} from './tool-evidence-contract.ts';

export interface ToolEvidenceAdapterOptions {
  rawReportPath: string;
  toolId?: string;
}

export interface JscpdFileLocation {
  name?: string;
  path?: string;
  file?: string;
  start?: number;
  end?: number;
  startLine?: number;
  endLine?: number;
}

export interface JscpdDuplicate {
  format?: string;
  lines?: number;
  tokens?: number;
  firstFile?: JscpdFileLocation;
  secondFile?: JscpdFileLocation;
}

export interface JscpdReport {
  duplicates?: readonly JscpdDuplicate[];
  clones?: readonly JscpdDuplicate[];
}

export interface DependencyCruiserRule {
  name?: string;
  severity?: string;
}

export interface DependencyCruiserViolation {
  rule?: DependencyCruiserRule;
  severity?: string;
  from?: string;
  to?: string;
  comment?: string;
  cycle?: readonly string[];
}

export interface DependencyCruiserReport {
  summary?: {
    violations?: readonly DependencyCruiserViolation[];
  };
  violations?: readonly DependencyCruiserViolation[];
}

export interface DiscoverFunctionSignature {
  hash?: string;
  file: string;
  name: string;
  line: number;
  kind: 'function' | 'method' | 'arrow';
}

export interface DiscoverDuplicateGroup {
  hash: string;
  count: number;
  functions: readonly DiscoverFunctionSignature[];
}

export interface DiscoverStructureReport {
  duplicates: readonly DiscoverDuplicateGroup[];
  calls: readonly unknown[];
  filesScanned: number;
  timestamp: string;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';
}

function fileLocationPath(location?: JscpdFileLocation): string {
  return location?.name ?? location?.path ?? location?.file ?? '';
}

function locationRange(location?: JscpdFileLocation): string | undefined {
  const start = location?.start ?? location?.startLine;
  const end = location?.end ?? location?.endLine;
  return start && end ? `${start}-${end}` : undefined;
}

function compactEvidence(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function dependencyCruiserSeverity(value?: string): ToolEvidenceSeverity {
  if (value === 'error') return 'error';
  if (value === 'warn' || value === 'warning') return 'warning';
  return 'info';
}

export function buildJscpdEvidenceReport(
  report: JscpdReport,
  options: ToolEvidenceAdapterOptions
): CodeQualityEvidenceReport {
  const duplicates = report.duplicates ?? report.clones ?? [];
  const diagnostics = duplicates.map<ToolEvidenceDiagnosticInput>((duplicate, index) => {
    const firstFile = fileLocationPath(duplicate.firstFile);
    const secondFile = fileLocationPath(duplicate.secondFile);

    return {
      id: `jscpd-duplicate-${index + 1}`,
      severity: 'warning',
      title: 'Duplicate code fragment',
      message: `${duplicate.lines ?? 'unknown'} duplicated lines between ${firstFile || 'unknown'} and ${secondFile || 'unknown'}.`,
      filePaths: [firstFile, secondFile],
      evidence: compactEvidence([
        duplicate.format ? `format=${duplicate.format}` : undefined,
        duplicate.lines === undefined ? undefined : `lines=${duplicate.lines}`,
        duplicate.tokens === undefined ? undefined : `tokens=${duplicate.tokens}`,
        locationRange(duplicate.firstFile) ? `first=${locationRange(duplicate.firstFile)}` : undefined,
        locationRange(duplicate.secondFile) ? `second=${locationRange(duplicate.secondFile)}` : undefined
      ])
    };
  });

  return buildToolEvidenceReport({
    kind: 'code-quality',
    toolId: options.toolId ?? 'jscpd',
    rawReportPaths: [options.rawReportPath],
    diagnostics
  });
}

export function buildDependencyCruiserEvidenceReport(
  report: DependencyCruiserReport,
  options: ToolEvidenceAdapterOptions
): ArchitectureBoundaryEvidenceReport {
  const violations = report.summary?.violations ?? report.violations ?? [];
  const diagnostics = violations.map<ToolEvidenceDiagnosticInput>((violation, index) => {
    const ruleName = violation.rule?.name ?? 'dependency-boundary';
    const severity = dependencyCruiserSeverity(violation.rule?.severity ?? violation.severity);
    const cycle = violation.cycle ?? [];

    return {
      id: `depcruise-${slug(ruleName)}-${index + 1}`,
      severity,
      title: ruleName,
      message: violation.comment ?? `${violation.from ?? 'unknown'} -> ${violation.to ?? 'unknown'}`,
      filePaths: [violation.from ?? '', violation.to ?? '', ...cycle],
      evidence: compactEvidence([
        `rule=${ruleName}`,
        violation.from ? `from=${violation.from}` : undefined,
        violation.to ? `to=${violation.to}` : undefined,
        cycle.length > 0 ? `cycle=${cycle.join(' -> ')}` : undefined
      ])
    };
  });

  return buildToolEvidenceReport({
    kind: 'architecture-boundary',
    toolId: options.toolId ?? 'dependency-cruiser',
    rawReportPaths: [options.rawReportPath],
    diagnostics
  });
}

export function buildDiscoverEvidenceReport(
  report: DiscoverStructureReport,
  options: ToolEvidenceAdapterOptions
): SemanticPatternEvidenceReport {
  const diagnostics = report.duplicates.map<ToolEvidenceDiagnosticInput>((duplicate) => ({
    id: `discover-duplicate-${slug(duplicate.hash)}`,
    severity: 'warning',
    title: 'Structural duplicate function group',
    message: `${duplicate.count} functions share structural hash ${duplicate.hash}.`,
    filePaths: duplicate.functions.map((fn) => fn.file),
    evidence: [
      `hash=${duplicate.hash}`,
      `filesScanned=${report.filesScanned}`,
      ...duplicate.functions.map((fn) => `${fn.kind}=${fn.name}@${fn.file}:${fn.line}`)
    ]
  }));

  return buildToolEvidenceReport({
    kind: 'semantic-pattern',
    toolId: options.toolId ?? 'discover-all',
    rawReportPaths: [options.rawReportPath],
    diagnostics
  });
}
