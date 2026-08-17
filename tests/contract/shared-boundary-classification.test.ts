import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  SHARED_BOUNDARY_ENTRIES,
  SHARED_CROSS_DOMAIN_CONTRACT_PATHS,
  SHARED_DOMAIN_OWNER_REVIEW_REQUIRED_PATHS,
  SHARED_MECHANICAL_FOUNDATION_PATHS,
  sharedBoundaryClassification
} from '../../platform/shared/shared-boundary-contract.ts';
import { compilerRoot, posixPath } from '../../platform/shared/paths.ts';

async function collectSharedFiles(): Promise<string[]> {
  const sharedRoot = path.join(compilerRoot, 'platform', 'shared');
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
      } else if (entry.isFile()) {
        files.push(posixPath(path.relative(sharedRoot, absolute)));
      } else {
        throw new Error(
          `platform/shared contains a non-ordinary filesystem entry: ${posixPath(path.relative(sharedRoot, absolute))}`
        );
      }
    }
  };
  await visit(sharedRoot);
  return files.sort();
}

test('every physical platform/shared ordinary file has exactly one explicit placement classification', async () => {
  const physicalPaths = await collectSharedFiles();
  const classifiedPaths = SHARED_BOUNDARY_ENTRIES.map((entry) => entry.path).sort();

  expect(classifiedPaths).toEqual(physicalPaths);
  expect(new Set(classifiedPaths).size).toBe(classifiedPaths.length);
  for (const physicalPath of physicalPaths) {
    expect(sharedBoundaryClassification(physicalPath)).not.toBeNull();
  }
  expect(sharedBoundaryClassification('new-unclassified-shared-owner.ts')).toBeNull();
});

test('the mechanical foundation is an explicit narrow allowlist, not a low-level-directory fallback', () => {
  expect(SHARED_MECHANICAL_FOUNDATION_PATHS).toHaveLength(10);
  expect(SHARED_MECHANICAL_FOUNDATION_PATHS).toEqual([
    'canonical-primitives.ts',
    'cli-output.ts',
    'collections.ts',
    'concurrency.ts',
    'diff-utils.ts',
    'errors.ts',
    'logger.ts',
    'path-imports.ts',
    'spinner.ts',
    'yaml.ts'
  ]);
});

test('stateful, destructive, workspace, CLI, and verification behavior remains owner-review debt', () => {
  const reviewRequired = new Set<string>(SHARED_DOMAIN_OWNER_REVIEW_REQUIRED_PATHS);
  for (const path of [
    'affected-test-inventory.ts',
    'dependency-environment.ts',
    'fs.ts',
    'observed-process.ts',
    'paths.ts',
    'physical-no-follow.ts',
    'pipeline-journal.ts',
    'pipeline-kernel.ts',
    'platform-command.ts',
    'process.ts',
    'product-verification-profile.ts',
    'project-runtime.ts',
    'tcb-closure-lock.ts',
    'test-impact-rules/governance.ts',
    'test-impact-rules/pipeline.ts',
    'test-impact-rules/semantic.ts',
    'test-impact-rules/verification.ts',
    'windows-appcontainer-executor.ts',
    'workspace-write-lease.ts'
  ]) {
    expect(reviewRequired.has(path)).toBe(true);
  }
});

test('Engineering IR shared subtree remains contract/type surface in this first slice', () => {
  const contractPaths = new Set<string>(SHARED_CROSS_DOMAIN_CONTRACT_PATHS);
  for (const path of [
    'engineering-ir/delta-types.ts',
    'engineering-ir/entity-types.ts',
    'engineering-ir/fact-types.ts',
    'engineering-ir/index.ts',
    'engineering-ir/predicate-signature-types.ts',
    'engineering-ir/root-types.ts',
    'engineering-ir/scenario-types.ts',
    'engineering-ir/validated-types.ts'
  ]) {
    expect(contractPaths.has(path)).toBe(true);
  }
});
