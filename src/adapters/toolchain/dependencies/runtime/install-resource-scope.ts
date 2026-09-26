import { FailureError } from '../../../../contracts/failure.ts';
import { ResourceCompositeSettlementError as PhysicalResourceCompositeSettlementError, settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
import type {
  RetainedNoFollowChildProcessDirectory,
  RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';

type InstallResource = 'executable' | 'working-directory' | 'process-session';
export type CompilerInstallResourceFailure = Readonly<{ resource: InstallResource; reason: unknown }>;
type ReceiptExpectation = NonNullable<Parameters<typeof assertProcessResourceSessionReceipt>[1]>;

/** The installer adopts the exact handles returned by their physical owners.
 * It does not accept arbitrary release callbacks or an asynchronous cleanup
 * protocol. Actual close/dispose methods are synchronous; child execution must
 * settle before the execute callback returns. This is not an authority issuer.
 */
export interface CompilerInstallResources {
  executable(resource: RetainedNoFollowOrdinaryFile): RetainedNoFollowOrdinaryFile;
  workingDirectory(resource: RetainedNoFollowChildProcessDirectory): RetainedNoFollowChildProcessDirectory;
  processSession(resource: ProcessResourceSession, expected: ReceiptExpectation): ProcessResourceSession;
}

/** Keep the existing installation error shape while the common physical owner
 * handles ordering and error collection. A failed release is not telemetry. */
export class CompilerInstallSettlementFailure extends FailureError {
  readonly primaryFailed: boolean;
  readonly resourceFailures: readonly CompilerInstallResourceFailure[];

  constructor(primary: Readonly<{ reason: unknown }> | undefined, failures: readonly CompilerInstallResourceFailure[]) {
    const captured = Object.freeze(failures.map(({ resource, reason }) => Object.freeze({ resource, reason })));
    super('RUNTIME-DEPS-SETTLEMENT-001', 'Compiler dependency resource settlement did not complete',
      { primaryFailed: primary !== undefined, resources: captured.map(({ resource }) => resource) },
      primary === undefined ? undefined : { cause: primary.reason });
    this.name = 'CompilerInstallSettlementFailure';
    this.primaryFailed = primary !== undefined;
    this.resourceFailures = captured;
  }
}

export async function withCompilerInstallResources<T>(
  execute: (resources: CompilerInstallResources) => Promise<T>
): Promise<T> {
  const releases: Array<Readonly<{ label: InstallResource; settle(): void }>> = [];
  let closed = false;
  const requireOpen = () => {
    if (closed) throw new Error('Compiler install resource scope is closed');
  };
  const resources: CompilerInstallResources = Object.freeze({
    executable(resource: RetainedNoFollowOrdinaryFile) {
      requireOpen();
      const dispose = resource.dispose;
      releases.push({ label: 'executable', settle: () => { Reflect.apply(dispose, resource, []); } });
      return resource;
    },
    workingDirectory(resource: RetainedNoFollowChildProcessDirectory) {
      requireOpen();
      const dispose = resource.dispose;
      releases.push({ label: 'working-directory', settle: () => { Reflect.apply(dispose, resource, []); } });
      return resource;
    },
    processSession(resource: ProcessResourceSession, expected: ReceiptExpectation) {
      requireOpen();
      const close = resource.close;
      // Register before reading the expected projection, so even malformed
      // expectation data cannot strand a newly acquired native session.
      let expectation: ReceiptExpectation | undefined;
      releases.push({ label: 'process-session', settle() {
        const receipt: ProcessResourceSessionReceipt = Reflect.apply(close, resource, []);
        assertProcessResourceSessionReceipt(receipt, expectation);
      } });
      expectation = Object.freeze({ operationIdentityDigest: expected.operationIdentityDigest,
        boundAttemptDigest: expected.boundAttemptDigest, requirementId: expected.requirementId });
      return resource;
    }
  });
  let primary: Readonly<{ reason: unknown }> | undefined;
  let result!: T;
  try { result = await execute(resources); }
  catch (reason) { primary = Object.freeze({ reason }); }
  closed = true;
  try {
    // There is no await between native releases. Use the repository's existing
    // synchronous settlement owner, not a second reverse-await executor. A
    // synchronous OS operation can still fail or block; no hard-stop promise
    // or successful physical disposal is inferred from this scope alone.
    settlePhysicalResources({
      ...(primary === undefined ? {} : { primary: { label: 'compiler-install', error: primary.reason } }),
      cleanup: releases.reverse()
    });
  } catch (error) {
    if (primary !== undefined && Object.is(error, primary.reason)) throw error;
    if (!(error instanceof PhysicalResourceCompositeSettlementError)) throw error;
    const failedReleases = error.failures.slice(primary === undefined ? 0 : 1);
    throw new CompilerInstallSettlementFailure(primary, failedReleases.map(({ label, error: reason }) => ({
      resource: label as InstallResource, reason
    })));
  }
  return result;
}
