export const GITHUB_HOST = 'github.com' as const;
export const GITHUB_API_BASE_URL = 'https://api.github.com' as const;
export const GITHUB_PULL_REQUEST_CLOSING_QUERY =
  'query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){number title body state mergeCommit{oid} closingIssuesReferences(first:100,after:$cursor){totalCount nodes{number repository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}}' as const;
export const GITHUB_ISSUE_TERMINAL_EVENTS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){number timelineItems(last:100,itemTypes:[CLOSED_EVENT,REOPENED_EVENT]){nodes{__typename ... on ClosedEvent{id createdAt actor{login} closer{__typename ... on PullRequest{number repository{nameWithOwner} mergeCommit{oid}}}} ... on ReopenedEvent{id createdAt actor{login}}}}}}}' as const;
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
