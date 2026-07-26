import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect } from 'bun:test';

import {
  parseSemanticMutationIsolatedChildOutcomeBytes,
  semanticMutationIsolatedChildOutcomePath
} from '../../platform/compiler/semantic-mutation/isolated-verification-child-outcome.ts';
import {
  readSemanticMutationIsolatedProgressTrace,
  SEMANTIC_MUTATION_ISOLATED_EXIT_CODES
} from '../../platform/compiler/semantic-mutation/isolated-verification-child-progress.ts';
import {
  buildSemanticMutationIsolatedVerificationEnvironment,
  createSemanticMutationIsolatedVerificationSupervisor,
  prepareCanonicalSemanticMutationIsolatedRuntimeInputSources,
  probeSemanticMutationIsolatedRuntimeCapability,
  type SemanticMutationIsolatedRuntimeInputSources
} from '../../platform/compiler/verify/run-semantic-mutation-isolated-child.ts';
import {
  assertSemanticMutationIsolatedRuntimeLaunchManifest,
  materializeSemanticMutationIsolatedRuntime
} from '../../platform/compiler/verify/semantic-mutation-isolated-runtime-plan.ts';
import { acquireBrowserLaunchPath } from '../../platform/compiler/verify/windows-browser-launch-path.ts';
import { initWorkspace } from '../../platform/orchestrator.ts';
import type { ObservedCommandOutcome } from '../../platform/shared/observed-process.ts';
import {
  observedCommandNativeLifecycleDiagnosticForTests,
  runObservedCommand
} from '../../platform/shared/observed-process.ts';
import { compilerRoot, getWorkspacePaths } from '../../platform/shared/paths.ts';
import { ensureIsolatedProcessDirectories } from '../../platform/shared/process.ts';
import { RUNTIME_DEPS_PREBOUND_BINDING_FILE } from '../../platform/shared/runtime-dependency-spec.ts';
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease
} from '../../platform/shared/workspace-write-lease.ts';

const RUNNER_ENTERED_PROGRESS_TRACE = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered'
] as const);

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

async function writeProjectBaseline(stagingRoot: string): Promise<void> {
  await Promise.all([
    mkdir(path.join(stagingRoot, '.sec', 'cache'), { recursive: true }),
    mkdir(path.join(stagingRoot, 'project'), { recursive: true })
  ]);
  await writeFile(path.join(stagingRoot, '.sec', 'cache', 'project-baseline.json'), JSON.stringify({
    formatVersion: '1', artifacts: []
  }), 'utf8');
}

async function createProductionRuntimeCapabilityContext(root: string): Promise<Readonly<{
  readonly runtimeInputSources: SemanticMutationIsolatedRuntimeInputSources;
  readonly stagingRoot: string;
}>> {
  const stagingRoot = stagingWorkspaceRoot(root);
  const browserSource = path.join(root, 'browser-source');
  await writeProjectBaseline(stagingRoot);
  await mkdir(browserSource, { recursive: true });
  const canonicalRuntimeInputSources =
    await prepareCanonicalSemanticMutationIsolatedRuntimeInputSources();
  const descriptor = JSON.parse(await readFile(path.join(
    canonicalRuntimeInputSources.compilerModulesRoot,
    'playwright-core',
    'browsers.json'
  ), 'utf8')) as {
    readonly browsers: readonly { readonly name: string; readonly revision: string }[];
  };
  const browser = descriptor.browsers.find((candidate) =>
    candidate.name === 'chromium-headless-shell');
  if (!browser) throw new Error('Production browser descriptor is unavailable');
  const browserExecutable = path.join(
    browserSource,
    `chromium_headless_shell-${browser.revision}`,
    'chrome-headless-shell-win64',
    'chrome-headless-shell.exe'
  );
  await mkdir(path.dirname(browserExecutable), { recursive: true });
  await writeFile(browserExecutable, 'production-bundle-browser-fixture', 'utf8');
  return Object.freeze({
    runtimeInputSources: Object.freeze({
      ...canonicalRuntimeInputSources,
      browserCache: browserSource
    }),
    stagingRoot
  });
}

