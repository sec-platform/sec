/** Recheck callback at an effect boundary. A callback value alone grants no authority. */
export type CommitFence = () => Promise<void>;
