import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { writeProvenance } from './write-provenance.ts';
import type { LockFile } from '../../shared/lock-types.ts';

type CiArtifactKind = 'governance' | 'view' | 'test' | 'contract';

export interface CiArtifactEntry {
  path: string;
  kind: CiArtifactKind;
  uploadName: string;
  exists: boolean;
}

export interface CiArtifactUploadGroup {
  kind: CiArtifactEntry['kind'];
  count: number;
  paths: string[];
}

interface GeneratedPathResult {
  paths: string[];
  lockExists: boolean;
}

export interface CiArtifactSummary {
  artifactStatus: 'passed' | 'attention';
  artifactCount: number;
  governanceCount: number;
  viewCount: number;
  testCount: number;
  contractCount: number;
  contractPaths: string[];
  uploadGroupCount: number;
  missingCount: number;
  missingReasonTypeCount: number;
  missingReasonCounts: Record<CiArtifactMissingEntry['reason'], number>;
}

export interface CiArtifactMissingEntry {
  path: string;
  reason: 'declared-generated-missing' | 'fixed-governance-missing' | 'fixed-view-missing';
  declaredBy: 'graph.lock.json' | 'artifact-manifest';
}

export interface CiArtifactManifest {
  formatVersion: '1';
  root: 'project';
  summary: CiArtifactSummary;
  artifacts: CiArtifactEntry[];
  uploadGroups: CiArtifactUploadGroup[];
  missing: CiArtifactMissingEntry[];
}

const CI_ARTIFACT_PATH = 'generated/ci-artifacts.json';

const REQUIRED_GOVERNANCE_ARTIFACTS = [
  'graph.lock.json',
  'provenance.json',
  'generated/install-manifest.json',
  'generated/verification-report.json',
  'generated/runtime-report.json',
  'generated/policy-report.json',
  'generated/acceptance-coverage.json',
  'generated/explain-graph.json',
  'generated/review-summary.json'
];

const OPTIONAL_GOVERNANCE_ARTIFACTS = [
  'generated/repair-plan.json',
  'generated/upgrade-plan.json',
  'generated/upgrade-diagnostics.json'
];

const GOVERNANCE_ARTIFACTS = [
  ...REQUIRED_GOVERNANCE_ARTIFACTS,
  ...OPTIONAL_GOVERNANCE_ARTIFACTS
];

const VIEW_ARTIFACTS = [
  'generated/views/source-view.html',
  'generated/views/slot-rule-view.html'
];

const TEST_ARTIFACTS = [
  'test-results/**'
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

function uniqueSortedMissing(entries: CiArtifactMissingEntry[]): CiArtifactMissingEntry[] {
  const entriesByPath = new Map(entries.map((entry) => [normalizeArtifactPath(entry.path), entry]));
  return [...entriesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function isContractArtifactPath(artifactPath: string): boolean {
  return artifactPath.startsWith('generated/') && artifactPath.endsWith('-contract.json');
}

function artifactKindFor(artifactPath: string): CiArtifactKind {
  if (isContractArtifactPath(artifactPath)) {
    return 'contract';
  }
  if (artifactPath.startsWith('generated/views/')) {
    return 'view';
  }
  if (artifactPath.startsWith('test-results/')) {
    return 'test';
  }
  return 'governance';
}

function buildUploadGroups(entries: CiArtifactEntry[]): CiArtifactUploadGroup[] {
  return (['governance', 'view', 'test', 'contract'] as const)
    .map((kind) => {
      const paths = entries
        .filter((entry) => entry.kind === kind)
        .map((entry) => entry.path);
      return {
        kind,
        count: paths.length,
        paths
      };
    })
    .filter((group) => group.count > 0);
}

function buildMissingReasonCounts(
  missing: CiArtifactMissingEntry[]
): CiArtifactSummary['missingReasonCounts'] {
  return {
    'declared-generated-missing': missing.filter(
      (entry) => entry.reason === 'declared-generated-missing'
    ).length,
    'fixed-governance-missing': missing.filter(
      (entry) => entry.reason === 'fixed-governance-missing'
    ).length,
    'fixed-view-missing': missing.filter(
      (entry) => entry.reason === 'fixed-view-missing'
    ).length
  };
}

function countMissingReasonTypes(
  missingReasonCounts: CiArtifactSummary['missingReasonCounts']
): number {
  return Object.values(missingReasonCounts).filter((count) => count > 0).length;
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
    ...TEST_ARTIFACTS,
    ...generatedPathResult.paths
  ]);
  const entries: CiArtifactEntry[] = [];
  const missing: CiArtifactMissingEntry[] = [];
  const generatedPaths = new Set(generatedPathResult.paths.map(normalizeArtifactPath));
  const requiredGovernanceArtifacts = new Set(REQUIRED_GOVERNANCE_ARTIFACTS.map(normalizeArtifactPath));
  const viewArtifacts = new Set(VIEW_ARTIFACTS.map(normalizeArtifactPath));

  for (const artifactPath of artifacts) {
    const exists = artifactPath.endsWith('/**')
      ? await pathExists(path.join(projectRoot, artifactPath.slice(0, -3)))
      : await pathExists(path.join(projectRoot, artifactPath));
    if (generatedPathResult.lockExists && requiredGovernanceArtifacts.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPathResult.lockExists && viewArtifacts.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: 'fixed-view-missing',
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPaths.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: 'declared-generated-missing',
        declaredBy: 'graph.lock.json'
      });
    }
    if (!exists) {
      continue;
    }
    entries.push({
      path: artifactPath,
      kind: artifactKindFor(artifactPath),
      uploadName: uploadNameFor(artifactPath),
      exists
    });
  }

  const sortedMissing = generatedPathResult.lockExists ? uniqueSortedMissing(missing) : [];
  const contractPaths = uniqueSorted(entries
    .map((entry) => entry.path)
    .filter(isContractArtifactPath));
  const uploadGroups = buildUploadGroups(entries);
  const missingReasonCounts = buildMissingReasonCounts(sortedMissing);
  return {
    formatVersion: '1',
    root: 'project',
    summary: {
      artifactStatus: sortedMissing.length > 0 ? 'attention' : 'passed',
      artifactCount: entries.length,
      governanceCount: entries.filter((entry) => entry.kind === 'governance').length,
      viewCount: entries.filter((entry) => entry.kind === 'view').length,
      testCount: entries.filter((entry) => entry.kind === 'test').length,
      contractCount: contractPaths.length,
      contractPaths,
      uploadGroupCount: uploadGroups.length,
      missingCount: sortedMissing.length,
      missingReasonTypeCount: countMissingReasonTypes(missingReasonCounts),
      missingReasonCounts
    },
    artifacts: entries,
    uploadGroups,
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
          artifactStatus: 'passed',
          artifactCount: 0,
          governanceCount: 0,
          viewCount: 0,
          testCount: 0,
          contractCount: 0,
          contractPaths: [],
          uploadGroupCount: 0,
          missingCount: 0,
          missingReasonTypeCount: 0,
          missingReasonCounts: {
            'declared-generated-missing': 0,
            'fixed-governance-missing': 0,
            'fixed-view-missing': 0
          }
        },
        artifacts: [],
        uploadGroups: [],
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
