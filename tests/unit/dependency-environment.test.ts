import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { legacySharedDependencyRetirementExpectation } from '../../src/adapters/toolchain/dependencies/runtime/lifecycle-registration.ts';
import {
  dependencyAuthorityPaths,
  disposeCanonicalSharedDependencies,
  migrateDependencyTransitionJournal
} from '../../src/adapters/toolchain/dependencies/runtime/project-runtime.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import {
  cleanDependencyEnvironment,
  getDoctorReport
} from '../../src/bootstrap/toolchain/dependency-environment.ts';
import { SecError } from '../../src/contracts/failure.ts';
import {
  generatedStateDigest,
  generatedStateLegacyRetirementRuleForPath
} from "../../src/execution/generated-state/contract.ts";
import { generatedStateProducerHooks } from '../helpers/generated-state-fixture.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function withDependencyRetirementFixture(
  callback: (fixture: Readonly<{
    lifecycle: ReturnType<typeof generatedStateProducerHooks>;
    repositoryRoot: string;
    sharedDepsRoot: string;
    environment: NodeJS.ProcessEnv;
  }>) => Promise<void>
): Promise<void> {
  const hostRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-shared-dependency-retirement-'));
  try {
    const repositoryRoot = path.join(hostRoot, 'repository');
    const sharedDepsRoot = dependencyAuthorityPaths(repositoryRoot).sharedDepsRoot;
    await fs.mkdir(path.join(sharedDepsRoot, '.bun-cache', 'legacy-package'), { recursive: true });
    await fs.copyFile(path.join(process.cwd(), 'package.json'), path.join(repositoryRoot, 'package.json'));
    await fs.writeFile(
      path.join(sharedDepsRoot, '.bun-cache', 'legacy-package', 'content.bin'),
      'legacy dependency bytes\n'
    );
    const environment = {
      ...process.env,
      SEC_CACHE_HOME: path.join(hostRoot, 'cache'),
      SEC_STATE_HOME: path.join(hostRoot, 'state')
    };
    const lifecycle = generatedStateProducerHooks(
      { repositoryRoot },
      { environment }
    );
    await callback(Object.freeze({ lifecycle, repositoryRoot, sharedDepsRoot, environment }));
  } finally {
    await fs.rm(hostRoot, { force: true, recursive: true });
  }
}

async function seedHistoricalSharedDependencyRegistration(input: Readonly<{
  repositoryRoot: string;
  sharedDepsRoot: string;
  environment: NodeJS.ProcessEnv;
}>): Promise<void> {
  const relativePath = '.shared-deps';
  const rule = generatedStateLegacyRetirementRuleForPath(relativePath);
  if (rule === null) throw new Error('legacy shared-deps retirement rule is unavailable');
  const workspace = inspectNoFollowDirectoryChain(
    input.repositoryRoot,
    'legacy shared-deps fixture workspace'
  ).target;
  const generated = inspectNoFollowDirectoryChain(
    input.sharedDepsRoot,
    'legacy shared-deps fixture generation'
  ).target;
  const physical = (value: typeof workspace) => Object.freeze({
    device: value.device,
    inode: value.inode,
    objectId: value.objectId
  });
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceIdentity = physical(workspace);
  const rootIdentity = physical(generated);
  const operationId = 'historical-shared-deps-generation';
  const registrationId = generatedStateDigest(Object.freeze({
    schema: 'sec-generated-state-registration-v1',
    repositoryRoot,
    workspace: workspaceIdentity,
    ruleId: rule.id,
    relativePath,
    root: rootIdentity,
    owner: rule.owner,
    producer: rule.producer,
    operationId
  }));
  const material = Object.freeze({
    schema: 'sec-generated-state-registration-v1' as const,
    registrationId,
    repositoryRoot,
    workspace: workspaceIdentity,
    ruleId: rule.id,
    relativePath,
    root: rootIdentity,
    owner: rule.owner,
    producer: rule.producer,
    operationId,
    phase: 'active' as const,
    retirementRef: null,
    generatedAt: '2026-08-29T00:00:00.000Z'
  });
  const registration = Object.freeze({
    ...material,
    registrationDigest: generatedStateDigest(material)
  });
  const roots = resolveSecWorkspaceRuntimeRoots({
    repositoryRoot,
    environment: input.environment
  });
  const registrationsRoot = path.join(
    roots.workspaceStateRoot,
    'generated-state',
    'v1',
    'registrations'
  );
  await fs.mkdir(registrationsRoot, { recursive: true });
  const bytes = `${JSON.stringify(registration, null, 2)}\n`;
  await fs.writeFile(
    path.join(
      registrationsRoot,
      `registration-${registration.registrationDigest.slice('sha256:'.length)}.json`
    ),
    bytes,
    'utf8'
  );
  const pointerKey = generatedStateDigest(Object.freeze({
    schema: 'sec-generated-state-registration-key-v1',
    relativePath
  })).slice('sha256:'.length);
  await fs.writeFile(path.join(registrationsRoot, `${pointerKey}.json`), bytes, 'utf8');
}

