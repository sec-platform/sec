import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { buildIsolatedProcessEnvironment, ensureIsolatedProcessDirectories, runCommand } from '../../runtime-state/physical/runtime/process.ts';
import { defaultLogger } from '../../system-architecture/foundation/logger.ts';
import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  dependencyAuthorityPaths,
  ensureProjectDependencies
} from '../../toolchain/dependencies/runtime.ts';
import type { RuntimeVerificationLaneReport, VerificationStatus, VerificationStepReport } from '../../verification/contract/types.ts';
import { listFilesRecursive } from '../../workspace/discovery.ts';
import type { CommitFence } from '../../workspace/files.ts';
import { writeText } from '../../workspace/files.ts';
import { compilerRoot, getWorkspacePaths, relativePosixPath } from '../../workspace/paths.ts';
import {
  withSemanticMutationIsolatedPhaseTelemetry,
  type SemanticMutationIsolatedPhase
} from '../semantic-mutation/isolated-verification-phase-telemetry.ts';
import {
  assertIsolatedStagingTree,
  type IsolatedStagingTreeOptions
} from './assert-isolated-staging-tree.ts';
import { RUNTIME_VERIFICATION_INVOCATION_CONTRACT } from './runtime-verification-invocation-contract.ts';

type RuntimeVerificationMode = 'service' | 'full';

export interface IsolatedRuntimeDependencySources {
  readonly compilerModulesRoot: string;
  readonly dependencyModules: string;
}

export interface IsolatedRuntimeBuildNodeModulesProof {
  readonly bridgePath: string;
  readonly bridgeIdentity: string;
  readonly physicalRoot: string;
  readonly physicalRootIdentity: string;
}

function physicalIdentity(filePath: string): string {
  const value = lstatSync(filePath);
  return [value.dev, value.ino, value.mode, value.nlink, value.size, value.ctimeMs, value.mtimeMs]
    .map(String)
    .join(':');
}

export function captureIsolatedRuntimeBuildNodeModulesProof(): Readonly<IsolatedRuntimeBuildNodeModulesProof> {
  const bridgePath = path.join(compilerRoot, 'node_modules');
  const physicalRoot = realpathSync.native(bridgePath);
  const metadata = lstatSync(physicalRoot);
  if (!metadata.isDirectory()) throw new Error('Compiler dependency root is not a directory');
  return Object.freeze({
    bridgePath,
    bridgeIdentity: physicalIdentity(bridgePath),
    physicalRoot,
    physicalRootIdentity: physicalIdentity(physicalRoot)
  });
}

export function revalidateIsolatedRuntimeBuildNodeModulesProof(
  proof: IsolatedRuntimeBuildNodeModulesProof
): string {
  const current = captureIsolatedRuntimeBuildNodeModulesProof();
  if (JSON.stringify(current) !== JSON.stringify(proof)) {
    throw new Error('Compiler dependency root changed during isolated runner build');
  }
  return current.physicalRoot;
}

export function resolveIsolatedRuntimeDependencySources(): Readonly<IsolatedRuntimeDependencySources> {
  const compilerModulesRoot = captureIsolatedRuntimeBuildNodeModulesProof().physicalRoot;
  const authority = dependencyAuthorityPaths();
  const dependencyModules = (() => {
    try {
      const resolved = realpathSync.native(authority.dependencyModules);
      return lstatSync(resolved).isDirectory() ? resolved : compilerModulesRoot;
    } catch {
      return compilerModulesRoot;
    }
  })();
  return Object.freeze({ compilerModulesRoot, dependencyModules });
}

type RuntimeVerificationOptions = {
  beforeCommit?: CommitFence;
  commandRunnerForTests?: typeof runCommand;
  emitTiming?: boolean;
  isolated?: boolean;
  signal?: AbortSignal;
  sourceEnvironmentForTests?: NodeJS.ProcessEnv;
  stagingTreeOptions?: IsolatedStagingTreeOptions;
  stagingWorkspaceRoot?: string;
};

export function runtimeVerificationInvocation(
  projectRoot: string,
  isolated = false,
  isolatedConfigPath?: string
): { command: string; args: string[] } {
  if (!isolated) {
    return {
      command: 'bun',
      args: ['run', RUNTIME_VERIFICATION_INVOCATION_CONTRACT.unit.packageScript]
    };
  }
  if (!isolatedConfigPath || !path.isAbsolute(isolatedConfigPath)) {
    throw new Error('Isolated Bun invocation requires one fixed config path');
  }
  return {
    command: process.execPath,
    args: [
      '--no-env-file',
      `--config=${isolatedConfigPath}`,
      '--no-install',
      ...RUNTIME_VERIFICATION_INVOCATION_CONTRACT.unit.argvTail
    ]
  };
}

function skippedStep(): VerificationStepReport {
  return { status: 'skipped', passed: [], failed: [], command: null };
}

export function createSkippedRuntimeLane(): RuntimeVerificationLaneReport {
  return {
    status: 'skipped',
    build: skippedStep(),
    unit: skippedStep(),
    acceptance: skippedStep(),
    logs: { stdout: '', stderr: '' }
  };
}

