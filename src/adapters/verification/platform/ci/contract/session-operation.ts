import { createHash } from 'node:crypto';

// Preserve the existing insertion-ordered JSON operation identity byte for byte.
function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function assertDigest(value: unknown, label: string): `sha256:${string}` | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be null or a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

export function createVerificationSessionOperationId(input: {
  sessionRevision: `sha256:${string}`;
  operationKind: string;
  semanticInputDigest: `sha256:${string}`;
}): `sha256:${string}` {
  assertDigest(input.sessionRevision, 'sessionRevision');
  assertDigest(input.semanticInputDigest, 'semanticInputDigest');
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(input.operationKind)) {
    throw new Error('operationKind must be a bounded lowercase identifier.');
  }
  return digest(input);
}
