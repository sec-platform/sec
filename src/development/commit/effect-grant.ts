export const DEVELOPMENT_COMMIT_EFFECT_GRANT_DENIAL = Object.freeze({
  schema: 'sec-development-commit-effect-grant-denial-v1' as const,
  status: 'denied' as const,
  reason: 'effect-grant-issuer-unavailable' as const
});

export class DevelopmentCommitEffectGrantUnavailableError extends Error {
  readonly denial = DEVELOPMENT_COMMIT_EFFECT_GRANT_DENIAL;

  constructor() {
    super('development.commit requires an upstream owner-issued Effect grant.');
    this.name = 'DevelopmentCommitEffectGrantUnavailableError';
  }
}

/** Caller bytes, digests and test objects cannot substitute for the domain owner's missing issuer. */
export function requireUpstreamDevelopmentCommitEffectGrant(_receipt: unknown): never {
  throw new DevelopmentCommitEffectGrantUnavailableError();
}

export async function runDevelopmentCommitCommand(
  args: readonly string[]
): Promise<number> {
  if (args.length !== 1 || args[0]!.length === 0) throw new Error('development commit requires exactly one non-empty message argument.');
  console.error(JSON.stringify(DEVELOPMENT_COMMIT_EFFECT_GRANT_DENIAL));
  return 1;
}
