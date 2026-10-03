import type { BoundSemanticOperation } from '../operation/semantic.ts';
export const ENVIRONMENT_SETTLEMENT_SCHEMA = 'sec-environment-settlement-v1' as const;
export const WORKSPACE_ENVIRONMENT_SETTLEMENT_OPERATION = 'runtime-state.workspace-environment-settlement' as const;
export const WORKSPACE_GIT_STATUS_REQUIREMENT = 'runtime-state.workspace-git-status';
export const WORKSPACE_GIT_STATUS_DURATION_MS = 5_000;
export const WORKSPACE_GIT_STATUS_STDOUT_MAX_BYTES = 16 * 1024 * 1024;
export const WORKSPACE_GIT_STATUS_STDERR_MAX_BYTES = 512 * 1024;
export const WORKSPACE_GIT_STATUS_RECORD_MAXIMUM = 250_000;
type WorkspaceGitStatusFailureReason = string;
export type WorkspaceGitStatusObservation =
  | Readonly<{
      status: 'resolved';
      records: readonly string[];
      recordsDigest: string;
    }>
  | Readonly<{
      status: 'unresolved';
      reason: WorkspaceGitStatusFailureReason;
      detailDigest: string;
    }>;
export interface WorkspaceGitStatusBackend { observe(input: Readonly<{ workspaceRoot: string; operation: BoundSemanticOperation; deadlineAtUnixMs: number; signal?: AbortSignal }>): Promise<WorkspaceGitStatusObservation>; }
