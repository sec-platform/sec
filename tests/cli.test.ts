import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { compilerRoot, getWorkspacePaths } from '../platform/shared/paths.ts';
import { writeYaml } from '../platform/shared/yaml.ts';

function runCli(workspaceRoot: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(compilerRoot, 'platform', 'cli', 'index.ts'), ...args], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const workspaceParent = path.join(process.cwd(), '.tmp', 'test-workspaces');
  await fs.mkdir(workspaceParent, { recursive: true });
  const workspaceRoot = await fs.mkdtemp(path.join(workspaceParent, 'engineering-compiler-cli-'));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
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

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, [])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|doctor|deps>\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['unknown'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|doctor|deps>\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['unknown', '--flag'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain|doctor|deps>\n',
      stderr: ''
    });
  });
});

test('CLI accepts init commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
  });
});

test('CLI defaults verification to the fast lane', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 3 blocks\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['compose'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Composed project\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['adapt'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Adapted slots\n',
      stderr: ''
    });

    const result = await runCli(workspaceRoot, ['verify']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Verification passed (fast)\n');
  });
});

test('CLI exposes developer dependency environment entrypoints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const doctor = await runCli(workspaceRoot, ['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stderr).toBe('');
    expect(doctor.stdout).toContain('Developer environment doctor');
    expect(doctor.stdout).toContain('node-version');
    expect(doctor.stdout).toContain('runtime-dependencies');

    const depsStatus = await runCli(workspaceRoot, ['deps', 'status']);
    expect(depsStatus.code).toBe(0);
    expect(depsStatus.stderr).toBe('');
    expect(depsStatus.stdout).toContain('Runtime dependency status');
    expect(depsStatus.stdout).toContain('top-level entries');
    expect(depsStatus.stdout).toContain('Recommended action:');

    const cleanProject = await runCli(workspaceRoot, ['deps', 'clean', '--project']);
    expect(cleanProject.code).toBe(0);
    expect(cleanProject.stderr).toBe('');
    expect(cleanProject.stdout).toBe('Cleaned 2 dependency paths\n');

    const invalidRelink = await runCli(workspaceRoot, ['deps', 'relink']);
    expect(invalidRelink.code).toBe(1);
    expect(invalidRelink.stderr).toContain('platform deps relink project');

    const invalidCleanAll = await runCli(workspaceRoot, ['deps', 'clean', '--all']);
    expect(invalidCleanAll.code).toBe(1);
    expect(invalidCleanAll.stderr).toContain('platform deps clean --all --force');

    const invalidForce = await runCli(workspaceRoot, ['deps', 'clean', '--force']);
    expect(invalidForce.code).toBe(1);
    expect(invalidForce.stderr).toContain('platform deps clean --all --force');
  });
});

test('CLI adds private registry blocks and preserves registry metadata on resolve', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    await installPrivateBannerBlock(workspaceRoot);

    await expect(runCli(workspaceRoot, ['add', 'private/banner-basic'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Added block private/banner-basic@0.1.0 from private (private)\n',
      stderr: ''
    });
    await expect(fs.readFile(path.join(workspaceRoot, 'project', 'app.plan.yaml'), 'utf8')).resolves.toContain('private/banner-basic');

    await expect(runCli(workspaceRoot, ['resolve'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Resolved 4 blocks\n',
      stderr: ''
    });
    const lock = JSON.parse(await fs.readFile(path.join(workspaceRoot, 'project', 'graph.lock.json'), 'utf8')) as {
      resolvedBlocks: Array<{ id: string; registrySourceId: string; registryKind: string; registryLocation: string }>;
    };
    expect(lock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')).toMatchObject({
      registrySourceId: 'private',
      registryKind: 'private',
      registryLocation: 'workspace'
    });
  });
});

test('CLI emits upgrade dry-run JSON for CI consumers', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--reset'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Initialized project workspace\n',
      stderr: ''
    });
    const result = await runCli(workspaceRoot, ['upgrade', 'auth/basic-session', '0.1.1', '--dry-run', '--json']);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');

    const upgradePlan = JSON.parse(result.stdout) as {
      blockId: string;
      fromVersion: string;
      toVersion: string;
      status: string;
      migrationKindCounts: Record<string, number>;
      impacts: string[];
    };
    expect(upgradePlan).toMatchObject({
      blockId: 'auth/basic-session',
      fromVersion: '0.1.0',
      toVersion: '0.1.1',
      status: 'planned',
      migrationKindCounts: {
        'file-replace': 1,
        'json-array-append': 1
      }
    });
    expect(upgradePlan.impacts).toEqual(['src/installed/auth/session.ts', 'upgrade.metadata.json']);
  });
});

test('CLI reports argument usage errors', { timeout: 20000 }, async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['init', '--unknown'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform init [--reset]\n'
    });
    await expect(runCli(workspaceRoot, ['init', '--reset', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform init [--reset]\n'
    });
    await expect(runCli(workspaceRoot, ['add'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform add <block-id>\n'
    });
    await expect(runCli(workspaceRoot, ['add', 'entity/customer-basic', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform add <block-id>\n'
    });
    await expect(runCli(workspaceRoot, ['repair', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform repair [--dry-run]\n'
    });
    await expect(runCli(workspaceRoot, ['repair', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform repair [--dry-run]\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--dry-run', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version> [--dry-run] [--json]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'slow'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', 'fast'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['resolve', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform resolve\n'
    });
  });
});
