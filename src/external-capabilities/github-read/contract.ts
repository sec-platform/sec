export const GITHUB_HOST = 'github.com' as const;
export const GITHUB_API_BASE_URL = 'https://api.github.com' as const;
export const GITHUB_GRAPHQL_URL = `${GITHUB_API_BASE_URL}/graphql` as const;

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
