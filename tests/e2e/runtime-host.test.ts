import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { type AddressInfo, createServer } from 'node:net';
import path from 'node:path';

import {
  buildIsolatedRuntimeAcceptanceEnvironment,
  buildIsolatedRuntimeEnvironment,
  runtimeVerificationInvocation,
  withIsolatedRuntimeAcceptanceServer
} from '../../platform/compiler/verify/run-runtime-verification.ts';
import {
  semanticMutationIsolatedNodeExecutablePath
} from '../../platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
import {
  acquireBrowserLaunchPath
} from '../../platform/compiler/verify/windows-browser-launch-path.ts';
import {
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { runCommand } from '../../platform/shared/process.ts';
import { ensureProjectBase } from '../../platform/shared/project-base.ts';
import {
  resolveExternalNodeRuntimeAuthority,
  withProjectDependencyBridge
} from '../../platform/shared/project-runtime.ts';
import {
  createWindowsBrowserLaunchFixture,
  WINDOWS_BROWSER_EXECUTABLE_RELATIVE_PATH
} from '../helpers/windows-browser-launch-path-fixture.ts';
import { createWorkspace, withTempWorkspace } from '../testkit/workspace.ts';

test.skipIf(process.platform !== 'win32')(
  'production Windows browser launch authority hardens and removes its private host root',
  async () => {
    const input = await createWindowsBrowserLaunchFixture();
    try {
      const lease = await acquireBrowserLaunchPath(
        input.browserRoot,
        WINDOWS_BROWSER_EXECUTABLE_RELATIVE_PATH
      );
      const authorityRoot = path.dirname(path.dirname(lease.browsersPath));
      await lease.assertCurrent();
      await lease.release();
      await expect(fs.lstat(authorityRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.rm(input.root, { recursive: true, force: true });
    }
  }
);

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function assertLoopbackPortIsFree(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function ensureEnvironmentDirectories(environment: NodeJS.ProcessEnv): Promise<void> {
  for (const value of [
    environment.HOME,
    environment.USERPROFILE,
    environment.APPDATA,
    environment.LOCALAPPDATA,
    environment.TEMP,
    environment.TMP,
    environment.TMPDIR,
    environment.PLAYWRIGHT_BROWSERS_PATH
  ]) {
    if (value) await fs.mkdir(value, { recursive: true });
  }
}

test('compose refreshes runtime host scaffold for an existing workspace baseline', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-compose-refresh-');
  const projectRoot = path.join(workspaceRoot, 'project');

  await initWorkspace(workspaceRoot, { reset: true });
  await fs.writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'stale-generated-project',
        private: true,
        type: 'module',
        scripts: {
          test: 'node --test'
        }
      },
      null,
      2
    ),
    'utf8'
  );

  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);

  const projectPackage = await readJson<{
    scripts: Record<string, string>;
  }>(path.join(projectRoot, 'package.json'));
  expect(projectPackage.scripts.build).toBe('next build --webpack');
  expect(projectPackage.scripts['verify:runtime:service']).toBe('bun run test:unit');
  expect(projectPackage.scripts['verify:runtime:full']).toBe(
    'bun run build && bun run test:unit && bun run test:acceptance'
  );
  expect(projectPackage.scripts['verify:runtime']).toBe('bun run verify:runtime:full');
  await expect(fs.readFile(path.join(projectRoot, 'playwright.config.ts'), 'utf8')).resolves.toContain('workers: 1');
}, 180000);

