import path from 'node:path';

import {
  AUTHOR_KERNEL_READER_CHECK,
  AUTHOR_KERNEL_ROOT,
  AUTHOR_KERNEL_TARGET_CHECK
} from '../../../../contracts/author-kernel-verification.ts';
import { AUTHOR_NATIVE_METHOD_IDS, type AuthorNativeMethodUnit } from '../../../../contracts/author-native-methods.ts';
import { sha256 } from '../../../../contracts/canonical.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';
import { posixPath } from '../../../../contracts/relative-path.ts';
import { observeExecutionProgressPhase } from '../../../../execution/execution-progress.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { observeOptionalDiagnostic } from '../../../../execution/optional-diagnostic.ts';
import { settleResourcesAsync } from '../../../../execution/resource-settlement.ts';
import { createAuthorityGitReadSession } from '../../../providers/git-read/runtime/session.ts';
import { assertIssuedTestImpactProjection, retainTestImpactExecutionInputs, type IssuedTestImpactProjection } from '../../../repository/source-program-model/test-impact-projection.ts';
import type { RetainedWorkingSourceInputGeneration } from '../../../repository/source-program-model/workspace-source-authority.ts';
import {
  inspectNoFollowDirectoryChain,
  retainCurrentProcessExecutable,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceRunResult,
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  RetainedCommandTransportError
} from '../../../runtime-state/physical/runtime/process.ts';
import type { RepositoryDerivedOutput } from '../../../runtime-state/physical/runtime/repository-derived-output.ts';
import { assertRetainedCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../../toolchain/dependencies/runtime.ts';
import {
  retainCargoExtractedSources,
  type RetainedCargoExtractedSources
} from '../../../toolchain/runtime/cargo-extracted-sources.ts';
import {
  composeCargoProcessEnvironment,
  retainCargoPreparationConfiguration,
  type RetainedCargoPreparationConfiguration
} from '../../../toolchain/runtime/cargo-preparation-configuration.ts';
import {
  prepareCargoRegistryInputs,
  type RetainedCargoRegistryInputs
} from '../../../toolchain/runtime/cargo-registry-inputs.ts';
import {
  retainRustupCompilerTools,
  rustupCompilerToolFailureHasPendingResources,
  type RetainedRustupCompilerTools
} from '../../../toolchain/runtime/rustup-compiler-tools.ts';
import { compilerRoot } from '../../../workspace-context.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import { compileAffectedTestSelectionSemanticOperation } from './affected-plan-contract.ts';
import { DEV_COMMAND_MAX_DURATION_MS } from './contract.ts';
import { reportDevExecutionProgress } from './execution-progress.ts';
import { parseNativeCargoBinaryArtifact, parseNativeCargoTestBinaryArtifact } from './native-cargo-artifact.ts';
import { withNativeTestWorkspace } from './native-test-workspace.ts';
import { runRepositorySourceInputOperation } from './repository-mutation-fence.ts';
import { compileRepositoryObservationOperation } from './repository-observation.ts';

const REQUIREMENT = 'development.runner.native-tests';
const STDOUT_BYTES = 16 * 1024 * 1024;
const STDERR_BYTES = 4 * 1024 * 1024;

type NativePendingResources = Readonly<{
  sourceInputs: RetainedWorkingSourceInputGeneration;
  dependencyGeneration: RetainedCompilerDependencyReadGeneration;
  derivedOutput: RepositoryDerivedOutput | undefined;
  compilerTools: RetainedRustupCompilerTools | undefined;
  cargoConfiguration: RetainedCargoPreparationConfiguration | undefined;
  cargoInputs: RetainedCargoRegistryInputs | undefined;
  cargoSources: RetainedCargoExtractedSources | undefined;
  lockFile: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
  bun: ReturnType<typeof retainCurrentProcessExecutable> | undefined;
  cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  artifact: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
  session: ProcessResourceSession | undefined;
}>;
// The original failed attempt retains actual capabilities, not a serialized
// path/PID recovery claim. Their protection lasts only in this live process.
const pendingNativeResources = new WeakMap<object, NativePendingResources>();

export function nativeTestExecutionRetainsDependency(
  failure: unknown, generation: RetainedCompilerDependencyReadGeneration
): boolean {
  return typeof failure === 'object' && failure !== null
    && pendingNativeResources.get(failure)?.dependencyGeneration === generation;
}

async function retainNativeExecutionInputs(
  projection: IssuedTestImpactProjection, deadlineAtUnixMs: number, signal?: AbortSignal
): Promise<RetainedWorkingSourceInputGeneration> {
  const operation = compileAffectedTestSelectionSemanticOperation({ purpose: 'budget-projection', deadlineAtUnixMs });
  const resolution = createAuthorityGitReadSession({
    cwd: compilerRoot, operation, budget: GIT_READ_OPERATION_BUDGET, deadlineAtUnixMs
  });
  if (resolution.status !== 'ready') {
    throw new CodedFailure('NATIVE-TEST-SOURCE', `Native input retention is unavailable: ${resolution.kind}`);
  }
  let sourceInputs: RetainedWorkingSourceInputGeneration | undefined;
  let failure: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    sourceInputs = await retainTestImpactExecutionInputs({ projection, session: resolution.session, deadlineAtUnixMs, signal });
  } catch (error) {
    failure = { label: 'native source input retention', error };
  }
  try {
    await settleResourcesAsync({ primary: failure,
      cleanup: [{ label: 'native input Git session', settle: async () => { await resolution.session.close?.(); } }] });
  } catch (error) {
    await settleResourcesAsync({ primary: { label: 'native input admission', error },
      cleanup: [{ label: 'native input partial admission', settle: () => { sourceInputs?.retire(); } }] });
    throw error;
  }
  return sourceInputs!;
}

