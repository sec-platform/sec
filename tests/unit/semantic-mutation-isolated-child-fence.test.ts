import { link, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { planSemanticMutationVerificationCapabilities } from '../../platform/compiler/index.ts';
import { assertIsolatedStagingTree } from '../../platform/compiler/verify/assert-isolated-staging-tree.ts';
import {
  createSemanticMutationIsolatedVerificationSupervisor,
  probeSemanticMutationIsolatedRuntimeCapability,
  runSemanticMutationIsolatedVerificationChild,
  type SemanticMutationIsolatedRuntimeInputSources
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  assertSemanticMutationIsolatedRuntimeLaunchManifest,
  materializeSemanticMutationIsolatedRuntime
} from '../../platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { runCommand } from '../../platform/shared/process.ts';
import {
  WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
  type WorkspaceWriteLeaseToken
} from '../../platform/shared/workspace-write-lease.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

function stagingWorkspaceRoot(root: string): string {
  return path.join(
    root,
    '.sec',
    'semantic-mutation',
    'v1',
    'transactions',
    'a'.repeat(64),
    'workspace'
  );
}

function workspaceWriteLeaseToken(): WorkspaceWriteLeaseToken {
  return Object.freeze({
    formatVersion: WORKSPACE_WRITE_LEASE_TOKEN_VERSION,
    workspaceIdentityDigest: 'sha256:workspace',
    leaseDirectoryIdentityDigest: 'sha256:lease-directory',
    hostname: 'semantic-mutation-test-host',
    pid: 1234,
    processNonce: 'semantic-mutation-test-process',
    leaseId: 'semantic-mutation-test-lease'
  });
}

async function createRuntimeInputSources(
  root: string,
  browserCache: string
): Promise<SemanticMutationIsolatedRuntimeInputSources> {
  const inputRoot = path.join(root, 'runtime-inputs');
  const compilerModulesRoot = path.join(inputRoot, 'node_modules');
  const sources = {
    browserCache,
    compilerModulesRoot,
    compilerPackage: path.join(inputRoot, 'package.json'),
    composeTemplates: path.join(inputRoot, 'compose-templates'),
    dependencyModules: path.join(inputRoot, 'dependency-modules'),
    officialPolicies: path.join(inputRoot, 'official-policies'),
    officialRegistry: path.join(inputRoot, 'official-registry')
  } satisfies SemanticMutationIsolatedRuntimeInputSources;
  await Promise.all([
    mkdir(sources.composeTemplates, { recursive: true }),
    mkdir(sources.dependencyModules, { recursive: true }),
    mkdir(sources.officialPolicies, { recursive: true }),
    mkdir(sources.officialRegistry, { recursive: true }),
    mkdir(path.join(compilerModulesRoot, 'ts-morph'), { recursive: true }),
    mkdir(path.join(compilerModulesRoot, 'typescript'), { recursive: true }),
    mkdir(path.join(compilerModulesRoot, 'playwright-core'), { recursive: true }),
    mkdir(path.join(
      browserCache,
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64'
    ), { recursive: true })
  ]);
  await Promise.all([
    writeFile(sources.compilerPackage, JSON.stringify({
      dependencies: {
        next: '1', react: '1', 'react-dom': '1', yaml: '1'
      },
      devDependencies: {
        '@playwright/test': '1', '@types/bun': '1', '@types/node': '1',
        '@types/react': '1', '@types/react-dom': '1', 'ts-morph': '1', typescript: '1'
      }
    }), 'utf8'),
    writeFile(path.join(sources.composeTemplates, 'template.txt'), 'template', 'utf8'),
    writeFile(path.join(sources.dependencyModules, 'cache.bin'), 'cache', 'utf8'),
    writeFile(path.join(sources.officialPolicies, 'policy.yaml'), 'policies: []', 'utf8'),
    writeFile(path.join(sources.officialRegistry, 'registry.yaml'), 'blocks: []', 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'ts-morph', 'package.json'), JSON.stringify({
      name: 'ts-morph', dependencies: {}
    }), 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'typescript', 'package.json'), JSON.stringify({
      name: 'typescript', dependencies: {}
    }), 'utf8'),
    writeFile(path.join(compilerModulesRoot, 'playwright-core', 'browsers.json'), JSON.stringify({
      browsers: [{ name: 'chromium-headless-shell', revision: '1217' }]
    }), 'utf8'),
    writeFile(path.join(
      browserCache,
      'chromium_headless_shell-1217',
      'chrome-headless-shell-win64',
      'chrome-headless-shell.exe'
    ), 'playwright-executable', 'utf8')
  ]);
  return sources;
}

