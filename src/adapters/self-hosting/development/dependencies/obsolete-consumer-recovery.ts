import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalEquals, canonicalJson, compareCodeUnits } from '../../../../contracts/canonical.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';
import { formatJsonFile } from '../../../../contracts/json-text.ts';
import { generatedStateDigest } from '../../../../execution/generated-state/contract.ts';
import { inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { observeWindowsKernelBootBoundary } from '../../../runtime-state/physical/runtime/windows-kernel-boot.ts';
import { isCanonicalLocalCompilerDependencyGeneration } from '../../../toolchain/dependencies/runtime/compiler-locator.ts';
import { generatedStatePhysicalIdentity, sameGeneratedStateIdentity } from '../../../toolchain/dependencies/runtime/dependency-transition/contract.ts';
import { sameHostPath } from '../../../toolchain/dependencies/runtime/host-path.ts';
import { runtimeDependencyOperationEffectFence } from '../../../toolchain/dependencies/runtime/operation-context.ts';
import {
  collectReleasedCompilerDependencyGenerations,
  compilerDependencyCoordinationSession,
  deleteNoFollowOwnedFile,
  dependencyAuthorityPaths,
  observeNoFollowOwnedFile,
  parseCompilerDependencyConsumerRecord,
  parseCompilerDependencyConsumerRecovery,
  readCompilerDependencyConsumerCensus,
  readCompilerDependencyRecoveryClaims,
  readNoFollowOwnedFileBytes,
  withCompilerDependencyCoordinationLease,
  type CompilerDependencyConsumerRecord,
  type CompilerDependencyConsumerRecovery
} from '../../../toolchain/dependencies/runtime/project-runtime.ts';

/**
 * Recover only explicitly selected obsolete generations. The first call binds
 * their original claims to this host's full-boot boundary without revoking any
 * borrower. A later full boot, native readback and the original coordination
 * lease are required before retiring claims; no normal release is fabricated.
 */
export async function recoverObsoleteCompilerDependencyConsumers(
  root: string,
  generationPaths?: readonly string[]
): Promise<Readonly<{
  state: 'requires-host-restart' | 'completed';
  acquisitions: number;
  generations: readonly string[];
  recoveryPath: string | null;
}>> {
  root = path.resolve(root);
  return withCompilerDependencyCoordinationLease(root, { lockTimeoutMs: 30_000 }, async options => {
    const session = compilerDependencyCoordinationSession(options);
    const owner = inspectNoFollowDirectoryChain(root, 'Compiler dependency recovery owner').target;
    const ownerPhysical = generatedStatePhysicalIdentity(owner);
    const name = `consumer-recovery-${generatedStateDigest(canonicalJson({ root, ownerPhysical })).slice('sha256:'.length)}.json`;
    const recoveryPath = path.join(session.root.path, name);
    const observation = observeNoFollowOwnedFile(recoveryPath, 'Compiler dependency recovery');
    const boot = observeWindowsKernelBootBoundary();
    let recovery: CompilerDependencyConsumerRecovery;
    if (observation === null) {
      if (generationPaths === undefined || generationPaths.length === 0) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery requires explicit obsolete generations');
      }
      const selected = [...new Set(generationPaths.map(candidate => path.resolve(candidate)))].sort(compareCodeUnits);
      const activePath = path.resolve(await fs.realpath(dependencyAuthorityPaths(root).compilerModulesRoot));
      const acquisitions: CompilerDependencyConsumerRecord[] = [];
      const census = readCompilerDependencyConsumerCensus(session.consumers, undefined, options);
      for (const generationPath of selected) {
        if (!isCanonicalLocalCompilerDependencyGeneration(root, generationPath) || sameHostPath(activePath, generationPath)) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery cannot select an active or foreign generation');
        }
        const generationRoot = inspectNoFollowDirectoryChain(generationPath, 'Compiler dependency recovery generation').target;
        const generationPhysical = generatedStatePhysicalIdentity(generationRoot);
        const claims = readCompilerDependencyRecoveryClaims(census, generationPath, generationPhysical);
        if (claims.length === 0) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery selection has no unresolved claims');
        }
        acquisitions.push(...claims);
      }
      acquisitions.sort((left, right) => compareCodeUnits(left.leaseId, right.leaseId));
      const unsigned = Object.freeze({
        schema: 'sec-compiler-dependency-consumer-recovery-v1' as const,
        ownerRoot: root, ownerPhysical, boot, acquisitions: Object.freeze(acquisitions)
      });
      recovery = Object.freeze({ ...unsigned, recoveryDigest: generatedStateDigest(canonicalJson(unsigned)) });
      await runtimeDependencyOperationEffectFence(options, 'Compiler dependency recovery preparation');
      publishExclusiveDurableCanonicalFile({
        parent: session.root, name,
        bytes: Buffer.from(formatJsonFile(canonicalJson(recovery))),
        validate: candidate => { parseCompilerDependencyConsumerRecovery(candidate); }
      });
      const readback = readNoFollowOrdinaryFile(session.root, name);
      if (readback === null || parseCompilerDependencyConsumerRecovery(readback).recoveryDigest !== recovery.recoveryDigest) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery preparation failed readback');
      }
    } else {
      recovery = parseCompilerDependencyConsumerRecovery(readNoFollowOwnedFileBytes(observation, 'Compiler dependency recovery'));
      if (!sameHostPath(recovery.ownerRoot, root) || !sameGeneratedStateIdentity(recovery.ownerPhysical, ownerPhysical)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery owner changed');
      }
    }
    const generations = Object.freeze([...new Set(recovery.acquisitions.map(record => record.generationPath))].sort(compareCodeUnits));
    if (generationPaths !== undefined && !canonicalEquals(
      [...new Set(generationPaths.map(candidate => path.resolve(candidate)))].sort(compareCodeUnits), generations
    )) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency pending recovery selection differs');
    }
    if (boot.sequence === recovery.boot.sequence && boot.fullBootEventRecordId === recovery.boot.fullBootEventRecordId) {
      return Object.freeze({ state: 'requires-host-restart', acquisitions: recovery.acquisitions.length, generations, recoveryPath });
    }
    if (boot.sequence <= recovery.boot.sequence || BigInt(boot.fullBootEventRecordId) <= BigInt(recovery.boot.fullBootEventRecordId)) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery has no later native full-boot boundary');
    }
    const activePath = path.resolve(await fs.realpath(dependencyAuthorityPaths(root).compilerModulesRoot));
    const retained = new Set(recovery.acquisitions.map(record => record.recordDigest));
    // One validated snapshot under the original coordination lease covers all
    // generations and epochs. No consumer record is mutated until this entire
    // negative census and every physical preimage have been checked.
    const census = readCompilerDependencyConsumerCensus(session.consumers, undefined, options);
    // Complete the negative census before any mutation. A new-boot borrower is
    // outside the prepared claim set and keeps the entire generation protected.
    for (const generationPath of generations) {
      const acquired = recovery.acquisitions.find(record => sameHostPath(record.generationPath, generationPath))!;
      if (sameHostPath(activePath, acquired.generationPath)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery generation became active');
      }
      const claims = readCompilerDependencyRecoveryClaims(census, acquired.generationPath, acquired.generationPhysical);
      if (claims.some(record => !retained.has(record.recordDigest))) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery generation has a new borrower');
      }
      const presence = inspectExactNoFollowDirectoryPresence(acquired.generationPath, 'Compiler dependency recovery generation');
      if (presence.state !== 'absent' && !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(presence.directory.target), acquired.generationPhysical)) {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery physical generation changed');
      }
    }
    for (const acquired of recovery.acquisitions) {
      for (const phase of ['released', 'acquired'] as const) {
        const recordName = `consumer-${acquired.leaseId.slice('sha256:'.length)}-${phase}.json`;
        const recordPath = path.join(session.consumers.path, recordName);
        const recordObservation = observeNoFollowOwnedFile(recordPath, 'Compiler dependency recovery original claim');
        if (recordObservation === null) continue;
        const record = parseCompilerDependencyConsumerRecord(readNoFollowOwnedFileBytes(recordObservation, 'Compiler dependency recovery original claim'), recordName);
        if ((phase === 'acquired' ? record.recordDigest : record.previousRecordDigest) !== acquired.recordDigest ||
            record.generationDigest !== acquired.generationDigest || !sameHostPath(record.generationPath, acquired.generationPath) ||
            !sameGeneratedStateIdentity(record.generationPhysical, acquired.generationPhysical)) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery claim is foreign and preserved');
        }
        await runtimeDependencyOperationEffectFence(options, 'Compiler dependency old-boot claim retirement');
        deleteNoFollowOwnedFile(recordPath, recordObservation, 'Compiler dependency old-boot claim');
      }
    }
    await collectReleasedCompilerDependencyGenerations(root, options, recovery.acquisitions);
    for (const generationPath of generations) {
      if (inspectExactNoFollowDirectoryPresence(generationPath, 'Compiler dependency recovered generation').state !== 'absent') {
        throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency recovery left physical residue');
      }
    }
    const finalObservation = observeNoFollowOwnedFile(recoveryPath, 'Compiler dependency completed recovery');
    if (finalObservation === null || parseCompilerDependencyConsumerRecovery(
      readNoFollowOwnedFileBytes(finalObservation, 'Compiler dependency completed recovery')
    ).recoveryDigest !== recovery.recoveryDigest) {
      throw new CodedFailure('RUNTIME-DEPS-004', 'Compiler dependency completed recovery binding changed');
    }
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency completed recovery retirement');
    deleteNoFollowOwnedFile(recoveryPath, finalObservation, 'Compiler dependency completed recovery');
    return Object.freeze({ state: 'completed', acquisitions: recovery.acquisitions.length, generations, recoveryPath: null });
  });
}
