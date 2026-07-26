import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ensurePlaywrightBrowserCacheReady,
  materializePlaywrightBrowserCache,
  resolveExternalNodeRuntimeAuthority
} from '../../platform/shared/project-runtime.ts';
import {
  EXACT_PLAYWRIGHT_PACKAGE_NAMES,
  type ExactPlaywrightPackageName
} from '../../platform/shared/runtime-dependency-spec.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const PLAYWRIGHT_RELEASE = '1.59.1';

function playwrightPackageManifest(name: ExactPlaywrightPackageName, version = PLAYWRIGHT_RELEASE): string {
  return JSON.stringify({ name, version });
}

function playwrightPackageClosure() {
  const packages = EXACT_PLAYWRIGHT_PACKAGE_NAMES.map((name) => ({
    manifestSha256: createHash('sha256')
      .update(playwrightPackageManifest(name))
      .digest('hex'),
    name,
    version: PLAYWRIGHT_RELEASE
  }));
  const release = PLAYWRIGHT_RELEASE;
  return {
    packages,
    release,
    revision: `sha256:${createHash('sha256').update(JSON.stringify({
      domain: 'playwright-package-authority-v1',
      packages,
      release
    })).digest('hex')}`
  };
}

async function writePlaywrightCli(
  projectRoot: string,
  versions: Partial<Record<ExactPlaywrightPackageName, string>> = {}
): Promise<string> {
  const playwrightCli = path.join(projectRoot, 'node_modules', 'playwright', 'cli.js');
  await Promise.all(EXACT_PLAYWRIGHT_PACKAGE_NAMES.map(async (name) => {
    const packageRoot = path.join(projectRoot, 'node_modules', ...name.split('/'));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      playwrightPackageManifest(name, versions[name] ?? PLAYWRIGHT_RELEASE),
      'utf8'
    );
  }));
  await fs.writeFile(playwrightCli, 'fixture\n', 'utf8');
  return playwrightCli;
}

