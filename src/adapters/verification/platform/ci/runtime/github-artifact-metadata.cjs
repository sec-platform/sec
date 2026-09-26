'use strict';

const gitHubArtifactMaxBytes = 5_242_880;
const gitHubArtifactSafetyWindowMs = 24 * 60 * 60 * 1_000;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

function canonicalUtcTimestamp(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} must be a UTC timestamp string.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid UTC timestamp.`);
  const canonical = parsed.toISOString();
  const wholeSecond = canonical.endsWith('.000Z') ? canonical.replace('.000Z', 'Z') : null;
  if (value !== canonical && value !== wholeSecond) {
    throw new Error(`${label} must use GitHub whole-second or canonical millisecond UTC format.`);
  }
  return canonical;
}

function canonicalizeGitHubArtifactMetadata(value, options) {
  const label = options?.label ?? 'artifact';
  const checkedAtMs = options?.checkedAtMs;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} metadata must be an object.`);
  }
  if (!Number.isSafeInteger(checkedAtMs)) throw new Error(`${label} checkedAtMs must be a safe integer.`);
  if (!Number.isSafeInteger(value.id) || value.id <= 0) throw new Error(`${label}.id must be a positive safe integer.`);
  if (typeof value.name !== 'string' || value.name.length === 0) throw new Error(`${label}.name must be non-empty.`);
  if (typeof value.digest !== 'string' || !SHA256_DIGEST.test(value.digest)) {
    throw new Error(`${label}.digest must be a lowercase SHA-256 digest.`);
  }
  if (value.expired !== false) throw new Error(`${label} must be explicitly unexpired.`);
  const expiresAt = canonicalUtcTimestamp(value.expires_at, `${label}.expires_at`);
  if (new Date(expiresAt).getTime() - checkedAtMs < gitHubArtifactSafetyWindowMs) {
    throw new Error(`${label} is inside the 24-hour safety window.`);
  }
  if (!Number.isSafeInteger(value.size_in_bytes) || value.size_in_bytes <= 0) {
    throw new Error(`${label}.size_in_bytes must be a positive safe integer.`);
  }
  if (value.size_in_bytes > gitHubArtifactMaxBytes) {
    throw new Error(`${label}.size_in_bytes exceeds the artifact size limit.`);
  }
  return {
    id: value.id,
    name: value.name,
    digest: value.digest,
    expired: false,
    expiresAt,
    sizeInBytes: value.size_in_bytes
  };
}

module.exports = {
  gitHubArtifactMaxBytes,
  gitHubArtifactSafetyWindowMs,
  canonicalizeGitHubArtifactMetadata
};