test('isolated runtime acceptance launches generated Next under SEC lifecycle and closes the server', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await ensureProjectBase(workspaceRoot);
    const { projectRoot } = getWorkspacePaths(workspaceRoot);
    const isolatedRuntimeRoot = path.join(workspaceRoot, '.isolated-process', 'runtime');
    const isolatedConfigPath = path.join(isolatedRuntimeRoot, 'bunfig.toml');
    const stagedNode = semanticMutationIsolatedNodeExecutablePath(workspaceRoot);
    const externalNode = await resolveExternalNodeRuntimeAuthority();
    const resolvedNestedConfig = path.resolve(projectRoot, '../.isolated-process/runtime/bunfig.toml');
    const testPort = await reserveLoopbackPort();
    expect(resolvedNestedConfig).toBe(isolatedConfigPath);

    await Promise.all([
      fs.mkdir(path.join(projectRoot, 'app', 'login'), { recursive: true }),
      fs.mkdir(path.join(projectRoot, 'tests', 'runtime', 'acceptance'), { recursive: true }),
      fs.mkdir(isolatedRuntimeRoot, { recursive: true }),
      fs.mkdir(path.dirname(stagedNode), { recursive: true })
    ]);
    await Promise.all([
      fs.writeFile(path.join(projectRoot, 'app', 'layout.js'), [
        'export default function RootLayout({ children }) {',
        '  return <html><body>{children}</body></html>;',
        '}',
        ''
      ].join('\n'), 'utf8'),
      fs.writeFile(path.join(projectRoot, 'app', 'login', 'page.js'), [
        'export default function LoginPage() {',
        "  return <main>shell-authority-ok</main>;",
        '}',
        ''
      ].join('\n'), 'utf8'),
      fs.writeFile(path.join(projectRoot, 'tests', 'runtime', 'acceptance', 'shell-authority.spec.ts'), [
        "import { expect, test } from '@playwright/test';",
        '',
        "test('serves the generated login route', async ({ request, baseURL }) => {",
        "  const response = await request.get(`${baseURL}/login`);",
        '  expect(response.ok()).toBe(true);',
        "  expect(await response.text()).toContain('shell-authority-ok');",
        '});',
        ''
      ].join('\n'), 'utf8'),
      fs.writeFile(isolatedConfigPath, '# isolated runtime\n', 'utf8'),
      fs.copyFile(externalNode.executablePath, stagedNode)
    ]);

    await withProjectDependencyBridge(projectRoot, async () => {
      const buildEnvironment = buildIsolatedRuntimeEnvironment(workspaceRoot);
      await ensureEnvironmentDirectories(buildEnvironment);
      const buildInvocation = runtimeVerificationInvocation(
        'build', projectRoot, true, isolatedConfigPath, stagedNode
      );
      const buildResult = await runCommand(buildInvocation.command, buildInvocation.args, {
        cwd: projectRoot,
        env: buildEnvironment,
        envMode: 'replace',
        timeoutMs: 120_000
      });
      expect(buildResult).toMatchObject({ code: 0 });

      await fs.writeFile(path.join(projectRoot, 'bunfig.toml'), 'invalid project bunfig = [\n', 'utf8');

      const acceptanceEnvironment = buildIsolatedRuntimeAcceptanceEnvironment(workspaceRoot, {
        TEST_PORT: String(testPort)
      });
      expect(acceptanceEnvironment.PATH?.split(path.delimiter).at(-1))
        .toBe(path.dirname(stagedNode));
      expect(acceptanceEnvironment.NODE_OPTIONS).toBeUndefined();
      expect(acceptanceEnvironment.NODE_PATH).toBeUndefined();
      await ensureEnvironmentDirectories(acceptanceEnvironment);
      const acceptanceInvocation = runtimeVerificationInvocation(
        'acceptance',
        projectRoot,
        true,
        isolatedConfigPath,
        stagedNode
      );
      const acceptanceResult = await withIsolatedRuntimeAcceptanceServer({
        environment: acceptanceEnvironment,
        nodeExecutablePath: stagedNode,
        port: testPort,
        projectRoot,
        stagingWorkspaceRoot: workspaceRoot
      }, async () => await runCommand(acceptanceInvocation.command, acceptanceInvocation.args, {
          cwd: projectRoot,
          env: acceptanceEnvironment,
          envMode: 'replace',
          timeoutMs: 120_000
        }));
      expect(acceptanceResult).toMatchObject({ code: 0 });
      expect(`${acceptanceResult.stdout}\n${acceptanceResult.stderr}`).not.toMatch(
        /ENOENT|uv_spawn|cmd\.exe.*(?:not found|not recognized)|taskkill.*(?:not found|not recognized)/iu
      );
    });

    await assertLoopbackPortIsFree(testPort);
  }, 'engineering-compiler-runtime-shell-');
}, 180_000);
