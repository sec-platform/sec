/** 工作区快照的兼容公开面；内容、快照权威与 TypeScript 项目解释各归其拥有者。 */
export {
  type WorkspaceSourceSnapshotSubject,
  type CompileVirtualSnapshotInput,
  type AcquireWorkingTreeSnapshotInput,
  type AcquireStagedIndexSnapshotInput,
  type StagedSourceSelection,
  type AcquireExactGitTreeSnapshotInput,
  type WorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot,
  type VirtualWorkspaceSourceSnapshot,
  assertWorkspaceSourceSnapshot,
  assertPhysicalWorkspaceSourceSnapshot,
  compileVirtualSnapshot,
  acquireWorkingTreeSnapshot,
  acquireStagedIndexSnapshot,
  readBackStagedIndexSnapshot,
  selectStagedSnapshot,
  requireStagedSourceSelection,
  acquireExactGitTreeSnapshot
} from './workspace-source-authority.ts';
export {
  type TypeScriptProjectInput,
  type TypeScriptProjectFactIdentity,
  projectTypeScriptProjectFactIdentity,
  compileTypeScriptProjectFactIdentity,
  type TypeScriptProjectGenerationEvidence,
  assertTypeScriptProjectGenerationEvidence,
  assertTypeScriptProjectInput,
  assertTypeScriptProjectMatchesSnapshot,
  compileTypeScriptProjectInput,
  issueTypeScriptProjectGenerationEvidence
} from './workspace-typescript-project.ts';
export {
  type WorkspaceSourceFileMode,
  type WorkspaceSourceFile,
  compileWorkspaceSourceRevision
} from './workspace-source-content.ts';
