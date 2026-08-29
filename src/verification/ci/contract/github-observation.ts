export interface GitHubCheckObservation {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  detailsUrl: string | null;
  appId: number | null;
  appNodeId: string | null;
  appSlug: string | null;
  workflowPath: string | null;
  workflowRef: string | null;
  eventName: string | null;
  workflowRunId: string | null;
  workflowRunDisplayTitle: string | null;
}

export interface GitHubWorkflowRunObservation {
  id: string;
  name: string;
  displayTitle: string;
  workflowPath: string;
  event: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  runAttempt: number;
  updatedAt: string;
}

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
