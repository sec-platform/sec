/** Effect admission callback evaluated immediately before a physical mutation. */
export type CommitFence = () => Promise<void>;
