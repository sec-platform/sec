import path from 'node:path';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

const MAX_NATIVE_EVENT_BYTES = 256 * 1024;

/** Read data for the existing issuer; this helper cannot issue a maintenance grant. */
export async function readMaintenanceNativeEvent(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  advertisedEventPath: string | undefined;
}>): Promise<Uint8Array> {
  const { repositoryRoot, repository, advertisedEventPath } = input;
  const repositoryName = repository.split('/')[1];
  // This workflow uses the runner's default host checkout, <work>/<repo>/<repo>.
  // Runner TrackingConfig, HostContext.Temp and ExecutionContext.WriteWebhookPayload
  // define the sibling <work>/_temp/_github_workflow/event.json. The work prefix is
  // taken from this operation's physical repository, never RUNNER_TEMP or event input.
  if (process.platform !== 'linux' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)
      || repositoryName === '.' || repositoryName === '..'
      || !path.isAbsolute(repositoryRoot) || path.resolve(repositoryRoot) !== repositoryRoot
      || repositoryRoot.includes('\0') || path.basename(repositoryRoot) !== repositoryName
      || path.basename(path.dirname(repositoryRoot)) !== repositoryName) {
    throw new Error('Maintenance native event requires the default host checkout scope');
  }
  const eventDirectoryPath = path.join(path.dirname(path.dirname(repositoryRoot)), '_temp', '_github_workflow');
  if (advertisedEventPath !== path.join(eventDirectoryPath, 'event.json')) {
    throw new Error('Maintenance native event locator differs from the operation workspace');
  }
  const repositoryChain = inspectNoFollowDirectoryChain(repositoryRoot, 'Maintenance repository');
  const eventDirectory = inspectNoFollowDirectoryChain(eventDirectoryPath, 'Maintenance native event directory');
  return await withAcquiredResource({
    operationLabel: 'maintenance-native-event', resourceLabel: 'maintenance-native-event-file',
    acquire: () => retainNoFollowOrdinaryFile(eventDirectory, 'event.json', undefined, 'Maintenance native event'),
    use(file) {
      if (file.linkCount !== 1 || file.size < 1 || file.size > MAX_NATIVE_EVENT_BYTES) {
        throw new Error('Maintenance native event is aliased, empty or exceeds its byte bound');
      }
      file.assertCurrent();
      // The original physical reader limits the initial size and every read chunk.
      // Both handles must describe the same ordinary leaf, including after the read.
      const observed = inspectNoFollowOrdinaryFileEntry(eventDirectory.target, 'event.json', {
        maximumBytes: MAX_NATIVE_EVENT_BYTES
      });
      file.assertCurrent();
      assertSameNoFollowDirectoryIdentity(repositoryChain.target, 'Maintenance repository readback');
      if (observed?.bytes === null || observed?.bytes === undefined
          || observed.device !== file.physical.device || observed.inode !== file.physical.inode
          || observed.size !== file.size) {
        throw new Error('Maintenance native event identity changed during bounded read');
      }
      return observed.bytes;
    },
    release: file => file.dispose()
  });
}
