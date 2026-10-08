/**
 * Package-local fault-injection entrypoint. Production code must import
 * ../runtime.ts, whose wrappers discard every test transport and lifecycle
 * control before entering the dependency owner.
 */
import { generatedStateProducerHooks } from '../../../../../tests/helpers/generated-state-fixture.ts';
import { ensureProjectDependencyOperation } from '../../../../bootstrap/toolchain/dependency-operation.ts';
import type { DependencyProjectLifecycleAdmission } from '../../../../execution/dependency-materialization.ts';
import type { CommandResult } from '../../../runtime-state/physical/runtime/process.ts';
import { issueRuntimeDependencyTestMaterialization } from '../runtime/materialization-fixture-capability.ts';
import {
  type RuntimeDependencyInstallOptions as InternalRuntimeDependencyInstallOptions
} from '../runtime/operation-context.ts';
import * as dependencyRuntime from '../runtime/project-runtime.ts';

export * from '../runtime.ts';
export {
  assertCompilerDependencyEnvironmentRetirementReceipt,
  disposeCompilerDependencyEnvironment,
  readRuntimeDepsStamp
} from '../runtime/project-runtime.ts';
export type {
  CompilerDependencyEnvironmentRetirementReceipt
} from '../runtime/project-runtime.ts';
export {
  issueCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation
} from './compiler-dependency-fixture.ts';

type TestMaterializationRunner = (
  args: string[],
  options: Readonly<{ cwd: string; timeoutMs: number }>
) => Promise<CommandResult>;

export type RuntimeDependencyTestInstallOptions =
  InternalRuntimeDependencyInstallOptions & Readonly<{
    materialize?: TestMaterializationRunner;
  }>;

function testInstallOptions(
  options: RuntimeDependencyTestInstallOptions
): InternalRuntimeDependencyInstallOptions & DependencyProjectLifecycleAdmission {
  const { materialize, ...canonical } = options;
  return {
    ...canonical,
    ...(canonical.generatedStateLifecycle !== undefined || canonical.generatedStateLifecycleFactory !== undefined ? {} : {
      generatedStateLifecycleFactory: Object.freeze({ forWorkspace: (root: string) => generatedStateProducerHooks({ repositoryRoot: root }) })
    }),
    ...(materialize === undefined ? {} : {
      testMaterialization: issueRuntimeDependencyTestMaterialization(async (request) => (
        materialize([...request.args], {
          cwd: request.cwd,
          timeoutMs: request.timeoutMs
        })
      ))
    })
  } as InternalRuntimeDependencyInstallOptions & DependencyProjectLifecycleAdmission;
}

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyTestInstallOptions = {},
  compilerDependencyRoot?: string
): Promise<dependencyRuntime.CompilerDepsReadyState> {
  return dependencyRuntime.ensureCompilerDepsReady(
    testInstallOptions(options),
    compilerDependencyRoot
  );
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyTestInstallOptions = {}
): Promise<void> {
  return ensureProjectDependencyOperation(projectRoot, testInstallOptions(options));
}

export async function migrateDependencyTransitionJournal(
  ownerRoot: string,
  options: RuntimeDependencyTestInstallOptions = {}
): Promise<void> {
  return dependencyRuntime.migrateDependencyTransitionJournal(ownerRoot, testInstallOptions(options));
}