async function writeNodeRuntime(tempRoot: string): Promise<string> {
  await fs.mkdir(tempRoot, { recursive: true });
  const nodeExecutablePath = path.join(tempRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  await fs.writeFile(nodeExecutablePath, 'node fixture\n', 'utf8');
  return fs.realpath(nodeExecutablePath);
}

function nodeAuthorityResult(
  nodeExecutablePath: string,
  overrides: Partial<{
    bunVersion: string | null;
    executablePath: string;
    format: string;
    releaseName: string;
    version: string;
  }> = {}
) {
  return {
    code: 0,
    stdout: JSON.stringify({
      bunVersion: null,
      executablePath: nodeExecutablePath,
      format: 'sec-external-node-runtime-v1',
      releaseName: 'node',
      version: '24.15.0',
      ...overrides
    }),
    stderr: ''
  };
}

function isNodeAuthorityProbe(args: string[]): boolean {
  return args[0] === '-e' && args.length === 2;
}

function isPlaywrightRegistryProbe(args: string[]): boolean {
  return args[0] === '-e' && args.length === 3;
}

function browserRuntimeAuthority(
  browserCachePath: string,
  browserExecutablePath: string,
  nodeExecutablePath: string
) {
  return {
    browserCachePath,
    browserExecutablePath,
    browserExecutableRelativePath: 'current-browser/headless-shell',
    externalNode: {
      executablePath: nodeExecutablePath,
      version: '24.15.0'
    },
    playwrightPackageClosure: playwrightPackageClosure()
  };
}

describe('Playwright browser cache materialization', () => {
  test('selects a real external Node 22+ authority instead of Bun compatibility metadata', async () => {
    const authority = await resolveExternalNodeRuntimeAuthority();
    expect(path.isAbsolute(authority.executablePath)).toBe(true);
    expect(Number.parseInt(authority.version.split('.')[0] ?? '0', 10)).toBeGreaterThanOrEqual(22);
    expect(await fs.realpath(authority.executablePath)).toBe(authority.executablePath);
    expect(Object.isFrozen(authority)).toBe(true);
    if (process.versions.bun) {
      expect(authority.executablePath).not.toBe(process.execPath);
    }
  });

  test('selects the first physical PATH runtime and validates its reported identity', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const calls: string[] = [];
      const authority = await resolveExternalNodeRuntimeAuthority({
        environment: { PATH: tempRoot },
        commandRunner: async (command, args, options) => {
          calls.push(command);
          expect(args).toHaveLength(2);
          expect(options.env?.NODE_OPTIONS).toBeUndefined();
          expect(options.env?.NODE_PATH).toBeUndefined();
          return nodeAuthorityResult(nodeExecutablePath);
        }
      }, tempRoot);

      expect(authority).toEqual({ executablePath: nodeExecutablePath, version: '24.15.0' });
      expect(calls).toEqual([nodeExecutablePath]);
    }, 'engineering-compiler-node-path-');
  });

  test('fails before lock or download for incompatible, Bun, non-Node, or non-executable runtimes', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const driftedNodeExecutablePath = await writeNodeRuntime(path.join(tempRoot, 'drifted-runtime'));
      const cases = [
        {
          name: 'incompatible',
          run: async () => nodeAuthorityResult(nodeExecutablePath, { version: '20.19.0' })
        },
        {
          name: 'bun',
          run: async () => nodeAuthorityResult(nodeExecutablePath, { bunVersion: '1.3.14' })
        },
        {
          name: 'non-node',
          run: async () => nodeAuthorityResult(nodeExecutablePath, { releaseName: 'poisoned' })
        },
        {
          name: 'reported-exec-path-drift',
          run: async () => nodeAuthorityResult(nodeExecutablePath, {
            executablePath: driftedNodeExecutablePath
          })
        },
        {
          name: 'malformed-probe',
          run: async () => ({ code: 0, stdout: 'not-json', stderr: '' })
        },
        {
          name: 'non-executable',
          run: async () => {
            throw new Error('spawn EACCES');
          }
        }
      ];

      for (const fixture of cases) {
        let commandCalls = 0;
        await expect(materializePlaywrightBrowserCache({
          commandRunner: async () => {
            commandCalls += 1;
            return fixture.run();
          },
          nodeExecutablePath
        }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-005' });
        expect(commandCalls).toBe(1);
        await expect(fs.stat(path.join(tempRoot, '.shared-deps', 'playwright-browser-install.lock')))
          .rejects.toMatchObject({ code: 'ENOENT' });
      }
    }, 'engineering-compiler-node-invalid-');
  });

  test('binds one verified Node to the project-local CLI and current executable under the canonical cache', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const playwrightProjectRoot = path.join(tempRoot, 'runtime-project');
      const playwrightCli = await writePlaywrightCli(playwrightProjectRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      const calls: Array<{
        args: string[];
        command: string;
        cwd: string;
        env: NodeJS.ProcessEnv;
        timeoutMs: number | undefined;
      }> = [];

      const ready = await ensurePlaywrightBrowserCacheReady({
        environment: {
          NODE_OPTIONS: '--require=poisoned.js',
          NODE_PATH: 'poisoned-modules',
          PLAYWRIGHT_BROWSERS_PATH: 'poisoned-cache',
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
          TEST_BROWSER_ENV: 'preserved'
        },
        nodeExecutablePath,
        playwrightProjectRoot,
        commandRunner: async (command, args, options) => {
          calls.push({
            command,
            args,
            cwd: options.cwd,
            env: options.env ?? {},
            timeoutMs: options.timeoutMs
          });
          if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
          if (isPlaywrightRegistryProbe(args)) {
            return { code: 0, stdout: `${browserExecutablePath}\n`, stderr: '' };
          }
          expect(args).toEqual([playwrightCli, 'install', 'chromium']);
          await fs.mkdir(path.dirname(browserExecutablePath), { recursive: true });
          await fs.writeFile(browserExecutablePath, 'browser\n', 'utf8');
          return { code: 0, stdout: 'installed', stderr: '' };
        }
      }, tempRoot);

      expect(ready).toEqual(
        browserRuntimeAuthority(browserCachePath, browserExecutablePath, nodeExecutablePath)
      );
      expect(calls).toHaveLength(4);
      expect(calls.every(({ command }) => command === nodeExecutablePath)).toBe(true);
      expect(calls.filter(({ args }) => isPlaywrightRegistryProbe(args))).toHaveLength(2);
      const installCall = calls.find(({ args }) => args[0] === playwrightCli);
      expect(installCall).toEqual({
        command: nodeExecutablePath,
        args: [playwrightCli, 'install', 'chromium'],
        cwd: playwrightProjectRoot,
        env: {
          NODE_OPTIONS: undefined,
          NODE_PATH: undefined,
          PLAYWRIGHT_BROWSERS_PATH: browserCachePath,
          PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: undefined,
          TEST_BROWSER_ENV: 'preserved'
        },
        timeoutMs: 600_000
      });
      await expect(fs.stat(path.join(tempRoot, '.shared-deps', 'playwright-browser-install.lock')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-playwright-cache-');
  });

  test('rejects Playwright package release drift before registry selection or installation', async () => {
    for (const packageName of EXACT_PLAYWRIGHT_PACKAGE_NAMES) {
      await withTempWorkspace(async (tempRoot) => {
        await writePlaywrightCli(tempRoot, { [packageName]: '1.59.0' });
        const nodeExecutablePath = await writeNodeRuntime(tempRoot);
        let registryOrInstallCalls = 0;
        await expect(materializePlaywrightBrowserCache({
          commandRunner: async (_command, args) => {
            if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
            registryOrInstallCalls += 1;
            return { code: 0, stdout: '', stderr: '' };
          },
          nodeExecutablePath
        }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-000' });
        expect(registryOrInstallCalls).toBe(0);
      }, `engineering-compiler-playwright-release-${packageName.replaceAll('/', '-')}-`);
    }
  });

  test('requires one positive bounded installer timeout and forwards an explicit override', async () => {
    for (const installTimeoutMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(materializePlaywrightBrowserCache({
        installTimeoutMs
      }, 'unused-invalid-timeout-root')).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-005',
        details: { timeoutMs: installTimeoutMs }
      });
    }

    await withTempWorkspace(async (tempRoot) => {
      const playwrightCli = await writePlaywrightCli(tempRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      let observedTimeoutMs: number | undefined;

      await expect(materializePlaywrightBrowserCache({
        installTimeoutMs: 12_345,
        nodeExecutablePath,
        commandRunner: async (_command, args, options) => {
          if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
          if (isPlaywrightRegistryProbe(args)) {
            return { code: 0, stdout: browserExecutablePath, stderr: '' };
          }
          expect(args).toEqual([playwrightCli, 'install', 'chromium']);
          observedTimeoutMs = options.timeoutMs;
          await fs.mkdir(path.dirname(browserExecutablePath), { recursive: true });
          await fs.writeFile(browserExecutablePath, 'browser\n', 'utf8');
          return { code: 0, stdout: 'installed', stderr: '' };
        }
      }, tempRoot)).resolves.toMatchObject({
        browserCachePath,
        browserExecutablePath,
        source: 'installed',
        status: 'ready'
      });
      expect(observedTimeoutMs).toBe(12_345);
    }, 'engineering-compiler-playwright-cache-timeout-');
  });

  test('performs one cold install across concurrent callers and reuses the exact warm identity', async () => {
    await withTempWorkspace(async (tempRoot) => {
      const playwrightCli = await writePlaywrightCli(tempRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      let activeInstallers = 0;
      let installCalls = 0;
      let maxActiveInstallers = 0;

      const commandRunner = async (_command: string, args: string[]) => {
        if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
        if (isPlaywrightRegistryProbe(args)) {
          return { code: 0, stdout: browserExecutablePath, stderr: '' };
        }
        expect(args).toEqual([playwrightCli, 'install', 'chromium']);
        installCalls += 1;
        activeInstallers += 1;
        maxActiveInstallers = Math.max(maxActiveInstallers, activeInstallers);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await fs.mkdir(path.dirname(browserExecutablePath), { recursive: true });
        await fs.writeFile(browserExecutablePath, 'browser\n', 'utf8');
        activeInstallers -= 1;
        return { code: 0, stdout: 'installed', stderr: '' };
      };

      const results = await Promise.all([
        materializePlaywrightBrowserCache({ commandRunner, nodeExecutablePath, pollIntervalMs: 1 }, tempRoot),
        materializePlaywrightBrowserCache({ commandRunner, nodeExecutablePath, pollIntervalMs: 1 }, tempRoot),
        materializePlaywrightBrowserCache({ commandRunner, nodeExecutablePath, pollIntervalMs: 1 }, tempRoot)
      ]);
      expect(results.map(({ source }) => source).sort()).toEqual(['existing', 'existing', 'installed']);
      expect(results.every(({ browserExecutablePath: value }) => value === browserExecutablePath)).toBe(true);
      expect(installCalls).toBe(1);
      expect(maxActiveInstallers).toBe(1);

      const warm = await materializePlaywrightBrowserCache({ commandRunner, nodeExecutablePath }, tempRoot);
      expect(warm).toMatchObject({
        browserCachePath,
        browserExecutablePath,
        source: 'existing',
        status: 'ready'
      });
      expect(installCalls).toBe(1);
    }, 'engineering-compiler-playwright-cache-lock-');
  });

  test('preserves installer failure bytes and allows one clean retry', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writePlaywrightCli(tempRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      let installCode = 17;
      const commandRunner = async (_command: string, args: string[]) => {
        if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
        if (isPlaywrightRegistryProbe(args)) {
          return { code: 0, stdout: browserExecutablePath, stderr: '' };
        }
        if (installCode !== 0) {
          return { code: installCode, stdout: 'partial', stderr: 'network unavailable' };
        }
        await fs.mkdir(path.dirname(browserExecutablePath), { recursive: true });
        await fs.writeFile(browserExecutablePath, 'browser\n', 'utf8');
        return { code: 0, stdout: 'retry ok', stderr: '' };
      };

      const failed = await materializePlaywrightBrowserCache({ commandRunner, nodeExecutablePath }, tempRoot);
      expect(failed).toEqual({
        browserCachePath,
        browserExecutablePath: null,
        commandResult: { code: 17, stdout: 'partial', stderr: 'network unavailable' },
        source: null,
        status: 'failed'
      });
      await expect(ensurePlaywrightBrowserCacheReady({ commandRunner, nodeExecutablePath }, tempRoot)).rejects.toMatchObject({
        code: 'RUNTIME-DEPS-005',
        details: {
          browserCachePath,
          commandResult: { code: 17, stdout: 'partial', stderr: 'network unavailable' }
        }
      });

      installCode = 0;
      await expect(ensurePlaywrightBrowserCacheReady({ commandRunner, nodeExecutablePath }, tempRoot)).resolves.toEqual({
        ...browserRuntimeAuthority(browserCachePath, browserExecutablePath, nodeExecutablePath)
      });
    }, 'engineering-compiler-playwright-cache-retry-');
  });

  test('treats registry failure, malformed output, and lexical escape as fatal without downloading', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writePlaywrightCli(tempRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      const cases = [
        { code: 23, stdout: '', stderr: 'registry poisoned' },
        { code: 0, stdout: `${browserExecutablePath}\n${browserExecutablePath}`, stderr: '' },
        { code: 0, stdout: 'relative-browser', stderr: '' },
        { code: 0, stdout: path.join(tempRoot, 'outside-browser'), stderr: '' }
      ];

      for (const registryResult of cases) {
        let installCalls = 0;
        await expect(materializePlaywrightBrowserCache({
          commandRunner: async (_command, args) => {
            if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
            if (isPlaywrightRegistryProbe(args)) return registryResult;
            installCalls += 1;
            return { code: 0, stdout: '', stderr: '' };
          },
          nodeExecutablePath
        }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-005' });
        expect(installCalls).toBe(0);
        await expect(fs.stat(path.join(tempRoot, '.shared-deps', 'playwright-browser-install.lock')))
          .rejects.toMatchObject({ code: 'ENOENT' });
      }
    }, 'engineering-compiler-playwright-registry-failure-');
  });

  test('rejects poisoned cold-cache ancestors before lock, download, or outside mutation', async () => {
    await withTempWorkspace(async (outsideRoot) => {
      for (const poisonedPath of ['shared-deps-parent', 'browser-intermediate'] as const) {
        await withTempWorkspace(async (tempRoot) => {
          await writePlaywrightCli(tempRoot);
          const nodeExecutablePath = await writeNodeRuntime(tempRoot);
          const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
          const browserCachePath = path.join(sharedDepsRoot, '.playwright-browsers');
          const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
          const lockPath = path.join(sharedDepsRoot, 'playwright-browser-install.lock');
          if (poisonedPath === 'shared-deps-parent') {
            await fs.symlink(outsideRoot, sharedDepsRoot, process.platform === 'win32' ? 'junction' : 'dir');
          } else {
            await fs.mkdir(browserCachePath, { recursive: true });
            await fs.symlink(
              outsideRoot,
              path.dirname(browserExecutablePath),
              process.platform === 'win32' ? 'junction' : 'dir'
            );
          }

          let installCalls = 0;
          await expect(materializePlaywrightBrowserCache({
            commandRunner: async (_command, args) => {
              if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
              if (isPlaywrightRegistryProbe(args)) {
                return { code: 0, stdout: browserExecutablePath, stderr: '' };
              }
              installCalls += 1;
              await fs.writeFile(path.join(outsideRoot, 'unexpected-browser-write'), 'escaped\n', 'utf8');
              return { code: 0, stdout: 'unexpected install', stderr: '' };
            },
            nodeExecutablePath
          }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-005' });

          expect(installCalls).toBe(0);
          await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
          await expect(fs.stat(path.join(outsideRoot, 'playwright-browser-install.lock')))
            .rejects.toMatchObject({ code: 'ENOENT' });
          await expect(fs.stat(path.join(outsideRoot, 'unexpected-browser-write')))
            .rejects.toMatchObject({ code: 'ENOENT' });
          await expect(fs.stat(path.join(outsideRoot, 'headless-shell')))
            .rejects.toMatchObject({ code: 'ENOENT' });
        }, `engineering-compiler-playwright-${poisonedPath}-`);
      }
    }, 'engineering-compiler-playwright-outside-');
  });

  test('rechecks cold-cache containment under the install lock before spawning the installer', async () => {
    await withTempWorkspace(async (outsideRoot) => {
      await withTempWorkspace(async (tempRoot) => {
        await writePlaywrightCli(tempRoot);
        const nodeExecutablePath = await writeNodeRuntime(tempRoot);
        const sharedDepsRoot = path.join(tempRoot, '.shared-deps');
        const browserCachePath = path.join(sharedDepsRoot, '.playwright-browsers');
        const browserIntermediatePath = path.join(browserCachePath, 'current-browser');
        const browserExecutablePath = path.join(browserIntermediatePath, 'headless-shell');
        const lockPath = path.join(sharedDepsRoot, 'playwright-browser-install.lock');
        await fs.mkdir(browserCachePath, { recursive: true });

        let fenceCalls = 0;
        let installCalls = 0;
        await expect(materializePlaywrightBrowserCache({
          beforeCommit: async () => {
            fenceCalls += 1;
            if (fenceCalls === 4) {
              await fs.symlink(
                outsideRoot,
                browserIntermediatePath,
                process.platform === 'win32' ? 'junction' : 'dir'
              );
            }
          },
          commandRunner: async (_command, args) => {
            if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
            if (isPlaywrightRegistryProbe(args)) {
              return { code: 0, stdout: browserExecutablePath, stderr: '' };
            }
            installCalls += 1;
            await fs.writeFile(path.join(outsideRoot, 'unexpected-browser-write'), 'escaped\n', 'utf8');
            return { code: 0, stdout: 'unexpected install', stderr: '' };
          },
          nodeExecutablePath
        }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-005' });

        expect(fenceCalls).toBeGreaterThanOrEqual(5);
        expect(installCalls).toBe(0);
        await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.stat(path.join(outsideRoot, 'unexpected-browser-write')))
          .rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.stat(path.join(outsideRoot, 'headless-shell')))
          .rejects.toMatchObject({ code: 'ENOENT' });
      }, 'engineering-compiler-playwright-under-lock-');
    }, 'engineering-compiler-playwright-under-lock-outside-');
  });

  test('rejects a stale cache when installation does not create the registry-selected executable', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writePlaywrightCli(tempRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      await fs.mkdir(browserCachePath, { recursive: true });

      await expect(ensurePlaywrightBrowserCacheReady({
        commandRunner: async (_command, args) => {
          if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
          if (isPlaywrightRegistryProbe(args)) {
            return { code: 0, stdout: browserExecutablePath, stderr: '' };
          }
          return { code: 0, stdout: 'false success', stderr: '' };
        },
        nodeExecutablePath
      }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-005' });
    }, 'engineering-compiler-playwright-cache-stale-');
  });

  test('fails closed before lock or download when the configured Node runtime is unavailable', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writePlaywrightCli(tempRoot);
      let commandCalls = 0;

      await expect(materializePlaywrightBrowserCache({
        commandRunner: async () => {
          commandCalls += 1;
          return { code: 0, stdout: '', stderr: '' };
        },
        nodeExecutablePath: path.join(tempRoot, 'missing-node')
      }, tempRoot)).rejects.toMatchObject({ code: 'RUNTIME-DEPS-005' });
      expect(commandCalls).toBe(0);
      await expect(fs.stat(path.join(tempRoot, '.shared-deps', 'playwright-browser-install.lock')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    }, 'engineering-compiler-playwright-cache-node-');
  });

  test('aborts browser-specific lock waiting without changing the shared lock implementation', async () => {
    await withTempWorkspace(async (tempRoot) => {
      await writePlaywrightCli(tempRoot);
      const nodeExecutablePath = await writeNodeRuntime(tempRoot);
      const browserCachePath = path.join(tempRoot, '.shared-deps', '.playwright-browsers');
      const browserExecutablePath = path.join(browserCachePath, 'current-browser', 'headless-shell');
      const lockPath = path.join(tempRoot, '.shared-deps', 'playwright-browser-install.lock');
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      await fs.writeFile(lockPath, JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
        token: 'active-owner'
      }), 'utf8');
      const controller = new AbortController();
      let installCalls = 0;

      await expect(materializePlaywrightBrowserCache({
        commandRunner: async (_command, args) => {
          if (isNodeAuthorityProbe(args)) return nodeAuthorityResult(nodeExecutablePath);
          if (isPlaywrightRegistryProbe(args)) {
            return { code: 0, stdout: browserExecutablePath, stderr: '' };
          }
          installCalls += 1;
          return { code: 0, stdout: '', stderr: '' };
        },
        nodeExecutablePath,
        pollIntervalMs: 1,
        signal: controller.signal,
        sleep: async () => new Promise<void>(() => {
          queueMicrotask(() => controller.abort());
        })
      }, tempRoot)).rejects.toBeTruthy();
      expect(installCalls).toBe(0);
      await expect(fs.stat(lockPath)).resolves.toMatchObject({});
    }, 'engineering-compiler-playwright-cache-abort-');
  });
});
