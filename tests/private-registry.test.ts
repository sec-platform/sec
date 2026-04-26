import { afterAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addBlock,
  adaptWorkspace,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../platform/orchestrator.ts';
import { getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

const activeWorkspaces = new Set<string>();

afterAll(async () => {
  for (const workspace of activeWorkspaces) {
    try {
      await fs.rm(workspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

async function createWorkspace(prefix: string): Promise<string> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  activeWorkspaces.add(workspaceRoot);
  return workspaceRoot;
}

async function installPrivateBannerBlock(workspaceRoot: string): Promise<void> {
  const { privateRegistryRoot } = getWorkspacePaths(workspaceRoot);
  const blockRoot = path.join(privateRegistryRoot, 'private.banner-basic');

  await fs.mkdir(path.join(blockRoot, 'files', 'src', 'installed', 'private'), { recursive: true });
  await fs.mkdir(path.join(blockRoot, 'files', 'tests', 'unit'), { recursive: true });

  await writeYaml(path.join(blockRoot, 'block.manifest.yaml'), {
    id: 'private/banner-basic',
    version: '0.1.0',
    kind: 'governance',
    stackProfiles: ['nextjs-ts-prisma-sqlite'],
    compatibility: {
      blockApi: '1',
      compilerApi: '1',
      stackProfiles: ['nextjs-ts-prisma-sqlite']
    },
    requires: [],
    provides: ['governance/banner'],
    conflicts: [],
    installs: [
      {
        kind: 'copy',
        from: 'files/src/installed/private/banner.ts',
        to: 'src/installed/private/banner.ts'
      },
      {
        kind: 'copy',
        from: 'files/tests/unit/private-banner.test.ts',
        to: 'tests/unit/private-banner.test.ts'
      }
    ],
    pins: {
      inputs: [],
      outputs: [
        {
          id: 'banner_message',
          type: 'string',
          required: true
        }
      ]
    },
    slots: [],
    acceptance: [],
    routes: []
  });

  await fs.writeFile(
    path.join(blockRoot, 'files', 'src', 'installed', 'private', 'banner.ts'),
    `export function projectBanner(projectName: string): string {\n  return \`private-banner:\${projectName}\`;\n}\n`,
    'utf8'
  );

  await fs.writeFile(
    path.join(blockRoot, 'files', 'tests', 'unit', 'private-banner.test.ts'),
    `import assert from 'node:assert/strict';\nimport { projectBanner } from '../../src/installed/private/banner.ts';\n\nexport async function runSuite() {\n  assert.equal(projectBanner('customer-admin'), 'private-banner:customer-admin');\n}\n`,
    'utf8'
  );
}

test('workspace private registry blocks resolve, compose, and verify through the normal pipeline', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-private-registry-');

  await initWorkspace(workspaceRoot, { reset: true });
  await installPrivateBannerBlock(workspaceRoot);
  await addBlock(workspaceRoot, 'private/banner-basic');

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.some((block) => block.id === 'private/banner-basic')).toBe(true);
  expect(
    resolvedLock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')?.registryKind
  ).toBe('private');

  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  await explainWorkspace(workspaceRoot);

  const { provenancePath, reviewSummaryPath, sourceViewPath } = getWorkspacePaths(workspaceRoot);
  const provenance = JSON.parse(await fs.readFile(provenancePath, 'utf8')) as {
    artifacts: Array<{ path: string; registrySourceId?: string; registryKind?: string; registryLocation?: string }>;
  };
  expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/private/banner.ts')).toMatchObject({
    registrySourceId: 'private',
    registryKind: 'private',
    registryLocation: 'workspace'
  });

  const reviewSummary = JSON.parse(await fs.readFile(reviewSummaryPath, 'utf8')) as {
    changeSources: Array<{
      path: string;
      registrySourceId?: string;
      registryKind?: string;
      registryLocation?: string;
      runtimeKind?: 'page' | 'api';
      vertical?: string;
      relatedBlocks?: string[];
    }>;
  };
  expect(reviewSummary.changeSources.find((source) => source.path === 'src/installed/private/banner.ts')).toMatchObject({
    registrySourceId: 'private',
    registryKind: 'private',
    registryLocation: 'workspace'
  });

  const sourceView = await fs.readFile(sourceViewPath, 'utf8');
  expect(sourceView).toContain('Registry');
  expect(sourceView).toContain('private (private, workspace)');
});
