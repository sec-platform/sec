import path from 'node:path';

import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../../filesystem/write-lease.ts';
import {
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  recoverDurableCanonicalFileReplacement,
  replaceDurableCanonicalFile,
  retainNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { BranchCloseoutOperationStore } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';

/**
 * Advisory closeout recovery memory, serialized by the operation's actual
 * common-Git and repository leases. Physical owns the byte precondition and
 * durable replacement/recovery. Neither the leases nor these observations
 * promise atomic CAS against a non-cooperating filesystem writer.
 */
export function createBranchCloseoutOperationStore(input: Readonly<{
  repositoryRoot: string;
  commonGitDirectory: string;
  repositoryLease: WorkspaceWriteLeaseToken;
  commonGitLease: WorkspaceWriteLeaseToken;
  journalPath: string;
  receiptPath: string;
}>): BranchCloseoutOperationStore {
  const allowedPaths = new Set([path.resolve(input.journalPath), path.resolve(input.receiptPath)]);
  const admittedTarget = async (filePath: string) => {
    const target = path.resolve(filePath);
    if (!allowedPaths.has(target)) throw new Error('Closeout store path is outside this operation.');
    await assertWorkspaceWriteLease(input.commonGitDirectory, input.commonGitLease);
    await assertWorkspaceWriteLease(input.repositoryRoot, input.repositoryLease);
    const chain = inspectNoFollowDirectoryChain(path.dirname(target), 'Closeout store parent');
    const parent = chain.target;
    const name = path.basename(target);
    // Recovery can mutate transaction residue, so it shares the writer lease
    // and precedes every interpretation of a possibly absent canonical name.
    recoverDurableCanonicalFileReplacement({ parent, name });
    return { chain, parent, name };
  };
  const validate = (bytes: Uint8Array): void => { JSON.parse(Buffer.from(bytes).toString('utf8')); };
  return {
    read: async (filePath) => {
      const { chain, name } = await admittedTarget(filePath);
      let retained: ReturnType<typeof retainNoFollowOrdinaryFile>;
      try { retained = retainNoFollowOrdinaryFile(chain, name, undefined, 'Closeout store read'); }
      catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
        throw error;
      }
      try { return Buffer.from(retained.readBytes()).toString('utf8'); }
      finally { retained.dispose(); }
    },
    createExclusive: async (filePath, bytes) => {
      const { parent, name } = await admittedTarget(filePath);
      try {
        return publishExclusiveDurableCanonicalFile({ parent, name, bytes: Buffer.from(bytes, 'utf8'), validate }).created;
      } catch (error) {
        if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT') return false;
        throw error;
      }
    },
    replace: async (filePath, expectedBytes, nextBytes) => {
      const { chain, parent, name } = await admittedTarget(filePath);
      const retained = retainNoFollowOrdinaryFile(chain, name, undefined, 'Closeout store preimage');
      let expectedExisting: Readonly<{ device: string; inode: string }>;
      try { expectedExisting = retained.physical; }
      finally { retained.dispose(); }
      replaceDurableCanonicalFile({
        parent, name, bytes: Buffer.from(nextBytes, 'utf8'), validate,
        expectedExisting, expectedExistingBytes: Buffer.from(expectedBytes, 'utf8'),
        rejectExistingHardLinks: true
      });
    }
  };
}
