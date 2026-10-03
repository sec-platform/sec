import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  CodexDevelopmentClassifyWorkPackageCensus,
  CodexDevelopmentParseActivePointer
} from '../../src/adapters/self-hosting/control/documentation/document-control-plane-contract.ts';

const ROOT = path.resolve(import.meta.dir, '../..');
const PACKAGE_DIR = path.join(ROOT, 'config/repository/work-packages');

function defaultBytes(repositoryPath: string): Uint8Array | null {
  const result = spawnSync('git', ['show', `refs/remotes/origin/main:${repositoryPath}`], {
    cwd: ROOT,
    windowsHide: true,
    encoding: null,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  return new Uint8Array(result.stdout);
}

test('current Work Package tree contains no stale or unauthorized transport manifests', () => {
  const pointerSource = readFileSync(
    path.join(ROOT, 'config/repository/active-work-package.md'),
    'utf8'
  );
  const selectedManifestPath = CodexDevelopmentParseActivePointer(pointerSource).manifest;
  const paths = readdirSync(PACKAGE_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `config/repository/work-packages/${entry.name}`)
    .sort();

  expect(paths).toContain(selectedManifestPath);
  const entries = paths.map((repositoryPath) => {
    const candidateBytes = new Uint8Array(readFileSync(path.join(ROOT, repositoryPath)));
    return {
      path: repositoryPath,
      candidateBytes,
      defaultBytes: repositoryPath === selectedManifestPath
        ? null
        : defaultBytes(repositoryPath)
    };
  });
  const census = CodexDevelopmentClassifyWorkPackageCensus({
    selectedManifestPath,
    entries,
    ...(paths.length > 1 ? {
      roadmapSource: readFileSync(path.join(ROOT, 'config/repository/work-selection.md'), 'utf8')
    } : {})
  });

  expect(census.ambiguousPredecessorPaths).toEqual([]);
  expect(census.stalePackagePaths).toEqual([]);
  // Exact main should converge to one selected transport. A branch-local
  // recovery handoff may temporarily retain only the single predecessor
  // explicitly admitted by the canonical census above.
  expect(paths.length).toBeLessThanOrEqual(census.delayedPredecessorPath === null ? 1 : 2);
});