async function writeProjectBaseline(stagingRoot: string): Promise<void> {
  await mkdir(path.join(stagingRoot, '.sec', 'cache'), { recursive: true });
  await writeFile(path.join(stagingRoot, '.sec', 'cache', 'project-baseline.json'), JSON.stringify({
    formatVersion: '1', artifacts: []
  }), 'utf8');
}

test('isolated verification supervisor aborts an active runner when its workspace lease fence is lost', async () => {
  let leaseValid = true;
  let aborted = false;
  let fenceCalls = 0;
  const commitFence = async (): Promise<void> => {
    fenceCalls += 1;
    if (!leaseValid) throw new Error('injected supervisor lease loss');
  };
  const commandRunner: typeof runCommand = async (_command, _args, options) => {
    await options.beforeSpawn?.();
    leaseValid = false;
    return new Promise((_resolve, reject) => {
      const onAbort = (): void => {
        aborted = true;
        reject(new Error('runner aborted'));
      };
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });
    });
  };
  const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
    commandRunner,
    pollIntervalMs: 1
  });
  const workspaceRoot = String.raw`C:\live-workspace`;
  const workspaceWriteLease = workspaceWriteLeaseToken();

  await expect(supervisor({
    commitFence,
    env: { PATH: '' },
    runnerRelativePath: '.isolated-process/runner/runner.mjs',
    stagingWorkspaceRoot: String.raw`C:\isolated-staging`,
    workspaceRoot,
    workspaceWriteLease
  })).rejects.toThrow('injected supervisor lease loss');
  expect(aborted).toBe(true);
  expect(fenceCalls).toBeGreaterThanOrEqual(3);
});

test('production isolated verification supervisor delegates only to Windows AppContainer', async () => {
  const workspaceRoot = String.raw`C:\live-workspace`;
  const stagingRoot = String.raw`C:\live-workspace\.sec\semantic-mutation\v1\transactions\${'b'.repeat(64)}\workspace`;
  const workspaceWriteLease = workspaceWriteLeaseToken();
  let calls = 0;
  const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
    appContainerRunner: async (request) => {
      calls += 1;
      expect(request).toEqual({
        stagingRoot,
        runnerRelativePath: '.isolated-compiler/platform/orchestrator/runner.mjs',
        environment: { PATH: '', SYSTEMROOT: String.raw`C:\Windows`, WINDIR: String.raw`C:\Windows` },
        workspaceRoot,
        workspaceWriteLease,
        timeoutMs: 1_200_000
      });
      return { exitCode: 7 };
    }
  });

  expect(await supervisor({
    commitFence: async () => undefined,
    env: { PATH: '', SYSTEMROOT: String.raw`C:\Windows`, WINDIR: String.raw`C:\Windows` },
    runnerRelativePath: '.isolated-compiler/platform/orchestrator/runner.mjs',
    stagingWorkspaceRoot: stagingRoot,
    workspaceRoot,
    workspaceWriteLease
  })).toEqual({ code: 7, stdout: '', stderr: '' });
  expect(calls).toBe(1);
});

test('isolated verification fences report cleanup before removing any prior evidence', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    const reportPath = getWorkspacePaths(stagingRoot).verificationReportPath;
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, 'retained-report', 'utf8');
    await writeProjectBaseline(stagingRoot);
    const browserSource = path.join(root, 'browser-source');
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    let bundleBuilds = 0;
    let supervisorCalls = 0;
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        bundleBuilds += 1;
        return new Uint8Array([1]);
      },
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');

    await expect(runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => {
        throw new Error('injected report cleanup lease loss');
      },
      runtimeCapabilityForTest,
      supervisor: async () => {
        supervisorCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
      workspaceRoot: root,
      workspaceWriteLease
    })).rejects.toThrow('Semantic Mutation isolated verification is unavailable');

    expect(await readFile(reportPath, 'utf8')).toBe('retained-report');
    expect(bundleBuilds).toBe(1);
    expect(supervisorCalls).toBe(0);
  }, 'engineering-compiler-sm3-isolated-report-fence-');
});

