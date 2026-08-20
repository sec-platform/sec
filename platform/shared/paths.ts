import path from 'node:path';
import { encodeCanonicalBlockPhysicalKeyV1 } from './block-identity.ts';
import { pathEntryExists } from './fs.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  compilerRuntimeLayout,
  compilerRuntimeResources
} from './runtime-layout.ts';
import type { RegistryLocation } from './types.ts';
import {
  localStateRelativePath,
  resolveWorkspaceLocalStateRoot
} from './workspace-path-contract.ts';
import type { WorkspacePaths } from './workspace-types.ts';

export { localStateRelativePath };

export const compilerRoot = compilerRuntimeLayout.packageRoot;
export const projectRelativePath = 'project';
export const developerSourceRelativePath = 'source';
export const controlRelativePath = 'control';
export const legacyDeveloperSourceRelativePath = path.join(projectRelativePath, 'source');
export const officialPoliciesRelativePath =
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialPolicies;
export const officialRegistryRelativePath =
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS.officialRegistry;
export const privateRegistryRelativePath = path.join('platform', 'registry', 'private');
export const sourceCodeRelativePath = path.join(developerSourceRelativePath, 'code');
export const sourceModelRelativePath = path.join(developerSourceRelativePath, 'model');
export const sourceSlotsRelativePath = path.join(sourceCodeRelativePath, 'slots');
export const sourcePrivateRegistryRelativePath = path.join(developerSourceRelativePath, 'blocks', 'private');
export const legacySourcePrivateRegistryRelativePath = path.join(legacyDeveloperSourceRelativePath, 'registry', 'private');
export const controlStateRelativePath = path.join(controlRelativePath, 'state');
export const controlEvidenceRelativePath = path.join(controlRelativePath, 'evidence');
export const controlProvenanceRelativePath = path.join(controlRelativePath, 'provenance');
export const controlGraphRelativePath = path.join(controlRelativePath, 'graph');
export const controlWorkflowRelativePath = path.join(controlRelativePath, 'workflow');
export const controlWorkbenchRelativePath = path.join(controlRelativePath, 'workbench');
export const controlAuditRelativePath = path.join(controlRelativePath, 'audit');
export const controlCiRelativePath = path.join(controlRelativePath, 'ci');
export const controlWorkbenchViewsRelativePath = 'control/workbench/views' as const;
export const overviewViewRelativePath = `${controlWorkbenchViewsRelativePath}/overview-view.html` as const;
export const sourceViewRelativePath = `${controlWorkbenchViewsRelativePath}/source-view.html` as const;
export const slotRuleViewRelativePath = `${controlWorkbenchViewsRelativePath}/slot-rule-view.html` as const;
export const graphViewRelativePath = `${controlWorkbenchViewsRelativePath}/graph-view.html` as const;
export const reviewViewRelativePath = `${controlWorkbenchViewsRelativePath}/review-view.html` as const;
export const officialRegistryRoot = compilerRuntimeResources.officialRegistry;

export function posixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function relativePosixPath(from: string, to: string): string {
  return posixPath(path.relative(from, to));
}

export function isSafeRelativePath(value: string, options: { allowEmpty?: boolean } = {}): boolean {
  if (value.length === 0) {
    return options.allowEmpty === true;
  }
  const normalized = posixPath(value);
  if (value.includes('\0') || path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || normalized.startsWith('//')) {
    return false;
  }
  return !normalized.split('/').includes('..');
}

