import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { writeProvenance } from './write-provenance.ts';
import type { LockFile } from '../../shared/types.ts';

export interface CiArtifactEntry {
  path: string;
  kind: 'governance' | 'view';
  uploadName: string;
  exists: boolean;
}

interface GeneratedPathResult {
  paths: string[];
  lockExists: boolean;
}

export interface CiArtifactSummary {
  artifactCount: number;
  governanceCount: number;
  viewCount: number;
  missingCount: number;
}

export interface CiArtifactManifest {
  formatVersion: '1';
  root: 'project';
  summary: CiArtifactSummary;
  artifacts: CiArtifactEntry[];
  missing: string[];
}

const CI_ARTIFACT_PATH = 'generated/ci-artifacts.json';

const GOVERNANCE_ARTIFACTS = [
  'graph.lock.json',
  'provenance.json',
  'generated/install-manifest.json',
  'generated/verification-report.json',
  'generated/runtime-report.json',
  'generated/policy-report.json',
  'generated/acceptance-coverage.json',
  'generated/repair-plan.json',
  'generated/upgrade-plan.json',
  'generated/upgrade-diagnostics.json',
  'generated/explain-graph.json',
  'generated/review-summary.json'
];

const VIEW_ARTIFACTS = [
  'generated/views/source-view.html',
  'generated/views/slot-rule-view.html'
];

function normalizeArtifactPath(value: string): string {
  return value.replaceAll('\\', '/');
}

function uploadNameFor(artifactPath: string): string {
  return artifactPath.replaceAll('/', '__');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map(normalizeArtifactPath))].sort((left, right) => left.localeCompare(right));
}

async function readGeneratedPaths(workspaceRoot: string): Promise<GeneratedPathResult> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(lockPath))) {
    return { paths: [], lockExists: false };
  }
  const lock = await readJson<LockFile>(lockPath);
  return { paths: lock.generatedPaths, lockExists: true };
}

export async function buildCiArtifactManifest(workspaceRoot = process.cwd()): Promise<CiArtifactManifest> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const generatedPathResult = await readGeneratedPaths(workspaceRoot);
  const artifacts = uniqueSorted([
    CI_ARTIFACT_PATH,
    ...GOVERNANCE_ARTIFACTS,
    ...VIEW_ARTIFACTS,
    ...generatedPathResult.paths
  ]);
  const entries: CiArtifactEntry[] = [];
  const missing: string[] = [];

  for (const artifactPath of artifacts) {
    const exists = await pathExists(path.join(projectRoot, artifactPath));
    if (generatedPathResult.paths.includes(artifactPath) && !exists) {
      missing.push(artifactPath);
    }
    if (!exists) {
      continue;
    }
    entries.push({
      path: artifactPath,
      kind: artifactPath.startsWith('generated/views/') ? 'view' : 'governance',
      uploadName: uploadNameFor(artifactPath),
      exists
    });
  }

  const sortedMissing = generatedPathResult.lockExists ? uniqueSorted(missing) : [];
  return {
    formatVersion: '1',
    root: 'project',
    summary: {
      artifactCount: entries.length,
      governanceCount: entries.filter((entry) => entry.kind === 'governance').length,
      viewCount: entries.filter((entry) => entry.kind === 'view').length,
      missingCount: sortedMissing.length
    },
    artifacts: entries,
    missing: sortedMissing
  };
}

export async function writeCiArtifactManifest(workspaceRoot = process.cwd()): Promise<CiArtifactManifest> {
  const { ciArtifactsPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(lockPath);
  if (!lock.generatedPaths.includes(CI_ARTIFACT_PATH)) {
    lock.generatedPaths.push(CI_ARTIFACT_PATH);
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await fs.mkdir(path.dirname(ciArtifactsPath), { recursive: true });
  await fs.writeFile(
    ciArtifactsPath,
    `${JSON.stringify(
      {
        formatVersion: '1',
        root: 'project',
        summary: {
          artifactCount: 0,
          governanceCount: 0,
          viewCount: 0,
          missingCount: 0
        },
        artifacts: [],
        missing: []
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  const manifest = await buildCiArtifactManifest(workspaceRoot);
  await fs.writeFile(ciArtifactsPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeProvenance(workspaceRoot, lock);
  return manifest;
}