test('isolated verification rechecks the fence after planned runner construction before writing it', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const browserSource = path.join(root, 'browser-source');
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runnerPath = path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'semantic-mutation-isolated-verification-runner.mjs'
    );
    let bundleBuilt = false;
    let supervisorCalls = 0;
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        bundleBuilt = true;
        return new TextEncoder().encode('console.log("runner")');
      },
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');

    await expect(runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => {
        if (bundleBuilt) throw new Error('injected post-bundle lease loss');
      },
      runtimeCapabilityForTest,
      supervisor: async () => {
        supervisorCalls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
      workspaceRoot: root,
      workspaceWriteLease
    })).rejects.toThrow('Semantic Mutation isolated verification is unavailable');

    await expect(stat(runnerPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(supervisorCalls).toBe(0);
  }, 'engineering-compiler-sm3-isolated-runner-bundle-fence-');
});

test('isolated verification materializes fenced runner and browser inputs before invoking its supervisor hook', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const workspaceWriteLease = workspaceWriteLeaseToken();
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(path.join(browserSource, 'chromium'), { recursive: true });
    await writeFile(path.join(browserSource, 'chromium', 'browser.bin'), new Uint8Array([3, 1, 4, 1, 5]));
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runtimeCapabilityForTest = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
      runtimeInputSources
    });
    expect(runtimeCapabilityForTest.status).toBe('available');
    let fenceCalls = 0;
    let supervisorCalls = 0;

    await expect(runSemanticMutationIsolatedVerificationChild(stagingRoot, {
      commitFence: async () => {
        fenceCalls += 1;
      },
      runtimeCapabilityForTest,
      supervisor: async (request) => {
        supervisorCalls += 1;
        expect(request.runnerRelativePath)
          .toBe('.isolated-compiler/platform/orchestrator/semantic-mutation-isolated-verification-runner.mjs');
        expect(request.stagingWorkspaceRoot).toBe(stagingRoot);
        expect(request.workspaceRoot).toBe(root);
        expect(request.workspaceWriteLease).toBe(workspaceWriteLease);
        await request.commitFence();
        throw new Error('stop after materialization');
      },
      workspaceRoot: root,
      workspaceWriteLease
    })).rejects.toThrow('Semantic Mutation isolated verification is unavailable');

    expect(supervisorCalls).toBe(1);
    expect(fenceCalls).toBeGreaterThanOrEqual(20);
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'semantic-mutation-isolated-verification-runner.mjs'
    ), 'utf8')).toBe('console.log("runner")');
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'templates',
      'template.txt'
    ), 'utf8')).toBe('template');
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'node_modules',
      'typescript',
      'package.json'
    ), 'utf8')).toContain('"name":"typescript"');
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-process',
      'playwright-browsers',
      'chromium',
      'browser.bin'
    ))).toEqual(Buffer.from([3, 1, 4, 1, 5]));
  }, 'engineering-compiler-sm3-isolated-materialization-fence-');
});

test('runtime plan rejects cloned bindings, stale sources, destination tamper, and extra empty directories', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await writeProjectBaseline(stagingRoot);
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    const runtimeCapability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => new TextEncoder().encode('console.log("runner")'),
      runtimeInputSources
    });
    expect(runtimeCapability.status).toBe('available');
    const capabilityPlan = await planSemanticMutationVerificationCapabilities({
      snapshot: {
        ir: {
          inputRevision: `sha256:${'1'.repeat(64)}`,
          semanticRevision: `sha256:${'2'.repeat(64)}`,
          entities: [],
          facts: []
        }
      } as never,
      requirements: [{ kind: 'pass', passId: 'verify' }],
      isolationCapabilityProbe: () => runtimeCapability
    });
    expect(capabilityPlan.status).toBe('runnable');
    const commitFence = async (): Promise<void> => undefined;
    await materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    });
    expect(await readFile(path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'compiler',
      'compose',
      'templates',
      'template.txt'
    ), 'utf8')).toBe('template');
    const runnerPath = path.join(
      stagingRoot,
      '.isolated-compiler',
      'platform',
      'orchestrator',
      'semantic-mutation-isolated-verification-runner.mjs'
    );
    await expect(materializeSemanticMutationIsolatedRuntime({
      binding: structuredClone(capabilityPlan),
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('invalid or forged');
    expect(await readFile(runnerPath, 'utf8')).toBe('console.log("runner")');

    const extraDirectory = path.join(stagingRoot, '.isolated-compiler', 'unexpected-empty');
    await mkdir(extraDirectory, { recursive: true });
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');
    await rm(extraDirectory, { recursive: true, force: true });

    await writeFile(runnerPath, 'tampered-runner', 'utf8');
    await expect(assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('destination manifest is not exact');

    await writeFile(path.join(runtimeInputSources.composeTemplates, 'template.txt'), 'stale', 'utf8');
    await expect(materializeSemanticMutationIsolatedRuntime({
      binding: capabilityPlan,
      commitFence,
      stagingWorkspaceRoot: stagingRoot
    })).rejects.toThrow('source changed before materialization');
    expect(await readFile(runnerPath, 'utf8')).toBe('tampered-runner');
  }, 'engineering-compiler-sm3-runtime-plan-manifest-');
});

