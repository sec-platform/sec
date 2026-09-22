import { requireCanonicalCiArtifactPath } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { describe, expect, test } from 'bun:test';
import path from 'node:path';

import {
  CI_ARTIFACT_FILES,
  CI_ARTIFACT_ROOT_RELATIVE_PATH,
  isCiArtifactPath
} from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { getWorkspacePaths, isCanonicalWorkspaceArtifactPath, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath, resolveWorkspacePlanPath, resolveWorkspaceProvenancePath } from "../../src/adapters/workspace-context.ts";

// Use a native absolute root; a Windows drive spelling is relative on POSIX.
const WORKSPACE_ROOT = path.resolve(path.parse(process.cwd()).root, 'fixtures', 'native-target');

describe('native target workspace paths', () => {
  test('binds every target root directly below the workspace root', async () => {
    const paths = getWorkspacePaths(WORKSPACE_ROOT);

    expect(paths).toMatchObject({
      workspaceRoot: path.resolve(WORKSPACE_ROOT),
      workspaceConfigPath: path.join(WORKSPACE_ROOT, 'sec.yaml'),
      modelRoot: path.join(WORKSPACE_ROOT, 'model'),
      srcRoot: path.join(WORKSPACE_ROOT, 'src'),
      testsRoot: path.join(WORKSPACE_ROOT, 'tests'),
      packageJsonPath: path.join(WORKSPACE_ROOT, 'package.json'),
      tsconfigPath: path.join(WORKSPACE_ROOT, 'tsconfig.json'),
      prismaRoot: path.join(WORKSPACE_ROOT, 'prisma'),
      secRoot: path.join(WORKSPACE_ROOT, '.sec'),
      artifactsRoot: path.join(WORKSPACE_ROOT, '.sec', 'artifacts')
    });
    expect(paths).not.toHaveProperty('projectRoot');
    expect(paths).not.toHaveProperty('developerSourceRoot');
    expect(paths).not.toHaveProperty('controlRoot');
  });

  test('resolves only artifact-owner paths below the single artifact root', async () => {
    const paths = getWorkspacePaths(WORKSPACE_ROOT);

    for (const artifactPath of Object.values(CI_ARTIFACT_FILES)) {
      expect(isCiArtifactPath(artifactPath)).toBe(true);
      expect(isCanonicalWorkspaceArtifactPath(artifactPath)).toBe(true);
      expect(requireCanonicalCiArtifactPath(artifactPath)).toBe(artifactPath);
      expect(resolveWorkspaceArtifactPath(WORKSPACE_ROOT, artifactPath)).toBe(
        path.join(paths.artifactsRoot, ...artifactPath.slice(`${CI_ARTIFACT_ROOT_RELATIVE_PATH}/`.length).split('/'))
      );
    }
    expect(resolveWorkspaceArtifactPath(WORKSPACE_ROOT, CI_ARTIFACT_ROOT_RELATIVE_PATH)).toBe(paths.artifactsRoot);
  });

  test('rejects legacy roots, implicit artifact prefixes, and traversal', () => {
    for (const artifactPath of [
      'source/model/policies/policy.spec.yaml',
      'project/generated/report.json',
      'control/evidence/verification-report.json',
      'generated/report-contract.json',
      '.sec/artifacts/../outside.json',
      '.sec/artifacts\\evidence\\report.json'
    ]) {
      expect(isCanonicalWorkspaceArtifactPath(artifactPath)).toBe(false);
      expect(() => requireCanonicalCiArtifactPath(artifactPath)).toThrow('canonical .sec/artifacts path');
      expect(() => resolveWorkspaceArtifactPath(WORKSPACE_ROOT, artifactPath)).toThrow(
        'canonical .sec/artifacts path'
      );
    }
  });

  test('binds plan, lock, and provenance helpers to their native owners', async () => {
    expect(await resolveWorkspacePlanPath(WORKSPACE_ROOT)).toBe(
      path.join(WORKSPACE_ROOT, 'sec.yaml')
    );
    expect(await resolveWorkspaceLockPath(WORKSPACE_ROOT)).toBe(
      resolveWorkspaceArtifactPath(WORKSPACE_ROOT, CI_ARTIFACT_FILES.graphLock)
    );
    expect(await resolveWorkspaceProvenancePath(WORKSPACE_ROOT)).toBe(
      resolveWorkspaceArtifactPath(WORKSPACE_ROOT, CI_ARTIFACT_FILES.provenance)
    );
  });
});
