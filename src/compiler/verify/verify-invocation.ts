import { throwIfNativeAborted } from '../../system-architecture/foundation/runtime/native-abort.ts';
import type { VerifyProjectOptions } from './verify-project.ts';

/** Only request/environment references are captured here. Proof, lease and
 * isolated-tree validity remain with their issuers. In particular a snapshot
 * never upgrades a staged proof or invents a physical execution boundary. */
export function captureVerifyProjectOptions(input: VerifyProjectOptions): Readonly<VerifyProjectOptions> {
  const { beforeCommit, emitTiming, isolated, logger, pipelineObserver, signal, stagedVerificationProof, stagingTreeOptions } = input;
  throwIfNativeAborted(signal);
  for (const [name, value] of [['emitTiming', emitTiming], ['isolated', isolated]] as const) {
    if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`Verification ${name} must be boolean`);
  }
  if (beforeCommit !== undefined && typeof beforeCommit !== 'function') throw new TypeError('Verification commit fence must be callable');
  let observer: VerifyProjectOptions['pipelineObserver'];
  if (pipelineObserver !== undefined) {
    if (pipelineObserver === null || typeof pipelineObserver !== 'object') throw new TypeError('Verification pipeline observer must be an object');
    const { onEvent, transactionId } = pipelineObserver;
    if (typeof onEvent !== 'function' || typeof transactionId !== 'string' || transactionId.length === 0) throw new TypeError('Verification observer needs a handler and transaction identity');
    observer = Object.freeze({ onEvent, transactionId });
  }
  let staging: VerifyProjectOptions['stagingTreeOptions'];
  if (stagingTreeOptions !== undefined) {
    if (stagingTreeOptions === null || typeof stagingTreeOptions !== 'object') throw new TypeError('Verification staging options must be an object');
    const { executionBoundary, workspaceWriteLease } = stagingTreeOptions;
    if (executionBoundary !== undefined && executionBoundary !== 'windows-appcontainer') throw new TypeError('Unknown verification staging execution boundary');
    staging = Object.freeze({ executionBoundary, workspaceWriteLease });
  }
  return Object.freeze({ emitTiming, isolated, logger, signal, stagedVerificationProof,
    pipelineObserver: observer, stagingTreeOptions: staging,
    beforeCommit: beforeCommit === undefined ? undefined : () => Reflect.apply(beforeCommit, input, []) });
}