test('isolated staging tree rejects hard links and reparse aliases', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    await mkdir(stagingRoot, { recursive: true });
    const original = path.join(stagingRoot, 'original.txt');
    const hardLink = path.join(stagingRoot, 'hard-link.txt');
    await writeFile(original, 'shared-bytes', 'utf8');
    await link(original, hardLink);

    await expect(assertIsolatedStagingTree(stagingRoot)).rejects.toThrow('hard-linked file');

    await rm(hardLink, { force: true });
    const outside = path.join(root, 'outside');
    const alias = path.join(stagingRoot, 'reparse-alias');
    await mkdir(outside, { recursive: true });
    await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(assertIsolatedStagingTree(stagingRoot)).rejects.toThrow(
      'symbolic link, junction, or reparse point'
    );
  }, 'engineering-compiler-sm3-isolated-staging-links-');
});

test('isolated runtime capability permits baseline bootstrap but blocks Prisma and linked opaque modules', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const browserSource = path.join(root, 'browser-source');
    await mkdir(stagingRoot, { recursive: true });
    await mkdir(browserSource, { recursive: true });
    await writeFile(path.join(browserSource, 'browser.bin'), 'browser', 'utf8');
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);
    let bundleBuilds = 0;
    const probe = () => probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      buildRunnerBundle: async () => {
        bundleBuilds += 1;
        return new Uint8Array([1]);
      },
      runtimeInputSources
    });

    expect(await probe()).toEqual({ status: 'available' });
    await mkdir(path.join(stagingRoot, 'source', 'schema'), { recursive: true });
    await writeFile(path.join(stagingRoot, 'source', 'schema', 'db.prisma.template'), 'model A {}', 'utf8');
    expect(await probe()).toEqual({ status: 'unavailable' });
    await rm(path.join(stagingRoot, 'source', 'schema'), { recursive: true, force: true });
    await mkdir(path.join(stagingRoot, 'source', 'code', 'opaque', 'example'), { recursive: true });
    await writeFile(path.join(stagingRoot, 'source', 'code', 'opaque', 'example', 'module.yaml'), 'name: example', 'utf8');
    expect(await probe()).toEqual({ status: 'unavailable' });
    await rm(path.join(stagingRoot, 'source', 'code', 'opaque'), { recursive: true, force: true });
    expect(await probe()).toEqual({ status: 'available' });
    expect(bundleBuilds).toBe(2);
  }, 'engineering-compiler-sm3-isolated-capability-blockers-');
});

test('isolated runtime capability builds a host-path-free production runner bundle', async () => {
  await withTempWorkspace(async (root) => {
    const stagingRoot = stagingWorkspaceRoot(root);
    const browserSource = path.join(root, 'browser-source');
    await mkdir(path.join(stagingRoot, '.sec', 'cache'), { recursive: true });
    await writeFile(path.join(stagingRoot, '.sec', 'cache', 'project-baseline.json'), JSON.stringify({
      formatVersion: '1', artifacts: []
    }), 'utf8');
    await mkdir(browserSource, { recursive: true });
    await writeFile(path.join(browserSource, 'browser.bin'), 'browser', 'utf8');
    const runtimeInputSources = await createRuntimeInputSources(root, browserSource);

    expect(await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      runtimeInputSources
    })).toEqual({ status: 'available' });
  }, 'engineering-compiler-sm3-isolated-production-bundle-');
});
