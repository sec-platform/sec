// Transitional name bridge for the migrated Verification Action runner.
// Git process-isolation mechanics are owned exclusively by platform/shared.
export { isolatedGitChildEnvironment as createBranchLifecycleGitChildEnvironmentV1 } from '../../platform/shared/git-read-environment.ts';
