/** Closed, read-only GraphQL documents shared by collection and process admission. */
export const GITHUB_PRINCIPAL_NODE_QUERY = 'query($id:ID!){node(id:$id){... on User{id login}}}';
export const GITHUB_THREAD_COMMENTS_QUERY = 'query($threadId:ID!,$endCursor:String!){node(id:$threadId){... on PullRequestReviewThread{id comments(first:100,after:$endCursor){nodes{author{__typename ... on Node{id}}}pageInfo{hasNextPage endCursor}}}}}';
export const GITHUB_REVIEWS_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviews(first:100,after:$endCursor){nodes{id state submittedAt commit{oid} author{__typename login resourcePath ... on Node{id}} authorAssociation}pageInfo{hasNextPage endCursor}}}}}';
export const GITHUB_THREADS_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){nodes{id isResolved isOutdated path comments(first:100){nodes{author{__typename ... on Node{id}}}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}}}';
export const GITHUB_REVIEW_REQUESTS_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewRequests(first:100,after:$endCursor){nodes{requestedReviewer{... on User{id login}... on Team{id name}}}pageInfo{hasNextPage endCursor}}}}}';
export const GITHUB_PULL_REQUEST_CLOSING_QUERY = 'query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){number title body state mergeCommit{oid} closingIssuesReferences(first:100,after:$cursor){totalCount nodes{number repository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}}';

export const GITHUB_VERIFICATION_READ_QUERIES = Object.freeze([
  GITHUB_PRINCIPAL_NODE_QUERY,
  GITHUB_THREAD_COMMENTS_QUERY,
  GITHUB_REVIEWS_QUERY,
  GITHUB_THREADS_QUERY,
  GITHUB_REVIEW_REQUESTS_QUERY,
  GITHUB_PULL_REQUEST_CLOSING_QUERY,
]);

/** One schema-error classifier shared by the HTTP owner and legacy diagnostic projection. */
export function isGitHubGraphQLSchemaFailure(source: string): boolean {
  return [
    /Field '[^']+' doesn't exist on type '[^']+'/u,
    /Unknown field '[^']+' on type '[^']+'/u,
    /Cannot query field '[^']+' on type '[^']+'/u,
    /Unknown type '[^']+'/u,
    /Field '[^']+' of required type '[^']+' was not provided/u
  ].some(marker => marker.test(source.replaceAll('\r\n','\n')));
}
