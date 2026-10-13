import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertGitCandidateBundleCurrent, assertGitCandidateBundleReceipt, closeGitCandidateBundle, createGitCandidateBundle, type GitCandidateBundle } from '../../adapters/providers/git-bundle/runtime.ts';
import { assertLinuxVerificationUnitResult, bindLinuxVerificationUnitSession, closeLinuxVerificationUnitSession, executeLinuxVerificationUnit, LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST, LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, LINUX_VERIFICATION_UNIT_RESOURCE_CEILINGS, prepareLinuxVerificationUnitSession, type LinuxVerificationUnitSession } from '../../adapters/runtime-state/physical/runtime/linux-verification-unit.ts';
import { MainHealthHostRuntimePreparationError, prepareMainHealthHostRuntime, retireMainHealthHostRuntime, type MainHealthHostRuntime } from '../../adapters/runtime-state/physical/runtime/main-health-host-runtime.ts';
import { createExclusiveNoFollowDirectory, inspectNoFollowDirectoryChain, retainNoFollowOrdinaryFile, retireNoFollowDirectoryTree, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryIdentity } from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { createTrustedRuntimeNativeMainHealthInvocation } from '../../adapters/self-hosting/control/main-health/main-health-observation.ts';
import { assertCompilerDependencyReadGenerationRetirementReceipt, observeCompilerDependencyExecutionGenerationAuthority, retainCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../adapters/toolchain/dependencies/runtime.ts';
import { compilerRuntimeLayout } from '../../adapters/toolchain/runtime/layout.ts';
import { sha256 } from '../../contracts/canonical.ts';
import { failureMessage, getErrorCode, inspectFailureValue } from '../../contracts/failure-inspection.ts';
import { issueOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import { bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan, issueSemanticOperationAttemptContext, type OperationDigest } from '../../execution/operation/semantic.ts';
import { isResourceCompositeSettlementError, readResourceCompositeSettlementFailures, settleResourcesAsync } from '../../execution/resource-settlement.ts';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const MAIN_HEALTH_FAST_COMMAND = 'bun run test -- --scope fast';

/** A GitHub custom-shell file is closed data, never shell input or an argv source. */
export function assertMainHealthFastCommandBytes(bytes: Uint8Array): void {
  if (!Buffer.from(bytes).equals(Buffer.from(MAIN_HEALTH_FAST_COMMAND))
      && !Buffer.from(bytes).equals(Buffer.from(MAIN_HEALTH_FAST_COMMAND + '\n'))) {
    throw new Error('MainHealth custom shell only admits its fixed fast command.');
  }
}

async function run(): Promise<number> {
  if (process.argv.length !== 3 || process.platform !== 'linux' || process.arch !== 'x64'
      || process.cwd() !== SOURCE_ROOT || process.env.GITHUB_WORKSPACE !== SOURCE_ROOT
      || process.env.GITHUB_SHA !== process.env.SEC_MAIN_HEALTH_SHA
      || !/^[0-9a-f]{40}$/u.test(process.env.SEC_MAIN_HEALTH_SHA ?? '')) {
    throw new Error('MainHealth fixed entry requires its exact Linux source and request.');
  }
  const commandPath = path.resolve(process.argv[2]!);
  const command = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(path.dirname(commandPath)), path.basename(commandPath));
  try {
    if (command.size > 4096) throw new Error('MainHealth command file exceeds its closed bound.');
    assertMainHealthFastCommandBytes(command.readBytes());
    command.assertCurrent();
  } finally { command.dispose(); }
  // This deadline is inherited by both fixed preparation and native execution.
  // No phase obtains a renewed pool on success, failure or cleanup.
  const deadlineAtUnixMs = Date.now() + 25 * 60_000;
  const headSha = process.env.SEC_MAIN_HEALTH_SHA!;
  let runtime: MainHealthHostRuntime | undefined;
  let temporary: PhysicalDirectoryIdentity | undefined;
  let dependencies: RetainedCompilerDependencyReadGeneration | undefined;
  let bundle: GitCandidateBundle | undefined;
  let session: LinuxVerificationUnitSession | undefined;
  let terminal = false;
  let preparationUnsettled = false;
  let primary: { label: string; error: unknown } | undefined;
  let code = 1;
  let projection: Readonly<Record<string, unknown>> | undefined;
  let dependenciesRetired = false;
  let bundleRetired = false;
  let runtimeRetired = false;
  try {
    const authority = await observeCompilerDependencyExecutionGenerationAuthority({ installMode: 'prebound-only', deadlineAtUnixMs }, compilerRuntimeLayout.dependencyRoot);
    if (authority === null) throw new Error('MainHealth existing compiler dependency generation is unavailable.');
    dependencies = await retainCompilerDependencyReadGeneration(authority, { deadlineAtUnixMs });
    runtime = await prepareMainHealthHostRuntime({ sourceRoot: SOURCE_ROOT, expectedHeadSha: headSha, deadlineAtUnixMs });
    temporary = createExclusiveNoFollowDirectory(inspectNoFollowDirectoryChain('/tmp').target, 'sec-main-health-' + randomUUID().replaceAll('-', ''));
    const recovery = createExclusiveNoFollowDirectory(temporary, 'recovery');
    bundle = await createGitCandidateBundle({ sourceRoot: SOURCE_ROOT, temporaryRoot: temporary.path, baseSha: headSha, headSha, deadlineAtUnixMs });
    session = await prepareLinuxVerificationUnitSession({ recoveryRoot: recovery, runtime: runtime.runtime, mainHealthHostRuntime: runtime,
      bundle: { file: assertGitCandidateBundleCurrent(bundle), baseSha: headSha, headSha, baseTreeSha: runtime.source.treeSha,
        headTreeSha: runtime.source.treeSha, bundleDigest: bundle.bundleDigest },
      dependencies: { physicalGeneration: dependencies.physicalGeneration, generationDigest: dependencies.generationDigest }, deadlineAtUnixMs });
    const requirement = { id: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID, contractDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
      effectKinds: ['process', 'provider', 'filesystem', 'persistent-state'] as const,
      failureKinds: ['main-health.immutable-input', 'main-health.unit-settlement'] };
    const operation = bindSemanticOperation(compileSemanticOperationPlan({ operation: 'verification.main-health.fast',
      intentDigest: sha256({ source: runtime.source, inputDigest: session.inputDigest, command: MAIN_HEALTH_FAST_COMMAND }) as OperationDigest,
      decisionDigest: requirement.contractDigest, deadlineAtUnixMs, aggregateBudgets: LINUX_VERIFICATION_UNIT_RESOURCE_CEILINGS,
      requirements: [requirement], attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: requirement.contractDigest })
    }), [compileCapabilityBinding({ requirementId: requirement.id, contractDigest: requirement.contractDigest, providerIdentityDigest: session.providerIdentityDigest })]);
    bindLinuxVerificationUnitSession(session, { operation,
      requirementBindingContext: issueOperationRequirementBindingContext({ operation, requirementId: requirement.id, resourceCeilings: LINUX_VERIFICATION_UNIT_RESOURCE_CEILINGS }) });
    const result = await executeLinuxVerificationUnit(session, createTrustedRuntimeNativeMainHealthInvocation(MAIN_HEALTH_FAST_COMMAND));
    assertLinuxVerificationUnitResult(result, session);
    code = result.receipt.execution.exitCode;
    // GitHub command interpretation is disabled for arbitrary test output.
    // Raw bytes remain bound in the original receipt, not emitted as commands.
    projection = Object.freeze({ schema: 'sec-main-health-fast-result-v1', source: runtime.source,
      exitCode: code, unitReceiptDigest: result.receipt.receiptDigest,
      stdoutDigest: result.receipt.execution.stdoutDigest, stderrDigest: result.receipt.execution.stderrDigest,
      stdoutTailBase64: Buffer.from(result.stdout).subarray(-4096).toString('base64'),
      stderrTailBase64: Buffer.from(result.stderr).subarray(-4096).toString('base64') });
  } catch (error) {
    preparationUnsettled = error instanceof MainHealthHostRuntimePreparationError;
    primary = { label: 'MainHealth immutable fast entry', error };
  }
  await settleResourcesAsync({ primary, cleanup: [
    { label: 'MainHealth original native unit settlement', settle: () => {
      if (preparationUnsettled) throw new Error('MainHealth host preparation retains its original unresolved owner; preserve borrowed inputs.');
      if (session !== undefined) closeLinuxVerificationUnitSession(session);
      terminal = true;
    } },
    { label: 'MainHealth original dependency pin retirement', settle: async () => {
      if (terminal) { if (dependencies !== undefined) assertCompilerDependencyReadGenerationRetirementReceipt(await dependencies.retire(), dependencies.generationDigest); dependenciesRetired = true; }
    } },
    { label: 'MainHealth original bundle pin retirement', settle: () => {
      if (terminal) { if (bundle !== undefined) assertGitCandidateBundleReceipt(closeGitCandidateBundle(bundle), bundle); bundleRetired = true; }
    } },
    { label: 'MainHealth host runtime retirement', settle: () => {
      if (terminal) { if (runtime !== undefined) retireMainHealthHostRuntime(runtime); runtimeRetired = true; }
    } },
    { label: 'MainHealth owned temporary retirement', settle: () => {
      if (!terminal || !dependenciesRetired || !bundleRetired || !runtimeRetired) throw new Error('MainHealth original resources remain unresolved; preserve owned temporary root: ' + (temporary?.path ?? 'not-created'));
      if (temporary !== undefined) retireNoFollowDirectoryTree({ root: temporary, parent: inspectNoFollowDirectoryChain('/tmp').target,
        inventory: scanNoFollowDirectoryTreeMetadata(temporary, { deadlineAtMs: performance.now() + Math.max(1, deadlineAtUnixMs - Date.now()), maximumEntries: 200_000, includePermissionMode: true }),
        restoreOwnerPermissions: true, deadlineAtMonotonicMs: performance.now() + Math.max(1, deadlineAtUnixMs - Date.now()) });
    } }
  ] });
  if (projection !== undefined) process.stdout.write(JSON.stringify(projection) + '\n');
  return code;
}

if (import.meta.main) {
  try { process.exitCode = await run(); }
  catch (error) {
    const failures = isResourceCompositeSettlementError(error)
      ? readResourceCompositeSettlementFailures(error) : [{ label: 'MainHealth immutable fast entry', error }];
    console.error(inspectFailureValue(failures.map(failure => ({
      label: failure.label, code: getErrorCode(failure.error), message: failureMessage(failure.error).slice(0, 2048)
    }))));
    process.exitCode = 1;
  }
}
