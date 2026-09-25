import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

import type { RuntimeVerificationLaneReport, VerificationStatus, VerificationStepReport } from '../../assurance/verification/contract/types.ts';
import { compareCodeUnits } from '../../contracts/canonical.ts';
import type { CommitFence } from "../../contracts/commit-fence.ts";
import { relativePosixPath } from '../../contracts/relative-path.ts';
import { defaultLogger } from '../diagnostics/json-logger.ts';
import { listFilesRecursive } from '../filesystem/discovery.ts';
import { writeText } from "../filesystem/files.ts";
import { buildIsolatedProcessEnvironment, ensureIsolatedProcessDirectories, type CommandResult, type RunCommandOptions } from '../runtime-state/physical/runtime/process.ts';
import {
  ensureDependencyMaterializationReady,
  ensureProjectDependencies,
  withProjectDependencyBridge
} from '../toolchain/dependencies/runtime.ts';
import { compilerRoot, getWorkspacePaths } from "../workspace-context.ts";
import {
  assertIsolatedStagingTree,
  type IsolatedStagingTreeOptions
} from './assert-isolated-staging-tree.ts';
import {
  withSemanticMutationIsolatedPhaseTelemetry,
  type IsolatedPhase
} from './semantic-mutation/isolated/phase-telemetry.ts';
import { RUNTIME_VERIFICATION_INVOCATION_CONTRACT } from './runtime-verification-invocation-contract.ts';
import { runRuntimeUnitProcess } from './runtime-unit-process.ts';

type RuntimeVerificationMode = 'service' | 'full';

type RuntimeVerificationCommandRunner = (
  command: string,
  args: string[],
  options: RunCommandOptions
) => Promise<CommandResult>;

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

export async function resolveIsolatedRuntimeDependencySources(): Promise<Readonly<IsolatedRuntimeDependencySources>> {
  const compilerModulesRoot = captureIsolatedRuntimeBuildNodeModulesProof().physicalRoot;
  const materialization = await ensureDependencyMaterializationReady({ installMode: 'offline-copy-only' });
  const dependencyModules = realpathSync.native(materialization.nodeModulesPath);
  if (!lstatSync(dependencyModules).isDirectory()) {
    throw new Error('Runtime dependency materialization root is not a directory');
  }
  return Object.freeze({ compilerModulesRoot, dependencyModules });
}

type RuntimeVerificationOptions = {
  beforeCommit?: CommitFence;
  commandRunnerForTests?: RuntimeVerificationCommandRunner;
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
  if (!path.isAbsolute(projectRoot)) {
    throw new Error('Runtime verification requires one absolute project root');
  }
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
    phase: IsolatedPhase,
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
  if (runtimeUnitFiles.length === 0) return lane;

  if (isolated) {
    await withPhase('runtime-dependency-validation', () => ensureProjectDependencies(workspaceRoot, {
      beforeCommit: options.beforeCommit,
      signal: options.signal,
      installMode: 'prebound-only'
    }));
  }

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
  try {
    const invocation = runtimeVerificationInvocation(workspaceRoot, isolated, isolatedConfigPath);
    const executeRuntimeUnit = () => timed('runtime unit', options.emitTiming ?? true, () =>
      options.commandRunnerForTests === undefined
        ? runRuntimeUnitProcess({
            workspaceRoot,
            command: invocation.command,
            args: invocation.args,
            environment,
            isolated,
            beforeCommit: options.beforeCommit,
            signal: options.signal
          })
        : options.commandRunnerForTests(invocation.command, invocation.args, {
            beforeSpawn: isolated ? options.beforeCommit : undefined,
            cwd: workspaceRoot,
            env: environment,
            signal: options.signal,
            ...(isolated ? { envMode: 'replace' as const } : {})
          })
    );
    const result = isolated
      ? await executeRuntimeUnit()
      : await withPhase('runtime-dependency-validation', () => withProjectDependencyBridge(
          workspaceRoot,
          executeRuntimeUnit,
          { beforeCommit: options.beforeCommit, signal: options.signal }
        ));
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