export function normalizeRuntimeVerificationLog(value: string): string {
  return value.replace(/\[[0-9]+(?:\.[0-9]+)?(?:ms|s)\]/g, '[duration]');
}

function relativeRuntimeUnitFiles(projectRoot: string, files: string[]): string[] {
  return files
    .map((file) => relativePosixPath(projectRoot, file))
    .sort(compareCodeUnits);
}

function normalizeStatus(code: number): VerificationStatus {
  return code === 0 ? 'passed' : 'failed';
}

async function timed<T>(label: string, emitTiming: boolean, execute: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const result = await execute();
  if (emitTiming) {
    defaultLogger.info('Runtime verification step timing', {
      elapsedSeconds: (Date.now() - startedAt) / 1_000,
      label
    });
  }
  return result;
}

export async function runRuntimeVerification(
  workspaceRoot: string,
  _mode: RuntimeVerificationMode = 'full',
  options: RuntimeVerificationOptions = {}
): Promise<RuntimeVerificationLaneReport> {
  const isolated = options.isolated === true;
  if (isolated && !options.stagingWorkspaceRoot) {
    throw new Error('Isolated runtime verification requires its staging workspace root');
  }
  const withPhase = async <T>(
    phase: SemanticMutationIsolatedPhase,
    execute: () => Promise<T>
  ): Promise<T> => isolated
    ? withSemanticMutationIsolatedPhaseTelemetry(options.stagingWorkspaceRoot!, phase, execute)
    : execute();

  const runtimeUnitFiles = await withPhase('runtime-test-discovery', async () =>
    relativeRuntimeUnitFiles(
      workspaceRoot,
      (await listFilesRecursive(path.join(getWorkspacePaths(workspaceRoot).testsRoot, 'runtime', 'unit')))
        .filter((file) => file.endsWith('.test.ts'))
    )
  );

  await withPhase('runtime-dependency-validation', () => ensureProjectDependencies(workspaceRoot, {
    beforeCommit: options.beforeCommit,
    signal: options.signal,
    skipSharedDepsWarmup: true,
    ...(isolated ? { installMode: 'prebound-only' as const } : {})
  }));

  const isolatedRuntimeRoot = isolated
    ? path.join(options.stagingWorkspaceRoot!, '.isolated-process', 'runtime')
    : null;
  const isolatedConfigPath = isolatedRuntimeRoot
    ? path.join(isolatedRuntimeRoot, 'bunfig.toml')
    : undefined;
  if (isolatedRuntimeRoot && isolatedConfigPath) {
    await withPhase('runtime-process-environment-materialize', async () => {
      await ensureIsolatedProcessDirectories(isolatedRuntimeRoot, options.beforeCommit);
      await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
    });
  }
  if (isolated) {
    await withPhase('runtime-staging-tree-validation', () =>
      assertIsolatedStagingTree(options.stagingWorkspaceRoot!, options.stagingTreeOptions)
    );
  }

  const environment = isolated
    ? buildIsolatedProcessEnvironment(
        options.stagingWorkspaceRoot!,
        {},
        options.sourceEnvironmentForTests ?? process.env
      )
    : { ...(options.sourceEnvironmentForTests ?? process.env) };
  const lane: RuntimeVerificationLaneReport = {
    status: 'passed',
    build: skippedStep(),
    unit: {
      status: runtimeUnitFiles.length === 0 ? 'skipped' : 'passed',
      passed: [],
      failed: [],
      command: runtimeUnitFiles.length === 0
        ? null
        : RUNTIME_VERIFICATION_INVOCATION_CONTRACT.unit.logicalCommandLabel
    },
    acceptance: skippedStep(),
    logs: { stdout: '', stderr: '' }
  };

  try {
    if (runtimeUnitFiles.length === 0) return lane;
    const invocation = runtimeVerificationInvocation(workspaceRoot, isolated, isolatedConfigPath);
    const result = await timed('runtime unit', options.emitTiming ?? true, () =>
      (options.commandRunnerForTests ?? runCommand)(invocation.command, invocation.args, {
        beforeSpawn: isolated ? options.beforeCommit : undefined,
        cwd: workspaceRoot,
        env: environment,
        signal: options.signal,
        ...(isolated ? { envMode: 'replace' as const } : {})
      })
    );
    const status = normalizeStatus(result.code);
    lane.status = status;
    lane.unit = {
      status,
      passed: status === 'passed' ? runtimeUnitFiles : [],
      failed: status === 'failed' ? runtimeUnitFiles : [],
      command: RUNTIME_VERIFICATION_INVOCATION_CONTRACT.unit.logicalCommandLabel
    };
    lane.logs.stdout = status === 'passed'
      ? `runtime-unit:passed ${runtimeUnitFiles.join(',')}\n`
      : result.stdout;
    lane.logs.stderr = status === 'failed' ? normalizeRuntimeVerificationLog(result.stderr) : '';
    return lane;
  } finally {
    if (isolated) {
      await options.beforeCommit?.();
      await assertIsolatedStagingTree(options.stagingWorkspaceRoot!, options.stagingTreeOptions);
      await options.beforeCommit?.();
    }
  }
}
