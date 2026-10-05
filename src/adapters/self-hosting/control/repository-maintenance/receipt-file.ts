import { fstatSync } from 'node:fs';

import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  replaceDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

/** The workflow creates this private directory exclusively with mode 0700.
 * Retain its physical identity for the whole journal lifecycle. The physical
 * owner creates each 0600 candidate exclusively, renames relative to retained
 * directory handles, flushes file and directory, and settles failed candidates.
 * This scope grants no GitHub or retirement authority. */
export async function withPrivateMaintenanceReceiptWriter<T>(
  root: string,
  operation: (persist: (value: unknown) => void) => Promise<T>
): Promise<T> {
  if (process.platform !== 'linux') throw new Error('hosted maintenance receipt requires Linux');
  const chain = inspectNoFollowDirectoryChain(root, 'maintenance receipt directory');
  return withAcquiredResource({
    operationLabel: 'maintenance receipt lifecycle',
    resourceLabel: 'maintenance receipt directory descriptor',
    acquire: () => retainNoFollowDirectoryForChildProcess(chain, 3, 'maintenance receipt directory'),
    use: async (directory) => {
      const assertPrivate = () => {
        directory.assertCurrent();
        const current = fstatSync(directory.stdioSourceDescriptor!);
        if (!current.isDirectory() || current.uid !== process.geteuid!() || (current.mode & 0o7777) !== 0o700) {
          throw new Error('maintenance receipt directory must be owned by the current user with mode 0700');
        }
      };
      assertPrivate();
      const result = await operation((value) => {
        assertPrivate();
        const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        replaceDurableCanonicalFile({
          parent: chain.target,
          name: 'maintenance-result.json',
          bytes,
          validate: (observed) => {
            assertPrivate();
            if (!Buffer.from(observed).equals(bytes)) throw new Error('maintenance receipt bytes changed');
          }
        });
        assertPrivate();
      });
      assertPrivate();
      return result;
    },
    release: (directory) => directory.dispose()
  });
}
