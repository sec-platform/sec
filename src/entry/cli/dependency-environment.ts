type DependencyEntryPresentationSource = Readonly<{
  kind: string;
  sizeBytes: number;
  entryCount?: number;
  target?: string;
}>;

export type DependencyEnvironmentPresentationSource = Readonly<{
  mode: string;
  manifestHash: string;
  compilerNodeModules: DependencyEntryPresentationSource;
  projectNodeModules: DependencyEntryPresentationSource;
  bunPackageCache: DependencyEntryPresentationSource;
  recommendedAction: string;
}>;

export type DoctorReportPresentationSource = Readonly<{
  status: string;
  checkCount: number;
  checks: readonly Readonly<{
    id: string;
    status: string;
    message: string;
  }>[];
  dependencies: DependencyEnvironmentPresentationSource;
}>;

export type DependencyFreshnessPresentationSource = Readonly<{
  status: string;
  packages: readonly Readonly<{
    declaredName: string;
    status: string;
    reason: string;
  }>[];
}>;

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = value / 1024;
  for (const unit of units) {
    if (size < 1024) return `${size.toFixed(1)} ${unit}`;
    size /= 1024;
  }
  return `${size.toFixed(1)} PB`;
}

function formatEntryStatus(status: DependencyEntryPresentationSource): string {
  const base = `${status.kind}, metadata ${formatBytes(status.sizeBytes)}`;
  return status.entryCount === undefined
    ? base
    : `${base}, ${status.entryCount} top-level entries`;
}

export function formatDependencyEnvironmentStatus(
  status: DependencyEnvironmentPresentationSource
): string {
  const lines = [
    'Runtime dependency status',
    `Mode: ${status.mode}`,
    `Manifest hash: ${status.manifestHash}`,
    `Compiler node_modules: ${formatEntryStatus(status.compilerNodeModules)}`,
    `Project node_modules: ${formatEntryStatus(status.projectNodeModules)}`,
    `Bun package cache: ${formatEntryStatus(status.bunPackageCache)}`,
    `Recommended action: ${status.recommendedAction}`
  ];
  if (status.projectNodeModules.target &&
      status.projectNodeModules.kind === 'link') {
    lines.splice(
      5,
      0,
      `Project node_modules target: ${status.projectNodeModules.target}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function formatDoctorReport(
  report: DoctorReportPresentationSource
): string {
  const lines = [
    'Developer environment doctor',
    `Status: ${report.status}`,
    `Checks: ${report.checkCount}`,
    ...report.checks.map(check =>
      `[${check.status}] ${check.id}: ${check.message}`
    ),
    '',
    formatDependencyEnvironmentStatus(report.dependencies).trimEnd()
  ];
  return `${lines.join('\n')}\n`;
}

export function formatDependencyFreshnessDecision(
  decision: DependencyFreshnessPresentationSource
): string {
  const lines = [
    'Dependency freshness',
    `Status: ${decision.status}`,
    ...decision.packages.map(entry =>
      `${entry.declaredName}: ${entry.status} (${entry.reason})`
    )
  ];
  return `${lines.join('\n')}\n`;
}
