/** Directory-tree physical provider surface. Observation owns immutable inventory facts; copy owns materialization effects. */
export {
  copyNoFollowDirectoryTreesBulk,
  linuxRetainBulkDirectoryChain,
  windowsRetainBulkDirectoryChain,
  windowsRetainObservedDirectoryChain
} from './physical-directory-tree-copy.ts';
export type {
  LinuxBulkDirectoryChain, LinuxBulkDirectoryHandle, WindowsBulkDirectoryChain
} from './physical-directory-tree-copy.ts';
export {
  directoryTreeEntryPosixOwnership,
  scanNoFollowDirectoryDirectMetadata, scanNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  scanNoFollowDirectoryTreeMetadata,
  scanNoFollowDirectoryTreeSelectedForest, scanNoFollowVolatileDirectoryDirectMetadata
} from './physical-directory-tree-observation.ts';
