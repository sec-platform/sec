import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const compilerRoot = path.resolve(moduleDir, '../..');
export const officialRegistryRoot = path.join(compilerRoot, 'platform', 'registry', 'official');

export function getWorkspacePaths(workspaceRoot = process.cwd()) {
  const root = path.resolve(workspaceRoot);
  const projectRoot = path.join(root, 'project');

  return {
    workspaceRoot: root,
    projectRoot,
    planPath: path.join(projectRoot, 'app.plan.yaml'),
    lockPath: path.join(projectRoot, 'graph.lock.json'),
    generatedDir: path.join(projectRoot, 'generated'),
    installManifestPath: path.join(projectRoot, 'generated', 'install-manifest.json'),
    verificationReportPath: path.join(projectRoot, 'generated', 'verification-report.json'),
    projectPackagePath: path.join(projectRoot, 'package.json'),
    provenancePath: path.join(projectRoot, 'provenance.json')
  };
}

export function blockDirName(blockId) {
  return blockId.replaceAll('/', '.');
}

export function blockRoot(blockId) {
  return path.join(officialRegistryRoot, blockDirName(blockId));
}
