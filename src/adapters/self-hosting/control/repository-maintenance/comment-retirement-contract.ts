export type ExactCommentRetirement = Readonly<{
  commentId: number;
  expectedAuthorLogin: string;
  expectedBodyDigest: `sha256:${string}`;
  reason: 'automation-noise' | 'superseded-operator-command' | 'superseded-execution-log';
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be one positive integer`);
  return Number(value);
}

function boundedLogin(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
      || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be one sha256 digest`);
  }
  return value as `sha256:${string}`;
}

export function parseExactCommentRetirement(value: unknown): ExactCommentRetirement {
  const input = record(value, 'comment retirement');
  const keys = Object.keys(input).sort();
  const expected = ['commentId', 'expectedAuthorLogin', 'expectedBodyDigest', 'reason'].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error('comment retirement fields are invalid');
  }
  if (input.reason !== 'automation-noise' && input.reason !== 'superseded-operator-command'
      && input.reason !== 'superseded-execution-log') {
    throw new Error('comment retirement reason is invalid');
  }
  return Object.freeze({
    commentId: positiveInteger(input.commentId, 'commentId'),
    expectedAuthorLogin: boundedLogin(input.expectedAuthorLogin, 'expectedAuthorLogin'),
    expectedBodyDigest: digest(input.expectedBodyDigest, 'expectedBodyDigest'),
    reason: input.reason
  });
}
