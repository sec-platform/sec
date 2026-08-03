import { createHash } from 'node:crypto';

import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';
import type {
  SecReviewEvidenceReferenceV1,
  SecReviewFindingSeverity,
  SecReviewObservedEvidenceV1
} from './review-finding-model.ts';

export type SecReviewParsedReference = {
  path: string;
  fragment: string | null;
  reference: string;
};

export function reviewAssertObject(
  value: unknown,
  label: string
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
}

export function reviewAssertKeys(
  value: Record<string, unknown>,
  expected: ReadonlySet<string>,
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} has unknown or missing fields.`);
  }
}

export function reviewText(
  value: unknown,
  label: string,
  min = 1,
  max = 800
): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length < min
    || value.length > max
    || value.includes('\0')
    || value.includes('\r')
    || value.includes('\n')
  ) {
    throw new Error(`${label} must be a bounded single-line trimmed string.`);
  }
  return value;
}

export function reviewNullableText(value: unknown, label: string, max = 800): string | null {
  return value === null ? null : reviewText(value, label, 1, max);
}

export function reviewSlug(value: unknown, label: string): string {
  const result = reviewText(value, label, 1, 120);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(result)) {
    throw new Error(`${label} must be a lowercase kebab-case identity.`);
  }
  return result;
}

export function reviewRepository(value: unknown, label: string): string {
  const result = reviewText(value, label, 1, 201);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(result)) {
    throw new Error(`${label} must be one bounded owner/name repository.`);
  }
  return result;
}

export function reviewSha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase Git SHA.`);
  }
  return value;
}

export function reviewNullableSha(value: unknown, label: string): string | null {
  return value === null ? null : reviewSha(value, label);
}

export function reviewDigest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

export function reviewPath(value: unknown, label: string): string {
  const result = reviewText(value, label, 1, 300);
  if (!CodexDevelopmentIsCanonicalRepositoryPathV1(result)) {
    throw new Error(`${label} must be a canonical repository-relative POSIX path.`);
  }
  return result;
}

export function reviewPaths(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  const result = value.map((entry, index) => reviewPath(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} must be unique.`);
  const sorted = [...result].sort();
  if (sorted.some((entry, index) => entry !== result[index])) {
    throw new Error(`${label} must use canonical code-unit order.`);
  }
  return result;
}

export function reviewEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string
): T {
  const result = reviewText(value, label);
  if (!allowed.has(result as T)) throw new Error(`${label} is invalid.`);
  return result as T;
}

export function reviewPositiveLine(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive line number or null.`);
  }
  return value as number;
}

export function reviewSplitReference(value: unknown, label: string): SecReviewParsedReference {
  const reference = reviewText(value, label, 1, 500);
  const parts = reference.split('#');
  if (parts.length > 2) throw new Error(`${label} must contain at most one fragment.`);
  return {
    path: reviewPath(parts[0], `${label}.path`),
    fragment: parts.length === 2 ? reviewText(parts[1], `${label}.fragment`, 1, 160) : null,
    reference
  };
}

export function reviewLineRange(fragment: string, label: string): { start: number; end: number } {
  const match = /^L([1-9][0-9]*)(?:-L([1-9][0-9]*))?$/u.exec(fragment);
  if (!match) throw new Error(`${label} source-location requires an exact line fragment.`);
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (end < start) throw new Error(`${label} source-location line range is reversed.`);
  return { start, end };
}

export function reviewEvidencePath(reference: SecReviewEvidenceReferenceV1): string {
  return reviewSplitReference(reference.reference, 'review evidence reference').path;
}

export function reviewEvidenceObservationKey(
  revisionSha: string | null,
  path: string
): string {
  return `${revisionSha ?? 'physical'}\0${path}`;
}

export function reviewObservedEvidenceKey(value: SecReviewObservedEvidenceV1): string {
  return reviewEvidenceObservationKey(value.revisionSha, value.path);
}

export function reviewEvidenceKey(reference: SecReviewEvidenceReferenceV1): string {
  return [reference.kind, reference.reference, reference.revisionSha ?? '', reference.digest].join('\0');
}

export function reviewSameValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function reviewSha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}` as const;
}

export function reviewSeverityPolicyOrder(
  all: readonly SecReviewFindingSeverity[],
  selected: readonly SecReviewFindingSeverity[]
): SecReviewFindingSeverity[] {
  return all.filter((severity) => selected.includes(severity));
}