export type NativeTestExecutionInput = Readonly<{
  projection: IssuedTestImpactProjection;
  methods: readonly AuthorNativeMethodUnit[];
  dependencyGeneration: RetainedCompilerDependencyReadGeneration;
  reobserve: (deadlineAtUnixMs: number) => Promise<boolean>;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}>;

/** Local working-source execution only. Formal native environment qualification
 * belongs to the Action environment owner and is not issued here. */
export async function runNativeTests(input: NativeTestExecutionInput): Promise<number> {
  if (input.methods.length === 0) return 0;
  assertIssuedTestImpactProjection(input.projection);
  assertRetainedCompilerDependencyReadGeneration(input.dependencyGeneration);
  if (input.projection.subject.kind !== 'physical-repository'
      || input.projection.subject.provenance.kind !== 'working-tree-observation') {
    throw new CodedFailure('NATIVE-TEST-SOURCE', 'Native execution requires an issued working-tree source projection');
  }
  const selected = new Map(input.methods.map(method => [method.id, method]));
  for (const method of input.methods) {
    const original = input.projection.nativeMethods.find(candidate => candidate.id === method.id);
    if (original === undefined || original.inputClosureDigest !== method.inputClosureDigest
        || original.unresolvedInputs.length !== 0) {
      throw new CodedFailure('NATIVE-TEST-SOURCE', 'Selected native method does not match a complete issued source closure');
    }
  }
  const methods = AUTHOR_NATIVE_METHOD_IDS.filter(id => selected.has(id));
  const needsBinary = methods.some(id => id !== 'cargo-tests');
  const hasCargoTests = selected.has('cargo-tests');
  // Fetch is one managed preparation root. Its rustc probes are contained
  // descendants, just as compiler/build-script descendants are during build.
  const rootCommands = 1 + methods.length + (needsBinary && !hasCargoTests ? 1 : 0);
  const deadlineAtUnixMs = Date.now() + DEV_COMMAND_MAX_DURATION_MS;
  const observerOperation = compileRepositoryObservationOperation();
  let executionTreesClosed = true;
  const sourceInputs = await observeExecutionProgressPhase('test:native', 'source-retention', () =>
    retainNativeExecutionInputs(input.projection, deadlineAtUnixMs, input.signal));
  let pending: NativePendingResources | undefined;
  let result = 1;
  let primary: Readonly<{ label: string; error: unknown }> | undefined;
  try {
    result = await withNativeTestWorkspace(compilerRoot, (work, derivedOutput) => runRepositorySourceInputOperation(
    'test:native', async () => {
      // Diagnostic identity only; recovery still requires the original owner.
      reportDevExecutionProgress({ command: 'test:native', phase: 'workspace', state: 'complete',
        detail: { root: derivedOutput.root } });
      if (!await observeExecutionProgressPhase('test:native', 'source-reobserve', () => input.reobserve(deadlineAtUnixMs))) {
        throw new CodedFailure('NATIVE-TEST-SOURCE', 'Native source changed before execution');
      }
      const targetDirectory = path.join(work, 'cargo-target');
      let environment: NodeJS.ProcessEnv = composeCargoProcessEnvironment(process.env, input.environment ?? {}, {
        CARGO_TARGET_DIR: targetDirectory,
        CARGO_NET_OFFLINE: 'true',
        RUSTUP_AUTO_INSTALL: '0'
      });
      let compilerTools: RetainedRustupCompilerTools | undefined;
      let cargoConfiguration: RetainedCargoPreparationConfiguration | undefined;
      let cargoInputs: RetainedCargoRegistryInputs | undefined;
      let cargoSources: RetainedCargoExtractedSources | undefined;
      let lockFile: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
      let bun: ReturnType<typeof retainCurrentProcessExecutable> | undefined;
      let cwd: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
      let artifact: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
      let session: ProcessResourceSession | undefined;
      let failure: Readonly<{ error: unknown }> | undefined;
      let exitCode = 1;
      const records: {
        run: ProcessResourceRunResult;
        boundary: ReturnType<typeof issueRetainedCommandBoundary>;
        args: readonly string[];
      }[] = [];
      try {
        cargoConfiguration = await observeExecutionProgressPhase('test:native', 'cargo-configuration', () => retainCargoPreparationConfiguration({
          repositoryRoot: compilerRoot, environment, deadlineAtUnixMs, signal: input.signal
        }));
        // The installed rustup profile resolves actual compiler executables in
        // its own bounded preparation operation. Its roots are not reported as
        // native-method ledger entries or as full sysroot/config qualification.
        try {
          compilerTools = await observeExecutionProgressPhase('test:native', 'compiler-tools', () => retainRustupCompilerTools({
            repositoryRoot: compilerRoot, environment, deadlineAtUnixMs, signal: input.signal
          }));
        } catch (error) {
          if (rustupCompilerToolFailureHasPendingResources(error)) executionTreesClosed = false;
          throw error;
        }
        const cargo = compilerTools.cargo;
        const crateRoot = inspectNoFollowDirectoryChain(path.join(compilerRoot, AUTHOR_KERNEL_ROOT),
          'Native locked crate');
        lockFile = retainNoFollowOrdinaryFile(crateRoot, 'Cargo.lock', undefined, 'Native retained Cargo lock');
        const assertPreparationCurrent = () => {
          sourceInputs.assertCurrent();
          cargoConfiguration!.assertCurrent();
          compilerTools!.assertCurrent();
          lockFile!.assertCurrent();
        };
        cargoInputs = await observeExecutionProgressPhase('test:native', 'cargo-registry', () => prepareCargoRegistryInputs({
          sourceCargoHome: cargoConfiguration!.sourceCargoHome,
          lockFile: lockFile!, outputRoot: derivedOutput.root, deadlineAtUnixMs, signal: input.signal,
          assertCurrent: assertPreparationCurrent
        }));
        environment = composeCargoProcessEnvironment(environment, {
          CARGO_HOME: cargoInputs.cargoHome.path, RUSTC: compilerTools.rustc.path });
        if (needsBinary) bun = retainCurrentProcessExecutable(RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'Native oracle Bun executable');
        const workspace = inspectNoFollowDirectoryChain(compilerRoot, 'Native verification workspace');
        cwd = retainNoFollowDirectoryForChildProcess(workspace, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR);
        const cargoBoundary = issueRetainedCommandBoundary({ executable: cargo, workingDirectory: cwd });
        const bunBoundary = bun === undefined ? undefined : issueRetainedCommandBoundary({ executable: bun, workingDirectory: cwd });
        const providerIdentityDigest = sha256({
          domain: 'development.native-test.local-provider-v1',
          compilerTools: compilerTools.identityDigest,
          cargoConfiguration: cargoConfiguration.identityDigest,
          cargoInputs: cargoInputs.identityDigest,
          bun: bun === undefined ? null : { path: bun.path, physical: bun.physical, digest: bun.digest() },
          workspace: workspace.target
        }) as OperationDigest;
        // This is the original managed-root/helper accounting domain. Cargo and
        // CLI internals are contained descendants, not individually metered roots.
        const contractDigest = sha256({
          domain: 'development.native-test.managed-process-contract-v1',
          durationMs: DEV_COMMAND_MAX_DURATION_MS,
          rootCommands, nativeResources: rootCommands * 2,
          stdoutBytes: STDOUT_BYTES, stderrBytes: STDERR_BYTES
        }) as OperationDigest;
        const plan = compileSemanticOperationPlan({
          operation: 'verification.native-tests',
          intentDigest: sha256({
            projectionDigest: input.projection.projectionDigest,
            methods: methods.map(id => ({ id, inputClosureDigest: selected.get(id)!.inputClosureDigest })),
            environment, targetDirectory
          }) as OperationDigest,
          decisionDigest: contractDigest,
          deadlineAtUnixMs,
          attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
          aggregateBudgets: [
            { resource: 'duration-ms', maximum: DEV_COMMAND_MAX_DURATION_MS },
            { resource: 'input-bytes', maximum: 1 },
            { resource: 'output-bytes', maximum: rootCommands * (STDOUT_BYTES + STDERR_BYTES) },
            { resource: 'processes', maximum: rootCommands * 2 }
          ],
          requirements: [{
            id: REQUIREMENT, contractDigest, effectKinds: ['process'],
            failureKinds: ['process.cancelled', 'process.deadline-exhausted', 'process.identity-drift',
              'process.output-budget-exhausted', 'process.settlement-unproven', 'process.unavailable']
          }]
        });
        const operation = bindSemanticOperation(plan, [compileCapabilityBinding({
          requirementId: REQUIREMENT, contractDigest, providerIdentityDigest
        })]);
        session = openProcessResourceSession({
          operation,
          requirementBindingContext: issueOperationRequirementBindingContext({
            operation, requirementId: REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets
          }),
          signal: input.signal
        });
        const run = async (role: 'fetch' | 'build' | typeof methods[number],
          boundary: ReturnType<typeof issueRetainedCommandBoundary>, args: readonly string[]) => {
          const beforeProcessCount = session!.processCount;
          executionTreesClosed = false;
          let result: ProcessResourceRunResult;
          try {
            result = await observeExecutionProgressPhase('test:native', `${role}.transport`, () => session!.run(boundary, args, {
              env: environment, envMode: 'replace', maxStdoutBytes: STDOUT_BYTES, maxStderrBytes: STDERR_BYTES,
              beforeSpawn: async () => {
                await observeExecutionProgressPhase('test:native', `${role}.dependency-preflight`, () =>
                  input.dependencyGeneration.assertAuthorityCurrent());
                // Registry assertion includes the original preparation fence:
                // source, configuration, selected tools and the retained lock.
                await observeExecutionProgressPhase('test:native', `${role}.cargo-preflight`, async () => {
                  if (cargoSources === undefined) cargoInputs!.assertCurrent();
                  else await cargoSources.assertCurrent();
                });
                artifact?.assertCurrent();
              }
            }));
            // The original retained transport only returns after tree closure;
            // its thrown outcome is separate from the ledger's settlement.
            executionTreesClosed = true;
          } catch (error) {
            executionTreesClosed = session!.processCount === beforeProcessCount
              || error instanceof RetainedCommandTransportError && error.outcome.termination.treeClosed;
            observeOptionalDiagnostic(() => {
              if (!(error instanceof RetainedCommandTransportError)) return;
              const captured = error.readCapturedOutput();
              if (captured === null) return;
              const stream = (value: typeof captured.stdout) => ({
                bytes: value.bytes.byteLength, capturedDigest: value.capturedDigest, completeness: value.completeness,
                tail: new TextDecoder('utf-8').decode(value.bytes.subarray(Math.max(0, value.bytes.byteLength - 8192)))
              });
              reportDevExecutionProgress({ command: 'test:native', phase: `${role}.failure-output`, state: 'failed',
                detail: { stdout: stream(captured.stdout), stderr: stream(captured.stderr) } });
            });
            throw error;
          }
          records.push({ run: result, boundary, args });
          observeOptionalDiagnostic(() => {
            if (result.result.stderr.length > 0) process.stderr.write(result.result.stderr);
          });
          if (result.result.code !== 0) {
            throw new CodedFailure('NATIVE-TEST-FAILED',
              `${args[0]} exited ${result.result.code}: ${result.result.stderr.slice(-8192)}`);
          }
          // This local re-observation does not establish continuous absence of
          // external ancestor configs or issue formal environment qualification.
          await observeExecutionProgressPhase('test:native', `${role}.postflight`, async () => {
            if (cargoSources === undefined) cargoInputs!.assertCurrent();
            else await cargoSources.assertCurrent();
          });
          return result.result;
        };
        const manifestPath = path.join(compilerRoot, AUTHOR_KERNEL_ROOT, 'Cargo.toml');
        await run('fetch', cargoBoundary, ['fetch', '--manifest-path', manifestPath, '--locked', '--offline',
          ...cargoConfiguration.configArguments]);
        // run returned only after the fetch tree closed. Pin the actual private
        // unpacked tree before a compiler or build script can consume it.
        cargoSources = await observeExecutionProgressPhase('test:native', 'cargo-source-protection', () => retainCargoExtractedSources({
          registryInputs: cargoInputs!, deadlineAtUnixMs, signal: input.signal
        }));
        const cargoOptions = ['--manifest-path', manifestPath, '--frozen', '--target-dir', targetDirectory,
          '--jobs', '1', ...cargoConfiguration.configArguments];
        const expectedBinary = { manifestPath, targetName: 'gift-author-kernel', targetDirectory };
        let executable: string | undefined;
        if (hasCargoTests) {
          const result = await run('cargo-tests', cargoBoundary, ['test', ...cargoOptions, '--lib', '--tests',
            ...(needsBinary ? ['--message-format=json'] : [])]);
          if (needsBinary) {
            // Integration tests cause Cargo to build the ordinary binary. Only
            // its validated Cargo prefix selects it; libtest's tail is output.
            const parsed = parseNativeCargoTestBinaryArtifact(result.stdout, expectedBinary);
            executable = parsed.executable;
            console.log(new TextDecoder('utf-8').decode(parsed.testOutput));
          } else console.log(new TextDecoder('utf-8').decode(result.stdout));
        }
        if (needsBinary && !hasCargoTests) {
          const result = await run('build', cargoBoundary, ['build', ...cargoOptions, '--bin', 'gift-author-kernel', '--message-format=json']);
          executable = parseNativeCargoBinaryArtifact(result.stdout, expectedBinary);
        }
        if (needsBinary) {
          if (executable === undefined) throw new CodedFailure('NATIVE-TEST-ARTIFACT', 'Native oracle has no selected ordinary kernel binary');
          artifact = retainNoFollowOrdinaryFile(
            inspectNoFollowDirectoryChain(path.dirname(executable), 'Native built artifact parent'),
            path.basename(executable), undefined, 'Native built kernel', RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'executable'
          );
          const artifactDigest = artifact.digest().byteDigest;
          const kernel = posixPath(path.relative(compilerRoot, executable));
          const parent = posixPath(path.relative(compilerRoot, work));
          for (const method of methods) {
            if (method === 'cargo-tests') continue;
            const script = method === 'reader-check' ? AUTHOR_KERNEL_READER_CHECK : AUTHOR_KERNEL_TARGET_CHECK;
            const oracle = await run(method, bunBoundary!, ['--no-env-file', '--no-install', script, kernel, parent]);
            artifact.assertCurrent();
            if (artifact.digest().byteDigest !== artifactDigest) throw new CodedFailure('NATIVE-TEST-ARTIFACT', 'Built kernel changed during native verification');
            console.log(new TextDecoder('utf-8', { fatal: true }).decode(oracle.stdout));
          }
        }
        exitCode = 0;
      } catch (error) {
        failure = { error };
      }
      if (!executionTreesClosed) {
        pending = Object.freeze({ sourceInputs, dependencyGeneration: input.dependencyGeneration,
          derivedOutput, compilerTools, cargoConfiguration, cargoInputs, cargoSources, lockFile, bun, cwd, artifact, session });
      }
      await settleResourcesAsync({
        ...(failure === undefined ? {} : { primary: { label: 'native verification', error: failure.error } }),
        cleanup: [
          { label: 'native process terminal settlement', settle: () => {
            if (session === undefined) return;
            const receipt = session.close();
            assertProcessResourceSessionReceipt(receipt, session);
            for (const record of records) assertProcessResourceRunResult(record.run, receipt, {
              ...session, boundary: record.boundary, args: record.args, env: environment, envMode: 'replace'
            });
          } },
          ...(executionTreesClosed ? [
            { label: 'native artifact release', settle: () => { artifact?.dispose(); } },
            { label: 'native working directory release', settle: () => { cwd?.dispose(); } },
            { label: 'native Bun release', settle: () => { bun?.dispose(); } },
            { label: 'native Cargo extracted sources release', settle: async () => {
              await observeExecutionProgressPhase('test:native', 'cargo-source-retirement', async () => { await cargoSources?.retire(); });
            } },
            { label: 'native compiler tools release', settle: () => { compilerTools?.retire(); } },
            { label: 'native Cargo registry inputs release', settle: () => { cargoInputs?.retire(); } },
            { label: 'native Cargo configuration release', settle: () => { cargoConfiguration?.retire(); } },
            { label: 'native Cargo lock release', settle: () => { lockFile?.dispose(); } }
          ] : [])
        ]
      });
      return exitCode;
    }, {
      operation: observerOperation, repositoryRoot: compilerRoot, observerDeadlineAtUnixMs: deadlineAtUnixMs,
      retainProcessSession: false, derivedOutput, sourceInputs
    }
    ), undefined, { retirementAllowed: () => executionTreesClosed });
  } catch (error) {
    primary = { label: 'native protected execution', error };
  }
  if (pending !== undefined) {
    const failure = new CodedFailure('NATIVE-TEST-SETTLEMENT-PENDING',
      'Native process termination is unknown; this attempt retains its input, dependency, tool and output capabilities',
      { repositoryRoot: sourceInputs.repositoryRoot, inputIdentityDigest: sourceInputs.inputIdentityDigest,
        outputPath: pending.derivedOutput?.path, protectionLifetime: 'current-process', terminalRecovery: 'unavailable' },
      { cause: primary?.error });
    pendingNativeResources.set(failure, pending);
    throw failure;
  }
  await settleResourcesAsync({ primary, cleanup: [{ label: 'native source input retirement', settle: () => {
    sourceInputs.retire();
  } }] });
  return result;
}