export function isPathInside(root: string, targetPath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolvePathInside(root: string, relativePath: string, options: { allowEmpty?: boolean } = {}): string | null {
  if (!isSafeRelativePath(relativePath, options)) {
    return null;
  }
  const resolvedPath = path.resolve(root, relativePath);
  return isPathInside(root, resolvedPath) ? resolvedPath : null;
}

export function getWorkspacePaths(workspaceRoot = process.cwd()): WorkspacePaths {
  const root = path.resolve(workspaceRoot);
  const projectRoot = path.join(root, projectRelativePath);
  const developerSourceRoot = path.join(root, developerSourceRelativePath);
  const sourceCodeRoot = path.join(root, sourceCodeRelativePath);
  const sourceModelRoot = path.join(root, sourceModelRelativePath);
  const sourceBlocksRoot = path.join(developerSourceRoot, 'blocks');
  const sourcePatchesRoot = path.join(developerSourceRoot, 'patches');
  const controlRoot = path.join(root, controlRelativePath);
  const controlStateRoot = path.join(root, controlStateRelativePath);
  const controlEvidenceRoot = path.join(root, controlEvidenceRelativePath);
  const controlProvenanceRoot = path.join(root, controlProvenanceRelativePath);
  const controlGraphRoot = path.join(root, controlGraphRelativePath);
  const controlWorkflowRoot = path.join(root, controlWorkflowRelativePath);
  const controlWorkbenchRoot = path.join(root, controlWorkbenchRelativePath);
  const controlAuditRoot = path.join(root, controlAuditRelativePath);
  const controlCiRoot = path.join(root, controlCiRelativePath);
  const officialPoliciesRoot = compilerRuntimeResources.officialPolicies;
  const projectPoliciesRoot = path.join(projectRoot, 'policies');
  const sourcePoliciesRoot = path.join(sourceModelRoot, 'policies');

  return {
    workspaceRoot: root,
    projectRoot,
    developerSourceRoot,
    sourceCodeRoot,
    sourceModelRoot,
    sourceBlocksRoot,
    sourcePatchesRoot,
    sourceSlotsRoot: path.join(root, sourceSlotsRelativePath),
    sourceOverridesRoot: sourcePatchesRoot,
    sourcePoliciesRoot,
    sourceAcceptanceRoot: path.join(sourceModelRoot, 'acceptance'),
    sourceAssetsRoot: path.join(developerSourceRoot, 'assets'),
    sourcePrivateRegistryRoot: path.join(root, sourcePrivateRegistryRelativePath),
    sourceViewsRoot: path.join(developerSourceRoot, 'views'),
    sourceViewMutationsRoot: path.join(developerSourceRoot, 'views', 'mutations'),
    sourceEnvRoot: path.join(developerSourceRoot, 'env'),
    legacyDeveloperSourceRoot: path.join(root, legacyDeveloperSourceRelativePath),
    legacySourceSlotsRoot: path.join(root, legacyDeveloperSourceRelativePath, 'slots'),
    legacySourceOverridesRoot: path.join(root, legacyDeveloperSourceRelativePath, 'overrides'),
    legacySourcePoliciesRoot: path.join(root, legacyDeveloperSourceRelativePath, 'policies'),
    legacySourcePrivateRegistryRoot: path.join(root, legacySourcePrivateRegistryRelativePath),
    privateRegistryRoot: path.join(root, privateRegistryRelativePath),
    controlRoot,
    controlStateRoot,
    controlEvidenceRoot,
    controlProvenanceRoot,
    controlGraphRoot,
    controlWorkflowRoot,
    controlWorkbenchRoot,
    controlAuditRoot,
    controlCiRoot,
    localStateRoot: resolveWorkspaceLocalStateRoot(root),
    generatedViewsDir: path.join(root, controlWorkbenchViewsRelativePath),
    planPath: path.join(developerSourceRoot, 'app.yaml'),
    legacyPlanPath: path.join(projectRoot, 'app.plan.yaml'),
    lockPath: path.join(controlStateRoot, 'graph.lock.json'),
    legacyLockPath: path.join(projectRoot, 'graph.lock.json'),
    generatedDir: path.join(projectRoot, 'generated'),
    blockUsageMapPath: path.join(controlEvidenceRoot, 'block-usage-map.json'),
    postgresContractPath: path.join(projectRoot, 'generated', 'postgres-contract.json'),
    overrideManifestPath: path.join(sourcePatchesRoot, 'override-manifest.yaml'),
    legacyOverrideManifestPath: path.join(projectRoot, 'overrides', 'override-manifest.yaml'),
    policySpecPath: path.join(sourcePoliciesRoot, 'policy.spec.yaml'),
    officialPoliciesRoot,
    projectPoliciesRoot,
    installManifestPath: path.join(controlEvidenceRoot, 'install-manifest.json'),
    verificationReportPath: path.join(controlEvidenceRoot, 'verification-report.json'),
    acceptanceCoveragePath: path.join(controlEvidenceRoot, 'acceptance-coverage.json'),
    policyReportPath: path.join(controlEvidenceRoot, 'policy-report.json'),
    runtimeReportPath: path.join(controlEvidenceRoot, 'runtime-report.json'),
    explainGraphPath: path.join(controlGraphRoot, 'explain-graph.json'),
    explainGraphMermaidPath: path.join(controlGraphRoot, 'explain-graph.mmd'),
    explainGraphDotPath: path.join(controlGraphRoot, 'explain-graph.dot'),
    reviewSummaryPath: path.join(controlEvidenceRoot, 'review-summary.json'),
    ciArtifactsPath: path.join(controlCiRoot, 'artifacts.json'),
    overviewViewPath: path.join(root, overviewViewRelativePath),
    sourceViewPath: path.join(root, sourceViewRelativePath),
    slotRuleViewPath: path.join(root, slotRuleViewRelativePath),
    graphViewPath: path.join(root, graphViewRelativePath),
    reviewViewPath: path.join(root, reviewViewRelativePath),
    repairPlanPath: path.join(controlWorkflowRoot, 'repair-plan.json'),
    upgradePlanPath: path.join(controlWorkflowRoot, 'upgrade-plan.json'),
    upgradeDiagnosticsPath: path.join(controlWorkflowRoot, 'upgrade-diagnostics.json'),
    viewMutationReportPath: path.join(controlWorkflowRoot, 'view-mutation-report.json'),
    projectPackagePath: path.join(projectRoot, 'package.json'),
    provenancePath: path.join(controlProvenanceRoot, 'provenance.json'),
    legacyProvenancePath: path.join(projectRoot, 'provenance.json')
  };
}

export function workspaceRelativePath(workspaceRoot: string, targetPath: string): string {
  return relativePosixPath(path.resolve(workspaceRoot), targetPath);
}

async function resolveCanonicalOrLegacyPath(canonicalPath: string, legacyPath: string): Promise<string> {
  if (await pathEntryExists(canonicalPath)) {
    return canonicalPath;
  }
  return (await pathEntryExists(legacyPath)) ? legacyPath : canonicalPath;
}

export async function resolveWorkspacePlanPath(workspaceRoot = process.cwd()): Promise<string> {
  const { planPath, legacyPlanPath } = getWorkspacePaths(workspaceRoot);
  return resolveCanonicalOrLegacyPath(planPath, legacyPlanPath);
}

export async function resolveWorkspaceLockPath(workspaceRoot = process.cwd()): Promise<string> {
  const { lockPath, legacyLockPath } = getWorkspacePaths(workspaceRoot);
  return resolveCanonicalOrLegacyPath(lockPath, legacyLockPath);
}

export async function resolveWorkspaceProvenancePath(workspaceRoot = process.cwd()): Promise<string> {
  const { provenancePath, legacyProvenancePath } = getWorkspacePaths(workspaceRoot);
  return resolveCanonicalOrLegacyPath(provenancePath, legacyProvenancePath);
}

export function resolveWorkspaceArtifactPath(workspaceRoot: string, artifactPath: string): string {
  const { projectRoot, workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
  const baseRoot =
    artifactPath.startsWith(`${projectRelativePath}/`) ||
    artifactPath.startsWith(`${developerSourceRelativePath}/`) ||
    artifactPath.startsWith(`${controlRelativePath}/`) ||
    artifactPath.startsWith(`${localStateRelativePath}/`)
      ? root
      : projectRoot;
  const resolvedPath = resolvePathInside(baseRoot, artifactPath);
  if (!resolvedPath) {
    throw new Error(`Workspace artifact path "${artifactPath}" escapes its allowed root`);
  }
  return resolvedPath;
}

export function toWorkspaceArtifactPath(projectRelativeArtifactPath: string): string {
  if (
    projectRelativeArtifactPath.startsWith(`${projectRelativePath}/`) ||
    projectRelativeArtifactPath.startsWith(`${developerSourceRelativePath}/`) ||
    projectRelativeArtifactPath.startsWith(`${controlRelativePath}/`) ||
    projectRelativeArtifactPath.startsWith(`${localStateRelativePath}/`)
  ) {
    return posixPath(projectRelativeArtifactPath);
  }
  return posixPath(path.join(projectRelativePath, projectRelativeArtifactPath));
}

export function toProjectRuntimePath(runtimeTarget: string): string {
  return runtimeTarget.startsWith(`${projectRelativePath}/`)
    ? posixPath(runtimeTarget)
    : posixPath(path.join(projectRelativePath, runtimeTarget));
}

export function blockDirName(blockId: string): string {
  return encodeCanonicalBlockPhysicalKeyV1(blockId);
}

export function blockRoot(blockId: string): string {
  return path.join(officialRegistryRoot, blockDirName(blockId));
}

export function resolveRegistryRoot(
  workspaceRoot: string,
  location: RegistryLocation,
  registryPath: string
): string {
  const baseRoot = location === 'compiler'
    ? compilerRuntimeLayout.runtimeAssetRoot
    : path.resolve(workspaceRoot);
  const resolvedPath = resolvePathInside(baseRoot, registryPath);
  if (!resolvedPath) {
    throw new Error(`Registry path "${registryPath}" escapes its allowed root`);
  }
  return resolvedPath;
}