test('dependency doctor projects the canonical dependency state without an external runtime probe', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const paths = getWorkspacePaths(workspaceRoot);
    await Promise.all([
      fs.mkdir(paths.modelRoot, { recursive: true }),
      fs.mkdir(paths.srcRoot, { recursive: true }),
      fs.mkdir(paths.secRoot, { recursive: true })
    ]);
    const report = await getDoctorReport(workspaceRoot);
    const dependencyCheck = report.checks.find(({ id }) => id === 'runtime-dependencies');
    const rootsCheck = report.checks.find(({ id }) => id === 'workspace-roots');

    expect(dependencyCheck).toMatchObject({
      id: 'runtime-dependencies',
      status: report.dependencies.mode === 'warm-project' ? 'ok' : 'warn'
    });
    expect(rootsCheck).toEqual({
      id: 'workspace-roots',
      status: 'ok',
      message: 'Workspace roots exist: workspace, model, src, .sec.'
    });
    expect(report.dependencies.projectNodeModules.path).toBe(
      path.join(paths.workspaceRoot, 'node_modules')
    );
  }, 'engineering-compiler-dependency-doctor-');
});

test('project dependency cleanup stays within the selected workspace owner root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { workspaceRoot: targetWorkspaceRoot } = getWorkspacePaths(workspaceRoot);
    const projectNodeModules = path.join(targetWorkspaceRoot, 'node_modules');
    const projectStamp = path.join(targetWorkspaceRoot, '.runtime-deps.stamp.json');
    await fs.mkdir(projectNodeModules, { recursive: true });
    await fs.writeFile(projectStamp, '{}\n', 'utf8');

    const targets = await cleanDependencyEnvironment(
      workspaceRoot,
      { project: true, force: true }
    );

    expect(targets).toContain(projectNodeModules);
    expect(targets).toContain(projectStamp);
    expect(targets.every((target) => path.relative(targetWorkspaceRoot, target)
      .split(path.sep).every((segment) => segment !== '..'))).toBe(true);
    await expect(fs.stat(projectNodeModules)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(projectStamp)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-dependency-clean-');
});

test('unregistered legacy shared dependencies remain physically intact with a typed zero-effect blocker', async () => {
  await withDependencyRetirementFixture(async ({ lifecycle, repositoryRoot, sharedDepsRoot }) => {
    let observed: unknown;
    try {
      await disposeCanonicalSharedDependencies(
        { generatedStateLifecycle: lifecycle, lockTimeoutMs: 5_000 },
        'legacy-unregistered-retirement',
        repositoryRoot
      );
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(SecError);
    expect(observed).toMatchObject({
      code: 'IMPORT-AUTHORITY-004',
      cause: expect.objectContaining({ code: 'GENERATED_STATE_PROVENANCE_BLOCKED' })
    });
    expect(await fs.readFile(
      path.join(sharedDepsRoot, '.bun-cache', 'legacy-package', 'content.bin'),
      'utf8'
    )).toBe('legacy dependency bytes\n');
    await expect(fs.stat(path.join(repositoryRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('historically registered shared dependencies retire through the legacy-only recognizer', async () => {
  await withDependencyRetirementFixture(async ({
    lifecycle,
    repositoryRoot,
    sharedDepsRoot,
    environment
  }) => {
    await seedHistoricalSharedDependencyRegistration({
      repositoryRoot,
      sharedDepsRoot,
      environment
    });
    await expect(lifecycle.born('.shared-deps', 'forbidden-new-shared-deps-generation'))
      .rejects.toThrow('not registered by active policy');
    const options = { generatedStateLifecycle: lifecycle, lockTimeoutMs: 5_000 };
    const physical = inspectNoFollowDirectoryChain(sharedDepsRoot, 'historical shared dependency observation').target;
    const expectation = legacySharedDependencyRetirementExpectation({
      device: physical.device,
      inode: physical.inode,
      objectId: physical.objectId
    });
    await migrateDependencyTransitionJournal(repositoryRoot, options);
    expect(await disposeCanonicalSharedDependencies(
      options,
      'registered-shared-dependency-retirement',
      repositoryRoot
    )).toBe(true);
    await expect(fs.stat(sharedDepsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lifecycle.observeRetirement('.shared-deps', expectation)).status)
      .toBe('retired-domain-settled');
    expect(await disposeCanonicalSharedDependencies(
      options,
      'registered-shared-dependency-retirement-repeat',
      repositoryRoot
    )).toBe(false);
  });
});

test('a present noncanonical stamp blocks legacy retirement classification with zero effect', async () => {
  await withDependencyRetirementFixture(async ({ lifecycle, repositoryRoot, sharedDepsRoot }) => {
    await fs.writeFile(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'), '{}\n');
    let fenceCalls = 0;
    await expect(disposeCanonicalSharedDependencies(
      {
        beforeCommit: async () => {
          fenceCalls += 1;
        },
        generatedStateLifecycle: lifecycle,
        lockTimeoutMs: 5_000
      },
      'shared-dependency-retirement-unresolved-stamp',
      repositoryRoot
    )).rejects.toMatchObject({ code: 'RUNTIME-DEPS-002' });
    expect(fenceCalls).toBe(0);
    expect(await fs.readFile(
      path.join(sharedDepsRoot, 'runtime-deps.stamp.json'),
      'utf8'
    )).toBe('{}\n');
    await expect(fs.stat(path.join(repositoryRoot, '.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
