/** Workspace Source Program public surface; owners remain split by responsibility. */
export {
  type WorkspaceSourceSnapshotSubject,
  type CompileVirtualSnapshotInput as CompileVirtualWorkspaceSourceSnapshotInput,
  type AcquireWorkingTreeSnapshotInput as AcquireWorkingTreeWorkspaceSourceSnapshotInput,
  type AcquireStagedIndexSnapshotInput as AcquireStagedIndexWorkspaceSourceSnapshotInput,
  type StagedSourceSelection as StagedWorkspaceSourceSelection,
  type AcquireExactGitTreeSnapshotInput as AcquireExactGitTreeWorkspaceSourceSnapshotInput,
  type AcquireExactGitTreeSnapshotFromSessionInput
    as AcquireExactGitTreeWorkspaceSourceSnapshotFromSessionInput,
  type WorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot,
  type VirtualWorkspaceSourceSnapshot,
  assertWorkspaceSourceSnapshot,
  assertPhysicalWorkspaceSourceSnapshot,
  compileVirtualSnapshot as compileVirtualWorkspaceSourceSnapshot,
  acquireWorkingTreeSnapshot as acquireWorkingTreeWorkspaceSourceSnapshot,
  acquireStagedIndexSnapshot as acquireStagedIndexWorkspaceSourceSnapshot,
  readBackStagedIndexSnapshot as readBackStagedIndexWorkspaceSourceSnapshot,
  selectStagedSnapshot as selectStagedWorkspaceSourceSnapshot,
  requireStagedSourceSelection as requireStagedWorkspaceSourceSelection,
  acquireExactGitTreeSnapshot as acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireExactGitTreeSnapshotFromSession as acquireExactGitTreeWorkspaceSourceSnapshotFromSession
} from './workspace-source-authority.ts';
export {
  type TypeScriptProjectInput as WorkspaceTypeScriptProjectInput,
  type TypeScriptProjectFactIdentity as WorkspaceTypeScriptProjectFactIdentity,
  projectTypeScriptProjectFactIdentity as projectWorkspaceTypeScriptProjectFactIdentity,
  compileTypeScriptProjectFactIdentity as compileWorkspaceTypeScriptProjectFactIdentity,
  type TypeScriptProjectGenerationEvidence as WorkspaceTypeScriptProjectGenerationEvidence,
  assertTypeScriptProjectGenerationEvidence as assertWorkspaceTypeScriptProjectGenerationEvidence,
  assertTypeScriptProjectInput as assertWorkspaceTypeScriptProjectInput,
  assertTypeScriptProjectMatchesSnapshot as assertWorkspaceTypeScriptProjectInputMatchesSnapshot,
  compileTypeScriptProjectInput as compileWorkspaceTypeScriptProjectInput,
  issueTypeScriptProjectGenerationEvidence as issueWorkspaceTypeScriptProjectGenerationEvidence
} from './workspace-typescript-project.ts';
export {
  type WorkspaceSourceFileMode,
  type WorkspaceSourceFile,
  compileWorkspaceSourceRevision
} from './workspace-source-content.ts';