export async function runSemanticMutationProductionSentinel(): Promise<void> {
  const root = await mkdtemp(path.join(
    path.dirname(compilerRoot),
    '.engineering-compiler-sm3-bundled-resolve-'
  ));
  try {
    const { runtimeInputSources, stagingRoot } = await createProductionRuntimeCapabilityContext(root);
    const poisonNextRoot = path.join(root, 'node_modules', 'next');
    await mkdir(poisonNextRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(poisonNextRoot, 'package.json'), JSON.stringify({
        name: 'next',
        version: '0.0.0-poison',
        types: './poison.d.ts',
        exports: { '.': './poison.d.ts', './*': './poison.d.ts' }
      }), 'utf8'),
      writeFile(path.join(poisonNextRoot, 'poison.d.ts'), 'export type Poison = ;\n', 'utf8')
    ]);
    await initWorkspace(stagingRoot, { reset: true });
    await writeProjectBaseline(stagingRoot);
    const authoringIndexRoot = path.join(stagingRoot, 'source', 'model');
    await mkdir(authoringIndexRoot, { recursive: true });
    const focusedSemanticStop = [
      'formatRevision: focused-semantic-stop-after-resolve',
      'contracts: []',
      ''
    ].join('\n');
    await writeFile(
      path.join(authoringIndexRoot, 'semantic-contracts.yaml'),
      focusedSemanticStop,
      'utf8'
    );

    const capability = await probeSemanticMutationIsolatedRuntimeCapability(stagingRoot, {
      runtimeInputSources
    });
    expect(capability).toEqual({ status: 'available' });
    const materialized = await materializeSemanticMutationIsolatedRuntime({
      binding: capability,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingRoot
    });
    await assertSemanticMutationIsolatedRuntimeLaunchManifest({
      binding: capability,
      commitFence: async () => undefined,
      stagingWorkspaceRoot: stagingRoot
    });
    const stagingProjectRoot = getWorkspacePaths(stagingRoot).projectRoot;
    const preboundBindingPath = path.join(
      stagingProjectRoot,
      'node_modules',
      RUNTIME_DEPS_PREBOUND_BINDING_FILE
    );
    const nextManifestPath = path.join(stagingProjectRoot, 'node_modules', 'next', 'package.json');
    await expect(stat(nextManifestPath)).resolves.toBeDefined();
    await expect(stat(path.join(
      stagingRoot,
      '.isolated-compiler',
      'node_modules',
      'next',
      'package.json'
    ))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(path.join(poisonNextRoot, 'package.json'), 'utf8')))
      .toMatchObject({ version: '0.0.0-poison' });
    expect(await readFile(
      path.join(authoringIndexRoot, 'semantic-contracts.yaml'),
      'utf8'
    )).toBe(focusedSemanticStop);
    const preboundBindingBefore = await readFile(preboundBindingPath);
    const nextManifestBefore = await readFile(nextManifestPath);

    await ensureIsolatedProcessDirectories(path.join(stagingRoot, '.isolated-process', 'child'));
    const browserLaunchPath = await acquireBrowserLaunchPath(
      materialized.browsersPath,
      materialized.browserExecutableRelativePath
    );
    const lease = await acquireWorkspaceWriteLease(root);
    let observedOutcome: ObservedCommandOutcome | undefined;
    const supervisor = createSemanticMutationIsolatedVerificationSupervisor({
      observedCommandRunner: async (command, args, options) => {
        const outcome = await runObservedCommand(command, args, options);
        observedOutcome = outcome;
        return outcome;
      },
      timeoutMs: 180_000
    });
    try {
      let execution: { readonly code: number };
      try {
        execution = await supervisor({
          browserLaunchProofArgument: browserLaunchPath.proofArgument,
          commitFence: async () => assertWorkspaceWriteLease(root, lease.token),
          env: buildSemanticMutationIsolatedVerificationEnvironment(
            stagingRoot,
            browserLaunchPath.browsersPath
          ),
          runnerRelativePath: materialized.runnerRelativePath,
          stagingWorkspaceRoot: stagingRoot,
          workspaceRoot: root,
          workspaceWriteLease: lease.token
        });
      } catch (error) {
        throw new Error(JSON.stringify({
          supervisorError: error instanceof Error ? error.message : String(error),
          observedOutcome,
          nativeLifecycleDiagnostic: observedOutcome === undefined
            ? undefined
            : observedCommandNativeLifecycleDiagnosticForTests(observedOutcome)
        }));
      }
      expect(execution.code).toBe(SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure);
      const childOutcome = parseSemanticMutationIsolatedChildOutcomeBytes(
        new Uint8Array(await readFile(semanticMutationIsolatedChildOutcomePath(stagingRoot)))
      );
      expect(await readSemanticMutationIsolatedProgressTrace(stagingRoot)).toEqual({
        status: 'valid',
        trace: {
          checkpoints: [
            ...RUNNER_ENTERED_PROGRESS_TRACE,
            'catch-armed',
            'verify-all',
            'failure-caught',
            'catch-tree-validated',
            'outcome-publish-started'
          ],
          lastCheckpoint: 'outcome-publish-started'
        }
      });
      const stagingPaths = getWorkspacePaths(stagingRoot);
      const resolvedLock = JSON.parse(await readFile(stagingPaths.lockPath, 'utf8')) as {
        readonly passStatus: Readonly<Record<string, string>>;
        readonly resolvedBlocks: readonly unknown[];
      };
      const pipelineJournal = JSON.parse(await readFile(
        path.join(stagingPaths.localStateRoot, 'pipeline-journal.json'),
        'utf8'
      )) as {
        readonly transactions: readonly {
          readonly errorCode?: string;
          readonly message?: string;
          readonly status: string;
        }[];
      };
      expect({
        childOutcome,
        pipelineTransaction: pipelineJournal.transactions.at(-1)
      }).toMatchObject({
        childOutcome: {
          formatVersion: 'semantic-mutation-isolated-child-outcome-v1',
          status: 'failed',
          stage: 'verify-all',
          boundary: 'pipeline-semantic'
        },
        pipelineTransaction: {
          status: 'failed',
          errorCode: 'CONTRACT-SEMANTIC-019'
        }
      });
      expect(resolvedLock.resolvedBlocks.length).toBeGreaterThan(0);
      expect(resolvedLock.passStatus).toMatchObject({
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded'
      });
      expect(await readFile(preboundBindingPath)).toEqual(preboundBindingBefore);
      expect(await readFile(nextManifestPath)).toEqual(nextManifestBefore);
      expect((await readdir(stagingProjectRoot)).filter((entry) =>
        entry.startsWith('.engineering-compiler-template-'))).toEqual([]);
    } finally {
      try {
        await lease.release();
      } finally {
        await browserLaunchPath.release();
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}
