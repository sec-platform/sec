import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegistryLocation, WorkspacePaths } from './types.ts';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const compilerRoot = path.resolve(moduleDir, '../..');
export const officialRegistryRelativePath = path.join('platform', 'registry', 'official');
export const privateRegistryRelativePath = path.join('platform', 'registry', 'private');
export const officialRegistryRoot = path.join(compilerRoot, officialRegistryRelativePath);

export function getWorkspacePaths(workspaceRoot = process.cwd()): WorkspacePaths {
  const root = path.resolve(workspaceRoot);
  const projectRoot = path.join(root, 'project');
  const officialPoliciesRoot = path.join(compilerRoot, 'platform', 'policies', 'official');
  const projectPoliciesRoot = path.join(projectRoot, 'policies');

  return {
    workspaceRoot: root,
    projectRoot,
    privateRegistryRoot: path.join(root, privateRegistryRelativePath),
    generatedViewsDir: path.join(projectRoot, 'generated', 'views'),
    planPath: path.join(projectRoot, 'app.plan.yaml'),
    lockPath: path.join(projectRoot, 'graph.lock.json'),
    generatedDir: path.join(projectRoot, 'generated'),
    overrideManifestPath: path.join(projectRoot, 'overrides', 'override-manifest.yaml'),
    policySpecPath: path.join(projectPoliciesRoot, 'policy.spec.yaml'),
    officialPoliciesRoot,
    projectPoliciesRoot,
    installManifestPath: path.join(projectRoot, 'generated', 'install-manifest.json'),
    verificationReportPath: path.join(projectRoot, 'generated', 'verification-report.json'),
    acceptanceCoveragePath: path.join(projectRoot, 'generated', 'acceptance-coverage.json'),
    policyReportPath: path.join(projectRoot, 'generated', 'policy-report.json'),
    runtimeReportPath: path.join(projectRoot, 'generated', 'runtime-report.json'),
    explainGraphPath: path.join(projectRoot, 'generated', 'explain-graph.json'),
    reviewSummaryPath: path.join(projectRoot, 'generated', 'review-summary.json'),
    sourceViewPath: path.join(projectRoot, 'generated', 'views', 'source-view.html'),
    slotRuleViewPath: path.join(projectRoot, 'generated', 'views', 'slot-rule-view.html'),
    repairPlanPath: path.join(projectRoot, 'generated', 'repair-plan.json'),
    upgradePlanPath: path.join(projectRoot, 'generated', 'upgrade-plan.json'),
    projectPackagePath: path.join(projectRoot, 'package.json'),
    provenancePath: path.join(projectRoot, 'provenance.json')
  };
}

export function blockDirName(blockId: string): string {
  return blockId.replaceAll('/', '.');
}

export function blockRoot(blockId: string): string {
  return path.join(officialRegistryRoot, blockDirName(blockId));
}

export function resolveRegistryRoot(
  workspaceRoot: string,
  location: RegistryLocation,
  registryPath: string
): string {
  const baseRoot = location === 'compiler' ? compilerRoot : path.resolve(workspaceRoot);
  return path.resolve(baseRoot, registryPath);
}
