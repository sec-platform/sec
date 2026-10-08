
export const GITHUB_HOST = 'github.com' as const;
export const GITHUB_API_BASE_URL = 'https://api.github.com' as const;

export interface GitHubWorkflowJobStepObservation {
  name: string;
  number: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GitHubWorkflowJobObservation {
  id: string;
  runId: string;
  runAttempt: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  headSha: string;
  startedAt: string | null;
  completedAt: string | null;
  steps: readonly GitHubWorkflowJobStepObservation[];
}
