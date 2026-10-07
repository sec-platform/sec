export class GeneratedStateProducerBindingBlockedError extends Error {
  readonly code = 'GENERATED_STATE_PROVENANCE_BLOCKED' as const;
  constructor(message: string) { super(message); this.name = 'GeneratedStateProducerBindingBlockedError'; }
}
export class GeneratedStateWorktreeRetirementBlockedError extends Error {
  constructor(message: string) { super(message); this.name = 'GeneratedStateWorktreeRetirementBlockedError'; }
}
export function isGeneratedStateWorktreeRetirementBlocked(error: unknown): error is GeneratedStateWorktreeRetirementBlockedError {
  return error instanceof GeneratedStateWorktreeRetirementBlockedError;
}
