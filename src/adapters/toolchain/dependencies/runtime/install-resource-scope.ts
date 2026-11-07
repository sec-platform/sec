import { CodedFailure } from '../../../../contracts/failure.ts';
import { isResourceCompositeSettlementError, readResourceCompositeSettlementFailures, settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
import type {
  RetainedNoFollowChildProcessDirectory,
  RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import { retainedCommandFailureTreeClosed } from '../../../runtime-state/physical/runtime/process.ts';

type InstallResource = 'executable' | 'working-directory' | 'process-session' | 'resource-scope';
export type CompilerInstallResourceFailure = Readonly<{ resource: InstallResource; reason: unknown }>;
type ReceiptExpectation = NonNullable<Parameters<typeof assertProcessResourceSessionReceipt>[1]>;

/** The installer adopts the exact handles returned by their physical owners.
 * It does not accept arbitrary release callbacks or an asynchronous cleanup
 * protocol. Actual close/dispose methods are synchronous. Process execution
 * goes through runProcess so unknown termination cannot release filesystem
 * recovery roots merely because the execution promise rejected.
 */
export interface CompilerInstallResources {
  executable(resource: RetainedNoFollowOrdinaryFile): RetainedNoFollowOrdinaryFile;
  workingDirectory(resource: RetainedNoFollowChildProcessDirectory): RetainedNoFollowChildProcessDirectory;
  processSession(resource: ProcessResourceSession, expected: ReceiptExpectation): ProcessResourceSession;
  runProcess(resource: ProcessResourceSession,
    ...input: Parameters<ProcessResourceSession['run']>): ReturnType<ProcessResourceSession['run']>;
}

const unsettledCompilerInstallFailures = new WeakSet<object>();

/** Preservation only: this observation never authorizes recovery or cleanup. */
export function compilerInstallProcessSettlementUnproven(error: unknown): boolean {
  return error !== null && (typeof error === 'object' || typeof error === 'function')
    && unsettledCompilerInstallFailures.has(error);
}

/** Keep the existing installation error shape while the common physical owner
 * handles ordering and error collection. A failed release is not telemetry. */
export class CompilerInstallSettlementFailure extends CodedFailure {
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
  const sessions = new Map<ProcessResourceSession, ProcessResourceSession['run']>();
  const unsettledProcesses = new Set<ProcessResourceSession>();
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
      sessions.set(resource, resource.run);
      return resource;
    },
    async runProcess(resource: ProcessResourceSession,
      boundary: Parameters<ProcessResourceSession['run']>[0],
      args: Parameters<ProcessResourceSession['run']>[1],
      options: Parameters<ProcessResourceSession['run']>[2]): ReturnType<ProcessResourceSession['run']> {
      requireOpen();
      const run = sessions.get(resource);
      if (run === undefined) throw new Error('Compiler install process session was not adopted by this scope');
      if (unsettledProcesses.has(resource)) throw new Error('Compiler install process termination remains unproven');
      let spawnAdmitted = false;
      const beforeSpawn = options.beforeSpawn;
      try {
        const result = await Reflect.apply(run, resource, [boundary, args, {
          ...options,
          beforeSpawn: async () => {
            await beforeSpawn?.();
            spawnAdmitted = true;
            unsettledProcesses.add(resource);
          }
        }]) as Awaited<ReturnType<ProcessResourceSession['run']>>;
        unsettledProcesses.delete(resource);
        return result;
      } catch (error) {
        const treeClosed = retainedCommandFailureTreeClosed(error);
        if (treeClosed === true) unsettledProcesses.delete(resource);
        else if (treeClosed === false || spawnAdmitted) unsettledProcesses.add(resource);
        // Session argument/budget admission and the original spawn fence can
        // fail before any process is admitted. Do not strand their lock.
        throw error;
      }
    }
  });
  let primary: Readonly<{ reason: unknown }> | undefined;
  let result!: T;
  try { result = await execute(resources); }
  catch (reason) { primary = Object.freeze({ reason }); }
  closed = true;
  let settlementFailure: Readonly<{ reason: unknown }> | undefined;
  let compilerSettlementFailure: CompilerInstallSettlementFailure | undefined;
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
    if (primary !== undefined && Object.is(error, primary.reason)) settlementFailure = { reason: error };
    else if (!isResourceCompositeSettlementError(error)) {
      settlementFailure = { reason: error };
      if (unsettledProcesses.size !== 0) {
        compilerSettlementFailure = new CompilerInstallSettlementFailure(primary,
          [{ resource: 'resource-scope', reason: error }]);
      }
    }
    else {
      const failedReleases = readResourceCompositeSettlementFailures(error).slice(primary === undefined ? 0 : 1);
      compilerSettlementFailure = new CompilerInstallSettlementFailure(primary,
        failedReleases.map(({ label, error: reason }) => ({ resource: label as InstallResource, reason })));
      settlementFailure = { reason: compilerSettlementFailure };
    }
  }
  if (unsettledProcesses.size !== 0) {
    const failure = compilerSettlementFailure ?? new CompilerInstallSettlementFailure(primary, []);
    unsettledCompilerInstallFailures.add(failure);
    throw failure;
  }
  if (settlementFailure !== undefined) throw settlementFailure.reason;
  return result;
}
