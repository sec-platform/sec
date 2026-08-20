const POLICY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/u;

export function isCanonicalPolicyId(value: unknown): value is string {
  return typeof value === 'string' && POLICY_ID_PATTERN.test(value);
}
